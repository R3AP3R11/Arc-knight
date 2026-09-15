/**
 * 重装机兵（heavy-mech）数据契约与表现常量（分类：战斗相关）
 *
 * 行为：生成时头部（画板美术方案顶部的尖）朝玩家 → 冷却期朝玩家缓慢逼近 →
 *       瞄准（两条蓝色瞄准线从蓝色多边形出发，夹角由 spreadDeg 以 aimSpeed 收拢，
 *       中心跟随头部方向）→ 夹角收成一条线时**锁定方向** → 停顿 fireDelay（玩家的躲避窗口）
 *       → 发射激光（逐渐变粗 → 保持 → 逐渐变细到消失，伤害在发射瞬间单次结算）。
 *
 * 运行时落在 enemy-ai.js（stepHeavyMech / heavyMechFireLaser / updateEnemyLasers），
 * 渲染落在 systems/ui/heavy-mech-art.js。
 *
 * 本模块**不 import Phaser / geometry.js**（geometry 经 Phaser 间接依赖，node 下无法加载），
 * 以保持纯 JS、可被 state.js 安全静态引用（node --test 会加载 state.js）。
 */

// 画板美术方案「重装机兵」（data/assets/asset-1789394201289，
// 元素 [0]=顶部尖头白色轮廓 [1]=蓝色多边形）
export const HEAVY_MECH_ART = 'asset-1789394201289';

// 编辑器可配数值（存关卡 enemy.mech），键名即契约名，不可改名
export const HEAVY_MECH_DEFAULTS = {
  moveSpeed: 40,      // 移动速度(px/s)：冷却期朝玩家缓慢逼近
  rotateSpeed: 120,   // 旋转速度(°/s)：头部转向玩家的角速度
  aimSpeed: 25,       // 瞄准速度(°/s)：两条瞄准线夹角收拢的角速度（spreadDeg → 0）
  fireDelay: 600,     // 开枪延迟(ms)：夹角收成一条线后的停顿（方向已锁定，可被横向走位躲开）
  fireInterval: 4000  // 射击间隔(ms)：一次射击结束后到下次开始瞄准的冷却
};

// 激光与瞄准线表现常量（代码常量，不进编辑器面板）
export const HEAVY_MECH_LASER = {
  spreadDeg: 25,      // 瞄准线初始夹角(°)
  width: 26,          // 激光满宽(px，世界单位；随 artScale 放大)
  growMs: 180,        // 发射：逐渐变粗时长(ms)
  holdMs: 300,        // 满宽保持时长(ms)
  fadeMs: 320,        // 消散：逐渐变细到消失时长(ms)
  muzzleOffset: 60,   // 激光起点沿头部方向的偏移（设计稿头顶尖到中心的距离，×artScale）
  sightStart: 20,     // 瞄准线起点沿瞄准方向的偏移（蓝色多边形半径，×artScale）
  color: '#5cf4ff'    // 瞄准线 / 激光颜色（与画板蓝色多边形同色）
};

// ── 瞄准线（两条蓝线）的运行时契约 ──
// 瞄准线是**无限长**的：只被墙体（level.walls + bulletGateWalls）与关卡世界边界截断，没有长度上限。
// 端点由战斗侧每帧算好写进 `e.sightLines`（enemy-ai.js:stepHeavyMech，仅 aim/align 相位），渲染端
// （ui/heavy-mech-art.js:drawHeavyMechSight）只按它画，不做任何几何计算：
//   `e.sightLines = [{ x0, y0, x1, y1 }, { x0, y0, x1, y1 }]`   // 左/右两条，起点同为蓝色多边形边缘

// 归一化：补全全部键（非数字值回落到默认值）
export function normalizeHeavyMechConfig(mech = {}) {
  const src = (mech && typeof mech === 'object') ? mech : {};
  const out = {};
  for (const key of Object.keys(HEAVY_MECH_DEFAULTS)) {
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) && n >= 0 ? n : HEAVY_MECH_DEFAULTS[key];
  }
  return out;
}
