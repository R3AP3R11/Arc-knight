// ============================================================
// 售货机图标：按 (美术方案类型, 美术方案名称) 从三个美术库解析出可渲染 design。
// 分类：UI / 美术解析（局内售货机页面）
// 主要导出：resolveArtRef, preloadArtRefs, getArtRef, invertDesign, drawShopIcon,
//          isNearWhite, blackVariant, whiteVariant, shopIconVariant
// ============================================================

import {
  listAssets, loadAsset, listOutlines, loadOutline, listPixels, loadPixel
} from '../../api.js';
import {
  normalizeDesign, normalizeElement, normalizeOutline, drawDesignCentered, designBounds
} from '../art/asset-render.js';

const designCache = new Map(); // `${artType}|${artName}` -> design（含 null）
const listCache = new Map();   // artType -> Promise<[{id,name}]>

const LISTERS = {
  '动态资产': { list: listAssets, key: 'assets', load: loadAsset },
  '轮廓': { list: listOutlines, key: 'outlines', load: loadOutline },
  '像素': { list: listPixels, key: 'pixels', load: loadPixel }
};

function loadList(artType) {
  const spec = LISTERS[artType];
  if (!spec) return Promise.resolve([]);
  if (!listCache.has(artType)) {
    const p = spec.list()
      .then(res => ((res && res[spec.key]) || [])
        .map(a => typeof a === 'string' ? { id: a, name: a } : a)
        .filter(a => a && a.id))
      .catch(() => []);
    listCache.set(artType, p);
  }
  return listCache.get(artType);
}

function matchId(list, artName) {
  const name = String(artName ?? '');
  const hit = list.find(a => a.name === name)
    || list.find(a => String(a.name ?? '').trim() === name.trim());
  return hit ? hit.id : null;
}

// 静态归位：drawDesignCentered 的位置锚点是 design 原点，而 renderAsset 会加 center*scale。
// 把 center 设成「负的包围盒中心」即可让包围盒中心落在给定 (cx, cy)（缩放仍按包围盒 → 居中且不超框）。
function recenter(d) {
  if (!d || typeof d !== 'object') return d;
  const b = designBounds(d, 0);
  d.center = { x: -(b.minX + b.maxX) / 2, y: -(b.minY + b.maxY) / 2 };
  return d;
}

function toDesign(artType, raw) {
  if (artType === '动态资产') return recenter(normalizeDesign(raw));
  if (artType === '轮廓') {
    const o = normalizeOutline(raw);
    return recenter(normalizeDesign({
      elements: [normalizeElement({
        shape: 'stroke', points: o.points, color: o.color, lineWidth: o.lineWidth,
        closed: o.closed, fill: o.fill, rotSpeed: 0, phase: 0, orbitRadius: 0
      })]
    }));
  }
  if (artType === '像素') return recenter(normalizeDesign({ elements: [normalizeElement(raw)] }));
  return null;
}

export function resolveArtRef(artType, artName) {
  const key = `${artType}|${artName}`;
  if (designCache.has(key)) return Promise.resolve(designCache.get(key));
  const spec = LISTERS[artType];
  if (!spec) return Promise.resolve(null);
  return loadList(artType).then(list => {
    if (designCache.has(key)) return designCache.get(key);
    const id = matchId(list, artName);
    if (!id) { designCache.set(key, null); return null; }
    return spec.load(id)
      .then(raw => { const d = toDesign(artType, raw); designCache.set(key, d); return d; })
      .catch(() => { designCache.set(key, null); return null; });
  }).catch(() => { designCache.set(key, null); return null; });
}

export function preloadArtRefs(refs) {
  return Promise.all((refs || []).map(r => resolveArtRef(r?.artType, r?.artName))).then(() => {});
}

export function getArtRef(artType, artName) {
  return designCache.get(`${artType}|${artName}`) ?? null;
}

function invertHex(v) {
  if (typeof v !== 'string' || !v.startsWith('#')) return v;
  const n = parseInt(v.slice(1), 16);
  if (Number.isNaN(n)) return v;
  return '#' + (0xffffff - n).toString(16).padStart(6, '0');
}

export function invertDesign(design) {
  if (!design || typeof design !== 'object') return design;
  const d = structuredClone(design);
  for (const el of (Array.isArray(d.elements) ? d.elements : [])) {
    if (!el || typeof el !== 'object') continue;
    if (el.color) el.color = invertHex(el.color);
    if (el.fill) el.fill = invertHex(el.fill);
    if (el.gridColor) el.gridColor = invertHex(el.gridColor);
    if (Array.isArray(el.cells)) for (const c of el.cells) { if (c && c.color) c.color = invertHex(c.color); }
  }
  return d;
}

export function drawShopIcon(g, design, cx, cy, boxSize, t = 0, invert = false) {
  if (!design) return;
  drawDesignCentered(g, invert ? invertDesign(design) : design, cx, cy, boxSize, t);
}

// ── 白卡/黑卡可见性：纯白图标在白卡上不可见 → 换黑色款；黑卡上按设计反色（白色款除外） ──

// 解析颜色字符串为 [r,g,b]（0~255）；无法识别返回 null。兼容 #rgb / #rrggbb / rgba(...)。
function parseRgb(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(h)) return null;
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
    if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return null;
  }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

// 遍历 design 中所有「可见颜色」字符串：element 的 color / fill / gridColor（非空才取）、cells[].color。
function* visibleColors(design) {
  for (const el of (Array.isArray(design?.elements) ? design.elements : [])) {
    if (!el || typeof el !== 'object') continue;
    if (el.color) yield el.color;
    if (el.fill) yield el.fill;
    if (el.gridColor) yield el.gridColor;
    if (Array.isArray(el.cells)) for (const c of el.cells) if (c && c.color) yield c.color;
  }
}

// 所有可见颜色都「每通道 >= 0.85（0~1）」→ true；无颜色可取时 false。
export function isNearWhite(design) {
  if (!design || typeof design !== 'object') return false;
  let seen = false;
  for (const v of visibleColors(design)) {
    const rgb = parseRgb(v);
    if (!rgb) continue;
    seen = true;
    if (!rgb.every(c => c / 255 >= 0.85)) return false;
  }
  return seen;
}

// 深拷贝并把所有非空颜色统一换成黑色（保留形状/线宽/points/cells 结构与 center）。
export function blackVariant(design) {
  if (!design || typeof design !== 'object') return design;
  const d = structuredClone(design);
  for (const el of (Array.isArray(d.elements) ? d.elements : [])) {
    if (!el || typeof el !== 'object') continue;
    if (el.color) el.color = '#000000';
    if (el.fill) el.fill = '#000000';
    if (el.gridColor) el.gridColor = '#000000';
    if (Array.isArray(el.cells)) for (const c of el.cells) if (c && c.color) c.color = '#000000';
  }
  return d;
}

// 深拷贝并把所有非空颜色统一换成白色（保留形状/线宽/points/cells 结构与 center）。
export function whiteVariant(design) {
  if (!design || typeof design !== 'object') return design;
  const d = structuredClone(design);
  for (const el of (Array.isArray(d.elements) ? d.elements : [])) {
    if (!el || typeof el !== 'object') continue;
    if (el.color) el.color = '#ffffff';
    if (el.fill) el.fill = '#ffffff';
    if (el.gridColor) el.gridColor = '#ffffff';
    if (Array.isArray(el.cells)) for (const c of el.cells) if (c && c.color) c.color = '#ffffff';
  }
  return d;
}

// 依卡片底色取「直接可绘制」的 design：
//   白卡（darkCard=false）：近白图标 → 黑色款，否则原样；
//   黑卡（darkCard=true）：近白图标 → 原样（反色会变黑不可见），否则反色。
export function shopIconVariant(design, darkCard) {
  if (!design || typeof design !== 'object') return design;
  const white = isNearWhite(design);
  if (!darkCard) return white ? blackVariant(design) : design;
  return white ? design : invertDesign(design);
}
