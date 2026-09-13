import Phaser from 'phaser';
// 模块级纯函数、常量与各类 mixin 已外提至 src/systems/ 下，按战斗 / 经济 / UI / 编辑器分类
import { BARREL_ICON, BARREL_TEX_KEY, CHEST_CLOSED_KEY, CHEST_OPEN_KEY, VENDOR_TEX_KEY, VENDOR_ICON, IDOL_TEX_KEY, IDOL_ICON, BARREL_EXPLOSION_MS, PLAYER_ART, SHIELD, HIT_FX_TTL, GATE_SPAWN_MS } from './systems/constants.js';
import { hitWall, reflectBulletAgainstWall, rayWallDistance, pointSegmentDistance, mothershipBulletHit, mothershipBodyDist } from './systems/combat/geometry.js';
import { WEAPONS, spawnLaser } from './systems/combat/weapons.js';
import { playerDamage, activeMods } from './systems/economy/damage.js';
import { buildOrbitInstance } from './systems/art/weapon-runtime.js';
import { elementCenter } from './systems/art/asset-render.js';
import { color, updatePlayerMoveLean } from './systems/ui/entity-art.js';
import { EditorInputMixin } from './systems/editor/editor-input.js';
import { EditorCameraMixin } from './systems/editor/editor-camera.js';
import { EnemyAiMixin } from './systems/combat/enemy-ai.js';
import { Boss25T5Mixin } from './systems/combat/boss25t5.js';
import { PlayerCombatMixin } from './systems/combat/player-combat.js';
import { DestructiblesMixin } from './systems/combat/destructibles.js';
import { PetMixin } from './systems/combat/pet-runtime.js';
import { SpawningMixin } from './systems/level/spawning.js';
import { TriggersMixin } from './systems/level/triggers.js';
import { InteractablesMixin } from './systems/level/interactables.js';
import { LevelFlowMixin } from './systems/level/level-flow.js';
import { DropsMixin } from './systems/economy/drops.js';
import { ProgressionMixin } from './systems/economy/progression.js';
import { InnerShopMixin } from './systems/economy/inner-shop-runtime.js';
import { RunItemsMixin } from './systems/economy/run-items-runtime.js';
import { BattleItemsMixin } from './systems/ui/battle-items.js';
import { HudMixin } from './systems/ui/hud.js';
import { UiRuntimeMixin } from './systems/ui/ui-runtime.js';
import { ScreensMixin } from './systems/ui/screens.js';
import { WorldRenderMixin } from './systems/ui/world-render.js';
import { WorldOverlayMixin } from './systems/ui/world-overlay.js';
import { MinimapMixin } from './systems/ui/minimap.js';
import { SaveLoginMixin } from './systems/gameplay/save-login.js';
import { NewbeeHubMixin } from './systems/gameplay/newbee-hub.js';
import { WorkshopMixin } from './systems/gameplay/workshop.js';

// ============================================================
// 新手教程（newbee 关卡）阶段机
// ============================================================
// 战斗 HUD 顶部状态指示器（EXPLORE / COMBAT / SECURE）

// 战斗 HUD 设置菜单图标（/图标 文件夹，经 /icons/ 接口提供）

export function createGameScene(ctx) {
  class EditorScene extends Phaser.Scene {
    constructor() { super('scene'); this.editing = ctx.state.mode === 'editor'; this.ctx = ctx; this.playerDamage = playerDamage; }

    create() {
      this.bgG = this.add.graphics().setDepth(0);
      this.g = this.add.graphics().setDepth(10);
      this.barrelSprites = new Map();
      this.chestSprites = new Map();
      this.vendorSprites = new Map();
      this.idolSprites = new Map();
      this.iconSprites = new Map();
      this.portalTexts = new Map();
      this.levelImageSprites = new Map();
      this.levelImageLoading = new Set();
      this.iconLoading = new Set();
      // 原型机-2-5T5 技能5「蓝色漩涡」：场景级数组（不挂在 BOSS 实体上 → 技能结束/多 BOSS 都不影响）。
      // 元素契约见 systems/combat/boss25t5.js 顶部注释（渲染端按 id/x/y/r/hp/maxHp/t/hitT 取值）。
      this.boss25t5Vortices = [];
      // 玩家被击败演出状态：{ phase:'cinematic'|'hold' }；null = 无演出（可直接结算）。
      this.playerDeathFlow = null;
      this.gateTexts = new Map();
      if (!this.textures.exists(VENDOR_TEX_KEY)) {
        this.load.image(VENDOR_TEX_KEY, VENDOR_ICON);
        this.load.start();
      }
      if (!this.textures.exists(IDOL_TEX_KEY)) {
        this.load.image(IDOL_TEX_KEY, IDOL_ICON);
        this.load.start();
      }
      if (!this.textures.exists(BARREL_TEX_KEY)) {
        this.load.image(BARREL_TEX_KEY, BARREL_ICON);
        this.load.start();
      }
      if (!this.textures.exists(CHEST_CLOSED_KEY)) {
        this.load.image(CHEST_CLOSED_KEY, '/chest-closed.png');
        this.load.image(CHEST_OPEN_KEY, '/chest-open.png');
        this.load.start();
      }
      if (!this.editing) this.setupUI();
      if (!this.editing) this.applyWorldBounds();
      this.input.on('pointerdown', p => this.pointerDown(p));
      this.input.on('pointermove', p => this.pointerMove(p));
      this.input.on('pointerup', () => { this.handleWorkshopPointerUp(); this.handleShopPointerUp(); this.levelSelectDrag = null; this.drag = null; this.panning = false; ctx.redraw(); });
      this.game.canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = this.game.canvas.getBoundingClientRect();
        const px = (e.clientX - rect.left) * (this.game.canvas.width / rect.width);
        const py = (e.clientY - rect.top) * (this.game.canvas.height / rect.height);
        this.onWheel(px, py, e.deltaY);
      }, { passive: false });
      this.keys = this.input.keyboard.addKeys({
        W: Phaser.Input.Keyboard.KeyCodes.W,
        A: Phaser.Input.Keyboard.KeyCodes.A,
        S: Phaser.Input.Keyboard.KeyCodes.S,
        D: Phaser.Input.Keyboard.KeyCodes.D,
        SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
        UP: Phaser.Input.Keyboard.KeyCodes.UP,
        DOWN: Phaser.Input.Keyboard.KeyCodes.DOWN,
        LEFT: Phaser.Input.Keyboard.KeyCodes.LEFT,
        RIGHT: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        F: Phaser.Input.Keyboard.KeyCodes.F,
        ESC: Phaser.Input.Keyboard.KeyCodes.ESC,
        // 局内消耗品交互键：小键盘 4/5 与主键盘 4/5（4=用药水/长按开轮盘，5=临时武器开/关）
        NUMPAD4: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FOUR,
        NUMPAD5: Phaser.Input.Keyboard.KeyCodes.NUMPAD_FIVE,
        DIGIT4: Phaser.Input.Keyboard.KeyCodes.FOUR,
        DIGIT5: Phaser.Input.Keyboard.KeyCodes.FIVE
      });
      this.input.keyboard.enabled = true;
      this.game.canvas.setAttribute('tabindex', '0');
      this.game.canvas.focus();
      this.game.canvas.addEventListener('contextmenu', e => e.preventDefault());
      this.restart();
      this.loadBackgroundImage();
      if (this.editing) this.resetEditorCamera();
    }


    // 新手教程状态初始化：所有操作禁用，从阶段 1 开始

    // 骑士之家：清理互动 UI 状态

    // 统一 F 键帽图标（/f.png），hub 与售货机 tips 共用

    // 通用图标精灵（懒加载）：首次调用触发 Image 加载，加载完成后再返回精灵








    // 把运行时资产/进度回写到数据层；预览模式写临时数据，试玩/正式写存档
    // 经验实时写入；金币在 settleVictory 通关结算时写入

    // 通关结算：金币、关卡完成进度、当前关卡写入存档；失败不调用



    // 屏幕内随机生成：在触发器/生成区域矩形范围内随机取点，
    // 距玩家不小于 playerMinRadius，且与玩家连线无障碍。
    // 每个位置先显示四角白色锁定框（渐显+缩小 0.5s），动画结束后敌人生成。

    // 检查异步事件：触发器已被进入且其召唤的敌人全部被击败时触发


    // 是否存在尚未生成完毕的敌人波次（含等待清理的波）




    update(_, dt) {
      // 运镜级全局慢动作：运镜 timeScale<1 时，所有走 dt 的世界模拟同步变慢
      const slowmo = this.cinematicTimeScale || 1;
      if (slowmo !== 1) dt *= slowmo;
      if (this.editing) {
        this.updateEditorKeys();
        return this.draw();
      }

      // 玩家被击败演出：世界继续按运镜慢放 dt 跑（不早退），但锁死一切玩家输入。
      // deathSim = 结算态 + 演出尚未结束（部分入口先置 state='fail' 再走演出）→ 放行本帧。
      const deathSim = this.state === 'fail' && !!this.playerDeathFlow;
      // playerDeathFlow 全程锁输入：stopCutscene 会先把 cinematicActive 置回 false 再回调 onComplete，
      // 故 phase:'hold'（黑幕保持 ~500ms，state 仍为 'playing'）期间 cinematicInputLocked() 与 deathSim 均为 false，
      // 若不单独纳入 playerDeathFlow，黑幕里玩家仍能按 F/4/5/ESC 打开菜单页顶掉结算页。
      const inputLocked = deathSim || !!this.playerDeathFlow || (this.cinematicInputLocked?.() ?? false);

      if (this.menuScreen === 'workshop') {
        this.updateWorkshopLongPress();
        this.updateWorkshopScrollDrag();
        this.updateWorkshopInvScrollDrag();
      }

      if (this.menuScreen === 'weapon') this.updateShopScrollDrag();

      if (this.gates) {
        for (const gt of this.gates) {
          if (gt.closing) {
            gt.spawnT -= dt / GATE_SPAWN_MS;
            if (gt.spawnT <= 0) { gt.spawnT = 0; gt.closing = false; gt.active = false; }
          } else if (gt.active && gt.spawnT < 1) {
            gt.spawnT = Math.min(1, gt.spawnT + dt / GATE_SPAWN_MS);
          }
        }
      }

      if (this.intro) {
        this.updateIntro(dt);
        this.draw();
        return;
      }

      if (this.keys.ESC && Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
        if (this.settingsMode) {
          if (this.settingsMode === 'confirm') this.settingsMode = 'menu';
          else this.closeSettingsOverlay();
          this.draw();
          return;
        }
        if (this.menuScreen) {
          this.closeMenuScreen();
          this.draw();
          return;
        }
        if (this.state === 'paused') {
          ctx.onExitPreview?.();
          return;
        }
        if (!inputLocked) this.toggleGrowth();
      }

      if (this.state === 'transition') {
        if (this.updateLevelIntro(dt)) {
          this.draw();
          return;
        }
        this.updateTransition(dt);
        this.draw();
        return;
      }

      if (this.state !== 'playing' && !deathSim) {
        this.draw();
        return;
      }

      const nb = this.newbee;
      let dx = 0, dy = 0;
      if ((!nb || nb.allowMove) && !inputLocked) {
        if (this.keys.A.isDown || this.keys.LEFT.isDown) dx--;
        if (this.keys.D.isDown || this.keys.RIGHT.isDown) dx++;
        if (this.keys.W.isDown || this.keys.UP.isDown) dy--;
        if (this.keys.S.isDown || this.keys.DOWN.isDown) dy++;
      }

      updatePlayerMoveLean(this.player, dx, dy, dt);

      const { w: ww, h: wh } = this.worldSize();
      const n = Math.hypot(dx, dy) || 1;
      const r = this.player.r;
      const baseSpeed = 180;
      const moveSpeed = this.player.combat?.moveSpeed ?? 1;
      // 原型机-2-5T5「紫色领域」减速 95%：标记由 boss25t5ZonesTick 每帧先清后置（1 帧延迟可接受）
      const slow = this.player.boss25t5Slow ? 0.05 : 1;
      // 原型机-2-5T5 技能5「蓝色漩涡」吸力：{vx,vy}（px/s）由 boss25t5VorticesTick 每帧先清零再写入，
      // 这里按与 slow 同样的写法叠加到本帧位移（取不到时按 0，不会产生 NaN）
      const pull = this.player.boss25t5Pull;
      const pullVx = pull?.vx || 0, pullVy = pull?.vy || 0;
      this.player.x = Phaser.Math.Clamp(this.player.x + (dx / n * baseSpeed * moveSpeed * slow + pullVx) * dt / 1000, r, ww - r);
      this.player.y = Phaser.Math.Clamp(this.player.y + (dy / n * baseSpeed * moveSpeed * slow + pullVy) * dt / 1000, r, wh - r);
      this.resolveMovementCollision(this.player, r);
      this.updateRoomReveal(dt);

      const pointer = this.input.activePointer;
      const rawFireDown = pointer.leftButtonDown();
      const fireDown = !inputLocked && (!this.isHubLevel() && (!nb || nb.allowFire)) && rawFireDown;

      const wantShield = !inputLocked && this.keys.SPACE.isDown && !this.player.shieldBroken;
      this.player.shieldActive = (!this.isHubLevel() && (!nb || nb.allowShield)) && wantShield;
      if (this.player.shieldActive) {
        this.player.shieldTimer = Math.min(1, this.player.shieldTimer + dt / SHIELD.fadeMs);
        const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.player.shieldAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, wp.x, wp.y);
      } else {
        this.player.shieldTimer = 0;
      }

      if (nb) {
        if (dx !== 0 || dy !== 0) nb.moved = true;
        if (fireDown) { nb.fired = true; if (nb.phase === 3) nb.phase3Fire = true; }
      }

      if (this.player.previousFireDown && !fireDown) {
        this.player.weaponDirection *= -1;
      }

      const mods = activeMods(this, this.player.weaponType);
      const mech = this.player.weapon?.mechanic;
      const fireWasDown = this.player.previousFireDown;   // 上一帧是否按下（蓄力武器「松开发射」用，须在下方覆盖前取）
      // 转速改件：射击时小球不减速转动
      const hasSpin = mods.has('spin');
      // 鼠标准心武器：发射环小球/瞄准方向始终指向鼠标，不再自动旋转
      if (mech?.aim === 'mouse') {
        const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.player.weaponAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, wp.x, wp.y);
        this.player.weaponDirection = 1;
      } else {
        // 发射媒介转速：设计武器用 medium.orbitSpeed/fireSpeed；原武器回退 180（怠速）/20（射击，带 spin 180）
        const medSpd = this.player.weapon?.medium;
        const idleSpd = medSpd?.orbitSpeed != null ? medSpd.orbitSpeed : 180;
        const fireSpd = medSpd?.fireSpeed != null ? medSpd.fireSpeed : (hasSpin ? 180 : 20);
        const angularSpeed = Phaser.Math.DegToRad(fireDown ? fireSpd : idleSpd);
        this.player.weaponAngle = Phaser.Math.Angle.Wrap(
          this.player.weaponAngle + this.player.weaponDirection * angularSpeed * dt / 1000
        );
      }
      // 蓄力武器：按住蓄力（charge 进度 0..1），松开时在 fire 段发射；蓄力完成保持满值直到松开
      if (mech?.charge?.enabled) {
        if (fireDown) this.player.charge = Math.min(1, (this.player.charge || 0) + dt / Math.max(1, mech.charge.duration));
        else if (!this.player.previousFireDown) this.player.charge = 0;
      } else {
        this.player.charge = 0;
      }
      // —— 环绕六边形机制（mechanic.orbit）：无子弹。6 颗六边形绕玩家撞击敌身；按住左键蓄击（半径/角速度/体积翻倍→再翻倍），松开平滑收拢 ——
      if (mech?.orbit?.enabled) {
        const orbit = mech.orbit;
        const wArt = this.player.weaponArt;
        const baseRadius = (wArt?.elements?.[orbit.orbitIndexes?.[0]]?.orbitRadius) || 30;
        this.player.orbit = this.player.orbit || { holdMs: 0, attacking: false, radius: baseRadius, speedMult: 1, sizeMult: 1, hexTrails: [] };
        const o = this.player.orbit;
        o.attacking = fireDown;
        // 蓄击计时（仅按住时累计；松开清 0，视觉收拢靠下方补间）
        if (fireDown) o.holdMs = Math.min(orbit.phase3HoldMs, (o.holdMs || 0) + dt);
        else o.holdMs = 0;
        // 目标阶段：按住>=phase3HoldMs 三段；按住>0 二段；否则平时/收拢目标=基础
        let tgt;
        if (o.holdMs >= orbit.phase3HoldMs) tgt = { r: orbit.phase3Radius, s: orbit.phase3SpeedMult, z: orbit.phase3SizeMult };
        else if (o.holdMs > 0) tgt = { r: orbit.phase2Radius, s: orbit.phase2SpeedMult, z: orbit.phase2SizeMult };
        else tgt = { r: baseRadius, s: 1, z: 1 };
        // 补间趋近：攻击时快速（attackLerpMs），松开时慢速（retractMs）
        const climb = fireDown ? orbit.attackLerpMs : orbit.retractMs;
        const k = Math.min(1, dt / Math.max(1, climb));
        o.radius = (o.radius ?? baseRadius) + (tgt.r - (o.radius ?? baseRadius)) * k;
        o.speedMult = (o.speedMult ?? 1) + (tgt.s - (o.speedMult ?? 1)) * k;
        o.sizeMult = (o.sizeMult ?? 1) + (tgt.z - (o.sizeMult ?? 1)) * k;
        const tt = (this.time?.now || 0) / 1000;
        const dyn = buildOrbitInstance(wArt, orbit, { radius: o.radius, speedMult: o.speedMult, sizeMult: o.sizeMult });
        const e0 = dyn?.elements?.[orbit.orbitIndexes?.[0]];
        if (e0) {
          // 拖尾：攻击时按每颗六边形记录历史位置（渲染端绘制渐隐航迹），最旧在前
          o.hexTrails = o.hexTrails || [];
          if (fireDown) {
            for (let i = 0; i < orbit.hexCount; i++) {
              const c = elementCenter(dyn, e0, i, this.player.x, this.player.y, tt, this.player.artScale || 1);
              const arr = (o.hexTrails[i] = o.hexTrails[i] || []);
              const last = arr[arr.length - 1];
              // 瞬移跳变（切轨/调速时 rotSpeed*t 角度瞬跳）跨度大：断开该颗航迹，避免连出贯穿半径的放射状乱线
              if (last && Math.hypot(c.x - last.x, c.y - last.y) > Math.max(50, o.radius * 0.6)) arr.length = 0;
              arr.push({ x: c.x, y: c.y });
              while (arr.length > orbit.trailSamples) arr.shift();
            }
          } else if (o.hexTrails.length) {
            o.hexTrails = [];
          }
          // 碰撞伤害：攻击时，每颗六边形命中敌身，按 hitIntervalMs 对同敌节流；伤害走 playerDamage（攻强/暴击，与常规武器一致）
          if (fireDown) {
            this.orbitHit = this.orbitHit || new Map();
            const now = (this.time?.now || 0);
            for (let i = 0; i < orbit.hexCount; i++) {
              const c = elementCenter(dyn, e0, i, this.player.x, this.player.y, tt, this.player.artScale || 1);
              const hitR = (e0.radius || 10) * (c.worldScale || this.player.artScale || 1);
              for (const e of this.enemies) {
                if (!e.alive) continue;
                if (e.type === 'mothership' && !e.bossActive) continue;
                // 原型机-2-5T5 同理：未激活（待机）时轨道六边形也不可命中它
                if (e.type === 'boss-2-5t5' && !e.bossActive) continue;
                if (Math.hypot(e.x - c.x, e.y - c.y) < hitR + e.r) {
                  const last = this.orbitHit.get(e.id) ?? -Infinity;
                  if (now - last >= orbit.hitIntervalMs) {
                    this.orbitHit.set(e.id, now);
                    const dmg = playerDamage(this, this.player.weaponType);
                    e.hp -= dmg;
                    if (e.type === 'mothership' || e.type === 'boss-2-5t5') e.hitFlashT = 100;
                    this.hitEffects.push({ x: c.x, y: c.y, ttl: HIT_FX_TTL });
                    if (e.hp <= 0) this.defeatEnemy(e);
                  }
                }
              }
              // 六边形命中可破坏物：箱子砸碎 / 油桶爆炸（一次触发，无节流；explodeBarrel 会置 alive=false 并连锁）
              const hitPad = Math.max(3, hitR * 0.5);
              for (const cr of this.crates) {
                if (cr.alive && hitWall(cr, c.x, c.y, hitPad)) {
                  cr.alive = false;
                  this.hitEffects.push({ x: c.x, y: c.y, ttl: HIT_FX_TTL });
                  this.spawnCrateDebris(cr);
                  break;
                }
              }
              for (const br of this.barrels) {
                if (br.alive && Math.hypot(br.x - c.x, br.y - c.y) < br.r + hitPad) {
                  this.explodeBarrel(br);
                  break;
                }
              }
            }
          }
        }
      }
      // 蓄力视窗缩放（方向：tgt=1-0.6*charge 蓄力缩放大）；发射后先停顿 0.6s（保持当前值）再逐渐恢复
      if (mech?.charge?.enabled) {
        if (fireDown) {
          this.zoomHold = 0;
          const tgt = 1 - 0.6 * (this.player.charge || 0);
          const cur = this.chargeZoom ?? 1;
          this.chargeZoom = cur + (tgt - cur) * Math.min(1, dt / 120);
        } else if (fireWasDown && (this.player.charge || 0) > 0) {
          // 本帧松开发射：进入 0.6s 停顿（保持当前缩放值）
          this.zoomHold = 600;
        } else if (this.zoomHold > 0) {
          // 停顿中：保持当前缩放值不变
          this.zoomHold = Math.max(0, this.zoomHold - dt);
        } else {
          // 停顿结束：逐渐恢复回 1
          const cur = this.chargeZoom ?? 1;
          this.chargeZoom = cur + (1 - cur) * Math.min(1, dt / 120);
        }
      } else {
        this.chargeZoom = 1;
      }
      this.player.charging = fireDown;
      this.player.firing = fireDown;
      this.player.previousFireDown = fireDown;

      const chargeWeapon = mech?.charge?.enabled;
      const wantFire = chargeWeapon
        ? (!fireDown && fireWasDown && (this.player.charge || 0) > 0)
        : (fireDown && this.fireClock <= 0);
      if (wantFire) {
        const wt = this.player.weaponType;
        const currentAmmo = this.player.ammo[wt];
        if (currentAmmo === undefined || currentAmmo > 0) {
          const shots = this.player.weapon.fire(this.player, this.player.weaponLevel, this);

          // —— 通用改件联动：多轨（方向）x 三发（每方向多发）——
          // 多轨：主方向 + 顺/逆时针 120°、240° 共 3 个方向
          // 三发：每个方向 -30°/0°/+30° 共 3 发
          // 两者叠加：每个方向都是三发；对激光（beam）同样生效
          const dirOffsets = mods.has('multi-track') ? [0, 120, 240] : [0];
          const spreadOffsets = mods.has('triple') ? [-30, 0, 30] : [0];
          const final = [];

          for (const s of shots) {
            if (s.beam) {
              for (const dirOff of dirOffsets) {
                for (const spreadOff of spreadOffsets) {
                  const a = s.angle + Phaser.Math.DegToRad(dirOff) + Phaser.Math.DegToRad(spreadOff);
                  final.push({ beam: true, ox: s.ox, oy: s.oy, angle: a, width: s.width, color: s.color });
                }
              }
              continue;
            }
            const spd = Math.hypot(s.vx, s.vy) || 1;
            const baseAngle = Math.atan2(s.vy, s.vx);
            for (const dirOff of dirOffsets) {
              for (const spreadOff of spreadOffsets) {
                const a = baseAngle + Phaser.Math.DegToRad(dirOff) + Phaser.Math.DegToRad(spreadOff);
                final.push({
                  ...s,
                  vx: Math.cos(a) * spd,
                  vy: Math.sin(a) * spd,
                  baseAngle: a,
                  dist: 0,
                  history: s.history ? [] : undefined
                });
              }
            }
          }

          for (const s of final) {
            if (s.beam) {
              this.lasers.push(spawnLaser(this, wt, s.ox, s.oy, s.angle, s.width, s.color));
              continue;
            }
            // 反弹改件：子弹标记 ricochet
            if (mods.has('ricochet')) s.ricochet = true;
            // 分裂改件：子弹标记 split
            if (mods.has('split')) s.split = true;
            this.bullets.push(s);
          }
          if (currentAmmo !== Infinity) this.player.ammo[wt] = currentAmmo - 1;
          this.tryRefillWeapon(wt);
          if (chargeWeapon) this.player.charge = 0;
          const attackSpeed = this.player.combat?.attackSpeed ?? 1;
          let interval = this.player.weapon.fireInterval || 120;
          // 转速改件：射速 +50%（间隔缩为 2/3）
          if (hasSpin) interval = interval * 2 / 3;
          this.fireClock = chargeWeapon ? 0 : interval / attackSpeed;
        }
      }
      this.fireClock -= dt;
      this.lasers = this.lasers.filter(l => (l.ttl -= dt) > 0);

      const l = ctx.state.level;

      this.bullets = this.bullets.filter(b => {
        // ① 被技能5 漩涡捕获的转化子弹：位置/接触由漩涡 tick 驱动（不前进、不参与任何碰撞）→ 原样保留。
        if (b.captured) return !b.dead;
        // 被原型机-2-5T5 护盾拦截的红子弹：停驻原地、不前进、不参与任何碰撞（墙/箱/桶/敌/护盾），
        // 仅在玩家触碰（boss25t5UpdateBlocked 置 b.dead）或 BOSS 死亡（defeatEnemy 清理）时移除。
        // 例外：被漩涡吸力或技能1/2 施力够得着时会被解冻（两块内部都会置 blockedBoss=false / thawed /
        // forceTrail，见 boss25t5VortexPull / boss25t5ZoneBulletForce），此后按转化子弹继续走下面的常规处理。
        if (b.blockedBoss) {
          if (this.boss25t5VortexPull(b, dt) || this.boss25t5ZoneBulletForce(b, dt)) b.blockedBoss = false;
          else return !b.dead;
        }
        // 撞墙渐隐中的子弹：停驻原地（不前进、不碰撞），仅按 fadeDuration 递减透明度
        if (b.wallFade) {
          WEAPONS[b.weaponType]?.stepBullet?.(b, dt, this);
          return !b.dead && b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
        }
        const obx = b.x, oby = b.y, odist = b.dist;
        b.x += b.vx * dt / 1000;
        b.y += b.vy * dt / 1000;
        b.dist += Math.hypot(b.vx, b.vy) * dt / 1000;

        // 原型机-2-5T5 技能5「蓝色漩涡」：对场上**所有**子弹施吸力（含已转化/未转化）；
        // 技能1/2 区域内的已转化子弹另受 boss25t5ZoneBulletForce 施力（吸/推）。
        // 施力后：已转化子弹落进漩涡半径 → 捕获环绕（保留该弹）；普通子弹落进漩涡半径 → 扣漩涡 HP 并消灭。
        // 位置：位移之后、护盾拦截与墙体判定之前（被吸走/捕获的弹不再参与后续碰撞）。
        this.boss25t5VortexPull(b, dt);
        this.boss25t5ZoneBulletForce(b, dt);
        if (this.boss25t5VortexCapture(b)) return true;     // 已转化子弹：捕获环绕（保留该弹）
        if (this.boss25t5VortexAbsorb(b)) return false;     // 普通玩家子弹：扣漩涡 HP 并消灭

        // 原型机-2-5T5 阻挡护盾拦截：子弹本帧位移线段（obx,oby→b.x,b.y）穿过护盾圆面 →
        // 停在护盾上、vx=vy=0、变红、打上 blockedBoss/blockedBy/blockedDamage（后续不前进、不判墙体/敌人）。
        for (const e of this.enemies) {
          if (!e.alive || e.type !== 'boss-2-5t5' || !e.bossActive) continue;
          if (this.boss25t5TryBlock(e, b, obx, oby)) return true;
        }

        WEAPONS[b.weaponType]?.stepBullet?.(b, dt, this);

        // 蓄力武器「表盘红弧」穿环：子弹本帧位移线段跨过红弧带圆（半径=arc.r）→ 变红 + 伤害翻倍（一次性）。
        // 用「上帧位置→当前位置」线段跨越判定：子弹速度快、环带宽窄时逐帧距离判定会漏。
        const ampArcs = WEAPONS[b.weaponType]?.mechanic?.ampArcs;
        if (ampArcs && ampArcs.length && !b.amplified) {
          const p = this.player;
          // 角度判定用子弹飞行航向（速度方向），而非位置角：接近发射环时不同散射角的子弹
          // 位置角都会压缩到瞄准方向附近，导致穿弧判定失真（该红的没红、不该红的红了）。
          const heading = Phaser.Math.Angle.Wrap(Math.atan2(b.vy, b.vx) - (p.weaponAngle || 0));
          const px = b.x - b.vx * dt / 1000, py = b.y - b.vy * dt / 1000;
          const d0 = Math.hypot(px - p.x, py - p.y), d1 = Math.hypot(b.x - p.x, b.y - p.y);
          const baseR = ((p.weapon?.medium?.radius > 0 ? p.weapon.medium.radius : 40) || 40) * (p.artScale || 1);
          for (const arc of ampArcs) {
            const arcR = (arc.r > 0 ? arc.r : baseR) * (p.artScale || 1);
            if ((d0 - arcR) * (d1 - arcR) <= 0 && Math.abs(heading) <= Phaser.Math.DegToRad(arc.halfDeg)) {
              b.amplified = true;
              b.colorStr = arc.color || '#ff3b3b';
              b.amplifiedColor = arc.color || '#ff3b3b';
              break;
            }
          }
        }

        // 反弹改件：撞墙时反射速度而非销毁
        if (b.ricochet) {
          const hitW = l.walls.find(w => hitWall(w, b.x, b.y, 3))
            || this.bulletGateWalls().find(w => hitWall(w, b.x, b.y, 3));
          if (hitW) {
            b.x -= b.vx * dt / 1000;
            b.y -= b.vy * dt / 1000;
            reflectBulletAgainstWall(b, hitW);
            b.x += b.vx * dt / 1000;
            b.y += b.vy * dt / 1000;
            return !b.dead && b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
          }
        }

        // 连续碰撞：用「上一帧→当前帧」线段检测墙体，避免高速子弹单帧跨过整段墙造成隧穿
        // （minigun 子弹速度 9000px/s 时每帧位移 ≈150px，远超墙厚 30px，逐帧点判定必然漏检）
        const wallAll = [...l.walls, ...this.bulletGateWalls()];
        let hitWallNow = false;
        {
          const dxw = b.x - obx, dyw = b.y - oby;
          const tw = rayWallDistance(obx, oby, dxw, dyw, wallAll);
          if (tw !== null && tw >= 0 && tw <= 1) {
            hitWallNow = true;
            // 线段穿过了墙：把子弹回退到墙面，避免子弹在墙另一侧渐隐/消失
            b.x = obx + dxw * tw;
            b.y = oby + dyw * tw;
            b.dist = odist + Math.hypot(dxw, dyw) * tw;
          }
        }

        // 撞墙且配置了消失时长：停驻在原地渐隐，而不是直接销毁
        if (hitWallNow && b.fadeDuration > 0) {
          b.wallFade = true;
          b.overTime = 0;
          b.fade = 1;
          return true;
        }

        let hit = hitWallNow;

        if (!hit) {
          for (const c of this.crates) {
            if (!c.alive) continue;
            const dxc = b.x - obx, dyc = b.y - oby;
            const tc = rayWallDistance(obx, oby, dxc, dyc, [c]);
            if (tc !== null && tc >= 0 && tc <= 1) {
              if (tc < 1) { b.x = obx + dxc * tc; b.y = oby + dyc * tc; }
              c.alive = false;
              this.hitEffects.push({ x: b.x, y: b.y, ttl: HIT_FX_TTL });
              this.spawnCrateDebris(c);
              hit = true;
              break;
            }
          }
        }

        if (!hit) {
          for (const br of this.barrels) {
            if (br.alive && pointSegmentDistance(br.x, br.y, obx, oby, b.x, b.y) < br.r + 4) {
              this.explodeBarrel(br);
              hit = true;
              break;
            }
          }
        }

        // 已转化子弹（blockedBy != null，由护盾红弹解冻 / 捕获释放而来）不再伤害敌人 / BOSS：
        // 只保留墙 / 箱 / 桶碰撞（箱/桶分支在上面，已执行过）。
        const converted = b.blockedBy != null;
        for (const e of this.enemies) {
          if (converted) break;   // 已转化子弹跳过全部敌人命中循环
          if (!e.alive) continue;
          let hx, hy, hitNow = false;
          if (e.type === 'boss-2-5t5') {
            // 原型机-2-5T5：圆判定，半径 = e.r（=80 = 美术 圆弧1 内圈）。
            // ① 护盾「存在」时子弹已在上面被 boss25t5TryBlock 拦下并 return，这里再兜一层 boss25t5ShieldActive；
            // ② 未激活（bossActive=false）的 BOSS 完全免疫子弹 —— 与母舰口径一致（不可漏到下方通用 else 分支）。
            if (e.bossActive && !this.boss25t5ShieldActive(e)
                && pointSegmentDistance(e.x, e.y, obx, oby, b.x, b.y) < e.r + 5) {
              const dxe = b.x - obx, dye = b.y - oby;
              const lenE = dxe * dxe + dye * dye;
              const te = lenE ? Math.max(0, Math.min(1, ((e.x - obx) * dxe + (e.y - oby) * dye) / lenE)) : 0;
              hx = obx + dxe * te; hy = oby + dye * te;
              hitNow = true;
            }
          } else if (e.type === 'mothership' && e.bossActive) {
            // 母舰：Hitbox 与画板本体一致（风筝形），随朝向旋转
            const mfacing = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y) + Math.PI / 2;
            const hp = mothershipBulletHit(e, mfacing, obx, oby, b.x, b.y);
            if (hp) { hx = hp.x; hy = hp.y; hitNow = true; }
          } else if (pointSegmentDistance(e.x, e.y, obx, oby, b.x, b.y) < e.r + 5) {
            // 命中点取线段上距敌人最近处，特效贴近实际交汇点
            const dxe = b.x - obx, dye = b.y - oby;
            const lenE = dxe * dxe + dye * dye;
            const te = lenE ? Math.max(0, Math.min(1, ((e.x - obx) * dxe + (e.y - oby) * dye) / lenE)) : 0;
            hx = obx + dxe * te; hy = oby + dye * te;
            hitNow = true;
          }
          if (hitNow) {
            let dmg = b.petDamage != null ? b.petDamage : playerDamage(this, b.weaponType);
            if (b.damageMult) dmg *= b.damageMult;   // 蓄力伤害倍率
            if (b.amplified) dmg *= 2;               // 穿表盘红弧伤害翻倍
            e.hp -= dmg;
            if (e.type === 'mothership' || e.type === 'boss-2-5t5') e.hitFlashT = 100;
            this.hitEffects.push({ x: hx, y: hy, ttl: HIT_FX_TTL });
            if (e.hp <= 0) {
              // 分裂改件：击杀后从敌位置向周围 3 方向发小号子弹
              if (b.split) {
                const ex = e.x, ey = e.y;
                for (let k = 0; k < 3; k++) {
                  const a = Math.random() * Math.PI * 2;
                  this.bullets.push({
                    x: ex, y: ey,
                    vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
                    dist: 0,
                    weaponType: b.weaponType,
                    level: b.level,
                    split: false,
                    scale: 0.5,
                    trailColor: b.trailColor
                  });
                }
              }
              this.defeatEnemy(e);
            }
            hit = true;
            break;
          }
        }

        // 命中敌人/箱子/油桶且配置了消失时长：停驻在原地渐隐，而不是立即销毁（拖尾逐渐变淡）
        if (hit && b.fadeDuration > 0) {
          b.wallFade = true;
          b.overTime = 0;
          b.fade = 1;
          return true;
        }

        return !b.dead && !hit && b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
      });

      // 被护盾拦截、停驻在原地的红子弹：玩家触碰 → 先试护盾格挡（命中护盾则消除该弹 + 扣盾值），
      // 未挡住才扣 blockedDamage 并移除（须在 filter 之后跑）
      this.boss25t5UpdateBlocked(dt);

      // 原型机-2-5T5 技能5「蓝色漩涡」：每帧推进一次（存活计时 / 玩家吸力 / 玩家入漩涡周期伤害）。
      // 与 stepBoss25T5 里的那次调用互为保底（mixin 内部带帧令牌去重 → 同一帧只推进一次）。
      this.boss25t5VorticesTick(dt);

      for (const e of this.enemies) {
        if (!e.alive) continue;
        this.stepEnemy(e, dt);
        // 原型机-2-5T5 技能区域生命周期 + 命中判定。漏调 → 区域相位永不推进：
        // stepBoss25T5 的 skill 状态会永远等不到 activeZone 进入 keep → 技能不结束、BOSS 卡死在 skill 态。
        if (e.type === 'boss-2-5t5') this.boss25t5ZonesTick(e, dt);
        this.resolveEnemyCollision(e);

        const dist = Math.hypot(e.x - this.player.x, e.y - this.player.y);

        // 母舰接触分派：Hitbox 与本体一致（风筝形）。护盾生效且面向+命中 → 清盾并自爆；贴身 → 秒杀并自爆
        if (e.alive && e.type === 'mothership' && e.bossActive) {
          const mfacing = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y) + Math.PI / 2;
          const bodyDist = mothershipBodyDist(e, mfacing, this.player.x, this.player.y);
          const toEnemy = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y);
          const diff = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - this.player.shieldAngle));
          const radius = PLAYER_ART.weaponRingRadius + SHIELD.gap;
          if (this.player.shieldActive && !this.player.shieldBroken
              && diff <= Phaser.Math.DegToRad(SHIELD.arcDeg / 2) && bodyDist < radius) {
            this.player.shield = 0;
            this.player.shieldBroken = true;
            this.player.shieldActive = false;
            this.mothershipSelfDestruct(e);
            continue;
          }
          if (bodyDist < this.player.r) {
            this.player.hp = 0;
            this.player.shield = 0;
            this.player.shieldBroken = true;
            this.player.shieldActive = false;
            this.triggerPlayerDefeat();
            this.mothershipSelfDestruct(e);
            continue;
          }
        }

        // 原型机-2-5T5 不走「撞盾反杀」：hitShield → defeatEnemy 会因本身体积（e.r=80）被贴身玩家一击判死，
        // BOSS 的破防手段只有子弹扣血（护盾存在时拦截），盾格挡不消耗 BOSS。
        if (e.type !== 'boss-2-5t5' && this.player.shieldActive && !this.player.shieldBroken) {
          const toEnemy = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y);
          const diff = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - this.player.shieldAngle));
          const radius = PLAYER_ART.weaponRingRadius + SHIELD.gap;
          if (diff <= Phaser.Math.DegToRad(SHIELD.arcDeg / 2) && dist < radius + e.r) {
            this.hitShield(e);
            continue;
          }
        }

        // 接触伤害：必须排除自己人 —— e.type !== 'boss-2-5t5'，否则玩家一碰到 BOSS 本体（e.r=80）
        // 就会走 damagePlayer + defeatEnemy 把 BOSS 直接判死。BOSS 的伤害走技能区域（boss25t5ZonesTick）。
        if (this.state === 'playing' && e.type !== 'advanced2' && e.type !== 'boss-2-5t5'
            && dist < e.r + this.player.r) {
          this.damagePlayer(e.damage);
          this.defeatEnemy(e);
        }
      }

      this.enemyBullets = this.enemyBullets.filter(b => {
        b.x += b.vx * dt / 1000;
        b.y += b.vy * dt / 1000;
        b.dist += Math.hypot(b.vx, b.vy) * dt / 1000;

        if (l.walls.some(w => hitWall(w, b.x, b.y, 3))
          || this.activeGateWalls().some(w => hitWall(w, b.x, b.y, 3))) {
          return false;
        }

        if (this.blockWithShield(b.x, b.y, b.damage, 4)) {
          return false;
        }

        // 敌弹命中宠物：仅当宠物可被击中时结算（宠物挡在玩家与弹道之间）
        if (this.pets) {
          for (const pet of this.pets) {
            if (!pet.alive || pet.invincible) continue;
            if (Math.hypot(pet.x - b.x, pet.y - b.y) < (pet.r || 12) + 4) {
              this.damagePet(pet, b.damage);
              return false;
            }
          }
        }

        if (Math.hypot(b.x - this.player.x, b.y - this.player.y) < this.player.r + 5) {
          this.damagePlayer(b.damage);
          return false;
        }

        return b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
      });

      this.updateDrops(dt);
      this.updateChests(dt);
      this.updatePortals(dt);
      this.hitEffects = this.hitEffects.filter(h => (h.ttl -= dt) > 0);

      this.crateDebris = this.crateDebris.filter(d => {
        d.ttl -= dt;
        const sec = dt / 1000;
        for (const seg of d.segments) {
          seg.cx += seg.vx * sec;
          seg.cy += seg.vy * sec;
        }
        return d.ttl > 0;
      });

      this.barrelExplosions = this.barrelExplosions.filter(ex => {
        ex.ttl -= dt;
        ex.img.setAlpha(Math.max(0, ex.ttl / BARREL_EXPLOSION_MS));
        if (ex.ttl <= 0) { ex.img.destroy(); return false; }
        return true;
      });

      this.updateSpawnEffects(dt);
      this.updateLockEffects(dt);

      if (this.player.hitFlash) {
        this.player.hitFlash.t += dt;
        this.player.hitFlash.alpha = Math.max(0, 1 - this.player.hitFlash.t / this.player.hitFlash.total);
        if (this.player.hitFlash.alpha <= 0) this.player.hitFlash = null;
      }

      if (this.wheelAnim) {
        this.wheelAnim.t += dt;
        if (this.wheelAnim.t >= this.wheelAnim.dur) this.wheelAnim = null;
      }

      this.updateHud(dt);
      this.updateTriggers();
      this.updatePets(dt);
      // 死亡演出期间不派发异步触发器（避免 enemiesCleared 的 playCinematic 顶掉死亡运镜 → playerDeathFlow 卡死）
      if (!inputLocked) this.checkAsyncTriggerEvents();

      this.updateNewbee(dt);

      this.updateHubInteract(dt);
      if (!inputLocked) this.updateVendorInteract(dt);
      this.updateVendorSlot();
      // 局内药水/限时武器推进 + 数字键 4/5 交互；须在 updateVendorInteract 之后，保证售货机页购买当帧即生效
      this.updateRunItems(dt);
      if (!inputLocked) this.updateBattleItemsInput(dt);
      if (!inputLocked) this.updateIdolInteract(dt);
      if (!inputLocked) this.updateIconInteract(dt);
      if (!inputLocked) this.updatePortalInteract(dt);
      this.updateGuideArrows(dt);

      this.updatePlayCamera(dt);
      this.syncUIState();
      this.draw();
    }

    // 设置教程提示（带出现前延迟）

    // 骑士之家：F 键互动

    // 新手教程阶段机

    // 统一阶段推进（可读性优先）






    // 金色十字星特效（多层星芒 + 旋转光环，快速利落）




    // 无图标的可交互图标：世界图形占位（编辑与游戏均显示，src 为空时由 sprite 接管）

    // 传送门文字标签（EVACUATION）：编辑态显示全部，游戏态仅显示已出现的








    // 传送门出现：复用宝箱的金色十字星特效


    // 新手关：玩家头顶分阶段操作提示（文字 + 可选键位图标）

    // 新手关阶段6：绘制两个矩形触发器（后续用特效代替）


    // 骑士之家：可互动物体图标占位 + 靠近时的 F 键提示（平行四边形，白底黑字，渐显）


    // ---------- 局内售货机（独立 HUD 页）：左老虎机（占位）+ 右局内商店 ----------

    // ---------- 选择关卡（levelSelect）：两页：页1=模式选关(探险/守卫)，页2=探险子关选关 ----------


    // ---------- 武器商店页 ----------

    // 购买武器：扣金币 + 解锁武器并写回存档

    // 购买改件：扣金币 + 加入改件库存并写回存档

    // ---------- 存档选择界面 ----------


    // ---------- 登录主界面按钮 ----------




  }

  // 战斗相关方法已外提至 systems/combat/ 下的 mixin，this 语义不变
  Object.assign(EditorScene.prototype, EnemyAiMixin, Boss25T5Mixin, PlayerCombatMixin, DestructiblesMixin, PetMixin, SpawningMixin, TriggersMixin, InteractablesMixin, LevelFlowMixin, HudMixin, UiRuntimeMixin, ScreensMixin, SaveLoginMixin, NewbeeHubMixin, WorkshopMixin, DropsMixin, ProgressionMixin, InnerShopMixin, RunItemsMixin, BattleItemsMixin, EditorInputMixin, EditorCameraMixin, WorldRenderMixin, WorldOverlayMixin, MinimapMixin);

  return EditorScene;
}






