// ============================================================
// 画板工作台（独立页面，仿 UI 配置页）。
// 职责：Canvas 实时预览一组绕圆心转动的多边形/圆弧；左侧元素列表编辑；
//       画布交互（拖元素调整轨道、手柄缩放）；保存/载入设计稿（/api/assets）。
//       独立画板（轮廓绘制弹层）全量逻辑在 ./draw-board.js，本文件只接线。
// 分类：引擎编辑器需求
// 导出：showArtboard, initArtboard, getArtboardDesign
// ============================================================
import { listAssets, loadAsset, saveAsset, listOutlines, loadOutline, deleteOutline, listPixels, loadPixel, deletePixel } from '../api.js';
import { setStatus } from '../ui.js';
import { makeG, normalizeDesign, renderAsset, elementCenter, normalizeElement, normalizeOutline } from '../systems/art/asset-render.js';
import { registerDesign, refreshArtChoices } from '../systems/art/design-store.js';
import { buildAllDefaultArt } from '../systems/art/default-art.js';
import { openDrawBoard } from './draw-board.js';
import { openPixelBoard } from './pixel-board.js';

function numberField(label, key, value, step = 1) {
  return `<label>${label}<input data-key="${key}" type="number" step="${step}" value="${value ?? ''}"></label>`;
}
function textField(label, key, value) {
  return `<label>${label}<input data-key="${key}" type="text" value="${value ?? ''}"></label>`;
}
function colorField(label, key, value) {
  return `<label>${label}<input data-key="${key}" type="color" value="${value || '#ffffff'}"></label>`;
}
function selectField(label, key, value, options) {
  const opts = options.map(o =>
    `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`
  ).join('');
  return `<label>${label}<select data-key="${key}">${opts}</select></label>`;
}

function dirField(el) {
  return selectField('旋转方向', 'dir', String(el.dir ?? 1), [
    { value: '1', label: '逆时针' }, { value: '-1', label: '顺时针' }
  ]);
}

function elementFields(el) {
  const shapeField = selectField('形状', 'shape', el.shape, [
    { value: 'polygon', label: '多边形' }, { value: 'arc', label: '圆弧' }, { value: 'stroke', label: '轮廓' }, { value: 'pixel', label: '像素' }
  ]);
  if (el.shape === 'stroke') {
    return [
      shapeField,
      numberField('数量(组)', 'count', el.count, 1),
      colorField('颜色', 'color', el.color),
      numberField('粗细', 'lineWidth', el.lineWidth, 1),
      numberField('旋转角速度', 'rotSpeed', el.rotSpeed, 0.05),
      dirField(el),
      numberField('轨道半径', 'orbitRadius', el.orbitRadius, 5),
      numberField('初始相位°', 'phaseDeg', Math.round((el.phase * 180 / Math.PI) * 100) / 100, 5),
      colorField('填充色', 'fill', el.fill || '#ffa914'),
      `<label class="checkbox"><input data-key="closed" type="checkbox" ${el.closed ? 'checked' : ''}> 闭合</label>`,
      `<p class="hint">轮廓点：${el.points.length} 个（点「绘制/编辑轮廓」在独立画板里画）</p>`,
      `<label class="checkbox"><input data-key="fillOn" type="checkbox" ${el.fill ? 'checked' : ''}> 填充</label>`
    ];
  }
  if (el.shape === 'arc') {
    const fields = [
      shapeField,
      numberField('数量(组)', 'count', el.count, 1),
      numberField('轨道半径', 'orbitRadius', el.orbitRadius, 5),
      numberField('半径', 'radius', el.radius, 5),
      numberField('粗细', 'lineWidth', el.lineWidth, 1),
      colorField('颜色', 'color', el.color),
      numberField('旋转角速度', 'rotSpeed', el.rotSpeed, 0.05),
      dirField(el),
      numberField('初始相位°', 'phaseDeg', Math.round((el.phase * 180 / Math.PI) * 100) / 100, 5),
      numberField('弧形起始°', 'arcStart', el.arcStart, 5),
      numberField('弧形结束°', 'arcEnd', el.arcEnd, 5),
      selectField('显示形式', 'pattern', el.pattern || 'plain', [
        { value: 'plain', label: '普通圆弧' }, { value: 'clock', label: '钟表表盘' }, { value: 'hands', label: '长短针' }
      ])
    ];
    if (el.pattern === 'clock') {
      fields.push(
        numberField('长针长度', 'tickLongLen', el.tickLongLen, 1),
        numberField('短针长度', 'tickShortLen', el.tickShortLen, 1),
        numberField('刻度密度(总针数)', 'tickDensity', el.tickDensity, 1),
        numberField('长短针比例(每1长配N短)', 'tickRatio', el.tickRatio, 1),
        selectField('刻度方向', 'tickDir', el.tickDir || 'in', [
          { value: 'in', label: '朝圆心' }, { value: 'out', label: '向外' }, { value: 'both', label: '双向' }
        ])
      );
    }
    if (el.pattern === 'hands') {
      fields.push(
        numberField('长针轨道半径', 'handLongRadius', el.handLongRadius, 5),
        numberField('短针轨道半径', 'handShortRadius', el.handShortRadius, 5),
        colorField('长针颜色', 'handLongColor', el.handLongColor || el.color),
        colorField('短针颜色', 'handShortColor', el.handShortColor || el.color),
        numberField('长针长度', 'tickLongLen', el.tickLongLen, 1),
        numberField('短针长度', 'tickShortLen', el.tickShortLen, 1),
        numberField('刻度密度(总针数)', 'tickDensity', el.tickDensity, 1),
        numberField('长短针比例(每1长配N短)', 'tickRatio', el.tickRatio, 1),
        selectField('刻度方向', 'tickDir', el.tickDir || 'in', [
          { value: 'in', label: '朝圆心' }, { value: 'out', label: '向外' }, { value: 'both', label: '双向' }
        ])
      );
    }
    return fields;
  }
  if (el.shape === 'pixel') {
    return [
      shapeField,
      numberField('列数', 'cols', el.cols, 1),
      numberField('行数', 'rows', el.rows, 1),
      numberField('格宽', 'cellSize', el.cellSize, 1),
      colorField('网格颜色', 'gridColor', el.gridColor),
      numberField('旋转角速度', 'rotSpeed', el.rotSpeed, 0.05),
      dirField(el),
      numberField('初始相位°', 'phaseDeg', Math.round((el.phase * 180 / Math.PI) * 100) / 100, 5),
      numberField('轨道半径', 'orbitRadius', el.orbitRadius, 5),
      `<p class="hint">像素：${(el.cells || []).length} 格（点「像素画板」在独立弹层里画）</p>`
    ];
  }
  return [
    shapeField,
    numberField('数量(组)', 'count', el.count, 1),
    numberField('轨道半径', 'orbitRadius', el.orbitRadius, 5),
    numberField('半径', 'radius', el.radius, 5),
    numberField('边数', 'sides', el.sides, 1),
    numberField('粗细', 'lineWidth', el.lineWidth, 1),
    colorField('颜色', 'color', el.color),
    colorField('填充', 'fill', el.fill || '#000000'),
    numberField('旋转角速度', 'rotSpeed', el.rotSpeed, 0.05),
    dirField(el),
    numberField('初始相位°', 'phaseDeg', Math.round((el.phase * 180 / Math.PI) * 100) / 100, 5)
  ];
}

function elementRow(el, index) {
  const label = el.shape === 'arc' ? '圆弧' : el.shape === 'stroke' ? '轮廓' : el.shape === 'pixel' ? '像素' : '多边形';
  const fillOn = el.shape === 'stroke' ? ''
    : `<label class="inline"><input data-key="fillOn" type="checkbox" ${el.fill ? 'checked' : ''}> 填充</label>`;
  return `<div class="art-element" data-index="${index}">
    <div class="art-element-head">
      <strong>${label} ${index + 1}</strong>
      ${fillOn}
      <button class="art-element-del" data-del="${index}">删除</button>
    </div>
    <div class="art-element-body">${elementFields(el).join('')}</div>
  </div>`;
}

// 模块级状态：当前设计稿 / 选中元素 / 拖拽态 / 模拟时间
let design = null;
let selectedIndex = null;   // 选中元素下标（-1 = 无）
let drag = null;            // { mode:'move'|'scale'|'stroke-scale'|'stroke-rotate', index }
let simT = 0;
let raf = null;
let viewScale = 1;

function syncNameInput(dom) { if (dom.artboardName) dom.artboardName.value = design?.name || ''; }
function syncBgColor(dom) { if (dom.artBgColor) dom.artBgColor.value = design?.bgColor || '#0a1220'; }

function canvasPoint(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height)
  };
}
function pivot(canvas) { return { x: canvas.width / 2, y: canvas.height / 2 }; }

function clampCellSize(v) { return Math.max(1, Math.min(2000, v)); }

function rimPoint(canvas, el, index, center) {
  // polygon：沿第 i 个副本当前公转角方向的半径边缘，作为缩放手柄
  const r = Math.max(1, (center.el || el).radius * center.worldScale);
  return {
    x: center.x + Math.cos(center.angle) * r,
    y: center.y + Math.sin(center.angle) * r
  };
}

// stroke：点集重心 + 最远点距离（原始点坐标，设计单位；选中圈/缩放/旋转手柄用）
function strokeBounds(el) {
  const pts = (el && el.points) || [];
  let mcx = 0, mcy = 0;
  if (pts.length) { for (const p of pts) { mcx += p.x; mcy += p.y; } mcx /= pts.length; mcy /= pts.length; }
  let maxDist = 0;
  for (const p of pts) maxDist = Math.max(maxDist, Math.hypot(p.x - mcx, p.y - mcy));
  return { mcx, mcy, maxDist };
}

function hitElement(canvas, px, py) {
  const p = pivot(canvas);
  let best = null;
  design.elements.forEach((el, ei) => {
    const count = el.count;
    for (let i = 0; i < count; i++) {
      const c = elementCenter(design, el, i, p.x, p.y, simT, viewScale);
      const d = Math.hypot(px - c.x, py - c.y);
      if (d <= 16 && (!best || d < best.d)) best = { ei, d };
    }
  });
  return best ? best.ei : -1;
}

function draw(canvas, dom) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = design?.bgColor || '#0a1220';
  ctx.fillRect(0, 0, w, h);

  const p = pivot(canvas);
  const g = makeG(ctx);

  // 参考网格
  ctx.strokeStyle = 'rgba(47,90,122,0.18)';
  ctx.lineWidth = 1;
  const step = 30;
  for (let x = p.x % step; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = p.y % step; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

  // 圆心十字
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(p.x - 10, p.y); ctx.lineTo(p.x + 10, p.y); ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x, p.y + 10); ctx.stroke();

  renderAsset(g, design, p.x, p.y, simT, viewScale);

  // 选中元素：轨道参考环 + 选中高亮 + 缩放手柄
  if (selectedIndex >= 0 && design.elements[selectedIndex]) {
    const el = design.elements[selectedIndex];
    const count = el.count;
    if (el.orbitRadius > 0) {
      ctx.strokeStyle = 'rgba(255,224,131,0.5)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.1, el.orbitRadius * viewScale * design.scale), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    for (let i = 0; i < count; i++) {
      const c = elementCenter(design, el, i, p.x, p.y, simT, viewScale);
      if (el.shape === 'arc') {
        ctx.strokeStyle = 'rgba(255,224,131,1)';
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(0.1, el.radius * c.worldScale), 0, Math.PI * 2); ctx.stroke();
      } else if (el.shape === 'stroke') {
        // stroke：选中参考圈 = 重心最远点距离的虚线圈（不画无意义的 el.radius 圈）；rim 缩放手柄 + 外侧旋转手柄
        const r = Math.max(0.1, strokeBounds(c.el || el).maxDist * c.worldScale);
        ctx.strokeStyle = 'rgba(255,224,131,0.5)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffe083';
        ctx.beginPath(); ctx.arc(c.x + Math.cos(c.angle) * r, c.y + Math.sin(c.angle) * r, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffe083';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x + Math.cos(c.angle) * (r + 24), c.y + Math.sin(c.angle) * (r + 24), 5, 0, Math.PI * 2); ctx.stroke();
      } else if (el.shape === 'pixel') {
        // pixel：网格居中于 c；选中圈 = max(hw,hh) 虚线圈，rim 缩放手柄在对角距 maxR 处，外延 24px 旋转手柄
        const hw = ((el.cols || 1) * (el.cellSize || 1) / 2) * c.worldScale;
        const hh = ((el.rows || 1) * (el.cellSize || 1) / 2) * c.worldScale;
        const selR = Math.max(hw, hh);
        const maxR = Math.hypot(hw, hh);
        ctx.strokeStyle = 'rgba(255,224,131,0.5)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(0.1, selR), 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffe083';
        ctx.beginPath(); ctx.arc(c.x + Math.cos(c.angle) * maxR, c.y + Math.sin(c.angle) * maxR, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffe083';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x + Math.cos(c.angle) * (maxR + 24), c.y + Math.sin(c.angle) * (maxR + 24), 5, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,224,131,1)';
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(0.1, el.radius * c.worldScale), 0, Math.PI * 2); ctx.stroke();
        const rim = rimPoint(canvas, el, i, c);
        ctx.fillStyle = '#ffe083';
        ctx.beginPath(); ctx.arc(rim.x, rim.y, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

function startLoop(canvas) {
  if (raf) return;
  const tick = () => {
    if (!canvas || !canvas.isConnected) { raf = null; return; }
    simT += 0.016;
    draw(canvas, null);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

function shapeLabel(s) { return s === 'arc' ? '圆弧' : s === 'stroke' ? '轮廓' : s === 'pixel' ? '像素' : '多边形'; }

function populateCopySelect(dom) {
  if (!dom.artCopySelect) return;
  dom.artCopySelect.innerHTML = '<option value="">选择要复制的元素…</option>' +
    design.elements.map((e, i) => `<option value="${i}">${i + 1}. ${shapeLabel(e.shape)}</option>`).join('');
}

function renderElementList(dom) {
  dom.artElementList.innerHTML = design.elements.map(elementRow).join('');
  populateCopySelect(dom);

  dom.artElementList.querySelectorAll('.art-element').forEach(el => {
    const index = Number(el.dataset.index);

    el.addEventListener('click', e => {
      const t = e.target;
      if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'BUTTON') return;
      if (selectedIndex !== index) { selectedIndex = index; draw(dom.artPreviewCanvas, dom); }
    });

    el.querySelectorAll('[data-key]').forEach(input => {
      input.oninput = () => {
        const key = input.dataset.key;
        const item = design.elements[index];
        if (key === 'fillOn') { item.fill = input.checked ? (item.fill || '#ffa914') : null; renderElementList(dom); draw(dom.artPreviewCanvas, dom); return; }
        if (key === 'closed') { item.closed = input.checked; draw(dom.artPreviewCanvas, dom); return; }
        if (key === 'shape') {
          item.shape = input.value;
          if (item.shape === 'arc' || item.shape === 'stroke') { item.count = 1; item.orbitRadius = 0; }
          renderElementList(dom); draw(dom.artPreviewCanvas, dom); return;
        }
        if (key === 'pattern') {
          item.pattern = input.value;
          renderElementList(dom); draw(dom.artPreviewCanvas, dom); return;
        }
        if (key === 'phaseDeg') { item.phase = (Number(input.value) || 0) * Math.PI / 180; draw(dom.artPreviewCanvas, dom); return; }
        if (key === 'dir') { item.dir = Number(input.value) < 0 ? -1 : 1; draw(dom.artPreviewCanvas, dom); return; }
        item[key] = input.type === 'checkbox' ? input.checked : (input.type === 'color' ? input.value : (input.type === 'number' ? Number(input.value) : input.value));
        draw(dom.artPreviewCanvas, dom);
      };
    });

    el.querySelector('.art-element-del').onclick = e => {
      e.stopPropagation();
      design.elements.splice(index, 1);
      if (selectedIndex >= design.elements.length) selectedIndex = design.elements.length - 1;
      if (selectedIndex < 0) selectedIndex = -1;
      renderElementList(dom);
    };
  });
}

function defaultDesign() {
  return normalizeDesign({
    id: `asset-${Date.now()}`,
    name: '旋转多边形组',
    scale: 1,
    elements: [
      normalizeElement({ shape: 'polygon', count: 6, orbitRadius: 150, radius: 34, sides: 5, lineWidth: 5, color: '#ffa914', fill: null, rotSpeed: 0.5, phase: 0 })
    ]
  });
}

function emptyDesign() {
  return normalizeDesign({ id: `asset-${Date.now()}`, name: '未命名设计', scale: 1, elements: [] });
}

let currentDesignId = null;

function refreshAssetSelect(dom, keepId) {
  return listAssets().then(res => {
    const raw = (res && res.assets) || [];
    // 兼容两种返回：旧版 server 给 [id, ...]，新版给 [{id,name}, ...]
    const valid = raw
      .map(a => typeof a === 'string' ? { id: a, name: a } : a)
      .filter(a => a && a.id && a.id !== 'undefined');
    dom.artAssetSelect.innerHTML = '<option value="">（新建）</option>' +
      valid.map(a => `<option value="${a.id}">${a.name || a.id}</option>`).join('');
    if (keepId && valid.some(a => a.id === keepId)) dom.artAssetSelect.value = keepId;
    return valid;
  }).catch(() => { dom.artAssetSelect.innerHTML = '<option value="">（读取失败）</option>'; return []; });
}

// 轮廓库下拉（/api/outlines）；keepId 用于刷新后保留选中项
function refreshOutlineSelect(dom, keepId) {
  if (!dom.artOutlineSelect) return;
  listOutlines().then(res => {
    const valid = ((res && res.outlines) || [])
      .map(a => typeof a === 'string' ? { id: a, name: a } : a)
      .filter(a => a && a.id && a.id !== 'undefined');
    dom.artOutlineSelect.innerHTML = '<option value="">选择已保存轮廓…</option>' +
      valid.map(a => `<option value="${a.id}">${a.name || a.id}</option>`).join('');
    if (keepId && valid.some(a => a.id === keepId)) dom.artOutlineSelect.value = keepId;
  }).catch(() => { dom.artOutlineSelect.innerHTML = '<option value="">（读取失败）</option>'; });
}

// 像素库下拉（/api/pixels）；keepId 用于刷新后保留选中项
function refreshPixelSelect(dom, keepId) {
  if (!dom.artPixelSelect) return;
  listPixels().then(res => {
    const valid = ((res && res.pixels) || [])
      .map(a => typeof a === 'string' ? { id: a, name: a } : a)
      .filter(a => a && a.id && a.id !== 'undefined');
    dom.artPixelSelect.innerHTML = '<option value="">选择已保存像素…</option>' +
      valid.map(a => `<option value="${a.id}">${a.name || a.id}</option>`).join('');
    if (keepId && valid.some(a => a.id === keepId)) dom.artPixelSelect.value = keepId;
  }).catch(() => { dom.artPixelSelect.innerHTML = '<option value="">（读取失败）</option>'; });
}

function selectDesign(dom, assetId) {
  if (!assetId || assetId === 'undefined' || /^\s*$/.test(assetId)) {
    design = emptyDesign(); selectedIndex = -1; currentDesignId = null;
    renderElementList(dom); syncNameInput(dom); syncBgColor(dom); draw(dom.artPreviewCanvas, dom); return;
  }
  loadAsset(assetId).then(d => {
    design = normalizeDesign(d);
    currentDesignId = assetId;
    selectedIndex = 0;
    renderElementList(dom);
    syncNameInput(dom);
    syncBgColor(dom);
    draw(dom.artPreviewCanvas, dom);
  }).catch(() => setStatus(dom, '设计稿读取失败', true));
}

export function getArtboardDesign() { return design; }

export function showArtboard(show, dom, state) {
  document.body.classList.toggle('artboard-mode', show);
  if (show) {
    if (!design) {
      design = defaultDesign();
      currentDesignId = design.id;
      refreshAssetSelect(dom).then(() => renderElementList(dom));
    }
    syncViewScale(dom, dom.artPreviewCanvas.width, dom.artPreviewCanvas.height);
    renderElementList(dom);
    syncNameInput(dom);
    syncBgColor(dom);
    refreshArtChoices();
    refreshOutlineSelect(dom);
    refreshPixelSelect(dom);
    startLoop(dom.artPreviewCanvas);
  } else {
    stopLoop();
  }
}

function syncViewScale(dom, w, h) {
  // 视图比例：让设计稿以 1:1 设计单位显示，轨道半径/半径等数值即像素
  viewScale = 1;
}

export function initArtboard(dom, state) {
  const canvas = dom.artPreviewCanvas;

  dom.artboardBack.onclick = () => showArtboard(false, dom, state);
  dom.artNew.onclick = () => { design = defaultDesign(); currentDesignId = design.id; selectedIndex = 0; renderElementList(dom); syncNameInput(dom); syncBgColor(dom); };
  if (dom.artboardName) {
    dom.artboardName.oninput = e => { if (design) design.name = e.target.value; };
  }
  if (dom.artBgColor) {
    dom.artBgColor.oninput = e => { if (design) design.bgColor = e.target.value; };
  }
  dom.artDraw.onclick = () => openDrawBoard(dom, design, {
    getSelectedIndex: () => selectedIndex,
    onDone: idx => { if (idx != null) selectedIndex = idx; renderElementList(dom); },
    onSaved: () => refreshOutlineSelect(dom)
  });
  dom.artPixel.onclick = () => openPixelBoard(dom, design, {
    getSelectedIndex: () => selectedIndex,
    onDone: idx => { if (idx != null) selectedIndex = idx; renderElementList(dom); },
    onSaved: () => refreshPixelSelect(dom)
  });
  dom.artCopyOther.onclick = () => {
    const src = Number(dom.artCopySelect.value);
    if (Number.isNaN(src) || !design.elements[src]) { setStatus(dom, '请先选择要复制的元素', true); return; }
    const copy = structuredClone(design.elements[src]);
    copy.phase = (Number(copy.phase) || 0) + 0.4; // 错开相位，避免与源完全重叠
    if (copy.shape === 'polygon') copy.orbitRadius = (Number(copy.orbitRadius) || 0) + 24;
    design.elements.push(copy);
    selectedIndex = design.elements.length - 1;
    renderElementList(dom);
  };
  dom.artElementAdd.onclick = () => {
    design.elements.push(normalizeElement({ shape: 'polygon', count: 1, orbitRadius: 120, radius: 30, sides: 6, lineWidth: 4, color: '#4fc3f7', fill: null, rotSpeed: 0.5 }));
    selectedIndex = design.elements.length - 1;
    renderElementList(dom);
  };
  dom.artAddOutline.onclick = async () => {
    const id = dom.artOutlineSelect.value;
    if (!id) { setStatus(dom, '请先在下拉中选择轮廓', true); return; }
    try {
      const o = normalizeOutline(await loadOutline(id));
      design.elements.push(normalizeElement({ shape: 'stroke', points: o.points, color: o.color, lineWidth: o.lineWidth, closed: o.closed, fill: o.fill, rotSpeed: 0.5, phase: 0, orbitRadius: 0 }));
      selectedIndex = design.elements.length - 1;
      renderElementList(dom);
      setStatus(dom, `已从轮廓库添加：${o.name}`);
    } catch (e) { setStatus(dom, '轮廓读取失败', true); }
  };
  dom.artDeleteOutline.onclick = async () => {
    const id = dom.artOutlineSelect.value;
    if (!id) { setStatus(dom, '请先在下拉中选择要删除的轮廓', true); return; }
    try {
      await deleteOutline(id);
      setStatus(dom, `已删除轮廓：${id}`);
      refreshOutlineSelect(dom);
    } catch (e) { setStatus(dom, '轮廓删除失败', true); }
  };
  dom.artAddPixel.onclick = async () => {
    const id = dom.artPixelSelect.value;
    if (!id) { setStatus(dom, '请先在下拉中选择像素设计稿', true); return; }
    try {
      const p = await loadPixel(id);
      design.elements.push(normalizeElement({ shape: 'pixel', cols: p.cols, rows: p.rows, cellSize: p.cellSize, gridColor: p.gridColor || null, cells: p.cells, rotSpeed: p.rotSpeed || 0, phase: p.phase || 0, dir: p.dir ?? 1, orbitRadius: p.orbitRadius || 0 }));
      selectedIndex = design.elements.length - 1;
      renderElementList(dom);
      setStatus(dom, `已从像素库添加：${p.name}`);
    } catch (e) { setStatus(dom, '像素读取失败', true); }
  };
  dom.artDeletePixel.onclick = async () => {
    const id = dom.artPixelSelect.value;
    if (!id) { setStatus(dom, '请先在下拉中选择要删除的像素', true); return; }
    try {
      await deletePixel(id);
      setStatus(dom, `已删除像素：${id}`);
      refreshPixelSelect(dom);
    } catch (e) { setStatus(dom, '像素删除失败', true); }
  };
  dom.artAssetSelect.onchange = () => selectDesign(dom, dom.artAssetSelect.value);
  dom.artSave.onclick = async () => {
    const id = (currentDesignId && currentDesignId !== 'undefined') ? currentDesignId
      : (design.id && design.id !== 'undefined' ? design.id : `asset-${Date.now()}`);
    currentDesignId = id;
    if (!design.name) design.name = id;
    await saveAsset(id, design).then(() => setStatus(dom, '设计稿已保存')).catch(e => setStatus(dom, `保存失败：${e.message}`, true));
    await refreshAssetSelect(dom, id);
  };
  dom.artGenDefaults.onclick = async () => {
    const all = buildAllDefaultArt();
    for (const [id, d] of Object.entries(all)) {
      const design = normalizeDesign({ ...d, id });
      await saveAsset(id, design).then(() => registerDesign(id, design)).catch(() => {});
    }
    await refreshArtChoices();
    await refreshAssetSelect(dom);
    setStatus(dom, '默认美术方案已生成（可在玩家/敌人面板选用）');
  };

  canvas.addEventListener('pointerdown', e => {
    const pt = canvasPoint(canvas, e);
    const p = pivot(canvas);

    // 优先命中已选中的缩放/旋转手柄（polygon / stroke）
    if (selectedIndex >= 0 && design.elements[selectedIndex]) {
      const el = design.elements[selectedIndex];
      if (el.shape === 'polygon') {
        const c = elementCenter(design, el, 0, p.x, p.y, simT, viewScale);
        const rim = rimPoint(canvas, el, 0, c);
        if (Math.hypot(pt.x - rim.x, pt.y - rim.y) <= 14) { drag = { mode: 'scale', index: selectedIndex }; canvas.setPointerCapture(e.pointerId); return; }
      } else if (el.shape === 'stroke') {
        // stroke：旋转手柄（≤12）→ 缩放手柄（≤14）；锚点/方位角用 elementCenter 现算
        const c = elementCenter(design, el, 0, p.x, p.y, simT, viewScale);
        const b = strokeBounds(c.el || el);
        const maxDistWorld = b.maxDist * c.worldScale;
        const rx = Math.cos(c.angle), ry = Math.sin(c.angle);
        const rot = { x: c.x + rx * (maxDistWorld + 24), y: c.y + ry * (maxDistWorld + 24) };
        const rim = { x: c.x + rx * maxDistWorld, y: c.y + ry * maxDistWorld };
        if (Math.hypot(pt.x - rot.x, pt.y - rot.y) <= 12) {
          drag = { mode: 'stroke-rotate', index: selectedIndex, startMaxDist: maxDistWorld, maxDistWorld };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        if (Math.hypot(pt.x - rim.x, pt.y - rim.y) <= 14) {
          drag = { mode: 'stroke-scale', index: selectedIndex, startDist: Math.hypot(pt.x - c.x, pt.y - c.y), startMaxDist: maxDistWorld, origPoints: structuredClone(el.points), startCx: b.mcx, startCy: b.mcy };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      } else if (el.shape === 'pixel') {
        // pixel：旋转手柄（≤12）→ 缩放手柄（≤14）；缩放围绕网格中心（单元格坐标系原点 = 元素中心 c）
        const hw = ((el.cols || 1) * (el.cellSize || 1) / 2) * c.worldScale;
        const hh = ((el.rows || 1) * (el.cellSize || 1) / 2) * c.worldScale;
        const maxR = Math.hypot(hw, hh);
        const rx = Math.cos(c.angle), ry = Math.sin(c.angle);
        const rot = { x: c.x + rx * (maxR + 24), y: c.y + ry * (maxR + 24) };
        const rim = { x: c.x + rx * maxR, y: c.y + ry * maxR };
        if (Math.hypot(pt.x - rot.x, pt.y - rot.y) <= 12) {
          drag = { mode: 'pixel-rotate', index: selectedIndex };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
        if (Math.hypot(pt.x - rim.x, pt.y - rim.y) <= 14) {
          drag = { mode: 'pixel-scale', index: selectedIndex, startDist: Math.hypot(pt.x - c.x, pt.y - c.y), startCellSize: el.cellSize || 8 };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    const hit = hitElement(canvas, pt.x, pt.y);
    if (hit >= 0) {
      selectedIndex = hit;
      drag = { mode: 'move', index: hit };
      canvas.setPointerCapture(e.pointerId);
    } else {
      selectedIndex = -1;
      drag = null;
    }
    renderElementList(dom);
  });

  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const pt = canvasPoint(canvas, e);
    const p = pivot(canvas);
    const el = design.elements[drag.index];

    if (drag.mode === 'move') {
      const dx = pt.x - p.x, dy = pt.y - p.y;
      const dist = Math.hypot(dx, dy) / viewScale;
      if (el.shape === 'arc') {
        el.radius = Math.max(1, dist);
      } else {
        el.orbitRadius = Math.max(0, dist);
        el.phase = Math.atan2(dy, dx) - simT * el.rotSpeed * (el.dir || 1);
      }
    } else if (drag.mode === 'scale' && el.shape === 'polygon') {
      const c = elementCenter(design, el, 0, p.x, p.y, simT, viewScale);
      el.radius = Math.max(1, Math.hypot(pt.x - c.x, pt.y - c.y) / viewScale);
    } else if (drag.mode === 'stroke-scale' && el.shape === 'stroke') {
      // 以拖起时重心为原点等比缩放点集（f 即 k，origPoints 就是拖起时状态）；k 下限保底新 maxDist ≥ 2px
      const c = elementCenter(design, el, 0, p.x, p.y, simT, viewScale);
      const d = Math.hypot(pt.x - c.x, pt.y - c.y);
      const kLo = Math.max(0.05, 2 / Math.max(drag.startMaxDist, 0.0001));
      const k = Math.min(50, Math.max(kLo, d / Math.max(drag.startDist, 1)));
      design.elements[drag.index].points = drag.origPoints.map(o => ({
        x: drag.startCx + (o.x - drag.startCx) * k,
        y: drag.startCy + (o.y - drag.startCy) * k
      }));
    } else if (drag.mode === 'stroke-rotate' && el.shape === 'stroke') {
      // 手柄方位角 → 5° 吸附 → 反推 phase（ga = phase + rotSpeed*t*dir，扣除当前 simT 转角）
      const c = elementCenter(design, el, 0, p.x, p.y, simT, viewScale);
      const ga = Math.round(Math.atan2(pt.y - c.y, pt.x - c.x) * 180 / Math.PI / 5) * 5 * Math.PI / 180;
      design.elements[drag.index].phase = ga - simT * el.rotSpeed * (el.dir || 1);
    } else if (drag.mode === 'pixel-scale' && el.shape === 'pixel') {
      // 围绕网格几何中心等比缩放 cellSize（格索引保持不变 → 像素始终对齐网格，无锯齿错位）
      const c = elementCenter(design, el, 0, p.x, p.y, simT, viewScale);
      const d = Math.hypot(pt.x - c.x, pt.y - c.y);
      const k = Math.min(50, Math.max(0.05, d / Math.max(drag.startDist, 1)));
      design.elements[drag.index].cellSize = clampCellSize((drag.startCellSize || 8) * k);
    } else if (drag.mode === 'pixel-rotate' && el.shape === 'pixel') {
      // 自由角度旋转（不做 5° 吸附）：手柄方位角反推 phase（扣除当前 simT 转角）
      const c = elementCenter(design, el, 0, p.x, p.y, simT, viewScale);
      const ga = Math.atan2(pt.y - c.y, pt.x - c.x);
      design.elements[drag.index].phase = ga - simT * el.rotSpeed * (el.dir || 1);
    }
    renderElementList(dom);
  });

  canvas.addEventListener('pointerup', () => { drag = null; });
}
