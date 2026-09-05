import { renderUIPreview } from './ui-preview.js';

const MIN_SIZE = 4;   // UI 空间最小尺寸
const HANDLE_SCREEN = 7; // 屏幕像素下的手柄半径

function isCenterR(node) {
  return node.type === 'icon' || (node.type === 'shape' && (node.kind === 'ring' || node.kind === 'arc'));
}

function isResizable(node) {
  if (!node || node.type === 'text') return false;
  if (node.type === 'shape' && node.kind === 'poly') return false;
  if (isCenterR(node)) return true;
  if (node.type === 'shape' && (node.kind === 'parallelogram' || !node.kind || node.kind === 'rect')) return true;
  if (['panel', 'bar', 'button', 'image'].includes(node.type)) return true;
  return false;
}

function nodeBounds(node) {
  const x = node.x ?? 0, y = node.y ?? 0;
  if (node.type === 'shape' && node.kind === 'poly') {
    const pts = node.points || [];
    if (!pts.length) return { left: x, top: y, right: x + 80, bottom: y + 40, cx: x + 40, cy: y + 20, w: 80, h: 40 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const pt of pts) {
      const px = x + pt.x, py = y + pt.y;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
    return { left: minX, top: minY, right: maxX, bottom: maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
  }
  if (node.type === 'text') {
    const size = node.size || 24;
    const text = String(node.text ?? '');
    const w = Math.max(size, text.length * size * 0.55);
    const h = size * 1.2;
    return { left: x, top: y, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2, w, h };
  }
  if (node.type === 'icon') {
    const r = node.r || 16;
    return { left: x - r, top: y - r, right: x + r, bottom: y + r, cx: x, cy: y, w: r * 2, h: r * 2 };
  }
  if (node.type === 'image') {
    const w = node.w || 80, h = node.h || 80;
    return { left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2, cx: x, cy: y, w, h };
  }
  if (node.type === 'shape' && (node.kind === 'ring' || node.kind === 'arc')) {
    const r = node.r || 20;
    return { left: x - r, top: y - r, right: x + r, bottom: y + r, cx: x, cy: y, w: r * 2, h: r * 2 };
  }
  if (node.type === 'shape' && node.kind === 'parallelogram') {
    const w = node.w || 0, h = node.h || 0, skew = node.skew || 0;
    return { left: x, top: y, right: x + w + skew, bottom: y + h, cx: x + (w + skew) / 2, cy: y + h / 2, w: w + skew, h };
  }
  if (node.type === 'shape') {
    const w = node.w || 0, h = node.h || 0;
    return { left: x, top: y, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2, w, h };
  }
  const w = node.w || 0, h = node.h || 0;
  return { left: x, top: y, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2, w, h };
}

function resizeBounds(orig, handle, p) {
  let { left, top, right, bottom } = orig;
  if (handle.includes('e')) right = p.x;
  if (handle.includes('w')) left = p.x;
  if (handle.includes('s')) bottom = p.y;
  if (handle.includes('n')) top = p.y;
  if (right - left < MIN_SIZE) { if (handle.includes('w')) left = right - MIN_SIZE; else right = left + MIN_SIZE; }
  if (bottom - top < MIN_SIZE) { if (handle.includes('n')) top = bottom - MIN_SIZE; else bottom = top + MIN_SIZE; }
  return { left, top, right, bottom };
}

function writeBack(node, b) {
  if (isCenterR(node)) {
    const r = Math.max(1, (b.right - b.left) / 2);
    node.x = Math.round((b.left + b.right) / 2);
    node.y = Math.round((b.top + b.bottom) / 2);
    node.r = Math.round(r);
    return;
  }
  if (node.type === 'image') {
    node.x = Math.round((b.left + b.right) / 2);
    node.y = Math.round((b.top + b.bottom) / 2);
    node.w = Math.max(1, Math.round(b.right - b.left));
    node.h = Math.max(1, Math.round(b.bottom - b.top));
    return;
  }
  if (node.type === 'shape' && node.kind === 'parallelogram') {
    const skew = node.skew || 0;
    node.x = Math.round(b.left);
    node.y = Math.round(b.top);
    node.w = Math.max(1, Math.round(b.right - b.left - skew));
    node.h = Math.max(1, Math.round(b.bottom - b.top));
    return;
  }
  node.x = Math.round(b.left);
  node.y = Math.round(b.top);
  node.w = Math.max(1, Math.round(b.right - b.left));
  node.h = Math.max(1, Math.round(b.bottom - b.top));
}

export class UIEditor {
  constructor(canvas, dom, state, callbacks = {}) {
    this.canvas = canvas;
    this.dom = dom;
    this.state = state;
    this.callbacks = callbacks;
    this.selected = null;
    this.selectedIndex = -1;
    this.drag = null;
    this.nodeListEl = null;
    this.snap = true;
    this.placeOnEmpty = false;
    this._anim = new Map();
    this._hoverId = null;
    this._raf = null;
    this._bind();
  }

  getGraph() {
    return this.state.ui[this.dom.uiGraphSelect.value] || { nodes: [] };
  }

  _bind() {
    this.canvas.addEventListener('pointerdown', e => this._down(e));
    this.canvas.addEventListener('pointermove', e => this._hover(e));
    window.addEventListener('pointermove', e => { if (this.drag) this._drag(e); });
    window.addEventListener('pointerup', () => { if (this.drag) this._up(); });
    this._startLoop();
  }

  _startLoop() {
    if (this._raf) return;
    const tick = () => {
      this._raf = requestAnimationFrame(tick);
      if (!this.canvas.isConnected) return;
      if (!document.body.classList.contains('ui-config-mode')) return;
      this.render();
    };
    this._raf = requestAnimationFrame(tick);
  }

  uiPerScreen() {
    const r = this.canvas.getBoundingClientRect();
    return r.width ? 1920 / r.width : 2;
  }

  toUI(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * 1920 / r.width, y: (e.clientY - r.top) * 1080 / r.height };
  }

  reset() {
    this.selected = null;
    this.selectedIndex = -1;
    this.drag = null;
    this.setNodeListEl(this.nodeListEl);
    this.render();
  }

  selectIndex(i) {
    const g = this.getGraph();
    if (i < 0 || i >= (g.nodes || []).length) return this.reset();
    this.selected = g.nodes[i];
    this.selectedIndex = i;
    this.setNodeListEl(this.nodeListEl);
    this.scrollRow(i);
    this.render();
  }

  setNodeListEl(el) {
    this.nodeListEl = el;
    if (!el) return;
    el.querySelectorAll('.ui-node').forEach(row => {
      row.classList.toggle('selected', Number(row.dataset.node) === this.selectedIndex);
    });
  }

  scrollRow(i) {
    const row = this.nodeListEl?.querySelector(`.ui-node[data-node="${i}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }

  render() {
    const g = this.getGraph();
    renderUIPreview(this.canvas, g, { hoverId: this._hoverId, now: performance.now(), anim: this._anim });
    this.drawOverlay(g);
  }

  _drawSelection(g, ctx) {
    if (!this.selected || this.selected.visible === false) return;
    const b = nodeBounds(this.selected);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2 / (1920 / this.canvas.width);
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    ctx.setLineDash([]);

    if (isResizable(this.selected)) {
      const hr = HANDLE_SCREEN * this.uiPerScreen();
      ctx.fillStyle = '#00e5ff';
      for (const [hx, hy] of this.handlePositions(b)) {
        ctx.fillRect(hx - hr / 2, hy - hr / 2, hr, hr);
      }
    }
    if (this.selected.type === 'shape' && this.selected.kind === 'poly') {
      const hr = HANDLE_SCREEN * this.uiPerScreen();
      ctx.fillStyle = '#ffd54f';
      for (const pt of (this.selected.points || [])) {
        ctx.beginPath();
        ctx.arc(this.selected.x + pt.x, this.selected.y + pt.y, hr / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const label = `${this.selected.id} · ${this.selected.type}`;
    ctx.font = `13px 'Poppins','Noto Sans SC',sans-serif`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,24,37,0.9)';
    ctx.fillRect(b.left, b.top - 22, tw + 10, 18);
    ctx.fillStyle = '#eaf4fb';
    ctx.fillText(label, b.left + 5, b.top - 9);
  }

  drawOverlay(g) {
    const ctx = this.canvas.getContext('2d');
    if (!this.selected) return;
    ctx.save();
    ctx.scale(this.canvas.width / 1920, this.canvas.height / 1080);
    this._drawSelection(g, ctx);
    ctx.restore();
  }

  handlePositions(b) {
    const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    return [
      [b.left, b.top, 'nw'], [cx, b.top, 'n'], [b.right, b.top, 'ne'],
      [b.right, cy, 'e'], [b.right, b.bottom, 'se'], [cx, b.bottom, 's'],
      [b.left, b.bottom, 'sw'], [b.left, cy, 'w']
    ];
  }

  hitHandle(b, p) {
    if (!isResizable(this.selected)) return null;
    const hr = HANDLE_SCREEN * this.uiPerScreen();
    for (const [hx, hy, name] of this.handlePositions(b)) {
      if (Math.abs(p.x - hx) <= hr && Math.abs(p.y - hy) <= hr) return name;
    }
    return null;
  }

  hitNode(g, p) {
    const nodes = g.nodes || [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.visible === false) continue;
      const b = nodeBounds(n);
      if (p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom) return { node: n, index: i };
    }
    return null;
  }

  _down(e) {
    const g = this.getGraph();
    const p = this.toUI(e);
    if (this.selected && this.selected.type === 'shape' && this.selected.kind === 'poly') {
      const node = this.selected;
      const pts = node.points || [];
      const hr = HANDLE_SCREEN * this.uiPerScreen();
      for (let i = 0; i < pts.length; i++) {
        const px = node.x + pts[i].x, py = node.y + pts[i].y;
        if (Math.abs(p.x - px) <= hr && Math.abs(p.y - py) <= hr) {
          this.drag = { mode: 'point', idx: i, node, snapVal: this.val(node) };
          e.preventDefault();
          return;
        }
      }
    }
    if (this.selected && this.selected.visible !== false) {
      const b = nodeBounds(this.selected);
      const handle = this.hitHandle(b, p);
      if (handle) {
        this.drag = { mode: 'resize', handle, node: this.selected, orig: { ...b }, snapVal: this.val(this.selected) };
        e.preventDefault();
        return;
      }
    }
    const hit = this.hitNode(g, p);
    if (hit) {
      this.selectIndex(hit.index);
      this.drag = { mode: 'move', start: p, node: hit.node, origX: hit.node.x ?? 0, origY: hit.node.y ?? 0, snapVal: this.val(hit.node) };
      e.preventDefault();
      return;
    }
    if (this.placeOnEmpty) { this.callbacks?.onPlaceEmpty?.(p); return; }
    this.reset();
  }

  _hover(e) {
    if (this.drag) return;
    const g = this.getGraph();
    const p = this.toUI(e);
    let hoverId = null;
    for (const n of (g.nodes || [])) {
      if (n.visible === false || !n.interact?.hover) continue;
      const b = nodeBounds(n);
      if (p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom) { hoverId = n.id; break; }
    }
    if (hoverId !== this._hoverId) { this._hoverId = hoverId; this.render(); }
    if (this.selected && this.selected.visible !== false) {
      const hn = this.hitHandle(nodeBounds(this.selected), p);
      if (hn) { this.canvas.style.cursor = 'crosshair'; return; }
    }
    this.canvas.style.cursor = this.hitNode(g, p) ? 'move' : 'default';
  }

  _drag(e) {
    const p = this.toUI(e);
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'move') {
      let nx = d.origX + (p.x - d.start.x);
      let ny = d.origY + (p.y - d.start.y);
      nx = this.snap ? Math.round(nx / 4) * 4 : Math.round(nx);
      ny = this.snap ? Math.round(ny / 4) * 4 : Math.round(ny);
      d.node.x = nx;
      d.node.y = ny;
    } else if (d.mode === 'resize') {
      writeBack(d.node, resizeBounds(d.orig, d.handle, p));
    } else if (d.mode === 'point') {
      let px = p.x - d.node.x, py = p.y - d.node.y;
      if (this.snap) { px = Math.round(px / 4) * 4; py = Math.round(py / 4) * 4; }
      else { px = Math.round(px); py = Math.round(py); }
      d.node.points[d.idx].x = px;
      d.node.points[d.idx].y = py;
    }
    this.writeNodeToForm();
    this.render();
  }

  val(node) {
    return `${node.x},${node.y},${node.w},${node.h},${node.r},${JSON.stringify(node.points || [])}`;
  }

  _up() {
    const changed = this.val(this.drag.node) !== this.drag.snapVal;
    this.drag = null;
    if (changed) this.callbacks?.onDirty?.();
  }

  writeNodeToForm() {
    if (!this.nodeListEl || !this.selected) return;
    const row = this.nodeListEl.querySelector(`.ui-node[data-node="${this.selectedIndex}"]`);
    if (!row) return;
    row.querySelectorAll('[data-key]').forEach(input => {
      const key = input.dataset.key;
      if (input.type === 'number' && typeof this.selected[key] === 'number' && document.activeElement !== input) {
        input.value = this.selected[key];
      }
    });
  }
}

let singleton = null;

export function initUIEditor(dom, state, callbacks = {}) {
  if (!singleton) {
    singleton = new UIEditor(dom.uiPreviewCanvas, dom, state, callbacks);
    const aside = dom.uiPreviewCanvas.parentElement;
    if (aside && !aside.querySelector('.ui-editor-toolbar')) {
      const toolbar = document.createElement('div');
      toolbar.className = 'ui-editor-toolbar';
      toolbar.innerHTML = `
        <label><input type="checkbox" data-editor="snap" checked> 4px 吸附</label>
        <label><input type="checkbox" data-editor="place"> 点击空白放置所选类型</label>
        <span class="hint">拖动移动 · 拖角/边缩放 · 点击选中 · 空白取消</span>`;
      aside.insertBefore(toolbar, dom.uiPreviewCanvas);
      toolbar.querySelector('[data-editor="snap"]').onchange = e => { singleton.snap = e.target.checked; };
      toolbar.querySelector('[data-editor="place"]').onchange = e => { singleton.placeOnEmpty = e.target.checked; };
    }
  } else {
    singleton.callbacks = callbacks;
  }
  return singleton;
}

export function getUIEditor() {
  return singleton;
}
