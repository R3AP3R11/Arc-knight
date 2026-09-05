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
 *   updateIdolInteract / updateIconInteract     —— 神像 / 图标靠近提示与 F 键互动
 *   triggerIconEvent                            —— 图标事件派发到对应菜单页
 *   updatePortalInteract / updateVendorInteract —— 传送门 / 售货机靠近提示与 F 键互动
 *   openIdolOffer / closeIdolOffer / chooseIdolBuff —— 神像祝福开关与选取生效
 *
 * 通过 Object.assign(EditorScene.prototype, InteractablesMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import Phaser from 'phaser';
import { CHEST_SPAWN_FX_MS, CHEST_OPEN_FX_MS } from '../constants.js';
import { IDOL_BUFFS, IDOL_OFFER_COUNT } from '../economy/buffs.js';
import { ensureDesigns } from '../art/design-store.js';

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
      if (chest.opened) return;
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
        if (chest.spawned && !chest.opened
          && Math.hypot(this.player.x - chest.x, this.player.y - chest.y) <= chest.openRadius) {
          this.openChest(chest);
        }
      }
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
        this.openMenuScreen('vendor');
      }
    },
};
