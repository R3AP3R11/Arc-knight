/**
 * 重装机兵（heavy-mech）渲染（分类：UI交互）
 *
 * 1) 本体：设计稿整体按头部朝向旋转 —— 设计稿顶部的尖 = 头，默认朝上(-π/2)，
 *    故相位偏转 head + π/2 后尖即指向 headAngle（与母舰同一口径）。
 * 2) 瞄准线：瞄准/停顿阶段从蓝色多边形边缘沿头部方向 ± 夹角/2 画两条同色线
 *    （夹角由 enemy-ai.js 的瞄准状态机收拢，收成一条线后即为单线瞄准）。
 *    **线无限长、只被墙体截断** → 端点由战斗侧每帧算好写在 `e.sightLines`（见 combat/heavy-mech.js
 *    的「瞄准线运行时契约」），本模块只按坐标画、不做任何几何计算。
 * 3) 激光：this.enemyLasers 的静态光束（发射瞬间定好起止点），宽度由状态机推进。
 *
 * 依赖：systems/art/asset-render.js（renderAsset / hexToInt）；
 * 不 import entity-art.js（避免与其互相 import 成环，颜色用 hexToInt 转）。
 */
import { renderAsset, hexToInt } from '../art/asset-render.js';
import { HEAVY_MECH_LASER } from '../combat/heavy-mech.js';

// 瞄准线（e.firePhase === 'aim' | 'align' 时才画；端点由战斗侧算好，align 阶段夹角已为 0 → 视觉上是一条线）
export function drawHeavyMechSight(g, e, alpha = 1) {
  if (e.firePhase !== 'aim' && e.firePhase !== 'align') return;
  const lines = e.sightLines;
  if (!lines || !lines.length) return;
  g.lineStyle(2, hexToInt(HEAVY_MECH_LASER.color), 0.85 * alpha);
  for (const l of lines) g.lineBetween(l.x0, l.y0, l.x1, l.y1);
}

// 本体（design 未加载时返回 false → 调用方回落到默认敌人形状）
export function drawHeavyMechBody(g, e, design, target, t = 0, alpha = 1) {
  if (!design) return false;
  const head = e.headAngle != null ? e.headAngle
    : (target ? Math.atan2(target.y - e.y, target.x - e.x) : -Math.PI / 2);
  drawHeavyMechSight(g, e, alpha);
  const facing = head + Math.PI / 2;
  renderAsset(g, {
    ...design,
    elements: design.elements.map(el => ({ ...el, phase: (el.phase || 0) + facing }))
  }, e.x, e.y, t, e.artScale || 1, undefined, alpha);
  return true;
}

// 激光光束（发射瞬间已定好 x0,y0→x1,y1 与受墙裁剪的终点）
export function drawHeavyMechBeams(g, beams) {
  if (!beams || !beams.length) return;
  for (const bs of beams) {
    if (!(bs.width > 0)) continue;
    g.lineStyle(bs.width, hexToInt(bs.color || HEAVY_MECH_LASER.color), 0.9);
    g.lineBetween(bs.x0, bs.y0, bs.x1, bs.y1);
  }
}
