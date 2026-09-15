// ============================================================
// 武器定义表（开火 / 子弹步进 / 子弹绘制）与激光生成。
// 分类：战斗相关
// 主要导出：WEAPONS, spawnLaser
// ============================================================

import Phaser from 'phaser';
import { PLAYER_ART, HIT_FX_TTL } from '../constants.js';
import { color, getWeaponOrbPosition } from '../ui/entity-art.js';
import { rayToBounds, rayWallDistance, pointSegmentDistance } from './geometry.js';
import { activeMods } from '../economy/damage.js';

// ── BOSS 施力弹渲染常量 ──
const S5_DIR_EPS = 1e-6;          // 速度低于此值视为方向退化（刚解冻、尚未被施力加速）
const S5_TRAIL_ALPHA = 0.9;

// ── BOSS 施力弹（技能1 吸引 / 技能2 击退 / 技能5 漩涡吸回）：白色弹体 + 可配彩色拖尾（颜色由 b.forceTrail.color 决定） ──
// 被护盾拦截的子弹被 BOSS 施加吸力/推力后会带上 b.forceTrail（boss25t5.js 写入）；
// 此时它已是普通玩家子弹（blockedBoss=false），但 b.dist 停在「被冻结时」的旧值，
// 不能用来算拖尾长度 —— 长度只取 b.forceTrail.length。
// 方向兜底：speed < S5_DIR_EPS 且无 b.dirX/dirY（有存档方向则沿用）时跳过拖尾，只画白色弹点。
// 返回 true = 已按该形态绘制（调用方应直接 return）。
function drawForceTrailBullet(g, b, bodyR) {
  const tr = b.forceTrail;
  if (!tr) return false;
  const speed = Math.hypot(b.vx, b.vy);
  let ux = 0, uy = 0;
  if (speed > S5_DIR_EPS) { ux = b.vx / speed; uy = b.vy / speed; }
  else if (Number.isFinite(b.dirX) && Number.isFinite(b.dirY)) { ux = b.dirX || 0; uy = b.dirY || 0; }
  if (ux || uy) {
    const len = Math.max(0, Number(tr.length) || 0);
    const halfW = Math.max(0, Number(tr.width) || 0);   // width = 垂直航向的半宽（尾部收成尖）
    if (len > 0 && halfW > 0) {
      const px = -uy, py = ux;
      const tailX = b.x - ux * len, tailY = b.y - uy * len;
      g.fillStyle(color(tr.color || '#ff3b3b'), S5_TRAIL_ALPHA);
      g.beginPath();
      g.moveTo(b.x + px * halfW, b.y + py * halfW);
      g.lineTo(tailX, tailY);
      g.lineTo(b.x - px * halfW, b.y - py * halfW);
      g.closePath();
      g.fillPath();
    }
  }
  g.fillStyle(0xffffff, 1);
  g.fillCircle(b.x, b.y, bodyR);
  return true;
}

// ── 武器定义表 ──
export const WEAPONS = {
  radial: {
    scheme: 'hex-ring',
    ringColor: '#ffa914',
    fireInterval: 120,
    baseDamage: 10,
    maxAmmo: Infinity,
    fire(player, level) {
      const muzzle = getWeaponOrbPosition(player);
      const angle = player.weaponAngle || 0;
      return [{
        x: muzzle.x, y: muzzle.y,
        vx: Math.cos(angle) * 500, vy: Math.sin(angle) * 500,
        dist: 0,
        weaponType: 'radial',
        level,
        trailColor: player.weapon?.ringColor || '#ffa914'
      }];
    },
    drawBullet(g, b) {
      // BOSS 护盾拦截弹（vx=vy=0）：轨迹在速度 0 时退化为点、不可见，头部圆默认为白色 →
      // 这里强制按 trailColor 画红色弹体（颜色由 battle 侧 boss25t5TryBlock 置为 #ff3b3b）。
      if (b.blockedBoss) { g.fillStyle(color(b.trailColor || '#ff3b3b')); g.fillCircle(b.x, b.y, Math.max(b.blockedR ?? 5, PLAYER_ART.weaponOrbRadius * 1.25)); return; }
      // BOSS 施力弹：白色弹体 + 可配彩色拖尾
      if (drawForceTrailBullet(g, b, Math.max(b.blockedR ?? 5, PLAYER_ART.weaponOrbRadius * 1.25))) return;
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / speed, uy = b.vy / speed;
      const px = -uy, py = ux;
      const trailLen = Math.min(140, b.dist || 0);
      const tailX = b.x - ux * trailLen, tailY = b.y - uy * trailLen;
      const headR = PLAYER_ART.weaponOrbRadius * 1.25, tailR = 0;
      g.fillStyle(color(b.trailColor || '#ffa914'));
      g.beginPath();
      g.moveTo(b.x + px * headR, b.y + py * headR);
      g.lineTo(tailX + px * tailR, tailY + py * tailR);
      g.lineTo(tailX - px * tailR, tailY - py * tailR);
      g.lineTo(b.x - px * headR, b.y - py * headR);
      g.closePath();
      g.fillPath();
      g.fillStyle(0xffffff);
      g.fillCircle(b.x, b.y, headR);
    }
  },

  basic: {
    scheme: 'default',
    ringColor: '#51b9ff',
    fireInterval: 120,
    baseDamage: 10,
    fire(player, level) {
      const angle = player.weaponAngle || 0;
      return [{
        x: player.x, y: player.y,
        vx: Math.cos(angle) * 500, vy: Math.sin(angle) * 500,
        dist: 0,
        weaponType: 'basic',
        level,
        trailColor: player.weapon?.ringColor || '#51b9ff'
      }];
    },
    drawBullet(g, b) {
      // BOSS 护盾拦截弹（vx=vy=0）：拖尾线退化为点、头部圆默认白色 → 强制画红色弹体。
      if (b.blockedBoss) { g.fillStyle(color(b.trailColor || '#ff3b3b')); g.fillCircle(b.x, b.y, Math.max(b.blockedR ?? 5, 4)); return; }
      // BOSS 施力弹：白色弹体（半径沿用本武器口径 4）+ 可配彩色拖尾
      if (drawForceTrailBullet(g, b, Math.max(b.blockedR ?? 5, 4))) return;
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / speed, uy = b.vy / speed;
      const trailLen = Math.min(40, b.dist || 0);
      const tailX = b.x - ux * trailLen, tailY = b.y - uy * trailLen;
      g.lineStyle(2, color(b.trailColor || '#51b9ff'), .6);
      g.lineBetween(b.x, b.y, tailX, tailY);
      g.fillStyle(0xffffff);
      g.fillCircle(b.x, b.y, 4);
    }
  }
};

// ── 激光 ──
// 生成一条激光：计算端点（穿透改件穿墙）+ 即时伤害敌人，返回 laser 对象
export function spawnLaser(scene, weaponType, ox, oy, angle, width, color) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const startX = ox + dx * 10;
  const startY = oy + dy * 10;
  const walls = [...scene.ctx.state.level.walls, ...scene.bulletGateWalls(), ...scene.chestLockWalls()];
  const { w: ww, h: wh } = scene.worldSize();

  let range;
  if (activeMods(scene, weaponType).has('pierce')) {
    range = rayToBounds(startX, startY, dx, dy, ww, wh);
  } else {
    range = rayWallDistance(startX, startY, dx, dy, walls);
    range = Math.min(range, rayToBounds(startX, startY, dx, dy, ww, wh));
  }

  const endX = startX + dx * range;
  const endY = startY + dy * range;
  const halfW = width / 2;

  for (const e of scene.enemies) {
    if (!e.alive) continue;
    const d = pointSegmentDistance(e.x, e.y, startX, startY, endX, endY);
    if (d < halfW + e.r) {
      scene.hitEffects.push({ x: e.x, y: e.y, ttl: HIT_FX_TTL });
      scene.defeatEnemy(e);
    }
  }

  return { laser: true, x0: startX, y0: startY, x1: endX, y1: endY, width, color, ttl: 120 };
}
