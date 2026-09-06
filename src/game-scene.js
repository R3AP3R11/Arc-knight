import Phaser from 'phaser';
// 模块级纯函数、常量与各类 mixin 已外提至 src/systems/ 下，按战斗 / 经济 / UI / 编辑器分类
import { BARREL_ICON, BARREL_TEX_KEY, CHEST_CLOSED_KEY, CHEST_OPEN_KEY, VENDOR_TEX_KEY, VENDOR_ICON, IDOL_TEX_KEY, IDOL_ICON, BARREL_EXPLOSION_MS, PLAYER_ART, SHIELD, HIT_FX_TTL, GATE_SPAWN_MS } from './systems/constants.js';
import { hitWall, reflectBulletAgainstWall } from './systems/combat/geometry.js';
import { WEAPONS, spawnLaser } from './systems/combat/weapons.js';
import { playerDamage, activeMods } from './systems/economy/damage.js';
import { buildOrbitInstance } from './systems/art/weapon-runtime.js';
import { elementCenter } from './systems/art/asset-render.js';
import { color, updatePlayerMoveLean } from './systems/ui/entity-art.js';
import { EditorInputMixin } from './systems/editor/editor-input.js';
import { EditorCameraMixin } from './systems/editor/editor-camera.js';
import { EnemyAiMixin } from './systems/combat/enemy-ai.js';
import { PlayerCombatMixin } from './systems/combat/player-combat.js';
import { DestructiblesMixin } from './systems/combat/destructibles.js';
import { PetMixin } from './systems/combat/pet-runtime.js';
import { SpawningMixin } from './systems/level/spawning.js';
import { TriggersMixin } from './systems/level/triggers.js';
import { InteractablesMixin } from './systems/level/interactables.js';
import { LevelFlowMixin } from './systems/level/level-flow.js';
import { DropsMixin } from './systems/economy/drops.js';
import { ProgressionMixin } from './systems/economy/progression.js';
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
    constructor() { super('scene'); this.editing = ctx.state.mode === 'editor'; this.ctx = ctx; }

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
        ESC: Phaser.Input.Keyboard.KeyCodes.ESC
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
      if (this.editing) {
        this.updateEditorKeys();
        return this.draw();
      }

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
        this.toggleGrowth();
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

      if (this.state !== 'playing') {
        this.draw();
        return;
      }

      const nb = this.newbee;
      let dx = 0, dy = 0;
      if (!nb || nb.allowMove) {
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
      this.player.x = Phaser.Math.Clamp(this.player.x + dx / n * baseSpeed * moveSpeed * dt / 1000, r, ww - r);
      this.player.y = Phaser.Math.Clamp(this.player.y + dy / n * baseSpeed * moveSpeed * dt / 1000, r, wh - r);
      this.resolveMovementCollision(this.player, r);

      const pointer = this.input.activePointer;
      const rawFireDown = pointer.leftButtonDown();
      const fireDown = (!this.isHubLevel() && (!nb || nb.allowFire)) && rawFireDown;

      const wantShield = this.keys.SPACE.isDown && !this.player.shieldBroken;
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
              (o.hexTrails[i] = o.hexTrails[i] || []).push({ x: c.x, y: c.y });
              while (o.hexTrails[i].length > orbit.trailSamples) o.hexTrails[i].shift();
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
                if (Math.hypot(e.x - c.x, e.y - c.y) < hitR + e.r) {
                  const last = this.orbitHit.get(e.id) ?? -Infinity;
                  if (now - last >= orbit.hitIntervalMs) {
                    this.orbitHit.set(e.id, now);
                    const dmg = playerDamage(this, this.player.weaponType);
                    e.hp -= dmg;
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
        // 撞墙渐隐中的子弹：停驻原地（不前进、不碰撞），仅按 fadeDuration 递减透明度
        if (b.wallFade) {
          WEAPONS[b.weaponType]?.stepBullet?.(b, dt, this);
          return !b.dead && b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
        }
        b.x += b.vx * dt / 1000;
        b.y += b.vy * dt / 1000;
        b.dist += Math.hypot(b.vx, b.vy) * dt / 1000;
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
            || this.activeGateWalls().find(w => hitWall(w, b.x, b.y, 3));
          if (hitW) {
            b.x -= b.vx * dt / 1000;
            b.y -= b.vy * dt / 1000;
            reflectBulletAgainstWall(b, hitW);
            b.x += b.vx * dt / 1000;
            b.y += b.vy * dt / 1000;
            return !b.dead && b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
          }
        }

        const hitWallNow = l.walls.some(w => hitWall(w, b.x, b.y, 3))
          || this.activeGateWalls().some(w => hitWall(w, b.x, b.y, 3));

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
            if (c.alive && hitWall(c, b.x, b.y, 3)) {
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
            if (br.alive && Math.hypot(br.x - b.x, br.y - b.y) < br.r + 4) {
              this.explodeBarrel(br);
              hit = true;
              break;
            }
          }
        }

        for (const e of this.enemies) {
          if (e.alive && Math.hypot(e.x - b.x, e.y - b.y) < e.r + 5) {
            let dmg = b.petDamage != null ? b.petDamage : playerDamage(this, b.weaponType);
            if (b.damageMult) dmg *= b.damageMult;   // 蓄力伤害倍率
            if (b.amplified) dmg *= 2;               // 穿表盘红弧伤害翻倍
            e.hp -= dmg;
            this.hitEffects.push({ x: b.x, y: b.y, ttl: HIT_FX_TTL });
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

      for (const e of this.enemies) {
        if (!e.alive) continue;
        this.stepEnemy(e, dt);
        this.resolveEnemyCollision(e);

        const dist = Math.hypot(e.x - this.player.x, e.y - this.player.y);

        if (this.player.shieldActive && !this.player.shieldBroken) {
          const toEnemy = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y);
          const diff = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - this.player.shieldAngle));
          const radius = PLAYER_ART.weaponRingRadius + SHIELD.gap;
          if (diff <= Phaser.Math.DegToRad(SHIELD.arcDeg / 2) && dist < radius + e.r) {
            this.hitShield(e);
            continue;
          }
        }

        if (this.state === 'playing' && e.type !== 'advanced2' && dist < e.r + this.player.r) {
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
      this.checkAsyncTriggerEvents();

      this.updateNewbee(dt);

      this.updateHubInteract(dt);
      this.updateVendorInteract(dt);
      this.updateIdolInteract(dt);
      this.updateIconInteract(dt);
      this.updatePortalInteract(dt);
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
  Object.assign(EditorScene.prototype, EnemyAiMixin, PlayerCombatMixin, DestructiblesMixin, PetMixin, SpawningMixin, TriggersMixin, InteractablesMixin, LevelFlowMixin, HudMixin, UiRuntimeMixin, ScreensMixin, SaveLoginMixin, NewbeeHubMixin, WorkshopMixin, DropsMixin, ProgressionMixin, EditorInputMixin, EditorCameraMixin, WorldRenderMixin, WorldOverlayMixin, MinimapMixin);

  return EditorScene;
}






