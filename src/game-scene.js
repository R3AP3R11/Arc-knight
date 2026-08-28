           import Phaser from 'phaser';
import { DEFAULT_WALL_COLOR, MIN_WALL_SIZE, ENEMY_TYPES, normalizeEnemy, normalizeWeapons, WEAPON_LABELS, WEAPON_TYPES, ITEM_DEFS, normalizeCrate, normalizeBarrel, normalizeChest, normalizePortal, MOD_DEFS } from './state.js';
import { renderGraph, drawWeaponGlyph, drawLock } from './ui-layer.js';
import { BINDINGS } from './ui-bindings.js';
import { buildGrid, findPath, nearestWalkable } from './pathfinding.js';
const VIEW_W = 1920, VIEW_H = 1080, CELL = 30;
// 科技风格字体（Orbitron 已由 index.html 引入）
const FONT_TECH = "'Orbitron', 'Rajdhani', 'Poppins', sans-serif";
const FONT_TECH_SC = "'Noto Sans SC', 'Orbitron', sans-serif";
const CRATE_SIZE = 50;
const CRATE_BORDER_THICKNESS = 8;
const CRATE_INSET = 7;
const BARREL_RADIUS = 30;
const BARREL_ICON = '/barrel.png';
const BARREL_TEX_KEY = '__barrel__';
const CHEST_CLOSED_KEY = '__chest_closed__';
const CHEST_OPEN_KEY = '__chest_open__';
const CHEST_TEX_KEY = '__chest_tex__';
const CHEST_SIZE = 75;           // 宝箱显示尺寸（无碰撞体积，透明背景）
const CHEST_OPEN_SCALE_CORRECTION = 1005 / 852; // 开启态内容更窄，按内容宽比补偿到与常态同宽
const CHEST_OPEN_FX_MS = 320;    // 开启金色十字星特效时长（更快）
const CHEST_SPAWN_FX_MS = 260;   // 出现金色十字星特效时长
const PORTAL_COLOR = 0x00ffff;   // 传送门主体色（青）
const PORTAL_ALPHA = 0.6;        // 传送门整体透明度（对应图标 opacity 60）
const PORTAL_LABEL = 'EVACUATION';
const VENDOR_TEX_KEY = '__vendor__';
const VENDOR_ICON = '/vending.png';
const IDOL_TEX_KEY = '__idol__';
const IDOL_ICON = '/idol.png';

// 神像祝福池：从玩家基础属性中随机抽 3 项，选 1 生效（仅当局）
const IDOL_BUFFS = [
  { id: 'atk', key: 'attackPower', name: '力量祝福', desc: '攻击力 +15%', apply: scene => { const c = scene.player.combat; c.attackPower = (c.attackPower ?? 1) * 1.15; } },
  { id: 'crit', key: 'critRate', name: '致命祝福', desc: '暴击率 +10%', apply: scene => { const c = scene.player.combat; c.critRate = (c.critRate ?? 0) + 0.1; } },
  { id: 'dodge', key: 'dodgeRate', name: '迅捷祝福', desc: '闪避率 +8%', apply: scene => { const c = scene.player.combat; c.dodgeRate = (c.dodgeRate ?? 0) + 0.08; } },
  { id: 'speed', key: 'moveSpeed', name: '疾风祝福', desc: '移动速度 +12%', apply: scene => { const c = scene.player.combat; c.moveSpeed = (c.moveSpeed ?? 1) * 1.12; } },
  { id: 'hp', key: 'maxHp', name: '生命祝福', desc: '生命上限 +25', apply: scene => { const c = scene.player.combat; c.maxHp = (c.maxHp ?? 100) + 25; scene.player.maxHp = c.maxHp; } },
  { id: 'reduction', key: 'damageReduction', name: '守护祝福', desc: '受到伤害 -10%', apply: scene => { const c = scene.player.combat; c.damageReduction = (c.damageReduction ?? 1) * 0.9; } }
];

// 局内商店（售货机）商品：仅当局生效的属性加成，后续在此补充
const VENDOR_BUFFS = [
  { id: 'atk', name: '火力强化', desc: '攻击力 +20%', price: 30, apply: scene => { const c = scene.player.combat; c.attackPower = (c.attackPower ?? 1) * 1.2; } },
  { id: 'speed', name: '轻量化', desc: '移动速度 +15%', price: 20, apply: scene => { const c = scene.player.combat; c.moveSpeed = (c.moveSpeed ?? 1) * 1.15; } },
  { id: 'hp', name: '强化装甲', desc: '生命上限 +30', price: 40, apply: scene => { const c = scene.player.combat; c.maxHp = (c.maxHp ?? 100) + 30; scene.player.maxHp = c.maxHp; } }
];
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
const WEAPON_SLOT_LEVELS = [12, 30];
const LEVEL_HP_BONUS = 10;

// 玩家战斗属性计算（combat 数据来自存档）
// 返回玩家本次攻击的伤害值
function playerDamage(scene, weaponType) {
  const combat = scene.player.combat;
  if (!combat) return BULLET_DAMAGE;
  const base = WEAPONS[weaponType]?.baseDamage ?? BULLET_DAMAGE;
  let dmg = base * (combat.attackPower ?? 1);
  if (Math.random() < (combat.critRate ?? 0)) dmg *= 2;
  return dmg;
}

// 玩家收到伤害：免伤 + 闪避
// 返回实际扣除的血量
function playerIncomingDamage(scene, dmg) {
  const combat = scene.player.combat;
  if (!combat) return dmg;
  if (Math.random() < (combat.dodgeRate ?? 0)) return 0;
  return dmg * (combat.damageReduction ?? 1);
}

const ENEMY_BEHAVIOR = {
  basic1: { size: 30, approach: 200, engage: 50, engageDelay: 0.4, colorRange: 300, orbit: null, charge: null, spin: 0, onEnterOrbit: { minDur: 0.5, maxDur: 1, minDeg: 60, maxDeg: 120 } },
  basic2: { size: 30, approach: 200, engage: 50, engageDelay: 0.4, colorRange: 300, orbit: { period: 2, duration: 1, degPerSec: 30 }, charge: null, spin: 4 },
  advanced1: { size: 48, approach: 200, engage: 160, engageDelay: 0.4, colorRange: 200, orbit: { period: 1, duration: 0.5, degPerSec: 80 }, charge: { pause: 0.6, speed: 200 }, spin: 0, lineWidth: 6 },
  advanced2: { size: 40, attackRange: 500, fireInterval: 400, burstInterval: 3000, burstCount: 3, speed: 30, dormantSpin: 20, orbitMin: 30, orbitMax: 40, growDuration: 0.5, orbit: null, charge: null, spin: 0, onEnterOrbit: null }
};

// 工坊页基础属性加点配置：key → 属性键 / 每点收益 / 上限 / 显示
const UPGRADE_STATS = {
  maxHp:       { label: '生命', per: 20, cap: 10, fmt: v => `${Math.round(v)}` },
  maxShield:   { label: '护盾', per: 10, cap: 10, fmt: v => `${Math.round(v)}` },
  attackPower: { label: '攻击', per: 0.1, cap: 10, fmt: v => `${Math.round((v - 1) * 100)}%` },
  attackSpeed: { label: '攻速', per: 0.08, cap: 10, fmt: v => `${Math.round((v - 1) * 100)}%` }
};

// ============================================================
// 新手教程（newbee 关卡）阶段机
// ============================================================
const NEWBEE_MIN_HP = 5;               // 新手关血量下限，永不失败
const NEWBEE_TRIANGLE_RADIUS = 500;    // 新手关阶段3三角形生成半径
const ENEMY_EDGE_MARGIN = 60;          // 敌人生成距世界边界的最小边距
const HUB_INTERACT_RADIUS = 80;        // 骑士之家可互动物体的触发距离
const HUB_INTERACTABLES = [
  { id: 'workshop', x: 1320, y: 680, label: '工坊' },   // 打开工坊页面
  { id: 'weapon', x: 540, y: 300, label: '商店' },      // 打开武器页面
  { id: 'levelSelect', x: 940, y: 300, label: '选择关卡' } // 打开关卡选择页面
];
const NEWBEE_HINT_FADE_MS = 1000;      // 提示淡入/淡出时长
const NEWBEE_HINT_PRE_MS = 2000;       // 提示出现前延迟
const NEWBEE_HINT_POST_MS = 2000;      // 提示结束后的额外等待
const NEWBEE_HINT_Y_OFFSET = 160;      // 提示相对玩家头顶的高度
// 提示图标（图片素材：位于 public/ 目录，随项目版本控制）
const NEWBEE_ICONS = {
  mouse: '/mouse.png',     // 鼠标左键
  wasd: '/wasd.png',       // WASD
  space: '/space.png',     // 空格
  f: '/f.png'              // F 键
};

function color(value) {
  return Phaser.Display.Color.HexStringToColor(value).color;
}

// 战斗 HUD 顶部状态指示器（EXPLORE / COMBAT / SECURE）
const HUD_RECT_W = 400, HUD_RECT_H = 60;
const HUD_RECT_X = (VIEW_W - HUD_RECT_W) / 2;   // 760
const HUD_RECT_Y = 16;
const HUD_TRANSITION_MS = 500;   // 0.5s 切换动画
const HUD_IDLE_MS = 3000;        // 3s 常态脉冲
const HUD_STATES = {
  explore: { color: '#ffffff', label: 'EXPLORE', text: '#000000' },
  combat:  { color: '#ff3b3b', label: 'COMBAT',  text: '#ffffff' },
  secure:  { color: '#37d67a', label: 'SECURE',  text: '#ffffff' },
  black:   { color: '#000000', label: '',        text: '#ffffff' }   // 脉冲用黑色，文本沿用当前态
};

// 战斗 HUD 设置菜单图标（/图标 文件夹，经 /icons/ 接口提供）
const ICON_SETTINGS = `/icons/${encodeURIComponent('设置.png')}`;
const ICON_EXIT = `/icons/${encodeURIComponent('退出.png')}`;
const ICON_RETRY = `/icons/${encodeURIComponent('再来一次.png')}`;
const ICON_CONTINUE = `/icons/${encodeURIComponent('继续.png')}`;

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

function pointInWall(wall, x, y, pad = 0) {
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

function hitWall(wall, x, y, pad = 0) {
  return pointInWall(wall, x, y, pad);
}

function resolveCircleAgainstWalls(entity, radius, walls) {
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

function hitTrigger(trigger, x, y) {
  if (trigger.shape === 'circle') {
    const r = Math.max(trigger.w, trigger.h) / 2;
    return Math.hypot(x - trigger.x, y - trigger.y) <= r;
  }
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
    const t = w.shape === 'rect'
      ? rayRotatedRectDistance(x0, y0, dx, dy, w)
      : rayCircleDistance(x0, y0, dx, dy, w);
    if (t !== null && t < tMin) tMin = t;
  }
  return tMin;
}

function rayCircleDistance(x0, y0, dx, dy, wall) {
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

function rayToBounds(x0, y0, dx, dy, viewW, viewH) {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (viewW - x0) / dx);
  else if (dx < 0) t = Math.min(t, (-x0) / dx);
  if (dy > 0) t = Math.min(t, (viewH - y0) / dy);
  else if (dy < 0) t = Math.min(t, (-y0) / dy);
  return t;
}

// 子弹撞墙反弹：按矩形墙局部坐标判断侵入轴，翻转对应速度分量
function reflectBulletAgainstWall(b, wall) {
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
const GATE_SPAWN_MS = 500;
const GATE_OUTER_COLOR = '#FFE6BE';
const GATE_INNER_COLOR = '#FFCB85';
const GATE_OFFSET_RATIO = 0.14;

function fillRotatedRoundedRect(g, cx, cy, w, h, r, rad) {
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

function drawGates(scene, g, level, selected) {
  const l = level;
  const gates = scene.editing ? (l.gates || []) : scene.gates;
  const seen = new Set();

  for (const gt of gates) {
    if (!scene.editing && !gt.active) continue;
    seen.add(gt.id);

    const t = scene.editing ? 1 : Math.min(1, gt.spawnT ?? 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const fadeIn = Math.min(1, t * 2);
    const baseAlpha = scene.editing && !gt.active ? 0.4 : 1;
    const alpha = fadeIn * baseAlpha;
    const offset = gt.h * GATE_OFFSET_RATIO * ease;
    const rad = Phaser.Math.DegToRad(gt.rotation || 0);
    const sinR = Math.sin(rad), cosR = Math.cos(rad);
    const outerCx = gt.x + sinR * offset, outerCy = gt.y - cosR * offset;
    const innerCx = gt.x - sinR * offset, innerCy = gt.y + cosR * offset;

    g.fillStyle(color(gt.color1 || GATE_OUTER_COLOR), 0.7 * alpha);
    fillRotatedRoundedRect(g, outerCx, outerCy, gt.w, gt.h, 10, rad);

    const innerW = gt.w * 0.91;
    g.fillStyle(color(gt.color2 || GATE_INNER_COLOR), 0.5 * alpha);
    fillRotatedRoundedRect(g, innerCx, innerCy, innerW, gt.h, 10, rad);

    let text = scene.gateTexts?.get(gt.id);
    if (!text) {
      text = scene.add.text(gt.x, gt.y, gt.label || 'Barrier Active', {
        fontFamily: FONT_TECH_SC,
        fontSize: '14px',
        color: '#12233f',
        letterSpacing: 2
      }).setOrigin(0.5).setDepth(10);
      if (scene.uiCam) scene.uiCam.ignore(text);
      scene.gateTexts.set(gt.id, text);
    }
    text.setText(gt.label || 'Barrier Active');
    text.setPosition(gt.x, gt.y);
    text.setRotation(rad);
    text.setAlpha(alpha);
    text.setVisible(true);

    if (scene.editing && selected === gt) {
      const box = { x: gt.x, y: gt.y, w: gt.w, h: gt.h * 1.42, rotation: gt.rotation };
      const corners = wallCorners(box);
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
    }
  }

  if (scene.gateTexts) {
    for (const [id, text] of scene.gateTexts) {
      if (!seen.has(id)) {
        text.destroy();
        scene.gateTexts.delete(id);
      } else {
        text.setVisible(scene.editing || (gates.find(x => x.id === id)?.active === true));
      }
    }
  }
}
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

  for (let i = (l.chests || []).length - 1; i >= 0; i--) {
    const ch = l.chests[i];
    if (Math.hypot(ch.x - x, ch.y - y) <= Math.max(ch.openRadius, CHEST_SIZE / 2)) return { entity: ch, type: 'chest' };
  }

  for (let i = (l.portals || []).length - 1; i >= 0; i--) {
    const p = l.portals[i];
    const halfDiag = Math.hypot(p.w, p.h) / 2;
    if (Math.hypot(p.x - x, p.y - y) <= Math.max(p.interactRadius, halfDiag)) return { entity: p, type: 'portal' };
  }

  for (let i = l.triggers.length - 1; i >= 0; i--) {
    const t = l.triggers[i];
    if (hitTrigger(t, x, y)) return { entity: t, type: 'trigger' };
  }

  for (let i = (l.gates || []).length - 1; i >= 0; i--) {
    const gt = l.gates[i];
    if (hitBackground(gt, x, y)) return { entity: gt, type: 'gate' };
  }

  for (let i = (l.vendors || []).length - 1; i >= 0; i--) {
    const v = l.vendors[i];
    if (hitBackground(v, x, y)) return { entity: v, type: 'vendor' };
  }

  for (let i = (l.idols || []).length - 1; i >= 0; i--) {
    const v = l.idols[i];
    if (hitBackground(v, x, y)) return { entity: v, type: 'idol' };
  }

  for (let i = (l.icons || []).length - 1; i >= 0; i--) {
    const ic = l.icons[i];
    if (hitBackground(ic, x, y)) return { entity: ic, type: 'icon' };
  }

  for (let i = (l.spawnZones || []).length - 1; i >= 0; i--) {
    const z = l.spawnZones[i];
    if (hitBackground(z, x, y)) return { entity: z, type: 'spawnZone' };
  }

  for (let i = l.walls.length - 1; i >= 0; i--) {
    const w = l.walls[i];
    if (hitWall(w, x, y)) return { entity: w, type: 'wall' };
  }

  for (let i = (l.images || []).length - 1; i >= 0; i--) {
    const im = l.images[i];
    if (hitBackground(im, x, y)) return { entity: im, type: 'image' };
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

// 传送门图标：按 mxGraph 解密样式绘制（#00FFFF 填充、透明度 60%、无描边 + EVACUATION 文字）
function fillRotatedRect(g, cx, cy, w, h, rad) {
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

function drawPortalShape(g, x, y, w, h, rotation = 0) {
  const rad = Phaser.Math.DegToRad(rotation);
  const bh = Math.max(6, h * 0.42);
  g.fillStyle(PORTAL_COLOR, PORTAL_ALPHA);
  // 下层宽条
  fillRotatedRect(g, x, y + h * 0.06, w, bh, rad);
  // 上层窄条
  fillRotatedRect(g, x, y - h * 0.06, w * 0.85, bh, rad);
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

// ============================================================
// 主界面背景「虫洞」圆环参数
// 微调间隔与厚度，改下面这些常量即可
// ============================================================
const RING_INNER_RATIO = 0.2;   // 最内环半径 = 最外环半径的 0.2 倍
const RING_SPACING_EXP  = 1.6;  // 间隔曲线指数：越大 → 内环越密、外环越疏
const RING_THICK_OUTER  = 14;   // 最外环厚度（像素）
const RING_THICK_INNER  = 3;    // 最内环厚度（像素）

// 可选：按环索引逐个覆盖（手动精调用）
// 键 = 环索引（0 = 最外圈），值 = { r?: 半径比例, t?: 厚度 }
// 填了的环用这里的手动值，没填的环用下面的公式
const RING_OVERRIDES = {
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
function wormholeRingRadiusFactor(i, n) {
  const u = n > 1 ? i / (n - 1) : 0;                       // 0=最外，1=最内
  return RING_INNER_RATIO
    + (1 - RING_INNER_RATIO) * Math.pow(1 - u, RING_SPACING_EXP);
}

// 第 i 个环的厚度（像素）：外厚内薄，线性过渡
function wormholeRingThickness(i, n) {
  const u = n > 1 ? i / (n - 1) : 0;
  return RING_THICK_OUTER * (1 - u) + RING_THICK_INNER * u;
}

// 第 i 个环的颜色：次外层（索引 1）白色，其余橙色
function wormholeRingColor(i) {
  return i === 1 ? 0xffffff : 0xff9d2e;
}

// 最小非零半径比例（用于判断「所有环都超出屏幕」）
function wormholeMinRadiusFactor(n) {
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
const INTRO_SHRINK = 1.6;       // 环圆心归位时长（原值两倍）
const INTRO_CAMERA = 1.5;       // 镜头移至虫洞中心时长
const INTRO_HOLD = 0.1;         // 镜头到位后停顿
const INTRO_CAMERA_EXPONENT = 2.4; // 镜头移动指数，先慢后快
const INTRO_SLOW = 1;           // 极慢放大时长
const INTRO_SLOW_RATE = 0.25;   // 极慢放大速率（倍数/秒）
const INTRO_GROW_ACCEL = 32;    // 指数增长率：原环与新环共用
const INTRO_RING_DELAY = 0.05;  // 加速开始后快速生成首个新环
const INTRO_RING_INTERVAL = 0.24;       // 首个间隔
const INTRO_RING_INTERVAL_MIN = 0.08;   // 加速后的最小间隔
const INTRO_RING_INTERVAL_ACCEL = 0.055; // 每次生成后缩短的间隔
const INTRO_RING_INITIAL_SCALE = 0.7;    // 所有新环统一初始半径比例
const INTRO_RING_THICKNESS = 2;   // 新环厚度
const INTRO_BLACK_PAUSE = 1.5;  // 全黑后停顿时长

// 入场放大曲线：镜头到位 -> 停顿 -> 极慢放大 -> 加速放大
function introGrowScale(t, fx) {
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

function drawIntroRings(g, intro, fx, centerX, centerY, time) {
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

function introRingStart(fx) {
  return (fx.introCamera ?? INTRO_CAMERA)
    + (fx.introHold ?? INTRO_HOLD)
    + (fx.introSlow ?? INTRO_SLOW);
}

function drawWormhole(g, fx, t, intro) {
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

function getHexagonPoints(centerX, centerY, radius) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 3;
    return {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius
    };
  });
}

function drawHexagonBody(graphics, centerX, centerY, radius = PLAYER_ART.hexagonRadius, offsetX = 0, offsetY = 0, lineThickness = PLAYER_ART.yLineThickness) {
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

  const drawArc = (a0, a1, fillColor, alpha = 1) => {
    g.fillStyle(fillColor, alpha);
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
    const wt = toOrder[i];
    const dim = WEAPONS[wt]?.maxAmmo !== Infinity && (player.ammo?.[wt] ?? 0) <= 0 && (player.weaponCharge?.[wt]?.have ?? 0) < (player.weaponCharge?.[wt]?.need ?? 0);
    const alpha = dim ? 0.28 : 1.0;

    if (sweep <= start) {
      drawArc(start, end, toColor, alpha);
    } else if (sweep >= end) {
      drawArc(start, end, fromColor, alpha);
    } else {
      drawArc(start, sweep, fromColor, alpha);
      drawArc(sweep, end, toColor, alpha);
    }
    start += angles[i];
  }
}

function drawWallShape(g, wall, fillColor) {
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

function getWeaponOrbPosition(player, scale = 1) {
  const angle = player.weaponAngle || 0;
  return {
    x: player.x + Math.cos(angle) * PLAYER_ART.weaponRingRadius * scale,
    y: player.y + Math.sin(angle) * PLAYER_ART.weaponRingRadius * scale
  };
}

const WEAPONS = {
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
  },

  yellow: {
    scheme: 'yellow',
    ringColor: '#feed34',
    fireInterval: 150,
    baseDamage: 8,
    maxAmmo: 45,
    chargeRequired: 5,
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
    ringColor: '#42d978',
    fireInterval: 150,
    baseDamage: 16,
    maxAmmo: 30,
    chargeRequired: 8,
    fire(player, level, scene) {
      const angle = player.weaponAngle || 0;
      const width = PLAYER_ART.weaponOrbRadius * 1.25 * 1.5;
      const orb = getWeaponOrbPosition(player);
      return [{
        // 光束元数据：由发射逻辑（含通用改件联动）用 spawnLaser 生成实际激光
        beam: true,
        ox: orb.x, oy: orb.y,
        angle,
        width,
        color: this.ringColor
      }];
    }
  }
};

// ============================================================
// 改件（Mods）系统
// 通用改件：任意武器可用；专属改件：weapon 字段指定专属武器
// （改件定义 MOD_DEFS 见 state.js）
// ============================================================
function activeMods(scene, weaponType) {
  const slot = scene.player?.equipment?.weaponMods?.[weaponType];
  if (!slot) return new Set();
  const generic = Array.isArray(slot.generic) ? slot.generic : [];
  const list = slot.dedicated ? [...generic, slot.dedicated] : generic;
  return new Set(
    list.filter(id => {
      const def = MOD_DEFS[id];
      return def && (def.weapon === '' || def.weapon === weaponType);
    })
  );
}

// 生成一条激光：计算端点（穿透改件穿墙）+ 即时伤害敌人，返回 laser 对象
function spawnLaser(scene, weaponType, ox, oy, angle, width, color) {
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

function drawHexRingPlayer(graphics, player, scale = 1) {
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
      this.input.on('pointerup', () => { this.handleWorkshopPointerUp(); this.drag = null; this.panning = false; ctx.redraw(); });
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
      this.lockEffects = [];
      this.transition = null;
      this.intro = null;
      this.wheelAnim = null;
      this.hudMode = 'explore';
      this.hudAnim = null;
      this.hudIdleClock = HUD_IDLE_MS;
      this.hudIdleStep = null;
      if (this.waveEvents) {
        this.waveEvents.forEach(ev => ev.remove(false));
      }
      this.waveEvents = [];
      this.initNewbee();
      this.initHub();

      const l = ctx.state.level;
      this.crates = (l.crates || []).map(c => ({ ...c, alive: true }));
      this.barrels = (l.barrels || []).map(b => ({ ...b, alive: true }));
      this.chests = (l.chests || []).map(c => ({
        ...c,
        spawned: c.trigger === 'start',
        opened: false,
        fx: null
      }));
      this.portals = (l.portals || []).map(p => ({
        ...p,
        spawned: p.trigger === 'start',
        used: false
      }));
      this.portalNearest = null;
      this.portalTipT = 0;
      this.vendors = (l.vendors || []).map(v => ({ ...v }));
      this.vendorNearest = null;
      this.vendorTipT = 0;
      this.vendorBought = new Set();
      this.idols = (l.idols || []).map(v => ({ ...v, used: false }));
      this.idolNearest = null;
      this.idolTipT = 0;
      this.idolOffer = null;
      this.icons = (l.icons || []).map(v => ({ ...v }));
      this.iconNearest = null;
      this.iconTipT = 0;
      this.gates = (l.gates || []).map(gt => ({ ...gt, spawnT: gt.active ? 1 : 0 }));
      this.crateDebris = [];
      this.barrelExplosions = [];

      const obstacles = [
        ...l.walls,
        ...(l.crates || []),
        ...(l.barrels || []).map(b => ({ x: b.x, y: b.y, w: b.r * 2, h: b.r * 2 }))
      ];
      this.grid = buildGrid({ width: l.world.width, height: l.world.height }, obstacles, CELL, PATH_INFLATE);
      // 数据源：游戏预览用临时数据，试玩/正式游戏用真实存档（试玩为测试存档）
      const source = this.isPreviewMode() ? ctx.state.previewPlayer : ctx.state.player;
      // 局内武器：关卡 spawn 配置 + 存档已解锁武器（购买武器后可在战斗中使用）
      const saveUnlocked = !this.editing
        ? Object.entries(source?.weapons || {}).filter(([, v]) => v?.unlocked).map(([k]) => k)
        : [];
      const fallbackWeapons = normalizeWeapons([...new Set([...(l.spawn.weapons || []), ...saveUnlocked])]);
      const loadoutUnlocked = (Array.isArray(source?.loadout) ? source.loadout : [])
        .filter(w => w && source?.weapons?.[w]?.unlocked);
      const weapons = loadoutUnlocked.length ? normalizeWeapons(loadoutUnlocked) : fallbackWeapons;
      const weaponType = weapons[0];
      const weapon = WEAPONS[weaponType] || WEAPONS.radial;
      const scheme = weapon.scheme;
      const level = l.spawn.level ?? 1;
      const levels = source?.levels;
      // 进入新手关卡即标记已参与过 newbee
      if (!this.editing && ctx.state.levelId === 'newbee' && source) {
        source.playedNewbee = true;
      }
      // 存档关卡未解锁时，正式游戏回退到已解锁关卡
      if (!this.editing && levels && !levels.unlocked.includes(ctx.state.levelId)) {
        ctx.state.levelId = levels.current || levels.unlocked[0] || 'level-1';
      }
      const combat = (this.editing ? null : (source?.combat || null)) || {};
      const savedProgress = (this.editing ? null : source?.progress) || {};
      const savedCurrency = (this.editing ? null : source?.currency) || {};
      const maxHp = this.editing
        ? (l.spawn.maxHp ?? 100) + (level - 1) * LEVEL_HP_BONUS
        : (combat.maxHp ?? 100);
      const maxShield = this.editing ? SHIELD_MAX : (combat.maxShield ?? SHIELD_MAX);
      const greenSlot = source?.equipment?.weaponMods?.green;
      const hasCapacity = greenSlot?.dedicated === 'capacity'
        || (Array.isArray(greenSlot?.generic) && greenSlot.generic.includes('capacity'));
      const ammo = {};
      for (const w of weapons) {
        let max = WEAPONS[w]?.maxAmmo ?? Infinity;
        // 容量改件：绿色武器弹量翻倍
        if (hasCapacity && w === 'green' && max !== Infinity) max *= 2;
        ammo[w] = max;
      }

      const weaponCharge = {};
      for (const w of weapons) {
        const need = WEAPONS[w]?.chargeRequired;
        if (need) weaponCharge[w] = { need, have: 0 };
      }

      this.player = {
        ...l.spawn,
        r: PLAYER_COLLISION_RADIUS,
        scheme,
        weapon,
        weaponType,
        weapons,
        weaponIndex: 0,
        ammo,
        weaponCharge,
        hp: maxHp,
        maxHp,
        level: savedProgress.level ?? l.spawn.level ?? 1,
        exp: savedProgress.exp ?? 0,
        expToNext: savedProgress.expToNext ?? 100,
        gold: savedCurrency.gold ?? 0,
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
        shield: maxShield,
        maxShield,
        shieldBroken: false,
        hitFlash: null,
        combat,
        points: source?.points || {},
        loadout: Array.isArray(source?.loadout) ? [...source.loadout] : ['radial'],
        equipment: source?.equipment || {
          weaponMods: {
            radial: { generic: [], dedicated: null },
            yellow: { generic: [], dedicated: null },
            green: { generic: [], dedicated: null }
          },
          relics: [],
          pets: []
        },
        items: source?.items || { stacks: {}, uniques: [] },
        spendablePoints: savedProgress.points ?? 0
      };

      this.enemies = (l.enemies || []).map(e => this.initEnemy(e));
      if (!this.editing) this.applyPlayerBounds();
      if (!this.editing) {
        this.buildUITexts();
        this.syncUIState();
      }
      if (!this.editing) this.setupPlayCamera();
      if (!this.editing && !this.isMenuLevel()) this.startLevelIntro();
      this.draw();
    }

    // 新手教程状态初始化：所有操作禁用，从阶段 1 开始
    initNewbee() {
      if (this.newbeeHintText) { this.newbeeHintText.destroy(); this.newbeeHintText = null; }
      if (this.newbeeHintIcons) {
        for (const img of Object.values(this.newbeeHintIcons)) if (img && typeof img === 'object') img.destroy?.();
        this.newbeeHintIcons = null;
      }
      if (this.newbeeRectLabels) {
        for (const label of this.newbeeRectLabels.values()) label.destroy?.();
        this.newbeeRectLabels = null;
      }
      if (!this.isNewbeeLevel()) { this.newbee = null; return; }
      this.newbeeDelay = {};
      this.newbee = {
        phase: 1,
        // 权限开关
        allowFire: true,       // 阶段1即解禁左键射击
        allowMove: false,
        allowShield: false,
        // 提示
        hint: { text: '按「鼠标左键」射击', icon: 'mouse', fadeAt: null, pre: NEWBEE_HINT_PRE_MS, showT: 0 },
        // 阶段 1 子状态
        fired: false,          // 是否已开火
        subHintShown: false,   // 校准提示是否已显示
        // 阶段 2
        moved: false,
        // 阶段 3
        enemies: [],           // 本阶段生成的敌人引用
        phase3Fire: false,
        // 阶段 4
        advanced: null,
        shieldBlocked: false,  // 是否已用护盾抵挡过一次子弹
        // 阶段 6
        phase6Shown: false,
        exitRect: { x: 797, y: 139, w: 160, h: 160 },
        practiceRect: { x: 432, y: 674, w: 160, h: 160 }
      };
    }

    // 骑士之家：清理互动 UI 状态
    initHub() {
      if (this.hubIcons) {
        for (const spr of Object.values(this.hubIcons)) spr.destroy?.();
        this.hubIcons = null;
      }
      this.hubTipText?.destroy?.();
      this.hubTipText = null;
      this.hubTipKeyText?.destroy?.();
      this.hubTipKeyText = null;
      this.hubNearest = null;
      this.hubTipT = 0;
    }

    // 统一 F 键帽图标（/f.png），hub 与售货机 tips 共用
    getFKeyBadge() {
      if (this.fKeyBadge) return this.fKeyBadge;
      const key = '__fkey_badge__';
      const make = () => {
        this.fKeyBadge = this.add.image(0, 0, key).setOrigin(0.5).setDepth(14).setDisplaySize(30, 30);
        if (this.uiCam) this.uiCam.ignore(this.fKeyBadge);
        this.fKeyBadge.setVisible(false);
        return this.fKeyBadge;
      };
      if (this.textures.exists(key)) return make();
      const raw = new Image();
      raw.onload = () => {
        if (!raw.naturalWidth || this.fKeyBadge) return;
        if (!this.textures.exists(key)) this.textures.addImage(key, raw);
        make();
      };
      raw.src = '/f.png';
      return null;
    }

    // 通用图标精灵（懒加载）：首次调用触发 Image 加载，加载完成后再返回精灵
    iconSprite(id, src) {
      if (!this.menuIconSprites) this.menuIconSprites = new Map();
      if (this.menuIconSprites.has(id)) return this.menuIconSprites.get(id);
      if (!this.menuIconLoading) this.menuIconLoading = new Set();
      const texKey = `__menu_icon_${id}__`;
      const make = () => {
        const s = this.add.image(0, 0, texKey).setOrigin(0.5).setDepth(1002);
        this.cameras.main.ignore(s);
        s.setVisible(false);
        this.menuIconSprites.set(id, s);
        return s;
      };
      if (this.textures.exists(texKey)) return make();
      if (this.menuIconLoading.has(id)) return null;
      this.menuIconLoading.add(id);
      const raw = new Image();
      raw.onload = () => {
        this.menuIconLoading.delete(id);
        if (!raw.naturalWidth || this.menuIconSprites.has(id)) return;
        if (!this.textures.exists(texKey)) this.textures.addImage(texKey, raw);
        make();
      };
      raw.onerror = () => this.menuIconLoading.delete(id);
      raw.src = src;
      return null;
    }

    // 保证玩家创建后边界以玩家为中心（padding 足够覆盖任意出生点）
    applyPlayerBounds() {      const { w, h } = this.worldSize();
      const x = this.player ? this.player.x : w / 2;
      const y = this.player ? this.player.y : h / 2;
      const pad = 2000;
      this.cameras.main.setBounds(Math.min(0, x - pad), Math.min(0, y - pad), w + pad * 2, h + pad * 2);
    }

    startLevelIntro() {
      const battle = this.isBattleLevel();
      const duration = battle ? 3.5 : 1.2;
      if (battle) {
        const targetZoom = this.playZoom();
        const startZoom = 1920 / 340;   // 初始视野约 340
        this.levelIntro = { t: 0, duration, battle: true, startZoom, targetZoom };
        this.cameras.main.setZoom(startZoom);
        this.centerCameraOnPlayer();
      } else {
        this.levelIntro = { t: 0, duration, battle: false };
      }
      this.state = 'transition';
    }

    updateLevelIntro(dt) {
      if (!this.levelIntro) return false;
      const intro = this.levelIntro;
      intro.t += dt / 1000;
      const p = Math.min(1, intro.t / intro.duration);
      if (intro.battle) {
        const eased = Math.pow(p, 2.4);   // 先慢后快
        const zoom = intro.startZoom + (intro.targetZoom - intro.startZoom) * eased;
        this.cameras.main.setZoom(zoom);
        this.cameras.main.scrollX = this.player.x - this.cameras.main.width / 2;
        this.cameras.main.scrollY = this.player.y - this.cameras.main.height / 2;
      }
      if (p >= 1) {
        this.levelIntro = null;
        this.state = 'playing';
      }
      return true;
    }

    centerCameraOnPlayer() {
      const cam = this.cameras.main;
      const z = this.playZoom();
      cam.setZoom(z);
      // Phaser4：scrollX = 视口左上角世界坐标，居中=目标 - 视口宽/2（不随 zoom 缩放）
      cam.scrollX = this.player.x - cam.width / 2;
      cam.scrollY = this.player.y - cam.height / 2;
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
      const walls = ctx.state.level.walls;
      const gateWalls = this.activeGateWalls();
      return rayWallDistance(x0, y0, dx, dy, walls) > 1
        && rayWallDistance(x0, y0, dx, dy, gateWalls) > 1;
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
      const rules = ctx.state.level.dropRules?.[e.type];
      if (Array.isArray(rules) && rules.length) {
        for (const rule of rules) {
          if (Math.random() * 100 >= rule.chance) continue;
          const count = Math.max(0, Math.floor(Number(rule.count) || 0));
          if (rule.item === 'charge') {
            // weapon 未指定时：为玩家局内拥有的每把特殊武器各掉一个充能球
            const targets = rule.weapon ? [rule.weapon] : Object.keys(this.player.weaponCharge || {});
            for (const weapon of targets) {
              const c = this.player.weaponCharge?.[weapon];
              if (!c || c.have >= c.need) continue;
              this.spawnDropItems(e, 'charge', count, weapon);
            }
            continue;
          }
          this.spawnDropItems(e, rule.item, count);
        }
        return;
      }
      const d = e.drops || {};
      const counts = { gold: Number(d.gold) || 0, exp: Number(d.exp) || 0 };
      for (const [type, count] of Object.entries(counts)) this.spawnDropItems(e, type, count);
    }

    spawnDropItems(e, type, count, weapon = '') {
      if (type === 'charge' && !weapon) return;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const driftSpeed = type === 'gold' ? 10 : 20;
        const driftTtl = type === 'gold' ? 1000 : 600;
        this.drops.push({
          type,
          weapon,
          x: e.x + (Math.random() - 0.5) * 30,
          y: e.y + (Math.random() - 0.5) * 30,
          drift: { vx: Math.cos(angle) * driftSpeed, vy: Math.sin(angle) * driftSpeed, ttl: driftTtl }
        });
      }
    }

    collectDrop(d) {
      if (d.type === 'exp') {
        this.player.exp = (this.player.exp || 0) + 1;
        this.commitPlayer();
      } else if (d.type === 'charge') {
        const c = this.player.weaponCharge?.[d.weapon];
        if (!c) return;
        c.have++;
        this.tryRefillWeapon(d.weapon);
      } else if (d.type === 'gold') {
        // 金币局内累加，通关结算时才写入存档
        this.player.gold = (this.player.gold || 0) + 1;
      }
    }

    tryRefillWeapon(type) {
      const c = this.player.weaponCharge?.[type];
      if (!c) return;
      const ammo = this.player.ammo?.[type];
      if (ammo === undefined || ammo === Infinity) return;
      if (ammo <= 0 && c.have >= c.need) {
        c.have = 0;
        this.player.ammo[type] = WEAPONS[type]?.maxAmmo ?? ammo;
      }
    }

    // 把运行时资产/进度回写到数据层；预览模式写临时数据，试玩/正式写存档
    // 经验实时写入；金币在 settleVictory 通关结算时写入
    commitPlayer() {
      if (this.editing) return;
      const p = this.isPreviewMode() ? ctx.state.previewPlayer : ctx.state.player;
      if (!p) return;
      p.progress.level = this.player.level ?? p.progress.level;
      p.progress.exp = this.player.exp ?? p.progress.exp;
      p.progress.expToNext = this.player.expToNext ?? p.progress.expToNext;
      this.persistSave(p);
    }

    // 通关结算：金币、关卡完成进度、当前关卡写入存档；失败不调用
    settleVictory() {
      if (this.editing) return;
      const p = this.isPreviewMode() ? ctx.state.previewPlayer : ctx.state.player;
      if (!p) return;
      if (this.player) p.currency.gold = this.player.gold ?? p.currency.gold;
      const levelId = ctx.state.levelId;
      if (levelId && levelId !== 'newbee' && levelId !== 'login' && levelId !== 'knight-home' && !p.levels.completed.includes(levelId)) {
        p.levels.completed.push(levelId);
      }
      if (levelId) p.levels.current = levelId;
      this.persistSave(p);
    }

    // 宝箱出现：伴随金色十字星特效
    spawnChest(chest) {
      if (chest.spawned || chest.opened) return;
      chest.spawned = true;
      chest.fx = { t: CHEST_SPAWN_FX_MS, kind: 'spawn' };
    }

    // 触发器清敌事件派发后，令绑定该触发器的宝箱出现
    spawnChestsForTrigger(triggerId) {
      if (!this.chests || !triggerId) return;
      for (const chest of this.chests) {
        if (chest.trigger === 'trigger' && chest.triggerId === triggerId) {
          this.spawnChest(chest);
        }
      }
    }

    // 触发器清敌事件派发后，令绑定该触发器的传送门出现
    spawnPortalsForTrigger(triggerId) {
      if (!this.portals || !triggerId) return;
      for (const portal of this.portals) {
        if (portal.trigger === 'trigger' && portal.triggerId === triggerId) {
          this.spawnPortal(portal);
        }
      }
    }

    spawnPortal(portal) {
      if (portal.spawned || portal.used) return;
      portal.spawned = true;
      portal.fx = { t: CHEST_SPAWN_FX_MS, kind: 'spawn' };
    }

    // 传送门交互：直接触发整体通关标记（回到骑士之家）
    usePortal(portal) {
      if (portal.used) return;
      portal.used = true;
      this.state = 'end';
      this.settleVictory();
    }

    openChest(chest) {
      if (chest.opened) return;
      chest.opened = true;
      chest.fx = { t: CHEST_OPEN_FX_MS, kind: 'open' };
      for (const rule of chest.rewards) {
        if (Math.random() * 100 >= rule.chance) continue;
        this.spawnDropItems(chest, rule.item, Math.max(0, Math.floor(Number(rule.count) || 0)));
      }
    }

    updateChests(dt) {
      if (!this.chests) return;
      for (const chest of this.chests) {
        if (chest.fx) {
          chest.fx.t -= dt;
          if (chest.fx.t <= 0) chest.fx = null;
        }
        if (chest.spawned && !chest.opened
          && Math.hypot(this.player.x - chest.x, this.player.y - chest.y) <= chest.openRadius) {
          this.openChest(chest);
        }
      }
    }

    updatePortals(dt) {
      if (!this.portals) return;
      for (const p of this.portals) {
        if (p.fx) {
          p.fx.t -= dt;
          if (p.fx.t <= 0) p.fx = null;
        }
      }
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
      const floor = this.isNewbeeLevel() ? NEWBEE_MIN_HP : 0;
      const actual = playerIncomingDamage(this, dmg);
      if (actual <= 0) return;
      this.player.hp = Math.max(floor, (this.player.hp ?? 100) - actual);
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
        const actual = playerIncomingDamage(this, damage || 0) || damage || 0;
        this.player.shield = Math.max(0, this.player.shield - actual);
        this.hitEffects.push({ x, y, ttl: HIT_FX_TTL, color: SHIELD_HIT_COLOR });
        this.cameras.main.shake(SHIELD_SHAKE_MS, SHIELD_SHAKE_INTENSITY);
        if (this.newbee) this.newbee.shieldBlocked = true;
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
      return ctx.state.level.walls.some(w => hitWall(w, x, y))
        || this.activeGateWalls().some(w => hitWall(w, x, y));
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

    spawnOffscreen(t, count, enemyType) {
      const v = this.viewRect();
      const baseOff = SPAWN_OFFSCREEN_PX / this.cameras.main.zoomX;
      const { w: ww, h: wh } = this.worldSize();
      const type = enemyType || 'basic1';

      for (let i = 0; i < count; i++) {
        let p = null;
        // 随机更换位置，直到找到与玩家连线无障碍的屏幕外点
        for (let attempt = 0; attempt < 60 && !p; attempt++) {
          const off = baseOff * (1 + Math.floor(attempt / 12));
          const c = this.sampleRingPoint(v, off, ww, wh);
          if (this.canSpawnAt(c.x, c.y, type)) p = c;
        }
        if (!p) p = this.findClearSpawnNearPlayer(type);
        if (!p) continue;

        this.enemies.push(this.initEnemy({ x: p.x, y: p.y, type, triggerId: t.id }));
      }
    }

    // 屏幕内随机生成：在触发器/生成区域矩形范围内随机取点，
    // 距玩家不小于 playerMinRadius，且与玩家连线无障碍。
    // 每个位置先显示四角白色锁定框（渐显+缩小 0.5s），动画结束后敌人生成。
    spawnInScreen(t, wave) {
      const minRadius = Math.max(0, Number(wave.playerMinRadius ?? 200) || 0);
      const count = Math.max(1, Number(wave.count) || 1);
      const type = wave.enemyType || 'basic1';

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
          if (this.canSpawnAt(c.x, c.y, type, minRadius)) p = c;
        }
        // 第二轮：区域整体落在安全半径内时，退化为仅连线无障碍 + 避玩家脚下
        for (let attempt = 0; attempt < 60 && !p; attempt++) {
          const c = rand();
          if (this.canSpawnAt(c.x, c.y, type, 20)) p = c;
        }
        if (!p) continue;

        const size = (ENEMY_BEHAVIOR[type] || ENEMY_BEHAVIOR.basic1).size;
        this.lockEffects.push({
          x: p.x,
          y: p.y,
          size: size + 20,
          duration: 500,
          t: 0,
          enemyType: type,
          triggerId: t.id
        });
      }
    }

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
    }

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
    }

    // 生成点是否安全：世界边界内、不在墙内、与玩家连线无障碍（可被击杀）、可选最小玩家距离
    canSpawnAt(x, y, enemyType = 'basic1', minPlayerDist = 0) {
      const b = ENEMY_BEHAVIOR[enemyType] || ENEMY_BEHAVIOR.basic1;
      const r = b.size / 2;
      const { w: ww, h: wh } = this.worldSize();
      if (x < r || y < r || x > ww - r || y > wh - r) return false;
      if (this.pointInWall(x, y)) return false;
      if (minPlayerDist > 0 && Math.hypot(x - this.player.x, y - this.player.y) < minPlayerDist) return false;
      return this.hasLOS(x, y, this.player.x, this.player.y);
    }

    // 玩家附近螺旋找一个连线无障碍的生成点（多边形全顶点被挡时的兜底）
    findClearSpawnNearPlayer(enemyType = 'basic1') {
      const b = ENEMY_BEHAVIOR[enemyType] || ENEMY_BEHAVIOR.basic1;
      const r = b.size / 2;
      for (let ring = 1; ring <= 8; ring++) {
        const samples = ring * 8;
        for (let a = 0; a < samples; a++) {
          const ang = (a / samples) * Math.PI * 2;
          const dist = ring * (r + 40);
          const x = this.player.x + Math.cos(ang) * dist;
          const y = this.player.y + Math.sin(ang) * dist;
          if (this.canSpawnAt(x, y, enemyType)) return { x, y };
        }
      }
      return null;
    }

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
    }

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
    }

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
    }

    spawnEnemyAt(x, y, fx) {
      const enemy = this.initEnemy({ x, y, type: fx.enemyType, triggerId: fx.triggerId || null });
      enemy.frozen = true;
      fx.spawnedEnemies.push(enemy);
      this.enemies.push(enemy);
    }

    spawnAtVertex(fx, i, total) {
      const step = Math.PI * 2 / total;
      const baseAngle = fx.startAngle + (i / total) * Math.PI * 2;
      // 理想顶点 → 其余顶点轮转（允许一个顶点承载多个敌人）→ 半径/角度抖动
      for (let k = 0; k < total; k++) {
        const a = baseAngle + k * step;
        for (const s of [1, 0.85, 1.15]) {
          const x = fx.cx + Math.cos(a) * fx.radius * s;
          const y = fx.cy + Math.sin(a) * fx.radius * s;
          if (this.canSpawnAt(x, y, fx.enemyType)) {
            this.spawnEnemyAt(x, y, fx);
            return;
          }
        }
      }
      // 全部顶点都被障碍阻挡：玩家附近找连线无障碍点兜底
      const fb = this.findClearSpawnNearPlayer(fx.enemyType);
      if (fb) this.spawnEnemyAt(fb.x, fb.y, fx);
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

    updateLockEffects(dt) {
      this.lockEffects = this.lockEffects.filter(fx => {
        fx.t += dt;
        if (fx.t >= fx.duration) {
          // 生成前再校验一次连线无障碍；失效则玩家附近兜底，仍无解跳过
          let p = this.canSpawnAt(fx.x, fx.y, fx.enemyType) ? fx : this.findClearSpawnNearPlayer(fx.enemyType);
          if (p) {
            const enemy = this.initEnemy({ x: p.x, y: p.y, type: fx.enemyType, triggerId: fx.triggerId || null });
            this.enemies.push(enemy);
          }
          return false;
        }
        return true;
      });
    }

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
      const st = this.triggerState.get(t.id) || { inside: false, lastFire: -1e9, waveIndex: 0 };
      for (const ev of (t.events || [])) {
        if (ev.when === 'enemiesCleared') {
          // 异步事件：等待本触发器召唤的敌人被全部击败后触发
          const pending = st.pendingClearEvents || (st.pendingClearEvents = []);
          if (!pending.includes(ev)) pending.push(ev);
        } else {
          this.dispatchTriggerEvent(t, ev);
        }
      }
      this.triggerState.set(t.id, st);
    }

    dispatchTriggerEvent(t, ev) {
      if (ev.type === 'spawnEnemy') {
        this.triggerSpawnEnemy(t, ev);
      } else if (ev.type === 'switchLevel') {
        this.beginSwitch(ev);
      } else if (ev.type === 'spawnGate') {
        this.setGatesActive(ev, true, t);
      } else if (ev.type === 'removeGate') {
        this.setGatesActive(ev, false, t);
      } else if (ev.type === 'combat') {
        this.setHudMode('combat');
      } else if (ev.type === 'roomComplete') {
        this.setHudMode('secure', { autoReturn: { mode: 'explore', delay: 1500 } });
      } else if (ev.type === 'complete') {
        this.state = 'end';
        this.settleVictory();
      }
    }

    // 本触发器是否还有未生成完的敌人波次
    triggerHasPendingWaves(t) {
      const spawnEv = (t.events || []).find(e => e.type === 'spawnEnemy');
      if (!spawnEv) return false;
      const waves = spawnEv.spawn?.waves || [];
      if (!waves.length) return false;
      const st = this.triggerState.get(t.id);
      return (st?.waveIndex || 0) < waves.length;
    }

    // 检查异步事件：触发器已被进入且其召唤的敌人全部被击败时触发
    checkAsyncTriggerEvents() {
      const l = ctx.state.level;
      for (const t of l.triggers) {
        const st = this.triggerState.get(t.id);
        const pending = st?.pendingClearEvents;
        if (!pending || !pending.length) continue;
        // 仍有未生成的波次，等待生成完毕
        if (this.triggerHasPendingWaves(t)) continue;
        // 仍有本触发器召唤的存活敌人，等待击杀
        if (this.enemies.some(e => e.alive && e.triggerId === t.id)) continue;
        // 仍有本触发器的生成锁定动画（屏幕内随机敌人尚未落地），等待生成完成
        if (this.lockEffects.some(fx => fx.triggerId === t.id)) continue;
        const events = pending.splice(0, pending.length);
        for (const ev of events) this.dispatchTriggerEvent(t, ev);
        this.spawnChestsForTrigger(t.id);
        this.spawnPortalsForTrigger(t.id);
      }
    }

    hudColor(mode) {
      return HUD_STATES[mode]?.color || '#ffffff';
    }

    setHudMode(mode, opts = {}) {
      const from = this.hudMode;
      this.hudMode = mode;
      this.hudAnim = {
        fromColor: this.hudColor(from),
        toColor: this.hudColor(mode),
        fromText: HUD_STATES[from]?.label || '',
        toText: HUD_STATES[mode]?.label || '',
        t: 0,
        dur: HUD_TRANSITION_MS,
        phase: 'switch'
      };
      if (opts.autoReturn) {
        this.time.delayedCall(opts.autoReturn.delay, () => this.setHudMode(opts.autoReturn.mode || 'explore'));
      }
    }

    updateHud(dt) {
      if (this.hudAnim) {
        this.hudAnim.t += dt;
        if (this.hudAnim.t >= this.hudAnim.dur) {
          const phase = this.hudAnim.phase;
          this.hudAnim = null;
          // 脉冲第一段（当前色 → 黑）结束后接第二段（黑 → 当前色）
          if (phase === 'idleBlack') {
            this.hudAnim = {
              fromColor: '#000000',
              toColor: this.hudColor(this.hudMode),
              fromText: HUD_STATES[this.hudMode]?.label || '',
              toText: HUD_STATES[this.hudMode]?.label || '',
              t: 0,
              dur: HUD_TRANSITION_MS,
              phase: 'idleBack'
            };
          }
        }
      }

      if (this.state === 'playing' && !this.hudAnim) {
        this.hudIdleClock -= dt;
        if (this.hudIdleClock <= 0) {
          this.hudIdleClock = HUD_IDLE_MS;
          this.hudAnim = {
            fromColor: this.hudColor(this.hudMode),
            toColor: '#000000',
            fromText: HUD_STATES[this.hudMode]?.label || '',
            toText: HUD_STATES[this.hudMode]?.label || '',
            t: 0,
            dur: HUD_TRANSITION_MS,
            phase: 'idleBlack'
          };
        }
      } else if (this.state === 'playing') {
        this.hudIdleClock = HUD_IDLE_MS;
      }
    }

    drawHudIndicator() {
      const g = this.uiG;
      const st = HUD_STATES[this.hudMode] || HUD_STATES.explore;
      let label = st.label;
      let textColor = st.text || '#000000';

      if (this.hudAnim) {
        const p = Math.min(1, this.hudAnim.t / this.hudAnim.dur);
        const w = HUD_RECT_W * p;   // 左到右：左半目标色，右半来源色
        g.fillStyle(color(this.hudAnim.toColor), 1);
        g.fillRect(HUD_RECT_X, HUD_RECT_Y, w, HUD_RECT_H);
        g.fillStyle(color(this.hudAnim.fromColor), 1);
        g.fillRect(HUD_RECT_X + w, HUD_RECT_Y, HUD_RECT_W - w, HUD_RECT_H);
        label = this.hudAnim.toText;
        if (this.hudAnim.toColor === '#000000') textColor = '#ffffff';
      } else {
        g.fillStyle(color(st.color), 1);
        g.fillRect(HUD_RECT_X, HUD_RECT_Y, HUD_RECT_W, HUD_RECT_H);
      }

      if (this.hudIndicatorText) {
        this.hudIndicatorText.setPosition(HUD_RECT_X + HUD_RECT_W / 2, HUD_RECT_Y + HUD_RECT_H / 2);
        this.hudIndicatorText.setText(label || st.label);
        this.hudIndicatorText.setColor(textColor);
        this.hudIndicatorText.setVisible(true);
      }
    }

    setGatesActive(ev, activate, trigger) {
      if (!this.gates?.length) return;
      let targets = (Array.isArray(ev.gateIds) ? ev.gateIds : ev.gateId ? [ev.gateId] : [])
        .map(id => this.gates.find(gt => gt.id === id)).filter(Boolean);
      if (!targets.length) {
        const ref = trigger || ev;
        const nearest = this.gates.reduce((best, gt) =>
          !best || Math.hypot(gt.x - ref.x, gt.y - ref.y) < Math.hypot(best.x - ref.x, best.y - ref.y) ? gt : best, null);
        targets = nearest ? [nearest] : [];
      }
      for (const gate of targets) {
        if (activate) {
          if (gate.closing) gate.closing = false;
          if (!gate.active) { gate.active = true; gate.spawnT = 0; }
        } else if (gate.active && !gate.closing) {
          gate.closing = true;
        }
      }
    }

    activeGateWalls() {
      if (this.editing) return [];
      return (this.gates || [])
        .filter(gt => gt.active && gt.visible !== false)
        .map(gt => ({ x: gt.x, y: gt.y, w: gt.w, h: gt.h * 1.42, shape: 'rect', rotation: gt.rotation || 0 }));
    }

    triggerSpawnEnemy(t, ev) {
      const spawn = ev.spawn || {};
      const waves = Array.isArray(spawn.waves) && spawn.waves.length ? spawn.waves : [];
      if (!waves.length) return;

      const rt = this.triggerState.get(t.id) || { inside: false, lastFire: -1e9, waveIndex: 0, timer: null };
      const startIndex = spawn.resumeOnReturn !== false ? rt.waveIndex : 0;
      if (startIndex >= waves.length) return;

      if (rt.timer) { rt.timer.remove(false); rt.timer = null; }
      rt.waveIndex = startIndex;
      this.triggerState.set(t.id, rt);

      // runTriggerWave/spawnInScreen/createSpawnEffect 仍从 t.spawn 读取波次配置
      t.spawn = spawn;
      this.runTriggerWave(t, startIndex, waves[startIndex].preDelay || 0);
    }

    runTriggerWave(t, index, delay) {
      const waves = t.spawn.waves;
      if (index >= waves.length) return;
      const wave = waves[index];
      const st = this.triggerState.get(t.id);
      if (!st) return;

      const fire = () => {
        st.timer = null;
        if (wave.mode === 'offscreen') {
          this.spawnOffscreen(t, wave.count, wave.enemyType);
        } else if (wave.mode === 'inscreen') {
          this.spawnInScreen(t, wave);
        } else {
          this.createSpawnEffect(t, wave);
        }
        st.waveIndex = index + 1;
        this.triggerState.set(t.id, st);
        if (index + 1 < waves.length) {
          const next = waves[index + 1];
          const nextDelay = (wave.postDelay || 0) + (next.preDelay || 0);
          this.runTriggerWave(t, index + 1, nextDelay);
        }
      };

      // 勾选「等待清理」时：场上仍有存活敌人则延后到这波生成
      const enemiesCleared = () => !this.enemies.some(e => e.alive);
      const run = () => {
        if (wave.waitForClear && !enemiesCleared()) {
          st.timer = this.time.delayedCall(120, run);
          st.timer.triggerId = t.id;
          this.waveEvents.push(st.timer);
          return;
        }
        fire();
      };

      const ev = this.time.delayedCall(delay, run);
      ev.triggerId = t.id;
      st.timer = ev;
      this.waveEvents.push(ev);
      this.triggerState.set(t.id, st);
    }

    stopTriggerSpawn(t) {
      const st = this.triggerState.get(t.id);
      if (st?.timer) { st.timer.remove(false); st.timer = null; }
      this.waveEvents = this.waveEvents.filter(ev => ev.triggerId !== t.id);
      this.spawnEffects = this.spawnEffects.filter(fx => {
        if (fx.triggerId !== t.id) return true;
        for (const e of fx.spawnedEnemies) e.frozen = false;
        return false;
      });
      this.lockEffects = this.lockEffects.filter(fx => fx.triggerId !== t.id);
    }

    // 是否存在尚未生成完毕的敌人波次（含等待清理的波）
    hasPendingSpawnWaves() {
      const l = ctx.state.level;
      for (const t of l.triggers) {
        const spawnEv = (t.events || []).find(e => e.type === 'spawnEnemy');
        if (!spawnEv) continue;
        const waves = spawnEv.spawn?.waves || [];
        if (!waves.length) continue;
        const st = this.triggerState.get(t.id);
        const waveIndex = st?.waveIndex || 0;
        if (waveIndex < waves.length) return true;
      }
      return false;
    }

    updateTriggers() {
      const l = ctx.state.level;
      for (const t of l.triggers) {
        const inside = hitTrigger(t, this.player.x, this.player.y);
        const st = this.triggerState.get(t.id) || { inside: false, lastFire: -1e9, waveIndex: 0 };
        const spawnEv = (t.events || []).find(e => e.type === 'spawnEnemy');

        if (!inside && st.inside && spawnEv && spawnEv.spawn?.stopOnExit) {
          this.stopTriggerSpawn(t);
        }

        if ((t.events || []).some(e => e.type === 'switchLevel') || t.once !== false) {
          if (this.triggered.has(t.id)) {
            st.inside = inside;
            this.triggerState.set(t.id, st);
            continue;
          }
          if (inside) {
            this.triggered.add(t.id);
            this.fireTrigger(t);
          }
          st.inside = inside;
          this.triggerState.set(t.id, st);
          continue;
        }

        if (inside && !st.inside && this.time.now - st.lastFire >= (t.cooldown || 0)) {
          st.lastFire = this.time.now;
          this.fireTrigger(t);
        }
        if (!inside && st.inside && spawnEv && spawnEv.spawn?.resumeOnReturn === false) {
          st.waveIndex = 0;
        }
        st.inside = inside;
        this.triggerState.set(t.id, st);
      }
    }

    beginSwitch(ev) {
      this.transition = {
        phase: 'out',
        alpha: 0,
        target: ev.target,
        spawnPoint: ev.spawnPoint,
        switching: false
      };
      this.state = 'transition';
    }

    beginExternalFade(done) {
      this.transition = { phase: 'out', alpha: 0, switching: true, external: true };
      this.state = 'transition';
      this.transitionDone = done;
    }

    updateTransition(dt) {
      const tr = this.transition;
      if (!tr) return;
      if (tr.phase === 'out') {
        tr.alpha = Math.min(1, tr.alpha + dt / SWITCH_FADE_MS);
        if (tr.alpha >= 1 && tr.switching) {
          if (tr.external) {
            const done = this.transitionDone;
            this.transition = null;
            done?.();
          } else {
            tr.switching = true;
            ctx.onSwitchLevel?.(tr.target, tr.spawnPoint, () => {
              this.restart();
              tr.phase = 'in';
              tr.alpha = 1;
              this.transition = tr;
              this.state = 'transition';
            });
          }
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
        if (this.menuScreen) {
          if (this.menuScreen === 'workshop' && this.handleWorkshopPointerDown()) return;
          this.onUIPointer(p);
          return;
        }
        if (this.isMenuLevel()) {
          const up = this.uiPointer();
          for (const id in this.loginButtonRects) {
            const r = this.loginButtonRects[id];
            if (up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h) {
              this.pressAnim(id);
              this.onLoginButtonClick(id);
              return;
            }
          }
          return;
        }
        if (this.state === 'playing' && this.settingsButtonRect) {
          const up = this.uiPointer();
          const r = this.settingsButtonRect;
          if (up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h) {
            this.pressAnim('settingsBtn');
            this.openSettingsOverlay();
            return;
          }
        }
        if (this.state === 'paused') { this.onUIPointer(p); return; }
        if (this.state === 'end' || this.state === 'fail') this.restart();
        return;
      }

      if (p.middleButtonDown() || p.rightButtonDown()) {
        this.panning = true;
        this.panStart = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
        return;
      }

      // 记录一次撤销快照（放置/拖拽/旋转/缩放/删除等编辑操作前）
      ctx.pushUndo?.();

      const l = ctx.state.level;
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      const x = snap(wp.x);
      const y = snap(wp.y);
      const tool = ctx.state.tool;
      const selected = ctx.state.selected;
      const selectedWall = selected && l.walls.includes(selected);
      const selectedTrigger = selected && l.triggers.includes(selected);
      const selectedImage = selected && l.images.includes(selected);
      const selectedGate = selected && l.gates.includes(selected);
      const selectedZone = selected && (l.spawnZones || []).includes(selected);
      const selectedVendor = selected && (l.vendors || []).includes(selected);
      const selectedIdol = selected && (l.idols || []).includes(selected);
      const selectedIcon = selected && (l.icons || []).includes(selected);
      const selectedPortal = selected && (l.portals || []).includes(selected);

      if (tool === 'select' && selected && (selectedWall || selectedTrigger || selectedImage || selectedGate || selectedZone || selectedVendor || selectedIdol || selectedIcon || selectedPortal)) {
        if ((selectedWall || selectedGate || selectedPortal) && rotationHandleAt(selected, wp.x, wp.y)) {
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
          } else if (hit.type === 'chest') {
            l.chests = l.chests.filter(c => c !== hit.entity);
          } else if (hit.type === 'image') {
            l.images = l.images.filter(im => im !== hit.entity);
          } else if (hit.type === 'gate') {
            l.gates = l.gates.filter(gt => gt !== hit.entity);
          } else if (hit.type === 'vendor') {
            l.vendors = l.vendors.filter(v => v !== hit.entity);
          } else if (hit.type === 'idol') {
            l.idols = l.idols.filter(v => v !== hit.entity);
          } else if (hit.type === 'icon') {
            l.icons = (l.icons || []).filter(v => v !== hit.entity);
          } else if (hit.type === 'portal') {
            l.portals = (l.portals || []).filter(v => v !== hit.entity);
          } else if (hit.type === 'spawnZone') {
            l.spawnZones = (l.spawnZones || []).filter(z => z !== hit.entity);
          } else if (hit.type === 'background') {
            l.background = null;
          }
        }
        if (selected && !l.walls.includes(selected) && !l.triggers.includes(selected)
          && !l.enemies.includes(selected) && !l.crates.includes(selected)
          && !l.barrels.includes(selected) && !l.chests.includes(selected)
          && !l.images.includes(selected)
          && !l.gates.includes(selected)
          && !l.vendors.includes(selected)
          && !l.idols.includes(selected)
          && !(l.icons || []).includes(selected)
          && !(l.portals || []).includes(selected)
          && !(l.spawnZones || []).includes(selected)
          && selected !== l.background) {
          ctx.state.selected = null;
        }
      } else if (tool === 'wall') {
        l.walls.push({ id: `wall-${Date.now()}`, x, y, w: CELL * 4, h: CELL * 3, shape: 'rect', thickness: CELL, visible: true, color: DEFAULT_WALL_COLOR });
      } else if (tool === 'enemy') {
        l.enemies.push(normalizeEnemy({ x, y, id: `enemy-${Date.now()}` }, l.enemies.length));
      } else if (tool === 'spawn') {
        l.spawn = { ...l.spawn, x, y };
        ctx.state.selected = l.spawn;
      } else if (tool === 'trigger') {
        l.triggers.push({ id: `trigger-${Date.now()}`, x, y, w: CELL * 3, h: CELL * 2, shape: 'rect', color: '#f3b63f', visible: true, once: true, resumeOnReturn: true, events: [{ type: 'complete' }] });
      } else if (tool === 'gate') {
        const gate = { id: `gate-${Date.now()}`, x, y, w: CELL * 8, h: 45, label: 'Barrier Active', active: false, visible: true };
        l.gates.push(gate);
        ctx.state.selected = gate;
      } else if (tool === 'vendor') {
        const vendor = { id: `vendor-${Date.now()}`, x, y, w: 130, h: 96, interactRadius: 120, visible: true };
        (l.vendors || (l.vendors = [])).push(vendor);
        ctx.state.selected = vendor;
      } else if (tool === 'idol') {
        const idol = { id: `idol-${Date.now()}`, x, y, w: 110, h: 110, interactRadius: 130, visible: true };
        (l.idols || (l.idols = [])).push(idol);
        ctx.state.selected = idol;
      } else if (tool === 'icon') {
        const icon = { id: `icon-${Date.now()}`, x, y, w: 64, h: 64, src: '', interactRadius: 120, tipText: '按 F 交互', event: 'workshop', visible: true };
        (l.icons || (l.icons = [])).push(icon);
        ctx.state.selected = icon;
      } else if (tool === 'portal') {
        const portal = normalizePortal({ x, y }, (l.portals || []).length);
        (l.portals || (l.portals = [])).push(portal);
        ctx.state.selected = portal;
      } else if (tool === 'spawnzone') {
        const zone = { id: `spawnzone-${Date.now()}`, x, y, w: CELL * 10, h: CELL * 6, color: '#7ee787', visible: true };
        (l.spawnZones || (l.spawnZones = [])).push(zone);
        ctx.state.selected = zone;
      } else if (tool === 'crate') {
        l.crates.push(normalizeCrate({ x, y, id: `crate-${Date.now()}` }, l.crates.length));
      } else if (tool === 'barrel') {
        l.barrels.push(normalizeBarrel({ x, y, id: `barrel-${Date.now()}` }, l.barrels.length));
      } else if (tool === 'chest') {
        const chest = normalizeChest({ x, y, id: `chest-${Date.now()}` }, l.chests.length);
        l.chests.push(chest);
        ctx.state.selected = chest;
      } else {
        const hit = pickTopEntity(l, wp.x, wp.y);
        const entity = hit ? hit.entity : null;
        if (entity && entity === l.background) {
          this.drag = { mode: 'bg-move', entity };
        } else {
          this.drag = entity && entity !== l.spawn ? { mode: 'move', entity } : entity === l.spawn ? { mode: 'spawn' } : null;
        }
        ctx.state.selected = entity;
      }

      ctx.redraw();
    }

    pointerMove(p) {
      if (!this.editing) {
        if (this.menuScreen === 'workshop') {
          this.updateWorkshopLongPress();
          this.updateWorkshopScrollDrag();
        }
        return;
      }

      if (this.panning) {
        const cam = this.cameras.main;
        cam.scrollX = this.panStart.sx - (p.x - this.panStart.x) / cam.zoomX;
        cam.scrollY = this.panStart.sy - (p.y - this.panStart.y) / cam.zoomY;
        this.clampEditorView();
        this.draw();
        return;
      }

      if (!this.drag) return;
      if (this.drag.mode !== 'spawn' && !this.drag.entity) return;

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
    updateEditorKeys() {
      const sel = ctx.state.selected;
      if (!sel || typeof sel.x !== 'number' || typeof sel.y !== 'number') return;

      // 玩家正在侧边栏输入框打字时，不响应方向键，避免误移动实体
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;

      let dx = 0, dy = 0;
      if (Phaser.Input.Keyboard.JustDown(this.keys.LEFT)) dx = -CELL;
      else if (Phaser.Input.Keyboard.JustDown(this.keys.RIGHT)) dx = CELL;
      else if (Phaser.Input.Keyboard.JustDown(this.keys.UP)) dy = -CELL;
      else if (Phaser.Input.Keyboard.JustDown(this.keys.DOWN)) dy = CELL;
      else return;

      ctx.pushUndo?.();
      sel.x = snap(sel.x + dx);
      sel.y = snap(sel.y + dy);
      ctx.redraw?.();
    }
    update(_, dt) {
      if (this.editing) {
        this.updateEditorKeys();
        return this.draw();
      }

      if (this.menuScreen === 'workshop') {
        this.updateWorkshopLongPress();
        this.updateWorkshopScrollDrag();
      }

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

      this.updateLoginHover();

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
      // 转速改件：射击时小球不减速转动
      const hasSpin = mods.has('spin');
      const angularSpeed = Phaser.Math.DegToRad(fireDown ? (hasSpin ? 180 : 20) : 180);
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
          const attackSpeed = this.player.combat?.attackSpeed ?? 1;
          let interval = this.player.weapon.fireInterval || 120;
          // 转速改件：射速 +50%（间隔缩为 2/3）
          if (hasSpin) interval = interval * 2 / 3;
          this.fireClock = interval / attackSpeed;
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
            return b.x > 0 && b.x < ww && b.y > 0 && b.y < wh;
          }
        }

        let hit = l.walls.some(w => hitWall(w, b.x, b.y, 3))
          || this.activeGateWalls().some(w => hitWall(w, b.x, b.y, 3));

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
            e.hp -= playerDamage(this, b.weaponType);
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

        if (l.walls.some(w => hitWall(w, b.x, b.y, 3))
          || this.activeGateWalls().some(w => hitWall(w, b.x, b.y, 3))) {
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
      this.checkAsyncTriggerEvents();

      this.updateNewbee(dt);

      this.updateHubInteract(dt);
      this.updateVendorInteract(dt);
      this.updateIdolInteract(dt);
      this.updateIconInteract(dt);
      this.updatePortalInteract(dt);

      this.updatePlayCamera(dt);
      this.syncUIState();
      this.draw();
    }

    // 设置教程提示（带出现前延迟）
    setNewbeeHint(text, icon, fadeAt = null) {
      if (!this.newbee) return;
      this.newbee.hint = { text, icon, fadeAt, pre: text ? NEWBEE_HINT_PRE_MS : null, showT: 0 };
    }

    // 骑士之家：F 键互动
    updateHubInteract(dt) {
      if (!this.isHubLevel() || this.state !== 'playing') return;
      const p = this.player;
      if (!p) return;

      let nearest = null;
      let nearestDist = Infinity;
      for (const it of HUB_INTERACTABLES) {
        const d = Math.hypot(p.x - it.x, p.y - it.y);
        if (d < HUB_INTERACT_RADIUS && d < nearestDist) { nearestDist = d; nearest = it; }
      }
      this.hubNearest = nearest;

      // 提示渐显
      if (this.hubTipT == null) this.hubTipT = 0;
      this.hubTipT = nearest ? Math.min(1, this.hubTipT + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.openMenuScreen(nearest.id);
      }
    }

    // 新手教程阶段机
    updateNewbee(dt) {
      const nb = this.newbee;
      if (!nb) return;

      // 提示出现前延迟倒计时
      if (nb.hint && nb.hint.pre != null) {
        nb.hint.pre -= dt;
        if (nb.hint.pre <= 0) nb.hint.pre = 0;
      }
      // 淡入计时：出现后 1s 内渐显
      if (nb.hint.showT != null && nb.hint.pre === 0) {
        nb.hint.showT = Math.min(NEWBEE_HINT_FADE_MS, nb.hint.showT + dt);
      }
      // 提示淡出计时：到期后清除
      if (nb.hint.fadeAt != null) {
        nb.hint.fadeAt -= dt;
        if (nb.hint.fadeAt <= 0) { this.setNewbeeHint('', null); }
      }

      this.newbeeDelay = this.newbeeDelay || {};
      const d = this.newbeeDelay;
      for (const k of Object.keys(d)) if (typeof d[k] === 'number') d[k] = Math.max(0, d[k] - dt);

      this.advanceNewbee();
    }

    // 统一阶段推进（可读性优先）
    advanceNewbee() {
      const nb = this.newbee;
      if (!nb) return;
      const d = this.newbeeDelay;

      if (nb.phase === 1) {
        // 首次开火：让射击提示 1.5s 后淡出
        if (nb.fired && d.p1fade === undefined) {
          d.p1fade = NEWBEE_HINT_FADE_MS;
          this.setNewbeeHint('按「鼠标左键」射击', 'mouse', NEWBEE_HINT_FADE_MS);
        }
        // 射击提示淡出结束，等待（0.5s + 后延迟）展示校准提示
        if (nb.fired && d.p1fade != null && d.p1fade <= 0 && !nb.subHintShown && d.p1gap === undefined) {
          d.p1gap = 500 + NEWBEE_HINT_POST_MS;
        }
        if (d.p1gap != null && d.p1gap <= 0 && !nb.subHintShown) {
          nb.subHintShown = true;
          d.p1after = 1500 + NEWBEE_HINT_POST_MS;
          this.setNewbeeHint('你的准心在一直移动，使用「射击」来校准', 'mouse');
        }
        // 校准提示播放 1.5s（+后延迟）后进入阶段2
        if (nb.subHintShown && d.p1after != null && d.p1after <= 0) {
          nb.phase = 2;
          nb.allowMove = true;
          this.setNewbeeHint('按 WASD 移动', 'wasd');
        }
        return;
      }

      if (nb.phase === 2) {
        if (nb.moved && d.p2fade === undefined) {
          d.p2fade = NEWBEE_HINT_FADE_MS;
          this.setNewbeeHint('按 WASD 移动', 'wasd', NEWBEE_HINT_FADE_MS);
        }
        if (nb.moved && d.p2fade <= 0 && d.p2wait === undefined) {
          d.p2wait = 5000 + NEWBEE_HINT_POST_MS;
        }
        if (d.p2wait != null && d.p2wait <= 0) {
          // 进入阶段3：生成 3 个屏幕外简单敌人
          nb.phase = 3;
          nb.phase3Fire = false;
          this.spawnNewbeeEnemies(3, 'basic1');
          nb.enemies = this.enemies.slice(); // 引用共享，仅用于标记（其实可直接用 this.enemies）
          this.setNewbeeHint('敌人出现了！击败他们', null);
        }
        return;
      }

      if (nb.phase === 3) {
        // 确保「敌人出现了」提示始终显示（除非玩家已开火触发淡出）
        if (!nb.phase3Fire && (!nb.hint.text || nb.hint.text !== '敌人出现了！击败他们')) {
          this.setNewbeeHint('敌人出现了！击败他们', null);
        }
        if (nb.phase3Fire && d.p3fade === undefined) {
          d.p3fade = 1000;
          this.setNewbeeHint('敌人出现了！击败他们', null, 1000);
        }
        // 击杀全部阶段3敌人 → 等待 4s（+后延迟）进入阶段4
        const p3enemiesAlive = this.enemies.some(e => e.alive && e.type === 'basic1');
        if (nb.phase3Fire && !p3enemiesAlive && d.p3after === undefined) {
          d.p3after = 4000 + NEWBEE_HINT_POST_MS;
        }
        if (d.p3after != null && d.p3after <= 0) {
          nb.phase = 4;
          nb.allowFire = false;
          nb.allowShield = true;
          // 右上角生成进阶敌人2
          const adv = this.spawnAdvanced2AtTopRight();
          nb.advanced = adv;
          this.setNewbeeHint('按「空格」进行防御', 'space');
        }
        return;
      }

      if (nb.phase === 4) {
        // 保持防御提示，直到用护盾成功抵挡一次子弹
        if (!nb.hint.text || nb.hint.text !== '按「空格」进行防御') {
          this.setNewbeeHint('按「空格」进行防御', 'space');
        }
        if (nb.shieldBlocked) {
          nb.phase = 5;
          nb.allowFire = true;
          this.setNewbeeHint('干得好！解决掉面前的敌人', null);
        }
        return;
      }

      if (nb.phase === 5) {
        // 击杀进阶敌人2后，停顿 3 秒进入阶段6
        const advAlive = this.enemies.some(e => e.alive && e.type === 'advanced2');
        if (!advAlive && d.p5pause === undefined) {
          d.p5pause = 3000;
        }
        if (d.p5pause != null && d.p5pause <= 0) {
          nb.phase = 6;
          nb.phase6Shown = true;
          this.setNewbeeHint('新手教程结束，现在你可以继续练习或离开教学了', null);
        }
        return;
      }

      if (nb.phase === 6) {
        // 两个矩形触发器（后续用特效代替）
        const p = this.player;
        // 离开教学：回到主界面（登录关卡）
        if (Math.abs(p.x - nb.exitRect.x) < nb.exitRect.w / 2 && Math.abs(p.y - nb.exitRect.y) < nb.exitRect.h / 2) {
          if (!nb.leaving) {
            nb.leaving = true;
            this.beginSwitch({ target: 'login', spawnPoint: null });
          }
          return;
        }
        // 练习：场上无敌人时进入，重复三角形成3个普通敌人
        if (Math.abs(p.x - nb.practiceRect.x) < nb.practiceRect.w / 2 && Math.abs(p.y - nb.practiceRect.y) < nb.practiceRect.h / 2) {
          if (!this.enemies.some(e => e.alive) && d.practiceCooldown === undefined) {
            d.practiceCooldown = 1200;
            this.spawnNewbeeEnemies(3, 'basic1');
          }
        }
        if (d.practiceCooldown != null && d.practiceCooldown <= 0) {
          delete this.newbeeDelay.practiceCooldown;
        }
        return;
      }
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

    syncLevelImages() {
      const images = ctx.state.level.images || [];
      for (const img of images) {
        const key = `__lvl_img_${img.id}__`;
        let sprite = this.levelImageSprites.get(img.id);

        if (sprite && sprite.getData('src') !== img.src) {
          sprite.destroy();
          this.levelImageSprites.delete(img.id);
          if (this.textures.exists(key)) this.textures.remove(key);
          sprite = null;
        }

        if (!sprite) {
          if (this.textures.exists(key)) {
            sprite = this.add.image(img.x, img.y, key).setOrigin(0.5).setDepth(2);
            sprite.setData('src', img.src);
            if (this.uiCam) this.uiCam.ignore(sprite);
            this.levelImageSprites.set(img.id, sprite);
          } else if (!this.levelImageLoading.has(key)) {
            this.levelImageLoading.add(key);
            this.load.once(`filecomplete-image-${key}`, () => {
              this.levelImageLoading.delete(key);
              this.syncLevelImages();
            });
            this.load.image(key, img.src);
            this.load.start();
          }
          continue;
        }

        sprite.setPosition(img.x, img.y);
        sprite.setVisible(this.editing || img.visible !== false);
        const tw = sprite.frame?.width || img.w;
        const th = sprite.frame?.height || img.h;
        sprite.setScale(img.w / tw, img.h / th);
      }

      const seen = new Set(images.map(i => i.id));
      for (const [id, sprite] of this.levelImageSprites) {
        if (!seen.has(id)) {
          sprite.destroy();
          this.levelImageSprites.delete(id);
        }
      }
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

    // 金色十字星特效（多层星芒 + 旋转光环，快速利落）
    drawChestStar(g, x, y, progress, size) {
      if (progress <= 0 || progress >= 1) return;
      const p = progress;                       // 0..1
      const ease = Math.sin(p * Math.PI);       // 淡入淡出包络
      const r = size * (0.6 + p * 1.6);
      const alpha = ease;

      // 主轴十字（横竖长光束，末端尖端）
      g.lineStyle(3, 0xffd54f, alpha);
      g.lineBetween(x - r, y, x + r, y);
      g.lineBetween(x, y - r, x, y + r);

      // 对角长星芒（45° 四条）
      const d = r * 0.8;
      g.lineStyle(2, 0xffd54f, alpha * 0.9);
      g.lineBetween(x - d, y - d, x + d, y + d);
      g.lineBetween(x - d, y + d, x + d, y - d);

      // 次级短星芒（22.5° 八条，更密集）
      const s = r * 0.5;
      const ang2 = Math.PI / 8;
      g.lineStyle(1.5, 0xffe082, alpha * 0.8);
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 + ang2;
        g.lineBetween(
          x + Math.cos(a) * s, y + Math.sin(a) * s,
          x - Math.cos(a) * s, y - Math.sin(a) * s
        );
      }

      // 旋转菱形光环（高速旋转，随 p 缩放）
      const rot = p * Math.PI * 2;
      const ring = r * 0.7;
      g.lineStyle(2, 0xffab00, alpha * 0.7);
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = rot + k * Math.PI / 2;
        const px = x + Math.cos(a) * ring;
        const py = y + Math.sin(a) * ring;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.strokePath();

      // 中心爆闪点
      g.fillStyle(0xfff3c4, alpha);
      g.fillCircle(x, y, 2 + p * 4);
    }

    syncVendorSprites() {
      if (!this.textures.exists(VENDOR_TEX_KEY)) return;

      const vendors = this.editing ? (ctx.state.level.vendors || []) : (this.vendors || []);
      const seen = new Set();
      for (const v of vendors) {
        seen.add(v.id);
        let img = this.vendorSprites.get(v.id);
        if (!img) {
          img = this.add.image(v.x, v.y, VENDOR_TEX_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.vendorSprites.set(v.id, img);
        }
        img.setPosition(v.x, v.y);
        const tw = img.frame?.width || 1024;
        const th = img.frame?.height || 755;
        img.setScale(Math.min(v.w / tw, v.h / th));
        img.setVisible(v.visible !== false);
      }

      for (const [id, img] of this.vendorSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.vendorSprites.delete(id);
        }
      }
    }

    syncIdolSprites() {
      if (!this.textures.exists(IDOL_TEX_KEY)) return;

      const idols = this.editing ? (ctx.state.level.idols || []) : (this.idols || []);
      const seen = new Set();
      for (const v of idols) {
        seen.add(v.id);
        let img = this.idolSprites.get(v.id);
        if (!img) {
          img = this.add.image(v.x, v.y, IDOL_TEX_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.idolSprites.set(v.id, img);
        }
        img.setPosition(v.x, v.y);
        const tw = img.frame?.width || 1145;
        const th = img.frame?.height || 1098;
        img.setScale(Math.min(v.w / tw, v.h / th));
        img.setVisible(v.visible !== false);
      }

      for (const [id, img] of this.idolSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.idolSprites.delete(id);
        }
      }
    }

    syncIconSprites() {
      const icons = this.editing ? (ctx.state.level.icons || []) : (this.icons || []);
      for (const ic of icons) {
        if (!ic.src) continue;
        const key = `__icon_${ic.id}__`;
        let sprite = this.iconSprites.get(ic.id);

        if (sprite && sprite.getData('src') !== ic.src) {
          sprite.destroy();
          this.iconSprites.delete(ic.id);
          if (this.textures.exists(key)) this.textures.remove(key);
          sprite = null;
        }

        if (!sprite) {
          if (this.textures.exists(key)) {
            sprite = this.add.image(ic.x, ic.y, key).setOrigin(0.5).setDepth(9);
            sprite.setData('src', ic.src);
            if (this.uiCam) this.uiCam.ignore(sprite);
            this.iconSprites.set(ic.id, sprite);
          } else if (!this.iconLoading.has(key)) {
            this.iconLoading.add(key);
            this.load.once(`filecomplete-image-${key}`, () => {
              this.iconLoading.delete(key);
              this.syncIconSprites();
            });
            this.load.image(key, ic.src);
            this.load.start();
          }
          continue;
        }

        sprite.setPosition(ic.x, ic.y);
        sprite.setVisible(this.editing || ic.visible !== false);
        const tw = sprite.frame?.width || ic.w;
        const th = sprite.frame?.height || ic.h;
        sprite.setScale(Math.min(ic.w / tw, ic.h / th));
      }

      const seen = new Set(icons.filter(i => i.src).map(i => i.id));
      for (const [id, sprite] of this.iconSprites) {
        if (!seen.has(id)) {
          sprite.destroy();
          this.iconSprites.delete(id);
        }
      }
    }

    // 无图标的可交互图标：世界图形占位（编辑与游戏均显示，src 为空时由 sprite 接管）
    drawIcons(g) {
      const icons = this.editing ? (ctx.state.level.icons || []) : (this.icons || []);
      for (const ic of icons) {
        if (!this.editing && ic.visible === false) continue;
        if (ic.src) continue;
        const r = Math.max(10, Math.min(ic.w || 64, ic.h || 64) / 2);
        g.fillStyle(0x1b3a57, 0.92);
        g.fillCircle(ic.x, ic.y, r);
        g.lineStyle(2, 0x6fd3ff, 0.95);
        g.strokeCircle(ic.x, ic.y, r);
        g.fillStyle(0x6fd3ff, 1);
        g.fillCircle(ic.x, ic.y - r * 0.35, Math.max(1.5, r * 0.12));
        g.fillRect(ic.x - 1.5, ic.y - r * 0.05, 3, r * 0.55);
      }
    }

    // 传送门文字标签（EVACUATION）：编辑态显示全部，游戏态仅显示已出现的
    syncPortalSprites() {
      const portals = this.editing
        ? (ctx.state.level.portals || [])
        : (this.portals || []).filter(p => p.spawned && p.visible !== false);

      const seen = new Set();
      for (const p of portals) {
        seen.add(p.id);
        let t = this.portalTexts.get(p.id);
        if (!t) {
          t = this.add.text(p.x, p.y, PORTAL_LABEL, {
            fontFamily: FONT_TECH, fontSize: '12px', color: '#000000', fontStyle: 'bold'
          }).setOrigin(0.5).setDepth(10).setAlpha(PORTAL_ALPHA);
          if (this.uiCam) this.uiCam.ignore(t);
          this.portalTexts.set(p.id, t);
        }
        t.setPosition(p.x, p.y);
        t.setRotation(Phaser.Math.DegToRad(p.rotation || 0));
        t.setFontSize(Math.max(10, Math.round(p.h * 0.26)));
        t.setAlpha(PORTAL_ALPHA);
        t.setVisible(true);
      }

      for (const [id, t] of this.portalTexts) {
        if (!seen.has(id)) {
          t.destroy();
          this.portalTexts.delete(id);
        }
      }
    }

    // 神像：F 键互动（靠近显示提示，交互后弹出 3 张属性卡，选 1 生效且不可再用）
    updateIdolInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.idolNearest = null;
        this.idolTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.idols || [])) {
        if (v.used || v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 130, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.idolNearest = nearest;
      this.idolTipT = nearest ? Math.min(1, (this.idolTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.openIdolOffer(nearest);
      }
    }

    // 可交互图标：F 键互动（靠近显示提示，按 F 打开对应菜单页）
    updateIconInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.iconNearest = null;
        this.iconTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.icons || [])) {
        if (v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 120, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.iconNearest = nearest;
      this.iconTipT = nearest ? Math.min(1, (this.iconTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.triggerIconEvent(nearest);
      }
    }

    triggerIconEvent(icon) {
      if (!icon) return;
      if (icon.event === 'weapon') this.openMenuScreen('weapon');
      else if (icon.event === 'battle') this.openMenuScreen('levelSelect');
      else this.openMenuScreen('workshop');
    }

    // 传送门：F 键互动（靠近显示「撤离」提示，交互后触发整体通关）
    updatePortalInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.portalNearest = null;
        this.portalTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.portals || [])) {
        if (!v.spawned || v.used || v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 90, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.portalNearest = nearest;
      this.portalTipT = nearest ? Math.min(1, (this.portalTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.usePortal(nearest);
      }
    }

    drawPortalUI(g) {
      const alpha = this.portalTipT ?? 0;
      if (alpha <= 0 || !this.portalNearest || this.editing || this.state !== 'playing') {
        this.portalTipText?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.portalNearest;
      const halfDiag = Math.hypot(nv.w, nv.h) / 2;
      const reach = Math.max(nv.interactRadius || 90, halfDiag + p.r + 40);
      g.lineStyle(2, 0xffd54f, 0.7 * alpha);
      g.strokeCircle(nv.x, nv.y, reach);

      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.portalTipText) {
        this.portalTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.portalTipText);
      }
      const tip = this.portalTipText;
      tip.setText('撤离');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    }

    drawIdolUI(g) {
      const alpha = this.idolTipT ?? 0;
      if (alpha <= 0 || !this.idolNearest || this.editing || this.state !== 'playing') {
        this.idolTipText?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.idolNearest;
      const halfDiag = Math.hypot(nv.w, nv.h) / 2;
      const reach = Math.max(nv.interactRadius || 130, halfDiag + p.r + 40);
      g.lineStyle(2, 0xffd54f, 0.7 * alpha);
      g.strokeCircle(nv.x, nv.y, reach);

      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.idolTipText) {
        this.idolTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.idolTipText);
      }
      const tip = this.idolTipText;
      tip.setText('神像');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    }

    drawIconUI(g) {
      const alpha = this.iconTipT ?? 0;
      if (alpha <= 0 || !this.iconNearest || this.editing || this.state !== 'playing') {
        this.iconTipText?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.iconNearest;
      const halfDiag = Math.hypot(nv.w, nv.h) / 2;
      const reach = Math.max(nv.interactRadius || 120, halfDiag + p.r + 40);
      g.lineStyle(2, 0xffd54f, 0.7 * alpha);
      g.strokeCircle(nv.x, nv.y, reach);

      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.iconTipText) {
        this.iconTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.iconTipText);
      }
      const tip = this.iconTipText;
      tip.setText(nv.tipText || '按 F 交互');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    }

    // 打开神像祝福选择：随机 3 项基础属性加成
    openIdolOffer(idol) {
      if (this.idolOffer || !idol) return;
      const pool = [...IDOL_BUFFS];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      this.idolOffer = { idol, cards: pool.slice(0, 3), animT: 0 };
      if (this.state === 'playing') { this.prevState = 'playing'; this.state = 'paused'; }
      this.syncUIState();
    }

    closeIdolOffer() {
      if (!this.idolOffer) return;
      this.idolOffer = null;
      if (this.prevState === 'playing') { this.state = 'playing'; this.prevState = null; }
      this.syncUIState();
    }

    chooseIdolBuff(index) {
      const offer = this.idolOffer;
      if (!offer) return;
      const buff = offer.cards[index];
      if (!buff) return;
      this.player.combat = this.player.combat || {};
      buff.apply(this);
      offer.idol.used = true;
      this.closeIdolOffer();
    }

    drawIdolOffer() {
      const g = this.uiG;
      const offer = this.idolOffer;
      if (!offer) return;
      this.idolOfferTexts = this.idolOfferTexts || new Map();
      const ensure = (id, size, color) => {
        let t = this.idolOfferTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1001);
          this.cameras.main.ignore(t);
          this.idolOfferTexts.set(id, t);
        }
        t.setVisible(true);
        return t;
      };

      offer.animT = Math.min(1, (offer.animT ?? 0) + 0.016 * 5);
      const ease = 1 - Math.pow(1 - offer.animT, 3);

      g.fillStyle(0x000000, 0.65);
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      ensure('idolTitle', '34px', '#ffffff').setOrigin(0.5).setPosition(VIEW_W / 2, 200).setText('选择一项祝福');

      const cardW = 360, cardH = 300, gap = 48;
      const totalW = cardW * 3 + gap * 2;
      const startX = (VIEW_W - totalW) / 2;
      const baseY = VIEW_H - 60 - cardH + (1 - ease) * 120;

      for (let i = 0; i < 3; i++) {
        const card = offer.cards[i];
        if (!card) continue;
        const cx = startX + i * (cardW + gap) + cardW / 2;
        const cy = baseY + cardH / 2;
        const hover = this.uiPointer();
        const hov = hover.x >= cx - cardW / 2 && hover.x <= cx + cardW / 2 && hover.y >= baseY && hover.y <= baseY + cardH;

        g.fillStyle(hov ? 0x1d3a57 : 0x12263d, 1);
        g.fillRoundedRect(cx - cardW / 2, baseY, cardW, cardH, 14);
        g.lineStyle(2, hov ? 0x6fd3ff : 0x31547a, 1);
        g.strokeRoundedRect(cx - cardW / 2, baseY, cardW, cardH, 14);

        ensure(`idolCard_${i}_name`, '28px', '#ffffff').setOrigin(0.5).setPosition(cx, baseY + 80).setText(card.name);
        ensure(`idolCard_${i}_desc`, '20px', '#89a6c6').setOrigin(0.5).setPosition(cx, baseY + 150).setText(card.desc);
        ensure(`idolCard_${i}_hint`, '16px', '#54708c').setOrigin(0.5).setPosition(cx, baseY + 230).setText('点击选择');

        this.buttons.push({ id: `idolCard_${i}`, x: cx - cardW / 2, y: baseY, w: cardW, h: cardH });
      }
    }

    // 售货机：F 键互动（靠近显示提示，按 F 打开局内商店）
    updateVendorInteract(dt) {
      if (this.editing || this.state !== 'playing') {
        this.vendorNearest = null;
        this.vendorTipT = 0;
        return;
      }
      const p = this.player;
      if (!p) return;

      let nearest = null, nearestDist = Infinity;
      for (const v of (this.vendors || [])) {
        if (v.visible === false) continue;
        const halfDiag = Math.hypot(v.w, v.h) / 2;
        const reach = Math.max(v.interactRadius || 120, halfDiag + p.r + 40);
        const d = Math.hypot(p.x - v.x, p.y - v.y);
        if (d < reach && d < nearestDist) { nearestDist = d; nearest = v; }
      }
      this.vendorNearest = nearest;
      this.vendorTipT = nearest ? Math.min(1, (this.vendorTipT || 0) + dt / 180) : 0;

      if (nearest && this.keys.F && Phaser.Input.Keyboard.JustDown(this.keys.F)) {
        this.openMenuScreen('vendor');
      }
    }

    drawVendorUI(g) {
      const alpha = this.vendorTipT ?? 0;
      if (alpha <= 0 || !this.vendorNearest || this.editing || this.state !== 'playing') {
        this.vendorTipText?.setVisible(false);
        this.vendorTipKeyText?.setVisible(false);
        this.fKeyBadge?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.vendorNearest;
      if (nv) {
        const halfDiag = Math.hypot(nv.w, nv.h) / 2;
        const reach = Math.max(nv.interactRadius || 120, halfDiag + p.r + 40);
        g.lineStyle(2, 0xffd54f, 0.7 * alpha);
        g.strokeCircle(nv.x, nv.y, reach);
      }
      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.vendorTipText) {
        this.vendorTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.vendorTipText);
      }
      const tip = this.vendorTipText;
      tip.setText('售货机');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      // F 键帽图标
      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    }

    syncChestSprites() {
      if (!this.textures.exists(CHEST_CLOSED_KEY) || !this.textures.exists(CHEST_OPEN_KEY)) return;

      const chests = this.editing
        ? (ctx.state.level.chests || [])
        : (this.chests || []).filter(c => c.spawned);

      const seen = new Set();
      for (const c of chests) {
        seen.add(c.id);
        let img = this.chestSprites.get(c.id);
        if (!img) {
          img = this.add.image(c.x, c.y, CHEST_CLOSED_KEY).setOrigin(0.5).setDepth(9);
          if (this.uiCam) this.uiCam.ignore(img);
          this.chestSprites.set(c.id, img);
        }
        img.setPosition(c.x, c.y);
        const opened = this.editing ? false : c.opened;
        const tex = opened ? CHEST_OPEN_KEY : CHEST_CLOSED_KEY;
        if (img.texture.key !== tex) img.setTexture(tex);
        const tw = img.frame?.width || 1254;
        // 开启态内容在画布内留白更多，按内容宽比补偿，使开启/常态视觉同宽
        const correction = opened ? CHEST_OPEN_SCALE_CORRECTION : 1;
        img.setScale(CHEST_SIZE / tw * correction);
        img.setVisible(true);
      }

      for (const [id, img] of this.chestSprites) {
        if (!seen.has(id)) {
          img.destroy();
          this.chestSprites.delete(id);
        }
      }
    }

    drawChestEffects(g) {
      if (this.editing) return;
      for (const c of (this.chests || [])) {
        if (!c.spawned || !c.fx) continue;
        const dur = c.fx.kind === 'open' ? CHEST_OPEN_FX_MS : CHEST_SPAWN_FX_MS;
        const remaining = Math.max(0, c.fx.t);
        const progress = 1 - remaining / dur; // 0..1
        this.drawChestStar(g, c.x, c.y, progress, CHEST_SIZE * 1.6);
      }
    }

    // 传送门出现：复用宝箱的金色十字星特效
    drawPortalEffects(g) {
      if (this.editing) return;
      for (const p of (this.portals || [])) {
        if (!p.spawned || !p.fx || p.visible === false) continue;
        const remaining = Math.max(0, p.fx.t);
        const progress = 1 - remaining / CHEST_SPAWN_FX_MS; // 0..1
        this.drawChestStar(g, p.x, p.y, progress, Math.max(p.w, p.h) * 1.6);
      }
    }

    draw() {
      const l = ctx.state.level;
      const g = this.g;
      const { w: ww, h: wh } = this.worldSize();

      if (this.editing && this.hudIndicatorText) this.hudIndicatorText.setVisible(false);

      this.bgG.clear();
      this.bgG.fillStyle(color(l.backgroundColor));
      this.bgG.fillRect(0, 0, ww, wh);
      this.applyBackground();
      this.syncLevelImages();

      g.clear();

      if (l.background?.fx === 'wormhole') drawWormhole(g, l.background, this.time.now / 1000, this.intro || null);

      if ((this.editing && ctx.state.showGridInEditor) || (!this.editing && l.showGridInPlay)) {
        const gridW = this.cameras.main.zoomX ? 1 / this.cameras.main.zoomX : 1;
        g.lineStyle(gridW, color(l.gridColor), .7);
        for (let x = 0; x <= ww; x += CELL) g.lineBetween(x, 0, x, wh);
        for (let y = 0; y <= wh; y += CELL) g.lineBetween(0, y, ww, y);
      }

      l.walls.forEach(w => {
        if (!this.editing && w.visible === false) return;
        drawWallShape(g, w, color(w.color || DEFAULT_WALL_COLOR));

        if (ctx.state.selected === w && this.editing) {
          const corners = wallCorners(w);
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

      this.syncChestSprites();
      this.syncVendorSprites();
      this.syncIdolSprites();
      this.syncIconSprites();
      this.drawIcons(g);
      this.syncPortalSprites();
      const chests = this.editing ? (l.chests || []) : (this.chests || []).filter(c => c.spawned);
      if (this.editing) {
        chests.forEach(c => {
          if (ctx.state.selected === c) {
            g.lineStyle(2, 0xffe083);
            g.strokeCircle(c.x, c.y, c.openRadius);
          }
        });
      }
      this.drawChestEffects(g);

      const portals = this.editing ? (l.portals || []) : (this.portals || []).filter(p => p.spawned && p.visible !== false);
      portals.forEach(p => {
        drawPortalShape(g, p.x, p.y, p.w, p.h, p.rotation || 0);
        if (this.editing && ctx.state.selected === p) {
          g.lineStyle(2, 0xffe083);
          g.strokeCircle(p.x, p.y, p.interactRadius || 90);
          const corners = wallCorners(p);
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
          const r = wallRotationRad(p);
          const cr = Math.cos(r), sr = Math.sin(r);
          const off = ROTATE_HANDLE_OFFSET + p.h / 2;
          const rhx = p.x + off * sr;
          const rhy = p.y - off * cr;
          g.lineStyle(1, 0xffffff, .8);
          g.lineBetween(p.x, p.y, rhx, rhy);
          g.fillStyle(0xffe083);
          g.fillCircle(rhx, rhy, 6);
        }
      });
      this.drawPortalEffects(g);

      drawGates(this, g, l, ctx.state.selected);

      if (this.editing) {
        (l.spawnZones || []).forEach(z => {
          const sel = ctx.state.selected === z;
          g.lineStyle(2, sel ? 0xffe083 : color(z.color || '#7ee787'), sel ? 1 : 0.6);
          g.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
          g.lineStyle(1, sel ? 0xffe083 : color(z.color || '#7ee787'), 0.3);
          g.strokeRect(z.x - z.w / 2 + 4, z.y - z.h / 2 + 4, z.w - 8, z.h - 8);
          if (sel) {
            for (const [hx, hy] of [
              [z.x - z.w / 2, z.y - z.h / 2],
              [z.x + z.w / 2, z.y - z.h / 2],
              [z.x - z.w / 2, z.y + z.h / 2],
              [z.x + z.w / 2, z.y + z.h / 2]
            ]) {
              g.fillStyle(0xffffff);
              g.fillRect(hx - 5, hy - 5, 10, 10);
            }
          }
        });
      }

      if (!this.editing) {
        this.crateDebris.forEach(d => drawCrateDebris(g, d));
      }

      l.triggers.forEach(t => {
        if (!t.visible && !this.editing) return;
        g.fillStyle(color(t.color));
        if (t.shape === 'circle') {
          const r = Math.max(t.w, t.h) / 2;
          g.fillCircle(t.x, t.y, r);
          g.lineStyle(2, ctx.state.selected === t ? 0xffe083 : 0xffffff, .6);
          g.strokeCircle(t.x, t.y, r);
          if (ctx.state.selected === t && this.editing) {
            g.lineStyle(2, 0xffe083);
            g.strokeCircle(t.x, t.y, r + 4);
          }
          return;
        }
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
        this.drawLockEffects(g);
        this.enemies.forEach(e => { if (e.alive) drawEnemyShape(g, e, true, this.player); });
        this.hitEffects.forEach(h => {
          g.fillStyle(h.color || 0xffffff, Math.max(0, h.ttl / HIT_FX_TTL));
          g.fillCircle(h.x, h.y, HIT_FX_RADIUS);
        });
        this.drops.forEach(d => {
          if (d.type === 'gold') drawGoldHex(g, d.x, d.y);
          else {
            g.fillStyle(d.type === 'charge' ? color(WEAPONS[d.weapon]?.ringColor || '#3a7bff') : 0xffffff);
            g.fillCircle(d.x, d.y, 3);
          }
        });
      }

      if (!this.editing) {
        if (!this.isMenuLevel()) {
          drawPlayer(g, this.player);
          drawShieldArc(g, this.player);
          this.drawNewbeeHint();
          this.drawNewbeeRects(g);
          this.drawHubUI(g);
          this.drawVendorUI(g);
          this.drawIdolUI(g);
          this.drawIconUI(g);
          this.drawPortalUI(g);
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

      if (this.editing && ctx.state.selected && (l.idols || []).includes(ctx.state.selected)) {
        const v = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h);
        for (const [hx, hy] of [
          [v.x - v.w / 2, v.y - v.h / 2],
          [v.x + v.w / 2, v.y - v.h / 2],
          [v.x - v.w / 2, v.y + v.h / 2],
          [v.x + v.w / 2, v.y + v.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
        g.lineStyle(1, 0xffd54f, 0.5);
        g.strokeCircle(v.x, v.y, v.interactRadius || 130);
      }

      if (this.editing && ctx.state.selected && (l.vendors || []).includes(ctx.state.selected)) {
        const v = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(v.x - v.w / 2, v.y - v.h / 2, v.w, v.h);
        for (const [hx, hy] of [
          [v.x - v.w / 2, v.y - v.h / 2],
          [v.x + v.w / 2, v.y - v.h / 2],
          [v.x - v.w / 2, v.y + v.h / 2],
          [v.x + v.w / 2, v.y + v.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
        g.lineStyle(1, 0xffd54f, 0.5);
        g.strokeCircle(v.x, v.y, v.interactRadius || 120);
      }

      if (this.editing && ctx.state.selected && (l.icons || []).includes(ctx.state.selected)) {
        const ic = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(ic.x - ic.w / 2, ic.y - ic.h / 2, ic.w, ic.h);
        for (const [hx, hy] of [
          [ic.x - ic.w / 2, ic.y - ic.h / 2],
          [ic.x + ic.w / 2, ic.y - ic.h / 2],
          [ic.x - ic.w / 2, ic.y + ic.h / 2],
          [ic.x + ic.w / 2, ic.y + ic.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
        g.lineStyle(1, 0xffd54f, 0.5);
        g.strokeCircle(ic.x, ic.y, ic.interactRadius || 120);
      }

      if (this.editing && ctx.state.selected && l.images.includes(ctx.state.selected)) {
        const im = ctx.state.selected;
        g.lineStyle(2, 0x6fd3ff);
        g.strokeRect(im.x - im.w / 2, im.y - im.h / 2, im.w, im.h);
        for (const [hx, hy] of [
          [im.x - im.w / 2, im.y - im.h / 2],
          [im.x + im.w / 2, im.y - im.h / 2],
          [im.x - im.w / 2, im.y + im.h / 2],
          [im.x + im.w / 2, im.y + im.h / 2]
        ]) {
          g.fillStyle(0xffffff);
          g.fillRect(hx - 5, hy - 5, 10, 10);
        }
      }

      if (ctx.state.selected && ctx.state.selected !== l.spawn && !l.triggers.includes(ctx.state.selected) && ctx.state.selected !== l.background && !l.images.includes(ctx.state.selected)) {
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

    // 新手关：玩家头顶分阶段操作提示（文字 + 可选键位图标）
    drawNewbeeHint() {
      const nb = this.newbee;
      if (!nb || !nb.hint || !nb.hint.text) {
        this.newbeeHintText?.setVisible(false);
        if (this.newbeeHintIcons) {
          for (const img of Object.values(this.newbeeHintIcons)) if (img && typeof img === 'object') img.setVisible(false);
        }
        return;
      }

      const hint = nb.hint;
      const p = this.player;
      // 出现前延迟：倒计时未结束不显示
      if (hint.pre != null && hint.pre > 0) {
        this.newbeeHintText?.setVisible(false);
        if (this.newbeeHintIcons) {
          for (const img of Object.values(this.newbeeHintIcons)) if (img && typeof img === 'object') img.setVisible(false);
        }
        return;
      }
      // 透明底淡入 / 淡出透明度
      let alpha = hint.showT != null ? Phaser.Math.Clamp(hint.showT / NEWBEE_HINT_FADE_MS, 0, 1) : 1;
      if (hint.fadeAt != null) {
        alpha = Math.min(alpha, Phaser.Math.Clamp(hint.fadeAt / NEWBEE_HINT_FADE_MS, 0, 1));
      }
      if (alpha <= 0) return;

      if (!this.newbeeHintText) {
        this.newbeeHintText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC,
          fontSize: '30px', color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5, 1).setDepth(12);
        this.newbeeHintText.setShadow(0, 2, 'rgba(0,0,0,0.7)', 4);
        this.uiCam.ignore(this.newbeeHintText);   // 仅主相机渲染，跟随玩家显示
      }
      const t = this.newbeeHintText;
      t.setText(hint.text);
      t.setVisible(true);
      t.setAlpha(alpha);
      t.setPosition(p.x, p.y - NEWBEE_HINT_Y_OFFSET);

      // 键位图标（图片素材，若存在则叠加显示在文字上方）
      if (hint.icon) {
        const src = NEWBEE_ICONS[hint.icon];
        if (!this.newbeeHintIcons) this.newbeeHintIcons = {};
        let img = this.newbeeHintIcons[hint.icon];
        if (src && img === undefined) {
          const key = `__newbee_${hint.icon}__`;
          this.newbeeHintIcons[hint.icon] = 'loading';
          const raw = new Image();
          raw.onload = () => {
            // 校验资源有效性：404 等会返回非图片内容，naturalWidth 为 0
            if (!raw.naturalWidth || !raw.naturalHeight) {
              this.newbeeHintIcons[hint.icon] = null;
              return;
            }
            if (!this.textures.exists(key)) this.textures.addImage(key, raw);
            const tex = this.textures.get(key);
            if (!tex || !tex.source?.[0]?.image) { this.newbeeHintIcons[hint.icon] = null; return; }
            const spr = this.add.image(0, 0, key).setOrigin(0.5, 1).setDepth(12);
            spr.setDisplaySize(72, 72);
            this.uiCam.ignore(spr);   // 仅主相机渲染，跟随玩家显示
            this.newbeeHintIcons[hint.icon] = spr;
          };
          raw.onerror = () => { this.newbeeHintIcons[hint.icon] = null; };
          raw.src = src;
          img = this.newbeeHintIcons[hint.icon];
        }
        if (img && img !== 'loading') {
          img.setAlpha(alpha);
          img.setVisible(true);
          img.setPosition(p.x, p.y - NEWBEE_HINT_Y_OFFSET - t.height - 14);
        }
      }
    }

    // 新手关阶段6：绘制两个矩形触发器（后续用特效代替）
    drawNewbeeRects(g) {
      const nb = this.newbee;
      if (!nb || nb.phase !== 6) {
        if (this.newbeeRectLabels) for (const label of this.newbeeRectLabels.values()) label.setVisible(false);
        return;
      }
      this.drawNewbeeRect(g, nb.exitRect, 0x4fc3f7, '离开');
      this.drawNewbeeRect(g, nb.practiceRect, 0x81c784, '练习');
    }

    drawNewbeeRect(g, rect, colorHex, label) {
      g.lineStyle(3, colorHex, 0.9);
      g.strokeRect(rect.x - rect.w / 2, rect.y - rect.h / 2, rect.w, rect.h);
      g.fillStyle(colorHex, 0.15);
      g.fillRect(rect.x - rect.w / 2, rect.y - rect.h / 2, rect.w, rect.h);
      this.drawWorldLabel(rect.x, rect.y, label, colorHex);
    }

    drawWorldLabel(x, y, text, colorHex) {
      if (!this.newbeeRectLabels) this.newbeeRectLabels = new Map();
      let label = this.newbeeRectLabels.get(text);
      if (!label) {
        label = this.add.text(0, 0, text, {
          fontFamily: FONT_TECH_SC, fontSize: '20px', color: `#${colorHex.toString(16).padStart(6, '0')}`, fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(12);
        this.newbeeRectLabels.set(text, label);
      }
      label.setPosition(x, y);
      label.setVisible(true);
    }

    // 骑士之家：可互动物体图标占位 + 靠近时的 F 键提示（平行四边形，白底黑字，渐显）
    drawHubUI(g) {
      const hub = this.isHubLevel();
      if (!hub || this.state !== 'playing') {
        if (this.hubIcons) for (const spr of Object.values(this.hubIcons)) spr.setVisible(false);
        this.hubTipText?.setVisible(false);
        this.hubTipKeyText?.setVisible(false);
        this.fKeyBadge?.setVisible(false);
        return;
      }

      const p = this.player;
      const it = this.hubNearest;

      // 可互动物体图标占位（待制作）
      if (!this.hubIcons) this.hubIcons = {};
      for (const item of HUB_INTERACTABLES) {
        const key = item.id;
        if (!this.hubIcons[key]) {
          const spr = this.add.text(item.x, item.y, ({ workshop: '⚒', weapon: '🛒', levelSelect: '🗺' })[item.id] || '🛒', {
            fontFamily: FONT_TECH_SC, fontSize: '48px'
          }).setOrigin(0.5).setDepth(12);
          if (this.uiCam) this.uiCam.ignore(spr);   // 仅主相机渲染（世界坐标），避免镜头层出现重复图标
          this.hubIcons[key] = spr;
        }
        const spr = this.hubIcons[key];
        spr.setPosition(item.x, item.y);
        spr.setVisible(true);
        if (it === item) {
          const r = HUB_INTERACT_RADIUS;
          g.lineStyle(2, 0xffd54f, 0.7);
          g.strokeCircle(item.x, item.y, r);
        }
      }

      // F 键提示渐显（透明度由 updateHubInteract 累积）
      const alpha = this.hubTipT ?? 0;
      if (alpha <= 0 || !it) {
        this.hubTipText?.setVisible(false);
        this.hubTipKeyText?.setVisible(false);
        this.fKeyBadge?.setVisible(false);
        return;
      }

      const tx = p.x + 20, ty = p.y - 20;
      // 平行四边形白底
      const w = 190, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.hubTipText) {
        this.hubTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.hubTipText);
      }
      const tip = this.hubTipText;
      tip.setText(it.label);
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      // F 键帽图标
      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    }

    setupUI() {
      this.uiCam = this.cameras.add(0, 0, VIEW_W, VIEW_H).setScroll(0, 0).setZoom(1);
      this.uiG = this.add.graphics().setDepth(1000);
      this.cameras.main.ignore(this.uiG);
      this.uiCam.ignore(this.g);
      this.uiCam.ignore(this.bgG);
      this.workshopCardMaskG = this.add.graphics().setDepth(999);
      this.workshopCardMaskG.fillStyle(0xffffff, 0);
      this.workshopCardMaskG.fillRect(544, 120, 1312, 380);
      this.workshopCardMask = new Phaser.Display.Masks.GeometryMask(this, this.workshopCardMaskG);
      this.cameras.main.ignore(this.workshopCardMaskG);
      this.uiTexts = { battle: new Map(), interface: new Map(), login: new Map(), weapon: new Map(), workshop: new Map() };
      this.uiImages = { battle: new Map(), interface: new Map(), login: new Map(), weapon: new Map(), workshop: new Map() };
      this.workshopTexts = new Map();
      this.settingsTexts = new Map();
      this.settingsMode = null;
      this.settingsPrev = null;
      this.menuIconSprites = new Map();
      this.buttons = [];

      this.failTitle = this.add.text(VIEW_W / 2, VIEW_H / 2 - 40, '失败', {
        fontFamily: FONT_TECH_SC,
        fontSize: '64px', color: '#ffffff'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.failTitle);
      this.failHint = this.add.text(VIEW_W / 2, VIEW_H / 2 + 40, '点击屏幕重新开始', {
        fontFamily: FONT_TECH_SC,
        fontSize: '28px', color: '#9fc3d8'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.failHint);
      this.failTitle.setVisible(false);
      this.failHint.setVisible(false);

      this.weaponLabels = [];
      for (let i = 0; i < 3; i++) {
        const t = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC,
          fontSize: '22px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(1001);
        this.cameras.main.ignore(t);
        t.setVisible(false);
        this.weaponLabels.push(t);
      }

      this.ammoCurrent = this.add.text(0, 0, '', {
        fontFamily: FONT_TECH,
        fontSize: '45px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.ammoCurrent);
      this.ammoMax = this.add.text(0, 0, '', {
        fontFamily: FONT_TECH,
        fontSize: '30px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.ammoMax);

      this.hudIndicatorText = this.add.text(0, 0, '', {
        fontFamily: FONT_TECH,
        fontSize: '34px', color: '#000000', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.hudIndicatorText);
      this.hudIndicatorText.setVisible(false);

      this.weaponIconImage = null;
      this.loadWeaponIcon();
      this.loadUIImages();
    }

    loadUIImages() {
      const ui = ctx.state.ui || {};
      for (const key of ['battle', 'interface', 'login', 'weapon', 'workshop']) {
        for (const node of ui[key]?.nodes || []) {
          if (node.type !== 'image' || !node.src) continue;
          if (this.uiImages[key].has(node.id)) continue;
          const texKey = `__ui_img_${key}_${node.id}__`;
          const img = new Image();
          img.onload = () => {
            if (this.uiImages[key].has(node.id)) return;
            if (!this.textures.exists(texKey)) this.textures.addImage(texKey, img);
            const texture = this.textures.get(texKey);
            if (!texture || !texture.source?.[0]?.image) return;
            const sprite = this.add.image(node.x, node.y, texKey).setOrigin(0.5).setDepth(1001);
            this.cameras.main.ignore(sprite);
            sprite.setDisplaySize(node.w || img.width, node.h || img.height);
            if (node.angle != null) sprite.setRotation(Phaser.Math.DegToRad(node.angle));
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
        if (this.textures.exists(key)) return;
        this.textures.addImage(key, img);
        const texture = this.textures.get(key);
        if (!texture || !texture.source?.[0]?.image) return;
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
      for (const key of ['battle', 'interface', 'login', 'weapon', 'workshop']) {
        const nodes = ui[key]?.nodes || [];
        for (const node of nodes) {
          if (node.type !== 'text') continue;
          const text = this.add.text(node.x, node.y, '', {
            fontFamily: FONT_TECH_SC,
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

    isPreviewMode() {
      return !this.editing && ctx.state.mode === 'play';
    }

    // 试玩模式：与正式一致的实机流程，使用 state.player（试玩时该数据来自测试存档）
    isTrialMode() {
      return !this.editing && ctx.state.mode === 'trial';
    }

    isNewbeeLevel() {
      return ctx.state.levelId === 'newbee';
    }

    isHubLevel() {
      return ctx.state.levelId === 'knight-home';
    }

    isBattleLevel() {
      return !this.isHubLevel() && (ctx.state.level?.ui || 'battle') === 'battle';
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
        weaponLevel: p.weaponLevel ?? 1,
        weaponType: p.weaponType || 'radial',
        weapons: p.weapons || ['radial'],
        loadout: p.loadout || ['radial'],
        equipment: p.equipment || {},
        items: p.items || { stacks: {}, uniques: [] },
        combat: p.combat || {},
        points: p.points || {},
        spendablePoints: p.spendablePoints ?? 0
      };
    }

    // 把指针位置换算到 UI 坐标（1920x1080 空间），兼容 CSS object-fit: contain 缩放
    uiPointer() {
      const p = this.input?.activePointer;
      if (!p) return { x: 0, y: 0 };
      const canvas = this.game?.canvas;
      const rect = canvas?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return { x: p.x, y: p.y };
      // 显示区按 contain 缩放绘制，Phaser pointer.x 按 canvas 元素尺寸均匀换算，
      // 需还原回 contain 后的实际绘制区
      const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      const drawW = VIEW_W * scale, drawH = VIEW_H * scale;
      const offX = (rect.width - drawW) / 2, offY = (rect.height - drawH) / 2;
      return {
        x: (p.x / VIEW_W * rect.width - offX) / scale,
        y: (p.y / VIEW_H * rect.height - offY) / scale
      };
    }

    // ---------- 局内售货机（独立 HUD 页）：左老虎机（占位）+ 右局内商店 ----------
    drawVendorShop() {
      const g = this.uiG;
      this.vendorShopTexts = this.vendorShopTexts || new Map();
      const ensure = (id, size, color) => {
        let t = this.vendorShopTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1001);
          this.cameras.main.ignore(t);
          this.vendorShopTexts.set(id, t);
        }
        t.setVisible(true);
        return t;
      };

      const gold = this.player?.gold ?? 0;

      // 左侧：老虎机（占位）
      const slotX = 150, slotY = 150, slotW = 700, slotH = 780;
      g.fillStyle(0x0d1b2d, 1);
      g.fillRoundedRect(slotX, slotY, slotW, slotH, 12);
      g.lineStyle(2, 0x6fd3ff, 1);
      g.strokeRoundedRect(slotX, slotY, slotW, slotH, 12);
      ensure('slotTitle', '30px', '#6fd3ff').setOrigin(0.5, 0).setPosition(slotX + slotW / 2, slotY + 24).setText('老虎机');
      // 占位转轮窗口
      g.lineStyle(2, 0x31547a, 1);
      g.strokeRoundedRect(slotX + 60, slotY + 120, slotW - 120, 300, 10);
      ensure('slotPlaceholder', '26px', '#89a6c6').setOrigin(0.5).setPosition(slotX + slotW / 2, slotY + 270).setText('敬请期待');
      ensure('slotHint', '18px', '#54708c').setOrigin(0.5).setPosition(slotX + slotW / 2, slotY + 600).setText('（功能开发中）');

      // 右侧：局内商店
      const shopX = 930, shopY = 150, shopW = 820, shopH = 780;
      g.fillStyle(0x0d1b2d, 1);
      g.fillRoundedRect(shopX, shopY, shopW, shopH, 12);
      g.lineStyle(2, 0x6fd3ff, 1);
      g.strokeRoundedRect(shopX, shopY, shopW, shopH, 12);
      ensure('shopTitle', '30px', '#ffffff').setOrigin(0.5, 0).setPosition(shopX + shopW / 2, shopY + 24).setText('局内商店');
      ensure('shopGold', '22px', '#ffd54f').setOrigin(1, 0.5).setPosition(shopX + shopW - 24, shopY + 52).setText(`金币 ${gold}`);
      ensure('shopNote', '16px', '#54708c').setOrigin(0, 0.5).setPosition(shopX + 24, shopY + 52).setText('仅当局生效');

      let rowY = shopY + 110;
      for (const item of VENDOR_BUFFS) {
        const bx = shopX + 24, by = rowY, bw = shopW - 48, bh = 96;
        const bought = this.vendorBought?.has(item.id);
        g.fillStyle(bought ? 0x16324a : 0x13253c, 1);
        g.fillRoundedRect(bx, by, bw, bh, 8);
        g.lineStyle(1, 0x31547a, 1);
        g.strokeRoundedRect(bx, by, bw, bh, 8);

        ensure(`it_${item.id}_name`, '24px', '#ffffff').setOrigin(0, 0.5).setPosition(bx + 24, by + 32).setText(item.name);
        ensure(`it_${item.id}_desc`, '18px', '#89a6c6').setOrigin(0, 0.5).setPosition(bx + 24, by + 68).setText(item.desc);

        if (bought) {
          ensure(`it_${item.id}_state`, '22px', '#4fc3f7').setOrigin(1, 0.5).setPosition(bx + bw - 24, by + bh / 2).setText('已生效');
        } else {
          const bbw = 160, bbh = 48;
          const bbx = bx + bw - 24 - bbw, bby = by + bh / 2 - bbh / 2;
          const canBuy = gold >= item.price;
          g.fillStyle(canBuy ? 0xffffff : 0x444444, 1);
          g.fillRoundedRect(bbx, bby, bbw, bbh, 6);
          ensure(`it_${item.id}_price`, '20px', canBuy ? '#000000' : '#999999').setOrigin(0.5, 0.5).setPosition(bbx + bbw / 2, bby + bbh / 2).setText(`购买 ${item.price}`);
          this.buttons.push({ id: `buyBuff_${item.id}`, x: bbx, y: bby, w: bbw, h: bbh });
        }
        rowY += 116;
      }
    }

    // ---------- 选择关卡（levelSelect）：3 大关 + 每关 3 小关占位 ----------
    drawLevelSelect() {
      if (this.levelSelectOpen === undefined) this.levelSelectOpen = null;
      const g = this.uiG;
      this.levelSelectTexts = this.levelSelectTexts || new Map();
      const ensure = (id, size, color) => {
        let t = this.levelSelectTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1001);
          this.cameras.main.ignore(t);
          this.levelSelectTexts.set(id, t);
        }
        t.setVisible(true);
        return t;
      };

      // 左侧：3 张大关卡卡
      const bigW = 260, bigH = 420, gap = 40, startX = 300, topY = 300;
      for (let n = 0; n < 3; n++) {
        const big = n + 1;
        const x = startX + n * (bigW + gap);
        const y = topY;
        const open = this.levelSelectOpen === n;
        g.fillStyle(open ? 0x16324a : 0x0d1b2d, 1);
        g.fillRoundedRect(x, y, bigW, bigH, 12);
        g.lineStyle(2, open ? 0xffd54f : 0x6fd3ff, 1);
        g.strokeRoundedRect(x, y, bigW, bigH, 12);
        ensure(`big_${n}_title`, '34px', '#ffffff').setOrigin(0.5, 0).setPosition(x + bigW / 2, y + 26).setText(`Level ${big}`);
        ensure(`big_${n}_num`, '20px', '#89a6c6').setOrigin(0.5).setPosition(x + bigW / 2, y + 150).setText(`${big}`);
        ensure(`big_${n}_state`, '18px', '#54708c').setOrigin(0.5).setPosition(x + bigW / 2, y + bigH - 30).setText(open ? '点击收起' : '点击展开');
        this.buttons.push({ id: `levelBig_${n}`, x, y, w: bigW, h: bigH, node: { n } });
      }

      // 右侧：展开后绘制 3 张小关卡卡
      if (this.levelSelectOpen !== null && this.levelSelectOpen >= 0 && this.levelSelectOpen <= 2) {
        const big = this.levelSelectOpen + 1;
        const smallW = 260, smallH = 110, smallGap = 30, smallX = 1260, smallY = topY;
        for (let s = 1; s <= 3; s++) {
          const x = smallX;
          const y = smallY + (s - 1) * (smallH + smallGap);
          g.fillStyle(0x0d1b2d, 1);
          g.fillRoundedRect(x, y, smallW, smallH, 10);
          g.lineStyle(2, 0x6fd3ff, 1);
          g.strokeRoundedRect(x, y, smallW, smallH, 10);
          ensure(`small_${big}_${s}`, '24px', '#ffffff').setOrigin(0.5).setPosition(x + smallW / 2, y + smallH / 2).setText(`Scene ${s}`);
          this.buttons.push({ id: `levelSmall_${big}_${s}`, x, y, w: smallW, h: smallH, node: { levelId: `Level${big}-Scene${s}` } });
        }
      }
    }

    buyBuff(id) {
      const item = VENDOR_BUFFS.find(d => d.id === id);
      if (!item || !this.player || this.vendorBought.has(id)) return;
      if ((this.player.gold ?? 0) < item.price) return;
      this.player.gold -= item.price;
      this.player.combat = this.player.combat || {};
      item.apply(this);
      this.vendorBought.add(id);
      this.syncUIState();
    }

    drawWorkshopUI() {
      const g = this.uiG;
      const source = this.saveSource() || {};
      const progress = source.progress || {};
      const level = progress.level ?? this.player?.level ?? 1;
      const exp = progress.exp ?? 0;
      const expToNext = progress.expToNext ?? 100;
      const spendable = progress.points ?? 0;
      const combat = source.combat || {};
      const points = source.points || {};
      const equipment = source.equipment || { weaponMods: {}, relics: [], pets: [] };
      const items = source.items || { stacks: {}, uniques: [] };
      const weaponsState = source.weapons || {};
      const loadout = Array.isArray(source.loadout) ? source.loadout : ['radial'];

      if (!this.workshopTexts) this.workshopTexts = new Map();
      const labels = this.workshopTexts;
      for (const t of labels.values()) t.setVisible(false);
      const ensure = (id, size, colorStr = '#ffffff') => {
        let t = labels.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', {
            fontFamily: FONT_TECH_SC,
            fontSize: size, color: colorStr
          }).setDepth(1001);
          this.cameras.main.ignore(t);
          labels.set(id, t);
        }
        t.setFontSize(size);
        t.setColor(colorStr);
        t.setVisible(true);
        return t;
      };

      // 每帧重置命中区
      this.workshopDropZones = [];
      this.workshopItemRects = [];
      this.workshopCardRects = [];
      this.workshopScrollArea = { x: 544, y: 120, w: 1312, h: 380 };

      // 属性条动画状态
      const now = this.time.now;
      if (this.statBarLast == null) this.statBarLast = now;
      const dt = Math.max(0, now - this.statBarLast);
      this.statBarLast = now;
      this.statBars = this.statBars || {};

      // ===== 左面板 =====
      g.fillStyle(0x0a0a0a, 0.98);
      g.fillRect(40, 40, 460, 1000);

      // 左右分界
      g.lineStyle(2, 0x2a2a2a, 1);
      g.lineBetween(512, 40, 512, 1040);

      // 快照：玩家美术方案（当前出战武器），居中、缩小 20%
      const current = loadout[0] || 'radial';
      const currentColor = WEAPONS[current]?.ringColor || '#ffa914';
      drawHexRingPlayer(g, {
        x: 254, y: 128,
        weapon: { ringColor: currentColor },
        scheme: WEAPONS[current]?.scheme || 'hex-ring',
        weaponAngle: 0,
        moveLeanX: 0, moveLeanY: 0,
        moveHexRadius: PLAYER_ART.hexagonRadius
      }, 1.2);

      // 右上角 3 个武器方案槽（竖排、小尺寸）
      for (let i = 0; i < 3; i++) {
        const sx = 400, sy = 64 + i * 46, sw = 36, sh = 36;
        const slotWeapon = i === 0 ? 'radial' : loadout[i];
        const unlocked = i === 0 ? true : level >= WEAPON_SLOT_LEVELS[i - 1];
        if (!unlocked) {
          g.fillStyle(0x555555, 1);
          g.fillRoundedRect(sx, sy, sw, sh, 6);
          drawLock(g, sx + sw / 2, sy + sh / 2, 12);
        } else if (!slotWeapon) {
          g.fillStyle(0xffffff, 1);
          g.fillRoundedRect(sx, sy, sw, sh, 6);
        } else {
          const wc = WEAPONS[slotWeapon]?.ringColor || '#ffffff';
          g.fillStyle(color(wc), 1);
          g.fillRoundedRect(sx, sy, sw, sh, 6);
          drawWeaponGlyph(g, sx + sw / 2, sy + sh / 2, slotWeapon, false, 12);
          g.lineStyle(2, color(wc), 1);
          g.strokeRoundedRect(sx, sy, sw, sh, 6);
        }
        if (i > 0) this.buttons.push({ id: `workshopSlot_${i}`, x: sx, y: sy, w: sw, h: sh });
      }

      // 等级 / 经验条 / 可用点数
      ensure('lv', '30px', '#ffffff').setOrigin(0, 0).setPosition(64, 226).setText(`Lv ${level}`);
      g.fillStyle(0x222222, 1);
      g.fillRect(64, 262, 380, 12);
      const expRatio = expToNext > 0 ? Math.min(1, exp / expToNext) : 0;
      g.fillStyle(0x00e5ff, 1);
      g.fillRect(64, 262, 380 * expRatio, 12);
      ensure('xp', '14px', '#888888').setOrigin(1, 0.5).setPosition(444, 268).setText(`${exp}/${expToNext}`);
      ensure('points', '22px', '#ffffff').setOrigin(0, 0).setPosition(64, 294).setText(`可用升级点数  ${spendable}`);

      // 分隔线
      g.lineStyle(1, 0x333333, 1);
      g.lineBetween(64, 330, 444, 330);

      // 4 属性行
      const keys = Object.keys(UPGRADE_STATS);
      keys.forEach((key, i) => {
        const cfg = UPGRADE_STATS[key];
        const raw = combat[key] ?? 0;
        const spent = points[key] ?? 0;
        const filled = spent >= cfg.cap;
        const rowY = 346 + i * 72;
        const target = Math.min(1, spent / cfg.cap);
        let sb = this.statBars[key];
        if (!sb) sb = this.statBars[key] = { cur: target, target };
        sb.target = target;
        sb.cur += (sb.target - sb.cur) * Math.min(1, dt / 300);

        ensure(`up_${key}_l`, '20px', '#ffffff').setOrigin(0, 0).setPosition(64, rowY + 6).setText(cfg.label);
        ensure(`up_${key}_v`, '18px', '#ffffff').setOrigin(0, 0).setPosition(64, rowY + 34).setText(cfg.fmt(raw));

        const pbX = 64, pbW = 300, pbH = 10, pbY = rowY + 56;
        g.fillStyle(0x222222, 1);
        g.fillRect(pbX, pbY, pbW, pbH);
        g.fillStyle(0xffffff, 1);
        g.fillRect(pbX, pbY, pbW * sb.cur, pbH);

        const bx = 412, by = rowY + 20, bw = 32, bh = 32;
        const up = this.uiPointer();
        const hover = !filled && up.x >= bx && up.x <= bx + bw && up.y >= by && up.y <= by + bh;
        const scl = this.pressScale(`upgrade_${key}`);
        const cw2 = bw * scl, ch2 = bh * scl;
        const cx2 = bx + (bw - cw2) / 2, cy2 = by + (bh - ch2) / 2;
        g.fillStyle(hover ? 0x000000 : 0xffffff, 1);
        g.fillRoundedRect(cx2, cy2, cw2, ch2, 6);
        g.lineStyle(1, hover ? 0xffffff : 0x000000, 1);
        g.strokeRoundedRect(cx2, cy2, cw2, ch2, 6);
        g.fillStyle(hover ? 0xffffff : 0x000000, 1);
        g.fillRect(cx2 + cw2 * 0.18, cy2 + ch2 * 0.43, cw2 * 0.64, ch2 * 0.14);
        if (!filled) {
          g.fillRect(cx2 + cw2 * 0.43, cy2 + ch2 * 0.18, cw2 * 0.14, ch2 * 0.64);
          this.buttons.push({ id: `upgrade_${key}`, x: bx, y: by, w: bw, h: bh });
        }
      });

      // 圣物槽
      ensure('relicLabel', '18px', '#ffffff').setOrigin(0, 0.5).setPosition(64, 646).setText('圣物');
      const relics = Array.isArray(equipment.relics) ? equipment.relics : [];
      for (let i = 0; i < 3; i++) {
        const sx = 204 + i * 56, sy = 626, sw = 40, sh = 40;
        this.drawItemSlot(g, sx, sy, sw, sh, relics[i], `relic_${i}`, ensure);
        this.workshopDropZones.push({ x: sx, y: sy, w: sw, h: sh, slotType: 'relic', index: i });
      }

      // 宠物槽
      ensure('petLabel', '18px', '#ffffff').setOrigin(0, 0.5).setPosition(64, 710).setText('宠物');
      const pets = Array.isArray(equipment.pets) ? equipment.pets : [];
      for (let i = 0; i < 2; i++) {
        const sx = 260 + i * 56, sy = 690, sw = 40, sh = 40;
        this.drawItemSlot(g, sx, sy, sw, sh, pets[i], `pet_${i}`, ensure);
        this.workshopDropZones.push({ x: sx, y: sy, w: sw, h: sh, slotType: 'pet', index: i });
      }

      // ===== 右上面板：武器列表 =====
      g.fillStyle(0x0a0a0a, 0.98);
      g.fillRect(520, 40, 1360, 500);
      ensure('weaponTitle', '24px', '#ffffff').setOrigin(0, 0.5).setPosition(544, 76).setText('武器');

      const cardW = 280, cardH = 344, cardGap = 24;
      const viewW = 1312, contentW = 5 * (cardW + cardGap);
      const maxScroll = Math.max(0, contentW - viewW);
      if (this.workshopScroll == null) this.workshopScroll = 0;
      this.workshopScroll = Phaser.Math.Clamp(this.workshopScroll, 0, maxScroll);
      const cardTypes = ['radial', 'yellow', 'green', 'placeholder', 'placeholder'];

      g.setMask(this.workshopCardMask);
      for (let i = 0; i < cardTypes.length; i++) {
        const type = cardTypes[i];
        const cardX = 544 + i * (cardW + cardGap) - this.workshopScroll;
        const cardY = 120;
        if (cardX + cardW < 544 || cardX > 1856) continue;

        if (type === 'placeholder') {
          g.fillStyle(0xffffff, 1);
          g.fillRoundedRect(cardX, cardY, cardW, cardH, 4);
          g.lineStyle(2, 0xcccccc, 1);
          g.strokeRoundedRect(cardX, cardY, cardW, cardH, 4);
          g.fillStyle(0xe8e8e8, 1);
          g.fillRoundedRect(cardX, cardY, cardW, 200, 4);
          ensure(`card_ph_${i}`, '20px', '#999999').setMask(this.workshopCardMask).setOrigin(0.5, 0.5).setPosition(cardX + cardW / 2, cardY + 100).setText('即将开放');
          continue;
        }

        const unlocked = !!weaponsState[type]?.unlocked;
        const selected = loadout.includes(type);
        const wc = WEAPONS[type]?.ringColor || '#ffffff';
        this.workshopCardRects.push({ type, x: cardX, y: cardY, w: cardW, h: cardH });

        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(cardX, cardY, cardW, cardH, 4);
        if (selected) {
          g.lineStyle(3, color(wc), 1);
          g.strokeRoundedRect(cardX, cardY, cardW, cardH, 4);
        }

        g.fillStyle(unlocked ? color(wc) : 0x555555, 1);
        g.fillRoundedRect(cardX, cardY, cardW, 200, 4);
        drawWeaponGlyph(g, cardX + cardW / 2, cardY + 100, type, !unlocked, 60);
        if (!unlocked) drawLock(g, cardX + cardW / 2, cardY + 160, 20);

        const modSlot = equipment.weaponMods?.[type] || { generic: [], dedicated: null };
        const generic = Array.isArray(modSlot.generic) ? modSlot.generic : [];
        const genericId = generic[0] || null;
        const dedicatedId = modSlot.dedicated || null;
        const gx = cardX + 68, dx = cardX + 148, sy = cardY + 216;
        this.drawItemSlot(g, gx, sy, 64, 64, genericId, `wmod_${type}_g`, ensure, this.workshopCardMask);
        this.drawItemSlot(g, dx, sy, 64, 64, dedicatedId, `wmod_${type}_d`, ensure, this.workshopCardMask);
        this.workshopDropZones.push({ x: gx, y: sy, w: 64, h: 64, slotType: 'weaponGeneric', weapon: type });
        this.workshopDropZones.push({ x: dx, y: sy, w: 64, h: 64, slotType: 'weaponDedicated', weapon: type });

        ensure(`weapon_${type}`, '20px', '#000000').setMask(this.workshopCardMask).setOrigin(0.5, 0.5).setPosition(cardX + cardW / 2, cardY + 310).setText(WEAPON_LABELS[type] || type);
        this.buttons.push({ id: `workshopCard_${type}`, x: cardX, y: cardY, w: cardW, h: cardH });
      }
      g.clearMask();

      // ===== 右下仓库面板 =====
      g.fillStyle(0x0a0a0a, 0.98);
      g.fillRect(520, 560, 1360, 480);
      this.workshopTab = this.workshopTab || 'mod';
      const tabs = [['mod', '改件'], ['relic', '圣物'], ['pet', '宠物']];
      for (let i = 0; i < tabs.length; i++) {
        const [cat, label] = tabs[i];
        const tx = 544 + i * 104, ty = 584, tw = 96, th = 32;
        const sel = this.workshopTab === cat;
        ensure(`tab_${cat}`, '20px', sel ? '#ffffff' : '#888888').setOrigin(0, 0).setPosition(tx, ty).setText(label);
        if (sel) {
          g.lineStyle(2, 0xffffff, 1);
          g.lineBetween(tx, ty + 36, tx + tw, ty + 36);
        }
        this.buttons.push({ id: `workshopTab_${cat}`, x: tx, y: ty, w: tw, h: th });
      }

      const inv = this.workshopInventoryItems(source, this.workshopTab);
      if (!inv.length) {
        ensure('inventory_empty', '20px', '#888888').setOrigin(0.5, 0).setPosition(1200, 700).setText('暂无物品');
      } else {
        inv.forEach((it, idx) => {
          const col = idx % 16, row = Math.floor(idx / 16);
          const ix = 544 + col * 80, iy = 640 + row * 80;
          this.drawItemCell(g, ix, iy, it, idx, ensure);
          this.workshopItemRects.push({ id: it.id, def: it.def, stackable: it.def.stackable, category: it.def.category, count: it.count, x: ix, y: iy, w: 64, h: 64 });
        });
      }

      // 拖拽图标 + 来源高亮
      if (this.workshopDrag) {
        const up = this.uiPointer();
        const def = ITEM_DEFS[this.workshopDrag.itemId];
        if (def) {
          g.fillStyle(color(def.color || '#ffffff'), 0.9);
          g.fillRoundedRect(up.x - 28, up.y - 28, 56, 56, 8);
          ensure('drag_item', '18px', def.color || '#ffffff').setOrigin(0.5, 0.5).setPosition(up.x, up.y).setText(this.itemShortLabel(def.name));
        }
        const srcCell = (this.workshopItemRects || []).find(c => c.id === this.workshopDrag.itemId);
        if (srcCell) {
          g.lineStyle(2, 0xffffff, 0.9);
          g.strokeRoundedRect(srcCell.x, srcCell.y, srcCell.w, srcCell.h, 6);
        }
      }

      // 顶部提示
      if (this.workshopTip && this.time.now < this.workshopTip.until) {
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(710, 50, 500, 60, 8);
        ensure('tip', '24px', '#000000').setOrigin(0.5, 0.5).setPosition(960, 80).setText(this.workshopTip.text);
      } else if (labels.has('tip')) {
        labels.get('tip').setVisible(false);
      }
    }

    // ---------- 工坊交互辅助 ----------
    itemShortLabel(name) {
      return String(name || '').slice(0, 2);
    }

    drawItemSlot(g, x, y, w, h, itemId, textId, ensure, mask) {
      const t = ensure(textId, w >= 64 ? '16px' : '12px', '#000000');
      if (mask) t.setMask(mask);
      if (!itemId) {
        g.fillStyle(0x555555, 1);
        g.fillRoundedRect(x, y, w, h, 6);
        t.setVisible(false);
        return;
      }
      const def = ITEM_DEFS[itemId];
      const fillC = def?.color || '#ffffff';
      g.fillStyle(color(fillC), 1);
      g.fillRoundedRect(x, y, w, h, 6);
      g.lineStyle(1, 0x333333, 1);
      g.strokeRoundedRect(x, y, w, h, 6);
      const textC = this.isLightColor(fillC) ? '#000000' : '#ffffff';
      t.setFontSize(w >= 64 ? 16 : 12).setColor(textC).setOrigin(0.5, 0.5).setPosition(x + w / 2, y + h / 2).setText(this.itemShortLabel(def?.name)).setVisible(true);
    }

    isLightColor(hex) {
      const c = Phaser.Display.Color.HexStringToColor(hex || '#ffffff');
      return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 > 0.6;
    }

    drawItemCell(g, x, y, it, idx, ensure) {
      g.fillStyle(0x1a1a1a, 1);
      g.fillRoundedRect(x, y, 64, 64, 6);
      const def = it.def;
      g.fillStyle(color(def.color || '#ffffff'), 1);
      g.fillRoundedRect(x + 4, y + 4, 56, 56, 4);
      ensure(`inv_${idx}`, '18px', def.color || '#ffffff').setOrigin(0.5, 0.5).setPosition(x + 32, y + 32).setText(this.itemShortLabel(def.name));
      if (def.stackable && it.count > 1) {
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(x + 42, y + 42, 22, 22, 4);
        ensure(`inv_${idx}_c`, '14px', '#000000').setOrigin(0.5, 0.5).setPosition(x + 53, y + 53).setText(String(it.count));
      }
    }

    workshopInventoryItems(source, tab) {
      const stacks = source?.items?.stacks || {};
      const uniques = source?.items?.uniques || [];
      const out = [];
      if (tab === 'mod') {
        for (const [id, count] of Object.entries(stacks)) {
          const def = ITEM_DEFS[id];
          if (def && def.category === 'mod' && def.weapon === '') out.push({ id, def, count });
        }
        for (const u of uniques) {
          const def = ITEM_DEFS[u.itemId];
          if (def && def.category === 'mod') out.push({ id: u.itemId, def, count: 1 });
        }
      } else if (tab === 'relic') {
        for (const [id, count] of Object.entries(stacks)) {
          const def = ITEM_DEFS[id];
          if (def && def.category === 'relic') out.push({ id, def, count });
        }
      } else if (tab === 'pet') {
        for (const u of uniques) {
          const def = ITEM_DEFS[u.itemId];
          if (def && def.category === 'pet') out.push({ id: u.itemId, def, count: 1 });
        }
      }
      return out;
    }

    isValidWorkshopDrop(def, zone) {
      if (!def || !zone) return false;
      if (zone.slotType === 'weaponGeneric') return def.category === 'mod' && def.weapon === '';
      if (zone.slotType === 'weaponDedicated') return def.category === 'mod' && def.weapon === zone.weapon;
      if (zone.slotType === 'relic') return def.category === 'relic';
      if (zone.slotType === 'pet') return def.category === 'pet';
      return false;
    }

    workshopSlotContains(source, zone, itemId) {
      if (zone.slotType === 'weaponGeneric') {
        return (source?.equipment?.weaponMods?.[zone.weapon]?.generic || []).includes(itemId);
      }
      if (zone.slotType === 'weaponDedicated') {
        return source?.equipment?.weaponMods?.[zone.weapon]?.dedicated === itemId;
      }
      if (zone.slotType === 'relic') {
        return (source?.equipment?.relics || [])[zone.index] === itemId;
      }
      if (zone.slotType === 'pet') {
        return (source?.equipment?.pets || [])[zone.index] === itemId;
      }
      return false;
    }

    workshopRemoveFromInventory(source, itemId) {
      const def = ITEM_DEFS[itemId];
      if (!def) return false;
      source.items = source.items || { stacks: {}, uniques: [] };
      if (def.stackable) {
        const stacks = source.items.stacks || (source.items.stacks = {});
        const n = stacks[itemId] || 0;
        if (n <= 0) return false;
        stacks[itemId] = n - 1;
        if (stacks[itemId] <= 0) delete stacks[itemId];
        return true;
      }
      const uniques = source.items.uniques || (source.items.uniques = []);
      const idx = uniques.findIndex(u => u.itemId === itemId);
      if (idx < 0) return false;
      uniques.splice(idx, 1);
      return true;
    }

    workshopAddToInventory(source, itemId) {
      const def = ITEM_DEFS[itemId];
      if (!def) return;
      source.items = source.items || { stacks: {}, uniques: [] };
      if (def.stackable) {
        const stacks = source.items.stacks || (source.items.stacks = {});
        stacks[itemId] = (stacks[itemId] || 0) + 1;
      } else {
        const uniques = source.items.uniques || (source.items.uniques = []);
        uniques.push({ uid: `u-${itemId}-${Date.now()}`, itemId });
      }
    }

    workshopReplaceSlot(source, zone, itemId) {
      const old = [];
      source.equipment = source.equipment || { weaponMods: {}, relics: [], pets: [] };
      const wm = source.equipment.weaponMods || (source.equipment.weaponMods = {});
      if (zone.slotType === 'weaponGeneric') {
        const slot = wm[zone.weapon] || (wm[zone.weapon] = { generic: [], dedicated: null });
        const generic = Array.isArray(slot.generic) ? slot.generic : [];
        for (const id of generic) if (id) old.push(id);
        slot.generic = [itemId];
      } else if (zone.slotType === 'weaponDedicated') {
        const slot = wm[zone.weapon] || (wm[zone.weapon] = { generic: [], dedicated: null });
        if (slot.dedicated) old.push(slot.dedicated);
        slot.dedicated = itemId;
      } else if (zone.slotType === 'relic') {
        const relics = source.equipment.relics || (source.equipment.relics = []);
        if (zone.index < relics.length) {
          old.push(relics[zone.index]);
          relics[zone.index] = itemId;
        } else {
          relics.push(itemId);
        }
      } else if (zone.slotType === 'pet') {
        const pets = source.equipment.pets || (source.equipment.pets = []);
        if (zone.index < pets.length) {
          old.push(pets[zone.index]);
          pets[zone.index] = itemId;
        } else {
          pets.push(itemId);
        }
      }
      return old;
    }

    workshopEquipItem(drag, zone) {
      const source = this.saveSource();
      if (!source || !drag) return;
      const def = ITEM_DEFS[drag.itemId];
      if (!this.isValidWorkshopDrop(def, zone)) return;
      if (this.workshopSlotContains(source, zone, drag.itemId)) return;
      if (!this.workshopRemoveFromInventory(source, drag.itemId)) return;
      const old = this.workshopReplaceSlot(source, zone, drag.itemId);
      for (const id of old) this.workshopAddToInventory(source, id);
      if (this.player) {
        this.player.items = source.items;
        this.player.equipment = source.equipment;
      }
      this.persistSave(source);
      this.drawUI();
    }

    toggleWorkshopWeapon(type) {
      if (type === 'radial') return;
      const source = this.saveSource();
      if (!source) return;
      if (!source.weapons?.[type]?.unlocked) return;
      const level = source.progress?.level ?? 1;
      const load = Array.isArray(source.loadout) ? [...source.loadout] : ['radial'];
      while (load.length < 3) load.push('');
      load[0] = 'radial';
      const idx = load.indexOf(type);
      if (idx >= 1) {
        load[idx] = '';
      } else {
        let placed = false;
        for (let i = 1; i <= 2; i++) {
          if (level >= WEAPON_SLOT_LEVELS[i - 1] && !load[i]) {
            load[i] = type;
            placed = true;
            break;
          }
        }
        if (!placed) {
          this.showWorkshopTip('出战槽已满');
          return;
        }
      }
      source.loadout = load;
      if (this.player) this.player.loadout = [...load];
      this.persistSave(source);
      this.drawUI();
    }

    clickWorkshopSlot(n) {
      const source = this.saveSource();
      const level = source?.progress?.level ?? this.player?.level ?? 1;
      const lv = WEAPON_SLOT_LEVELS[n - 1];
      if (!lv) return;
      if (level < lv) this.showWorkshopTip(`该槽位将在 ${lv} 级解锁`);
    }

    showWorkshopTip(text) {
      this.workshopTip = { text, until: this.time.now + 2000 };
    }

    handleWorkshopPointerDown() {
      const up = this.uiPointer();
      const cells = this.workshopItemRects || [];
      for (const c of cells) {
        if (up.x >= c.x && up.x <= c.x + c.w && up.y >= c.y && up.y <= c.y + c.h) {
          this.workshopPress = {
            itemId: c.id,
            category: c.def.category,
            stackable: c.def.stackable,
            t0: this.time.now,
            x: up.x,
            y: up.y
          };
          return true;
        }
      }
      const area = this.workshopScrollArea;
      if (area && up.x >= area.x && up.x <= area.x + area.w && up.y >= area.y && up.y <= area.y + area.h) {
        const onCard = (this.workshopCardRects || []).some(r => up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h);
        if (!onCard) {
          this.workshopScrollDrag = { startX: up.x, scroll: this.workshopScroll || 0 };
          return true;
        }
      }
      return false;
    }

    updateWorkshopLongPress() {
      if (this.menuScreen !== 'workshop' || !this.workshopPress || this.workshopDrag) return;
      const up = this.uiPointer();
      if (Math.hypot(up.x - this.workshopPress.x, up.y - this.workshopPress.y) > 24) {
        this.workshopPress = null;
        return;
      }
      if (this.time.now - this.workshopPress.t0 >= 100) {
        this.workshopDrag = {
          itemId: this.workshopPress.itemId,
          category: this.workshopPress.category,
          stackable: this.workshopPress.stackable
        };
        this.workshopPress = null;
        this.drawUI();
      }
    }

    updateWorkshopScrollDrag() {
      if (!this.workshopScrollDrag) return;
      const up = this.uiPointer();
      const contentW = 5 * (280 + 24), viewW = 1312;
      const maxScroll = Math.max(0, contentW - viewW);
      this.workshopScroll = Phaser.Math.Clamp(this.workshopScrollDrag.scroll - (up.x - this.workshopScrollDrag.startX), 0, maxScroll);
    }

    handleWorkshopPointerUp() {
      if (this.workshopDrag) {
        const up = this.uiPointer();
        let zone = null;
        for (const z of this.workshopDropZones || []) {
          if (up.x >= z.x && up.x <= z.x + z.w && up.y >= z.y && up.y <= z.y + z.h) {
            zone = z;
            break;
          }
        }
        if (zone) this.workshopEquipItem(this.workshopDrag, zone);
        this.workshopDrag = null;
        this.drawUI();
      }
      this.workshopPress = null;
      this.workshopScrollDrag = null;
    }

    drawUI() {
      if (!this.uiG) return;
      this.uiG.clear();
      this.buttons = [];
      for (const map of Object.values(this.uiTexts || {})) {
        for (const t of map.values()) t.setVisible(false);
      }
      if (this.hudIndicatorText) this.hudIndicatorText.setVisible(false);
      for (const map of Object.values(this.uiImages || {})) {
        for (const s of map.values()) s.setVisible(false);
      }
      if (this.menuIconSprites) for (const s of this.menuIconSprites.values()) s.setVisible(false);
      if (this.settingsTexts) for (const t of this.settingsTexts.values()) t.setVisible(false);
      if (this.menuScreen !== 'workshop' && this.workshopTexts) {
        for (const t of this.workshopTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'weapon' && this.weaponShopTexts) {
        for (const t of this.weaponShopTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'vendor' && this.vendorShopTexts) {
        for (const t of this.vendorShopTexts.values()) t.setVisible(false);
      }
      if (!this.idolOffer && this.idolOfferTexts) {
        for (const t of this.idolOfferTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'saveSelect' && this.saveSelectTexts) {
        for (const t of this.saveSelectTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'levelSelect' && this.levelSelectTexts) {
        for (const t of this.levelSelectTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'levelSelect' && this.levelSelectOpen !== undefined) {
        this.levelSelectOpen = null;
      }
      if (this.menuScreen && this.loginLabels) {
        for (const label of this.loginLabels.values()) label.setVisible(false);
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
      if (this.idolOffer) {
        this.hideHudOverlay();
        this.drawIdolOffer();
        return;
      }
      if (this.settingsMode) {
        this.hideHudOverlay();
        this.drawSettingsOverlay();
        return;
      }
      if (this.menuScreen) {
        this.hideHudOverlay();
        this.uiG.fillStyle(0x000000, 1);
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
        if (this.menuScreen === 'weapon') this.drawWeaponShop(ui.weapon || {});
        else if (this.menuScreen === 'workshop') this.drawWorkshopUI();
        else if (this.menuScreen === 'vendor') this.drawVendorShop();
        else if (this.menuScreen === 'saveSelect') this.drawSaveSelectUI();
        else if (this.menuScreen === 'levelSelect') this.drawLevelSelect();
        // 右上角关闭按钮（黑底白线，悬停白底黑线）
        const bx0 = VIEW_W - 100, by0 = 40, bw0 = 64, bh0 = 48;
        const up0 = this.uiPointer();
        const cHover = up0.x >= bx0 && up0.x <= bx0 + bw0 && up0.y >= by0 && up0.y <= by0 + bh0;
        const scl0 = this.pressScale('menuClose');
        const cw0 = bw0 * scl0, ch0 = bh0 * scl0;
        const cx0 = bx0 + (bw0 - cw0) / 2, cy0 = by0 + (bh0 - ch0) / 2;
        this.uiG.fillStyle(cHover ? 0xffffff : 0x000000, 1);
        this.uiG.fillRoundedRect(cx0, cy0, cw0, ch0, 6);
        this.uiG.lineStyle(2, cHover ? 0x000000 : 0xffffff, 1);
        this.uiG.strokeRoundedRect(cx0, cy0, cw0, ch0, 6);
        this.uiG.lineStyle(3, cHover ? 0x000000 : 0xffffff, 1);
        this.uiG.lineBetween(cx0 + cw0 * 0.31, cy0 + ch0 * 0.29, cx0 + cw0 * 0.69, cy0 + ch0 * 0.71);
        this.uiG.lineBetween(cx0 + cw0 * 0.69, cy0 + ch0 * 0.29, cx0 + cw0 * 0.31, cy0 + ch0 * 0.71);
        this.buttons.push({ id: 'menuClose', x: bx0, y: by0, w: bw0, h: bh0 });
      } else if (this.isMenuLevel()) {
        this.hideHudOverlay();
        if (this.intro) {
          // 开场动画：HUD 全部隐藏，只留虫洞
          for (const map of Object.values(this.uiTexts || {})) {
            for (const t of map.values()) t.setVisible(false);
          }
          for (const map of Object.values(this.uiImages || {})) {
            for (const s of map.values()) s.setVisible(false);
          }
          if (this.loginLabels) {
            for (const label of this.loginLabels.values()) label.setVisible(false);
          }
          // 全黑阶段覆盖黑屏
          if (this.intro.phase === 'black') {
            this.uiG.fillStyle(0x000000, 1);
            this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
          }
        } else {
          renderGraph(this.uiG, ui.login, this.uiState, BINDINGS, { texts: this.uiTexts?.login, images: this.uiImages?.login, buttons: this.buttons });
          this.drawLoginButtons();
        }
      } else if (this.state === 'paused' || this.state === 'end' || interfaceLevel) {
        this.hideHudOverlay();
        renderGraph(this.uiG, ui.interface, this.uiState, BINDINGS, { texts: this.uiTexts?.interface, images: this.uiImages?.interface, buttons: this.buttons });
      } else if (this.isHubLevel()) {
        // 骑士之家：不显示战斗 HUD
        this.hideHudOverlay();
      } else {
        renderGraph(this.uiG, ui.battle, this.uiState, BINDINGS, { texts: this.uiTexts?.battle, images: this.uiImages?.battle, buttons: this.buttons });
        if (this.player) this.drawHud();
        this.drawHudIndicator();
      }

      if (this.transition) {
        this.uiG.fillStyle(0x000000, this.transition.alpha);
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
      }
      if (this.levelIntro) {
        const progress = Math.min(1, this.levelIntro.t / this.levelIntro.duration);
        this.uiG.fillStyle(0x000000, 1 - Math.pow(progress, 2.4));
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
      this.drawSettingsButton(g);
      this.drawChargeBars(g);
    }

    drawChargeBars(g) {
      const p = this.player;
      if (!p?.weaponCharge) return;
      const types = ['yellow', 'green'];
      let y = 960;
      for (const type of types) {
        const c = p.weaponCharge[type];
        if (!c) continue;
        const x = 24, w = 180, h = 12;
        g.fillStyle(0x222222, 1);
        g.fillRect(x, y, w, h);
        const ratio = c.need > 0 ? Math.min(1, c.have / c.need) : 0;
        g.fillStyle(color(WEAPONS[type]?.ringColor || '#ffffff'), 1);
        g.fillRect(x, y, w * ratio, h);
        y -= 24;
      }
    }

    drawSettingsButton(g) {
      const bx = VIEW_W - 88, by = 28, bw = 64, bh = 64;
      this.settingsButtonRect = { x: bx, y: by, w: bw, h: bh };
      const up = this.uiPointer();
      const hover = up.x >= bx && up.x <= bx + bw && up.y >= by && up.y <= by + bh;
      const scl = this.pressScale('settingsBtn');
      const cw = bw * scl, ch = bh * scl;
      const cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2;
      g.fillStyle(hover ? 0xffffff : 0x000000, 0.55);
      g.fillRoundedRect(cx, cy, cw, ch, 10);
      g.lineStyle(2, 0xffffff, 1);
      g.strokeRoundedRect(cx, cy, cw, ch, 10);
      const spr = this.iconSprite('settings', ICON_SETTINGS);
      if (spr) {
        spr.setPosition(bx + bw / 2, by + bh / 2);
        spr.setDisplaySize(40, 40);
        spr.setVisible(true);
      }
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
        this.ammoCurrent.setFontFamily(FONT_TECH);
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

    // ---------- 武器页 / 工坊页（全屏 UI 覆盖层） ----------
    openMenuScreen(screen) {
      if (this.editing || this.menuScreen) return;
      this.menuScreen = screen;
      if (this.state === 'playing') { this.prevState = 'playing'; this.state = 'paused'; }
      else this.prevState = null;
    }

    closeMenuScreen() {
      if (!this.menuScreen) return;
      this.menuScreen = null;
      if (this.prevState === 'playing') { this.state = 'playing'; this.prevState = null; }
    }

    // ---------- 战斗 HUD 设置菜单（暂停蒙层） ----------
    openSettingsOverlay() {
      if (this.editing || this.settingsMode) return;
      this.settingsMode = 'menu';
      if (this.state === 'playing') { this.settingsPrev = 'playing'; this.state = 'paused'; }
      else this.settingsPrev = null;
      this.drawUI();
    }

    closeSettingsOverlay() {
      if (!this.settingsMode) return;
      this.settingsMode = null;
      if (this.settingsPrev === 'playing') { this.state = 'playing'; this.settingsPrev = null; }
      this.drawUI();
    }

    retryBattle() {
      this.closeSettingsOverlay();
      this.restart();
    }

    exitToHome() {
      this.settingsMode = null;
      this.settingsPrev = null;
      ctx.onOpenLevel?.('knight-home');
    }

    drawSettingsOverlay() {
      const g = this.uiG;
      g.fillStyle(0x000000, 0.82);
      g.fillRect(0, 0, VIEW_W, VIEW_H);

      const ensure = (id, size, color) => {
        let t = this.settingsTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.settingsTexts.set(id, t);
        }
        t.setFontSize(size).setColor(color).setVisible(true);
        return t;
      };

      if (this.settingsMode === 'confirm') {
        const pw = 640, ph = 340, px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
        g.fillStyle(0x0d1b2d, 0.98);
        g.fillRoundedRect(px, py, pw, ph, 12);
        g.lineStyle(2, 0x6fd3ff, 1);
        g.strokeRoundedRect(px, py, pw, ph, 12);
        ensure('tips1', '28px', '#ffffff').setOrigin(0.5).setPosition(VIEW_W / 2, py + 78).setText('确定退出吗？');
        ensure('tips2', '22px', '#9fc3d8').setOrigin(0.5).setPosition(VIEW_W / 2, py + 150).setText('已经获得的钻石无法带出');

        const bw = 200, bh = 60, gap = 60, by = py + 230;
        const total = bw * 2 + gap;
        const sx = (VIEW_W - total) / 2;
        for (const [id, label] of [['cancel', '取消'], ['confirm', '确定']]) {
          const i = id === 'cancel' ? 0 : 1;
          const bx = sx + i * (bw + gap);
          const scl = this.pressScale(`settings_${id}`);
          const cw = bw * scl, ch = bh * scl;
          const cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2;
          g.fillStyle(id === 'confirm' ? 0xffffff : 0x123047, 1);
          g.fillRoundedRect(cx, cy, cw, ch, 8);
          g.lineStyle(2, id === 'confirm' ? 0x000000 : 0x6fd3ff, 1);
          g.strokeRoundedRect(cx, cy, cw, ch, 8);
          ensure(`btn_${id}`, '24px', id === 'confirm' ? '#000000' : '#ffffff').setOrigin(0.5).setPosition(bx + bw / 2, by + bh / 2).setText(label);
          this.buttons.push({ id: `settings_${id}`, x: bx, y: by, w: bw, h: bh });
        }
        return;
      }

      ensure('title', '38px', '#ffffff').setOrigin(0.5).setPosition(VIEW_W / 2, 220).setText('设置');
      const items = [
        { id: 'exit', label: '退出', src: ICON_EXIT },
        { id: 'retry', label: '再来一次', src: ICON_RETRY },
        { id: 'continue', label: '继续', src: ICON_CONTINUE }
      ];
      const bw = 230, bh = 260, gap = 80;
      const total = bw * 3 + gap * 2;
      const startX = (VIEW_W - total) / 2;
      const by = 360;
      items.forEach((item, i) => {
        const bx = startX + i * (bw + gap);
        const scl = this.pressScale(`settings_${item.id}`);
        const cw = bw * scl, ch = bh * scl;
        const cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2;
        g.fillStyle(0x0d1b2d, 0.9);
        g.fillRoundedRect(cx, cy, cw, ch, 12);
        g.lineStyle(2, 0x6fd3ff, 1);
        g.strokeRoundedRect(cx, cy, cw, ch, 12);
        const spr = this.iconSprite(item.id, item.src);
        if (spr) {
          spr.setPosition(bx + bw / 2, by + 86);
          spr.setDisplaySize(84, 84);
          spr.setVisible(true);
        }
        ensure(`btn_${item.id}`, '28px', '#ffffff').setOrigin(0.5).setPosition(bx + bw / 2, by + 200).setText(item.label);
        this.buttons.push({ id: `settings_${item.id}`, x: bx, y: by, w: bw, h: bh });
      });
    }

    onUIPointer(p) {
      const up = this.uiPointer();
      const px = up.x, py = up.y;
      for (const b of this.buttons) {
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          if (b.id === 'menuClose') { this.pressAnim('menuClose'); this.closeMenuScreen(); }
          else if (b.id === 'close') this.toggleGrowth();
          else if (b.id === 'settings_exit') { this.pressAnim(b.id); this.settingsMode = 'confirm'; this.drawUI(); }
          else if (b.id === 'settings_retry') { this.pressAnim(b.id); this.retryBattle(); }
          else if (b.id === 'settings_continue') { this.pressAnim(b.id); this.closeSettingsOverlay(); }
          else if (b.id === 'settings_confirm') { this.pressAnim(b.id); this.exitToHome(); }
          else if (b.id === 'settings_cancel') { this.pressAnim(b.id); this.settingsMode = 'menu'; this.drawUI(); }
          else if (b.id && b.id.startsWith('upgrade_')) { this.pressAnim(b.id); this.applyUpgrade(b.id.slice(8)); }
          else if (b.id && b.id.startsWith('buyWeapon_')) { this.pressAnim(b.id); this.buyWeapon(b.id.slice(10)); }
          else if (b.id && b.id.startsWith('buyMod_')) { this.pressAnim(b.id); this.buyMod(b.id.slice(7)); }
          else if (b.id && b.id.startsWith('buyBuff_')) { this.pressAnim(b.id); this.buyBuff(b.id.slice(8)); }
          else if (b.id && b.id.startsWith('idolCard_')) { this.pressAnim(b.id); this.chooseIdolBuff(Number(b.id.slice(9))); }
          else if (b.id && b.id.startsWith('workshopCard_')) { this.pressAnim(b.id); this.toggleWorkshopWeapon(b.id.slice(13)); }
          else if (b.id && b.id.startsWith('workshopTab_')) { this.pressAnim(b.id); this.workshopTab = b.id.slice(12); this.drawUI(); }
          else if (b.id && b.id.startsWith('workshopSlot_')) { this.pressAnim(b.id); this.clickWorkshopSlot(Number(b.id.slice(13))); }
          else if (b.id && b.id.startsWith('selectSave_')) { this.pressAnim(b.id); ctx.onSelectSave?.(b.id.slice(11)); }
          else if (b.id && b.id.startsWith('levelBig_')) {
            this.pressAnim(b.id);
            const n = b.node?.n;
            this.levelSelectOpen = this.levelSelectOpen === n ? null : n;
          }
          else if (b.id && b.id.startsWith('levelSmall_')) { this.pressAnim(b.id); ctx.onOpenLevel?.(b.node?.levelId); }
          else if (b.id === 'saveSelectBack') { this.pressAnim('saveSelectBack'); this.closeMenuScreen(); }
          return;
        }
      }
    }

    // 按钮按下缩放动画：记录按下时间，绘制时按剩余时间缩小
    pressAnim(id, duration = 120) {
      this.pressAnims = this.pressAnims || {};
      this.pressAnims[id] = { until: this.time.now + duration, dur: duration };
    }

    pressScale(id) {
      const a = this.pressAnims?.[id];
      if (!a) return 1;
      const remain = a.until - this.time.now;
      if (remain <= 0) { delete this.pressAnims[id]; return 1; }
      const k = remain / a.dur;
      return 0.85 + 0.15 * (1 - k);
    }

    applyUpgrade(key) {
      const cfg = UPGRADE_STATS[key];
      if (!cfg || !this.menuScreen) return;
      const source = this.saveSource();
      const spendable = this.player.spendablePoints ?? 0;
      const spent = (this.player.points?.[key] ?? 0);
      if (spendable <= 0 || spent >= cfg.cap) return;

      // 写入玩家运行时 + 存档源
      this.player.points = { ...this.player.points, [key]: spent + 1 };
      this.player.spendablePoints = spendable - 1;
      this.player.combat = { ...this.player.combat, [key]: (this.player.combat[key] ?? 0) + cfg.per };
      if (key === 'maxHp') this.player.maxHp = this.player.combat.maxHp;
      if (key === 'maxShield') this.player.maxShield = this.player.combat.maxShield;

      if (source) {
        source.combat = { ...this.player.combat };
        source.points = { ...this.player.points };
        source.progress = { ...(source.progress || {}), points: this.player.spendablePoints };
        this.persistSave(source);
      }
      this.syncUIState();
      this.drawUI();
    }

    // 存档数据源：预览用临时数据，试玩/正式用真实存档（试玩为测试存档）
    saveSource() {
      if (this.isPreviewMode()) return ctx.state.previewPlayer;
      return ctx.state.player;
    }

    // 预览模式不写回存档；编辑器不写玩家存档；试玩/正式写存档
    persistSave(source) {
      if (this.editing || this.isPreviewMode() || !source) return;
      ctx.onPlayerSave?.(source);
    }

    // ---------- 武器商店页 ----------
    drawWeaponShop(node) {
      const g = this.uiG;
      const source = this.saveSource();
      const weapons = node.weapons || ['radial', 'yellow', 'green'];
      const prices = node.prices || {};
      const modPrices = node.modPrices || {};
      const gold = source?.currency?.gold ?? 0;
      const current = this.uiState.weaponType || 'radial';
      const x = node.x || 80, y = node.y || 150;
      const w = node.w || 650, h = node.h || 760;
      const cardW = node.cardW || 170, cardH = node.cardH || 260;
      const listX = node.listX || 820, listY = node.listY || 390;
      const gap = node.gap || 28;

      this.weaponShopTexts = this.weaponShopTexts || new Map();
      const ensure = (id, size, colorStr = '#ffffff') => {
        let t = this.weaponShopTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color: colorStr }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.weaponShopTexts.set(id, t);
        }
        t.setFontSize(size).setColor(colorStr).setVisible(true);
        return t;
      };

      // 主展示区
      drawParallelogram(g, x, y, w, h, node.skew || 42, 1, '#ffffff', '#ffffff');
      drawWeaponGlyph(g, x + 300, y + 220, current, false, 110);
      ensure('gold', '24px', '#ffd54f').setOrigin(0, 0.5).setPosition(x + 40, y + 40).setText(`金币  ${gold}`);

      // 武器卡片
      for (let i = 0; i < weapons.length; i++) {
        const type = weapons[i];
        const unlocked = !!source?.weapons?.[type]?.unlocked;
        const cx = listX + i * (cardW + gap) + cardW / 2;
        const cy = listY;
        const cardFill = unlocked ? '#ffffff' : '#555555';
        drawParallelogram(g, cx - cardW / 2, cy, cardW, cardH, 24, 1, cardFill, cardFill);
        drawWeaponGlyph(g, cx, cy + 92, type, !unlocked, 34);
        if (!unlocked) {
          drawLock(g, cx, cy + 150);
          const price = prices[type];
          if (price != null) {
            const bw = 120, bh = 40, bx = cx - bw / 2, by = cy + cardH - 56;
            const canBuy = gold >= price;
            g.fillStyle(canBuy ? 0xffffff : 0x444444, 1);
            g.fillRoundedRect(bx, by, bw, bh, 6);
            g.lineStyle(1, 0xffffff, 1);
            g.strokeRoundedRect(bx, by, bw, bh, 6);
            ensure(`buy_${type}`, '18px', canBuy ? '#000000' : '#999999').setOrigin(0.5, 0.5).setPosition(bx + bw / 2, by + bh / 2).setText(`购买 ${price}`);
            this.buttons.push({ id: `buyWeapon_${type}`, x: bx, y: by, w: bw, h: bh, node: { type, price } });
          }
        } else {
          ensure(`owned_${type}`, '18px', '#ffffff').setOrigin(0.5, 0.5).setPosition(cx, cy + 150).setText('已拥有');
        }
      }

      // 改件商店（右侧）
      const mods = Object.entries(MOD_DEFS);
      const modX = 1460, modY0 = 150;
      const owned = new Set();
      for (const [id, itemDef] of Object.entries(ITEM_DEFS)) {
        if (itemDef.category !== 'mod') continue;
        const has = itemDef.stackable
          ? (source?.items?.stacks?.[id] ?? 0) > 0
          : (source?.items?.uniques || []).some(u => u.itemId === id);
        if (has) owned.add(id);
      }
      ensure('modTitle', '24px', '#ffffff').setOrigin(0, 0.5).setPosition(modX, modY0).setText('改件商店');
      let my = modY0 + 64;
      for (const [id, def] of mods) {
        const price = modPrices[id];
        const isOwned = owned.has(id);
        if (isOwned) {
          ensure(`mod_${id}`, '18px', '#4fc3f7').setOrigin(0, 0.5).setPosition(modX, my).setText(`${def.name}（已拥有）`);
        } else if (price != null) {
          const bw = 300, bh = 36, bx = modX, by = my - bh / 2;
          const canBuy = gold >= price;
          g.fillStyle(canBuy ? 0xffffff : 0x444444, 1);
          g.fillRoundedRect(bx, by, bw, bh, 6);
          g.lineStyle(1, 0xffffff, 1);
          g.strokeRoundedRect(bx, by, bw, bh, 6);
          const tag = def.weapon ? `专属·${WEAPON_LABELS[def.weapon] || def.weapon}` : '通用';
          ensure(`mod_${id}`, '16px', canBuy ? '#000000' : '#999999').setOrigin(0, 0.5).setPosition(bx + 12, by + bh / 2).setText(`${def.name} ${price}金 ${tag}`);
          this.buttons.push({ id: `buyMod_${id}`, x: bx, y: by, w: bw, h: bh, node: { id, price } });
        }
        my += 52;
      }
    }

    // 购买武器：扣金币 + 解锁武器并写回存档
    buyWeapon(type) {
      const source = this.saveSource();
      const node = ctx.state.ui?.weapon || {};
      const price = (node.prices || {})[type];
      if (price == null || !source) return;
      if ((source.currency?.gold ?? 0) < price) return;
      if (source.weapons?.[type]?.unlocked) return;
      source.currency.gold -= price;
      if (source.weapons?.[type]) source.weapons[type].unlocked = true;
      if (this.player) {
        this.player.gold = source.currency.gold;
        if (Array.isArray(this.player.weapons) && !this.player.weapons.includes(type)) {
          this.player.weapons.push(type);
          this.player.ammo = this.player.ammo || {};
          this.player.ammo[type] = WEAPONS[type]?.maxAmmo ?? Infinity;
        }
      }
      this.syncUIState();
      this.persistSave(source);
    }

    // 购买改件：扣金币 + 加入改件库存并写回存档
    buyMod(id) {
      const source = this.saveSource();
      const node = ctx.state.ui?.weapon || {};
      const price = (node.modPrices || {})[id];
      const def = ITEM_DEFS[id];
      if (price == null || !source || !def) return;
      if ((source.currency?.gold ?? 0) < price) return;
      source.currency = source.currency || { gold: 0 };
      source.items = source.items || { stacks: {}, uniques: [] };
      if (def.stackable) {
        const stacks = source.items.stacks || (source.items.stacks = {});
        stacks[id] = (stacks[id] || 0) + 1;
      } else {
        const uniques = source.items.uniques || (source.items.uniques = []);
        if (uniques.some(u => u.itemId === id)) return;
        uniques.push({ uid: `u-${id}`, itemId: id });
      }
      source.currency.gold -= price;
      if (this.player) {
        this.player.gold = source.currency.gold;
        this.player.items = source.items;
      }
      this.syncUIState();
      this.persistSave(source);
    }

    // ---------- 存档选择界面 ----------
    openSaveSelect() {
      this.saveSlots = null;
      this.saveSlotsLoading = true;
      this.saveSlotsError = false;
      this.openMenuScreen('saveSelect');
      ctx.onListSaves?.()
        .then(res => {
          if (!this.scene || !this.scene.isActive()) return;
          this.saveSlots = res || { slots: [], metas: {} };
          this.saveSlotsLoading = false;
          this.drawUI();
        })
        .catch(() => {
          if (!this.scene || !this.scene.isActive()) return;
          this.saveSlots = { slots: [], metas: {} };
          this.saveSlotsLoading = false;
          this.saveSlotsError = true;
          this.drawUI();
        });
    }

    drawSaveSelectUI() {
      const g = this.uiG;
      const slots = ['save-1', 'save-2', 'save-3'];
      const metas = this.saveSlots?.metas || {};

      this.saveSelectTexts = this.saveSelectTexts || new Map();
      const ensure = (id, size, colorStr = '#ffffff') => {
        let t = this.saveSelectTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color: colorStr }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.saveSelectTexts.set(id, t);
        }
        t.setFontSize(size).setColor(colorStr).setVisible(true);
        return t;
      };

      ensure('title', '32px', '#ffffff').setOrigin(0.5, 0.5).setPosition(VIEW_W / 2, 140).setText('选择存档');
      if (this.saveSlotsError) {
        ensure('error', '18px', '#e84c5e').setOrigin(0.5, 0.5).setPosition(VIEW_W / 2, 220).setText('读取存档列表失败');
      }

      const cardW = 420, cardH = 240, gap = 50;
      const totalW = slots.length * cardW + (slots.length - 1) * gap;
      const startX = (VIEW_W - totalW) / 2;
      const cardY = 320;

      slots.forEach((id, i) => {
        const meta = metas[id];
        const cx = startX + i * (cardW + gap);
        const has = !!meta;
        g.fillStyle(has ? 0x0e2233 : 0x111111, 0.95);
        g.fillRoundedRect(cx, cardY, cardW, cardH, 10);
        g.lineStyle(2, has ? 0x2f5a7a : 0x333333, 1);
        g.strokeRoundedRect(cx, cardY, cardW, cardH, 10);

        if (this.saveSlotsLoading) {
          ensure(`slot_${id}`, '20px', '#9fc3d8').setOrigin(0.5, 0.5).setPosition(cx + cardW / 2, cardY + cardH / 2).setText('读取中…');
        } else if (has) {
          ensure(`slot_${id}_name`, '22px', '#ffffff').setOrigin(0, 0.5).setPosition(cx + 24, cardY + 44).setText(`存档 ${i + 1} · ${meta.name || '未命名'}`);
          ensure(`slot_${id}_level`, '18px', '#9fc3d8').setOrigin(0, 0.5).setPosition(cx + 24, cardY + 96).setText(`等级 ${meta.level ?? 1}`);
          const updated = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : '未知';
          ensure(`slot_${id}_time`, '14px', '#666666').setOrigin(0, 0.5).setPosition(cx + 24, cardY + 138).setText(`更新 ${updated}`);
          ensure(`slot_${id}_sel`, '16px', '#ffd54f').setOrigin(0, 0.5).setPosition(cx + 24, cardY + cardH - 40).setText('点击进入');
          this.buttons.push({ id: `selectSave_${id}`, x: cx, y: cardY, w: cardW, h: cardH, node: { id } });
        } else {
          ensure(`slot_${id}_empty`, '20px', '#555555').setOrigin(0.5, 0.5).setPosition(cx + cardW / 2, cardY + cardH / 2).setText(`存档 ${i + 1} · 空`);
        }
      });

      const by = cardY + cardH + 60;
      ensure('back', '18px', '#9fc3d8').setOrigin(0.5, 0.5).setPosition(VIEW_W / 2, by).setText('返回登录界面');
      this.buttons.push({ id: 'saveSelectBack', x: VIEW_W / 2 - 110, y: by - 30, w: 220, h: 60, node: {} });
    }

    // ---------- 登录主界面按钮 ----------
    loginButtons() {
      // 存档是否存在：以是否存在任意存档栏位判定
      const hasSave = !!ctx.state.hasAnySave;
      const defs = [
        { id: 'new', label: '新游戏' },
        { id: 'continue', label: '继续游戏', hidden: !hasSave },
        { id: 'weapon', label: '武器' },
        { id: 'workshop', label: '工坊' },
        { id: 'settings', label: '设置' }
      ];
      const visible = defs.filter(b => !b.hidden);
      const startY = 700, h = 66, gap = 22;
      return visible.map((b, i) => ({
        id: b.id,
        label: b.label,
        y: startY + i * (h + gap),
        w: 420,
        h
      }));
    }

    loginButtonRect(id) {
      return this.loginButtons().find(b => b.id === id) || null;
    }

    drawLoginButtons() {
      const g = this.uiG;
      const up = this.uiPointer();
      const hoverId = this.loginHoverId;
      this.loginButtonRects = {};
      if (!this.loginLabels) this.loginLabels = new Map();

      for (const b of this.loginButtons()) {
        const x = 120, y = b.y, w = b.w, h = b.h;
        this.loginButtonRects[b.id] = { x, y, w, h };

        const hovered = hoverId === b.id;
        const hoverT = this.loginHoverT != null ? Math.min(1, this.loginHoverT) : 1;
        const scl = this.pressScale(b.id);
        const dw = w * scl, dh = h * scl;
        const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;

        // 常态：透明背景无边框；悬停：白色平行四边形从左向右渐变（无边框）
        if (hovered) {
          const maskW = dw * hoverT;
          const skew = 28 * scl;
          g.fillStyle(0xffffff, 1);
          g.beginPath();
          g.moveTo(dx + skew, dy);
          g.lineTo(dx + skew + maskW, dy);
          g.lineTo(dx + maskW, dy + dh);
          g.lineTo(dx, dy + dh);
          g.closePath();
          g.fillPath();
        }

        // 按钮文字：左对齐，悬停（选中态）变黑色
        let label = this.loginLabels.get(b.id);
        if (!label) {
          label = this.add.text(0, 0, b.label, {
            fontFamily: FONT_TECH_SC,
            fontSize: '28px', color: '#ffffff'
          }).setOrigin(0, 0.5).setDepth(1002);
          this.cameras.main.ignore(label);
          this.loginLabels.set(b.id, label);
        }
        label.setPosition(dx + 32 * scl, dy + dh / 2);
        label.setColor(hovered ? '#000000' : '#ffffff');
        label.setVisible(true);
        label.setFontSize(`${Math.round(28 * scl)}px`);

        this.buttons.push({ id: b.id, x, y, w, h, node: b });
      }

      // 隐藏未使用的标签
      const active = new Set(this.loginButtons().map(b => b.id));
      for (const [id, label] of this.loginLabels) {
        if (!active.has(id)) label.setVisible(false);
      }
    }

    updateLoginHover() {
      if (!this.isMenuLevel() || this.menuScreen) {
        this.loginHoverId = null;
        this.loginHoverT = null;
        return;
      }
      const up = this.uiPointer();
      let target = null;
      for (const id in this.loginButtonRects) {
        const r = this.loginButtonRects[id];
        if (up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h) {
          target = id;
          break;
        }
      }
      if (target !== this.loginHoverId) {
        this.loginHoverId = target;
        this.loginHoverT = 0;
      } else if (this.loginHoverId && this.loginHoverT < 1) {
        this.loginHoverT = (this.loginHoverT || 0) + 0.09;
      }
    }

    onLoginButtonClick(id) {
      if (id === 'new') {
        // 登录页暂时跳过虫洞入场动画，保留 startIntro 供后续启用
        ctx.onStartNew?.();
      } else if (id === 'continue') {
        this.openSaveSelect();
      } else if (id === 'weapon') {
        this.openMenuScreen('weapon');
      } else if (id === 'workshop') {
        this.openMenuScreen('workshop');
      } else if (id === 'settings') {
        ctx.onSettings?.();
      }
    }

    startIntro() {
      if (this.intro) return;
      this.intro = { t: 0, phase: 'fly' };
    }

    updateIntro(dt) {
      if (!this.intro) return;
      const it = this.intro;
      it.t += dt / 1000;
      const fx = ctx.state.level?.background || {};
      const pause = fx.introPause ?? INTRO_BLACK_PAUSE;

      if (it.phase === 'fly') {
        // 判断所有环是否超出屏幕：最内环半径 > 屏幕对角线
        const minFactor = wormholeMinRadiusFactor(fx.rings || 1);
        const minR = (fx.radius || 0) * minFactor * introGrowScale(it.t, fx);
        if (minR > Math.hypot(VIEW_W, VIEW_H)) {
          it.phase = 'black';
          it.blackT = 0;
        }
      } else if (it.phase === 'black') {
        it.blackT += dt / 1000;
        if (it.blackT >= pause) {
          this.intro = null;
          ctx.onStartNew?.();
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
      const x = this.player ? this.player.x : w / 2;
      const y = this.player ? this.player.y : h / 2;
      // 扩展边界，使玩家在中心模式下可在世界任意位置被镜头居中
      const pad = 2000;
      this.cameras.main.setBounds(Math.min(0, x - pad), Math.min(0, y - pad), w + pad * 2, h + pad * 2);
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
      if (this.isMenuLevel()) {
        // 菜单关卡：镜头固定展示全图（与编辑器一致）
        cam.scrollX = 0;
        cam.scrollY = 0;
      } else {
        cam.scrollX = this.player.x - cam.width / 2;
        cam.scrollY = this.player.y - cam.height / 2;
      }
    }

    updatePlayCamera() {
      const cam = this.cameras.main;
      const z = this.playZoom();
      cam.setZoom(z);

      if (this.isMenuLevel()) {
        // 菜单关卡：镜头固定展示全图（与编辑器一致）
        cam.scrollX = 0;
        cam.scrollY = 0;
        return;
      }

      if (ctx.state.level.camera.mode === 'center') {
        // 始终居中玩家
        cam.scrollX = this.player.x - cam.width / 2;
        cam.scrollY = this.player.y - cam.height / 2;
        return;
      }

      // deadzone 死区跟随（Phaser4：相机中心 = scroll + 视口/2，死区尺寸按可见世界算）
      const displayW = cam.width / z;
      const displayH = cam.height / z;
      const dzW = displayW / 3, dzH = displayH / 3;
      let cx = cam.scrollX + cam.width / 2;
      let cy = cam.scrollY + cam.height / 2;

      if (this.player.x < cx - dzW) cx = this.player.x + dzW;
      else if (this.player.x > cx + dzW) cx = this.player.x - dzW;
      if (this.player.y < cy - dzH) cy = this.player.y + dzH;
      else if (this.player.y > cy + dzH) cy = this.player.y - dzH;

      cam.scrollX = cam.clampX(cx - cam.width / 2);
      cam.scrollY = cam.clampY(cy - cam.height / 2);
    }

    onWheel(px, py, deltaY) {
      if (!this.editing) {
        if (this.menuScreen === 'workshop') {
          const up = this.uiPointer();
          const area = this.workshopScrollArea || { x: 544, y: 120, w: 1312, h: 380 };
          if (up.x >= area.x && up.x <= area.x + area.w && up.y >= area.y && up.y <= area.y + area.h) {
            const contentW = 5 * (280 + 24), viewW = 1312;
            const maxScroll = Math.max(0, contentW - viewW);
            if (this.workshopScroll == null) this.workshopScroll = 0;
            this.workshopScroll = Phaser.Math.Clamp(this.workshopScroll + (deltaY > 0 ? 40 : -40), 0, maxScroll);
            this.drawUI();
          }
          return;
        }
        if (this.state === 'playing' && this.player?.weapons?.length > 1) {
          this.switchWeapon(deltaY > 0 ? 1 : -1);
        }
        return;
      }
      const cam = this.cameras.main;
      if (!cam || !cam.width) return;
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
      const weapon = WEAPONS[weaponType];
      if (!weapon) return;
      this.player.weaponType = weaponType;
      this.player.weapon = weapon;
      this.player.scheme = weapon.scheme;
      this.wheelAnim = { from, to, t: 0, dur: 500 };
      this.syncUIState();
    }
  };
}
