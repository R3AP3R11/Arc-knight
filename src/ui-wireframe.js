import { parseMxGraph } from './ui-mxgraph.js';
import { pageProfiles, profilePage } from './ui-page-profiles.js';
import { saveUiDesign, listUiDesigns, loadUiDesign, deleteUiDesign } from './api.js';

let shapes = [];
let selected = -1;
let drag = null;
let pan = null;
let view = { scale: 1, ox: 0, oy: 0 };

const HANDLE = 12; // 屏幕像素手柄半径

// 视图：设计坐标(mxGraph) → UI(1920x1080)。自动把背景矩形铺满整窗。
function computeView() {
  let bg = null, area = 0;
  for (const s of shapes) {
    if (s.shape === 'text' || s.shape === 'line') continue;
    const a = (s.w || 0) * (s.h || 0);
    if (a > area) { area = a; bg = s; }
  }
  if (!bg || bg.w <= 0 || bg.h <= 0) { view = { scale: 1, ox: 0, oy: 0 }; return; }
  const scale = Math.max(1920 / bg.w, 1080 / bg.h);
  view = {
    scale,
    ox: (1920 - bg.w * scale) / 2 - bg.x * scale,
    oy: (1080 - bg.h * scale) / 2 - bg.y * scale
  };
}

function estWidth(text, size) {
  let w = 0;
  for (const ch of text) w += /[\u4e00-\u9fff\u3000-\u303f\uf900-\ufaff]/.test(ch) ? size : size * 0.5;
  return w;
}

function wrapLine(text, maxW, size) {
  if (estWidth(text, size) <= maxW) return [text];
  const lines = [];
  let cur = '';
  for (const ch of text) {
    const t = cur + ch;
    if (estWidth(t, size) > maxW && cur) { lines.push(cur); cur = ch; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

function drawLabel(ctx, s, X, Y, W, H, sc) {
  const text = String(s.label ?? '');
  if (!text) return;
  const size = (s.fontSize || 12) * sc;
  ctx.fillStyle = s.fontColor || '#eaf4fb';
  ctx.font = `${size}px "Poppins","Noto Sans SC",sans-serif`;
  const cx = X + W / 2, cy = Y + H / 2;
  ctx.textAlign = s.align === 'left' ? 'left' : s.align === 'right' ? 'right' : 'center';
  ctx.textBaseline = 'middle';
  const pad = 2 * sc;
  const maxW = Math.max(1, W - pad * 2);
  const lines = s.wrap ? wrapLine(text, maxW, size) : [text];
  const lineH = size * 1.2;
  const blockH = lines.length * lineH;
  let top;
  if (s.verticalAlign === 'top') top = Y + pad;
  else if (s.verticalAlign === 'bottom') top = Y + H - blockH - pad;
  else top = cy - blockH / 2;
  const x = s.align === 'left' ? X + pad : s.align === 'right' ? X + W - pad : cx;
  lines.forEach((ln, i) => ctx.fillText(ln, x, top + i * lineH + lineH / 2));
  ctx.textAlign = 'start';
}

// 连线折线：points 相对 bbox 原点 → 屏幕坐标
function linePoints(s) {
  const sc = view.scale;
  return (s.points || []).map(p => ({ x: (s.x + p.x) * sc + view.ox, y: (s.y + p.y) * sc + view.oy }));
}

// mxGraph 圆角半径：arcSize 默认 15(%)，absoluteArcSize=1 时 arcSize 直接是设计单位。
// 不能退化成 min(8px, 半边) —— 那样小尺寸圆角矩形会被夹成圆形。
function cornerRadius(s, W, H) {
  const raw = Number.isFinite(Number(s.arcSize)) ? Number(s.arcSize) : 15;
  const r = s.absoluteArcSize ? raw * view.scale : Math.min(W, H) * Math.max(0, Math.min(50, raw)) / 100;
  return Math.max(0, Math.min(r, W / 2, H / 2));
}

// 1:1 还原 mxGraph 界面元素：按 shape/颜色/旋转/文字样式绘制（套视图变换）
function drawShape(ctx, s) {
  const sc = view.scale;
  const X = s.x * sc + view.ox, Y = s.y * sc + view.oy;
  const W = s.w * sc, H = s.h * sc;
  const kind = s.shape || (s.rounded ? 'rounded' : 'rect');
  const isText = kind === 'text';
  const isLine = kind === 'line';
  const fill = (isText || isLine) ? null : (s.fill || null);
  const stroke = isText ? null : (s.stroke || null);
  const cx = X + W / 2, cy = Y + H / 2;

  ctx.save();
  if (s.rotation) {
    ctx.translate(cx, cy);
    // mxGraph 的 rotation 正向 = 顺时针（与 canvas rotate 同向），别写负号
    ctx.rotate(s.rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }
  if (isLine) {
    const pts = linePoints(s);
    if (stroke && pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.globalAlpha = s.strokeOpacity ?? 1;
      ctx.lineWidth = Math.max(0.1, (s.strokeWidth || 1) * sc);
      ctx.strokeStyle = stroke;
      if (s.dashed) ctx.setLineDash([4 * sc, 4 * sc]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  } else if (!isText) {
    ctx.beginPath();
    if (kind === 'ellipse') {
      ctx.ellipse(cx, cy, W / 2, H / 2, 0, 0, Math.PI * 2);
    } else if (kind === 'rhombus') {
      ctx.moveTo(cx, Y);
      ctx.lineTo(X + W, cy);
      ctx.lineTo(cx, Y + H);
      ctx.lineTo(X, cy);
      ctx.closePath();
    } else if (kind === 'triangle') {
      // mxTriangle：默认朝东（顶点在右边中点），direction=north/south/west 改朝向
      const dir = s.direction || 'east';
      if (dir === 'north') { ctx.moveTo(cx, Y); ctx.lineTo(X + W, Y + H); ctx.lineTo(X, Y + H); }
      else if (dir === 'south') { ctx.moveTo(X, Y); ctx.lineTo(X + W, Y); ctx.lineTo(cx, Y + H); }
      else if (dir === 'west') { ctx.moveTo(X, cy); ctx.lineTo(X + W, Y); ctx.lineTo(X + W, Y + H); }
      else { ctx.moveTo(X + W, cy); ctx.lineTo(X, Y); ctx.lineTo(X, Y + H); }
      ctx.closePath();
    } else if (kind === 'parallelogram') {
      // mxGraph stencil：上下边水平、左右边右倾；倾斜量 = style 的 size（设计单位，缺省 20）
      const off = Math.min(Math.max((Number(s.size) || 20) * sc, 0), W / 2);
      ctx.moveTo(X + off, Y);
      ctx.lineTo(X + W, Y);
      ctx.lineTo(X + W - off, Y + H);
      ctx.lineTo(X, Y + H);
      ctx.closePath();
    } else if (kind === 'rounded' || s.rounded) {
      ctx.roundRect(X, Y, W, H, cornerRadius(s, W, H));
    } else {
      ctx.rect(X, Y, W, H);
    }
    if (fill) { ctx.globalAlpha = s.fillOpacity ?? 1; ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.globalAlpha = s.strokeOpacity ?? 1;
      ctx.lineWidth = (s.strokeWidth || 1) * sc;
      ctx.strokeStyle = stroke;
      if (s.dashed) ctx.setLineDash([4 * sc, 4 * sc]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  if (s.label) drawLabel(ctx, s, X, Y, W, H, sc);
  ctx.restore();
}

function toUI(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * 1920 / r.width, y: (e.clientY - r.top) * 1080 / r.height };
}

function toDesign(canvas, e) {
  const u = toUI(canvas, e);
  return { x: (u.x - view.ox) / view.scale, y: (u.y - view.oy) / view.scale };
}

// 命中检测：普通控件用包围盒；连线用「点到线段距离」（细线若用包围盒会点中大片空白）
function hitShape(s, p) {
  const pts = s.points || [];
  if (s.shape === 'line' && pts.length > 1) {
    const abs = pts.map(q => ({ x: s.x + q.x, y: s.y + q.y }));
    const pad = Math.max(3, 6 / view.scale);
    for (let i = 0; i < abs.length - 1; i++) {
      if (segDistance(p, abs[i], abs[i + 1]) <= pad) return true;
    }
    return false;
  }
  return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
}

function segDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function renderCanvas(dom) {
  const canvas = dom.wireframeCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(W / 1920, H / 1080);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1920, 1080);

  shapes.forEach(s => drawShape(ctx, s));

  if (selected >= 0 && shapes[selected]) {
    const s = shapes[selected];
    const sc = view.scale;
    const X = s.x * sc + view.ox, Y = s.y * sc + view.oy;
    const pw = s.w * sc, ph = s.h * sc;
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(X, Y, pw, ph);
    ctx.setLineDash([]);
    const hr = HANDLE * (1920 / canvas.getBoundingClientRect().width || 2);
    ctx.fillStyle = '#00e5ff';
    for (const [hx, hy] of [[X + pw, Y + ph], [X, Y + ph], [X + pw, Y], [X, Y]]) {
      ctx.fillRect(hx - hr / 2, hy - hr / 2, hr, hr);
    }
  }
  ctx.restore();
}

function renderList(dom) {
  dom.wireframeList.innerHTML = shapes.map((s, i) =>
    `<div class="wf-list-item ${i === selected ? 'active' : ''}" data-idx="${i}">
      <strong>${s.label || s.id}</strong> <em>${Math.round(s.x)},${Math.round(s.y)} ${Math.round(s.w)}×${Math.round(s.h)}</em>
    </div>`).join('');
  dom.wireframeList.querySelectorAll('[data-idx]').forEach(el => {
    el.onclick = () => { selected = Number(el.dataset.idx); renderAll(dom); };
  });
}

function renderNote(dom) {
  const noteBox = dom.wireframeNote;
  const s = shapes[selected];
  if (!s) { noteBox.innerHTML = '<p class="hint">先选中一个控件</p>'; return; }
  const isLine = s.shape === 'line';
  noteBox.innerHTML = `
    <label>名称<input type="text" data-note="label" value="${s.label || ''}"></label>
    <label>X<input type="number" data-note="x" value="${Math.round(s.x)}"></label>
    <label>Y<input type="number" data-note="y" value="${Math.round(s.y)}"></label>
    ${isLine ? '' : `<label>宽<input type="number" data-note="w" value="${Math.round(s.w)}"></label>
    <label>高<input type="number" data-note="h" value="${Math.round(s.h)}"></label>`}
    <label>功能 / 动画 / 逻辑描述<textarea data-note="note" rows="5">${s.note || ''}</textarea></label>`;
  noteBox.querySelectorAll('[data-note]').forEach(inp => {
    inp.oninput = () => {
      const k = inp.dataset.note;
      s[k] = inp.type === 'number' ? Number(inp.value) : inp.value;
      renderCanvas(dom);
    };
  });
}

function renderAll(dom) {
  renderCanvas(dom);
  renderList(dom);
  renderNote(dom);
}

function bindCanvas(dom) {
  const canvas = dom.wireframeCanvas;
  canvas.addEventListener('pointerdown', e => {
    // 中键 / 右键拖拽 = 平移视图
    if (e.button !== 0) {
      const u = toUI(canvas, e);
      pan = { start: u, ox: view.ox, oy: view.oy };
      e.preventDefault();
      return;
    }
    const p = toDesign(canvas, e);
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (hitShape(s, p)) {
        selected = i;
        drag = { mode: 'move', si: i, start: p, x: s.x, y: s.y };
        renderAll(dom);
        e.preventDefault();
        return;
      }
    }
    selected = -1;
    renderAll(dom);
  });
  window.addEventListener('pointermove', e => {
    if (pan) {
      const u = toUI(canvas, e);
      view.ox = pan.ox + (u.x - pan.start.x);
      view.oy = pan.oy + (u.y - pan.start.y);
      renderCanvas(dom);
      return;
    }
    if (!drag) return;
    const p = toDesign(canvas, e);
    if (drag.mode === 'move') {
      const s = shapes[drag.si];
      if (s) {
        s.x = Math.round(drag.x + (p.x - drag.start.x));
        s.y = Math.round(drag.y + (p.y - drag.start.y));
      }
    }
    renderCanvas(dom);
  });
  window.addEventListener('pointerup', () => { drag = null; pan = null; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const u = toUI(canvas, e);
    const d = { x: (u.x - view.ox) / view.scale, y: (u.y - view.oy) / view.scale };
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const ns = Math.max(0.2, Math.min(40, view.scale * factor));
    view.scale = ns;
    view.ox = u.x - d.x * ns;
    view.oy = u.y - d.y * ns;
    renderCanvas(dom);
  });
}

export function initWireframe(dom) {
  bindCanvas(dom);
  // 下拉：导入已有代码绘制的 UI 页面（工坊/武器/关卡选择/结算）
  if (dom.wireframePageSel) {
    dom.wireframePageSel.innerHTML = '<option value="">导入已有页面…</option>' +
      pageProfiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (dom.wireframePageImport) {
      dom.wireframePageImport.onclick = () => {
        const pageId = dom.wireframePageSel.value;
        if (!pageId) return;
        shapes = profilePage(pageId);
        if (dom.wireframeName && !dom.wireframeName.value.trim()) dom.wireframeName.value = `ui-${pageId}`;
        computeView();
        selected = -1;
        renderAll(dom);
        if (dom.wireframeStatus) dom.wireframeStatus.textContent = `已导入 ${pageId} 页（${shapes.length} 个控件）`;
      };
    }
  }
  dom.wireframeImport.onclick = () => {
    try {
      shapes = parseMxGraph(dom.wireframeXml.value);
      computeView();
      selected = -1;
      renderAll(dom);
      if (dom.wireframeStatus) dom.wireframeStatus.textContent = `已解析 ${shapes.length} 个控件`;
    } catch (err) {
      if (dom.wireframeStatus) dom.wireframeStatus.textContent = err.message;
    }
  };
  dom.wireframeSave.onclick = async () => {
    const name = dom.wireframeName.value.trim() || 'ui-wireframe';
    try {
      await saveUiDesign(name, { name, shapes });
      if (dom.wireframeStatus) dom.wireframeStatus.textContent = `已保存 ${name}`;
      refresh();
    } catch (err) {
      if (dom.wireframeStatus) dom.wireframeStatus.textContent = `保存失败:${err.message}`;
    }
  };
  const refresh = async () => {
    try {
      const { designs } = await listUiDesigns();
      const keep = dom.wireframeSelect.value;
      dom.wireframeSelect.innerHTML = '<option value="">选择已有设计稿…</option>' +
        (designs || []).map(d => `<option value="${d.id}">${d.name || d.id}</option>`).join('');
      if (keep && (designs || []).some(d => d.id === keep)) dom.wireframeSelect.value = keep;
    } catch {}
  };
  dom.wireframeLoad.onclick = async () => {
    const id = dom.wireframeSelect.value;
    if (!id) return;
    try {
      const d = await loadUiDesign(id);
      shapes = d.shapes || [];
      dom.wireframeName.value = d.name || id;
      computeView();
      selected = -1;
      renderAll(dom);
      if (dom.wireframeStatus) dom.wireframeStatus.textContent = `已加载 ${id}`;
    } catch (err) { if (dom.wireframeStatus) dom.wireframeStatus.textContent = `加载失败:${err.message}`; }
  };
  dom.wireframeRefresh.onclick = refresh;
  dom.wireframeDelete.onclick = async () => {
    const id = dom.wireframeSelect.value;
    if (!id) return;
    try {
      await deleteUiDesign(id);
      dom.wireframeSelect.value = '';
      await refresh();
      if (dom.wireframeStatus) dom.wireframeStatus.textContent = `已删除 ${id}`;
    } catch (err) { if (dom.wireframeStatus) dom.wireframeStatus.textContent = `删除失败:${err.message}`; }
  };
  refresh();
  selected = -1;
  renderAll(dom);
}

export function showWireframe(show) {
  document.body.classList.toggle('wireframe-mode', show);
}
