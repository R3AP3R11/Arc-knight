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
  const walls = scene.ctx.state.level.walls;
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
