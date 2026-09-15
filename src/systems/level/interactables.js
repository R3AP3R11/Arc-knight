/**
 * 场景可交互物混入模块（分类：关卡设计）
 *
 * 职责：关卡内可交互物件的生成、状态推进与 F 键互动——宝箱出现/开启与掉落、
 * 传送门出现/使用与撤离结算、神像祝福三选一、售货机与可交互图标的靠近提示与事件派发。
 *
 * 方法清单：
 *   spawnChest / spawnChestsForTrigger          —— 宝箱出现 / 按触发器批量出现
 *   spawnPortal / spawnPortalsForTrigger        —— 传送门出现 / 按触发器批量出现
 *   usePortal / openChest                       —— 传送门撤离 / 开箱发奖
 *   updateChests / updatePortals                —— 宝箱与传送门特效计时、自动开箱
 *   setChestsLocked / chestLockWalls            —— 宝箱上锁/解锁（触发器事件派发；含红环渐显/渐隐计时 + 碰撞体）
 *   updateIdolInteract / updateIconInteract     —— 神像 / 图标靠近提示与 F 键互动
 *   triggerIconEvent                            —— 图标事件派发到对应菜单页
 *   updatePortalInteract / updateVendorInteract —— 传送门 / 售货机靠近提示与 F 键互动（售货机 F 键经 openVendorShop 打开局内商店页）
 *   openIdolOffer / closeIdolOffer / chooseIdolBuff —— 神像祝福开关与选取生效
 *   updateCampfireInteract / campfireWalls / openCampfireOffer / closeCampfireOffer / campfireChooseHeal / campfireChooseUpgrade / campfireBackToFirst / campfirePickUpgrade —— 休息火堆靠近提示、矩形碰撞体与回血 / 升级二选一弹窗
 *
 * 通过 Object.assign(EditorScene.prototype, InteractablesMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import Phaser from 'phaser';
import { CHEST_SPAWN_FX_MS, CHEST_OPEN_FX_MS, CHEST_LOCK_RING_THICKNESS, CHEST_LOCK_FADE_MS } from '../constants.js';
import { chestLockRadius } from '../../state.js';
import { IDOL_BUFFS, IDOL_OFFER_COUNT } from '../economy/buffs.js';
import { ensureDesigns } from '../art/design-store.js';
import { rollCampfireUpgrades, applyCampfireOption, campfireHeal } from '../economy/campfire.js';
import { preloadArtRefs } from '../ui/vendor-shop-art.js';

export const InteractablesMixin = {
  // ── 宝箱与传送门：生成、开启、特效推进 ──
    // 宝箱出现：伴随金色十字星特效
    spawnChest(chest) {
      if (chest.spawned || chest.opened) return;
      chest.spawned = true;
      chest.fx = { t: CHEST_SPAWN_FX_MS, kind: 'spawn' };
    },

    // 触发器清敌事件派发后，令绑定该触发器的宝箱出现
    spawnChestsForTrigger(triggerId) {
      if (!this.chests || !triggerId) return;
      for (const chest of this.chests) {
        if (chest.trigger === 'trigger' && chest.triggerId === triggerId) {
          this.spawnChest(chest);
        }
      }
    },

    // 触发器清敌事件派发后，令绑定该触发器的传送门出现
    spawnPortalsForTrigger(triggerId) {
      if (!this.portals || !triggerId) return;
      for (const portal of this.portals) {
        if (portal.trigger === 'trigger' && portal.triggerId === triggerId) {
          this.spawnPortal(portal);
        }
      }
    },

    spawnPortal(portal) {
      if (portal.spawned || portal.used) return;
      portal.spawned = true;
      portal.fx = { t: CHEST_SPAWN_FX_MS, kind: 'spawn' };
    },

    // 传送门交互：直接触发整体通关标记（回到骑士之家）
    usePortal(portal) {
      if (portal.used) return;
      portal.used = true;
      this.state = 'end';
      this.settleVictory();
    },

    openChest(chest) {
      if (chest.opened || chest.locked) return;
      chest.opened = true;
      chest.fx = { t: CHEST_OPEN_FX_MS, kind: 'open' };
      for (const rule of chest.rewards) {
        if (Math.random() * 100 >= rule.chance) continue;
        this.spawnDropItems(chest, rule.item, Math.max(0, Math.floor(Number(rule.count) || 0)));
      }
    },

    updateChests(dt) {
      if (!this.chests) return;
      for (const chest of this.chests) {
        if (chest.fx) {
          chest.fx.t -= dt;
          if (chest.fx.t <= 0) chest.fx = null;
        }
        // 上锁红环的渐显 / 渐隐（只影响显示；碰撞随 locked 即时生效 / 失效）
        if (chest.lockFx) {
          chest.lockFx.t -= dt;
          const p = 1 - Math.max(0, chest.lockFx.t) / CHEST_LOCK_FADE_MS;
          chest.lockAlpha = chest.lockFx.kind === 'lock' ? p : 1 - p;
          if (chest.lockFx.t <= 0) {
            chest.lockFx = null;
            chest.lockAlpha = chest.locked ? 1 : 0;
          }
        } else {
          chest.lockAlpha = chest.locked ? 1 : 0;
        }
        if (chest.spawned && !chest.opened && !chest.locked
          && Math.hypot(this.player.x - chest.x, this.player.y - chest.y) <= chest.openRadius) {
          this.openChest(chest);
        }
      }
    },

  // ── 宝箱上锁 / 解锁（由触发器事件 lockChest / unlockChest 派发） ──
    // 上锁的宝箱不可开启，且被一圈红色圆环包围：圆环具碰撞体积，挡玩家/敌人移动 + 挡所有子弹
    setChestsLocked(chestIds, locked) {
      const ids = Array.isArray(chestIds) ? chestIds : [];
      if (!ids.length) return;
      const want = !!locked;
      for (const chest of (this.chests || [])) {
        // 状态未变则不重播动画（同一触发器重复上锁 / 解锁时红环不应闪一下）
        if (!ids.includes(chest.id) || chest.locked === want) continue;
        // 从当前 alpha 接着走：上锁渐显（t=(1-a)·fade，alpha=p）、解锁渐隐（t=a·fade，alpha=1-p）。
        // 这样「渐显未完成就解锁」也不会突跳（a=0 上锁 / a=1 解锁时与整段动画等价）。
        const a = typeof chest.lockAlpha === 'number' ? chest.lockAlpha : (chest.locked ? 1 : 0);
        chest.locked = want;
        chest.lockFx = { t: (want ? 1 - a : a) * CHEST_LOCK_FADE_MS, kind: want ? 'lock' : 'unlock' };
      }
    },

    // 上锁宝箱的红环碰撞体（圆形墙：玩家/敌人移动碰撞与子弹/激光射线共用）；解锁即从列表消失
    chestLockWalls() {
      if (this.editing) return [];
      return (this.chests || [])
        .filter(c => c.locked && c.spawned)
        .map(c => {
          const r = chestLockRadius(c);
          return { x: c.x, y: c.y, w: r * 2, thickness: CHEST_LOCK_RING_THICKNESS, shape: 'circle', rotation: 0 };
        });
    },

    updatePortals(dt) {
      if (!this.portals) return;
      for (const p of this.portals) {
        if (p.fx) {
          p.fx.t -= dt;
          if (p.fx.t <= 0) p.fx = null;
        }
      }
    },

  // ── 神像与图标：靠近提示与 F 键互动 ──
    // 神像：F 键互动（靠近显示提示，交互后弹出 3 张属性卡，选 1 生效且不可再用）
    updateIdolInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.idolNearest = null;
        this.idolTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.idols || [])) {
        if (v.used || v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 130, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.idolNearest = nearest;
      this.idolTipT = nearest ? Math.min(1, (this.idolTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.openIdolOffer(nearest);
      }
    },

    // 可交互图标：F 键互动（靠近显示提示，按 F 打开对应菜单页）
    updateIconInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.iconNearest = null;
        this.iconTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.icons || [])) {
        if (v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 120, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.iconNearest = nearest;
      this.iconTipT = nearest ? Math.min(1, (this.iconTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.triggerIconEvent(nearest);
      }
    },

    triggerIconEvent(icon) {
      if (!icon) return;
      icon.guideUsed = true;   // 指引「交互后停止」标记
      if (icon.event === 'weapon') this.openMenuScreen('weapon');
      else if (icon.event === 'battle') this.openMenuScreen('levelSelect');
      else this.openMenuScreen('workshop');
    },

    // 传送门：F 键互动（靠近显示「撤离」提示，交互后触发整体通关）
    updatePortalInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.portalNearest = null;
        this.portalTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.portals || [])) {
        if (!v.spawned || v.used || v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 90, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.portalNearest = nearest;
      this.portalTipT = nearest ? Math.min(1, (this.portalTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.usePortal(nearest);
      }
    },

  // ── 神像祝福：三选一开关与生效 ──
    // 打开神像祝福选择：随机 3 项基础属性加成（点空白关闭不消耗神像，可重新打开）
    openIdolOffer(idol) {
      if (this.idolOffer || !idol) return;
      const pool = [...IDOL_BUFFS];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      this.idolOffer = { idol, cards: pool.slice(0, IDOL_OFFER_COUNT) };
      // 预加载卡片图标的动态资产，避免首帧黑圆占位
      ensureDesigns(this.idolOffer.cards.map(c => c.icon)).catch(() => {});
      if (this.state === 'playing') { this.prevState = 'playing'; this.state = 'paused'; }
      this.syncUIState();
    },

    closeIdolOffer() {
      if (!this.idolOffer) return;
      this.idolOffer = null;
      if (this.prevState === 'playing') { this.state = 'playing'; this.prevState = null; }
      this.syncUIState();
    },

    chooseIdolBuff(index) {
      const offer = this.idolOffer;
      if (!offer) return;
      const buff = offer.cards[index];
      if (!buff) return;
      this.player.combat = this.player.combat || {};
      buff.apply(this);
      offer.idol.used = true;
      this.closeIdolOffer();
    },

  // ── 售货机：靠近提示与 F 键互动 ──
    // 售货机：F 键互动（靠近显示提示，按 F 打开局内商店）
    updateVendorInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.vendorNearest = null;
        this.vendorTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.vendors || [])) {
        if (v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 120, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.vendorNearest = nearest;
      this.vendorTipT = nearest ? Math.min(1, (this.vendorTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        nearest.guideUsed = true;   // 指引「交互后停止」标记（见 world-overlay.js:updateGuideArrows）
        this.openVendorShop(nearest);
      }
    },

  // ── 休息火堆：靠近提示、碰撞体与回血 / 升级二选一 ──
    // 休息火堆：F 键互动（靠近显示提示，按 F 弹出回血 / 升级二选一）
    updateCampfireInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.campfireNearest = null;
        this.campfireTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.campfires || [])) {
        if (v.used || v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 150, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.campfireNearest = nearest;
      this.campfireTipT = nearest ? Math.min(1, (this.campfireTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.openCampfireOffer(nearest);
      }
    },

    // 休息火堆占据的矩形碰撞体（visible!==false 才计入；编辑态取关卡数据，运行态取局内实例）
    campfireWalls() {
      const list = (this.editing ? this.ctx.state.level.campfires : this.campfires) || [];
      return list
        .filter(v => v.visible !== false)
        .map(v => ({ x: v.x, y: v.y, w: v.w, h: v.h, shape: 'rect', rotation: 0 }));
    },

    // 打开火堆选择：第一层二选一（回血 / 升级）；点空白关闭不消耗火堆
    openCampfireOffer(cf) {
      if (this.campfireOffer || !cf) return;
      this.campfireOffer = { cf, layer: 1 };
      // 预取第一层两个选项图标，避免首帧占位
      preloadArtRefs([
        { artType: '像素', artName: '生命值回满图标' },
        { artType: '动态资产', artName: '杰作升级图标' }
      ]).catch(() => {});
      if (this.state === 'playing') { this.prevState = 'playing'; this.state = 'paused'; }
      this.syncUIState();
    },

    closeCampfireOffer() {
      if (!this.campfireOffer) return;
      this.campfireOffer = null;
      if (this.prevState === 'playing') { this.state = 'playing'; this.prevState = null; }
      this.syncUIState();
    },

    // 火堆回血：生命回满并消耗火堆（走离场动画，由 UI 动画结束再调 closeCampfireOffer）
    campfireChooseHeal() {
      const offer = this.campfireOffer;
      if (!offer) return;
      campfireHeal(this);
      offer.cf.used = true;
      offer.closing = true;
    },

    // 火堆升级：切到第二层并生成 3 条升级 option（挂在火堆实例上，本局固定不重抽）
    campfireChooseUpgrade() {
      const offer = this.campfireOffer;
      if (!offer) return;
      offer.switch = { from: offer.layer, startT: this.time.now };   // 切层动画起点（绘制端消费）
      offer.layer = 2;
      // 结果挂到火堆实例上：实例本局存活（重开关卡才重建）→ 退出再进不重抽；
      // 重开关卡时 level-flow.restart 会重建 this.campfires 实例，old options 随实例丢弃 → 重新 roll。
      if (!offer.cf.options) {
        offer.cf.options = rollCampfireUpgrades(this, offer.cf, {
          weapons: this.player.weapons,
          weaponIndex: this.player.weaponIndex,
          player: this.player
        });
      }
      offer.options = offer.cf.options;   // offer.options 与 cf.options 同一引用
    },

    // 火堆升级返回第一层（options 保留，不重抽）
    campfireBackToFirst() {
      const offer = this.campfireOffer;
      if (!offer) return;
      offer.switch = { from: offer.layer, startT: this.time.now };   // 切层动画起点（绘制端消费）
      offer.layer = 1;
    },

    // 火堆升级选取：entries 为空则该按钮不可选；生效后自动切到该武器并消耗火堆（走离场动画）
    campfirePickUpgrade(index) {
      const offer = this.campfireOffer;
      if (!offer) return;
      const option = (offer.options || [])[index];
      if (!option || !Array.isArray(option.entries) || !option.entries.length) return;
      const ok = applyCampfireOption(this, option);
      if (!ok) return;                                     // 未生效（已拥有 / 超上限）不消耗火堆
      this.equipWeaponByType(option.weaponType);           // 选中后自动切到该武器
      offer.cf.used = true;
      offer.closing = true;
    },
};
