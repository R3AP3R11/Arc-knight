// ============================================================
// 玩家武器本体渲染入口（设计稿矢量 + 内圈环链 + 出场渐显）。
// 职责：把武器设计稿按「出场顺序」逐元素绘制——链环按屏幕厚度剔除后与原有元素一起按外径升序渐显；
//   elapsedMs 不传 / 传 Infinity 表示已完全出场（全部 alpha=1）。供 entity-art.js 的 drawPlayer 调用。
// 分类：引擎-编辑器（画板衍生）
// 主要导出：renderWeaponBody
// ============================================================
import { normalizeDesign, renderElement } from './asset-render.js';
import { buildWeaponRevealList, revealAlphaAt } from './weapon-ring-chain.js';
import { WEAPON_RING_CHAIN } from '../constants.js';

// 渲染玩家武器本体（设计稿矢量），带「内圈环链 + 出场渐显」。
// opts = { motion = null, screenScale = 1, elapsedMs = Infinity, chain = WEAPON_RING_CHAIN, alpha = 1 }
//   elapsedMs = Infinity（或不传）表示已完全出场（alpha 全 1）
export function renderWeaponBody(g, design, x, y, t = 0, scale = 1, opts = {}) {
  const d = normalizeDesign(design);
  const s = scale * d.scale;
  const cx0 = x + d.center.x * s, cy0 = y + d.center.y * s;

  const chain = opts.chain || WEAPON_RING_CHAIN;
  const screenScale = Number.isFinite(Number(opts.screenScale)) ? Number(opts.screenScale) : 1;
  const elapsedMs = opts.elapsedMs == null ? Infinity : opts.elapsedMs;
  // elapsedMs 非有限（Infinity）= 已完全出场，直接 alpha 1；否则按出场计时
  const revealed = !Number.isFinite(Number(elapsedMs));
  const baseAlpha = Number.isFinite(Number(opts.alpha)) ? Number(opts.alpha) : 1;

  const list = buildWeaponRevealList(d.elements, {
    scale,
    designScale: d.scale,
    screenScale,
    chainCount: chain.count,
    chainRatio: chain.ratio,
    minPx: chain.minPx
  });

  // 绘制顺序：原有元素先、链环后 —— 链环在最内侧，若直接按外径升序画，会被更晚绘制的不透明填充体
  // （如散射中心的黑色实心三角）整块盖住，看起来像「新生成的链环被抹掉」。出场计时仍按 item.index
  // （外径升序，链环在最前），所以改的只是 z 序，出场动画时序不变。
  const drawOne = (item) => {
    const a = revealed ? 1 : revealAlphaAt(elapsedMs, item.index, chain.stepMs, chain.fadeMs);
    if (a <= 0) return;
    renderElement(g, item.el, cx0, cy0, t, s, opts.motion, a * baseAlpha);
  };
  for (const item of list) if (!item.isChain) drawOne(item);
  for (const item of list) if (item.isChain) drawOne(item);
}