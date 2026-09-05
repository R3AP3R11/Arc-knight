// ============================================================
// 独立画板（画板工作台的轮廓绘制弹层）。
// 职责：#artDrawBoard 弹层全部交互 —— 加点/选点编辑（拖动/方向键/XY/删除）、
//       参考图形与轮廓库（参考底图/转为轮廓点）、画笔样式、整条变换、
//       保存轮廓（/api/outlines）；由 artboard.js 接线打开，完成后回调 onDone。
// 分类：引擎编辑器需求
// 导出：openDrawBoard, closeDrawBoard, isDrawBoardOpen
// ============================================================
import { listOutlines, loadOutline, saveOutline, deleteOutline } from '../api.js';
import { setStatus } from '../ui.js';
import { normalizeElement, normalizeOutline } from '../systems/art/asset-render.js';

// ── 会话态（openDrawBoard 打开时初始化，closeDrawBoard 清空）──
let boardDom = null;         // 当前弹层 dom（getDom 产物，事件 handler 内取用）
let boardDesign = null;      // 打开时传入的设计稿引用（handler 内重新按下标取元素，见坑18）
let boardHooks = {};         // { getSelectedIndex, onDone, onSaved }
let drawBoardOpen = false;   // 弹层是否打开（keydown 首行守卫，坑17）
let drawSnapOn = true;       // 网格吸附开关（#drawSnap）
let drawPoints = [];         // 轮廓点（相对画板圆心）
let drawTargetIndex = null;  // 正在编辑的 stroke 元素下标；null = 完成后新建
let drawMode = 'add';        // 'add' 加点 | 'select' 选择 | 'fill' 填充
let selectedPointIndex = -1; // 选中点下标；-1 = 无
let lastAdded = -1;          // 最近加点在 drawPoints 的下标；-1=无（供 Ctrl+Z 精准退点）
let dragPoint = null;        // 拖拽态 { index } | null
let selectedSet = new Set(); // 多选（框选/复制移动）：点下标集合；selectedPointIndex 为锚点
let marquee = null;          // 框选矩形（画布绝对坐标）{x0,y0,x1,y1} | null
let clipboard = null;        // 复制缓冲 { points, edges, cx, cy } | null
let refShapes = [];          // 参考底图 [{ points: [{x,y}] }]
let drawStyle = { color: '#ffa914', lineWidth: 4, closed: false, fillColor: '#ffa914', fill: null };
let drawEdges = [];          // 已连线段 [[fromIndex,toIndex],...]：只在「选中点→新点」时记录，非选中落点无边
const GRID = 30;             // 方格板吸附步长（与预览网格一致）

// ── 边驱动辅助：只在「选中点→新点」间记边；载入/图形转点重建顺序全连边；退点/删点清理并重排边索引 ──
function addEdge(a, b) {
  if (a < 0 || b < 0 || a === b) return;
  if (!drawEdges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) drawEdges.push([a, b]);
}
function rebuildFullEdges(closed) {
  const n = drawPoints.length, es = [];
  for (let i = 0; i < n - 1; i++) es.push([i, i + 1]);
  if (closed && n >= 3) es.push([n - 1, 0]);
  return es;
}
function removePointByIndex(idx) {
  drawPoints.splice(idx, 1);
  drawEdges = drawEdges
    .filter(([a, b]) => a !== idx && b !== idx)
    .map(([a, b]) => [a > idx ? a - 1 : a, b > idx ? b - 1 : b]);
}
// 返回「沿边链遍历的顺序下标」（按连通分量贪心串接 + 孤立点补尾）。
// 供 buildPolyline 取点序，也供保存轮廓时把边索引重映射到该点序（保证点+边无损还原）。
function polylineSeq(points, edges) {
  if (!points.length) return [];
  if (!edges.length) return points.map((_, i) => i);
  const n = points.length;
  const adj = new Map();
  for (let i = 0; i < n; i++) adj.set(i, []);
  for (const [a, b] of edges) {
    if (a >= 0 && b >= 0 && a < n && b < n && a !== b) { adj.get(a).push(b); adj.get(b).push(a); }
  }
  const used = new Set(), seq = [];
  for (let s = 0; s < n; s++) {
    if (used.has(s) || !adj.get(s).length) continue;
    let cur = s;
    while (cur >= 0 && !used.has(cur)) {
      used.add(cur); seq.push(cur);
      let nxt = -1;
      for (const t of adj.get(cur)) if (!used.has(t)) { nxt = t; break; }
      cur = nxt;
    }
  }
  for (let i = 0; i < n; i++) if (!used.has(i)) { used.add(i); seq.push(i); }
  return seq;
}

// 写回转折线：按顺序下标取点；不再退化为 drawPoints 原始顺序（那会把分离/孤立点串成「一堆连线」、读回散乱）。
function buildPolyline(points, edges) {
  return polylineSeq(points, edges).map(i => points[i]);
}
// 判定 drawEdges 是否构成「每个点度=2 的单一闭合环」（纯闭环，无伸出支线/孤立点），填充前置条件
function hasClosedRing(n, edges) {
  if (n < 3 || edges.length < n) return false;
  const deg = new Array(n).fill(0), adj = new Map();
  for (let i = 0; i < n; i++) adj.set(i, []);
  for (const [a, b] of (edges || [])) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    deg[a]++; deg[b]++;
    adj.get(a).push(b); adj.get(b).push(a);
  }
  if (deg.some(d => d !== 2)) return false;
  const seen = new Set([0]), stack = [0];
  while (stack.length) { const c = stack.pop(); for (const t of adj.get(c)) if (!seen.has(t)) { seen.add(t); stack.push(t); } }
  return seen.size === n;
}
// 把点+边按连通分量拆分（剑/箭头等分开图形各自成独立分量），供写回多元素与逐环填充
function splitIntoComponents(n, points, edges) {
  const adj = new Map(), seen = new Set(), comps = [];
  for (let i = 0; i < n; i++) adj.set(i, []);
  for (const [a, b] of edges) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    adj.get(a).push(b); adj.get(b).push(a);
  }
  for (let i = 0; i < n; i++) {
    if (seen.has(i) || !adj.get(i).length) continue;
    const nodeSet = new Set([i]), stack = [i]; seen.add(i);
    while (stack.length) { const c = stack.pop(); for (const t of adj.get(c)) if (!seen.has(t)) { seen.add(t); nodeSet.add(t); stack.push(t); } }
    const idxMap = new Map(); let k = 0;
    for (const idx of nodeSet) idxMap.set(idx, k++);
    comps.push({
      points: [...nodeSet].map(idx => points[idx]),
      edges: edges.filter(([a, b]) => nodeSet.has(a) && nodeSet.has(b)).map(([a, b]) => [idxMap.get(a), idxMap.get(b)])
    });
  }
  return comps;
}

// ── 画布坐标小工具（自 artboard.js 复制，避免模块耦合）──
function canvasPoint(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}
function pivot(canvas) { return { x: canvas.width / 2, y: canvas.height / 2 }; }

function snapXY(x, y) {
  if (!drawSnapOn) return { x, y };
  return { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID };
}

function hitPointIndex(pt) {
  if (!boardDom || !boardDom.drawBoardCanvas) return -1;
  const p = pivot(boardDom.drawBoardCanvas);
  let best = -1;
  let bestD = 8; // 命中阈值：画布 8px
  drawPoints.forEach((pt2, i) => {
    const d = Math.hypot(pt.x - (p.x + pt2.x), pt.y - (p.y + pt2.y));
    if (d <= bestD) { bestD = d; best = i; }
  });
  return best;
}

// 射线法：点是否在轮廓内部。遍历连通分量，任一分量「边构成纯闭合环」且点在其内即命中（支持剑/箭头等多个分开形状）
function pointInPolygon(pt) {
  const p = pivot(boardDom.drawBoardCanvas);
  const comps = splitIntoComponents(drawPoints.length, drawPoints, drawEdges);
  for (const comp of comps) {
    if (comp.points.length < 3 || !hasClosedRing(comp.points.length, comp.edges)) continue;
    const poly = buildPolyline(comp.points, comp.edges);
    if (poly.length < 3) continue;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = p.x + poly[i].x, yi = p.y + poly[i].y;
      const xj = p.x + poly[j].x, yj = p.y + poly[j].y;
      if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

// 选中点变化/拖动后回填 XY 输入框；无选中点时禁用并清空
function syncSelInputs() {
  const dom = boardDom;
  if (!dom) return;
  const pt = drawPoints[selectedPointIndex];
  if (dom.drawSelX) { dom.drawSelX.disabled = !pt; dom.drawSelX.value = pt ? Math.round(pt.x) : ''; }
  if (dom.drawSelY) { dom.drawSelY.disabled = !pt; dom.drawSelY.value = pt ? Math.round(pt.y) : ''; }
}

// ── 绘制：网格+圆心十字 → 参考底图（青）→ 轮廓（黄）→ 选中点高亮 ──
function drawBoardDraw(dom = boardDom) {
  if (!dom || !dom.drawBoardCanvas) return;
  const canvas = dom.drawBoardCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = boardDesign?.bgColor || '#0a1220'; ctx.fillRect(0, 0, w, h);
  const p = pivot(canvas);
  ctx.strokeStyle = 'rgba(47,90,122,0.22)'; ctx.lineWidth = 1;
  for (let x = p.x % GRID; x < w; x += GRID) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = p.y % GRID; y < h; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(p.x - 12, p.y); ctx.lineTo(p.x + 12, p.y); ctx.moveTo(p.x, p.y - 12); ctx.lineTo(p.x, p.y + 12); ctx.stroke();

  // 参考底图：青色半透明折线，逐段连线不闭合
  if (refShapes.length) {
    ctx.strokeStyle = 'rgba(79,195,247,0.45)'; ctx.lineWidth = 1.5;
    refShapes.forEach(shape => {
      if (!shape || !shape.points.length) return;
      ctx.beginPath();
      shape.points.forEach((pt, i) => { const wx = p.x + pt.x, wy = p.y + pt.y; if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy); });
      ctx.stroke();
    });
  }

  // 轮廓填充（仿 Windows 画板）：有填充色时遍历连通分量，每个「边构成纯闭合环」的分量按边序闭合多边形上色（支持剑/箭头多个分开形状）
  if (drawStyle.fill) {
    const comps = splitIntoComponents(drawPoints.length, drawPoints, drawEdges);
    ctx.fillStyle = drawStyle.fill;
    for (const comp of comps) {
      if (comp.points.length < 3 || !hasClosedRing(comp.points.length, comp.edges)) continue;
      const poly = buildPolyline(comp.points, comp.edges);
      if (poly.length < 3) continue;
      ctx.beginPath();
      poly.forEach((pt, i) => { const wx = p.x + pt.x, wy = p.y + pt.y; if (i === 0) ctx.moveTo(wx, wy); else ctx.lineTo(wx, wy); });
      ctx.closePath();
      ctx.fill();
    }
  }

  // 轮廓线：按边绘制（只画「选中点→落点」产生的段，断开状态只放点；不再全量串折线、不把闭合回路续接到新点）
  if (drawPoints.length) {
    ctx.strokeStyle = '#ffe083'; ctx.lineWidth = 2;
    for (const [a, b] of drawEdges) {
      const pa = drawPoints[a], pb = drawPoints[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(p.x + pa.x, p.y + pa.y);
      ctx.lineTo(p.x + pb.x, p.y + pb.y);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffe083';
    drawPoints.forEach(pt => { ctx.beginPath(); ctx.arc(p.x + pt.x, p.y + pt.y, 4, 0, Math.PI * 2); ctx.fill(); });
  }

  // 选中点高亮（多选）：全部选中点橙填充 + 白描边圈
  for (const i of selectedSet) {
    const sp = drawPoints[i];
    if (!sp) continue;
    const wx = p.x + sp.x, wy = p.y + sp.y;
    ctx.beginPath(); ctx.arc(wx, wy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ff9800'; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
  }
  // 框选矩形（拖拽中实时反馈）
  if (marquee) {
    const mx = Math.min(marquee.x0, marquee.x1), my = Math.min(marquee.y0, marquee.y1);
    const mw = Math.abs(marquee.x1 - marquee.x0), mh = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = 'rgba(79,195,247,0.08)'; ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(79,195,247,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.strokeRect(mx, my, mw, mh); ctx.setLineDash([]);
  }
}

// ── 轮廓库下拉 ──
function refreshOutlineSelect(dom) {
  if (!dom.drawRefOutline) return Promise.resolve();
  return listOutlines().then(res => {
    const raw = (res && res.outlines) || [];
    // 兼容旧版 [id,...] 与新版 [{id,name},...]
    const valid = raw
      .map(o => typeof o === 'string' ? { id: o, name: o } : o)
      .filter(o => o && o.id && o.id !== 'undefined');
    dom.drawRefOutline.innerHTML = '<option value="">选择已注册轮廓…</option>' +
      valid.map(o => `<option value="${o.id}">${o.name || o.id}</option>`).join('');
  }).catch(() => { dom.drawRefOutline.innerHTML = '<option value="">（读取失败）</option>'; });
}

// ── 插入图形参数 → 点集（相对画板圆心）──
function generateShapePoints() {
  const dom = boardDom;
  const kind = dom.drawInsertShape ? dom.drawInsertShape.value : '';
  if (!kind) { setStatus(dom, '请先选择要插入的图形', true); return null; }
  const r = Math.max(5, Number(dom.drawRefRadius && dom.drawRefRadius.value) || 100);
  const sides = Math.max(3, Math.min(64, Math.round(Number(dom.drawRefSides && dom.drawRefSides.value) || 6)));
  const span = (Number(dom.drawRefArcDeg && dom.drawRefArcDeg.value) || 270) * Math.PI / 180;
  const pts = [];
  if (kind === 'circle') {
    for (let i = 0; i < 24; i++) { const a = Math.PI * 2 * i / 24; pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  } else if (kind === 'arc') {
    for (let i = 0; i < 12; i++) { const a = -span / 2 + span * i / 11; pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  } else { // polygon
    for (let i = 0; i < sides; i++) { const a = Math.PI * 2 * i / sides; pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r }); }
  }
  return pts;
}

// ── 参考轮廓 → 参考底图 / 载入为当前点集（替换，以所选轮廓为基础重绘）/ 删除 ──
async function useReferenceOutline(asUnderlay) {
  const dom = boardDom;
  const id = dom.drawRefOutline ? dom.drawRefOutline.value : '';
  if (!id) { setStatus(dom, '请先在「参考轮廓」中选择轮廓', true); return; }
  try {
    const outline = normalizeOutline(await loadOutline(id));
    if (!outline.points.length) { setStatus(dom, '该轮廓没有点集', true); return; }
    if (asUnderlay) refShapes.push({ points: outline.points });
    else {
      // 无边（旧轮廓）→ 按顺序环补边；有边 → 精确还原保存时的点+边拓扑，保证「保存→导入」完全一致
      drawStyle = {
        color: outline.color || drawStyle.color,
        lineWidth: outline.lineWidth || drawStyle.lineWidth,
        closed: !!outline.closed,
        fillColor: outline.fill || drawStyle.fillColor,
        fill: outline.fill || null
      };
      drawPoints = outline.points.map(p => ({ x: p.x, y: p.y }));
      drawEdges = (Array.isArray(outline.edges) && outline.edges.length)
        ? outline.edges.map(([a, b]) => [a, b])
        : rebuildFullEdges(outline.closed);
      selectedPointIndex = -1;
      selectedSet = new Set();
      marquee = null;
      lastAdded = -1;
      syncSelInputs();
      setStatus(dom, `已载入轮廓「${outline.name}」（${drawPoints.length} 点，替换原点集），可直接修改后点「完成」写回`);
    }
    drawBoardDraw(dom);
  } catch (err) {
    setStatus(dom, `轮廓读取失败：${err.message}`, true);
  }
}

// 删除所选已注册轮廓（DELETE /api/outlines/:id），刷新本弹层与主画板下拉
async function deleteReferenceOutline() {
  const dom = boardDom;
  const id = dom.drawRefOutline ? dom.drawRefOutline.value : '';
  if (!id) { setStatus(dom, '请先在「参考轮廓」中选择要删除的轮廓', true); return; }
  try {
    await deleteOutline(id);
    setStatus(dom, `已删除轮廓：${id}`);
    await refreshOutlineSelect(dom);
    if (boardHooks.onSaved) boardHooks.onSaved(id);
  } catch (err) {
    setStatus(dom, `删除失败：${err.message}`, true);
  }
}

function setDrawMode(mode) {
  drawMode = mode;
  const dom = boardDom;
  if (!dom) return;
  if (dom.drawToolAdd) dom.drawToolAdd.classList.toggle('active', mode === 'add');
  if (dom.drawToolSelect) dom.drawToolSelect.classList.toggle('active', mode === 'select');
  if (dom.drawToolFill) dom.drawToolFill.classList.toggle('active', mode === 'fill');
}

function popLastPoint() {
  if (!drawPoints.length) return;
  const idx = (lastAdded >= 0 && lastAdded < drawPoints.length) ? lastAdded : drawPoints.length - 1;
  removePointByIndex(idx);
  if (selectedPointIndex === idx || selectedPointIndex >= drawPoints.length) selectedPointIndex = -1;
  else if (selectedPointIndex > idx) selectedPointIndex -= 1;
  selectedSet = new Set();
  lastAdded = -1;
  syncSelInputs();
  drawBoardDraw();
}

// 删除选中点（整组，降序删避免下标漂移，见 deleteSelectedPoints）

function nudgeSelection(dx, dy) {
  if (selectedSet.size) {
    for (const i of selectedSet) { const pt = drawPoints[i]; if (pt) { pt.x += dx; pt.y += dy; } }
  } else {
    const pt = drawPoints[selectedPointIndex];
    if (!pt) return;
    pt.x += dx; pt.y += dy; // 固定 1 像素，不吸附
  }
  lastAdded = -1;
  syncSelInputs();
  drawBoardDraw();
}
function setSelection(idx) {
  selectedSet = new Set(idx >= 0 ? [idx] : []);
  selectedPointIndex = idx;
  syncSelInputs();
}
function clearSelection() {
  selectedSet = new Set();
  selectedPointIndex = -1;
  syncSelInputs();
}
function selectRange(ids) {
  selectedSet = new Set(ids || []);
  if (selectedSet.size) {
    // 锚点：保留原锚点若仍在多选中，否则取最小下标
    if (!selectedSet.has(selectedPointIndex)) selectedPointIndex = [...selectedSet].sort((a, b) => a - b)[0];
  } else selectedPointIndex = -1;
  syncSelInputs();
}
function copySelection() {
  if (!selectedSet.size) return false;
  const ids = [...selectedSet].sort((a, b) => a - b);
  const points = ids.map(i => { const p = drawPoints[i]; return { x: p.x, y: p.y }; });
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const local = new Map(ids.map((id, k) => [id, k]));
  const edges = drawEdges.filter(([a, b]) => local.has(a) && local.has(b)).map(([a, b]) => [local.get(a), local.get(b)]);
  clipboard = { points, edges, cx, cy };
  return true;
}
function pasteClipboard() {
  if (!clipboard || !clipboard.points.length) return false;
  const off = GRID; // 粘贴偏移一格，便于与新点区分
  const baseId = drawPoints.length;
  drawPoints.push(...clipboard.points.map(pt => ({ x: pt.x + off, y: pt.y + off })));
  clipboard.edges.forEach(([a, b]) => addEdge(baseId + a, baseId + b));
  const newIds = clipboard.points.map((_, k) => baseId + k);
  selectRange(newIds);
  lastAdded = newIds[newIds.length - 1];
  drawBoardDraw();
  return true;
}
function deleteSelectedPoints() {
  if (!selectedSet.size) return;
  const ids = [...selectedSet].sort((a, b) => b - a); // 降序删，避免早下标漂移
  for (const i of ids) removePointByIndex(i);
  selectedSet = new Set();
  selectedPointIndex = -1;
  lastAdded = -1;
  syncSelInputs();
  drawBoardDraw();
}
function isEditableTarget(e) {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

// ── 完成：沿用旧语义（≥2 点替换选中 stroke 或新建），并同步工具条样式 ──
function doneDrawBoard(dom) {
  const comps = splitIntoComponents(drawPoints.length, drawPoints, drawEdges);
  const writeComps = comps.length ? comps : [{ points: drawPoints, edges: drawEdges }];
  const entries = writeComps
    .map(c => ({
      points: buildPolyline(c.points, c.edges).map(p => ({ x: p.x, y: p.y })),
      closed: drawStyle.closed || (c.points.length >= 3 && hasClosedRing(c.points.length, c.edges))
    }))
    .filter(e => e.points.length >= 2);

  if (entries.length) {
    const fill = drawStyle.fill;
    if (drawTargetIndex != null && boardDesign && boardDesign.elements[drawTargetIndex]) {
      // 编辑已有 stroke：单元素写回（不改元素结构，编辑态视作单形状）
      const el = boardDesign.elements[drawTargetIndex];
      el.points = buildPolyline(drawPoints, drawEdges).map(p => ({ x: p.x, y: p.y }));
      el.color = drawStyle.color;
      el.lineWidth = drawStyle.lineWidth;
      el.closed = drawStyle.closed || hasClosedRing(drawPoints.length, drawEdges);
      el.fill = fill;
      if (boardHooks.onDone) boardHooks.onDone(drawTargetIndex);
      setStatus(dom, `轮廓已写回元素 ${drawTargetIndex + 1}`);
    } else {
      // 新建：每个连通分量写成一个独立 stroke 元素（剑/箭头等分开图形保存后仍分开）
      const firstIdx = boardDesign.elements.length;
      for (const e of entries) {
        boardDesign.elements.push(normalizeElement({
          shape: 'stroke', points: e.points,
          color: drawStyle.color, lineWidth: drawStyle.lineWidth, closed: e.closed,
          fill, rotSpeed: 0.5, phase: 0
        }));
      }
      if (boardHooks.onDone) boardHooks.onDone(firstIdx);
      setStatus(dom, entries.length > 1 ? `已新建 ${entries.length} 个轮廓元素（元素 ${firstIdx + 1}..${firstIdx + entries.length}）` : `已新建轮廓元素 ${firstIdx + 1}`);
    }
    closeDrawBoard(dom);
  } else {
    setStatus(dom, '轮廓至少需要 2 个点（且要点到点连线）', true);
  }
}

// ── 事件接线（一次性，bound 防重复注册）──
let bound = false;
function bindBoardEvents(dom) {
  if (bound) return;
  bound = true;

  // 模式切换
  if (dom.drawToolAdd) dom.drawToolAdd.onclick = () => setDrawMode('add');
  if (dom.drawToolSelect) dom.drawToolSelect.onclick = () => setDrawMode('select');

  // 画布指针：fill → 点回路内上色；add → 命中首点闭合 / 命中其他点选中拖拽 / 空白加点；select → 选中或取消
  if (dom.drawBoardCanvas) {
    dom.drawBoardCanvas.addEventListener('pointerdown', e => {
      if (!drawBoardOpen || !boardDom) return;
      const canvas = boardDom.drawBoardCanvas;
      const pt = canvasPoint(canvas, e);
      const hit = hitPointIndex(pt);

      if (drawMode === 'fill') {
        if (drawPoints.length < 3) { setStatus(boardDom, '填充需要至少 3 个点的轮廓', true); return; }
        if (!pointInPolygon(pt)) { setStatus(boardDom, '点击位置不在闭合回路内', true); return; }
        drawStyle.fill = drawStyle.fillColor;
        setStatus(boardDom, `已填充：${drawStyle.fill}`);
        drawBoardDraw(boardDom);
        return;
      }

      if (hit >= 0) {
        if (drawMode === 'add') {
          // add：点已有点 = 设锚点；已有选中锚点且非同一 → 从锚点连一条边到该点（可点任一已有点成闭环）
          if (selectedPointIndex >= 0 && selectedPointIndex !== hit) {
            addEdge(selectedPointIndex, hit);
            setStatus(boardDom, `已连线 ${selectedPointIndex + 1} → ${hit + 1}`);
          }
          setSelection(hit);
          lastAdded = -1;
        } else {
          // select：点已有点 = 单选并进入拖动
          setSelection(hit);
          dragPoint = { index: hit };
          canvas.setPointerCapture(e.pointerId);
          lastAdded = -1;
        }
        syncSelInputs();
        drawBoardDraw(boardDom);
        return;
      }
      if (drawMode === 'add') {
        const p = pivot(canvas);
        const snapped = snapXY(pt.x - p.x, pt.y - p.y);
        const np = { x: snapped.x, y: snapped.y };
        drawPoints.push(np);
        const newIdx = drawPoints.length - 1;
        // 只在选中点存在时连线（选中点→新点），非选中只落点；连线完成回到非选中
        if (selectedPointIndex >= 0 && drawPoints[selectedPointIndex]) addEdge(selectedPointIndex, newIdx);
        clearSelection();
        lastAdded = newIdx;
      } else {
        // select：空白按下 → 开始框选（拖拽出矩形，松开后选中矩形内点）
        marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
        canvas.setPointerCapture(e.pointerId);
        clearSelection();
      }
      syncSelInputs();
      drawBoardDraw(boardDom);
    });
    dom.drawBoardCanvas.addEventListener('pointermove', e => {
      if (!drawBoardOpen || !boardDom) return;
      const canvas = boardDom.drawBoardCanvas;
      const pt = canvasPoint(canvas, e);
      // 框选拖拽：实时更新矩形并选中矩形内点
      if (marquee) {
        marquee.x1 = pt.x; marquee.y1 = pt.y;
        const p = pivot(canvas);
        const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1);
        const y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
        const ids = [];
        drawPoints.forEach((q, i) => { const wx = p.x + q.x, wy = p.y + q.y; if (wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1) ids.push(i); });
        selectRange(ids);
        drawBoardDraw(boardDom);
        return;
      }
      if (!dragPoint) return;
      const target = drawPoints[dragPoint.index];
      if (!target) return;
      const p = pivot(canvas);
      const snapped = snapXY(pt.x - p.x, pt.y - p.y);
      target.x = snapped.x; target.y = snapped.y;
      syncSelInputs();
      drawBoardDraw(boardDom);
    });
    dom.drawBoardCanvas.addEventListener('pointerup', () => {
      dragPoint = null;
      if (marquee) { marquee = null; drawBoardDraw(boardDom); }
    });
  }

  // 键盘：Ctrl/Cmd+Z 撤点 / Delete·Backspace 删选中点 / 方向键 1px / Esc 取消 / Enter 完成
  // 首行守卫保证只在本弹层打开时接管（编辑器撤销靠 bindings.js 的 artboard-mode 早退分流，坑17）
  document.addEventListener('keydown', e => {
    if (!isDrawBoardOpen()) return;
    const domNow = boardDom;
    const editable = isEditableTarget(e);
    const kL = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !editable && kL === 'c') { e.preventDefault(); if (copySelection()) setStatus(domNow, `已复制 ${selectedSet.size} 个点，可 Ctrl+V 粘贴`); return; }
    if ((e.ctrlKey || e.metaKey) && !editable && kL === 'v') { e.preventDefault(); if (pasteClipboard()) setStatus(domNow, '已粘贴（方向键可移动整组）'); return; }
    if ((e.ctrlKey || e.metaKey) && kL === 'z') { e.preventDefault(); popLastPoint(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editable && (selectedSet.size || selectedPointIndex >= 0)) e.preventDefault();
      if (!editable) deleteSelectedPoints();
      return;
    }
    if (e.key.startsWith('Arrow')) {
      if (!editable && (selectedSet.size || (selectedPointIndex >= 0 && drawPoints[selectedPointIndex]))) {
        e.preventDefault(); // 防页面滚动
        if (e.key === 'ArrowUp') nudgeSelection(0, -1);
        else if (e.key === 'ArrowDown') nudgeSelection(0, 1);
        else if (e.key === 'ArrowLeft') nudgeSelection(-1, 0);
        else nudgeSelection(1, 0);
      }
      return;
    }
    if (e.key === 'Escape') { closeDrawBoard(domNow); return; }
    if (e.key === 'Enter') { doneDrawBoard(domNow); }
  });

  // XY 输入：直接写选中点坐标（非法输入忽略）
  if (dom.drawSelX) dom.drawSelX.oninput = () => {
    const pt = drawPoints[selectedPointIndex];
    if (!pt) return;
    const v = Number(dom.drawSelX.value);
    if (!Number.isFinite(v)) return;
    pt.x = v;
    lastAdded = -1;
    drawBoardDraw(boardDom);
  };
  if (dom.drawSelY) dom.drawSelY.oninput = () => {
    const pt = drawPoints[selectedPointIndex];
    if (!pt) return;
    const v = Number(dom.drawSelY.value);
    if (!Number.isFinite(v)) return;
    pt.y = v;
    lastAdded = -1;
    drawBoardDraw(boardDom);
  };

  // 删除点按钮 = Delete 键
  if (dom.drawDelPoint) dom.drawDelPoint.onclick = () => { if (drawBoardOpen) deleteSelectedPoints(); };

  // 画笔字段 → drawStyle；填充为工具模式（调色后点回路内上色）
  if (dom.drawColor) dom.drawColor.oninput = e => { drawStyle.color = e.target.value; };
  if (dom.drawLineWidth) dom.drawLineWidth.oninput = e => { drawStyle.lineWidth = Math.max(0.5, Number(e.target.value) || 4); };
  if (dom.drawFillColor) dom.drawFillColor.oninput = e => { drawStyle.fillColor = e.target.value; };
  if (dom.drawToolFill) dom.drawToolFill.onclick = () => setDrawMode(drawMode === 'fill' ? 'add' : 'fill');

  // 插入图形：作参考底图 / 转为轮廓点（追加到末尾）
  if (dom.drawRefUnderlay) dom.drawRefUnderlay.onclick = () => {
    const pts = generateShapePoints();
    if (!pts) return;
    refShapes.push({ points: pts });
    drawBoardDraw(boardDom);
  };
  if (dom.drawRefToPoints) dom.drawRefToPoints.onclick = () => {
    const pts = generateShapePoints();
    if (!pts) return;
    drawPoints.push(...pts);
    drawEdges = rebuildFullEdges(drawStyle.closed);
    lastAdded = drawPoints.length - 1;
    drawBoardDraw(boardDom);
  };

  // 参考轮廓：作参考底图 / 转为轮廓点 / 清除参考
  if (dom.drawRefOutlineUnderlay) dom.drawRefOutlineUnderlay.onclick = () => useReferenceOutline(true);
  if (dom.drawRefOutlineDelete) dom.drawRefOutlineDelete.onclick = () => deleteReferenceOutline();
  if (dom.drawRefOutlineToPoints) dom.drawRefOutlineToPoints.onclick = () => useReferenceOutline(false);
  if (dom.drawRefClear) dom.drawRefClear.onclick = () => { refShapes = []; drawBoardDraw(boardDom); };

  // 整条变换：p' = R(θ)·(k·(p-c)) + c，以轮廓重心为中心烘进点坐标（带操作反馈）
  if (dom.drawApplyTransform) dom.drawApplyTransform.onclick = () => {
    if (!drawPoints.length) { setStatus(boardDom, '请先绘制轮廓点', true); return; }
    const deg = Number(dom.drawRotateDeg ? dom.drawRotateDeg.value : 0) || 0;
    const pct = Number(dom.drawScalePct ? dom.drawScalePct.value : 100) || 100;
    const th = deg * Math.PI / 180;
    const k = pct / 100;
    if (!deg && Math.abs(pct - 100) < 0.001) { setStatus(boardDom, '旋转 0°、缩放 100%：无变化；改完后请点「完成」写回'); return; }
    const n = drawPoints.length;
    const cx = drawPoints.reduce((s, p) => s + p.x, 0) / n;
    const cy = drawPoints.reduce((s, p) => s + p.y, 0) / n;
    const cos = Math.cos(th), sin = Math.sin(th);
    drawPoints.forEach(p => {
      const vx = (p.x - cx) * k, vy = (p.y - cy) * k;
      p.x = cx + vx * cos - vy * sin;
      p.y = cy + vx * sin + vy * cos;
    });
    lastAdded = -1;
    if (dom.drawRotateDeg) dom.drawRotateDeg.value = 0;
    if (dom.drawScalePct) dom.drawScalePct.value = 100;
    setStatus(boardDom, `已应用变换：旋转 ${deg}°、缩放 ${pct}%；点「完成」写回画板元素`);
    syncSelInputs();
    drawBoardDraw(boardDom);
  };

  // 保存为轮廓：无损保存全部点+边拓扑（点取遍历序，边重映射到该点序）→ 平移到重心坐标 → 同名覆盖 → 刷新下拉并通知主画板。
  // 读回时按 edges 还原连通结构，保证「保存→导入」数据完全一致。
  if (dom.drawSaveOutline) dom.drawSaveOutline.onclick = async () => {
    const name = dom.drawOutlineName ? dom.drawOutlineName.value.trim() : '';
    if (drawPoints.length < 2 || !name) { setStatus(boardDom, '保存为轮廓需要至少 2 个点且名称非空', true); return; }
    const ids = polylineSeq(drawPoints, drawEdges);
    const ordered = ids.map(i => drawPoints[i]);
    const pos = new Map(ids.map((orig, k) => [orig, k]));
    const edges = drawEdges.map(([a, b]) => [pos.get(a), pos.get(b)]).filter(([a, b]) => a != null && b != null);
    const n = ordered.length;
    const cx = ordered.reduce((s, p) => s + p.x, 0) / n;
    const cy = ordered.reduce((s, p) => s + p.y, 0) / n;
    // 已居中（导入过/以重心为原点）→ 不再减去重心，避免浮点漂移，保证「保存→导入→再保存」逐位一致
    const reCenter = Math.abs(cx) > 1e-9 || Math.abs(cy) > 1e-9;
    let id = `outline-${Date.now()}`;
    try {
      // 同名轮廓 → 覆盖其 id（主画板/参考下拉里旧条目立即反映新内容）
      const res = await listOutlines();
      const raw = ((res && res.outlines) || []).map(o => typeof o === 'string' ? { id: o, name: o } : o);
      const same = raw.find(o => o && o.id && o.id !== 'undefined' && (o.name || o.id) === name);
      if (same) id = same.id;
      const outline = normalizeOutline({
        id, name,
        points: ordered.map(p => ({ x: reCenter ? p.x - cx : p.x, y: reCenter ? p.y - cy : p.y })),
        edges,
        color: drawStyle.color, lineWidth: drawStyle.lineWidth,
        closed: drawStyle.closed || hasClosedRing(drawPoints.length, drawEdges),
        fill: drawStyle.fill
      });
      await saveOutline(id, outline);
      setStatus(boardDom, same ? `轮廓已更新：${name}` : '轮廓已保存');
      await refreshOutlineSelect(boardDom);
      if (boardHooks.onSaved) boardHooks.onSaved(id);
    } catch (err) {
      setStatus(boardDom, `保存失败：${err.message}`, true);
    }
  };

  // 原有工具条
  if (dom.drawSnap) dom.drawSnap.onchange = e => { drawSnapOn = e.target.checked; };
  if (dom.drawUndo) dom.drawUndo.onclick = () => { if (drawBoardOpen) popLastPoint(); };
  if (dom.drawClear) dom.drawClear.onclick = () => {
    if (!drawBoardOpen) return;
    drawPoints = [];
    drawEdges = [];
    selectedPointIndex = -1;
    selectedSet = new Set();
    marquee = null;
    lastAdded = -1;
    syncSelInputs();
    drawBoardDraw(boardDom);
  };
  if (dom.drawCancel) dom.drawCancel.onclick = () => closeDrawBoard(boardDom);
  if (dom.drawDone) dom.drawDone.onclick = () => { if (drawBoardOpen) doneDrawBoard(boardDom); };
}

export function openDrawBoard(dom, design, hooks) {
  if (!dom || !design) return;
  boardDom = dom;
  boardDesign = design;
  boardHooks = hooks || {};
  drawBoardOpen = true;
  drawTargetIndex = null;
  selectedPointIndex = -1;
  selectedSet = new Set();
  marquee = null;
  clipboard = null;
  lastAdded = -1;
  dragPoint = null;
  refShapes = [];
  // 编辑已有 stroke：画布直接带入该元素当前点集（所见即所改），工具条初值取当前样式；否则默认
  drawPoints = [];
  const sel = boardHooks.getSelectedIndex ? boardHooks.getSelectedIndex() : -1;
  if (sel >= 0 && design.elements[sel] && design.elements[sel].shape === 'stroke') {
    const el = design.elements[sel];
    drawTargetIndex = sel;
    drawPoints = (el.points || []).map(p => ({ x: p.x, y: p.y }));
    drawStyle = {
      color: el.color || '#ffa914',
      lineWidth: el.lineWidth || 4,
      closed: !!el.closed,
      fillColor: el.fill || '#ffa914',
      fill: el.fill || null
    };
  } else {
    drawStyle = { color: '#ffa914', lineWidth: 4, closed: false, fillColor: '#ffa914', fill: null };
  }
  drawEdges = rebuildFullEdges(drawStyle.closed);
  setDrawMode('add');
  // 工具条回填
  if (dom.drawColor) dom.drawColor.value = drawStyle.color;
  if (dom.drawLineWidth) dom.drawLineWidth.value = drawStyle.lineWidth;
  if (dom.drawFillColor) dom.drawFillColor.value = drawStyle.fillColor;
  if (dom.drawInsertShape) dom.drawInsertShape.value = '';
  if (dom.drawRefOutline) dom.drawRefOutline.value = '';
  if (dom.drawRotateDeg) dom.drawRotateDeg.value = 0;
  if (dom.drawScalePct) dom.drawScalePct.value = 100;
  if (dom.drawOutlineName) dom.drawOutlineName.value = '';
  if (dom.drawSnap) dom.drawSnap.checked = drawSnapOn;
  bindBoardEvents(dom);
  dom.artDrawBoard.classList.add('open');
  syncSelInputs();
  drawBoardDraw(dom);
  refreshOutlineSelect(dom);
  if (dom.drawBoardCanvas && dom.drawBoardCanvas.focus) dom.drawBoardCanvas.focus();
}

export function closeDrawBoard(dom) {
  drawBoardOpen = false;
  drawPoints = [];
  drawEdges = [];
  drawTargetIndex = null;
  selectedPointIndex = -1;
  selectedSet = new Set();
  marquee = null;
  clipboard = null;
  dragPoint = null;
  refShapes = [];
  if (dom) {
    if (dom.drawSelX) { dom.drawSelX.value = ''; dom.drawSelX.disabled = true; }
    if (dom.drawSelY) { dom.drawSelY.value = ''; dom.drawSelY.disabled = true; }
    if (dom.drawRotateDeg) dom.drawRotateDeg.value = 0;
    if (dom.drawScalePct) dom.drawScalePct.value = 100;
    if (dom.drawOutlineName) dom.drawOutlineName.value = '';
    dom.artDrawBoard.classList.remove('open');
  }
  boardDom = null;
  boardDesign = null;
  boardHooks = {};
}

export function isDrawBoardOpen() { return drawBoardOpen; }
