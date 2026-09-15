/**
 * 敌人生成混入模块（分类：关卡设计）
 *
 * 职责：关卡内敌人生成点的求解与生成动效——屏幕外环形取点、
 * 可达性 / 安全性校验、玩家附近兜底搜点、多边形/圆形召唤阵与
 * 四角锁定框的推进与绘制。
 *
 * 方法清单：
 *   sampleRingPoint / spawnOffscreen                  —— 视口外环取点 / 屏幕外批量生成
 *   isReachableWalkable / nearestReachablePoint       —— 可站立且可寻路判定 / 附近可达点兜底
 *   canSpawnAt / findClearSpawnNearPlayer             —— 生成点安全校验 / 玩家附近螺旋找点
 *   spawnNewbeeEnemies / spawnAdvanced2AtTopRight     —— 新手关三角阵 / 视口右上进阶敌人2
 *   createSpawnEffect / spawnEnemyAt / spawnAtVertex  —— 召唤阵入队 / 落地生成 / 顶点分配
 *   updateSpawnEffects / drawSpawnEffects             —— 召唤阵推进 / 绘制
 *   updateLockEffects / drawLockEffects               —— 锁定框推进 / 绘制
 *
 * 通过 Object.assign(EditorScene.prototype, SpawningMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import Phaser from 'phaser';
import { CELL, ENEMY_BEHAVIOR } from '../constants.js';
import { toCell } from '../combat/geometry.js';
import { findPath, nearestWalkable } from '../../pathfinding.js';
import { ENEMY_TYPES, resolveEnemyStats } from '../../state.js';

// ── 本模块私有常量 ──
const SPAWN_OFFSCREEN_PX = 10;
const NEWBEE_TRIANGLE_RADIUS = 500;    // 新手关阶段3三角形生成半径
const ENEMY_EDGE_MARGIN = 60;          // 敌人生成距世界边界的最小边距

// 波次召唤敌人的尺寸倍率（波次 > 关卡兜底 > 1）：生成点校验与碰撞半径共用
function waveScale(level, type, wave) {
  return wave ? (resolveEnemyStats(level, type, wave).scale ?? 1) : 1;
}

export const SpawningMixin = {
  // ── 生成点求解 ──
    sampleRingPoint(v, off, ww, wh) {
      const minX = v.x - off, maxX = v.x + v.w + off;
      const minY = v.y - off, maxY = v.y + v.h + off;
      const edge = Math.floor(Math.random() * 4);
      let x, y;
      if (edge === 0) { y = minY; x = minX + Math.random() * (maxX - minX); }
      else if (edge === 1) { y = maxY; x = minX + Math.random() * (maxX - minX); }
      else if (edge === 2) { x = minX; y = minY + Math.random() * (maxY - minY); }
      else { x = maxX; y = minY + Math.random() * (maxY - minY); }
      return { x: Phaser.Math.Clamp(x, 0, ww), y: Phaser.Math.Clamp(y, 0, wh) };
    },

    spawnOffscreen(t, wave) {
      const ctx = this.ctx;
      const type = wave?.enemyType || 'basic1';
      const count = Math.max(1, Number(wave?.count) || 1);
      const scale = waveScale(ctx.state.level, type, wave);
      // 母舰：体型巨大，走专用生成（含保证生成兜底），防止视口外环找不到点导致波次空转
      if (type === 'mothership') {
        for (let i = 0; i < count; i++) this.spawnMothership(t, wave);
        return;
      }
      const v = this.viewRect();
      const baseOff = SPAWN_OFFSCREEN_PX / this.cameras.main.zoomX;
      const { w: ww, h: wh } = this.worldSize();

      for (let i = 0; i < count; i++) {
        let p = null;
        // 随机更换位置，直到找到与玩家连线无障碍的屏幕外点
        for (let attempt = 0; attempt < 60 && !p; attempt++) {
          const off = baseOff * (1 + Math.floor(attempt / 12));
          const c = this.sampleRingPoint(v, off, ww, wh);
          if (this.canSpawnAt(c.x, c.y, type, 0, scale)) p = c;
        }
        if (!p) p = this.findClearSpawnNearPlayer(type, scale);
        if (!p) continue;

        this.enemies.push(this.initEnemy({ x: p.x, y: p.y, type, triggerId: t.id, wave }));
      }
    },

    // 母舰专用生成：整圆不穿墙的视口外点极难命中，逐档放宽兜底，保证产出一只
    spawnMothership(t, wave) {
      const ctx = this.ctx;
      const v = this.viewRect();
      const baseOff = SPAWN_OFFSCREEN_PX / this.cameras.main.zoomX;
      const { w: ww, h: wh } = this.worldSize();
      const type = 'mothership';
      const b = ENEMY_BEHAVIOR[type] || ENEMY_BEHAVIOR.basic1;
      const r = b.size / 2;
      const scale = waveScale(ctx.state.level, type, wave);

      // 第一轮：严格校验（整圆不穿墙 + 与玩家连线），视口外环最多 60 次外扩
      let p = null;
      for (let attempt = 0; attempt < 60 && !p; attempt++) {
        const off = baseOff * (1 + Math.floor(attempt / 12));
        const c = this.sampleRingPoint(v, off, ww, wh);
        if (this.canSpawnAt(c.x, c.y, type, 0, scale)) p = c;
      }
      if (p) {
        this.enemies.push(this.initEnemy({ x: p.x, y: p.y, type, triggerId: t.id, wave }));
        return;
      }

      // 第二轮：放宽为仅圆心可站立 + 与玩家连线通畅（进入视野可达、不卡死）
      for (let attempt = 0; attempt < 120 && !p; attempt++) {
        const off = baseOff * (1 + Math.floor(attempt / 12));
        const c = this.sampleRingPoint(v, off, ww, wh);
        if (this.pointInWall(c.x, c.y)) continue;
        if (!this.hasLOS(c.x, c.y, this.player.x, this.player.y)) continue;
        p = c;
      }

      // 第三轮兜底：一个可达开放格，保证 push 一只母舰，绝不让波次空转
      if (!p) p = this.nearestReachablePoint(this.player.x, this.player.y, CELL * 12);

      this.enemies.push(this.initEnemy({ x: p.x, y: p.y, type, triggerId: t.id, wave }));
    },

  // ── 可达性与安全校验 ──
    // 判断世界坐标是否可站立且能寻路到玩家
    isReachableWalkable(x, y) {
      const { w: ww, h: wh } = this.worldSize();
      if (x < 0 || y < 0 || x > ww || y > wh) return false;
      if (this.pointInWall(x, y)) return false;
      const grid = this.grid;
      if (!grid) return true;
      const start = toCell(x, y);
      if (grid.blocked[start.y]?.[start.x]) return false;
      let goal = toCell(this.player.x, this.player.y);
      if (grid.blocked[goal.y]?.[goal.x]) {
        const alt = nearestWalkable(grid, goal.x, goal.y);
        if (!alt) return true;
        goal = alt;
      }
      return !!findPath(grid, start.x, start.y, goal.x, goal.y);
    },

    // 在玩家附近找一块可站立且可寻路的位置（用于封闭墙体内侧兜底）
    nearestReachablePoint(cx, cy, maxRadius) {
      const grid = this.grid;
      const r = grid ? Math.ceil((maxRadius || CELL * 6) / CELL) : 6;
      const startCell = toCell(cx, cy);
      if (!grid) return { x: cx, y: cy };
      for (let ring = 0; ring <= r; ring++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dx = -ring; dx <= ring; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            const cxx = startCell.x + dx, cyy = startCell.y + dy;
            if (cxx < 0 || cyy < 0 || cxx >= grid.gw || cyy >= grid.gh) continue;
            if (grid.blocked[cyy][cxx]) continue;
            const wx = (cxx + 0.5) * CELL, wy = (cyy + 0.5) * CELL;
            if (this.pointInWall(wx, wy)) continue;
            return { x: wx, y: wy };
          }
        }
      }
      return { x: cx, y: cy };
    },

    // 生成点是否安全：世界边界内、不在墙内、与玩家连线无障碍（可被击杀）、可选最小玩家距离
    // scale = 尺寸倍率（波次/关卡兜底生效后的碰撞半径等比放大，留白同口径）
    canSpawnAt(x, y, enemyType = 'basic1', minPlayerDist = 0, scale = 1) {
      const b = ENEMY_BEHAVIOR[enemyType] || ENEMY_BEHAVIOR.basic1;
      // 母舰 Hitbox 与画板本体一致：生成点留白用其风筝形包围半径（设计尖端 180 × artScale）
      const r = (enemyType === 'mothership'
        ? 180 * ((ENEMY_TYPES.mothership && ENEMY_TYPES.mothership.artScale) || 1)
        : b.size / 2) * scale;
      const { w: ww, h: wh } = this.worldSize();
      if (x < r || y < r || x > ww - r || y > wh - r) return false;
      if (this.pointInWall(x, y)) return false;
      // 整圆穿墙排除：防止大体积敌人（母舰）身体裁剪进墙/地图外
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        if (this.pointInWall(x + Math.cos(a) * r, y + Math.sin(a) * r)) return false;
      }
      if (minPlayerDist > 0 && Math.hypot(x - this.player.x, y - this.player.y) < minPlayerDist) return false;
      return this.hasLOS(x, y, this.player.x, this.player.y);
    },

    // 玩家附近螺旋找一个连线无障碍的生成点（多边形全顶点被挡时的兜底）
    findClearSpawnNearPlayer(enemyType = 'basic1', scale = 1) {
      const b = ENEMY_BEHAVIOR[enemyType] || ENEMY_BEHAVIOR.basic1;
      const r = (b.size / 2) * scale;
      for (let ring = 1; ring <= 8; ring++) {
        const samples = ring * 8;
        for (let a = 0; a < samples; a++) {
          const ang = (a / samples) * Math.PI * 2;
          const dist = ring * (r + 40);
          const x = this.player.x + Math.cos(ang) * dist;
          const y = this.player.y + Math.sin(ang) * dist;
          if (this.canSpawnAt(x, y, enemyType, 0, scale)) return { x, y };
        }
      }
      return null;
    },

    // 新手关：套用触发器多边形生成（以玩家为中心，三角形，半径 500）
    spawnNewbeeEnemies(count, enemyType) {
      this.createSpawnEffect(null, {
        shape: 'polygon',
        sides: count,
        radius: NEWBEE_TRIANGLE_RADIUS,
        thickness: 5,          // 边框粗细 5px
        drawDuration: 800,     // 生成动画 800ms
        fadeDuration: 800,     // 消失动画 800ms
        enemyType: enemyType || 'basic1'
      });
      this.nb?.enemies && (this.nb.enemies = this.enemies.slice());
    },

    // 视口右上方生成进阶敌人2（需与玩家连线无障碍，否则玩家打不到）
    spawnAdvanced2AtTopRight() {
      const v = this.viewRect();
      const { w: ww, h: wh } = this.worldSize();
      const x = Phaser.Math.Clamp(v.x + v.w - 120, ENEMY_EDGE_MARGIN, ww - ENEMY_EDGE_MARGIN);
      const y = Phaser.Math.Clamp(v.y + 150, ENEMY_EDGE_MARGIN, wh - ENEMY_EDGE_MARGIN);

      let p = this.canSpawnAt(x, y, 'advanced2') ? { x, y } : null;
      for (let step = 40; step <= 600 && !p; step += 40) {
        for (const [dx, dy] of [[-step, 0], [step, 0], [0, -step], [0, step]]) {
          const nx = Phaser.Math.Clamp(x + dx, ENEMY_EDGE_MARGIN, ww - ENEMY_EDGE_MARGIN);
          const ny = Phaser.Math.Clamp(y + dy, ENEMY_EDGE_MARGIN, wh - ENEMY_EDGE_MARGIN);
          if (this.canSpawnAt(nx, ny, 'advanced2')) { p = { x: nx, y: ny }; break; }
        }
      }
      if (!p) p = this.findClearSpawnNearPlayer('advanced2');
      if (!p) return null;

      const adv = this.initEnemy({ x: p.x, y: p.y, type: 'advanced2', hp: 100, damage: 15, attackRange: Infinity });
      this.enemies.push(adv);
      return adv;
    },

    createSpawnEffect(t, wave) {
      const s = t?.spawn || {};
      const w = wave || s;
      this.spawnEffects.push({
        shape: w.shape === 'circle' ? 'circle' : 'polygon',
        sides: Math.max(3, Number(w.sides) || 6),
        radius: Math.max(20, Number(w.radius) || 120),
        thickness: Math.max(1, Number(w.thickness) || 10),
        drawDuration: Math.max(1, Number(w.drawDuration) || 500),
        fadeDuration: Math.max(1, Number(w.fadeDuration) || 500),
        circleCount: Math.max(1, Number(w.circleCount) || 8),
        enemyType: w.enemyType || 'basic1',
        // 波次对象 + 尺寸倍率：落地生成时用它取三层回落的数值（波次 > 关卡兜底 > 全局）
        wave: w,
        scale: waveScale(this.ctx.state.level, w.enemyType || 'basic1', w),
        phase: 'draw',
        progress: 0,
        spawned: 0,
        spawnedEnemies: [],
        holdT: 0,
        holdDuration: 500,
        triggerId: t?.id || null,
        cx: this.player.x,
        cy: this.player.y,
        startAngle: -Math.PI / 2
      });
    },

    spawnEnemyAt(x, y, fx) {
      const enemy = this.initEnemy({ x, y, type: fx.enemyType, triggerId: fx.triggerId || null, wave: fx.wave });
      enemy.frozen = true;
      fx.spawnedEnemies.push(enemy);
      this.enemies.push(enemy);
    },

    spawnAtVertex(fx, i, total) {
      const step = Math.PI * 2 / total;
      const baseAngle = fx.startAngle + (i / total) * Math.PI * 2;
      const scale = fx.scale || 1;
      // 理想顶点 → 其余顶点轮转（允许一个顶点承载多个敌人）→ 半径/角度抖动
      for (let k = 0; k < total; k++) {
        const a = baseAngle + k * step;
        for (const s of [1, 0.85, 1.15]) {
          const x = fx.cx + Math.cos(a) * fx.radius * s;
          const y = fx.cy + Math.sin(a) * fx.radius * s;
          if (this.canSpawnAt(x, y, fx.enemyType, 0, scale)) {
            this.spawnEnemyAt(x, y, fx);
            return;
          }
        }
      }
      // 全部顶点都被障碍阻挡：玩家附近找连线无障碍点兜底
      const fb = this.findClearSpawnNearPlayer(fx.enemyType, scale);
      if (fb) this.spawnEnemyAt(fb.x, fb.y, fx);
    },

    updateSpawnEffects(dt) {
      this.spawnEffects = this.spawnEffects.filter(fx => {
        const total = fx.shape === 'circle' ? fx.circleCount : fx.sides;
        if (fx.phase === 'draw') {
          fx.progress = Math.min(1, fx.progress + dt / fx.drawDuration);
          while (fx.spawned < total && fx.spawned / total <= fx.progress) {
            this.spawnAtVertex(fx, fx.spawned, total);
            fx.spawned++;
          }
          if (fx.progress >= 1) {
            fx.phase = 'hold';
            fx.progress = 1;
            fx.holdT = 0;
          }
          return true;
        }
        if (fx.phase === 'hold') {
          fx.holdT += dt;
          if (fx.holdT >= (fx.holdDuration || 500)) {
            fx.phase = 'fade';
            for (const e of fx.spawnedEnemies) e.frozen = false;
          }
          return true;
        }
        fx.progress = Math.max(0, fx.progress - dt / fx.fadeDuration);
        return fx.progress > 0;
      });
    },

    updateLockEffects(dt) {
      this.lockEffects = this.lockEffects.filter(fx => {
        fx.t += dt;
        if (fx.t >= fx.duration) {
          // 生成前再校验一次连线无障碍；失效则玩家附近兜底，仍无解跳过
          const scale = fx.scale || 1;
          let p = this.canSpawnAt(fx.x, fx.y, fx.enemyType, 0, scale) ? fx : this.findClearSpawnNearPlayer(fx.enemyType, scale);
          if (p) {
            const enemy = this.initEnemy({ x: p.x, y: p.y, type: fx.enemyType, triggerId: fx.triggerId || null, wave: fx.wave });
            this.enemies.push(enemy);
          }
          return false;
        }
        return true;
      });
    },

    drawLockEffects(g) {
      for (const fx of this.lockEffects) {
        // 渐显：progress 0→1；缩小：锁定框从 1.6 倍缩到 1 倍
        const p = Math.min(1, fx.t / fx.duration);
        const alpha = p;
        const scale = 1.6 - 0.6 * p;
        const half = (fx.size * scale) / 2;
        const L = half * 0.5; // 四角括号臂长
        const th = 5;         // 厚度 5px
        g.fillStyle(0xffffff, alpha);

        const cx = fx.x, cy = fx.y;
        // 四角：左上、右上、右下、左下（L 形）
        const corners = [
          { sx: cx - half, sy: cy - half, dx: 1, dy: 1 },
          { sx: cx + half, sy: cy - half, dx: -1, dy: 1 },
          { sx: cx + half, sy: cy + half, dx: -1, dy: -1 },
          { sx: cx - half, sy: cy + half, dx: 1, dy: -1 }
        ];
        for (const c of corners) {
          // 水平臂
          g.fillRect(Math.min(c.sx, c.sx - c.dx * L), c.sy - th / 2, L, th);
          // 垂直臂
          g.fillRect(c.sx - th / 2, Math.min(c.sy, c.sy - c.dy * L), th, L);
        }
      }
    },

    drawSpawnEffects(g) {
      for (const fx of this.spawnEffects) {
        g.lineStyle(fx.thickness, 0xffffff, 1);

        if (fx.shape === 'circle') {
          let startA, endA;
          if (fx.phase === 'draw') {
            startA = fx.startAngle;
            endA = fx.startAngle + fx.progress * Math.PI * 2;
          } else {
            startA = fx.startAngle + (1 - fx.progress) * Math.PI * 2;
            endA = fx.startAngle + Math.PI * 2;
          }
          g.beginPath();
          g.arc(fx.cx, fx.cy, fx.radius, startA, endA, false);
          g.strokePath();
          continue;
        }

        const step = Math.PI * 2 / fx.sides;
        const total = fx.sides;
        const vx = i => fx.cx + Math.cos(fx.startAngle + i * step) * fx.radius;
        const vy = i => fx.cy + Math.sin(fx.startAngle + i * step) * fx.radius;
        const seg = (x0, y0, x1, y1) => {
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.strokePath();
        };

        if (fx.phase === 'draw') {
          const edgePos = fx.progress * total;
          const full = Math.floor(edgePos);
          const partial = edgePos - full;
          for (let i = 0; i < full; i++) {
            seg(vx(i), vy(i), vx(i + 1), vy(i + 1));
          }
          if (full < total) {
            const x0 = vx(full), y0 = vy(full);
            const x1 = vx(full + 1), y1 = vy(full + 1);
            seg(x0, y0, x0 + (x1 - x0) * partial, y0 + (y1 - y0) * partial);
          }
        } else {
          const edgePos = (1 - fx.progress) * total;
          const erased = Math.floor(edgePos);
          const partial = edgePos - erased;
          for (let i = erased + 1; i < total; i++) {
            seg(vx(i), vy(i), vx(i + 1), vy(i + 1));
          }
          if (erased < total) {
            const x0 = vx(erased), y0 = vy(erased);
            const x1 = vx(erased + 1), y1 = vy(erased + 1);
            seg(x0 + (x1 - x0) * partial, y0 + (y1 - y0) * partial, x1, y1);
          }
        }
      }
    },

  // ── 回填：屏幕内生成点求解 ──
    spawnInScreen(t, wave) {
    const ctx = this.ctx;
      const minRadius = Math.max(0, Number(wave.playerMinRadius ?? 200) || 0);
      const count = Math.max(1, Number(wave.count) || 1);
      const type = wave.enemyType || 'basic1';
      const scale = waveScale(ctx.state.level, type, wave);

      // 生成范围：优先使用该波次指定的生成区域，否则回退到触发器自身矩形
      const zone = (wave.zoneId && ctx.state.level.spawnZones?.find(z => z.id === wave.zoneId))
        || { x: t.x, y: t.y, w: t.w, h: t.h };
      const minX = zone.x - zone.w / 2, maxX = zone.x + zone.w / 2;
      const minY = zone.y - zone.h / 2, maxY = zone.y + zone.h / 2;
      const rand = () => ({
        x: minX + Math.random() * (maxX - minX),
        y: minY + Math.random() * (maxY - minY)
      });

      for (let i = 0; i < count; i++) {
        let p = null;
        // 第一轮：严格满足 安全半径 + 连线无障碍
        for (let attempt = 0; attempt < 60 && !p; attempt++) {
          const c = rand();
          if (this.canSpawnAt(c.x, c.y, type, minRadius, scale)) p = c;
        }
        // 第二轮：区域整体落在安全半径内时，退化为仅连线无障碍 + 避玩家脚下
        for (let attempt = 0; attempt < 60 && !p; attempt++) {
          const c = rand();
          if (this.canSpawnAt(c.x, c.y, type, 20, scale)) p = c;
        }
        if (!p) continue;

        const size = ((ENEMY_BEHAVIOR[type] || ENEMY_BEHAVIOR.basic1).size) * scale;
        this.lockEffects.push({
          x: p.x,
          y: p.y,
          size: size + 20,
          duration: 500,
          t: 0,
          enemyType: type,
          triggerId: t.id,
          wave,
          scale
        });
      }
    },
};
