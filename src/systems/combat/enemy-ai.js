/**
 * 敌人 AI 混入模块（分类：战斗相关）
 *
 * 职责：敌人侧的每帧行为决策与运动解算——视野判定、朝玩家位移、
 * A* 寻路与路点跟随、碰撞回推、行为机分支（冲锋 / 环绕 / advanced2）、
 * 敌方子弹发射与死亡结算。
 *
 * 方法清单：
 *   viewRect / isInView                 —— 相机可视矩形与在视野内判定
 *   moveToward / stepToward             —— 直线逼近 / 有障碍时走寻路路径
 *   findEnemyPath / resolveEnemyCollision —— 网格寻路 / 世界边界与障碍回推
 *   stepEnemy / stepAdvanced2           —— 通用行为机 / advanced2 专属行为机
 *   fireEnemyBullet / defeatEnemy       —— 发射敌方子弹 / 击杀结算与掉落
 *   updateEnemyStuck                    —— 卡墙自毁（顶住障碍且无位移满时长 → 判定消灭）
 *
 * 通过 Object.assign(EditorScene.prototype, EnemyAiMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import Phaser from 'phaser';
import { CELL, ENEMY_BEHAVIOR, MOTHERSHIP_SPAWN_TABLE, HIT_FX_TTL, ENEMY_STUCK_KILL_MS, ENEMY_STUCK_WINDOW_MS, ENEMY_STUCK_WINDOW_MOVE_PX, ENEMY_STUCK_PUSH_EPS } from '../constants.js';
import { toCell, resolveCircleAgainstWalls, rayWallDistance, rayToBounds, pointInWall, pointSegmentDistance, mothershipBoundsR } from './geometry.js';
import { findPath, nearestWalkable } from '../../pathfinding.js';
import { ENEMY_TYPES, resolveEnemyStats } from '../../state.js';
// 原型机-2-5T5：仅为「敌人初始化时归一化 e.bossCfg」而 import（纯 JS，无 Phaser 依赖）
import { normalizeBoss25T5Config } from './boss25t5.js';
// 重装机兵：数据契约与激光/瞄准表现常量（纯 JS，无 Phaser 依赖）
import { HEAVY_MECH_LASER, normalizeHeavyMechConfig } from './heavy-mech.js';

// ── 本模块私有常量 ──
const PATH_REPATH_INTERVAL = 0.25;
const PATH_WAYPOINT_RADIUS = CELL * 0.4;
const ENEMY_BULLET_SPEED = 400;

// 朝目标角旋转（走最短弧；在 step 内无法到达时按 step 推进）
function rotateTowardAngle(cur, target, step) {
  const d = Phaser.Math.Angle.Wrap(target - cur);
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

// 轴向射线的单位方向（近零分量归零）：±π / ±π/2 处 sin/cos 会得到 ±1e-16，
// rayToBounds 在 dy<0 且 y0≈0 时会因此算出负距离（终点反向），先归零再求交。
function rayDir(ang) {
  return {
    dx: Math.abs(Math.cos(ang)) < 1e-9 ? 0 : Math.cos(ang),
    dy: Math.abs(Math.sin(ang)) < 1e-9 ? 0 : Math.sin(ang)
  };
}

// 射线从 (ox,oy) 沿 ang 出发到「首个墙体或世界边界」的长度（夹非负）
function aimRay(scene, ox, oy, ang, walls) {
  const { dx, dy } = rayDir(ang);
  const { w: ww, h: wh } = scene.worldSize();
  const len = Math.max(0, Math.min(
    rayWallDistance(ox, oy, dx, dy, walls),
    rayToBounds(ox, oy, dx, dy, ww, wh)
  ));
  return { dx, dy, len };
}

export const EnemyAiMixin = {
  // ── 视野判定 ──
    viewRect() {
      const cam = this.cameras.main;
      const halfW = cam.width / 2, halfH = cam.height / 2;
      return {
        x: cam.scrollX + halfW - halfW / cam.zoomX,
        y: cam.scrollY + halfH - halfH / cam.zoomY,
        w: cam.width / cam.zoomX,
        h: cam.height / cam.zoomY
      };
    },

    isInView(e) {
      const v = this.viewRect();
      return e.x >= v.x && e.x <= v.x + v.w && e.y >= v.y && e.y <= v.y + v.h;
    },

  // ── 基础位移与寻路 ──
    moveToward(e, speed, sec) {
      const ang = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y);
      e.x += Math.cos(ang) * speed * sec;
      e.y += Math.sin(ang) * speed * sec;
    },

    stepToward(e, speed, sec) {
      const p = this.player;
      if (this.hasLOS(e.x, e.y, p.x, p.y)) {
        e.path = null;
        this.moveToward(e, speed, sec);
        return;
      }

      speed *= 2;

      e.pathDirty = (e.pathDirty || 0) + sec;
      const moved = e.pathTargetX == null ? Infinity
        : Math.hypot(p.x - e.pathTargetX, p.y - e.pathTargetY);
      const needRepath = !e.path || e.pathIndex >= e.path.length
        || moved > CELL || e.pathDirty >= PATH_REPATH_INTERVAL;

      if (needRepath) {
        e.path = this.findEnemyPath(e);
        e.pathIndex = 0;
        e.pathDirty = 0;
        if (e.path) {
          e.pathTargetX = p.x;
          e.pathTargetY = p.y;
        }
      }

      if (e.path && e.pathIndex < e.path.length) {
        const cell = e.path[e.pathIndex];
        const wx = (cell.x + 0.5) * CELL, wy = (cell.y + 0.5) * CELL;
        const ang = Phaser.Math.Angle.Between(e.x, e.y, wx, wy);
        e.x += Math.cos(ang) * speed * sec;
        e.y += Math.sin(ang) * speed * sec;
        if (Math.hypot(e.x - wx, e.y - wy) < PATH_WAYPOINT_RADIUS) e.pathIndex++;
      } else {
        this.moveToward(e, speed, sec);
      }
    },

    findEnemyPath(e) {
      const grid = this.grid;
      if (!grid) return null;
      const start = toCell(e.x, e.y);
      let goal = toCell(this.player.x, this.player.y);
      if (grid.blocked[goal.y]?.[goal.x]) {
        const alt = nearestWalkable(grid, goal.x, goal.y);
        if (!alt) return null;
        goal = alt;
      }
      return findPath(grid, start.x, start.y, goal.x, goal.y);
    },

    resolveEnemyCollision(e) {
      const { w: ww, h: wh } = this.worldSize();
      const r = e.r;
      e.x = Phaser.Math.Clamp(e.x, r, ww - r);
      e.y = Phaser.Math.Clamp(e.y, r, wh - r);
      this.resolveMovementCollision(e, r);
    },

  // ── 每帧行为机 ──
    stepEnemy(e, dt) {
      if (!e.alive) return;
      const b = ENEMY_BEHAVIOR[e.type] || ENEMY_BEHAVIOR.basic1;
      const sec = dt / 1000;
      const p = this.player;

      if (e.frozen) {
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        e.red = dist < b.colorRange;
        return;
      }

      if (e.type === 'mothership') {
        this.stepMothership(e, dt, b, sec);
        return;
      }

      // 原型机-2-5T5：专属状态机（内部自持 bossActive 待机判定，不走通用行为机）
      if (e.type === 'boss-2-5t5') {
        this.stepBoss25T5(e, dt, b, sec);
        return;
      }

      // 重装机兵：专属状态机（头部追踪 + 瞄准-停顿-激光，不走通用行为机）
      if (e.type === 'heavy-mech') {
        this.stepHeavyMech(e, dt, sec);
        return;
      }

      if (e.type === 'advanced2') {
        this.stepAdvanced2(e, dt, b, sec);
        return;
      }

      if (!this.isInView(e)) {
        e.viewTimer = 0;
        e.engaged = false;
      } else {
        if (!e.enteredView) {
          e.enteredView = true;
          if (b.onEnterOrbit) {
            const o = b.onEnterOrbit;
            const dur = (o.minDur + Math.random() * (o.maxDur - o.minDur)) * 1000;
            const deg = o.minDeg + Math.random() * (o.maxDeg - o.minDeg);
            e.orbitEnter = { t: 0, dur, deg: deg * e.orbitDir };
          }
        }
        e.viewTimer += sec;
        if (!e.engaged && e.viewTimer >= b.engageDelay) e.engaged = true;
      }

      const dist = Math.hypot(e.x - p.x, e.y - p.y);
      e.red = dist < b.colorRange;
      e.spin1 += b.spin * sec;
      e.spin2 -= b.spin * sec;

      if (e.orbitEnter && e.orbitEnter.t < e.orbitEnter.dur) {
        e.orbitEnter.t += dt;
        const ang = Phaser.Math.Angle.Between(p.x, p.y, e.x, e.y);
        const rad = Math.hypot(e.x - p.x, e.y - p.y);
        const newAng = ang + Phaser.Math.DegToRad(e.orbitEnter.deg) * sec;
        e.x = p.x + Math.cos(newAng) * rad;
        e.y = p.y + Math.sin(newAng) * rad;
        return;
      }

      if (b.charge && !e.chargeTriggered && dist < b.colorRange) {
        e.chargeTriggered = true;
        e.phase = 'pause';
        e.phaseTimer = 0;
      }

      if (b.charge && e.chargeTriggered) {
        if (e.phase === 'pause') {
          e.phaseTimer += sec;
          if (e.phaseTimer >= b.charge.pause) {
            e.phase = 'charge';
            e.phaseTimer = 0;
          }
        } else if (e.phase === 'charge') {
          this.moveToward(e, b.charge.speed, sec);
        }
      } else if (b.orbit) {
        e.orbitTimer += sec;
        if (e.orbitTimer >= b.orbit.period) e.orbitTimer -= b.orbit.period;
        if (e.orbitTimer < b.orbit.duration) {
          const ang = Phaser.Math.Angle.Between(p.x, p.y, e.x, e.y);
          const rad = Math.hypot(e.x - p.x, e.y - p.y);
          const newAng = ang + Phaser.Math.DegToRad(b.orbit.degPerSec) * e.orbitDir * sec;
          e.x = p.x + Math.cos(newAng) * rad;
          e.y = p.y + Math.sin(newAng) * rad;
        } else {
          this.stepToward(e, e.engaged ? b.engage : b.approach, sec);
        }
      } else {
        this.stepToward(e, e.engaged ? b.engage : b.approach, sec);
      }
    },

    stepAdvanced2(e, dt, b, sec) {
      const p = this.player;
      const dist = Math.hypot(e.x - p.x, e.y - p.y);

      if (!e.aggressive) {
        if (dist < (e.attackRange ?? b.attackRange)) {
          e.aggressive = true;
          e.orbitRadius = b.orbitMin ?? 30;
          e.activateT = 0;
        } else {
          e.orbitAngle += Phaser.Math.DegToRad(b.dormantSpin) * sec;
          e.red = false;
          return;
        }
      }

      e.activateT = (e.activateT || 0) + sec;
      const grow = Math.min(1, e.activateT / (b.growDuration || 0.5));
      e.orbitRadius = (b.orbitMin ?? 30) + ((b.orbitMax ?? 40) - (b.orbitMin ?? 30)) * grow;
      e.orbitAngle = Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y);
      e.red = true;

      const ang = Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y);
      if (dist < (e.attackRange ?? b.attackRange)) {
        e.x -= Math.cos(ang) * b.speed * sec;
        e.y -= Math.sin(ang) * b.speed * sec;
      } else {
        e.wanderT = (e.wanderT || 0) + sec;
        if (e.wanderT >= 1) {
          e.wanderT = 0;
          e.wanderDir = Math.random() < 0.5 ? -1 : 1;
        }
        const tang = ang + (e.wanderDir || 1) * Math.PI / 2;
        e.x += Math.cos(tang) * b.speed * sec;
        e.y += Math.sin(tang) * b.speed * sec;
      }

      e.burstTimer -= dt;
      e.fireClock -= dt;
      if (e.burstTimer <= 0) {
        if (e.fireClock <= 0) {
          this.fireEnemyBullet(e, b);
          e.burstShots = (e.burstShots || 0) + 1;
          if (e.burstShots >= (b.burstCount || 3)) {
            e.burstShots = 0;
            e.burstTimer = b.burstInterval || 3000;
          } else {
            e.fireClock = b.fireInterval || 400;
          }
        }
      }
    },

  // ── 母舰 ──
    stepMothership(e, dt, b, sec) {
      if (e.hitFlashT > 0) e.hitFlashT = Math.max(0, e.hitFlashT - dt);
      if (!e.bossActive) return;   // 待机：未激活不移动、不召唤
      const ang = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y);
      e.x += Math.cos(ang) * b.speed * sec;
      e.y += Math.sin(ang) * b.speed * sec;
      e.spawnClock = (e.spawnClock || 0) + dt;
      if (e.spawnClock >= e.boss.spawnInterval) {
        e.spawnClock = 0;
        this.spawnMothershipMinions(e);
      }
    },

    spawnMothershipMinions(e) {
      const table = (e.boss?.spawnTable && e.boss.spawnTable.length) ? e.boss.spawnTable : MOTHERSHIP_SPAWN_TABLE;
      const pick = table[Math.floor(Math.random() * table.length)];
      const r = mothershipBoundsR(e);   // 围绕可见本体（风筝形包围半径）投放，非小圆
      for (let i = 0; i < pick.count; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = r * (0.6 + Math.random() * 0.9);
        const x = e.x + Math.cos(a) * d;
        const y = e.y + Math.sin(a) * d;
        let p = this.canSpawnAt(x, y, pick.type) ? { x, y } : null;
        if (!p) p = this.findClearSpawnNearPlayer(pick.type);
        if (p) this.enemies.push(this.initEnemy({ x: p.x, y: p.y, type: pick.type, triggerId: e.triggerId || null }));
      }
    },

    mothershipSelfDestruct(e) {
      if (!e.alive) return;
      this.defeatEnemy(e);
      this.hitEffects.push({ x: e.x, y: e.y, ttl: HIT_FX_TTL });
    },

  // ── 重装机兵（远程激光）──
    // 头部朝向 + 射击状态机：wait（冷却 / 朝玩家逼近）→ aim（瞄准线收拢）→ align（方向锁定 + 停顿）→ 发射激光
    // 瞄准与发射期间原地不动；方向在「夹角收成一条线」的瞬间锁定，停顿期即为玩家的躲避窗口。
    stepHeavyMech(e, dt, sec) {
      if (e.hitFlashT > 0) e.hitFlashT = Math.max(0, e.hitFlashT - dt);
      const p = this.player;
      if (!p) return;
      const cfg = e.mechCfg || (e.mechCfg = normalizeHeavyMechConfig(e.mech));
      // 生成时头部（设计稿顶部的尖）朝向玩家：首帧按玩家方向初始化，之后按 rotateSpeed 追踪
      if (e.headAngle == null) e.headAngle = Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y);
      e.firePhase = e.firePhase || 'wait';
      e.fireTimer = e.fireTimer ?? cfg.fireInterval;
      e.aimSpreadDeg = e.aimSpreadDeg ?? 0;

      if (e.firePhase === 'align') {
        // 方向已锁定（收敛瞬间写入 aimAngle）：头部与瞄准线保持不动
        e.headAngle = e.aimAngle;
      } else {
        e.headAngle = rotateTowardAngle(
          e.headAngle,
          Phaser.Math.Angle.Between(e.x, e.y, p.x, p.y),
          Phaser.Math.DegToRad(cfg.rotateSpeed) * sec
        );
      }

      if (e.firePhase === 'wait') {
        this.stepToward(e, cfg.moveSpeed, sec);
        // 不在视野内不推进射击冷却：避免屏幕外无预警地放激光（进视野后才开始计时）
        if (!this.isInView(e)) return;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0) {
          e.firePhase = 'aim';
          e.aimSpreadDeg = HEAVY_MECH_LASER.spreadDeg;
        }
        return;
      }

      if (e.firePhase === 'aim') {
        e.aimSpreadDeg = Math.max(0, e.aimSpreadDeg - cfg.aimSpeed * sec);
        if (e.aimSpreadDeg <= 0) {
          e.firePhase = 'align';
          e.aimAngle = e.headAngle;
          e.fireTimer = cfg.fireDelay;
        }
        this.heavyMechUpdateSight(e);
        return;
      }

      e.fireTimer -= dt;
      if (e.fireTimer <= 0) {
        this.heavyMechFireLaser(e);
        e.firePhase = 'wait';
        e.fireTimer = cfg.fireInterval;
      } else {
        this.heavyMechUpdateSight(e);
      }
    },

    // 瞄准线的两条端点（无限长，只被墙体 / 关卡边界截断）：仅 aim/align 相位每帧重算，写 e.sightLines。
    // 与激光同为「射线到墙」口径（walls + bulletGateWalls + 上锁宝箱红环），区别只在目的：瞄准线不结算任何伤害。
    heavyMechUpdateSight(e) {
      const ctx = this.ctx;
      const s = e.artScale || 1;
      const head = e.headAngle ?? 0;
      const ox = e.x + Math.cos(head) * HEAVY_MECH_LASER.sightStart * s;
      const oy = e.y + Math.sin(head) * HEAVY_MECH_LASER.sightStart * s;
      const walls = [...ctx.state.level.walls, ...this.bulletGateWalls(), ...this.chestLockWalls()];
      const half = Phaser.Math.DegToRad((e.aimSpreadDeg ?? 0) / 2);
      e.sightLines = [head - half, head + half].map(a => {
        const { dx, dy, len } = aimRay(this, ox, oy, a, walls);
        return { x0: ox, y0: oy, x1: ox + dx * len, y1: oy + dy * len };
      });
    },

    // 发射激光：起止点在发射瞬间定死（起点 = 头顶尖前方 muzzleOffset，终点按墙裁剪），
    // 伤害单次结算（束宽取满宽）；之后光束只做「变粗 → 保持 → 变细消失」的表现推进。
    heavyMechFireLaser(e) {
      const ctx = this.ctx;
      const ang = e.aimAngle ?? e.headAngle ?? 0;
      const s = e.artScale || 1;
      const { dx, dy } = rayDir(ang);
      const ox = e.x + dx * HEAVY_MECH_LASER.muzzleOffset * s;
      const oy = e.y + dy * HEAVY_MECH_LASER.muzzleOffset * s;
      const walls = [...ctx.state.level.walls, ...this.bulletGateWalls(), ...this.chestLockWalls()];
      const { len } = aimRay(this, ox, oy, ang, walls);
      const x1 = ox + dx * len, y1 = oy + dy * len;
      const width = HEAVY_MECH_LASER.width * s;

      const p = this.player;
      if (p && pointSegmentDistance(p.x, p.y, ox, oy, x1, y1) < width / 2 + p.r) {
        this.damagePlayer(e.damage || 0);
      }

      this.enemyLasers = this.enemyLasers || [];
      this.enemyLasers.push({
        ownerId: e.id, x0: ox, y0: oy, x1, y1,
        t: 0, width: 0, maxWidth: width, color: HEAVY_MECH_LASER.color
      });
    },

    // 激光表现推进（每帧一次；无敌人存活时也要跑，光束自身带 ttl）
    updateEnemyLasers(dt) {
      const list = this.enemyLasers;
      if (!list || !list.length) return;
      const { growMs, holdMs, fadeMs } = HEAVY_MECH_LASER;
      const total = growMs + holdMs + fadeMs;
      this.enemyLasers = list.filter(bs => {
        bs.t += dt;
        if (bs.t >= total) return false;
        if (bs.t < growMs) bs.width = bs.maxWidth * (bs.t / growMs);
        else if (bs.t < growMs + holdMs) bs.width = bs.maxWidth;
        else bs.width = bs.maxWidth * (1 - (bs.t - growMs - holdMs) / fadeMs);
        return true;
      });
    },

  // ── 开火与死亡 ──
    fireEnemyBullet(e, b) {
      const bx = e.x + Math.cos(e.orbitAngle) * e.orbitRadius;
      const by = e.y + Math.sin(e.orbitAngle) * e.orbitRadius;
      const ang = Phaser.Math.Angle.Between(bx, by, this.player.x, this.player.y);
      this.enemyBullets.push({
        x: bx,
        y: by,
        vx: Math.cos(ang) * ENEMY_BULLET_SPEED,
        vy: Math.sin(ang) * ENEMY_BULLET_SPEED,
        damage: e.damage || 10,
        dist: 0,
        trailLen: 75
      });
    },

    defeatEnemy(e) {
      const ctx = this.ctx;
      if (!e.alive) return;
      e.alive = false;
      this.kills++;
      this.killTally = this.killTally || {};
      this.killTally[e.type] = (this.killTally[e.type] || 0) + 1;
      this.spawnDrops(e);
      // BOSS 被击败 → 播放其绑定的运镜，镜头锁定到 BOSS 死亡位置（opts.x/y 优先于 focusTarget）
      // 母舰取 e.cutsceneId，原型机-2-5T5 取 e.bossCfg.cutsceneId（两条都要保留）
      const bossCutsceneId = e.type === 'boss-2-5t5'
        ? (e.bossCfg?.cutsceneId || e.cutsceneId)   // 面板写 boss.*；手写关卡顶层也能生效
        : e.cutsceneId;
      if ((e.type === 'mothership' || e.type === 'boss-2-5t5') && e.bossActive && bossCutsceneId) {
        const clip = ctx?.state?.level?.cinematics?.find(c => c.id === bossCutsceneId);
        if (clip) {
          this.cameras.main.flash(120, 255, 255, 255);   // 击杀白闪增强冲击
          // 玩家死亡运镜优先：此时若被 BOSS 击破运镜顶替，playerDeathFlow 会卡在 cinematic 阶段（playCutscene 覆盖时不回调旧 onComplete）→ 结算页永不出现。
          if (!this.playerDeathFlow) this.playCutscene(clip, { focusTarget: 'boss', x: e.x, y: e.y });
        }
      }
      // 原型机-2-5T5 死亡：清掉它护盾拦截后停驻在场上的红子弹。
      // 注意：defeatEnemy 通常在子弹 filter 内部被调用，此时 `this.bullets = ...` 的重赋值会被
      // 外层 filter 的返回值覆盖 —— 故同时把这些弹标记 dead，保证下一帧 filter 一定移除它们。
      if (e.type === 'boss-2-5t5') {
        for (const x of (this.bullets || [])) if (x.blockedBy === e.id) x.dead = true;
        this.bullets = (this.bullets || []).filter(x => x.blockedBy !== e.id);
        // 死亡后 boss25t5ZonesTick 不再被调用（敌人循环 `if (!e.alive) continue`），技能区域会永久定格
        // （黑mask/紫色区不消失）；同时清掉残留的玩家拖拽/击退位移与减速标记。
        e.zones = [];
        e.skill4Fx = null;
        // 技能5「蓝色漩涡」是场景级实体（this.boss25t5Vortices），BOSS 死亡必须清掉，
        // 否则漩涡会永久留场、继续吸子弹/伤玩家（同时清掉玩家吸力，避免残留位移）。
        this.boss25t5ClearVortices();
        if (this.player) {
          if (this.player.boss25t5Force?.ownerId === e.id) this.player.boss25t5Force = null;
          this.player.boss25t5Slow = false;
        }
      }
      // 重装机兵死亡：清掉它发射后仍在表现中的激光（避免死亡后光束继续渐细残留）
      if (e.type === 'heavy-mech' && this.enemyLasers?.length) {
        this.enemyLasers = this.enemyLasers.filter(bs => bs.ownerId !== e.id);
      }
    },

  // ── 回填：敌人初始化 / 位移碰撞回推 / 视线判定 ──
    initEnemy(e) {
    const ctx = this.ctx;
      // 触发器波次召唤的敌人：数值三层回落（波次 > 关卡兜底 enemyDefaults > 全局默认）。
      // wave 仅用于取数值，不留在运行时敌人对象上（故从 e 里剥掉）。
      const { wave, ...spawn } = e;
      const def = ENEMY_TYPES[e.type] || ENEMY_TYPES.basic1;
      const b = ENEMY_BEHAVIOR[e.type] || ENEMY_BEHAVIOR.basic1;
      const player = ctx.state.level.spawn;
      const stats = wave ? resolveEnemyStats(ctx.state.level, e.type, wave) : null;
      // 尺寸倍率：美术（artScale）与碰撞半径（r）等比缩放
      const scale = stats?.scale ?? 1;
      return {
        ...spawn,
        r: (b.size / 2) * scale,
        alive: true,
        hp: stats?.hp ?? e.hp ?? def.hp,
        maxHp: stats?.hp ?? e.hp ?? def.hp,
        art: def.art ?? e.art,
        artScale: (def.artScale ?? e.artScale ?? 1) * scale,
        spawnClock: 0,
        hitFlashT: 0,
        stuckMs: 0,            // 卡墙累计时长（updateEnemyStuck 维护，达到阈值判定消灭）
        stuckT: 0,             // 当前评估窗口已累计时长
        stuckPush: false,      // 当前窗口内是否顶过障碍
        stuckRefX: e.x,        // 当前窗口起点位置（算净位移）
        stuckRefY: e.y,
        pushBack: 0,           // 上一帧碰撞解算推回量（>0 = 顶住障碍）
        damage: stats?.damage ?? e.damage ?? def.damage,
        attackRange: e.attackRange ?? b.attackRange,
        viewTimer: 0,
        engaged: false,
        enteredView: false,
        orbitEnter: null,
        orbitTimer: b.orbit ? Math.random() * b.orbit.period : 0,
        orbitDir: Math.random() < 0.5 ? -1 : 1,
        spin1: 0,
        spin2: 0,
        red: false,
        chargeTriggered: false,
        phase: 'approach',
        phaseTimer: 0,
        angle: Phaser.Math.Angle.Between(e.x, e.y, player.x, player.y),
        path: null,
        pathIndex: 0,
        pathDirty: 0,
        pathTargetX: null,
        pathTargetY: null,
        orbitAngle: Math.random() * Math.PI * 2,
        orbitRadius: b.orbitMin ?? 30,
        aggressive: false,
        fireClock: 0,
        burstTimer: 0,
        burstShots: 0,
        wanderDir: Math.random() < 0.5 ? -1 : 1,
        wanderT: 0,
        ...(e.type === 'mothership' ? {
          bossActive: false,
          boss: {
            spawnInterval: (e.boss?.spawnInterval > 0 ? e.boss.spawnInterval : (ENEMY_BEHAVIOR.mothership?.spawnInterval || 5000)),
            spawnTable: (Array.isArray(e.boss?.spawnTable) && e.boss.spawnTable.length ? e.boss.spawnTable : MOTHERSHIP_SPAWN_TABLE),
            name: (e.boss?.name || '母舰')
          }
        } : {}),
        // 原型机-2-5T5：契约字段全部显式初始化（键名与 boss25t5.js 的 `??=` 兜底一一对应，
        // 使状态机首帧即拿到完整字段，不依赖 `??=`）。artScale 仍走上方既有 `def.artScale ?? e.artScale ?? 1`。
        ...(e.type === 'boss-2-5t5' ? {
          bossActive: false,
          bossCfg: normalizeBoss25T5Config(e.boss),
          shieldAlpha: 1,
          shieldDown: false,
          shieldDownT: 0,
          state: 'move',
          moveKind: 0,
          moveT: 0,
          moveDur: 0,
          moveDir: 1,
          moveWait: 0,        // 移动前/后等待期剩余毫秒（护盾保持存在的可攻击窗口）
          moveDone: false,    // 位移是否已走完（走完后进入后置等待）
          arc4Phase: 0,       // 圆弧4 自转相位（等待期被转到「本次技能目标角」）
          arc4OffsetDeg: 0,   // 圆弧4 目标角（相对瞄准方向，度；0 = 对准玩家）
          arc5OffsetDeg: 0,   // 圆弧5 目标角（同上）
          arc5Phase: 0,
          skillKind: 0,
          skillPhase: 'idle',
          skillT: 0,
          skill4Cooldown: 0,
          zones: [],
          activeZoneId: null
        } : {}),
        // 重装机兵：契约字段显式初始化（与 stepHeavyMech 的 `??=` 兜底一一对应）。
        // headAngle / fireTimer = null → 首帧分别取「玩家方向」与配置的射击间隔；
        // sightLines 由 heavyMechUpdateSight 在 aim/align 相位每帧重算（无限长瞄准线，仅被墙截断）。
        ...(e.type === 'heavy-mech' ? {
          mechCfg: normalizeHeavyMechConfig(e.mech),
          headAngle: null,
          firePhase: 'wait',
          fireTimer: null,
          aimSpreadDeg: 0,
          aimAngle: 0,
          sightLines: null
        } : {})
      };
    },

    resolveMovementCollision(entity, r) {
    const ctx = this.ctx;
      const l = ctx.state.level;
      const bx = entity.x, by = entity.y;   // 解算前位置（末尾算 pushBack 用）
      resolveCircleAgainstWalls(entity, r, l.walls);

      const gateWalls = this.activeGateWalls();
      if (gateWalls.length) resolveCircleAgainstWalls(entity, r, gateWalls);

      const vendors = this.editing ? (l.vendors || []) : (this.vendors || []);
      const vendorWalls = vendors
        .filter(v => v.visible !== false)
        .map(v => ({ x: v.x, y: v.y, w: v.w, h: v.h, shape: 'rect', rotation: 0 }));
      if (vendorWalls.length) resolveCircleAgainstWalls(entity, r, vendorWalls);

      const campfires = this.editing ? (l.campfires || []) : (this.campfires || []);
      const campfireWalls = campfires
        .filter(v => v.visible !== false)
        .map(v => ({ x: v.x, y: v.y, w: v.w, h: v.h, shape: 'rect', rotation: 0 }));
      if (campfireWalls.length) resolveCircleAgainstWalls(entity, r, campfireWalls);

      // 上锁宝箱的红色圆环（圆形墙）：挡玩家与敌人移动；解锁后该列表为空
      const chestLockWalls = this.chestLockWalls ? this.chestLockWalls() : [];
      if (chestLockWalls.length) resolveCircleAgainstWalls(entity, r, chestLockWalls);

      const idols = this.editing ? (l.idols || []) : (this.idols || []);
      const idolWalls = idols
        .filter(v => v.visible !== false)
        .map(v => ({ x: v.x, y: v.y, w: Math.min(v.w, v.h), thickness: 0, shape: 'circle' }));
      if (idolWalls.length) resolveCircleAgainstWalls(entity, r, idolWalls);

      const crates = this.editing ? (l.crates || []) : this.crates.filter(c => c.alive);
      resolveCircleAgainstWalls(entity, r, crates);

      const barrels = this.editing ? (l.barrels || []) : this.barrels.filter(b => b.alive);
      for (const b of barrels) {
        const dx = entity.x - b.x, dy = entity.y - b.y;
        const dist = Math.hypot(dx, dy);
        const min = r + b.r;
        if (dist < min) {
          if (dist > 0.001) {
            entity.x = b.x + dx / dist * min;
            entity.y = b.y + dy / dist * min;
          } else {
            entity.x = b.x + min;
          }
        }
      }

      // 本帧碰撞解算把实体推回了多少（px）：>0 说明实体在「顶住障碍」，供 updateEnemyStuck 判定卡墙
      entity.pushBack = Math.hypot(entity.x - bx, entity.y - by);
    },

    // 卡墙自毁：连续 ENEMY_STUCK_KILL_MS 都「顶住障碍且这一窗口内几乎没净位移」→ 判定消灭。
    // 只对常规怪物生效（母舰 / 原型机-2-5T5 是关卡手摆的 BOSS，defeatEnemy 会触发击破运镜，不能自动杀）；
    // 原地待机（advanced2 未激活的休眠自转、charge 停顿期）不顶障碍（pushBack≈0）不会累计，沿墙滑动的怪
    // 一个窗口内净位移远超阈值也不会累计，避免误杀。由 game-scene.js 敌人循环每帧在 resolveEnemyCollision 之后调用。
    updateEnemyStuck(e, dt) {
      if (!e.alive) return;
      const pushBack = e.pushBack || 0;
      e.pushBack = 0;
      if (e.frozen || e.type === 'mothership' || e.type === 'boss-2-5t5') {
        e.stuckMs = 0; e.stuckT = 0; e.stuckPush = false;
        e.stuckRefX = e.x; e.stuckRefY = e.y;
        return;
      }
      e.stuckT = (e.stuckT || 0) + dt;
      if (pushBack > ENEMY_STUCK_PUSH_EPS) e.stuckPush = true;
      if (e.stuckT < ENEMY_STUCK_WINDOW_MS) return;
      const moved = Math.hypot(e.x - (e.stuckRefX ?? e.x), e.y - (e.stuckRefY ?? e.y));
      e.stuckMs = (e.stuckPush && moved < ENEMY_STUCK_WINDOW_MOVE_PX) ? (e.stuckMs || 0) + e.stuckT : 0;
      e.stuckT = 0;
      e.stuckPush = false;
      e.stuckRefX = e.x;
      e.stuckRefY = e.y;
      if (e.stuckMs >= ENEMY_STUCK_KILL_MS) {
        e.stuckMs = 0;
        this.defeatEnemy(e);
      }
    },

    hasLOS(x0, y0, x1, y1) {
    const ctx = this.ctx;
      const dx = x1 - x0, dy = y1 - y0;
      const walls = ctx.state.level.walls;
      // 门若包含任一端点（玩家刚走过的门还没被推开/正卡在门体积内），该门不算隔断视线，
      // 否则端点贴门时会产生「整片区域都被门挡住」的伪遮挡 → 触发 inscreen 第一波生成 0 只
      const gateWalls = this.activeGateWalls().filter(g => !pointInWall(g, x0, y0) && !pointInWall(g, x1, y1));
      return rayWallDistance(x0, y0, dx, dy, walls) > 1
        && rayWallDistance(x0, y0, dx, dy, gateWalls) > 1;
    },
};
