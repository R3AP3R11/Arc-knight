/**
 * 武器 · 弹道编辑器工作台。
 * 独立页（纯 Canvas2D + DOM 表单），复用画板矢量渲染（renderAsset）与统一弹道解释器（weapon-runtime）。
 * 不进入 EditorScene / 不依赖 this.editing / state.mode。
 * 职责：编辑武器外形 / 发射媒介 / 子弹外形 / 矢量场轨迹 / 拖尾 / 弹道与进入游戏参数，
 *       保存/载入 /api/weapons 设计稿，载入 3 种默认模板 + 空白模板。
 * 导出：showWeaponBoard, initWeaponBoard, getWeaponDesign
 */
import { loadAsset, saveWeapon } from '../api.js';
import { setStatus } from '../ui.js';
import { renderAsset, hexToInt, intToHex } from '../systems/art/asset-render.js';
import { normalizeWeaponDesign, defaultWeaponDesign, WEAPON_TRAIL_TYPES } from '../systems/art/weapon-design.js';
import { buildWeaponRuntimeEntry } from '../systems/art/weapon-runtime.js';
import { buildDefaultWeapons, buildBuiltinWeaponDesigns } from '../systems/art/default-weapons.js';
import { registerWeapon, ensureWeaponDef } from '../systems/art/weapon-store.js';
import { renderPreviewPlayer, renderTrialPlayer } from './player-panels.js';
import { ctx } from './context.js';

// 随机颜色合集候选色：添加时优先取一个当前合集里还没有的；全部用尽则随机生成新色相
const PALETTE_CANDIDATES = ['#ffa914', '#42d978', '#ff4d4d', '#4da6ff', '#ff4dff', '#ffe14d', '#7dff4d', '#ffffff', '#ff8c42', '#8c5cff'];
function nextPaletteColor(pal) {
  const used = new Set(pal || []);
  const hit = PALETTE_CANDIDATES.find(c => !used.has(c));
  if (hit) return hit;
  for (let i = 0; i < 100; i++) {
    const c = '#' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');
    if (!used.has(c)) return c;
  }
  return '#888888';
}

function makeG(c) {
  return {
    lineStyle: (w, color, alpha) => { c.lineWidth = Math.max(0.1, w); c.strokeStyle = '#' + intToHex(color); c.globalAlpha = alpha; },
    fillStyle: (color, alpha) => { c.fillStyle = '#' + intToHex(color); c.globalAlpha = alpha; },
    beginPath: () => c.beginPath(),
    moveTo: (x, y) => c.moveTo(x, y),
    lineTo: (x, y) => c.lineTo(x, y),
    arc: (x, y, r, a0, a1, ccw) => c.arc(x, y, r, a0, a1, ccw),
    closePath: () => c.closePath(),
    fillPath: () => c.fill(),
    strokePath: () => c.stroke(),
    fillCircle: (x, y, r) => { c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); c.fill(); },
    lineBetween: (x0, y0, x1, y1) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
  };
}

let design = null;
let designId = '';
let raf = null;
let simT = 0;
let previewBullets = [];
let previewBeams = [];
let previewFireClock = 0;
let previewAngle = 0;
let expandedGroups = new Set();

function refreshPlayerPanels() {
  try { renderPreviewPlayer(); renderTrialPlayer(); } catch {}
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = val;
}

function trailLabel(t) { return ({ cone: '锥形渐变', equal: '等宽', snake: '蛇形航迹', particle: '粒子点' })[t] || t; }

function scalarFields() {
  return [
    { g: '基本信息', group: [
      ['name', '武器名', 'text'],
      ['slot', '槽位', 'select', [[1, '槽位1'], [2, '槽位2'], [3, '槽位3']]],
      ['purchasable', '可购买', 'bool'],
      ['price', '价格', 'number'],
      ['unlockLevel', '解锁等级', 'number'],
      ['maxGenericMods', '通用改件数', 'number'],
      ['maxDedicatedMods', '专属改件数', 'number']
    ]},
    { g: '战斗数值', group: [
      ['baseDamage', '基础伤害', 'number'],
      ['fireInterval', '射速(ms/发)', 'number'],
      ['maxAmmo', '弹量(0=∞)', 'number'],
      ['chargeRequired', '蓄力需弹', 'number']
    ]},
    { g: '发射媒介(环上小球)', group: [
      ['medium.angle', '环角度°', 'number'],
      ['medium.radius', '环半径', 'number'],
      ['medium.size', '小球尺寸', 'number'],
      ['medium.ringColor', '环颜色', 'color'],
      ['medium.ringWidth', '环线宽', 'number'],
      ['medium.orbitSpeed', '怠速转速°/s', 'number'],
      ['medium.fireSpeed', '射击转速°/s', 'number']
    ]},
    { g: '子弹弹道参数', group: [
      ['bullet.count', '单发数量', 'number'],
      ['bullet.spreadDeg', '散布(°)', 'number'],
      ['bullet.spreadRandom', '随机偏移°', 'number'],
      ['bullet.speed', '子弹飞行速度', 'number'],
      ['bullet.range', '射击距离', 'number'],
      ['bullet.fadeDuration', '消失时长ms(需射击距离)', 'number'],
      ['bullet.randomColor', '随机颜色', 'bool'],
      ['bullet.randomPalette', '随机颜色合集', 'palette'],
      ['bullet.size', '子弹尺寸', 'number'],
      ['bullet.trajectory.kind', '介型', 'select', [['vector', '弹体(矢量场)'], ['beam', '激光束']], true]
    ]},
    { g: '矢量场轨迹', when: () => design.bullet.trajectory.kind !== 'beam', group: [
      ['bullet.trajectory.vector.angleOffset', '偏角°', 'number'],
      ['bullet.trajectory.vector.gravityX', '重力X', 'number'],
      ['bullet.trajectory.vector.gravityY', '重力Y', 'number'],
      ['bullet.trajectory.vector.zigzag.enabled', '蛇形', 'bool'],
      ['bullet.trajectory.vector.zigzag.ampDeg', '蛇形振幅°', 'number'],
      ['bullet.trajectory.vector.zigzag.wavelength', '蛇形波长', 'number'],
      ['bullet.trajectory.vector.jitter.enabled', '抖动', 'bool'],
      ['bullet.trajectory.vector.jitter.amount', '抖动幅度°', 'number'],
      ['bullet.trajectory.vector.jitter.freq', '抖动频率', 'number']
    ]},
    { g: '激光束', when: () => design.bullet.trajectory.kind === 'beam', group: [
      ['bullet.trajectory.beam.width', '束宽', 'number'],
      ['bullet.trajectory.beam.color', '束色', 'color']
    ]},
    { g: '子弹拖尾', group: [
      ['bullet.trail.type', '形态', 'select', WEAPON_TRAIL_TYPES.map(t => [t, trailLabel(t)]), true],
      ['bullet.trail.color', '颜色', 'color'],
      ['bullet.trail.length', '长度', 'number'],
      ['bullet.trail.width', '线宽', 'number'],
      ['bullet.trail.fade', '淡出0~1', 'number'],
      ['bullet.trail.tailWidth', '尾宽(锥形)', 'number'],
      ['bullet.trail.midWidth', '中间宽(菱形)', 'number'],
      ['bullet.trail.midAt', '中间位置', 'number'],
      ['bullet.trail.particleSize', '粒子尺寸', 'number'],
      ['bullet.trail.particleGap', '粒子间距', 'number'],
      ['bullet.trail.historyMax', '航迹记录', 'number']
    ]}
  ];
}

function fieldInput([path, label, type, options, rerender]) {
  const val = getPath(design, path);
  let inner;
  if (type === 'bool') {
    inner = `<input data-path="${path}" data-type="bool" type="checkbox" ${val ? 'checked' : ''}>`;
  } else if (type === 'select') {
    const opts = options.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('');
    inner = `<select data-path="${path}" data-type="select" ${rerender ? 'data-rerender="1"' : ''}>${opts}</select>`;
  } else if (type === 'color') {
    inner = `<input data-path="${path}" data-type="color" type="color" value="${val || '#ffffff'}">`;
  } else if (type === 'text') {
    inner = `<input data-path="${path}" data-type="text" type="text" value="${val ?? ''}">`;
  } else if (type === 'palette') {
    // 自绘控件：不用 label 包裹，避免点击转发到首个 color input
    return `<div class="pal-box" data-palette="1"></div>`;
  } else {
    const disp = (val === Infinity || val === -Infinity) ? 0 : (val == null ? '' : val);
    inner = `<input data-path="${path}" data-type="number" type="number" step="any" value="${disp}">`;
  }
  return `<label>${label}${inner}</label>`;
}

function renderForm(dom) {
  const sections = [];
  for (const sec of scalarFields()) {
    if (sec.when && !sec.when()) continue;
    const opened = expandedGroups.has(sec.g);
    const body = opened ? sec.group.map(f => fieldInput(f)).join('') : '';
    sections.push(`<div class="wgroup">
      <h4 data-toggle="${sec.g}">${opened ? '▾' : '▸'} ${sec.g}</h4>
      <div class="wgroup-body">${body}</div>
    </div>`);
  }
  sections.push('<div class="wgroup"><h4 data-toggle="武器外形">▸ 武器外形（画板矢量）</h4><div class="wgroup-body"><div id="shapeAppearance"></div></div></div>');
  sections.push('<div class="wgroup"><h4 data-toggle="发射媒介外形">▸ 发射媒介（画板矢量）</h4><div class="wgroup-body"><div id="shapeMedium"></div></div></div>');
  sections.push('<div class="wgroup"><h4 data-toggle="子弹外形">▸ 子弹外形（画板矢量）</h4><div class="wgroup-body"><div id="shapeBullet"></div></div></div>');
  dom.weaponForm.innerHTML = sections.join('');
  bindScalarForm(dom.weaponForm);
  renderPaletteEdit(dom.weaponForm.querySelector('[data-palette]'), dom);
  renderShapeGroup(dom.weaponForm.querySelector('#shapeAppearance'), 'appearance', dom);
  renderShapeGroup(dom.weaponForm.querySelector('#shapeMedium'), 'medium', dom);
  renderShapeGroup(dom.weaponForm.querySelector('#shapeBullet'), 'bullet.shape', dom);
}

function bindScalarForm(form) {
  form.querySelectorAll('[data-toggle]').forEach(h => {
    h.onclick = () => {
      const g = h.dataset.toggle;
      if (expandedGroups.has(g)) expandedGroups.delete(g); else expandedGroups.add(g);
      renderForm(ctx.dom);
      drawPreview(ctx.dom);
    };
  });
  // 容器级 input/change 监听在 initWeaponBoard 只挂一次，避免重渲重复绑定
}
function coerce(type, v) {
  if (type === 'bool') return v.checked;
  if (type === 'number') return Number(v.value);
  return v.value;
}
function onScalarInput(e) {
  const el = e.target;
  if (!el.dataset.path) return;
  const path = el.dataset.path;
  const val = coerce(el.dataset.type, el);
  if (path === 'maxAmmo') setPath(design, path, val > 0 ? val : Infinity);
  else setPath(design, path, val);
  design = normalizeWeaponDesign(design);
  if (el.dataset.rerender) renderForm(ctx.dom);
  drawPreview(ctx.dom);
}

// 随机颜色合集：调色盘 chip 列表（每个颜色一个 <input type=color> + 移除），支持逐色修改/增删
function renderPaletteEdit(container, dom) {
  if (!container) return;
  const pal = (design.bullet && design.bullet.randomPalette) || [];
  const chips = pal.map((c, i) =>
    `<span class="pal-chip"><input type="color" value="${c}" data-pal-index="${i}"><button class="pal-del" data-pal-del="${i}" title="移除">×</button></span>`).join('');
  container.innerHTML = `<div class="pal-head">随机颜色合集</div>
    <div class="pal-row">${chips || '<span class="pal-empty">添加颜色后，子弹将从这些颜色中随机取色</span>'}
      <button class="pal-add" data-pal-add>＋添加颜色</button>
    </div>`;
  container.querySelectorAll('[data-pal-index]').forEach(inp => {
    inp.oninput = () => {
      const i = Number(inp.dataset.palIndex);
      if (design.bullet.randomPalette) design.bullet.randomPalette[i] = inp.value;
      design = normalizeWeaponDesign(design);
      drawPreview(dom);
    };
  });
  container.querySelectorAll('[data-pal-del]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.palDel);
      if (design.bullet.randomPalette) design.bullet.randomPalette.splice(i, 1);
      design = normalizeWeaponDesign(design);
      renderForm(dom); drawPreview(dom);
    };
  });
  const add = container.querySelector('[data-pal-add]');
  if (add) add.onclick = () => {
    const pal = design.bullet.randomPalette || (design.bullet.randomPalette = []);
    pal.push(nextPaletteColor(pal));
    design = normalizeWeaponDesign(design);
    renderForm(dom); drawPreview(dom);
  };
}

function shapeFieldEdit(el, type, index) {
  if (type === 'stroke') {
    return [
      ['color', '颜色', 'color', el.color || '#ffffff'],
      ['lineWidth', '粗细', 'number', el.lineWidth],
      ['rotSpeed', '旋转', 'number', el.rotSpeed],
      ['phaseDeg', '相位°', 'number', Math.round((el.phase * 180 / Math.PI) * 100) / 100],
      ['offsetX', '偏移X', 'number', el.offsetX],
      ['offsetY', '偏移Y', 'number', el.offsetY],
      ['offsetSpeed', '偏移速度', 'number', el.offsetSpeed],
    ].map(([k, l, t, v]) => miniField(k, l, t, v, index)).join('') +
      `<label class="checkbox"><input data-key="closed" data-index="${index}" type="checkbox" ${el.closed ? 'checked' : ''}> 闭合</label>`;
  }
  if (type === 'arc') {
    return [
      ['count', '数量', 'number', el.count], ['orbitRadius', '轨道半径', 'number', el.orbitRadius],
      ['radius', '半径', 'number', el.radius], ['lineWidth', '粗细', 'number', el.lineWidth],
      ['color', '颜色', 'color', el.color], ['rotSpeed', '旋转', 'number', el.rotSpeed],
      ['phaseDeg', '相位°', 'number', Math.round((el.phase * 180 / Math.PI) * 100) / 100],
      ['arcStart', '起始°', 'number', el.arcStart], ['arcEnd', '结束°', 'number', el.arcEnd],
      ['offsetX', '偏移X', 'number', el.offsetX], ['offsetY', '偏移Y', 'number', el.offsetY],
      ['offsetSpeed', '偏移速度', 'number', el.offsetSpeed]
    ].map(([k, l, t, v]) => miniField(k, l, t, v, index)).join('') +
      miniSelect('pattern', '显示形式', el.pattern || 'plain', [['plain', '普通圆弧'], ['clock', '钟表表盘']], index) +
      (el.pattern === 'clock' ? [
        ['tickLongLen', '长针长度', 'number', el.tickLongLen],
        ['tickShortLen', '短针长度', 'number', el.tickShortLen],
        ['tickDensity', '刻度密度(总针数)', 'number', el.tickDensity],
        ['tickRatio', '长短针比例', 'number', el.tickRatio]
      ].map(([k, l, t, v]) => miniField(k, l, t, v, index)).join('') +
        miniSelect('tickDir', '刻度方向', el.tickDir || 'in', [['in', '朝圆心'], ['out', '向外'], ['both', '双向']], index)
        : '');
  }
  return [
    ['count', '数量', 'number', el.count], ['orbitRadius', '轨道半径', 'number', el.orbitRadius],
    ['radius', '半径', 'number', el.radius], ['sides', '边数', 'number', el.sides],
    ['lineWidth', '粗细', 'number', el.lineWidth], ['color', '颜色', 'color', el.color],
    ['fill', '填充', 'color', el.fill || '#000000'], ['rotSpeed', '旋转', 'number', el.rotSpeed],
    ['phaseDeg', '相位°', 'number', Math.round((el.phase * 180 / Math.PI) * 100) / 100],
    ['offsetX', '偏移X', 'number', el.offsetX], ['offsetY', '偏移Y', 'number', el.offsetY],
    ['offsetSpeed', '偏移速度', 'number', el.offsetSpeed]
  ].map(([k, l, t, v]) => miniField(k, l, t, v, index)).join('');
}
function miniField(key, label, type, val, index) {
  const idx = index === undefined ? '' : ` data-index="${index}"`;
  if (type === 'color') return `<label>${label}<input data-key="${key}"${idx} data-type="color" type="color" value="${val}"></label>`;
  return `<label>${label}<input data-key="${key}"${idx} data-type="number" type="number" step="any" value="${val ?? ''}"></label>`;
}
function miniSelect(key, label, val, options, index) {
  const idx = index === undefined ? '' : ` data-index="${index}"`;
  const opts = options.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('');
  return `<label>${label}<select data-key="${key}"${idx} data-type="select">${opts}</select></label>`;
}

function renderShapeGroup(container, groupKey, dom) {
  if (!container) return;
  const group = getPath(design, groupKey);
  const els = group.elements || [];
  const rows = els.map((ele, i) => `
    <div class="art-element" data-index="${i}">
      <div class="art-element-head">
        <strong>${ele.shape === 'arc' ? '圆弧' : ele.shape === 'stroke' ? '轮廓' : '多边形'} ${i + 1}</strong>
        <label><select data-key="shape" data-index="${i}">
          <option value="polygon" ${ele.shape === 'polygon' ? 'selected' : ''}>多边形</option>
          <option value="arc" ${ele.shape === 'arc' ? 'selected' : ''}>圆弧</option>
          <option value="stroke" ${ele.shape === 'stroke' ? 'selected' : ''}>轮廓</option>
        </select></label>
        <button class="art-element-del" data-del="${i}">删除</button>
      </div>
      <div class="art-element-body">${shapeFieldEdit(ele, ele.shape, i)}</div>
    </div>`).join('');
  container.innerHTML = `
    <div class="art-list-actions">
      <button data-shape-add="polygon">+ 多边形</button>
      <button data-shape-add="arc">+ 圆弧</button>
      <button data-shape-add="stroke">+ 轮廓</button>
      <select data-shape-import="1"><option value="">从画板导入…</option></select>
    </div>
    ${rows}
    <p class="hint">每个元素是一组绕圆心转动的多边形（或圆弧/手绘轮廓）。</p>`;
  bindShapeGroup(container, groupKey, dom);
}

function bindShapeGroup(el, groupKey, dom) {
  el.querySelectorAll('[data-shape-add]').forEach(btn => {
    btn.onclick = () => {
      const g = getPath(design, groupKey);
      const shape = btn.dataset.shapeAdd;
      g.elements.push(shape === 'arc'
        ? { shape: 'arc', count: 1, orbitRadius: 0, radius: 20, lineWidth: 3, color: '#ffa914', rotSpeed: 0, phase: 0, arcStart: 0, arcEnd: 300 }
        : shape === 'stroke'
          ? { shape: 'stroke', lineWidth: 3, color: '#ffffff', rotSpeed: 0, phase: 0, closed: true, points: [] }
          : { shape: 'polygon', count: 1, orbitRadius: 0, radius: 10, sides: 6, lineWidth: 2, color: '#ffffff', fill: null, rotSpeed: 0, phase: 0 });
      design = normalizeWeaponDesign(design);
      renderForm(dom); drawPreview(dom);
    };
  });
  const imp = el.querySelector('[data-shape-import]');
  if (imp) imp.onchange = async () => {
    const id = imp.value;
    if (!id) return;
    try {
      const a = await loadAsset(id);
      const g = getPath(design, groupKey);
      g.elements = (Array.isArray(a.elements) ? a.elements : []).map(x => ({ ...x }));
      design = normalizeWeaponDesign(design);
      renderForm(dom); drawPreview(dom);
      setStatus(dom, `已导入画板: ${id}`);
    } catch (e) { setStatus(dom, `导入失败：${e.message}`, true); }
  };
  el.addEventListener('input', e => bindShapeInput(e, groupKey, dom));
  // 删除按钮是 <button>，不会触发 input 事件，需单独挂 click（否则点删除无响应）
  el.querySelectorAll('[data-del]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const g = getPath(design, groupKey);
      g.elements.splice(Number(btn.dataset.del), 1);
      design = normalizeWeaponDesign(design);
      renderForm(dom); drawPreview(dom);
    };
  });
}
function bindShapeInput(e, groupKey, dom) {
  const t = e.target;
  const group = getPath(design, groupKey);
  if (t.dataset.del !== undefined) {
    group.elements.splice(Number(t.dataset.del), 1);
    design = normalizeWeaponDesign(design);
    renderForm(dom); drawPreview(dom);
    return;
  }
  const idx = t.dataset.index;
  if (idx === undefined) return;
  const ele = group.elements[Number(idx)];
  if (!ele) return;
  const key = t.dataset.key;
  if (key === 'shape') ele.shape = t.value;
  else if (key === 'closed') ele.closed = t.checked;
  else if (key === 'phaseDeg') ele.phase = (Number(t.value) || 0) * Math.PI / 180;
  else if (key === 'pattern') {
    // 切换显示形式需重渲元素字段列表（钟表子字段按 pattern 显隐）；renderForm 会重建容器，避免监听器堆积
    ele.pattern = t.value;
    design = normalizeWeaponDesign(design);
    renderForm(dom);
    drawPreview(dom);
    return;
  }
  else if (key === 'tickDir') ele.tickDir = t.value;
  else if (t.dataset.type === 'color') ele[key] = t.value;
  else ele[key] = Number(t.value);
  design = normalizeWeaponDesign(design);
  drawPreview(dom);
}

function drawPreview(dom) {
  const canvas = dom.weaponPreviewCanvas;
  if (!canvas) return;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  c.globalAlpha = 1;
  const g = makeG(c);
  const cx = canvas.width / 2, cy = canvas.height / 2;
  c.strokeStyle = 'rgba(120,120,120,0.15)'; c.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 30) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, canvas.height); c.stroke(); }
  for (let y = 0; y < canvas.height; y += 30) { c.beginPath(); c.moveTo(0, y); c.lineTo(canvas.width, y); c.stroke(); }

  const m = design.medium;
  c.globalAlpha = 1;
  c.strokeStyle = '#' + hexToInt(m.ringColor).toString(16).padStart(6, '0');
  c.lineWidth = Math.max(0.5, m.ringWidth || 4);
  c.beginPath(); c.arc(cx, cy, m.radius, 0, Math.PI * 2); c.stroke();
  c.globalAlpha = 1;

  if (Array.isArray(design.appearance.elements) && design.appearance.elements.length) {
    renderAsset(g, design.appearance, cx, cy, simT, design.appearance.scale);
  } else {
    c.fillStyle = '#fff'; c.beginPath(); c.arc(cx, cy, 12, 0, Math.PI * 2); c.fill();
  }

  const entry = buildWeaponRuntimeEntry(design);
  const fakePlayer = { x: cx, y: cy, weaponAngle: previewAngle, artScale: 1 };
  const a = previewAngle + (m.angle * Math.PI / 180);
  const mx = cx + Math.cos(a) * m.radius, my = cy + Math.sin(a) * m.radius;
  if (Array.isArray(m.elements) && m.elements.length) {
    renderAsset(g, { scale: m.size, center: { x: 0, y: 0 }, elements: m.elements }, mx, my, simT, 1);
  } else {
    c.fillStyle = '#' + hexToInt(m.ringColor).toString(16).padStart(6, '0');
    c.beginPath(); c.arc(mx, my, Math.max(2, 4 * m.size), 0, Math.PI * 2); c.fill();
  }

  previewFireClock -= 16;
  if (previewFireClock <= 0) {
    for (const s of entry.fire(fakePlayer, 1, null)) {
      if (s.beam) previewBeams.push({ x0: s.ox, y0: s.oy, angle: s.angle, width: s.width, color: s.color, ttl: 6 });
      else previewBullets.push(s);
    }
    previewFireClock = design.fireInterval;
  }
  const bg = makeG(c);
  previewBeams = previewBeams.filter(beam => {
    const len = 420;
    const x1 = beam.x0 + Math.cos(beam.angle) * len, y1 = beam.y0 + Math.sin(beam.angle) * len;
    bg.lineStyle(Math.max(2, beam.width), hexToInt(beam.color), Math.max(0.15, beam.ttl / 6));
    bg.lineBetween(beam.x0, beam.y0, x1, y1);
    beam.ttl -= 1.2;
    return beam.ttl > 0;
  });
  previewBullets = previewBullets.filter(s => {
    s.x += s.vx * 16 / 1000; s.y += s.vy * 16 / 1000;
    s.dist += Math.hypot(s.vx, s.vy) * 16 / 1000;
    entry.stepBullet(s, 16, null);
    entry.drawBullet(bg, s);
    return !s.dead && s.x > -80 && s.x < canvas.width + 80 && s.y > -80 && s.y < canvas.height + 80;
  });
}

function loop(dom) {
  if (!document.body.classList.contains('weapon-mode')) { raf = null; return; }
  simT += 0.016;
  previewAngle += 0.02;
  drawPreview(dom);
  raf = requestAnimationFrame(() => loop(dom));
}

function refreshWeaponSelect(dom) {
  fetch('/api/weapons').then(r => r.json()).then(j => {
    const list = (j && j.weapons) || [];
    const saved = list.map(w => ({ id: w.id, name: w.name || w.id }));
    // 内置武器（yellow/green）由启动 registerBuiltinWeapons 注册，未落盘时也要能作为已注册武器载入/编辑
    const builtin = buildBuiltinWeaponDesigns().map(d => ({ id: d.id, name: d.name }));
    const seen = new Set();
    const all = [];
    for (const w of saved) { seen.add(w.id); all.push(w); }
    for (const b of builtin) if (!seen.has(b.id)) all.push(b);
    const opts = ['<option value="">（新建）</option>'].concat(
      all.map(w => `<option value="${w.id}" ${String(w.id) === String(designId) ? 'selected' : ''}>${w.name || w.id}</option>`)
    ).join('');
    dom.weaponSelect.innerHTML = opts;
    if (designId) dom.weaponSelect.value = designId;
  }).catch(() => {});
}
function fillTemplateSelect(dom) {
  const tpls = buildDefaultWeapons().filter(t => t.isTemplate);
  dom.weaponTemplate.innerHTML = '<option value="">载入模板…</option>' +
    tpls.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

async function saveCurrent(dom) {
  if (!designId) designId = 'weapon-' + Date.now();
  design.id = designId;
  design = normalizeWeaponDesign(design);
  try {
    await saveWeapon(designId, design);
    registerWeapon(design);
    refreshPlayerPanels();
    setStatus(dom, `武器已保存: ${designId}`);
    refreshWeaponSelect(dom);
  } catch (e) {
    setStatus(dom, `保存失败：${e.message}`, true);
  }
}

export function showWeaponBoard(show, dom, state) {
  const b = document.body;
  b.classList.toggle('weapon-mode', show);
  if (show) b.classList.remove('artboard-mode');
  if (show) {
    design = defaultWeaponDesign();
    designId = '';
    expandedGroups = new Set(['基本信息', '战斗数值', '子弹弹道参数', '子弹拖尾']);
    renderForm(dom);
    refreshWeaponSelect(dom);
    fillTemplateSelect(dom);
    drawPreview(dom);
    if (!raf) raf = requestAnimationFrame(() => loop(dom));
  } else {
    previewBullets = [];
    previewBeams = [];
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }
}

export function getWeaponDesign() { return design; }

export function initWeaponBoard(dom, state) {
  dom.weaponBack.onclick = () => showWeaponBoard(false, dom, state);

  dom.weaponForm.addEventListener('input', onScalarInput);
  dom.weaponForm.addEventListener('change', onScalarInput);

  dom.weaponName.addEventListener('input', e => { design.name = e.target.value; design = normalizeWeaponDesign(design); drawPreview(dom); });

  dom.weaponSelect.addEventListener('change', async e => {
    const id = e.target.value;
    if (!id) { design = defaultWeaponDesign(); designId = ''; renderForm(dom); drawPreview(dom); return; }
    try {
      // 内置/已注册武器从目录取（含未落盘的 yellow/green），其它从 /api/weapons/:id 载入
      const d = await ensureWeaponDef(id);
      if (!d) throw new Error('未找到武器 ' + id);
      design = normalizeWeaponDesign(JSON.parse(JSON.stringify(d)));
      designId = id;
      registerWeapon(design);
      refreshPlayerPanels();
      dom.weaponName.value = design.name;
      renderForm(dom); drawPreview(dom);
    } catch (err) { setStatus(dom, `载入失败：${err.message}`, true); }
  });

  dom.weaponNew.onclick = () => { design = defaultWeaponDesign(); designId = ''; dom.weaponName.value = ''; renderForm(dom); drawPreview(dom); };

  dom.weaponTemplate.addEventListener('change', e => {
    const id = e.target.value;
    if (!id) return;
    const tpl = buildDefaultWeapons().find(t => t.id === id);
    if (tpl) {
      design = normalizeWeaponDesign(JSON.parse(JSON.stringify(tpl)));
      designId = '';
      registerWeapon(design);
      refreshPlayerPanels();
      dom.weaponName.value = design.name;
      renderForm(dom); drawPreview(dom);
    }
  });

  dom.weaponSave.onclick = () => saveCurrent(dom);
}
