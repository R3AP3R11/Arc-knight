// 武器设计稿数据模型：归一化 + 默认值。
// 一份武器设计 = 武器外形(画板矢量) + 发射媒介(最外层圆环小球) + 发射逻辑(子弹外形+子弹轨迹)
//   + 弹道/数值参数(数量/散布/伤害/射速) + 进入游戏参数(可购买/槽位/改件数)。
// 分类：引擎-编辑器（画板系统衍生）。导出：normalizeWeaponDesign, defaultWeaponDesign, normalizeVectorField, WEAPON_TRAIL_TYPES

function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function posn(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
function clampN(v, min, max) { const n = num(v, min); return Math.min(max, Math.max(min, n)); }
function clampInt(v, min, max) { return Math.max(min, Math.min(max, Math.round(num(v, min)))); }

// 规范化颜色为 #rrggbb 小写（3位hex 展开），供调色盘/运行时复用；非法返回 null
function toColorHex(c) {
  let s = String(c).trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + [...s.slice(1)].map(ch => ch + ch).join('');
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

// 归一化随机颜色合集：支持数组或逗号分隔字符串，规范化为 #rrggbb，去重，上限 16
function normalizePalette(v) {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',') : []);
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const c = toColorHex(s);
    if (!c || seen.has(c)) continue;
    seen.add(c); out.push(c);
    if (out.length >= 16) break;
  }
  return out;
}

// 归一化一个画板矢量元素（与 asset-render.normalizeElement 对齐，但独立存在避免循环依赖）
export function normalizeWeaponShape(el = {}, index = 0) {
  const shape = el.shape === 'arc' ? 'arc' : el.shape === 'stroke' ? 'stroke' : 'polygon';
  return {
    shape,
    count: (shape === 'stroke') ? 1 : clampN(el.count, 1, 16),
    orbitRadius: Math.abs(posn(el.orbitRadius, 0)),
    radius: Math.abs(posn(el.radius, 10)),
    sides: clampN(el.sides, 3, 64),
    lineWidth: Math.abs(posn(el.lineWidth, 2)),
    color: String(el.color || '#ffffff'),
    fill: typeof el.fill === 'string' && el.fill ? el.fill : null,
    rotSpeed: num(el.rotSpeed, 0),
    dir: num(el.dir, 0) < 0 ? -1 : 1,
    phase: num(el.phase, 0),
    // 移动滞后偏移：元素相对圆心在移动方向上的最大错位（px）与响应强度
    offsetX: num(el.offsetX, 0),
    offsetY: num(el.offsetY, 0),
    offsetSpeed: clampN(el.offsetSpeed ?? 1, 0, 5),
    arcStart: num(el.arcStart, 0),
    arcEnd: num(el.arcEnd, 360),
    // 钟表表盘花纹（与 asset-render.normalizeElement 对齐）：沿弧均布径向刻度，长短针按比例
    pattern: el.pattern === 'clock' ? 'clock' : 'plain',
    tickShortLen: Math.max(0, num(el.tickShortLen, 6)),
    tickLongLen: Math.max(0, num(el.tickLongLen, 12)),
    tickDensity: Math.round(clampN(num(el.tickDensity, 12), 2, 120)),
    tickRatio: Math.round(clampN(el.tickRatio, 1, 24)),
    tickDir: (el.tickDir === 'out' || el.tickDir === 'both') ? el.tickDir : 'in',
    points: Array.isArray(el.points) ? el.points.map(p => ({ x: num(p?.x, 0), y: num(p?.y, 0) })) : [],
    closed: !!el.closed
  };
}

// 归一化一份画板设计稿（如武器外形 / 发射媒介 / 子弹外形），返回其 elements 数组
function normalizeShapeGroup(value) {
  const v = value || {};
  return {
    scale: clampN(v.scale, 0.05, 50),
    center: { x: posn(v.center?.x, 0), y: posn(v.center?.y, 0) },
    elements: (Array.isArray(v.elements) ? v.elements : []).slice(0, 32).map(normalizeWeaponShape)
  };
}

export function normalizeVectorField(value = {}) {
  const v = value || {};
  return {
    speed: Math.abs(num(v.speed, 500)),
    angleOffset: num(v.angleOffset, 0),
    gravityX: num(v.gravityX, 0),
    gravityY: num(v.gravityY, 0),
    zigzag: {
      enabled: !!v.zigzag?.enabled,
      ampDeg: num(v.zigzag?.ampDeg, 15),
      wavelength: Math.max(8, num(v.zigzag?.wavelength, 40))
    },
    jitter: {
      enabled: !!v.jitter?.enabled,
      amount: Math.abs(num(v.jitter?.amount, 0)),
      freq: Math.max(1, num(v.jitter?.freq, 10))
    }
  };
}

function normalizeTrail(value = {}) {
  const v = value || {};
  const type = ['cone', 'equal', 'snake', 'particle'].includes(v.type) ? v.type : 'cone';
  return {
    type,
    length: Math.abs(num(v.length, 60)),
    width: Math.abs(num(v.width, 4)),
    color: String(v.color || '#ffa914'),
    fade: clampN(v.fade, 0, 1),
    tailWidth: Math.abs(num(v.tailWidth, 0)),
    midWidth: Math.abs(num(v.midWidth, 0)),   // 菱形：中间最宽处宽度（0=退化为普通锥形）
    midAt: clampN(v.midAt, 0.05, 0.95),       // 菱形：最宽处距弹头长度占比
    particleSize: Math.abs(num(v.particleSize, 3)),
    particleGap: Math.max(2, num(v.particleGap, 6)),
    historyMax: Math.max(2, num(v.historyMax, 12))
  };
}

// 子弹发射逻辑：子弹外形 + 子弹轨迹（矢量场 / 激光束介型）
function normalizeBullet(value = {}) {
  const v = value || {};
  const kind = v.trajectory?.kind === 'beam' ? 'beam' : 'vector';
  return {
    count: clampN(v.count || v.bulletCount || (kind === 'beam' ? 1 : 1), 1, 12),
    spreadDeg: num(v.spreadDeg, 0),
    baseAngleOffset: num(v.baseAngleOffset, 0),
    range: Math.max(0, num(v.range, 0)),         // 射击距离：超过后子弹+拖尾淡出消失（0=无限）
    speed: Math.max(1, num(v.speed, v.trajectory?.vector?.speed || 500)), // 子弹飞行速度（矢量场初速，兼容旧 vector.speed）
    fadeDuration: Math.max(0, num(v.fadeDuration, 0)), // 消失时长(ms)：抵达最远距离后渐变淡出（0=立即按距离淡出）
    spreadRandom: Math.abs(num(v.spreadRandom, 0)), // 每发随机偏移量（°），散布呈现随机性
    randomColor: !!v.randomColor,                // 每发子弹是否随机颜色
    randomPalette: normalizePalette(v.randomPalette), // 随机颜色合集（为空则全场随机色相）
    shape: normalizeShapeGroup(v.shape),
    size: Math.abs(posn(v.size, 1)),
    trail: normalizeTrail(v.trail),
    trajectory: {
      kind,
      beam: v.trajectory?.beam || { width: 10, color: '#42d978' },
      vector: normalizeVectorField(v.trajectory?.vector)
    }
  };
}

// 特殊机制（可扩展；普通武器为 auto/无）。机制行为靠 combat 侧按字段激活：
//   aim      —— 'mouse'=准心（发射环小球+瞄准线）始终指向鼠标；'auto'=常规环绕
//   charge   —— 蓄力射击：按住蓄力、松开发射；起始 spreadMax→0°，蓄满速度/大小/伤害乘以乘子
//   ampArcs  —— 发射环外「表盘红色圆弧」带：子弹穿过该环带变红且伤害翻倍（支持多个）
//   orbit    —— 环绕六边形：以玩家为中心按相位循环攻出的六边形(可多环)对敌造成近身伤害，无子弹
function normalizeOrbit(value) {
  const v = value || {};
  if (!v.enabled) return null;
  return {
    enabled: !!v.enabled,
    orbitIndexes: Array.isArray(v.orbitIndexes) ? v.orbitIndexes.slice(0, 6).map(n => clampInt(n, 0, 15)) : [0, 1],
    hexCount: clampInt(v.hexCount, 1, 12),
    phase2Radius: Math.max(0, num(v.phase2Radius, 250)),
    phase3Radius: Math.max(0, num(v.phase3Radius, 400)),
    phase2SpeedMult: Math.max(1, num(v.phase2SpeedMult, 2)),
    phase3SpeedMult: Math.max(1, num(v.phase3SpeedMult, 4)),
    phase2SizeMult: Math.max(1, num(v.phase2SizeMult, 2)),
    phase3SizeMult: Math.max(1, num(v.phase3SizeMult, 4)),
    phase3HoldMs: Math.max(0, num(v.phase3HoldMs, 2000)),
    attackLerpMs: Math.max(0, num(v.attackLerpMs, 120)),
    retractMs: Math.max(0, num(v.retractMs, 400)),
    hitIntervalMs: Math.max(1, num(v.hitIntervalMs, 120)),
    trailSamples: clampInt(v.trailSamples, 4, 120),
    trailFade: Math.max(0, Math.min(1, num(v.trailFade, 0.9))),
    trailColor: String(v.trailColor || '#ffa914')
  };
}
function normalizeMechanic(value = {}) {
  const v = value || {};
  const charge = v.charge ? {
    enabled: !!v.charge.enabled,
    duration: Math.max(50, num(v.charge.duration, 1500)),   // 蓄力时长 ms
    spreadMax: Math.max(0, num(v.charge.spreadMax, 0)),     // 蓄力起始散射角 °（蓄力→0）
    speedMult: Math.max(1, num(v.charge.speedMult, 1.4)),   // 蓄满速度乘子
    sizeMult: Math.max(1, num(v.charge.sizeMult, 1.4)),     // 蓄满大小乘子
    damageMult: Math.max(1, num(v.charge.damageMult, 2)),   // 蓄满伤害乘子
    aimLineColor: String(v.charge.aimLineColor || '#ffffff'),
    aimLineFullColor: String(v.charge.aimLineFullColor || '#ff3b3b'),
    boundLineColor: String(v.charge.boundLineColor || '#ffffff')
  } : null;
  const ampArcs = Array.isArray(v.ampArcs) ? v.ampArcs.slice(0, 8) : [];
  return {
    aim: v.aim === 'mouse' ? 'mouse' : 'auto',
    charge,
    ampArcs: ampArcs.map(a => ({
      r: Math.abs(num(a?.r, 0)),                 // 距玩家半径（弧心圆半径）
      halfDeg: Math.max(0, num(a?.halfDeg, 0)),  // 弧半角（相对 weaponAngle）
      width: Math.max(0, num(a?.width, 6)),      // 带宽度
      color: String(a?.color || '#ff3b3b')
    })),
    orbit: normalizeOrbit(v.orbit)
  };
}

export function normalizeWeaponDesign(value = {}) {
  const v = value || {};
  const slot = [1, 2, 3].includes(Number(v.slot)) ? Number(v.slot) : 1;
  return {
    id: String(v.id || ''),
    name: String(v.name || ''),
    version: 1,
    // 战斗数值（覆盖 WEAPONS 运行时表的 baseDamage/fireInterval 等）
    baseDamage: clampN(v.baseDamage, 1, 99999),
    fireInterval: clampN(v.fireInterval, 20, 5000),
    maxAmmo: num(v.maxAmmo, Infinity) === Infinity ? Infinity : (num(v.maxAmmo, Infinity) > 0 ? Math.round(num(v.maxAmmo, 30)) : Infinity),
    chargeRequired: Math.max(0, Math.round(num(v.chargeRequired, 0))),
    // 进入游戏参数
    purchasable: !!v.purchasable,
    price: Math.max(0, Math.round(num(v.price, 0))),
    unlockLevel: Math.max(1, Math.round(num(v.unlockLevel, 1))),
    slot,
    maxGenericMods: clampN(v.maxGenericMods ?? 3, 0, 9),
    maxDedicatedMods: clampN(v.maxDedicatedMods ?? 1, 0, 3),
    isTemplate: !!v.isTemplate,
    // 三部分独立设计
    appearance: normalizeShapeGroup(v.appearance),   // 武器外形
    medium: {                                          // 发射媒介：最外层圆环小球
      ringIndex: clampN(v.medium?.ringIndex ?? 0, 0, 5),
      angle: num(v.medium?.angle, 0),
      radius: Math.abs(num(v.medium?.radius, 28)),
      size: Math.abs(posn(v.medium?.size, 1)),
      ringColor: String(v.medium?.ringColor || '#ffffff'),
      ringWidth: Math.abs(posn(v.medium?.ringWidth, 4)),
      orbitSpeed: Math.abs(num(v.medium?.orbitSpeed, 180)),
      fireSpeed: Math.abs(num(v.medium?.fireSpeed, 20)),
      elements: (Array.isArray(v.medium?.elements) ? v.medium.elements : []).slice(0, 16).map(normalizeWeaponShape)
    },
    bullet: normalizeBullet(v.bullet),
    mechanic: normalizeMechanic(v.mechanic)
  };
}

export function defaultWeaponDesign() {
  return normalizeWeaponDesign({
    id: '',
    name: '新武器',
    baseDamage: 10,
    fireInterval: 120,
    purchasable: false,
    unlockLevel: 1,
    slot: 1,
    maxGenericMods: 3,
    maxDedicatedMods: 1,
    appearance: { scale: 1, center: { x: 0, y: 0 }, elements: [] },
    medium: { ringIndex: 0, angle: 0, radius: 28, size: 1, ringColor: '#ffa914', ringWidth: 4, orbitSpeed: 180, fireSpeed: 20, elements: [] },
    bullet: {
      count: 1,
      spreadDeg: 0,
      shape: { scale: 1, center: { x: 0, y: 0 }, elements: [] },
      size: 1,
      trail: { type: 'cone', length: 60, width: 10, color: '#ffa914', fade: 1, tailWidth: 0, particleSize: 3, particleGap: 6, historyMax: 12 },
      trajectory: { kind: 'vector', vector: { speed: 500, angleOffset: 0, gravityX: 0, gravityY: 0, zigzag: { enabled: false, ampDeg: 15, wavelength: 40 }, jitter: { enabled: false, amount: 0, freq: 10 } }, beam: { width: 10, color: '#42d978' } }
    }
  });
}

export const WEAPON_TRAIL_TYPES = ['cone', 'equal', 'snake', 'particle'];
