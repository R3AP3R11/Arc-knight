// ============================================================
// 独立像素画板（画板工作台的像素绘制弹层）。
// 职责：#pixelBoard 弹层全部交互 —— 像素格子点涂/擦除/框选/复制粘贴/整块移动/自由旋转、
//       视图缩放/平移、撤销笔触、把像素网格写回设计稿为 shape='pixel' 元素；由 artboard.js 接线，
//       完成后回调 onDone。与 draw-board.js（轮廓弹层）并存并列。
// 分类：引擎编辑器需求
// 导出：openPixelBoard, closePixelBoard, isPixelBoardOpen
// ============================================================
import { setStatus } from '../ui.js';
import { normalizeElement } from '../systems/art/asset-render.js';
import { savePixel, listPixels } from '../api.js';

// ── 会话态（openPixelBoard 打开时初始化，closePixelBoard 清空）──
let boardDom = null;         // 当前弹层 dom（getDom 产物，事件 handler 内取用）
let boardDesign = null;      // 打开时传入的设计稿引用（handler 内重新按下标取元素）
let boardHooks = {};         // { getSelectedIndex, onDone }
let pixelBoardOpen = false;  // 弹层是否打开（keydown 首行守卫，见 draw-board 坑17）
let cols = 12, rows = 12, cellSize = 8; // 像素网格规格
let cells = new Map();       // key="x,y" → color（可含非整数坐标，见旋转/自由移动）
let bgColor = '#0a1220';     // 画布背景
let gridColor = '#2f5a7a';   // 网格线颜色
let showGrid = true;         // 是否显示网格线
let currentColor = '#ffa914';// 当前上色
let eraserOn = false;        // 橡皮模式
let selectedSet = new Set(); // 选中格 key 集合（含非整数坐标）
let marquee = null;          // 框选矩形（画布绝对坐标）{x0,y0,x1,y1} | null
let clipboard = null;        // 复制缓冲 { cells:[{x,y,color}] } | null
let pan = null;              // 中键平移 { startPt, startOffX, startOffY } | null
let view = { zoom: 1, offX: 0, offY: 0 }; // 视图变换
let gridSnap = true;         // 网格吸附（#pixelSnapGrid）
let paintActive = false;     // 是否正在连涂
let paintStrokeOps = null;   // 当前连涂笔触 { ops:[{key,prev}], touched:Set }
let undoStack = [];          // 连涂笔触撤销栈（每项为 ops 数组）
let blockDrag = null;        // 拖拽选中块 { startPt, basePos:Map, colors:Map } | null

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── 画布坐标小工具（自 draw-board.js 复制，避免模块耦合）──
function canvasPoint(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}
function isEditableTarget(e) {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

// ── 网格坐标映射（view 变换）──
function pixelCanvas() { return boardDom ? boardDom.pixelBoardCanvas : null; }
function cellPx() { return cellSize * view.zoom; }
function gridOrigin() {
  const canvas = pixelCanvas();
  if (!canvas) return { x: 0, y: 0 };
  return {
    x: canvas.width / 2 - (cols * cellSize) / 2 * view.zoom + view.offX,
    y: canvas.height / 2 - (rows * cellSize) / 2 * view.zoom + view.offY
  };
}
function cellToScreen(x, y) {
  const o = gridOrigin(), cs = cellPx();
  return { x: o.x + x * cs, y: o.y + y * cs };
}
function screenToCell(px, py) {
  const o = gridOrigin(), cs = cellPx();
  const x = Math.floor((px - o.x) / cs);
  const y = Math.floor((py - o.y) / cs);
  return { x, y, inGrid: x >= 0 && x < cols && y >= 0 && y < rows };
}
function keyOf(x, y) { return `${x},${y}`; }

// ── 绘制：背景 → 有色格 → 网格线 → 选中高亮 → 框选虚线 ──
function drawPixelBoard(dom = boardDom) {
  if (!dom || !dom.pixelBoardCanvas) return;
  const canvas = dom.pixelBoardCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bgColor || '#0a1220';
  ctx.fillRect(0, 0, w, h);
  const o = gridOrigin(), cs = cellPx();

  // 有色格（一格一格填充，稍加半像素重叠避免抗锯齿缝隙）
  for (const [key, color] of cells) {
    const [x, y] = key.split(',').map(Number);
    ctx.fillStyle = color;
    ctx.fillRect(o.x + x * cs, o.y + y * cs, cs + 0.5, cs + 0.5);
  }

  // 网格线
  if (showGrid) {
    ctx.strokeStyle = gridColor || '#2f5a7a';
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      ctx.beginPath(); ctx.moveTo(o.x + x * cs, o.y); ctx.lineTo(o.x + x * cs, o.y + rows * cs); ctx.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      ctx.beginPath(); ctx.moveTo(o.x, o.y + y * cs); ctx.lineTo(o.x + cols * cs, o.y + y * cs); ctx.stroke();
    }
  }

  // 选中格高亮描边
  if (selectedSet.size) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    for (const key of selectedSet) {
      const [x, y] = key.split(',').map(Number);
      ctx.strokeRect(o.x + x * cs + 1, o.y + y * cs + 1, cs - 2, cs - 2);
    }
  }

  // 框选虚线
  if (marquee) {
    const mx = Math.min(marquee.x0, marquee.x1), my = Math.min(marquee.y0, marquee.y1);
    const mw = Math.abs(marquee.x1 - marquee.x0), mh = Math.abs(marquee.y1 - marquee.y0);
    ctx.fillStyle = 'rgba(79,195,247,0.08)'; ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(79,195,247,0.9)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.strokeRect(mx, my, mw, mh); ctx.setLineDash([]);
  }
}

// ── 连涂笔触撤销 ──
function startPaintStroke() { paintStrokeOps = { ops: [], touched: new Set() }; }
function paintCell(key, color) {
  if (!paintStrokeOps) return;
  if (!paintStrokeOps.touched.has(key)) {
    paintStrokeOps.touched.add(key);
    paintStrokeOps.ops.push({ key, prev: cells.get(key) || null });
  }
  if (color) cells.set(key, color); else cells.delete(key);
}
function endPaintStroke() {
  if (paintStrokeOps && paintStrokeOps.ops.length) undoStack.push(paintStrokeOps.ops);
  paintStrokeOps = null;
}
function undoLastStroke() {
  const ops = undoStack.pop();
  if (!ops) { setStatus(boardDom, '没有可撤销的笔触'); return; }
  for (let i = ops.length - 1; i >= 0; i--) {
    const { key, prev } = ops[i];
    if (prev) cells.set(key, prev); else cells.delete(key);
  }
  drawPixelBoard();
}

function copySelection() {
  if (!selectedSet.size) return false;
  const arr = [...selectedSet]
    .map(k => { const [x, y] = k.split(',').map(Number); return { x, y, color: cells.get(k) }; })
    .filter(c => c.color);
  if (!arr.length) return false;
  clipboard = { cells: arr };
  setStatus(boardDom, `已复制 ${arr.length} 格，可 Ctrl+V 粘贴`);
  return true;
}
function pasteClipboard() {
  if (!clipboard || !clipboard.cells.length) return false;
  const newSel = new Set();
  for (const c of clipboard.cells) {
    const nk = keyOf(c.x + 1, c.y + 1);
    cells.set(nk, c.color);
    newSel.add(nk);
  }
  selectedSet = newSel;
  drawPixelBoard();
  return true;
}
function deleteSelectedCells() {
  if (!selectedSet.size) return;
  for (const k of selectedSet) cells.delete(k);
  selectedSet = new Set();
  drawPixelBoard();
}
function nudgeSelected(dx, dy) {
  if (!selectedSet.size) return;
  const base = [...selectedSet].map(k => {
    const [x, y] = k.split(',').map(Number);
    return { key: k, x, y, color: cells.get(k) };
  });
  const newSel = new Set();
  for (const b of base) {
    const nx = b.x + dx, ny = b.y + dy;
    cells.delete(b.key);
    if (b.color) cells.set(keyOf(nx, ny), b.color);
    newSel.add(keyOf(nx, ny));
  }
  selectedSet = newSel;
  drawPixelBoard();
}
function rotateSelected(deg) {
  if (!selectedSet.size) { setStatus(boardDom, '请先框选要旋转的格子', true); return; }
  const th = deg * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const keys = [...selectedSet];
  let cx = 0, cy = 0;
  for (const k of keys) { const [x, y] = k.split(',').map(Number); cx += x; cy += y; }
  cx /= keys.length; cy /= keys.length;
  const newSel = new Set(), newCells = [];
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number);
    const vx = x - cx, vy = y - cy;
    const nx = Math.round(cx + vx * cos - vy * sin);
    const ny = Math.round(cy + vx * sin + vy * cos);
    const col = cells.get(k);
    cells.delete(k);
    newCells.push({ x: nx, y: ny, color: col });
    newSel.add(keyOf(nx, ny));
  }
  for (const c of newCells) if (c.color) cells.set(keyOf(c.x, c.y), c.color);
  selectedSet = newSel;
  if (boardDom && boardDom.pixelRotateDeg) boardDom.pixelRotateDeg.value = 0;
  setStatus(boardDom, `已旋转选区 ${deg}°（像素块绕几何中心，四舍五入到格）`);
  drawPixelBoard();
}

// ── 写回设计稿：shape='pixel' 元素（选中已是 pixel 元素则替换，否则 push 新元素）──
function collectCellEntries() {
  const out = [];
  for (const [k, color] of cells) {
    if (!color) continue;
    const [x, y] = k.split(',').map(Number);
    out.push({ x, y, color });
  }
  return out;
}
function buildPixelElement(entries) {
  const el = normalizeElement({ shape: 'pixel', cols, rows, cellSize, gridColor: showGrid ? gridColor : null, cells: entries });
  el.shape = 'pixel';
  el.cols = cols;
  el.rows = rows;
  el.cellSize = cellSize;
  el.gridColor = showGrid ? gridColor : null;
  el.cells = entries;
  el.name = (boardDom && boardDom.pixelName && boardDom.pixelName.value) || '';
  return el;
}
function writePixelElement() {
  const entries = collectCellEntries();
  if (!entries.length) return -1;
  const sel = boardHooks.getSelectedIndex ? boardHooks.getSelectedIndex() : -1;
  const target = (sel >= 0 && boardDesign.elements[sel] && boardDesign.elements[sel].shape === 'pixel') ? sel : -1;
  const el = buildPixelElement(entries);
  if (target >= 0) {
    boardDesign.elements[target] = el;
    return target;
  }
  const idx = boardDesign.elements.length;
  boardDesign.elements.push(el);
  return idx;
}
function donePixelBoard(dom) {
  const idx = writePixelElement();
  if (idx < 0) { setStatus(dom, '像素画板至少需要 1 个有色格', true); return; }
  if (boardHooks.onDone) boardHooks.onDone(idx);
  setStatus(dom, `像素画元素已写回（元素 ${idx + 1}）`);
  closePixelBoard(dom);
}
function savePixelElement(dom) {
  const idx = writePixelElement();
  if (idx < 0) { setStatus(dom, '像素画板至少需要 1 个有色格', true); return; }
  if (boardHooks.onDone) boardHooks.onDone(idx);
  setStatus(dom, `像素画元素已保存为元素 ${idx + 1}（继续编辑，或点「完成」退出）`);
}

// ── 保存为像素设计稿到像素库（/api/pixels；同名覆盖，刷新下拉并回调 onSaved）──
async function savePixelToLibrary(dom) {
  const entries = collectCellEntries();
  if (!entries.length) { setStatus(dom, '像素画板至少需要 1 个有色格', true); return; }
  const name = (dom.pixelName && dom.pixelName.value.trim()) || '';
  if (!name) { setStatus(dom, '请先在「名称」里填写像素画名称', true); return; }
  let id = `pixel-${Date.now()}`;
  try {
    const res = await listPixels();
    const raw = ((res && res.pixels) || []).map(o => typeof o === 'string' ? { id: o, name: o } : o);
    const same = raw.find(o => o && o.id && o.id !== 'undefined' && (o.name || o.id) === name);
    if (same) id = same.id;
    const el = buildPixelElement(entries);
    await savePixel(id, el);
    setStatus(dom, same ? `像素设计稿已更新：${name}` : '像素设计稿已保存');
    if (boardHooks.onSaved) boardHooks.onSaved(id);
  } catch (err) { setStatus(dom, `保存失败：${err.message}`, true); }
}

// ── 连涂/框选/拖块平移（pointermove 复用）──
function moveBlockBy(dCellX, dCellY) {
  if (!blockDrag) return;
  const newSel = new Set();
  for (const [k, base] of blockDrag.basePos) {
    const nx = base.x + dCellX, ny = base.y + dCellY;
    cells.delete(k);
    const col = blockDrag.colors.get(k);
    const nk = keyOf(nx, ny);
    if (col) cells.set(nk, col);
    newSel.add(nk);
  }
  selectedSet = newSel;
  drawPixelBoard();
}

// ── 事件接线（一次性，boundPixel 防重复注册）──
let boundPixel = false;
function bindPixelBoardEvents(dom) {
  if (boundPixel) return;
  boundPixel = true;

  if (dom.pixelBoardCanvas) {
    dom.pixelBoardCanvas.addEventListener('pointerdown', e => {
      if (!pixelBoardOpen || !boardDom) return;
      const canvas = boardDom.pixelBoardCanvas;
      const pt = canvasPoint(canvas, e);

      // 中键 → 开始平移
      if (e.button === 1) {
        pan = { startPt: pt, startOffX: view.offX, startOffY: view.offY };
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      const cell = screenToCell(pt.x, pt.y);
      // 命中有色/选中格 → 拖动整块（起点为锚）
      if (cell.inGrid && selectedSet.has(keyOf(cell.x, cell.y))) {
        const basePos = new Map(), colors = new Map();
        for (const k of selectedSet) {
          const [x, y] = k.split(',').map(Number);
          basePos.set(k, { x, y });
          colors.set(k, cells.get(k));
        }
        blockDrag = { startPt: pt, basePos, colors };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      // 命中格 → 连涂/擦除
      if (cell.inGrid) {
        startPaintStroke();
        paintActive = true;
        paintCell(keyOf(cell.x, cell.y), eraserOn ? null : currentColor);
        canvas.setPointerCapture(e.pointerId);
        drawPixelBoard();
        return;
      }
      // 空白 → 框选
      marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      selectedSet = new Set();
      canvas.setPointerCapture(e.pointerId);
      drawPixelBoard();
    });

    dom.pixelBoardCanvas.addEventListener('pointermove', e => {
      if (!pixelBoardOpen || !boardDom) return;
      const canvas = boardDom.pixelBoardCanvas;
      const pt = canvasPoint(canvas, e);

      // 中键平移
      if (pan) {
        view.offX = pan.startOffX + (pt.x - pan.startPt.x);
        view.offY = pan.startOffY + (pt.y - pan.startPt.y);
        drawPixelBoard();
        return;
      }
      // 拖块平移
      if (blockDrag) {
        const cs = cellPx();
        let dCellX = (pt.x - blockDrag.startPt.x) / cs;
        let dCellY = (pt.y - blockDrag.startPt.y) / cs;
        if (gridSnap) { dCellX = Math.round(dCellX); dCellY = Math.round(dCellY); }
        moveBlockBy(dCellX, dCellY);
        return;
      }
      // 连涂
      if (paintActive) {
        const cell = screenToCell(pt.x, pt.y);
        if (cell.inGrid) { paintCell(keyOf(cell.x, cell.y), eraserOn ? null : currentColor); drawPixelBoard(); }
        return;
      }
      // 框选
      if (marquee) {
        marquee.x1 = pt.x; marquee.y1 = pt.y;
        const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1);
        const y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
        const o = gridOrigin(), cs = cellPx();
        const sel = new Set();
        for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
          const sx = o.x + x * cs, sy = o.y + y * cs;
          if (sx < x1 && sx + cs > x0 && sy < y1 && sy + cs > y0) sel.add(keyOf(x, y));
        }
        selectedSet = sel;
        drawPixelBoard();
      }
    });

    dom.pixelBoardCanvas.addEventListener('pointerup', () => {
      pan = null;
      blockDrag = null;
      if (paintActive) { paintActive = false; endPaintStroke(); }
      if (marquee) { marquee = null; drawPixelBoard(); }
    });

    // 滚轮缩放（以指针为锚，editor-camera 模式）
    dom.pixelBoardCanvas.addEventListener('wheel', e => {
      if (!pixelBoardOpen || !boardDom) return;
      e.preventDefault();
      const canvas = boardDom.pixelBoardCanvas;
      const pt = canvasPoint(canvas, e);
      const o = gridOrigin(), old = view.zoom;
      const newZoom = clamp(old * (e.deltaY > 0 ? 0.9 : 1.1), 0.2, 8);
      const wx = (pt.x - o.x) / old, wy = (pt.y - o.y) / old;
      view.zoom = newZoom;
      view.offX = pt.x - wx * newZoom - (canvas.width / 2 - (cols * cellSize) / 2 * newZoom);
      view.offY = pt.y - wy * newZoom - (canvas.height / 2 - (rows * cellSize) / 2 * newZoom);
      drawPixelBoard();
    });
  }

  // 键盘：Ctrl/Cmd+C 复制选中格、Ctrl/Cmd+V 粘贴、Ctrl/Cmd+Z 撤销上一笔连涂、
  //       方向键移动整块、Delete 删除选中格、Esc 关闭、Enter 完成。
  // 首行守卫保证只在本弹层打开时接管（避免与编辑器关卡撤销/画板冲突，坑17）。
  document.addEventListener('keydown', e => {
    if (!isPixelBoardOpen()) return;
    const domNow = boardDom;
    if (!domNow) return;
    const editable = isEditableTarget(e);
    const kL = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !editable && kL === 'c') { e.preventDefault(); if (copySelection()) setStatus(domNow, `已复制 ${selectedSet.size} 格`); return; }
    if ((e.ctrlKey || e.metaKey) && !editable && kL === 'v') { e.preventDefault(); if (pasteClipboard()) setStatus(domNow, '已粘贴（方向键可移动整块）'); return; }
    if ((e.ctrlKey || e.metaKey) && kL === 'z') { e.preventDefault(); undoLastStroke(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editable && selectedSet.size) e.preventDefault();
      if (!editable) deleteSelectedCells();
      return;
    }
    if (e.key.startsWith('Arrow')) {
      if (!editable && selectedSet.size) {
        e.preventDefault(); // 防页面滚动
        if (e.key === 'ArrowUp') nudgeSelected(0, -1);
        else if (e.key === 'ArrowDown') nudgeSelected(0, 1);
        else if (e.key === 'ArrowLeft') nudgeSelected(-1, 0);
        else nudgeSelected(1, 0);
      }
      return;
    }
    if (e.key === 'Escape') { closePixelBoard(domNow); return; }
    if (e.key === 'Enter') { donePixelBoard(domNow); }
  });

  // 颜色/橡皮
  if (dom.pixelColor) dom.pixelColor.oninput = e => { currentColor = e.target.value; eraserOn = false; };
  if (dom.pixelEraser) dom.pixelEraser.onclick = () => {
    eraserOn = !eraserOn;
    setStatus(boardDom, eraserOn ? '橡皮开启：点击/拖动擦除格子' : '橡皮关闭');
  };

  // 规格应用：读取列/行/格宽，重置并清空
  if (dom.pixelApplySize) dom.pixelApplySize.onclick = () => {
    cols = clamp(Math.round(Number(dom.pixelCols.value) || 12), 1, 64);
    rows = clamp(Math.round(Number(dom.pixelRows.value) || 12), 1, 64);
    cellSize = clamp(Number(dom.pixelCellSize.value) || 8, 1, 1024);
    dom.pixelCols.value = cols;
    dom.pixelRows.value = rows;
    dom.pixelCellSize.value = cellSize;
    cells = new Map();
    selectedSet = new Set();
    marquee = null;
    view.zoom = 1; view.offX = 0; view.offY = 0;
    drawPixelBoard();
    setStatus(boardDom, `像素规格已应用：${cols} × ${rows}，格宽 ${cellSize}px（原格子已清空）`);
  };

  // 清空全部格子
  if (dom.pixelFillAll) dom.pixelFillAll.onclick = () => {
    cells = new Map();
    selectedSet = new Set();
    drawPixelBoard();
  };
  // 撤销上一笔连涂
  if (dom.pixelUndo) dom.pixelUndo.onclick = () => { if (pixelBoardOpen) undoLastStroke(); };

  // 自由旋转选区
  if (dom.pixelApplyRotate) dom.pixelApplyRotate.onclick = () => {
    if (!pixelBoardOpen) return;
    const deg = Number(dom.pixelRotateDeg ? dom.pixelRotateDeg.value : 0) || 0;
    rotateSelected(deg);
  };

  // 网格/背景/网格线/吸附
  if (dom.pixelShowGrid) dom.pixelShowGrid.onchange = e => { showGrid = e.target.checked; drawPixelBoard(); };
  if (dom.pixelBgColor) dom.pixelBgColor.oninput = e => { bgColor = e.target.value; drawPixelBoard(); };
  if (dom.pixelGridColor) dom.pixelGridColor.oninput = e => { gridColor = e.target.value; drawPixelBoard(); };
  if (dom.pixelSnapGrid) dom.pixelSnapGrid.onchange = e => { gridSnap = e.target.checked; };

  // 保存/取消/完成
  if (dom.pixelSave) dom.pixelSave.onclick = () => { if (pixelBoardOpen) savePixelElement(boardDom); };
  if (dom.pixelSaveLibrary) dom.pixelSaveLibrary.onclick = () => { if (pixelBoardOpen) savePixelToLibrary(boardDom); };
  if (dom.pixelCancel) dom.pixelCancel.onclick = () => closePixelBoard(boardDom);
  if (dom.pixelDone) dom.pixelDone.onclick = () => { if (pixelBoardOpen) donePixelBoard(boardDom); };
}

export function openPixelBoard(dom, design, hooks) {
  if (!dom || !design) return;
  boardDom = dom;
  boardDesign = design;
  boardHooks = hooks || {};
  pixelBoardOpen = true;

  // 编辑已有 pixel 元素：画布直接带入该元素格数据（所见即所改）；否则默认 12×12
  const sel = boardHooks.getSelectedIndex ? boardHooks.getSelectedIndex() : -1;
  const el = (sel >= 0 && design.elements[sel] && design.elements[sel].shape === 'pixel') ? design.elements[sel] : null;
  if (el) {
    cols = clamp(Math.round(Number(el.cols) || 12), 1, 64);
    rows = clamp(Math.round(Number(el.rows) || 12), 1, 64);
    cellSize = clamp(Number(el.cellSize) || 8, 1, 1024);
    gridColor = el.gridColor || '#2f5a7a';
    cells = new Map((el.cells || []).filter(c => c && c.color).map(c => [keyOf(c.x, c.y), c.color]));
  } else {
    cols = 12; rows = 12; cellSize = 8;
    gridColor = '#2f5a7a';
    cells = new Map();
  }
  bgColor = design.bgColor || '#0a1220';
  currentColor = '#ffa914';
  eraserOn = false;
  selectedSet = new Set();
  marquee = null;
  clipboard = null;
  pan = null;
  blockDrag = null;
  paintActive = false;
  paintStrokeOps = null;
  undoStack = [];
  view.zoom = 1; view.offX = 0; view.offY = 0;
  gridSnap = dom.pixelSnapGrid ? dom.pixelSnapGrid.checked : true;
  if (el) showGrid = !!el.gridColor;
  else showGrid = dom.pixelShowGrid ? dom.pixelShowGrid.checked : true;

  // 工具条回填
  if (dom.pixelCols) dom.pixelCols.value = cols;
  if (dom.pixelRows) dom.pixelRows.value = rows;
  if (dom.pixelCellSize) dom.pixelCellSize.value = cellSize;
  if (dom.pixelBgColor) dom.pixelBgColor.value = bgColor;
  if (dom.pixelGridColor) dom.pixelGridColor.value = gridColor;
  if (dom.pixelShowGrid) dom.pixelShowGrid.checked = showGrid;
  if (dom.pixelColor) dom.pixelColor.value = currentColor;
  if (dom.pixelRotateDeg) dom.pixelRotateDeg.value = 0;
  if (dom.pixelName) dom.pixelName.value = (el && el.name) || '';
  if (dom.pixelSnapGrid) dom.pixelSnapGrid.checked = gridSnap;

  bindPixelBoardEvents(dom);
  dom.pixelBoard.classList.add('open');
  drawPixelBoard(dom);
  if (dom.pixelBoardCanvas && dom.pixelBoardCanvas.focus) dom.pixelBoardCanvas.focus();
}

export function closePixelBoard(dom) {
  pixelBoardOpen = false;
  cells = new Map();
  selectedSet = new Set();
  marquee = null;
  clipboard = null;
  pan = null;
  blockDrag = null;
  paintActive = false;
  paintStrokeOps = null;
  undoStack = [];
  if (dom) {
    if (dom.pixelRotateDeg) dom.pixelRotateDeg.value = 0;
    if (dom.pixelName) dom.pixelName.value = '';
    dom.pixelBoard.classList.remove('open');
  }
  boardDom = null;
  boardDesign = null;
  boardHooks = {};
}

export function isPixelBoardOpen() { return pixelBoardOpen; }
