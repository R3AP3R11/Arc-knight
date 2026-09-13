// ============================================================
// 武器「内圈环链 + 出场渐显」纯逻辑（叶子模块，不依赖 Phaser）。
// 职责：以武器「最内侧元素」（任意形状：三角形/多边形/圆弧/轮廓都行）为样板，向内递归复制一连串副本
//   （每次半径 / 厚度 / 径向位置 ×ratio）；仅在相机放大到 minZoom 以上时生成环链，再按「屏幕绝对厚度 ≥ minPx」
//   （判据用固定参考缩放 chainRefScale = minZoom）剔除放大后仍不可见的细环——被剔除者既不渲染、也不占出场时间片，
//   且可见集合不随当帧 zoom 变化，放大过程中整体一次出现（战斗 zoom≈1 时完全不生成，观感与迭代前一致）；
//   最后把「保留的链环 + 全部原有元素」按有效外径升序排成出场顺序，并提供逐元素的渐显进度计算。
// 分类：引擎-编辑器（画板衍生）
// 主要导出：weaponElementExtent, elementThickness, innermostElement, ringChainActive, chainRefScale, buildRingChain, buildWeaponRevealList, revealAlphaAt
// ============================================================
import { WEAPON_RING_CHAIN } from '../constants.js';

// 数值兜底：非法值走默认
function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }

// 元素有效外径（design 单位）：arc = |orbitRadius| + radius + lineWidth/2；
// polygon = |orbitRadius| + radius + lineWidth/2；stroke = |orbitRadius| + 点集最大半径 + lineWidth/2；pixel 用 cols/rows/cellSize 估。
export function weaponElementExtent(el) {
  if (!el || typeof el !== 'object') return 0;
  const orbit = Math.abs(num(el.orbitRadius, 0));
  const halfLw = Math.abs(num(el.lineWidth, 0)) / 2;
  const shape = el.shape;
  if (shape === 'pixel') {
    const cols = num(el.cols, 12);
    const rows = num(el.rows, 12);
    const cell = num(el.cellSize, 8);
    return orbit + Math.hypot((cols / 2) * cell, (rows / 2) * cell) + halfLw;
  }
  if (shape === 'stroke') {
    let maxR = 0;
    if (Array.isArray(el.points)) {
      for (const p of el.points) {
        const r = Math.hypot(num(p?.x, 0), num(p?.y, 0));
        if (r > maxR) maxR = r;
      }
    }
    return orbit + maxR + halfLw;
  }
  // arc / polygon
  return orbit + Math.abs(num(el.radius, 0)) + halfLw;
}

// 元素「厚度」：优先取描边宽度；无描边（lineWidth=0）时退化为半径（实心形体的尺寸即其厚度）。
export function elementThickness(el) {
  if (!el || typeof el !== 'object') return 0;
  const lw = Math.abs(num(el.lineWidth, 0));
  return lw > 0 ? lw : Math.abs(num(el.radius, 0));
}

// 环链样板：最内侧元素（按有效外径，不限定形状 —— 散射武器的最内侧是三角形，环链就应是三角形）。
// 优先级：①最内侧「描边型」元素（fill 为空）—— 黑色实心块当样板会让环链变成看不见的实心块，
//          且会被更晚绘制、更大的同形状父元素整个盖住（散射的黑三角 / 激光的黑 20 边形就是这种情况）；
//        ②最内侧「有描边宽度」元素；③最内侧元素（全填充外形如 ball() 时兜底）。
export function innermostElement(elements) {
  if (!Array.isArray(elements)) return null;
  let best = null, bestExtent = Infinity;        // 最内侧元素（兜底）
  let solid = null, solidExtent = Infinity;      // 最内侧「有描边宽度」元素
  let stroke = null, strokeExtent = Infinity;    // 最内侧「描边型」元素（fill 为空）
  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;
    const ext = weaponElementExtent(el);
    if (ext < bestExtent) { bestExtent = ext; best = el; }
    if (Math.abs(num(el.lineWidth, 0)) > 0 && ext < solidExtent) { solidExtent = ext; solid = el; }
    if (!el.fill && ext < strokeExtent) { strokeExtent = ext; stroke = el; }
  }
  return stroke || solid || best;
}

// 链环「屏幕绝对厚度」判据的参考缩放：固定取 refZoom（运镜典型放大倍数），而不是当帧 zoom。
// 原因：若用当帧 zoom，放大过程中每个链环会在不同时刻依次跨过 1px 阈值 → 环一个接一个冒出来
//   （快速运镜时表现为「生成变慢 + 撕裂」）。固定参考后可见集合只由配置决定、与当帧 zoom 无关：
//   相机一旦越过 minZoom，该显示的几个环**一次性整体出现**，全程稳定。
export function chainRefScale(refZoom = WEAPON_RING_CHAIN.refZoom) {
  return num(refZoom, WEAPON_RING_CHAIN.refZoom);
}

// 环链开关：只有相机放大到 minZoom 以上（运镜 / 大幅缩放）才生成环链。
// 战斗 zoom≈1（蓄力最高 1.6）时无论样板环多粗都不生成，保证战斗观感与迭代前一致。
export function ringChainActive(screenScale, minZoom = WEAPON_RING_CHAIN.minZoom) {
  const s = Number(screenScale);
  return Number.isFinite(s) && s >= num(minZoom, WEAPON_RING_CHAIN.minZoom);
}

// 生成环链副本（不含样板）：第 i 个（i 从 1 起）半径 / 厚度 ×ratio^i，径向位置 orbitRadius 同步收缩，
// 其余字段浅拷贝继承（shape/sides/count/color/fill/rotSpeed/phase/dir/offsetX/offsetY/arcStart/arcEnd/pattern/...），
// 所以「三角形样板的环链就是三角形」，且旋转 / 摆动与样板同步。返回 [{ el, isChain: true, chainIndex: i }]，不修改传入的 baseEl。
export function buildRingChain(baseEl, count, ratio) {
  if (!baseEl || typeof baseEl !== 'object') return [];
  const n = Math.max(0, Math.floor(num(count, 0)));
  const q = num(ratio, WEAPON_RING_CHAIN.ratio);
  const baseRadius = num(baseEl.radius, 0);
  const baseLineWidth = num(baseEl.lineWidth, 0);
  const baseOrbit = num(baseEl.orbitRadius, 0);
  const baseCell = num(baseEl.cellSize, 0);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const f = Math.pow(q, i);
    const el = { ...baseEl, radius: baseRadius * f, lineWidth: baseLineWidth * f, orbitRadius: baseOrbit * f };
    if (baseCell > 0) el.cellSize = baseCell * f;
    out.push({ el, isChain: true, chainIndex: i });
  }
  return out;
}

// 出场渲染列表：elements 为设计稿元素数组（已归一化）。
// opts = { scale = 1, designScale = 1, screenScale = 1, chainCount, chainRatio, minPx, minZoom, refZoom }
//   scale      = 本次渲染的 scale（如 player.artScale）
//   designScale= design.scale
//   screenScale= 相机 zoom（世界渲染时传 cameras.main.zoom，UI 预览传 1）—— 只用于 minZoom 开关
// 步骤：找最内侧元素 → 生成链环 → 屏幕厚度 = lineWidth × scale × designScale × chainRefScale(refZoom)，
//       < minPx 的丢弃（**必须在排序/编号之前丢弃**，保证被剔除者不占出场时间片）；
//       再与全部原有元素合并，按 weaponElementExtent 升序排序（同值用原数组下标 tie-break）。
// 返回 [{ el, extent, isChain, index }]，index = 在返回数组中的下标（供出场计时用），数组即最终出场顺序。
export function buildWeaponRevealList(elements, opts = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const scale = num(opts.scale, 1);
  const designScale = num(opts.designScale, 1);
  const screenScale = num(opts.screenScale, 1);
  const chainCount = num(opts.chainCount, WEAPON_RING_CHAIN.count);
  const chainRatio = num(opts.chainRatio, WEAPON_RING_CHAIN.ratio);
  const minPx = num(opts.minPx, WEAPON_RING_CHAIN.minPx);

  const base = innermostElement(list);
  const minZoom = num(opts.minZoom, WEAPON_RING_CHAIN.minZoom);
  const chain = (base && ringChainActive(screenScale, minZoom)) ? buildRingChain(base, chainCount, chainRatio) : [];

  // 屏幕绝对厚度剔除：判据用固定参考缩放 chainRefScale（= refZoom），不用当帧 screenScale，
  // 这样可见集合与当帧 zoom 无关 → 越过 minZoom 时整体一次出现，不会在放大途中逐个冒出来。
  const pxFactor = scale * designScale * chainRefScale(opts.refZoom);
  const combined = [];
  for (const item of chain) {
    if (elementThickness(item.el) * pxFactor < minPx) continue;
    combined.push({ el: item.el, isChain: true });
  }
  for (const el of list) combined.push({ el, isChain: false });

  // 稳定排序：按 extent 升序，同值用原数组下标 tie-break
  const indexed = combined.map((item, i) => ({ el: item.el, isChain: item.isChain, extent: weaponElementExtent(item.el), ord: i }));
  indexed.sort((a, b) => (a.extent - b.extent) || (a.ord - b.ord));

  return indexed.map((item, index) => ({ el: item.el, extent: item.extent, isChain: item.isChain, index }));
}

// 出场渐显进度：第 index 个元素在 index*stepMs 开始，用 fadeMs 从 0 线性升到 1。
// 未开始或 elapsedMs 非有限值时返回 0；已过渐显结束返回 1；结果 clamp 到 [0,1]。
export function revealAlphaAt(elapsedMs, index, stepMs = WEAPON_RING_CHAIN.stepMs, fadeMs = WEAPON_RING_CHAIN.fadeMs) {
  const t = Number(elapsedMs);
  if (!Number.isFinite(t)) return 0;
  const step = num(stepMs, WEAPON_RING_CHAIN.stepMs);
  const fade = num(fadeMs, WEAPON_RING_CHAIN.fadeMs);
  const idx = Math.max(0, Math.floor(num(index, 0)));
  const start = idx * step;
  if (t < start) return 0;
  if (fade <= 0) return 1;
  return Math.max(0, Math.min(1, (t - start) / fade));
}
