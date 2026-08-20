import Phaser from 'phaser';
import { DEFAULT_WALL_COLOR, MIN_WALL_SIZE, ENEMY_TYPES, normalizeEnemy, normalizeWeapons, WEAPON_LABELS, normalizeCrate, normalizeBarrel } from './state.js';
import { renderGraph } from './ui-layer.js';
import { BINDINGS } from './ui-bindings.js';
import { buildGrid, findPath, nearestWalkable } from './pathfinding.js';
const VIEW_W = 1920, VIEW_H = 1080, CELL = 30;
const CRATE_SIZE = 50;
const CRATE_BORDER_THICKNESS = 8;
const CRATE_INSET = 7;
const BARREL_RADIUS = 30;
const BARREL_ICON = '/barrel.png';
const BARREL_TEX_KEY = '__barrel__';
const BARREL_DAMAGE = 30;
const BARREL_EXPLOSION_MS = 100;
const CRATE_DEBRIS_TTL = 450;
const PLAYER_ART_SCALE = 0.5;
const PLAYER_ART = {
  hexagonRadius: 20 * PLAYER_ART_SCALE,
  innerRingRadius: 24 * PLAYER_ART_SCALE,
  innerRingThickness: 1.5 * PLAYER_ART_SCALE,
  outerRingRadius: 32 * PLAYER_ART_SCALE,
  outerRingThickness: 2 * PLAYER_ART_SCALE,
  outer2RingRadius: 40 * PLAYER_ART_SCALE,
  outer2RingThickness: 2.5 * PLAYER_ART_SCALE,
  bodyRingRadius: 70 * PLAYER_ART_SCALE,
  bodyRingThickness: 4 * PLAYER_ART_SCALE,
  weaponRingRadius: 80 * PLAYER_ART_SCALE,
  weaponRingThickness: 8 * PLAYER_ART_SCALE,
  weaponOrbRadius: 4 * PLAYER_ART_SCALE,
  yLineThickness: 3 * PLAYER_ART_SCALE
};
const PLAYER_COLLISION_RADIUS = PLAYER_ART.weaponRingRadius + PLAYER_ART.weaponRingThickness;
const snap = value => Math.round(value / CELL) * CELL;
const PLAYER_LEAN = { hex: 12, inner: 9, middle: 7, outer: 5, speed: 48, minHexRadius: 8 };
const SHIELD = { color: '#00eeff', arcDeg: 120, gap: 10, fadeMs: 500 };
const SHIELD_MAX = 50;
const SHIELD_SHAKE_MS = 150;
const SHIELD_SHAKE_INTENSITY = 0.004;
const SHIELD_HIT_COLOR = 0x00eeff;
const BULLET_DAMAGE = 10;
const HIT_FX_TTL = 100;
const HIT_FX_RADIUS = 40;
const PICKUP_RADIUS = 26;
const HIT_FLASH_RADIUS = 70;
const ENEMY_RED = 0xff3b3b;
const PATH_INFLATE = 24;
const PATH_REPATH_INTERVAL = 0.25;
const PATH_WAYPOINT_RADIUS = CELL * 0.4;
const SWITCH_FADE_MS = 500;
const SPAWN_OFFSCREEN_PX = 10;
const ENEMY_BULLET_SPEED = 400;
const WEAPON_SLOT_LEVELS = [10, 30];
const LEVEL_HP_BONUS = 10;

const ENEMY_BEHAVIOR = {
  basic1: { size: 30, approach: 200, engage: 50, engageDelay: 0.4, colorRange: 300, orbit: null, charge: null, spin: 0, onEnterOrbit: { minDur: 0.5, maxDur: 1, minDeg: 60, maxDeg: 120 } },
  basic2: { size: 30, approach: 200, engage: 50, engageDelay: 0.4, colorRange: 300, orbit: { period: 2, duration: 1, degPerSec: 30 }, charge: null, spin: 4 },
  advanced1: { size: 48, approach: 200, engage: 160, engageDelay: 0.4, colorRange: 200, orbit: { period: 1, duration: 0.5, degPerSec: 80 }, charge: { pause: 0.6, speed: 200 }, spin: 0, lineWidth: 6 },
  advanced2: { size: 40, attackRange: 500, fireInterval: 400, burstInterval: 3000, burstCount: 3, speed: 30, dormantSpin: 20, orbitMin: 30, orbitMax: 40, growDuration: 0.5, orbit: null, charge: null, spin: 0, onEnterOrbit: null }
};

function color(value) {
  return Phaser.Display.Color.HexStringToColor(value).color;
}

const toCell = (x, y) => ({ x: Math.floor(x / CELL), y: Math.floor(y / CELL) });

function wallRotationRad(wall) {
  return Phaser.Math.DegToRad(wall.rotation || 0);
}

function wallCorners(wall) {
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

function hitWall(wall, x, y, pad = 0) {
  const r = -wallRotationRad(wall);
  const dx = x - wall.x, dy = y - wall.y;
  const cos = Math.cos(r), sin = Math.sin(r);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= wall.w / 2 + pad && Math.abs(ly) <= wall.h / 2 + pad;
}

function resolveCircleAgainstWalls(entity, radius, walls) {
  for (const w of walls) {
    const rot = -wallRotationRad(w);
    const dx = entity.x - w.x, dy = entity.y - w.y;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    let lx = dx * cos - dy * sin;
    let ly = dx * sin + dy * cos;
    const hw = w.w / 2 + radius, hh = w.h / 2 + radius;
    if (Math.abs(lx) >= hw || Math.abs(ly) >= hh) continue;

    const pushX = hw - Math.abs(lx);
    const pushY = hh - Math.abs(ly);
    if (pushX <= pushY) {
      lx = lx < 0 ? -hw : hw;
    } else {
      ly = ly < 0 ? -hh : hh;
    }

    const cr = Math.cos(wallRotationRad(w)), sr = Math.sin(wallRotationRad(w));
    entity.x = w.x + lx * cr - ly * sr;
    entity.y = w.y + lx * sr + ly * cr;
  }
}

function hitTrigger(trigger, x, y) {
  return x >= trigger.x - trigger.w / 2 && x <= trigger.x + trigger.w / 2
    && y >= trigger.y - trigger.h / 2 && y <= trigger.y + trigger.h / 2;
}

function rayRectIntersect(x0, y0, dx, dy, minX, minY, maxX, maxY) {
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

function rayRotatedRectDistance(x0, y0, dx, dy, wall) {
  const r = -wallRotationRad(wall);
  const cos = Math.cos(r), sin = Math.sin(r);
  const ox = (x0 - wall.x) * cos - (y0 - wall.y) * sin;
  const oy = (x0 - wall.x) * sin + (y0 - wall.y) * cos;
  const ddx = dx * cos - dy * sin;
  const ddy = dx * sin + dy * cos;
  return rayRectIntersect(ox, oy, ddx, ddy, -wall.w / 2, -wall.h / 2, wall.w / 2, wall.h / 2);
}

function rayWallDistance(x0, y0, dx, dy, walls) {
  let tMin = Infinity;
  for (const w of walls) {
    const t = rayRotatedRectDistance(x0, y0, dx, dy, w);
    if (t !== null && t < tMin) tMin = t;
  }
  return tMin;
}

function rayToBounds(x0, y0, dx, dy, viewW, viewH) {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (viewW - x0) / dx);
  else if (dx < 0) t = Math.min(t, (-x0) / dx);
  if (dy > 0) t = Math.min(t, (viewH - y0) / dy);
  else if (dy < 0) t = Math.min(t, (-y0) / dy);
  return t;
}

function pointSegmentDistance(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx, cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function resizeRect(entity, drag, pointerX, pointerY) {
  const rot = wallRotationRad(entity);
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const dx = pointerX - entity.x, dy = pointerY - entity.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  const halfW = entity.w / 2, halfH = entity.h / 2;
  const fixedCorner = {
    nw: { x: halfW, y: halfH },
    ne: { x: -halfW, y: halfH },
    sw: { x: halfW, y: -halfH },
    se: { x: -halfW, y: -halfH }
  }[drag.handle];

  const left = drag.handle.includes('w')
    ? Math.min(lx, fixedCorner.x - MIN_WALL_SIZE)
    : fixedCorner.x;
  const right = drag.handle.includes('e')
    ? Math.max(lx, fixedCorner.x + MIN_WALL_SIZE)
    : fixedCorner.x;
  const top = drag.handle.includes('n')
    ? Math.min(ly, fixedCorner.y - MIN_WALL_SIZE)
    : fixedCorner.y;
  const bottom = drag.handle.includes('s')
    ? Math.max(ly, fixedCorner.y + MIN_WALL_SIZE)
    : fixedCorner.y;

  const w = right - left;
  const h = bottom - top;
  const localCx = left + w / 2;
  const localCy = top + h / 2;

  const r = wallRotationRad(entity);
  const c = Math.cos(r), s = Math.sin(r);
  entity.x += localCx * c - localCy * s;
  entity.y += localCx * s + localCy * c;
  entity.w = w;
  entity.h = h;
}

const ROTATE_HANDLE_OFFSET = 28;
function rotationHandleAt(wall, pointerX, pointerY) {
  const r = wallRotationRad(wall);
  const cos = Math.cos(r), sin = Math.sin(r);
  const lx = 0, ly = -wall.h / 2 - ROTATE_HANDLE_OFFSET;
  const x = wall.x + lx * cos - ly * sin;
  const y = wall.y + lx * sin + ly * cos;
  return Math.hypot(pointerX - x, pointerY - y) <= 12;
}

function handleAtRect(entity, pointerX, pointerY) {
  const handleSize = 12;
  const corners = wallCorners(entity);
  const names = ['nw', 'ne', 'se', 'sw'];
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    if (Math.abs(pointerX - c.x) <= handleSize && Math.abs(pointerY - c.y) <= handleSize) {
      return names[i];
    }
  }
  return null;
}

function hitBackground(bg, x, y) {
  return x >= bg.x - bg.w / 2 && x <= bg.x + bg.w / 2
    && y >= bg.y - bg.h / 2 && y <= bg.y + bg.h / 2;
}

const BG_HANDLE_SIZE = 10;
function backgroundHandleAt(bg, x, y) {
  const handles = [
    ['nw', bg.x - bg.w / 2, bg.y - bg.h / 2],
    ['ne', bg.x + bg.w / 2, bg.y - bg.h / 2],
    ['sw', bg.x - bg.w / 2, bg.y + bg.h / 2],
    ['se', bg.x + bg.w / 2, bg.y + bg.h / 2]
  ];
  return handles.find(([, hx, hy]) =>
    Math.abs(x - hx) <= BG_HANDLE_SIZE && Math.abs(y - hy) <= BG_HANDLE_SIZE
  )?.[0] || null;
}

const MIN_BG_SIZE = 20;
function resizeBackground(bg, drag, pointerX, pointerY) {
  const fixedCorner = {
    nw: { x: bg.x + bg.w / 2, y: bg.y + bg.h / 2 },
    ne: { x: bg.x - bg.w / 2, y: bg.y + bg.h / 2 },
    sw: { x: bg.x + bg.w / 2, y: bg.y - bg.h / 2 },
    se: { x: bg.x - bg.w / 2, y: bg.y - bg.h / 2 }
  }[drag.handle];

  const dx = pointerX - fixedCorner.x;
  const dy = pointerY - fixedCorner.y;
  const scale = Math.max(
    Math.abs(dx) / bg.w,
    Math.abs(dy) / bg.h,
    MIN_BG_SIZE / bg.w,
    MIN_BG_SIZE / bg.h
  );

  const w = bg.w * scale;
  const h = bg.h * scale;
  const dirX = drag.handle.includes('w') ? -1 : 1;
  const dirY = drag.handle.includes('n') ? -1 : 1;

  bg.x = fixedCorner.x + dirX * w / 2;
  bg.y = fixedCorner.y + dirY * h / 2;
  bg.w = w;
  bg.h = h;
}

function pickTopEntity(l, x, y) {
  for (let i = l.enemies.length - 1; i >= 0; i--) {
    const e = l.enemies[i];
    if (Math.hypot(e.x - x, e.y - y) < 30) return { entity: e, type: 'enemy' };
  }

  const spawn = Math.hypot(l.spawn.x - x, l.spawn.y - y) < 22 ? l.spawn : null;
  if (spawn) return { entity: spawn, type: 'spawn' };

  for (let i = l.barrels.length - 1; i >= 0; i--) {
    const b = l.barrels[i];
    if (Math.hypot(b.x - x, b.y - y) <= b.r + 2) return { entity: b, type: 'barrel' };
  }

  for (let i = l.crates.length - 1; i >= 0; i--) {
    const c = l.crates[i];
    if (hitWall(c, x, y)) return { entity: c, type: 'crate' };
  }

  for (let i = l.triggers.length - 1; i >= 0; i--) {
    const t = l.triggers[i];
    if (hitTrigger(t, x, y)) return { entity: t, type: 'trigger' };
  }

  for (let i = l.walls.length - 1; i >= 0; i--) {
    const w = l.walls[i];
    if (hitWall(w, x, y)) return { entity: w, type: 'wall' };
  }

  if (l.background && (
    (l.background.src && l.background.visible !== false && hitBackground(l.background, x, y))
    || (l.background.fx === 'wormhole' && l.background.visible !== false
      && Math.hypot(x - l.background.x, y - l.background.y) <= l.background.radius + 20)
  )) {
    return { entity: l.background, type: 'background' };
  }

  return null;
}

function drawCrate(g, x, y) {
  const s = CRATE_SIZE / 2;
  const t = CRATE_BORDER_THICKNESS;
  const inset = CRATE_INSET;
  const k = 0.95;
  g.lineStyle(t, 0xffffff, 1);
  g.lineBetween(x - s + inset, y - s, x + s - inset, y - s);
  g.lineBetween(x + s, y - s + inset, x + s, y + s - inset);
  g.lineBetween(x + s - inset, y + s, x - s + inset, y + s);
  g.lineBetween(x - s, y + s - inset, x - s, y - s + inset);
  g.lineBetween(x - s * k, y - s * k, x + s * k, y + s * k);
  g.lineBetween(x + s * k, y - s * k, x - s * k, y + s * k);
}

function drawCrateDebris(g, d) {
  const alpha = Math.max(0, d.ttl / CRATE_DEBRIS_TTL);
  g.lineStyle(CRATE_BORDER_THICKNESS, 0xffffff, alpha);
  for (const seg of d.segments) {
    if (seg.horizontal) {
      g.lineBetween(seg.cx - seg.half, seg.cy, seg.cx + seg.half, seg.cy);
    } else {
      g.lineBetween(seg.cx, seg.cy - seg.half, seg.cx, seg.cy + seg.half);
    }
  }
}

function drawRing(graphics, centerX, centerY, radius, thickness, ringColor) {
  graphics.lineStyle(thickness, color(ringColor), 1);
  graphics.strokeCircle(centerX, centerY, radius);
}

function drawWormhole(g, fx, t) {
  if (fx.visible === false) return;
  const n = fx.rings;
  const scale = 1 + fx.scaleAmp * Math.sin(t * fx.scaleSpeed);
  const baseY = fx.y + fx.yDrift * Math.sin(t * fx.ySpeed);

  g.fillStyle(0xff9d2e, 0.08);
  g.fillCircle(fx.x, baseY, fx.radius * scale * 1.15);

  const ang = t * fx.driftSpeed;

  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0;
    const tNorm = 0.2 + 0.8 * Math.pow(1 - u, 1.6);
    const radius = fx.radius * tNorm * scale;
    const amp = fx.driftAmp * u;
    const cx = fx.x + Math.cos(ang) * amp;
    const cy = baseY + Math.sin(ang) * amp;
    const thickness = Math.max(3, 14 * (1 - u) + 3 * u);
    const ringColor = i === 1 ? 0xffffff : 0xff9d2e;
    g.lineStyle(thickness, ringColor, 1);
    g.strokeCircle(cx, cy, radius);
  }

  const outR = fx.radius * scale;
  for (let k = 0; k < fx.orbitCount; k++) {
    const a = t * fx.orbitSpeed + k * (Math.PI * 2 / Math.max(1, fx.orbitCount));
    g.fillStyle(0xffffff, 1);
    g.fillCircle(fx.x + Math.cos(a) * outR, baseY + Math.sin(a) * outR, 5);
  }
}

function getHexagonPoints(centerX, centerY, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };
  });
}

function drawHexagonBody(graphics, centerX, centerY, radius = PLAYER_ART.hexagonRadius, offsetX = 0, offsetY = 0) {
  const points = getHexagonPoints(centerX + offsetX, centerY + offsetY, radius);

  graphics.fillStyle(0xffffff);
  graphics.beginPath();
  graphics.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach(point => graphics.lineTo(point.x, point.y));
  graphics.closePath();
  graphics.fillPath();

  graphics.lineStyle(PLAYER_ART.yLineThickness, 0x000000, 1);
  [1, 3, 5].forEach(index => {
    graphics.beginPath();
    graphics.moveTo(centerX + offsetX, centerY + offsetY);
    graphics.lineTo(points[index].x, points[index].y);
    graphics.strokePath();
  });
}

function drawDefaultPlayer(graphics, centerX, centerY) {
  graphics.fillStyle(0x51b9ff);
  graphics.fillCircle(centerX, centerY, 13);
}

function drawDiamond(g, e, size, fill, angle) {
  const longHalf = size / 2;
  const shortHalf = size * 0.36;
  g.fillStyle(fill);
  g.beginPath();
  g.moveTo(e.x + Math.cos(angle) * longHalf, e.y + Math.sin(angle) * longHalf);
  g.lineTo(e.x + Math.cos(angle + Math.PI / 2) * shortHalf, e.y + Math.sin(angle + Math.PI / 2) * shortHalf);
  g.lineTo(e.x + Math.cos(angle + Math.PI) * longHalf, e.y + Math.sin(angle + Math.PI) * longHalf);
  g.lineTo(e.x + Math.cos(angle - Math.PI / 2) * shortHalf, e.y + Math.sin(angle - Math.PI / 2) * shortHalf);
  g.closePath();
  g.fillPath();
}

function drawSquareAt(g, cx, cy, size, angle, fill) {
  const half = size / 2;
  const r = half * Math.SQRT2;
  const a = angle + Math.PI / 4;
  g.fillStyle(fill);
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const p = a + i * Math.PI / 2;
    const x = cx + Math.cos(p) * r, y = cy + Math.sin(p) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillPath();
}

function drawSquares(g, e, size, fill, spin1, spin2) {
  drawSquareAt(g, e.x, e.y, size, spin1, fill);
  drawSquareAt(g, e.x, e.y, size, spin2, fill);
}

function drawX(g, e, size, lineWidth, fill) {
  const d = size * 0.35;
  g.lineStyle(lineWidth, fill, 1);
  g.lineBetween(e.x - d, e.y - d, e.x + d, e.y + d);
  g.lineBetween(e.x - d, e.y + d, e.x + d, e.y - d);
}

function drawAdvanced2(g, e, dynamic, target) {
  const b = ENEMY_BEHAVIOR.advanced2;
  const bodyR = 18;
  const orbitR = dynamic ? (e.orbitRadius ?? b.orbitMin) : b.orbitMin;
  const ballAngle = dynamic ? (e.orbitAngle ?? 0) : -Math.PI / 2;

  g.fillStyle(0xffffff);
  g.fillCircle(e.x, e.y, bodyR);

  g.lineStyle(2, 0xffffff, 1);
  g.strokeCircle(e.x, e.y, orbitR);

  const bx = e.x + Math.cos(ballAngle) * orbitR;
  const by = e.y + Math.sin(ballAngle) * orbitR;
  g.fillStyle(e.aggressive ? ENEMY_RED : 0xffffff);
  g.fillCircle(bx, by, 4);
}

function drawEnemyShape(g, e, dynamic, target) {
  const b = ENEMY_BEHAVIOR[e.type] || ENEMY_BEHAVIOR.basic1;
  const fill = e.red ? ENEMY_RED : 0xffffff;
  if (e.type === 'advanced2') {
    drawAdvanced2(g, e, dynamic, target);
    return;
  }
  if (e.type === 'basic2') {
    const spin1 = dynamic ? (e.spin1 || 0) : 0;
    const spin2 = dynamic ? (e.spin2 || 0) : 0;
    drawSquares(g, e, b.size, fill, spin1, spin2);
  } else if (e.type === 'advanced1') {
    drawX(g, e, b.size, b.lineWidth || 12, fill);
  } else {
    const angle = dynamic && target
      ? Phaser.Math.Angle.Between(e.x, e.y, target.x, target.y)
      : -Math.PI / 2;
    drawDiamond(g, e, b.size, fill, angle);
  }
}

function drawGoldHex(g, x, y) {
  const r = 10;
  g.fillStyle(0xffd54f);
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.fillPath();
}

function drawParallelogram(g, x, y, w, h, skew, ratio, fillColor, bgColor) {
  g.fillStyle(color(bgColor), 1);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w + skew, y);
  g.lineTo(x + w, y + h);
  g.lineTo(x - skew, y + h);
  g.closePath();
  g.fillPath();

  const fw = Math.max(0, Math.min(1, ratio)) * w;
  g.fillStyle(color(fillColor), 1);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + fw + skew, y);
  g.lineTo(x + fw, y + h);
  g.lineTo(x - skew, y + h);
  g.closePath();
  g.fillPath();
}

function drawHudAvatar(g, cx, cy, weaponColor) {
  const hexR = 18 * 0.85 * 1.5 * 0.9;
  const innerR = 22 * 1.25 * 1.5 * 0.9;
  const outerR = 33 * 1.25 * 1.5 * 0.9;
  const points = getHexagonPoints(cx, cy, hexR);
  g.fillStyle(0xffffff);
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach(p => g.lineTo(p.x, p.y));
  g.closePath();
  g.fillPath();
  g.lineStyle(3, 0xffffff, 1);
  g.strokeCircle(cx, cy, innerR);
  g.lineStyle(5 * 1.3, color(weaponColor), 1);
  g.strokeCircle(cx, cy, outerR);
}

function drawHudBars(g, player) {
  const hpRatio = player.maxHp > 0 ? player.hp / player.maxHp : 0;
  const shieldRatio = player.maxShield > 0 ? player.shield / player.maxShield : 0;
  drawParallelogram(g, 135, 1018, 304, 16, 8, hpRatio, '#ffffff', '#2a2f3a');
  drawParallelogram(g, 125, 1040, 304, 16, 8, shieldRatio, '#3aa0ff', '#1a2f3a');
}

function wheelOrder(weapons, index) {
  return [weapons[index], ...weapons.filter((_, i) => i !== index)];
}

function lerpColor(c1, c2, t) {
  const r = Math.round(((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t);
  const g = Math.round(((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t);
  const b = Math.round((c1 & 255) + ((c2 & 255) - (c1 & 255)) * t);
  return (r << 16) | (g << 8) | b;
}

function drawWeaponWheel(g, player, anim) {
  const n = player.weapons.length;
  if (!n) return;
  const cx = VIEW_W, cy = VIEW_H - 16;
  const rOuter = 220, rInner = 135;
  const gap = Phaser.Math.DegToRad(2);

  const fromIndex = anim ? anim.from : player.weaponIndex;
  const toIndex = player.weaponIndex;
  const p = anim ? Math.min(1, anim.t / anim.dur) : 1;
  const fromOrder = wheelOrder(player.weapons, fromIndex);
  const toOrder = wheelOrder(player.weapons, toIndex);
  const sweep = Math.PI + (1 - p) * (Math.PI / 2);

  const angles = [];
  for (let i = 0; i < n; i++) angles.push(Phaser.Math.DegToRad(i === 0 ? 60 : 15));

  const drawArc = (a0, a1, fillColor) => {
    g.fillStyle(fillColor, 1);
    g.beginPath();
    g.arc(cx, cy, rOuter, a0, a1, false);
    g.arc(cx, cy, rInner, a1, a0, true);
    g.closePath();
    g.fillPath();
  };

  let start = Math.PI;
  for (let i = 0; i < n; i++) {
    const end = start + angles[i] - (i < n - 1 ? gap : 0);
    const fromColor = color(WEAPONS[fromOrder[i]]?.ringColor || '#ffffff');
    const toColor = color(WEAPONS[toOrder[i]]?.ringColor || '#ffffff');

    if (sweep <= start) {
      drawArc(start, end, toColor);
    } else if (sweep >= end) {
      drawArc(start, end, fromColor);
    } else {
      drawArc(start, sweep, fromColor);
      drawArc(sweep, end, toColor);
    }
    start += angles[i];
  }
}

function strokeDiamond(g, cx, cy, rx, ry) {
  g.beginPath();
  g.moveTo(cx, cy - ry);
  g.lineTo(cx + rx, cy);
  g.lineTo(cx, cy + ry);
  g.lineTo(cx - rx, cy);
  g.closePath();
  g.strokePath();
}

function drawWeaponIcon(g, player, anim) {
  const cx = VIEW_W, cy = VIEW_H - 16;
  const rOuter = 214, rInner = 135;
  const center = Math.PI + Phaser.Math.DegToRad(30);
  const rot = anim ? (Math.min(1, anim.t / anim.dur)) * Math.PI * 2 : 0;
  const half = Phaser.Math.DegToRad(22.5);
  const a0 = center - half + rot;
  const a1 = center + half + rot;

  g.fillStyle(0xffffff, 1);
  g.beginPath();
  g.arc(cx, cy, rOuter, a0, a1, false);
  g.arc(cx, cy, rInner, a1, a0, true);
  g.closePath();
  g.fillPath();
}

function getWeaponOrbPosition(player) {
  const angle = player.weaponAngle || 0;
  return {
    x: player.x + Math.cos(angle) * PLAYER_ART.weaponRingRadius,
    y: player.y + Math.sin(angle) * PLAYER_ART.weaponRingRadius
  };
}

const WEAPONS = {
  radial: {
    scheme: 'hex-ring',
    ringColor: '#ffa914',
    fireInterval: 120,
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
  },

  yellow: {
    scheme: 'yellow',
    ringColor: '#feed34',
    fireInterval: 150,
    maxAmmo: 45,
    fire(player, level) {
      const muzzle = getWeaponOrbPosition(player);
      const base = player.weaponAngle || 0;
      const speed = 500;
      const bullets = [];

      // 中心弹：曲折前进，1.5 倍大小，记录蛇形轨迹
      bullets.push({
        x: muzzle.x, y: muzzle.y,
        vx: Math.cos(base) * speed, vy: Math.sin(base) * speed,
        dist: 0,
        weaponType: 'yellow',
        level,
        trailColor: this.ringColor,
        baseAngle: base,
        zigzag: true,
        scale: 1.5,
        history: [{ x: muzzle.x, y: muzzle.y }]
      });

      // 左右各 15° 侧弹：直飞，0.7 倍大小
      for (const offset of [-15, 15]) {
        const a = base + Phaser.Math.DegToRad(offset);
        bullets.push({
          x: muzzle.x, y: muzzle.y,
          vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
          dist: 0,
          weaponType: 'yellow',
          level,
          trailColor: this.ringColor,
          baseAngle: a,
          zigzag: false,
          scale: 0.7
        });
      }

      return bullets;
    },
    stepBullet(b, dt, scene) {
      if (!b.zigzag) return;
      const amp = Phaser.Math.DegToRad(15);
      const phase = Math.floor(b.dist / 40);
      const dir = phase % 2 === 0 ? 1 : -1;
      const angle = b.baseAngle + dir * amp;
      b.vx = Math.cos(angle) * 500;
      b.vy = Math.sin(angle) * 500;
      b.history.push({ x: b.x, y: b.y });
      while (b.history.length > 1 && Math.hypot(b.x - b.history[0].x, b.y - b.history[0].y) > 200) {
        b.history.shift();
      }
    },
    drawBullet(g, b) {
      const headR = PLAYER_ART.weaponOrbRadius * 1.25 * (b.scale || 1);

      if (b.zigzag && b.history?.length > 1) {
        const pts = b.history;
        for (let i = 0; i < pts.length - 1; i++) {
          const t = (i + 1) / (pts.length - 1);
          const w = Math.max(headR * t, 0.5);
          g.lineStyle(w * 2, color(b.trailColor || '#feed34'), 0.1 + 0.6 * t);
          g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
        }
        g.fillStyle(0xffffff);
        g.fillCircle(b.x, b.y, headR);
        return;
      }

      const speed = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / speed, uy = b.vy / speed;
      const px = -uy, py = ux;
      const trailLen = Math.min(200, b.dist || 0);
      const tailX = b.x - ux * trailLen, tailY = b.y - uy * trailLen;
      const tailR = 0;
      g.fillStyle(color(b.trailColor || '#feed34'));
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

  green: {
    scheme: 'green',
    ringColor: '#00ff66',
    fireInterval: 150,
    maxAmmo: 30,
    fire(player, level, scene) {
      const angle = player.weaponAngle || 0;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const width = PLAYER_ART.weaponOrbRadius * 1.25 * 1.5;
      const orb = getWeaponOrbPosition(player);
      const startX = orb.x + dx * 10;
      const startY = orb.y + dy * 10;
      const walls = scene.ctx.state.level.walls;
      const { w: ww, h: wh } = scene.worldSize();

      let range = rayWallDistance(startX, startY, dx, dy, walls);
      range = Math.min(range, rayToBounds(startX, startY, dx, dy, ww, wh));

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

      return [{
        laser: true,
        x0: startX, y0: startY,
        x1: endX, y1: endY,
        width,
        color: this.ringColor,
        ttl: 120
      }];
    }
  }
};

function updatePlayerMoveLean(player, dx, dy, dt) {
  const moving = dx !== 0 || dy !== 0;
  const step = PLAYER_LEAN.speed * dt / 1000;

  if (moving) {
    const n = Math.hypot(dx, dy) || 1;
    const ux = dx / n, uy = dy / n;
    player.moveLeanX += ux * step;
    player.moveLeanY += uy * step;
    const len = Math.hypot(player.moveLeanX, player.moveLeanY);
    if (len > PLAYER_LEAN.hex) {
      const scale = PLAYER_LEAN.hex / len;
      player.moveLeanX *= scale;
      player.moveLeanY *= scale;
    }
    player.moveHexRadius = Math.max(PLAYER_LEAN.minHexRadius, player.moveHexRadius - step);
  } else {
    player.moveHexRadius = Math.min(PLAYER_ART.hexagonRadius, player.moveHexRadius + step);
    const len = Math.hypot(player.moveLeanX, player.moveLeanY) || 1;
    const decay = Math.min(step, len);
    player.moveLeanX -= player.moveLeanX / len * decay;
    player.moveLeanY -= player.moveLeanY / len * decay;
  }
}

function drawHexRingPlayer(graphics, player) {
  const centerX = player.x;
  const centerY = player.y;
  const weaponColor = player.weapon?.ringColor || '#ffa914';
  const leanX = player.moveLeanX || 0, leanY = player.moveLeanY || 0;
  const hexRadius = player.moveHexRadius ?? PLAYER_ART.hexagonRadius;
  const innerK = PLAYER_LEAN.inner / PLAYER_LEAN.hex;
  const middleK = PLAYER_LEAN.middle / PLAYER_LEAN.hex;
  const outerK = PLAYER_LEAN.outer / PLAYER_LEAN.hex;

  drawHexagonBody(graphics, centerX, centerY, hexRadius, leanX, leanY);
  drawRing(graphics, centerX + leanX * innerK, centerY + leanY * innerK, PLAYER_ART.innerRingRadius, PLAYER_ART.innerRingThickness, weaponColor);
  drawRing(graphics, centerX + leanX * middleK, centerY + leanY * middleK, PLAYER_ART.outerRingRadius, PLAYER_ART.outerRingThickness, weaponColor);
  drawRing(graphics, centerX + leanX * outerK, centerY + leanY * outerK, PLAYER_ART.outer2RingRadius, PLAYER_ART.outer2RingThickness, weaponColor);
  drawRing(graphics, centerX, centerY, PLAYER_ART.bodyRingRadius, PLAYER_ART.bodyRingThickness, '#ffffff');
  drawRing(graphics, centerX, centerY, PLAYER_ART.weaponRingRadius, PLAYER_ART.weaponRingThickness, weaponColor);

  const orb = getWeaponOrbPosition(player);
  graphics.fillStyle(0xffffff);
  graphics.fillCircle(orb.x, orb.y, PLAYER_ART.weaponOrbRadius*1.25*1.5);
}

function drawShieldArc(graphics, player) {
  const t = player.shieldTimer || 0;
  if (t <= 0) return;
  const radius = PLAYER_ART.weaponRingRadius + SHIELD.gap;
  const thickness = PLAYER_ART.weaponRingThickness * 1.25;
  const half = Phaser.Math.DegToRad(SHIELD.arcDeg / 2);
  const angle = player.shieldAngle || 0;
  graphics.lineStyle(thickness, color(SHIELD.color), 0.9 * t);
  graphics.beginPath();
  graphics.arc(player.x, player.y, radius, angle - half, angle + half, false);
  graphics.strokePath();
}

function drawPlayer(graphics, player) {
  if (player.scheme === 'hex-ring' || player.scheme === 'yellow' || player.scheme === 'green') {
    drawHexRingPlayer(graphics, player);
    return;
  }

  drawDefaultPlayer(graphics, player.x, player.y);
}


export function createGameScene(ctx) {
  return class EditorScene extends Phaser.Scene {
    constructor() { super('scene'); this.editing = ctx.state.mode === 'editor'; this.ctx = ctx; }

    create() {
      this.bgG = this.add.graphics().setDepth(0);
      this.g = this.add.graphics().setDepth(10);
      this.barrelSprites = new Map();
      if (!this.textures.exists(BARREL_TEX_KEY)) {
        this.load.image(BARREL_TEX_KEY, BARREL_ICON);
        this.load.start();
      }
      if (!this.editing) this.setupUI();
      if (!this.editing) this.applyWorldBounds();
      this.input.on('pointerdown', p => this.pointerDown(p));
      this.input.on('pointermove', p => this.pointerMove(p));
      this.input.on('pointerup', () => { this.drag = null; this.panning = false; ctx.redraw(); });
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

    restart() {
      this.state = 'playing';
      this.kills = 0;
      this.bullets = [];
      this.lasers = [];
      this.enemyBullets = [];
      this.drops = [];
      this.hitEffects = [];
      this.fireClock = 0;
      this.triggered = new Set();
      this.triggerState = new Map();
      this.spawnEffects = [];
      this.transition = null;
      this.wheelAnim = null;
      if (this.waveEvents) {
        this.waveEvents.forEach(ev => ev.remove(false));
      }
      this.waveEvents = [];

      const l = ctx.state.level;
      this.crates = (l.crates || []).map(c => ({ ...c, alive: true }));
      this.barrels = (l.barrels || []).map(b => ({ ...b, alive: true }));
      this.crateDebris = [];
      this.barrelExplosions = [];

      const obstacles = [
        ...l.walls,
        ...(l.crates || []),
        ...(l.barrels || []).map(b => ({ x: b.x, y: b.y, w: b.r * 2, h: b.r * 2 }))
      ];
      this.grid = buildGrid({ width: l.world.width, height: l.world.height }, obstacles, CELL, PATH_INFLATE);
      const weapons = normalizeWeapons(l.spawn.weapons);
      const weaponType = weapons[0];
      const weapon = WEAPONS[weaponType] || WEAPONS.radial;
      const scheme = weapon.scheme;
      const level = l.spawn.level ?? 1;
      const maxHp = (l.spawn.maxHp ?? 100) + (level - 1) * LEVEL_HP_BONUS;
      const ammo = {};
      for (const w of weapons) ammo[w] = WEAPONS[w]?.maxAmmo ?? Infinity;

      this.player = {
        ...l.spawn,
        r: PLAYER_COLLISION_RADIUS,
        scheme,
        weapon,
        weaponType,
        weapons,
        weaponIndex: 0,
        ammo,
        hp: maxHp,
        maxHp,
        weaponLevel: l.spawn.weaponLevel || 1,
        weaponAngle: 0,
        weaponDirection: 1,
        previousFireDown: false,
        firing: false,
        moveHexRadius: PLAYER_ART.hexagonRadius,
        moveLeanX: 0,
        moveLeanY: 0,
        shieldActive: false,
        shieldAngle: 0,
        shieldTimer: 0,
        shield: SHIELD_MAX,
        maxShield: SHIELD_MAX,
        shieldBroken: false,
        charge: 0,
        hitFlash: null
      };

      this.enemies = (l.enemies || []).map(e => this.initEnemy(e));
      if (!this.editing) {
        this.buildUITexts();
        this.syncUIState();
      }
      if (!this.editing) this.setupPlayCamera();
      this.draw();
    }

    initEnemy(e) {
      const def = ENEMY_TYPES[e.type] || ENEMY_TYPES.basic1;
      const b = ENEMY_BEHAVIOR[e.type] || ENEMY_BEHAVIOR.basic1;
      const player = ctx.state.level.spawn;
      return {
        ...e,
        r: b.size / 2,
        alive: true,
        hp: e.hp ?? def.hp,
        maxHp: e.hp ?? def.hp,
        damage: e.damage ?? def.damage,
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
        wanderT: 0
      };
    }

    viewRect() {
      const cam = this.cameras.main;
      const halfW = cam.width / 2, halfH = cam.height / 2;
      return {
        x: cam.scrollX + halfW - halfW / cam.zoomX,
        y: cam.scrollY + halfH - halfH / cam.zoomY,
        w: cam.width / cam.zoomX,
        h: cam.height / cam.zoomY
      };
    }

    isInView(e) {
      const v = this.viewRect();
      return e.x >= v.x && e.x <= v.x + v.w && e.y >= v.y && e.y <= v.y + v.h;
    }

    moveToward(e, speed, sec) {
      const ang = Phaser.Math.Angle.Between(e.x, e.y, this.player.x, this.player.y);
      e.x += Math.cos(ang) * speed * sec;
      e.y += Math.sin(ang) * speed * sec;
    }

    resolveMovementCollision(entity, r) {
      const l = ctx.state.level;
      resolveCircleAgainstWalls(entity, r, l.walls);

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
    }

    resolveEnemyCollision(e) {
      const { w: ww, h: wh } = this.worldSize();
      const r = e.r;
      e.x = Phaser.Math.Clamp(e.x, r, ww - r);
      e.y = Phaser.Math.Clamp(e.y, r, wh - r);
      this.resolveMovementCollision(e, r);
    }

    spawnCrateDebris(c) {
      const s = CRATE_SIZE / 2;
      const half = s - CRATE_INSET;
      const edges = [
        { cx: c.x, cy: c.y - s, horizontal: true },
        { cx: c.x + s, cy: c.y, horizontal: false },
        { cx: c.x, cy: c.y + s, horizontal: true },
        { cx: c.x - s, cy: c.y, horizontal: false }
      ];
      const segments = edges.map(edge => {
        const a = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 120;
        return {
          cx: edge.cx,
          cy: edge.cy,
          horizontal: edge.horizontal,
          half,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed
        };
      });
      this.crateDebris.push({ ttl: CRATE_DEBRIS_TTL, segments });
    }

    explodeBarrel(b) {
      b.alive = false;
      this.hitEffects.push({ x: b.x, y: b.y, ttl: HIT_FX_TTL });

      const radius = b.explodeRadius || 150;
      const img = this.add.image(b.x, b.y, BARREL_TEX_KEY).setOrigin(0.5).setDepth(11);
      if (this.uiCam) this.uiCam.ignore(img);
      const tw = img.frame?.width || 60;
      img.setScale(radius * 2 / tw);
      this.barrelExplosions.push({ img, ttl: BARREL_EXPLOSION_MS });

      const pd = Math.hypot(this.player.x - b.x, this.player.y - b.y);
      if (pd < radius) {
        this.damagePlayer(BARREL_DAMAGE);
      }

      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < radius) {
          e.hp -= BARREL_DAMAGE;
          this.hitEffects.push({ x: e.x, y: e.y, ttl: HIT_FX_TTL });
          if (e.hp <= 0) this.defeatEnemy(e);
        }
      }

      for (const o of this.barrels) {
        if (o.alive && o !== b && Math.hypot(o.x - b.x, o.y - b.y) < radius) {
          this.explodeBarrel(o);
        }
      }

      for (const c of this.crates) {
        if (!c.alive) continue;
        const nearestX = Math.max(c.x - c.w / 2, Math.min(b.x, c.x + c.w / 2));
        const nearestY = Math.max(c.y - c.h / 2, Math.min(b.y, c.y + c.h / 2));
        if (Math.hypot(b.x - nearestX, b.y - nearestY) < radius) {
          c.alive = false;
          this.hitEffects.push({ x: c.x, y: c.y, ttl: HIT_FX_TTL });
          this.spawnCrateDebris(c);
        }
      }
    }

    hasLOS(x0, y0, x1, y1) {
      const dx = x1 - x0, dy = y1 - y0;
      return !ctx.state.level.walls.some(w => {
        const t = rayRotatedRectDistance(x0, y0, dx, dy, w);
        return t !== null && t <= 1;
      });
    }

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
    }

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
    }

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
    }

    stepAdvanced2(e, dt, b, sec) {
      const p = this.player;
      const dist = Math.hypot(e.x - p.x, e.y - p.y);

      if (!e.aggressive) {
        if (dist < b.attackRange) {
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
      if (dist < b.attackRange) {
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
    }

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
    }

    defeatEnemy(e) {
      if (!e.alive) return;
      e.alive = false;
      this.kills++;
      this.spawnDrops(e);
    }

    spawnDrops(e) {
      const d = e.drops || {};
      const counts = { gold: Number(d.gold) || 0, exp: Number(d.exp) || 0, charge: Number(d.charge) || 0 };
      for (const [type, count] of Object.entries(counts)) {
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const driftSpeed = type === 'gold' ? 10 : 20;
          const driftTtl = type === 'gold' ? 1000 : 600;
          this.drops.push({
            type,
            x: e.x + (Math.random() - 0.5) * 30,
            y: e.y + (Math.random() - 0.5) * 30,
            drift: { vx: Math.cos(angle) * driftSpeed, vy: Math.sin(angle) * driftSpeed, ttl: driftTtl }
          });
        }
      }
    }

    collectDrop(d) {
      if (d.type === 'exp') this.player.exp = (this.player.exp || 0) + 1;
      else if (d.type === 'charge') this.player.charge = (this.player.charge || 0) + 1;
      else if (d.type === 'gold') this.player.gold = (this.player.gold || 0) + 1;
    }

    updateDrops(dt) {
      const sec = dt / 1000;
      this.drops = this.drops.filter(d => {
        if (d.drift && d.drift.ttl > 0) {
          d.drift.ttl -= dt;
          d.x += d.drift.vx * sec;
          d.y += d.drift.vy * sec;
          return true;
        }

        if (d.type === 'gold') {
          const dist = Math.hypot(this.player.x - d.x, this.player.y - d.y);
          if (dist < PICKUP_RADIUS) { this.collectDrop(d); return false; }
          return true;
        }

        const dx = this.player.x - d.x, dy = this.player.y - d.y;
        const dist = Math.hypot(dx, dy);
        const step = 800 * sec;
        if (dist < step) { this.collectDrop(d); return false; }
        d.x += dx / dist * step;
        d.y += dy / dist * step;
        return true;
      });
    }

    damagePlayer(dmg) {
      this.player.hp = Math.max(0, (this.player.hp ?? 100) - dmg);
      this.player.hitFlash = {
        alpha: 1,
        total: Phaser.Math.Clamp(dmg * 40, 200, 1200),
        t: 0
      };
      if (this.player.hp <= 0) {
        this.state = 'fail';
        this.syncUIState();
      }
    }

    blockWithShield(x, y, damage, extraRadius) {
      if (!this.player.shieldActive || this.player.shieldBroken) return false;
      const toP = Phaser.Math.Angle.Between(this.player.x, this.player.y, x, y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toP - this.player.shieldAngle));
      const radius = PLAYER_ART.weaponRingRadius + SHIELD.gap + (extraRadius || 0);
      if (diff <= Phaser.Math.DegToRad(SHIELD.arcDeg / 2) && Math.hypot(x - this.player.x, y - this.player.y) < radius) {
        this.player.shield = Math.max(0, this.player.shield - (damage || 0));
        this.hitEffects.push({ x, y, ttl: HIT_FX_TTL, color: SHIELD_HIT_COLOR });
        this.cameras.main.shake(SHIELD_SHAKE_MS, SHIELD_SHAKE_INTENSITY);
        if (this.player.shield <= 0) {
          this.player.shieldBroken = true;
          this.player.shieldActive = false;
          this.player.shieldTimer = 0;
        }
        return true;
      }
      return false;
    }

    hitShield(e) {
      this.defeatEnemy(e);
      this.blockWithShield(e.x, e.y, e.damage, e.r);
    }

    pointInWall(x, y) {
      return ctx.state.level.walls.some(w => hitWall(w, x, y));
    }

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
    }

    spawnOffscreen(t) {
      const cfg = t.spawn || {};
      const count = Math.max(1, Number(cfg.count) || 5);
      const v = this.viewRect();
      const off = SPAWN_OFFSCREEN_PX / this.cameras.main.zoomX;
      const { w: ww, h: wh } = this.worldSize();

      for (let i = 0; i < count; i++) {
        let p = null;
        for (let attempt = 0; attempt < 8 && !p; attempt++) {
          const c = this.sampleRingPoint(v, off, ww, wh);
          if (!this.pointInWall(c.x, c.y)) p = c;
        }
        if (!p) p = this.sampleRingPoint(v, off, ww, wh);
        this.enemies.push(this.initEnemy({ x: p.x, y: p.y, type: cfg.enemyType || 'basic1' }));
      }
    }

    createSpawnEffect(t, wave) {
      const s = t.spawn || {};
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
        phase: 'draw',
        progress: 0,
        spawned: 0,
        spawnedEnemies: [],
        holdT: 0,
        holdDuration: 500,
        cx: this.player.x,
        cy: this.player.y,
        startAngle: -Math.PI / 2
      });
    }

    spawnAtVertex(fx, i, total) {
      const angle = fx.startAngle + (i / total) * Math.PI * 2;
      const x = fx.cx + Math.cos(angle) * fx.radius;
      const y = fx.cy + Math.sin(angle) * fx.radius;
      const enemy = this.initEnemy({ x, y, type: fx.enemyType });
      enemy.frozen = true;
      fx.spawnedEnemies.push(enemy);
      this.enemies.push(enemy);
    }

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
    }

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
    }

    fireTrigger(t) {
      if (t.action === 'spawnEnemy') {
        this.triggerSpawnEnemy(t);
        return;
      }
      if (t.action === 'switchLevel') {
        this.beginSwitch(t);
        return;
      }
      this.state = 'end';
    }

    triggerSpawnEnemy(t) {
      if ((t.spawn || {}).mode === 'offscreen') this.spawnOffscreen(t);
      else this.scheduleSurroundWaves(t);
    }

    scheduleSurroundWaves(t) {
      const s = t.spawn || {};
      const waves = Array.isArray(s.waves) && s.waves.length ? s.waves : [s];
      const interval = Math.max(0, Number(s.waveInterval) || 0);
      waves.forEach((w, i) => {
        this.waveEvents.push(this.time.delayedCall(i * interval, () => this.createSpawnEffect(t, w)));
      });
    }

    updateTriggers() {
      const l = ctx.state.level;
      for (const t of l.triggers) {
        const inside = hitTrigger(t, this.player.x, this.player.y);

        if (t.action === 'switchLevel' || t.once !== false) {
          if (this.triggered.has(t.id)) continue;
          if (inside) {
            this.triggered.add(t.id);
            this.fireTrigger(t);
          }
          continue;
        }

        const st = this.triggerState.get(t.id) || { inside: false, lastFire: -1e9 };
        if (inside && !st.inside && this.time.now - st.lastFire >= (t.cooldown || 0)) {
          st.lastFire = this.time.now;
          this.fireTrigger(t);
        }
        st.inside = inside;
        this.triggerState.set(t.id, st);
      }
    }

    beginSwitch(t) {
      this.transition = {
        phase: 'out',
        alpha: 0,
        target: t.target,
        spawnPoint: t.spawnPoint,
        switching: false
      };
      this.state = 'transition';
    }

    updateTransition(dt) {
      const tr = this.transition;
      if (!tr) return;
      if (tr.phase === 'out') {
        tr.alpha = Math.min(1, tr.alpha + dt / SWITCH_FADE_MS);
        if (tr.alpha >= 1 && !tr.switching) {
          tr.switching = true;
          ctx.onSwitchLevel?.(tr.target, tr.spawnPoint, () => {
            this.restart();
            tr.phase = 'in';
            tr.alpha = 1;
            this.transition = tr;
            this.state = 'transition';
          });
        }
      } else if (tr.phase === 'in') {
        tr.alpha = Math.max(0, tr.alpha - dt / SWITCH_FADE_MS);
        if (tr.alpha <= 0) {
          this.transition = null;
          this.state = 'playing';
        }
      }
    }

    pointerDown(p) {
      if (!this.editing) {
        if (this.state === 'paused') { this.onUIPointer(p); return; }
        if (this.state === 'end' || this.state === 'fail') this.restart();
        return;
      }

      if (p.middleButtonDown() || p.rightButtonDown()) {
        this.panning = true;
        this.panStart = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
        return;
      }

      const l = ctx.state.level;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const x = snap(wp.x);
      const y = snap(wp.y);
      const tool = ctx.state.tool;
      const selected = ctx.state.selected;
      const selectedWall = selected && l.walls.includes(selected);
      const selectedTrigger = selected && l.triggers.includes(selected);

      if (tool === 'select' && selected && (selectedWall || selectedTrigger)) {
        if (selectedWall && rotationHandleAt(selected, wp.x, wp.y)) {
          this.drag = { mode: 'rotate', entity: selected };
          return;
        }
        const handle = handleAtRect(selected, wp.x, wp.y);
        if (handle) {
          this.drag = { mode: 'resize', handle, entity: selected };
          return;
        }
      }

      if (tool === 'select' && selected && selected === l.background) {
        const bh = backgroundHandleAt(selected, wp.x, wp.y);
        if (bh) {
          this.drag = { mode: 'bg-resize', handle: bh, entity: selected };
          return;
        }
      }

      if (tool === 'erase') {
        const hit = pickTopEntity(l, wp.x, wp.y);
        if (hit) {
          if (hit.type === 'wall') {
            l.walls = l.walls.filter(w => w !== hit.entity);
          } else if (hit.type === 'enemy') {
            l.enemies = l.enemies.filter(e => e !== hit.entity);
          } else if (hit.type === 'trigger') {
            l.triggers = l.triggers.filter(t => t !== hit.entity);
          } else if (hit.type === 'crate') {
            l.crates = l.crates.filter(c => c !== hit.entity);
          } else if (hit.type === 'barrel') {
            l.barrels = l.barrels.filter(b => b !== hit.entity);
          } else if (hit.type === 'background') {
            l.background = null;
          }
        }
        if (selected && !l.walls.includes(selected) && !l.triggers.includes(selected)
          && !l.enemies.includes(selected) && !l.crates.includes(selected)
          && !l.barrels.includes(selected) && selected !== l.background) {
          ctx.state.selected = null;
        }
      } else if (tool === 'wall') {
        l.walls.push({ id: `wall-${Date.now()}`, x, y, w: CELL, h: CELL * 3, color: DEFAULT_WALL_COLOR });
      } else if (tool === 'enemy') {
        l.enemies.push(normalizeEnemy({ x, y }, l.enemies.length));
      } else if (tool === 'spawn') {
        l.spawn = { ...l.spawn, x, y };
        ctx.state.selected = l.spawn;
      } else if (tool === 'trigger') {
        l.triggers.push({ id: `trigger-${Date.now()}`, x, y, w: CELL * 3, h: CELL * 2, color: '#f3b63f', visible: true, action: 'complete', once: true });
      } else if (tool === 'crate') {
        l.crates.push(normalizeCrate({ x, y }, l.crates.length));
      } else if (tool === 'barrel') {
        l.barrels.push(normalizeBarrel({ x, y }, l.barrels.length));
      } else {
        const hit = pickTopEntity(l, wp.x, wp.y);
        const entity = hit ? hit.entity : null;
        if (entity === l.background) {
          this.drag = { mode: 'bg-move', entity };
        } else {
          this.drag = entity && entity !== l.spawn ? { mode: 'move', entity } : entity === l.spawn ? { mode: 'spawn' } : null;
        }
        ctx.state.selected = entity;
      }

      ctx.redraw();
    }

    pointerMove(p) {
      if (!this.editing) return;

      if (this.panning) {
        const cam = this.cameras.main;
        cam.scrollX = this.panStart.sx - (p.x - this.panStart.x) / cam.zoomX;
        cam.scrollY = this.panStart.sy - (p.y - this.panStart.y) / cam.zoomY;
        this.clampEditorView();
        this.draw();
        return;
      }

      if (!this.drag) return;

      const wp = this.cameras.main.getWorldPoint(p.x, p.y);

      if (this.drag.mode === 'spawn') {
        ctx.state.level.spawn = { ...ctx.state.level.spawn, x: snap(wp.x), y: snap(wp.y) };
        ctx.state.selected = ctx.state.level.spawn;
      } else if (this.drag.mode === 'move') {
        this.drag.entity.x = snap(wp.x);
        this.drag.entity.y = snap(wp.y);
      } else if (this.drag.mode === 'rotate') {
        const angle = Phaser.Math.Angle.Between(this.drag.entity.x, this.drag.entity.y, wp.x, wp.y) + Math.PI / 2;
        this.drag.entity.rotation = Math.round(Phaser.Math.RadToDeg(angle) / 5) * 5;
      } else if (this.drag.mode === 'bg-move') {
        this.drag.entity.x = wp.x;
        this.drag.entity.y = wp.y;
      } else if (this.drag.mode === 'bg-resize') {
        resizeBackground(this.drag.entity, this.drag, wp.x, wp.y);
      } else {
        resizeRect(this.drag.entity, this.drag, wp.x, wp.y);
      }

      ctx.redraw();
    }
    update(_, dt) {
      if (this.editing) return this.draw();

      if (this.keys.ESC && Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
        if (this.state === 'paused') {
          ctx.onExitPreview?.();
          return;
        }
        this.toggleGrowth();
      }

      if (this.state === 'transition') {
        this.updateTransition(dt);
        this.draw();
        return;
      }

      if (this.state !== 'playing') {
        this.draw();
        return;
      }

      let dx = 0, dy = 0;
      if (this.keys.A.isDown || this.keys.LEFT.isDown) dx--;
      if (this.keys.D.isDown || this.keys.RIGHT.isDown) dx++;
      if (this.keys.W.isDown || this.keys.UP.isDown) dy--;
      if (this.keys.S.isDown || this.keys.DOWN.isDown) dy++;

      updatePlayerMoveLean(this.player, dx, dy, dt);

      const { w: ww, h: wh } = this.worldSize();
      const n = Math.hypot(dx, dy) || 1;
      const r = this.player.r;
      this.player.x = Phaser.Math.Clamp(this.player.x + dx / n * 180 * dt / 1000, r, ww - r);
      this.player.y = Phaser.Math.Clamp(this.player.y + dy / n * 180 * dt / 1000, r, wh - r);
      this.resolveMovementCollision(this.player, r);

      const pointer = this.input.activePointer;
      const fireDown = pointer.leftButtonDown();

      this.player.shieldActive = this.keys.SPACE.isDown && !this.player.shieldBroken;
      if (this.player.shieldActive) {
        this.player.shieldTimer = Math.min(1, this.player.shieldTimer + dt / SHIELD.fadeMs);
        const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.player.shieldAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, wp.x, wp.y);
      } else {
        this.player.shieldTimer = 0;
      }

      if (this.player.previousFireDown && !fireDown) {
        this.player.weaponDirection *= -1;
      }

      const angularSpeed = Phaser.Math.DegToRad(fireDown ? 20 : 180);
      this.player.weaponAngle = Phaser.Math.Angle.Wrap(
        this.player.weaponAngle + this.player.weaponDirection * angularSpeed * dt / 1000
      );
      this.player.firing = fireDown;
      this.player.previousFireDown = fireDown;

      if (fireDown && this.fireClock <= 0) {
        const wt = this.player.weaponType;
        const currentAmmo = this.player.ammo[wt];
        if (currentAmmo === undefined || currentAmmo > 0) {
          const shots = this.player.weapon.fire(this.player, this.player.weaponLevel, this);
          for (const s of shots) {
            if (s.laser) this.lasers.push(s);
            else this.bullets.push(s);
          }
          if (currentAmmo !== Infinity) this.player.ammo[wt] = currentAmmo - 1;
          this.fireClock = this.player.weapon.fireInterval || 120;
        }
      }
      this.fireClock -= dt;
      this.lasers = this.lasers.filter(l => (l.ttl -= dt) > 0);

      const l = ctx.state.level;

      this.bullets = this.bullets.filter(b => {
        b.x += b.vx * dt / 1000;
        b.y += b.vy * dt / 1000;
        b.dist += Math.hypot(b.vx, b.vy) * dt / 1000;
        WEAPONS[b.weaponType]?.stepBullet?.(b, dt, this);

        let hit = l.walls.some(w => hitWall(w, b.x, b.y, 3));

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
            e.hp -= BULLET_DAMAGE;
            this.hitEffects.push({ x: b.x, y: b.y, ttl: HIT_FX_TTL });
            if (e.hp <= 0) this.defeatEnemy(e);
            hit = true;
            break;
          }
        }

        return !hit && b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
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

        if (l.walls.some(w => Math.abs(b.x - w.x) < w.w / 2 + 3 && Math.abs(b.y - w.y) < w.h / 2 + 3)) {
          return false;
        }

        if (this.blockWithShield(b.x, b.y, b.damage, 4)) {
          return false;
        }

        if (Math.hypot(b.x - this.player.x, b.y - this.player.y) < this.player.r + 5) {
          this.damagePlayer(b.damage);
          return false;
        }

        return b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
      });

      this.updateDrops(dt);
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

      if (this.player.hitFlash) {
        this.player.hitFlash.t += dt;
        this.player.hitFlash.alpha = Math.max(0, 1 - this.player.hitFlash.t / this.player.hitFlash.total);
        if (this.player.hitFlash.alpha <= 0) this.player.hitFlash = null;
      }

      if (this.wheelAnim) {
        this.wheelAnim.t += dt;
        if (this.wheelAnim.t >= this.wheelAnim.dur) this.wheelAnim = null;
      }

      this.updateTriggers();

      if (this.state === 'playing' && this.enemies.length && this.enemies.every(e => !e.alive)) {
        if (!this.isMenuLevel()) {
          this.state = 'end';
          ctx.onLevelResult?.('completed');
        }
      }

      this.updatePlayCamera();
      this.syncUIState();
      this.draw();
    }

    loadBackgroundImage() {
      if (this.bgImage) {
        this.bgImage.destroy();
        this.bgImage = null;
      }
      const key = '__level_bg__';
      if (this.textures.exists(key)) this.textures.remove(key);

      const bg = ctx.state.level.background;
      if (!bg?.src) return;

      this.load.once('complete', () => {
        if (!this.textures.exists(key)) return;
        this.bgImage = this.add.image(bg.x, bg.y, key).setOrigin(0.5).setDepth(1);
        if (this.uiCam) this.uiCam.ignore(this.bgImage);
        this.applyBackground();
      });
      this.load.image(key, bg.src);
      this.load.start();
    }

    reloadBackground() {
      this.loadBackgroundImage();
    }

    applyBackground() {
      const bg = ctx.state.level.background;
      if (!this.bgImage) return;
      if (!bg?.src) {
        this.bgImage.setVisible(false);
        return;
      }
      this.bgImage.setVisible(bg.visible !== false);
      this.bgImage.setPosition(bg.x, bg.y);
      const frame = this.bgImage.frame;
      const tw = frame?.width || bg.w;
      const th = frame?.height || bg.h;
      this.bgImage.setScale(bg.w / tw, bg.h / th);
    }

    syncBarrelSprites() {
      if (!this.textures.exists(BARREL_TEX_KEY)) return;

      const barrels = this.editing
        ? (ctx.state.level.barrels || [])
        : this.barrels.filter(b => b.alive);

      const seen = new Set();
      for (const b of barrels) {
        seen.add(b.id);
        let img = this.barrelSprites.get(b.id);
        if (!img) {
          img = this.add.image(b.x, b.y, BARREL_TEX_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.barrelSprites.set(b.id, img);
        }
        img.setPosition(b.x, b.y);
        const tw = img.frame?.width || 60;
        img.setScale((b.r * 2) / tw);
      }

      for (const [id, img] of this.barrelSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.barrelSprites.delete(id);
        }
      }
    }

    draw() {
      const l = ctx.state.level;
      const g = this.g;
      const { w: ww, h: wh } = this.worldSize();

      this.bgG.clear();
      this.bgG.fillStyle(color(l.backgroundColor));
      this.bgG.fillRect(0, 0, ww, wh);
      this.applyBackground();

      g.clear();

      if (l.background?.fx === 'wormhole') drawWormhole(g, l.background, this.time.now / 1000);

      if ((this.editing && ctx.state.showGridInEditor) || (!this.editing && l.showGridInPlay)) {
        const gridW = this.cameras.main.zoomX ? 1 / this.cameras.main.zoomX : 1;
        g.lineStyle(gridW, color(l.gridColor), .7);
        for (let x = 0; x <= ww; x += CELL) g.lineBetween(x, 0, x, wh);
        for (let y = 0; y <= wh; y += CELL) g.lineBetween(0, y, ww, y);
      }

      l.walls.forEach(w => {
        const corners = wallCorners(w);
        g.fillStyle(color(w.color || DEFAULT_WALL_COLOR));
        g.beginPath();
        g.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
        g.closePath();
        g.fillPath();

        if (ctx.state.selected === w && this.editing) {
          g.lineStyle(2, 0xffe083);
          g.beginPath();
          g.moveTo(corners[0].x, corners[0].y);
          for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
          g.closePath();
          g.strokePath();

          for (const c of corners) {
            g.fillStyle(0xffffff);
            g.fillRect(c.x - 5, c.y - 5, 10, 10);
          }

          const r = wallRotationRad(w);
          const cr = Math.cos(r), sr = Math.sin(r);
          const off = ROTATE_HANDLE_OFFSET + w.h / 2;
          const rhx = w.x + off * sr;
          const rhy = w.y - off * cr;
          g.lineStyle(1, 0xffffff, .8);
          g.lineBetween(w.x, w.y, rhx, rhy);
          g.fillStyle(0xffe083);
          g.fillCircle(rhx, rhy, 6);
        }
      });

      const crates = this.editing ? (l.crates || []) : this.crates.filter(c => c.alive);
      crates.forEach(c => {
        drawCrate(g, c.x, c.y);
        if (this.editing && ctx.state.selected === c) {
          g.lineStyle(2, 0xffe083);
          g.strokeRect(c.x - c.w / 2, c.y - c.h / 2, c.w, c.h);
        }
      });

      this.syncBarrelSprites();
      const barrels = this.editing ? (l.barrels || []) : this.barrels.filter(b => b.alive);
      barrels.forEach(b => {
        if (this.editing && ctx.state.selected === b) {
          g.lineStyle(2, 0xffe083);
          g.strokeCircle(b.x, b.y, b.r + 2);
        }
      });

      if (!this.editing) {
        this.crateDebris.forEach(d => drawCrateDebris(g, d));
      }

      l.triggers.forEach(t => {
        if (!t.visible && !this.editing) return;
        g.fillStyle(color(t.color));
        g.fillRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h);
        g.lineStyle(2, ctx.state.selected === t ? 0xffe083 : 0xffffff, .6);
        g.strokeRect(t.x - t.w / 2, t.y - t.h / 2, t.w, t.h);

        if (ctx.state.selected === t && this.editing) {
          for (const [hx, hy] of [
            [t.x - t.w / 2, t.y - t.h / 2],
            [t.x + t.w / 2, t.y - t.h / 2],
            [t.x - t.w / 2, t.y + t.h / 2],
            [t.x + t.w / 2, t.y + t.h / 2]
          ]) {
            g.fillStyle(0xffffff);
            g.fillRect(hx - 5, hy - 5, 10, 10);
          }
        }
      });

      if (this.editing) {
        g.fillStyle(0x45c8ff);
        g.fillCircle(l.spawn.x, l.spawn.y, 14);
        if (ctx.state.selected === l.spawn) {
          g.lineStyle(2, 0xffe083);
          g.strokeCircle(l.spawn.x, l.spawn.y, 20);
        }
      }

      if (this.editing) {
        l.enemies.forEach(e => drawEnemyShape(g, e, false));
      } else {
        this.drawSpawnEffects(g);
        this.enemies.forEach(e => { if (e.alive) drawEnemyShape(g, e, true, this.player); });
        this.hitEffects.forEach(h => {
          g.fillStyle(h.color || 0xffffff, Math.max(0, h.ttl / HIT_FX_TTL));
          g.fillCircle(h.x, h.y, HIT_FX_RADIUS);
        });
        this.drops.forEach(d => {
          if (d.type === 'gold') drawGoldHex(g, d.x, d.y);
          else {
            g.fillStyle(d.type === 'charge' ? 0x3a7bff : 0xffffff);
            g.fillCircle(d.x, d.y, 3);
          }
        });
      }

      if (!this.editing) {
        if (!this.isMenuLevel()) {
          drawPlayer(g, this.player);
          drawShieldArc(g, this.player);
          this.lasers.forEach(l => {
            g.lineStyle(l.width, color(l.color), 0.9);
            g.lineBetween(l.x0, l.y0, l.x1, l.y1);
          });
          this.bullets.forEach(b => WEAPONS[b.weaponType]?.drawBullet(g, b));
          this.enemyBullets.forEach(b => {
            const speed = Math.hypot(b.vx, b.vy) || 1;
            const ux = b.vx / speed, uy = b.vy / speed;
            const px = -uy, py = ux;
            const gap = 1;
            const tailStartX = b.x - ux * gap;
            const tailStartY = b.y - uy * gap;
            const tailEndX = b.x - ux * (gap + b.trailLen);
            const tailEndY = b.y - uy * (gap + b.trailLen);
            g.fillStyle(0xffffff, 0.9);
            g.beginPath();
            g.moveTo(tailStartX + px * 2.5, tailStartY + py * 2.5);
            g.lineTo(tailEndX, tailEndY);
            g.lineTo(tailStartX - px * 2.5, tailStartY - py * 2.5);
            g.closePath();
            g.fillPath();
            g.fillStyle(0xffffff);
            g.fillCircle(b.x, b.y, 2.5);
          });
          this.drawHitFlash(g);
        }
        this.drawUI();
      }

      if (this.editing && l.background && ctx.state.selected === l.background) {
        const bg = l.background;
        if (bg.fx === 'wormhole') {
          g.lineStyle(2, 0x6fd3ff);
          g.strokeCircle(bg.x, bg.y, bg.radius + 20);
        } else {
          g.lineStyle(2, 0x6fd3ff);
          g.strokeRect(bg.x - bg.w / 2, bg.y - bg.h / 2, bg.w, bg.h);
          for (const [hx, hy] of [
            [bg.x - bg.w / 2, bg.y - bg.h / 2],
            [bg.x + bg.w / 2, bg.y - bg.h / 2],
            [bg.x - bg.w / 2, bg.y + bg.h / 2],
            [bg.x + bg.w / 2, bg.y + bg.h / 2]
          ]) {
            g.fillStyle(0xffffff);
            g.fillRect(hx - 5, hy - 5, 10, 10);
          }
        }
      }

      if (ctx.state.selected && ctx.state.selected !== l.spawn && !l.triggers.includes(ctx.state.selected) && ctx.state.selected !== l.background) {
        g.lineStyle(2, 0xffe083);
        g.strokeCircle(ctx.state.selected.x, ctx.state.selected.y, 22);
      }
    }

    drawHitFlash(g) {
      if (!this.player.hitFlash || this.player.hitFlash.alpha <= 0) return;
      const v = this.viewRect();
      const alpha = this.player.hitFlash.alpha * 0.85;
      g.fillStyle(0xff0000, alpha);
      g.beginPath();
      g.moveTo(v.x, v.y);
      g.lineTo(v.x + v.w, v.y);
      g.lineTo(v.x + v.w, v.y + v.h);
      g.lineTo(v.x, v.y + v.h);
      g.closePath();
      g.arc(this.player.x, this.player.y, HIT_FLASH_RADIUS, 0, Math.PI * 2, true);
      g.fillPath();
    }

    setupUI() {
      this.uiCam = this.cameras.add(0, 0, VIEW_W, VIEW_H).setScroll(0, 0).setZoom(1);
      this.uiG = this.add.graphics().setDepth(1000);
      this.cameras.main.ignore(this.uiG);
      this.uiCam.ignore(this.g);
      this.uiCam.ignore(this.bgG);
      this.uiTexts = { battle: new Map(), interface: new Map(), login: new Map() };
      this.uiImages = { battle: new Map(), interface: new Map(), login: new Map() };
      this.buttons = [];

      this.failTitle = this.add.text(VIEW_W / 2, VIEW_H / 2 - 40, '失败', {
        fontFamily: "'Poppins', 'Noto Sans SC', sans-serif",
        fontSize: '64px', color: '#ffffff'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.failTitle);
      this.failHint = this.add.text(VIEW_W / 2, VIEW_H / 2 + 40, '点击屏幕重新开始', {
        fontFamily: "'Poppins', 'Noto Sans SC', sans-serif",
        fontSize: '28px', color: '#9fc3d8'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.failHint);
      this.failTitle.setVisible(false);
      this.failHint.setVisible(false);

      this.weaponLabels = [];
      for (let i = 0; i < 3; i++) {
        const t = this.add.text(0, 0, '', {
          fontFamily: "'Poppins', 'Noto Sans SC', sans-serif",
          fontSize: '22px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(1001);
        this.cameras.main.ignore(t);
        t.setVisible(false);
        this.weaponLabels.push(t);
      }

      this.ammoCurrent = this.add.text(0, 0, '', {
        fontFamily: "'Rajdhani', monospace",
        fontSize: '45px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.ammoCurrent);
      this.ammoMax = this.add.text(0, 0, '', {
        fontFamily: "'Rajdhani', monospace",
        fontSize: '30px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.ammoMax);

      this.weaponIconImage = null;
      this.loadWeaponIcon();
      this.loadUIImages();
    }

    loadUIImages() {
      const ui = ctx.state.ui || {};
      for (const key of ['battle', 'interface', 'login']) {
        for (const node of ui[key]?.nodes || []) {
          if (node.type !== 'image' || !node.src) continue;
          if (this.uiImages[key].has(node.id)) continue;
          const texKey = `__ui_img_${key}_${node.id}__`;
          const img = new Image();
          img.onload = () => {
            if (this.textures.exists(texKey)) this.textures.remove(texKey);
            this.textures.addImage(texKey, img);
            const sprite = this.add.image(node.x, node.y, texKey).setOrigin(0.5).setDepth(1001);
            this.cameras.main.ignore(sprite);
            sprite.setDisplaySize(node.w || img.width, node.h || img.height);
            sprite.setVisible(false);
            this.uiImages[key].set(node.id, sprite);
          };
          img.src = node.src;
        }
      }
    }

    loadWeaponIcon() {
      const key = 'weapon-yellow';
      const img = new Image();
      img.onload = () => {
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addImage(key, img);
        this.weaponIconImage = this.add.image(0, 0, key).setOrigin(0.5).setDepth(1001);
        this.cameras.main.ignore(this.weaponIconImage);
        this.weaponIconImage.setDisplaySize(80, 80);
        this.weaponIconImage.setVisible(false);
      };
      img.src = '图标/ninja_icon.svg';
    }

    buildUITexts() {
      if (!this.uiTexts) this.uiTexts = { battle: new Map(), interface: new Map(), login: new Map() };
      if (!this.uiImages) this.uiImages = { battle: new Map(), interface: new Map(), login: new Map() };
      for (const map of Object.values(this.uiTexts)) {
        for (const t of map.values()) t.destroy();
        map.clear();
      }
      for (const map of Object.values(this.uiImages)) {
        for (const s of map.values()) s.destroy();
        map.clear();
      }
      this.loadUIImages();

      const ui = ctx.state.ui || {};
      for (const key of ['battle', 'interface', 'login']) {
        const nodes = ui[key]?.nodes || [];
        for (const node of nodes) {
          if (node.type !== 'text') continue;
          const text = this.add.text(node.x, node.y, '', {
            fontFamily: "'Poppins', 'Noto Sans SC', sans-serif",
            fontSize: `${node.size || 24}px`,
            color: node.color || '#eaf4fb',
            fontStyle: node.bold ? 'bold' : 'normal'
          });
          text.setDepth(1001);
          this.cameras.main.ignore(text);
          this.uiTexts[key].set(node.id, text);
        }
      }
    }

    isMenuLevel() {
      return (ctx.state.level?.ui || 'battle') === 'login';
    }

    syncUIState() {
      const p = this.player || {};
      const interfaceLevel = (ctx.state.level?.ui || 'battle') === 'interface';
      const loginLevel = this.isMenuLevel();
      this.uiState = {
        screen: loginLevel ? 'login' : (this.state === 'paused' || this.state === 'end' || interfaceLevel) ? 'interface' : 'battle',
        hp: p.hp ?? 100,
        maxHp: p.maxHp ?? 100,
        shield: p.shield ?? 0,
        maxShield: p.maxShield ?? SHIELD_MAX,
        slots: 1 + WEAPON_SLOT_LEVELS.filter(lv => (p.level ?? 1) >= lv).length,
        level: p.level ?? 1,
        exp: p.exp ?? 0,
        expToNext: p.expToNext ?? 100,
        gold: p.gold ?? 0,
        kills: this.kills,
        weaponLevel: p.weaponLevel ?? 1
      };
    }

    drawUI() {
      if (!this.uiG) return;
      this.uiG.clear();
      this.buttons = [];
      for (const map of Object.values(this.uiTexts || {})) {
        for (const t of map.values()) t.setVisible(false);
      }
      for (const map of Object.values(this.uiImages || {})) {
        for (const s of map.values()) s.setVisible(false);
      }

      if (this.failTitle) {
        this.failTitle.setVisible(this.state === 'fail');
        this.failHint.setVisible(this.state === 'fail');
      }
      if (this.state === 'fail') {
        this.uiG.fillStyle(0x000000, 0.65);
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
        this.hideHudOverlay();
        return;
      }

      const ui = ctx.state.ui || {};
      const interfaceLevel = (ctx.state.level?.ui || 'battle') === 'interface';
      if (this.isMenuLevel()) {
        this.hideHudOverlay();
        renderGraph(this.uiG, ui.login, this.uiState, BINDINGS, { texts: this.uiTexts?.login, images: this.uiImages?.login, buttons: this.buttons });
      } else if (this.state === 'paused' || this.state === 'end' || interfaceLevel) {
        this.hideHudOverlay();
        renderGraph(this.uiG, ui.interface, this.uiState, BINDINGS, { texts: this.uiTexts?.interface, images: this.uiImages?.interface, buttons: this.buttons });
      } else {
        renderGraph(this.uiG, ui.battle, this.uiState, BINDINGS, { texts: this.uiTexts?.battle, images: this.uiImages?.battle, buttons: this.buttons });
        if (this.player) this.drawHud();
      }

      if (this.transition) {
        this.uiG.fillStyle(0x000000, this.transition.alpha);
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
      }
    }

    drawHud() {
      const g = this.uiG;
      const p = this.player;
      drawHudAvatar(g, 70, 1002, p.weapon?.ringColor || '#ffa914');
      drawHudBars(g, p);
      drawWeaponWheel(g, p, this.wheelAnim);
      drawWeaponIcon(g, p, this.wheelAnim);
      this.updateWeaponLabels();
      this.drawAmmo(g);
    }

    drawAmmo(g) {
      const p = this.player;
      const cx = VIEW_W, cy = VIEW_H - 16;
      const wt = p.weaponType;
      const ammo = p.ammo[wt];
      const max = WEAPONS[wt]?.maxAmmo ?? Infinity;
      const ax = cx - 50, ay = cy - 42;

      if (max === Infinity || ammo === Infinity) {
        this.ammoCurrent.setVisible(false);
        this.ammoMax.setVisible(false);
        const rx = 10.8, ry = 14.4;
        const ox = ax - 4, oy = ay - 4 ;
        g.lineStyle(4, 0xffffff, 1);
        strokeDiamond(g, ox - rx, oy, rx, ry);
        strokeDiamond(g, ox + rx, oy, rx, ry);
      } else {
        this.ammoCurrent.setVisible(true);
        this.ammoCurrent.setFontFamily("'Rajdhani', monospace");
        this.ammoCurrent.setText(String(ammo));
        this.ammoCurrent.setPosition(ax - 20, ay - 18);
        this.ammoMax.setVisible(true);
        this.ammoMax.setText(String(max));
        this.ammoMax.setPosition(ax + 20, ay + 18);
        g.lineStyle(4, 0xffffff, 1);
        g.lineBetween(ax - 21, ay + 27, ax + 27, ay - 21);
      }
    }

    hideHudOverlay() {
      if (this.weaponLabels) this.weaponLabels.forEach(t => t.setVisible(false));
      if (this.weaponIconImage) this.weaponIconImage.setVisible(false);
      if (this.ammoCurrent) {
        this.ammoCurrent.setVisible(false);
        this.ammoMax.setVisible(false);
      }
    }

    updateWeaponLabels() {
      if (!this.weaponLabels) return;
      const p = this.player;
      const cx = VIEW_W, cy = VIEW_H - 16;
      const rMid = (135 + 214) / 2 - 3;
      const center = Math.PI + Phaser.Math.DegToRad(30);
      const ix = cx + Math.cos(center) * rMid;
      const iy = cy + Math.sin(center) * rMid;

      const useImage = p.weaponType === 'yellow' && this.weaponIconImage;
      if (this.weaponIconImage) {
        this.weaponIconImage.setVisible(useImage);
        if (useImage) this.weaponIconImage.setPosition(ix, iy - 2);
      }

      this.weaponLabels.forEach((t, i) => {
        if (i !== 0) {
          t.setVisible(false);
          return;
        }
        t.setVisible(!useImage);
        t.setText(WEAPON_LABELS[p.weaponType] || p.weaponType);
        t.setColor('#000000');
        t.setPosition(ix, iy);
      });
    }

    toggleGrowth() {
      if (this.isMenuLevel()) return;
      if ((ctx.state.level?.ui || 'battle') === 'interface') return;
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
      this.syncUIState();
    }

    onUIPointer(p) {
      for (const b of this.buttons) {
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
          if (b.id === 'close') this.toggleGrowth();
          return;
        }
      }
    }

    worldSize() {
      const w = ctx.state.level.world;
      return { w: w.width, h: w.height };
    }

    cameraSize() {
      const cw = ctx.state.level.camera.width;
      return { w: cw, h: Math.round(cw * VIEW_H / VIEW_W) };
    }

    applyWorldBounds() {
      const { w, h } = this.worldSize();
      this.cameras.main.setBounds(0, 0, w, h);
    }

    clampEditorView() {
      const cam = this.cameras.main;
      const { w, h } = this.worldSize();
      const cx = Phaser.Math.Clamp(cam.scrollX + VIEW_W / 2, -VIEW_W, w + VIEW_W);
      const cy = Phaser.Math.Clamp(cam.scrollY + VIEW_H / 2, -VIEW_H, h + VIEW_H);
      cam.scrollX = cx - VIEW_W / 2;
      cam.scrollY = cy - VIEW_H / 2;
    }

    showZoom() {
      const el = document.getElementById('zoomInfo');
      if (el) el.textContent = `${Math.round(this.cameras.main.zoomX * 100)}%`;
    }

    resetEditorCamera() {
      const cam = this.cameras.main;
      const { w, h } = this.worldSize();
      const fit = Math.min(VIEW_W / w, VIEW_H / h);
      const zoom = Phaser.Math.Clamp(Math.min(1, fit), 0.1, 1);
      cam.setZoom(zoom);
      cam.scrollX = w / 2 - VIEW_W / 2;
      cam.scrollY = h / 2 - VIEW_H / 2;
      this.clampEditorView();
      this.showZoom();
    }

    playZoom() {
      const { w: ww, h: wh } = this.worldSize();
      const c = this.cameraSize();
      return Math.min(VIEW_W / Math.min(c.w, ww), VIEW_H / Math.min(c.h, wh));
    }

    setupPlayCamera() {
      const cam = this.cameras.main;
      cam.setZoom(this.playZoom());
      cam.scrollX = cam.clampX(this.player.x - VIEW_W / 2);
      cam.scrollY = cam.clampY(this.player.y - VIEW_H / 2);
    }

    updatePlayCamera() {
      const cam = this.cameras.main;
      const { w: ww, h: wh } = this.worldSize();
      const c = this.cameraSize();
      const cw = Math.min(c.w, ww);
      const ch = Math.min(c.h, wh);
      cam.setZoom(this.playZoom());

      const dzW = cw / 3, dzH = ch / 3;
      let cx = cam.scrollX + VIEW_W / 2;
      let cy = cam.scrollY + VIEW_H / 2;

      if (this.player.x < cx - dzW) cx = this.player.x + dzW;
      else if (this.player.x > cx + dzW) cx = this.player.x - dzW;
      if (this.player.y < cy - dzH) cy = this.player.y + dzH;
      else if (this.player.y > cy + dzH) cy = this.player.y - dzH;

      cam.scrollX = cam.clampX(cx - VIEW_W / 2);
      cam.scrollY = cam.clampY(cy - VIEW_H / 2);
    }

    onWheel(px, py, deltaY) {
      if (!this.editing) {
        if (this.state === 'playing' && this.player?.weapons?.length > 1) {
          this.switchWeapon(deltaY > 0 ? 1 : -1);
        }
        return;
      }
      const cam = this.cameras.main;
      const ox = cam.width * cam.originX;
      const oy = cam.height * cam.originY;
      const z0 = cam.zoomX;
      const anchorX = cam.scrollX + ox + (px - ox) / z0;
      const anchorY = cam.scrollY + oy + (py - oy) / z0;
      const zoom = Phaser.Math.Clamp(z0 * (deltaY > 0 ? 0.9 : 1.1), 0.1, 4);
      cam.setZoom(zoom);
      cam.scrollX = anchorX - ox - (px - ox) / zoom;
      cam.scrollY = anchorY - oy - (py - oy) / zoom;
      this.clampEditorView();
      this.showZoom();
      this.draw();
    }

    switchWeapon(dir) {
      const weapons = this.player.weapons;
      const n = weapons.length;
      if (n <= 1) return;
      const from = this.player.weaponIndex;
      const to = (from + dir + n) % n;
      this.player.weaponIndex = to;
      const weaponType = weapons[to];
      this.player.weaponType = weaponType;
      this.player.weapon = WEAPONS[weaponType];
      this.player.scheme = this.player.weapon.scheme;
      this.wheelAnim = { from, to, t: 0, dur: 500 };
      this.syncUIState();
    }
  };
}
