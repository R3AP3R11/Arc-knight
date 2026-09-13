// ============================================================
// 全局共享纯数据常量：视图尺寸、字体、贴图键、实体尺寸与玩家美术参数。
// 分类：共享常量（无逻辑，仅数值 / 字符串 / 纯数据对象）
// 主要导出：VIEW_W, VIEW_H, CELL, FONT_TECH(_SC), CRATE_*, BARREL_*, CHEST_*, PORTAL_*, VENDOR_*, IDOL_*, PLAYER_ART*, PLAYER_LEAN, SHIELD*, BULLET_DAMAGE, HIT_FX_TTL, ENEMY_RED, ENEMY_BEHAVIOR, GATE_*, ROTATE_HANDLE_OFFSET
// ============================================================


// ── 视图与网格 / 字体 / 实体贴图与尺寸 ──
export const VIEW_W = 1920, VIEW_H = 1080, CELL = 30;
// 科技风格字体（Orbitron 已由 index.html 引入）
export const FONT_TECH = "'Orbitron', 'Rajdhani', 'Poppins', sans-serif";
export const FONT_TECH_SC = "'Noto Sans SC', 'Orbitron', sans-serif";
// ── 关卡结算页 ──
export const SETTLE_SUCCESS_COLOR = '#33ff33';   // 撤离成功标题与过关球绿
export const SETTLE_FAIL_COLOR = '#ff3b3b';      // 撤离失败标题红
export const SETTLE_BALL_R = 42;                 // 进度球半径（对应设计 7px*6）
export const CRATE_SIZE = 50;
export const CRATE_BORDER_THICKNESS = 8;
export const CRATE_INSET = 7;
export const BARREL_RADIUS = 30;
export const BARREL_ICON = '/barrel.png';
export const BARREL_TEX_KEY = '__barrel__';
export const CHEST_CLOSED_KEY = '__chest_closed__';
export const CHEST_OPEN_KEY = '__chest_open__';
export const CHEST_TEX_KEY = '__chest_tex__';
export const CHEST_SIZE = 75;           // 宝箱显示尺寸（无碰撞体积，透明背景）
export const CHEST_OPEN_SCALE_CORRECTION = 1005 / 852; // 开启态内容更窄，按内容宽比补偿到与常态同宽
export const CHEST_OPEN_FX_MS = 320;    // 开启金色十字星特效时长（更快）
export const CHEST_SPAWN_FX_MS = 260;   // 出现金色十字星特效时长
export const PORTAL_COLOR = 0x00ffff;   // 传送门主体色（青）
export const PORTAL_ALPHA = 0.6;        // 传送门整体透明度（对应图标 opacity 60）
export const PORTAL_LABEL = 'EVACUATION';
export const VENDOR_TEX_KEY = '__vendor__';
export const VENDOR_ICON = '/vending.png';
export const IDOL_TEX_KEY = '__idol__';
export const IDOL_ICON = '/idol.png';

// ── 桶 / 木箱 / 玩家美术 ──
export const BARREL_DAMAGE = 30;
export const BARREL_EXPLOSION_MS = 100;
export const CRATE_DEBRIS_TTL = 450;
export const PLAYER_ART_SCALE = 0.5;
export const PLAYER_ART = {
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
export const PLAYER_COLLISION_RADIUS = PLAYER_ART.weaponRingRadius + PLAYER_ART.weaponRingThickness;

// ── 玩家倾斜与护盾 ──
export const PLAYER_LEAN = { hex: 12, inner: 9, middle: 7, outer: 5, speed: 48 };

// ── 武器内圈环链 / 出场动画 ──
export const WEAPON_RING_CHAIN = {
  count: 120,     // 以「最内侧元素」为样板向内递归复制的个数（不含样板本身）
  ratio: 0.75,    // 每个副本的半径 / 厚度 / 径向位置 = 前一个 × 此值
  minPx: 1,      // 链环屏幕绝对厚度 < 1px 时不渲染、且不占出场时间片（按 refZoom 折算）
  minZoom: 1.8,  // 相机 zoom 低于此值（战斗 zoom≈1、蓄力最高 1.6）完全不生成环链，保证战斗观感不变
  refZoom: 3.5,  // 厚度判据的参考相机缩放：固定值 → 可见集合稳定，放大途中不会逐个冒出来变成「慢慢生成」
  stepMs: 100,   // 出场：每 0.1s 启动下一个元素
  fadeMs: 100    // 出场：每个元素自身 0.1s 渐显
};
export const SHIELD = { color: '#00eeff', arcDeg: 120, gap: 10, fadeMs: 500 };
export const SHIELD_MAX = 50;
export const SHIELD_SHAKE_MS = 150;
export const SHIELD_SHAKE_INTENSITY = 0.004;
export const SHIELD_HIT_COLOR = 0x00eeff;

// ── 武器卡片「图标背景」固定动态资产（data/assets/asset-1788442424562，名称「武器图标背景」）──
export const WEAPON_BG_ASSET = 'asset-1788442424562';

// ── 伤害与命中特效 ──
export const BULLET_DAMAGE = 10;
export const HIT_FX_TTL = 100;
export const HIT_FX_RADIUS = 40;      // 命中特效在世界层的绘制半径

// ── 敌人 ──
export const ENEMY_RED = 0xff3b3b;
export const ENEMY_BEHAVIOR = {
  basic1: { size: 30, approach: 200, engage: 50, engageDelay: 0.4, colorRange: 300, orbit: null, charge: null, spin: 0, onEnterOrbit: { minDur: 0.5, maxDur: 1, minDeg: 60, maxDeg: 120 } },
  basic2: { size: 30, approach: 200, engage: 50, engageDelay: 0.4, colorRange: 300, orbit: { period: 2, duration: 1, degPerSec: 30 }, charge: null, spin: 4 },
  advanced1: { size: 48, approach: 200, engage: 160, engageDelay: 0.4, colorRange: 200, orbit: { period: 1, duration: 0.5, degPerSec: 80 }, charge: { pause: 0.6, speed: 200 }, spin: 0, lineWidth: 6 },
  advanced2: { size: 40, attackRange: 500, fireInterval: 400, burstInterval: 3000, burstCount: 3, speed: 30, dormantSpin: 20, orbitMin: 30, orbitMax: 40, growDuration: 0.5, orbit: null, charge: null, spin: 0, onEnterOrbit: null },
  mothership: { size: 260, speed: 30, spawnInterval: 5000, spawnRadius: 220, orbit: null, charge: null, onEnterOrbit: null, spin: 0 },
  // 原型机-2-5T5（Boss）：不走通用行为机，行为在 systems/combat/boss25t5.js（size 用于碰撞半径 r=80）
  'boss-2-5t5': { size: 160, orbit: null, charge: null, onEnterOrbit: null, spin: 0 }
};

// 母舰本体周身投放敌人：等概率随机抽取一组，按 count 逐个在母舰身周落点生成
export const MOTHERSHIP_SPAWN_TABLE = [
  { type: 'basic1', count: 5 },
  { type: 'basic2', count: 6 },
  { type: 'advanced1', count: 2 },
  { type: 'advanced2', count: 1 }
];

// ── 编辑器手柄与闸门（Gate）外观 ──
export const ROTATE_HANDLE_OFFSET = 28;
export const GATE_SPAWN_MS = 500;
export const GATE_OUTER_COLOR = '#ffa200';
export const GATE_INNER_COLOR = '#ffa200';
export const GATE_OFFSET_RATIO = 0.14;
