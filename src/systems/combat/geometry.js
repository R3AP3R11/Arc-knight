// ============================================================
// 战斗与关卡几何：网格吸附、墙体命中判定、圆体碰撞推出、射线求交与子弹反弹。
// 分类：战斗相关
// 主要导出：snap, toCell, wallRotationRad, wallCorners, pointInWall, hitWall, resolveCircleAgainstWalls, hitTrigger, rayRectIntersect, rayRotatedRectDistance, rayWallDistance, rayCircleDistance, rayToBounds, reflectBulletAgainstWall, pointSegmentDistance
// ============================================================

import Phaser from 'phaser';
import { CELL } from '../constants.js';

// ── 网格吸附与坐标换算 ──
export const snap = value => Math.round(value / CELL) * CELL;
export const toCell = (x, y) => ({ x: Math.floor(x / CELL), y: Math.floor(y / CELL) });

// ── 墙体几何与命中判定 ──
export function wallRotationRad(wall) {
  return Phaser.Math.DegToRad(wall.rotation || 0);
}

export function wallCorners(wall) {
  const r = wallRotationRad(wall);
  const cos = Math.cos(r), sin = Math.sin(r);
  const hw = wall.w / 2, hh = wall.h / 2;
  return [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]
  ].map(([lx, ly]) => ({
    x: wall.x + lx * cos - ly * sin,
    y: wall.y + lx * sin + ly * cos
  }));
}

export function pointInWall(wall, x, y, pad = 0) {
  const r = -wallRotationRad(wall);
  const dx = x - wall.x, dy = y - wall.y;
  const cos = Math.cos(r), sin = Math.sin(r);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  if (wall.shape === 'circle') return Math.hypot(lx, ly) <= wall.w / 2 + pad;
  if (wall.shape === 'arc') {
    const distance = Math.hypot(lx, ly);
    const angle = Phaser.Math.RadToDeg(Math.atan2(ly, lx));
    const start = Number(wall.startAngle) || 0;
    const span = Math.max(0, Math.min(360, (Number(wall.endAngle) || 360) - start));
    const normalized = (angle - start + 360) % 360;
    return distance >= Math.max(0, wall.w / 2 - wall.thickness / 2 - pad)
      && distance <= wall.w / 2 + wall.thickness / 2 + pad && normalized <= span;
  }
  return Math.abs(lx) <= wall.w / 2 + pad && Math.abs(ly) <= wall.h / 2 + pad;
}

export function hitWall(wall, x, y, pad = 0) {
  return pointInWall(wall, x, y, pad);
}

export function resolveCircleAgainstWalls(entity, radius, walls) {
  for (const w of walls) {
    if (w.shape === 'circle' || w.shape === 'arc') {
      const dx = entity.x - w.x, dy = entity.y - w.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const outer = w.w / 2 + w.thickness / 2 + radius;
      const inner = w.shape === 'arc'
        ? Math.max(0, w.w / 2 - w.thickness / 2 - radius)
        : 0;
      const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx));
      const start = Number(w.startAngle) || 0;
      const span = Math.max(0, Math.min(360, (Number(w.endAngle) || 360) - start));
      const inArc = w.shape === 'circle'
        || ((angle - start + 360) % 360 <= span);
      if (!inArc || distance > outer || distance < inner) continue;
      // 完整圆墙永远向外推到外缘，避免敌人被吸到圆心永久困死
      const target = w.shape === 'circle'
        ? outer
        : (distance < (inner + outer) / 2 ? inner : outer);
      entity.x = w.x + dx / distance * target;
      entity.y = w.y + dy / distance * target;
      continue;
    }

    const rot = -wallRotationRad(w);
    const dx = entity.x - w.x, dy = entity.y - w.y;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    let lx = dx * cos - dy * sin;
    let ly = dx * sin + dy * cos;
    const hw = w.w / 2 + radius, hh = w.h / 2 + radius;
    if (Math.abs(lx) >= hw || Math.abs(ly) >= hh) continue;
    const pushX = hw - Math.abs(lx), pushY = hh - Math.abs(ly);
    if (pushX <= pushY) lx = lx < 0 ? -hw : hw;
    else ly = ly < 0 ? -hh : hh;
    const cr = Math.cos(wallRotationRad(w)), sr = Math.sin(wallRotationRad(w));
    entity.x = w.x + lx * cr - ly * sr;
    entity.y = w.y + lx * sr + ly * cr;
  }
}

export function hitTrigger(trigger, x, y) {
  if (trigger.shape === 'circle') {
    const r = Math.max(trigger.w, trigger.h) / 2;
    return Math.hypot(x - trigger.x, y - trigger.y) <= r;
  }
  return x >= trigger.x - trigger.w / 2 && x <= trigger.x + trigger.w / 2
    && y >= trigger.y - trigger.h / 2 && y <= trigger.y + trigger.h / 2;
}

// ── 射线求交 ──
export function rayRectIntersect(x0, y0, dx, dy, minX, minY, maxX, maxY) {
  let tMin = 0, tMax = Infinity;

  if (Math.abs(dx) < 1e-9) {
    if (x0 < minX || x0 > maxX) return null;
  } else {
    let t1 = (minX - x0) / dx, t2 = (maxX - x0) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }

  if (Math.abs(dy) < 1e-9) {
    if (y0 < minY || y0 > maxY) return null;
  } else {
    let t1 = (minY - y0) / dy, t2 = (maxY - y0) / dy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
  }

  if (tMin > tMax) return null;
  return tMin;
}

export function rayRotatedRectDistance(x0, y0, dx, dy, wall) {
  const r = -wallRotationRad(wall);
  const cos = Math.cos(r), sin = Math.sin(r);
  const ox = (x0 - wall.x) * cos - (y0 - wall.y) * sin;
  const oy = (x0 - wall.x) * sin + (y0 - wall.y) * cos;
  const ddx = dx * cos - dy * sin;
  const ddy = dx * sin + dy * cos;
  return rayRectIntersect(ox, oy, ddx, ddy, -wall.w / 2, -wall.h / 2, wall.w / 2, wall.h / 2);
}

export function rayWallDistance(x0, y0, dx, dy, walls) {
  let tMin = Infinity;
  for (const w of walls) {
    const t = w.shape === 'rect'
      ? rayRotatedRectDistance(x0, y0, dx, dy, w)
      : rayCircleDistance(x0, y0, dx, dy, w);
    if (t !== null && t < tMin) tMin = t;
  }
  return tMin;
}

export function rayCircleDistance(x0, y0, dx, dy, wall) {
  const ox = x0 - wall.x, oy = y0 - wall.y;
  const b = ox * dx + oy * dy;
  const radius = wall.w / 2 + (wall.thickness || 0) / 2;
  const c = ox * ox + oy * oy - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const t = -b - Math.sqrt(discriminant);
  if (t < 0) return null;
  if (wall.shape === 'circle') return t;
  const x = x0 + dx * t - wall.x;
  const y = y0 + dy * t - wall.y;
  const angle = Phaser.Math.RadToDeg(Math.atan2(y, x));
  const start = Number(wall.startAngle) || 0;
  const span = Math.max(0, Math.min(360, (Number(wall.endAngle) || 360) - start));
  return ((angle - start + 360) % 360) <= span ? t : null;
}

export function rayToBounds(x0, y0, dx, dy, viewW, viewH) {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (viewW - x0) / dx);
  else if (dx < 0) t = Math.min(t, (-x0) / dx);
  if (dy > 0) t = Math.min(t, (viewH - y0) / dy);
  else if (dy < 0) t = Math.min(t, (-y0) / dy);
  return t;
}

// ── 子弹反弹与点线距离 ──
// 子弹撞墙反弹：按矩形墙局部坐标判断侵入轴，翻转对应速度分量
export function reflectBulletAgainstWall(b, wall) {
  if (wall.shape === 'circle' || wall.shape === 'arc') {
    const dx = b.x - wall.x, dy = b.y - wall.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len, ny = dy / len;
    const dot = b.vx * nx + b.vy * ny;
    b.vx -= 2 * dot * nx;
    b.vy -= 2 * dot * ny;
    return;
  }
  const rot = -wallRotationRad(wall);
  const dx = b.x - wall.x, dy = b.y - wall.y;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let lx = dx * cos - dy * sin;
  let ly = dx * sin + dy * cos;
  const hw = wall.w / 2, hh = wall.h / 2;
  const pushX = hw - Math.abs(lx), pushY = hh - Math.abs(ly);
  if (pushX <= pushY) {
    // 撞左右面：翻转局部 x 速度
    let vx = b.vx * cos - b.vy * sin;
    let vy = b.vx * sin + b.vy * cos;
    vx = -vx;
    b.vx = vx * cos + vy * sin;
    b.vy = -vx * sin + vy * cos;
  } else {
    // 撞上下面：翻转局部 y 速度
    let vx = b.vx * cos - b.vy * sin;
    let vy = b.vx * sin + b.vy * cos;
    vy = -vy;
    b.vx = vx * cos + vy * sin;
    b.vy = -vx * sin + vy * cos;
  }
  if (b.baseAngle !== undefined) b.baseAngle = Math.atan2(b.vy, b.vx);
}

export function pointSegmentDistance(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx, cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
