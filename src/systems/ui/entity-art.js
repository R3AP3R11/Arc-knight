// ============================================================
// 世界内实体绘制：木箱、传送门、虫洞圆环与开场动画、敌人形状、墙体、玩家本体与护盾。
// 分类：UI / 美术绘制（世界层）
// 主要导出：color, fillRotatedRect, fillRotatedRoundedRect, drawCrate, drawCrateDebris, drawPortalShape, drawRing, wormhole*, intro*, drawWormhole, getHexagonPoints, drawHexagonBody, drawDefaultPlayer, drawDiamond, drawSquare(s), drawX, drawAdvanced2, drawEnemyShape, drawDropDiamond, drawParallelogram, drawWallShape, strokeDiamond, getWeaponOrbPosition, updatePlayerMoveLean, drawHexRingPlayer, drawShieldArc, drawPlayer
// ============================================================

import Phaser from 'phaser';
import { VIEW_W, VIEW_H, CRATE_SIZE, CRATE_BORDER_THICKNESS, CRATE_INSET, CRATE_DEBRIS_TTL, PORTAL_COLOR, PORTAL_ALPHA, PLAYER_ART, PLAYER_LEAN, SHIELD, ENEMY_RED, ENEMY_BEHAVIOR } from '../constants.js';
import { wallRotationRad, wallCorners } from '../combat/geometry.js';
import { renderAsset } from '../art/asset-render.js';
import { buildOrbitInstance } from '../art/weapon-runtime.js';
import { getDesign, ensureDesign } from '../art/design-store.js';
import { isKnownWeapon } from '../../player-data.js';
import { BOSS25T5_ART } from '../combat/boss25t5.js';
import { drawBoss25T5Body } from './boss25t5-art.js';

// ── 颜色与旋转矩形工具 ──
export function color(value) {
  return Phaser.Display.Color.HexStringToColor(value).color;
}

export function fillRotatedRoundedRect(g, cx, cy, w, h, r, rad) {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const tx = (lx, ly) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
  const w2 = w / 2, h2 = h / 2;
  const radius = Math.min(r, w2, h2);
  const segs = [
    [w2 - radius, -h2 + radius, -Math.PI / 2, 0, w2 - radius, -h2],
    [w2 - radius, h2 - radius, 0, Math.PI / 2, w2, h2 - radius],
    [-w2 + radius, h2 - radius, Math.PI / 2, Math.PI, -w2 + radius, h2],
    [-w2 + radius, -h2 + radius, Math.PI, Math.PI * 1.5, -w2, -h2 + radius]
  ];
  const first = tx(w2 - radius, -h2);
  g.beginPath();
  g.moveTo(first[0], first[1]);
  for (const [ax, ay, a0, a1, entX, entY] of segs) {
    const entry = tx(entX, entY);
    g.lineTo(entry[0], entry[1]);
    const c = tx(ax, ay);
    g.arc(c[0], c[1], radius, a0 + rad, a1 + rad, false);
  }
  g.closePath();
  g.fillPath();
}

// ── 木箱 / 传送门 / 圆环 ──
export function drawCrate(g, x, y, alpha = 1) {
  const s = CRATE_SIZE / 2;
  const t = CRATE_BORDER_THICKNESS;
  const inset = CRATE_INSET;
  const k = 0.95;
  g.lineStyle(t, 0xffffff, alpha);
  g.lineBetween(x - s + inset, y - s, x + s - inset, y - s);
  g.lineBetween(x + s, y - s + inset, x + s, y + s - inset);
  g.lineBetween(x + s - inset, y + s, x - s + inset, y + s);
  g.lineBetween(x - s, y + s - inset, x - s, y - s + inset);
  g.lineBetween(x - s * k, y - s * k, x + s * k, y + s * k);
  g.lineBetween(x + s * k, y - s * k, x - s * k, y + s * k);
}

// 传送门图标：按 mxGraph 解密样式绘制（#00FFFF 填充、透明度 60%、无描边 + EVACUATION 文字）
export function fillRotatedRect(g, cx, cy, w, h, rad) {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const hw = w / 2, hh = h / 2;
  const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
    .map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos]);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillPath();
}

export function drawPortalShape(g, x, y, w, h, rotation = 0, alpha = 1) {
  const rad = Phaser.Math.DegToRad(rotation);
  const bh = Math.max(6, h * 0.42);
  g.fillStyle(PORTAL_COLOR, PORTAL_ALPHA * alpha);
  // 下层宽条
  fillRotatedRect(g, x, y + h * 0.06, w, bh, rad);
  // 上层窄条
  fillRotatedRect(g, x, y - h * 0.06, w * 0.85, bh, rad);
}

export function drawCrateDebris(g, d) {
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

export function drawRing(graphics, centerX, centerY, radius, thickness, ringColor) {
  graphics.lineStyle(thickness, color(ringColor), 1);
  graphics.strokeCircle(centerX, centerY, radius);
}

// ── 虫洞圆环参数与开场动画 ──
// ============================================================
// 主界面背景「虫洞」圆环参数
// 微调间隔与厚度，改下面这些常量即可
// ============================================================
export const RING_INNER_RATIO = 0.2;   // 最内环半径 = 最外环半径的 0.2 倍
export const RING_SPACING_EXP  = 1.6;  // 间隔曲线指数：越大 → 内环越密、外环越疏
export const RING_THICK_OUTER  = 14;   // 最外环厚度（像素）
export const RING_THICK_INNER  = 3;    // 最内环厚度（像素）

// 可选：按环索引逐个覆盖（手动精调用）
// 键 = 环索引（0 = 最外圈），值 = { r?: 半径比例, t?: 厚度 }
// 填了的环用这里的手动值，没填的环用下面的公式
export const RING_OVERRIDES = {
  0: { r: 1.25, t: 60 },
  1: { r: 1, t: 40 },
  2: { r: 0, t: 0 },
  3: { r: 0.66, t: 18 },
  4: { r: 0.5, t: 12 },
  5: { r: 0.38, t: 8 },
  6: { r: 0.3, t: 5 },
  7: { r: 0.25, t: 4 },
  8: { r: 0.21, t: 3 },
  9: { r: 0.18, t: 2 },
  
};

// 第 i 个环的半径比例（0~1），乘以外环半径得到实际半径
export function wormholeRingRadiusFactor(i, n) {
  const u = n > 1 ? i / (n - 1) : 0;                       // 0=最外，1=最内
  return RING_INNER_RATIO
    + (1 - RING_INNER_RATIO) * Math.pow(1 - u, RING_SPACING_EXP);
}

// 第 i 个环的厚度（像素）：外厚内薄，线性过渡
export function wormholeRingThickness(i, n) {
  const u = n > 1 ? i / (n - 1) : 0;
  return RING_THICK_OUTER * (1 - u) + RING_THICK_INNER * u;
}

// 第 i 个环的颜色：次外层（索引 1）白色，其余橙色
export function wormholeRingColor(i) {
  return i === 1 ? 0xffffff : 0xff9d2e;
}

// 最小非零半径比例（用于判断「所有环都超出屏幕」）
export function wormholeMinRadiusFactor(n) {
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const ov = RING_OVERRIDES[i] || {};
    const r = ov.r ?? wormholeRingRadiusFactor(i, n);
    if (r > 0 && r < min) min = r;
  }
  return min === Infinity ? RING_INNER_RATIO : min;
}

// ============================================================
// 新游戏开场动画时间轴（秒）
// ============================================================
export const INTRO_SHRINK = 1.6;       // 环圆心归位时长（原值两倍）
export const INTRO_CAMERA = 1.5;       // 镜头移至虫洞中心时长
export const INTRO_HOLD = 0.1;         // 镜头到位后停顿
export const INTRO_CAMERA_EXPONENT = 2.4; // 镜头移动指数，先慢后快
export const INTRO_SLOW = 1;           // 极慢放大时长
export const INTRO_SLOW_RATE = 0.25;   // 极慢放大速率（倍数/秒）
export const INTRO_GROW_ACCEL = 32;    // 指数增长率：原环与新环共用
export const INTRO_RING_DELAY = 0.05;  // 加速开始后快速生成首个新环
export const INTRO_RING_INTERVAL = 0.24;       // 首个间隔
export const INTRO_RING_INTERVAL_MIN = 0.08;   // 加速后的最小间隔
export const INTRO_RING_INTERVAL_ACCEL = 0.055; // 每次生成后缩短的间隔
export const INTRO_RING_INITIAL_SCALE = 0.7;    // 所有新环统一初始半径比例
export const INTRO_RING_THICKNESS = 2;   // 新环厚度
export const INTRO_BLACK_PAUSE = 1.5;  // 全黑后停顿时长

// 入场放大曲线：镜头到位 -> 停顿 -> 极慢放大 -> 加速放大
export function introGrowScale(t, fx) {
  const camera = fx.introCamera ?? INTRO_CAMERA;
  const hold = fx.introHold ?? INTRO_HOLD;
  const slow = fx.introSlow ?? INTRO_SLOW;
  const accel = fx.introGrow ?? INTRO_GROW_ACCEL;

  const holdEnd = camera + hold;
  const slowEnd = holdEnd + slow;

  if (t <= holdEnd) return 1;                                  // 停顿，不放大
  if (t <= slowEnd) return 1 + (t - holdEnd) * INTRO_SLOW_RATE; // 极慢线性放大
  const base = 1 + slow * INTRO_SLOW_RATE;
  const at = t - slowEnd;
  return base * Math.exp(at * accel / Math.max(1, base));
}

export function drawIntroRings(g, intro, fx, centerX, centerY, time) {
  if (!intro || !fx) return;
  const ringStart = introRingStart(fx);
  const spawnStart = ringStart + INTRO_RING_DELAY;
  if (intro.t <= spawnStart) return;

  const elapsed = intro.t - spawnStart;
  const configuredCount = fx.introRingCount ?? INTRO_RING_COUNT;
  const minFactor = wormholeMinRadiusFactor(fx.rings || 1);
  let ringCount = 0;
  let cursor = 0;
  let interval = INTRO_RING_INTERVAL;
  while (ringCount < configuredCount && elapsed >= cursor) {
    ringCount++;
    cursor += interval;
    interval = Math.max(INTRO_RING_INTERVAL_MIN, interval - INTRO_RING_INTERVAL_ACCEL);
  }
  const maxRadius = Math.hypot(VIEW_W, VIEW_H) * 1.5;
  const ringColor = 0xff9d2e;

  let spawnTime = spawnStart;
  let spawnInterval = INTRO_RING_INTERVAL;
  for (let i = 0; i < ringCount; i++) {
    const age = intro.t - spawnTime;
    if (age >= 0) {
      // 首个新环贴近原最小环当前尺寸，避免生成断层；后续新环保持同一初始尺寸
      const initialScale = introGrowScale(spawnStart, fx);
      const initialRadius = fx.radius * minFactor * initialScale;
      const camera = fx.introCamera ?? INTRO_CAMERA;
      const hold = fx.introHold ?? INTRO_HOLD;
      const slow = fx.introSlow ?? INTRO_SLOW;
      const accelStart = camera + hold + slow;
      const spawnAge = Math.max(0, spawnTime - accelStart);
      const ageAfterAccel = spawnAge + age;
      const accel = fx.introGrow ?? INTRO_GROW_ACCEL;
      const ageScale = Math.exp(age * accel);
      const radius = initialRadius * INTRO_RING_INITIAL_SCALE * ageScale;
      if (radius <= maxRadius) {
        const alpha = Math.max(0, 1 - radius / maxRadius);
        g.lineStyle(INTRO_RING_THICKNESS, ringColor, alpha);
        g.strokeCircle(centerX, centerY, radius);
      }
    }
    spawnTime += spawnInterval;
    spawnInterval = Math.max(INTRO_RING_INTERVAL_MIN, spawnInterval - INTRO_RING_INTERVAL_ACCEL);
  }
}

export function introRingStart(fx) {
  return (fx.introCamera ?? INTRO_CAMERA)
    + (fx.introHold ?? INTRO_HOLD)
    + (fx.introSlow ?? INTRO_SLOW);
}

export function drawWormhole(g, fx, t, intro) {
  if (fx.visible === false) return;
  const n = fx.rings;
  const shrinkDur = fx.introShrink ?? INTRO_SHRINK;
  const cameraDur = fx.introCamera ?? INTRO_CAMERA;

  // 入场动画：偏移归零 + 中心移向屏幕中心 + 加速放大
  let driftScale = 1;
  let cx0 = fx.x, cy0 = fx.y;
  let growScale = 1;
  if (intro) {
      const progress = Math.min(1, intro.t / cameraDur);
      const cam = Math.pow(progress, INTRO_CAMERA_EXPONENT);
    const ringProgress = Math.min(1, intro.t / shrinkDur);
    const ringEase = Math.pow(ringProgress, 1 / INTRO_CAMERA_EXPONENT);
    driftScale = 1 - ringEase;
    cx0 = fx.x + (VIEW_W / 2 - fx.x) * cam;
    cy0 = fx.y + (VIEW_H / 2 - fx.y) * cam;
    growScale = introGrowScale(intro.t, fx);
  }

  const scale = (1 + fx.scaleAmp * Math.sin(t * fx.scaleSpeed)) * growScale;
  const baseY = cy0 + fx.yDrift * Math.sin(t * fx.ySpeed) * driftScale;
  const ang = t * fx.driftSpeed;
  const introProgress = intro ? Math.pow(Math.min(1, intro.t / cameraDur), INTRO_CAMERA_EXPONENT) : 1;
  const introCenterX = intro ? fx.x + (VIEW_W / 2 - fx.x) * introProgress : fx.x;
  const introCenterY = intro ? fx.y + (VIEW_H / 2 - fx.y) * introProgress : fx.y;

  g.fillStyle(0xff9d2e, 0.08);
  g.fillCircle(cx0, baseY, fx.radius * scale * 1.15);

  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0;
    const ov = RING_OVERRIDES[i] || {};

    // 半径：先用公式，再应用手动覆盖
    const radius = fx.radius * (ov.r ?? wormholeRingRadiusFactor(i, n)) * scale;

    // 厚度：先用公式，再应用手动覆盖
    const thickness = ov.t ?? wormholeRingThickness(i, n);

    const ringColor = wormholeRingColor(i);

    // 偏移量：外环 0，越向内越大（同步旋转），入场时归零
    const amp = fx.driftAmp * u * driftScale;
    const cx = cx0 + Math.cos(ang) * amp;
    const cy = baseY + Math.sin(ang) * amp;

    g.lineStyle(thickness, ringColor, 1);
    g.strokeCircle(cx, cy, radius);
  }

  const outR = fx.radius * scale;
  for (let k = 0; k < fx.orbitCount; k++) {
    const a = t * fx.orbitSpeed + k * (Math.PI * 2 / Math.max(1, fx.orbitCount));
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx0 + Math.cos(a) * outR, baseY + Math.sin(a) * outR, 5);
  }

  drawIntroRings(g, intro, fx, introCenterX, introCenterY, t);
}

// ── 六边形与玩家 / 敌人形状 ──
export function getHexagonPoints(centerX, centerY, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };
  });
}

export function drawHexagonBody(graphics, centerX, centerY, radius = PLAYER_ART.hexagonRadius, offsetX = 0, offsetY = 0, lineThickness = PLAYER_ART.yLineThickness) {
  const points = getHexagonPoints(centerX + offsetX, centerY + offsetY, radius);

  graphics.fillStyle(0xffffff);
  graphics.beginPath();
  graphics.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach(point => graphics.lineTo(point.x, point.y));
  graphics.closePath();
  graphics.fillPath();

  graphics.lineStyle(lineThickness, 0x000000, 1);
  [1, 3, 5].forEach(index => {
    graphics.beginPath();
    graphics.moveTo(centerX + offsetX, centerY + offsetY);
    graphics.lineTo(points[index].x, points[index].y);
    graphics.strokePath();
  });
}

export function drawDefaultPlayer(graphics, centerX, centerY) {
  graphics.fillStyle(0x51b9ff);
  graphics.fillCircle(centerX, centerY, 13);
}

export function drawDiamond(g, e, size, fill, angle, alpha = 1) {
  const longHalf = size / 2;
  const shortHalf = size * 0.36;
  g.fillStyle(fill, alpha);
  g.beginPath();
  g.moveTo(e.x + Math.cos(angle) * longHalf, e.y + Math.sin(angle) * longHalf);
  g.lineTo(e.x + Math.cos(angle + Math.PI / 2) * shortHalf, e.y + Math.sin(angle + Math.PI / 2) * shortHalf);
  g.lineTo(e.x + Math.cos(angle + Math.PI) * longHalf, e.y + Math.sin(angle + Math.PI) * longHalf);
  g.lineTo(e.x + Math.cos(angle - Math.PI / 2) * shortHalf, e.y + Math.sin(angle - Math.PI / 2) * shortHalf);
  g.closePath();
  g.fillPath();
}

export function drawSquareAt(g, cx, cy, size, angle, fill, alpha = 1) {
  const half = size / 2;
  const r = half * Math.SQRT2;
  const a = angle + Math.PI / 4;
  g.fillStyle(fill, alpha);
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const p = a + i * Math.PI / 2;
    const x = cx + Math.cos(p) * r, y = cy + Math.sin(p) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillPath();
}

export function drawSquares(g, e, size, fill, spin1, spin2, alpha = 1) {
  drawSquareAt(g, e.x, e.y, size, spin1, fill, alpha);
  drawSquareAt(g, e.x, e.y, size, spin2, fill, alpha);
}

export function drawX(g, e, size, lineWidth, fill, alpha = 1) {
  const d = size * 0.35;
  g.lineStyle(lineWidth, fill, alpha);
  g.lineBetween(e.x - d, e.y - d, e.x + d, e.y + d);
  g.lineBetween(e.x - d, e.y + d, e.x + d, e.y - d);
}

export function drawAdvanced2(g, e, dynamic, target, alpha = 1) {
  const b = ENEMY_BEHAVIOR.advanced2;
  const bodyR = 18;
  const orbitR = dynamic ? (e.orbitRadius ?? b.orbitMin) : b.orbitMin;
  const ballAngle = dynamic ? (e.orbitAngle ?? 0) : -Math.PI / 2;

  g.fillStyle(0xffffff, alpha);
  g.fillCircle(e.x, e.y, bodyR);

  g.lineStyle(2, 0xffffff, alpha);
  g.strokeCircle(e.x, e.y, orbitR);

  const bx = e.x + Math.cos(ballAngle) * orbitR;
  const by = e.y + Math.sin(ballAngle) * orbitR;
  g.fillStyle(e.aggressive ? ENEMY_RED : 0xffffff, alpha);
  g.fillCircle(bx, by, 4);
}

export function drawEnemyShape(g, e, dynamic, target, t = 0, alpha = 1) {
  // 母舰：长尖端始终朝向玩家；受击时把整个四边形（设计稿描边轮廓）填充为实白
  if (e.type === 'mothership') {
    const design = e?.art ? getDesign(e.art) : null;
    if (design) {
      // 敌→玩家方向 θ；设计长尖默认朝上(-π/2)，整体相位偏转 θ+π/2 使长尖指向玩家
      const theta = target ? Phaser.Math.Angle.Between(e.x, e.y, target.x, target.y) : -Math.PI / 2;
      const facing = theta + Math.PI / 2;
      const rotDesign = {
        ...design,
        elements: design.elements.map(el => ({
          ...el,
          phase: (el.phase || 0) + facing,
          fill: e.hitFlashT > 0 ? '#ffffff' : el.fill
        }))
      };
      renderAsset(g, rotDesign, e.x, e.y, t, e.artScale || 1, undefined, alpha);
      return;
    }
  }
  // BOSS「原型机-2-5T5」：圆弧4 瞄玩家 / 圆弧5 自转 / 护盾分档透明度 / 受击闪白 / 技能3 合并紫弧。
  // 动态覆写设计稿元素后交给 renderAsset（实现见 systems/ui/boss25t5-art.js）；
  // 设计稿未加载（getDesign 为空）时返回 false → 落到下方默认敌人形状。
  if (e.type === 'boss-2-5t5') {
    const bossDesign = getDesign(e.art || BOSS25T5_ART);
    if (drawBoss25T5Body(g, e, bossDesign, target, t, alpha)) return;
  }
  // 应用画板美术方案：实体带 art 且设计稿已加载 → 用 renderAsset 覆盖默认绘制
  const design = e?.art ? getDesign(e.art) : null;
  if (design) { renderAsset(g, design, e.x, e.y, t, e.artScale || 1, undefined, alpha); return; }

  const b = ENEMY_BEHAVIOR[e.type] || ENEMY_BEHAVIOR.basic1;
  const fill = e.red ? ENEMY_RED : 0xffffff;
  if (e.type === 'advanced2') {
    drawAdvanced2(g, e, dynamic, target, alpha);
    return;
  }
  if (e.type === 'basic2') {
    const spin1 = dynamic ? (e.spin1 || 0) : 0;
    const spin2 = dynamic ? (e.spin2 || 0) : 0;
    drawSquares(g, e, b.size, fill, spin1, spin2, alpha);
  } else if (e.type === 'advanced1') {
    drawX(g, e, b.size, b.lineWidth || 12, fill, alpha);
  } else {
    const angle = dynamic && target
      ? Phaser.Math.Angle.Between(e.x, e.y, target.x, target.y)
      : -Math.PI / 2;
    drawDiamond(g, e, b.size, fill, angle, alpha);
  }
}

export function drawDropDiamond(g, x, y, fillColor, alpha = 1) {
  const r = 10;
  g.fillStyle(fillColor, alpha);
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fillPath();
}

export function drawParallelogram(g, x, y, w, h, skew, ratio, fillColor, bgColor) {
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

// ── 墙体绘制 ──
export function drawWallShape(g, wall, fillColor) {
  const r = wallRotationRad(wall);
  g.fillStyle(fillColor, 1);
  g.lineStyle(1, fillColor, 1);
  if (wall.shape === 'circle') {
    g.fillCircle(wall.x, wall.y, wall.w / 2);
    return;
  }
  if (wall.shape === 'arc') {
    const start = Phaser.Math.DegToRad(wall.startAngle || 0) + r;
    const end = Phaser.Math.DegToRad(wall.endAngle ?? 360) + r;
    const outer = wall.w / 2 + wall.thickness / 2;
    const inner = Math.max(0, wall.w / 2 - wall.thickness / 2);
    g.beginPath();
    g.arc(wall.x, wall.y, outer, start, end, false);
    g.arc(wall.x, wall.y, inner, end, start, true);
    g.closePath();
    g.fillPath();
    return;
  }
  const corners = wallCorners(wall);
  g.beginPath();
  g.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
  g.closePath();
  g.fillPath();
}

export function strokeDiamond(g, cx, cy, rx, ry) {
  g.beginPath();
  g.moveTo(cx, cy - ry);
  g.lineTo(cx + rx, cy);
  g.lineTo(cx, cy + ry);
  g.lineTo(cx - rx, cy);
  g.closePath();
  g.strokePath();
}

// ── 武器球位置与玩家绘制 ──
export function getWeaponOrbPosition(player, scale = 1) {
  const angle = player.weaponAngle || 0;
  return {
    x: player.x + Math.cos(angle) * PLAYER_ART.weaponRingRadius * scale,
    y: player.y + Math.sin(angle) * PLAYER_ART.weaponRingRadius * scale
  };
}

export function updatePlayerMoveLean(player, dx, dy, dt) {
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

export function drawHexRingPlayer(graphics, player, scale = 1) {
  const centerX = player.x;
  const centerY = player.y;
  const weaponColor = player.weapon?.ringColor || '#ffa914';
  const leanX = (player.moveLeanX || 0) * scale, leanY = (player.moveLeanY || 0) * scale;
  const hexRadius = (player.moveHexRadius ?? PLAYER_ART.hexagonRadius) * scale;
  const innerK = PLAYER_LEAN.inner / PLAYER_LEAN.hex;
  const middleK = PLAYER_LEAN.middle / PLAYER_LEAN.hex;
  const outerK = PLAYER_LEAN.outer / PLAYER_LEAN.hex;

  drawHexagonBody(graphics, centerX, centerY, hexRadius, leanX, leanY, PLAYER_ART.yLineThickness * scale);
  drawRing(graphics, centerX + leanX * innerK, centerY + leanY * innerK, PLAYER_ART.innerRingRadius * scale, PLAYER_ART.innerRingThickness * scale, weaponColor);
  drawRing(graphics, centerX + leanX * middleK, centerY + leanY * middleK, PLAYER_ART.outerRingRadius * scale, PLAYER_ART.outerRingThickness * scale, weaponColor);
  drawRing(graphics, centerX + leanX * outerK, centerY + leanY * outerK, PLAYER_ART.outer2RingRadius * scale, PLAYER_ART.outer2RingThickness * scale, weaponColor);
  drawRing(graphics, centerX, centerY, PLAYER_ART.bodyRingRadius * scale, PLAYER_ART.bodyRingThickness * scale, '#ffffff');
  drawRing(graphics, centerX, centerY, PLAYER_ART.weaponRingRadius * scale, PLAYER_ART.weaponRingThickness * scale, weaponColor);

  const orb = getWeaponOrbPosition(player, scale);
  graphics.fillStyle(0xffffff);
  graphics.fillCircle(orb.x, orb.y, PLAYER_ART.weaponOrbRadius * 1.25 * 1.5 * scale);
}

export function drawShieldArc(graphics, player) {
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

// 环绕六边形航迹：按每颗的历史位置画渐隐尾迹（最新段最亮，旧段渐隐）
function drawOrbitTrail(g, trails, count, colorInt, fade, width = 2) {
  if (!trails || !count) return;
  for (let i = 0; i < count; i++) {
    const tr = trails[i];
    if (!tr || tr.length < 2) continue;
    for (let j = 1; j < tr.length; j++) {
      const a = (j / (tr.length - 1)) * (fade ?? 0.9);
      g.lineStyle(Math.max(0.5, width), colorInt, Math.max(0.05, a));
      g.beginPath();
      g.moveTo(tr[j - 1].x, tr[j - 1].y);
      g.lineTo(tr[j].x, tr[j].y);
      g.strokePath();
    }
  }
}

export function drawPlayer(graphics, player, t = 0) {
  // 美术方案按「当前武器类型」绑定：设了对应武器的设计稿 → 用它画玩家本体；否则回退默认/旧 art
  const wt = player.weaponType;
  const aid = (player.arts && wt && player.arts[wt]) || player.art;
  const design = aid ? getDesign(aid) : null;
  // 仅当 aid 不是武器 id 时才当作美术资产加载，避免把武器 id 发到 /api/assets 造成 404
  if (aid && !design && !isKnownWeapon(aid)) ensureDesign(aid);
  if (design) {
    renderAsset(graphics, design, player.x, player.y, t, player.artScale || 1);
    // 特殊机制武器（鼠标准心/蓄力）把发射媒介/瞄准线/红弧叠画在画板本体之上
    const mc = player.weapon?.mechanic;
    if (mc && (mc.aim === 'mouse' || mc.charge?.enabled)) drawWeaponMedium(graphics, player, player.weapon?.medium, t);
    return;
  }

  // 移动滞后动量：玩家移动 lean（moveLeanX/Y，已平滑），归一化到 [-1,1] 供元素偏移用
  const motion = { x: (player.moveLeanX || 0) / PLAYER_LEAN.hex, y: (player.moveLeanY || 0) / PLAYER_LEAN.hex };
  const med = player.weapon?.medium;

  // 当前武器是「设计武器」且带画板外形（武器外形）→ 用它画玩家本体；环绕六边形武器走动态轨道克隆 + 航迹，且不画发射媒介
  const wArt = player.weaponArt;
  if (wArt && Array.isArray(wArt.elements) && wArt.elements.length) {
    const orbit = player.weapon?.mechanic?.orbit;
    if (orbit?.enabled) {
      const baseR = (wArt.elements?.[orbit.orbitIndexes?.[0]]?.orbitRadius) || 30;
      const phase = player.orbit || { radius: baseR, speedMult: 1, sizeMult: 1, attacking: false, hexTrails: [] };
      const dyn = buildOrbitInstance(wArt, orbit, { radius: phase.radius, speedMult: phase.speedMult, sizeMult: phase.sizeMult });
      renderAsset(graphics, dyn, player.x, player.y, t, player.artScale || 1, motion);
      if (phase.attacking && phase.hexTrails) {
        drawOrbitTrail(graphics, phase.hexTrails, orbit.hexCount, color(orbit.trailColor || '#ffa914'), orbit.trailFade, orbit.trailWidth);
      }
    } else {
      renderAsset(graphics, wArt, player.x, player.y, t, player.artScale || 1, motion);
      drawWeaponMedium(graphics, player, med, t);
    }
    return;
  }

  if (player.scheme === 'hex-ring' || player.scheme === 'yellow' || player.scheme === 'green') {
    drawHexRingPlayer(graphics, player);
    return;
  }

  drawDefaultPlayer(graphics, player.x, player.y);
  // 设计武器但外形未设矢量：仍补画发射媒介环+球，避免「只有本体没媒体」
  drawWeaponMedium(graphics, player, med, t);
}

// 发射媒介：环 + 环上骑一颗小球（随 weaponAngle + medium.angle，与 muzzlePosition 一致）。
// 特殊武器额外：中心瞄准线（常显，长度近似无限，蓄满变红）+ 蓄力散射边界线（±spread）+ 表盘红弧带
//   （半径=发射环（=环上小球），厚度减半，角度随蓄力散射角同步减小）+ 发射小球改为圆弧（角度=当前散射角）。
function drawWeaponMedium(g, player, med, t) {
  if (!med) return;
  const scale = player.artScale || 1;
  const cx = player.x, cy = player.y;
  const ringR = (med.radius > 0 ? med.radius : PLAYER_ART.weaponRingRadius) * scale;
  g.lineStyle(Math.max(0.5, (med.ringWidth || 4) * scale), color(med.ringColor || '#ffffff'), 1);
  g.strokeCircle(cx, cy, ringR);
  const ba = (player.weaponAngle || 0) + ((med.angle || 0) * Math.PI / 180);
  const ox = cx + Math.cos(ba) * ringR;
  const oy = cy + Math.sin(ba) * ringR;

  const mech = player.weapon?.mechanic;
  const chg = mech?.charge?.enabled ? mech.charge : null;
  const mouseAim = mech?.aim === 'mouse';
  if (chg || mouseAim) {
    const charge = player.charge || 0;
    const spreadDeg = chg ? chg.spreadMax * (1 - charge) : 0;   // 当前散射角（蓄满 0）
    const full = !!(chg && charge >= 1);
    const lineLen = 20000;
    // 表盘红弧带：仅蓄力中显示（半径=arc.r，厚度减半，half=spreadDeg 随蓄力收窄）
    if (chg && player.charging) {
      const baseR = med.radius > 0 ? med.radius : (PLAYER_ART.weaponRingRadius || 40);
      for (const arc of (mech.ampArcs || [])) {
        const half = spreadDeg;
        if (half > 0) {
          const arcR = (arc.r > 0 ? arc.r : baseR) * scale;
          g.lineStyle(Math.max(0.25, arc.width * scale * 0.5), color(arc.color), 0.9);
          g.beginPath();
          g.arc(cx, cy, arcR, ba - Phaser.Math.DegToRad(half), ba + Phaser.Math.DegToRad(half), false);
          g.strokePath();
        }
      }
    }
    // 两条散射边界线：仅蓄力中且未满（charging && spreadDeg>0），长度近似无限
    if (chg && player.charging && spreadDeg > 0) {
      g.lineStyle(2, color(chg.boundLineColor || '#ffffff'), 0.8);
      for (const s of [-spreadDeg, spreadDeg]) {
        const a = ba + Phaser.Math.DegToRad(s);
        g.lineBetween(cx + Math.cos(a) * ringR, cy + Math.sin(a) * ringR, cx + Math.cos(a) * (ringR + lineLen), cy + Math.sin(a) * (ringR + lineLen));
      }
      // 发射小球 → 圆弧（环上当前散射角范围）
      g.lineStyle(Math.max(1.5, 4 * (med.size || 1) * scale), color(med.ringColor || '#ffffff'), 1);
      g.beginPath();
      g.arc(cx, cy, ringR, ba - Phaser.Math.DegToRad(spreadDeg), ba + Phaser.Math.DegToRad(spreadDeg), false);
      g.strokePath();
      return;
    }
    // 蓄力满（散射收敛为 0）：一条红色中心瞄准线（平时不显示）
    if (full && chg) {
      g.lineStyle(2, color(chg.aimLineFullColor || '#ff3b3b'), 0.9);
      g.lineBetween(cx + Math.cos(ba) * ringR, cy + Math.sin(ba) * ringR, cx + Math.cos(ba) * (ringR + lineLen), cy + Math.sin(ba) * (ringR + lineLen));
    }
  }

  if (Array.isArray(med.elements) && med.elements.length) {
    renderAsset(g, { scale: med.size, center: { x: 0, y: 0 }, elements: med.elements }, ox, oy, t, 1);
  } else {
    g.fillStyle(color(med.ringColor || '#ffffff'), 1);
    g.fillCircle(ox, oy, Math.max(2, 4 * (med.size || 1)));
  }
}
