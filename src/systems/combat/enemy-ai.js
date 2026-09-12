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
 *
 * 通过 Object.assign(EditorScene.prototype, EnemyAiMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import Phaser from 'phaser';
import { CELL, ENEMY_BEHAVIOR, MOTHERSHIP_SPAWN_TABLE, HIT_FX_TTL } from '../constants.js';
import { toCell, resolveCircleAgainstWalls, rayWallDistance, pointInWall, mothershipBoundsR } from './geometry.js';
import { findPath, nearestWalkable } from '../../pathfinding.js';
import { ENEMY_TYPES } from '../../state.js';
// 原型机-2-5T5：仅为「敌人初始化时归一化 e.bossCfg」而 import（纯 JS，无 Phaser 依赖）
import { normalizeBoss25T5Config } from './boss25t5.js';

// ── 本模块私有常量 ──
const PATH_REPATH_INTERVAL = 0.25;
const PATH_WAYPOINT_RADIUS = CELL * 0.4;
const ENEMY_BULLET_SPEED = 400;

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
          this.playCutscene(clip, { focusTarget: 'boss', x: e.x, y: e.y });
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
    },

  // ── 回填：敌人初始化 / 位移碰撞回推 / 视线判定 ──
    initEnemy(e) {
    const ctx = this.ctx;
      const def = ENEMY_TYPES[e.type] || ENEMY_TYPES.basic1;
      const b = ENEMY_BEHAVIOR[e.type] || ENEMY_BEHAVIOR.basic1;
      const player = ctx.state.level.spawn;
      return {
        ...e,
        r: b.size / 2,
        alive: true,
        hp: e.hp ?? def.hp,
        maxHp: e.hp ?? def.hp,
        art: def.art ?? e.art,
        artScale: def.artScale ?? e.artScale ?? 1,
        spawnClock: 0,
        hitFlashT: 0,
        damage: e.damage ?? def.damage,
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
        } : {})
      };
    },

    resolveMovementCollision(entity, r) {
    const ctx = this.ctx;
      const l = ctx.state.level;
      resolveCircleAgainstWalls(entity, r, l.walls);

      const gateWalls = this.activeGateWalls();
      if (gateWalls.length) resolveCircleAgainstWalls(entity, r, gateWalls);

      const vendors = this.editing ? (l.vendors || []) : (this.vendors || []);
      const vendorWalls = vendors
        .filter(v => v.visible !== false)
        .map(v => ({ x: v.x, y: v.y, w: v.w, h: v.h, shape: 'rect', rotation: 0 }));
      if (vendorWalls.length) resolveCircleAgainstWalls(entity, r, vendorWalls);

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
