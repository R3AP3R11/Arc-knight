// ============================================================
// 运镜 · 时间轴编辑器（全屏板）。
// 独立页（纯 Canvas2D + DOM 表单），不进入 EditorScene / 不依赖统一相机引擎。
// 职责：编辑 state.level.cinematics 的运镜列表（name / durationMs / keyframes），
//       关键帧即 {t, zoom, panX, panY, rotation, alpha, ease}；
//       时间轴可视化 + 右侧 Canvas 预览（用 transform 模拟 zoom/pan/rotation/alpha）；
//       参照物（世界坐标锚点）用于观察镜头相对移动；保存写回 state.level.cinematics 并落盘。
// 导出：showCinematicsBoard, initCinematicsBoard
// ============================================================
import { saveDraft } from '../api.js';
import { setStatus } from '../ui.js';

// ── 模块级状态 ──
let cur = null;          // 正在编辑的 CinematicDef
let selectedKf = -1;     // 选中的关键帧下标（-1 = 无）
let refs = [];           // 参照物 [{x,y,type}]（世界坐标，编辑器本地，不落盘）
let playT = 0;           // 播放/预览时刻（ms）
let playing = false;
let raf = null;
let lastPaint = 0;
let stateRef = null;
let domRef = null;
let pickAnchor = false;   // 锚点选点模式（设中心锚点工具）

const EASES = {
  linear: p => p,
  easeIn: p => p * p,
  easeOut: p => p * (2 - p),
  easeInOut: p => p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
};

// ── 数值工具 ──
function num(v, d) { return Number.isFinite(Number(v)) ? Number(v) : d; }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function normKf(k) {
  const t = Math.max(0, Number(k && k.t) || 0);
  return {
    t,
    zoom: num(k && k.zoom, 1),
    panX: num(k && k.panX, 0),
    panY: num(k && k.panY, 0),
    rotation: num(k && k.rotation, 0),
    alpha: num(k && k.alpha, 0),
    ease: (k && k.ease) ? String(k.ease) : 'linear'
  };
}

function normDef(d) {
  const dur = Math.max(1, Number(d && d.durationMs) || 1000);
  const raw = (Array.isArray(d && d.keyframes) ? d.keyframes : []).map(normKf);
  const keyframes = raw
    .map(k => ({ ...k, t: Math.max(0, Math.min(k.t, dur)) }))
    .sort((a, b) => a.t - b.t);
  return {
    id: String((d && d.id) || ('cine-' + Date.now())),
    name: (d && d.name) == null ? '' : String(d.name),
    durationMs: dur,
    timeScale: Math.min(1, Math.max(0.05, num(d && d.timeScale, 1))),
    keyframes
  };
}

function emptyDef() {
  return {
    id: 'cine-' + Date.now(),
    name: '新运镜',
    durationMs: 2000,
    timeScale: 1,
    keyframes: [{ t: 0, zoom: 1, panX: 0, panY: 0, rotation: 0, alpha: 0, ease: 'linear' }]
  };
}

function getCinematics(state) {
  if (!Array.isArray(state.level.cinematics)) state.level.cinematics = [];
  return state.level.cinematics;
}

// ── 关键帧插值（按 t 升序，ease 作用于每段起点）──
function evalAt(t) {
  const kfs = cur.keyframes;
  const dur = cur.durationMs || 1;
  t = Math.max(0, Math.min(t, dur));
  if (!kfs.length) return { zoom: 1, panX: 0, panY: 0, rotation: 0, alpha: 0 };
  if (kfs.length === 1) return kfs[0];
  if (t <= kfs[0].t) return kfs[0];
  if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1];
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t < t) i++;
  const a = kfs[i], b = kfs[i + 1];
  const span = b.t - a.t;
  let p = span > 0 ? (t - a.t) / span : 0;
  const fn = EASES[a.ease] || EASES.linear;
  p = clamp01(fn(p));
  const lerp = (x, y) => x + (y - x) * p;
  return {
    zoom: lerp(a.zoom, b.zoom),
    panX: lerp(a.panX, b.panX),
    panY: lerp(a.panY, b.panY),
    rotation: lerp(a.rotation, b.rotation),
    alpha: lerp(a.alpha, b.alpha)
  };
}

// 相机模型：视口=canvas，把 camera.width 世界宽映射到 canvas 宽，中心对准 camCenterWorld
function camParams(level, ev) {
  const cw = 800, ch = 600;
  const worldW = level.world.width || 1920, worldH = level.world.height || 1080;
  const camW = (level.camera && level.camera.width) || worldW;
  const viewportScale = cw / camW; // 世界单位→像素（使相机宽填满画布）
  const camCenterWorld = { x: worldW / 2 + (ev.panX || 0), y: worldH / 2 + (ev.panY || 0) };
  return {
    cw, ch, worldW, worldH, camW,
    viewportScale,
    camCenterWorld,
    rot: (ev.rotation || 0) * Math.PI / 180,
    zoom: ev.zoom == null ? 1 : ev.zoom,
    alpha: clamp01(ev.alpha)
  };
}

// 画布像素 → 世界坐标（当前播放时刻的相机逆变换）
function screenToWorld(level, sx, sy) {
  const cam = camParams(level, evalAt(playT));
  const px = sx - cam.cw / 2, py = sy - cam.ch / 2;
  const ang = -cam.rot, ca = Math.cos(ang), sa = Math.sin(ang);
  const rx = px * ca - py * sa, ry = px * sa + py * ca;
  const s = cam.zoom * cam.viewportScale;
  return { x: cam.camCenterWorld.x + rx / s, y: cam.camCenterWorld.y + ry / s };
}

// ── 预览渲染 ──
function drawEntities(ctx, cam) {
  const lv = stateRef.level;
  const s = cam.zoom * cam.viewportScale;
  const fill = c => { ctx.fillStyle = c; };
  const circle = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  const rect = (x, y, w, h) => { ctx.fillRect(x - w / 2, y - h / 2, w, h); };

  fill('#b23b3b'); for (const e of (lv.enemies || []).slice(0, 40)) circle(e.x || 0, e.y || 0, 18);
  fill('#c9a86a'); for (const c of (lv.crates || []).slice(0, 30)) rect(c.x || 0, c.y || 0, 40, 40);
  fill('#d9742f'); for (const b of (lv.barrels || []).slice(0, 30)) circle(b.x || 0, b.y || 0, 20);
  fill('#e0c040'); for (const c of (lv.chests || []).slice(0, 20)) rect(c.x || 0, c.y || 0, 46, 32);
  fill('#d06a9a'); for (const v of (lv.vendors || []).slice(0, 10)) rect(v.x || 0, v.y || 0, 52, 60);
  fill('#8a5cff'); for (const p of (lv.portals || []).slice(0, 10)) circle(p.x || 0, p.y || 0, 34);
  fill('#5c9a5c'); for (const i of (lv.idols || []).slice(0, 10)) rect(i.x || 0, i.y || 0, 34, 54);
  fill('#4da6ff'); for (const i of (lv.icons || []).slice(0, 10)) rect(i.x || 0, i.y || 0, 26, 26);
  fill('#7a7a7a'); for (const w of (lv.walls || []).slice(0, 30)) rect(w.x || 0, w.y || 0, w.w || 40, w.h || 40);
  fill('#4dff88'); if (lv.spawn) circle(lv.spawn.x || 0, lv.spawn.y || 0, 16);
}

function drawRefs(ctx, cam) {
  const s = cam.zoom * cam.viewportScale;
  refs.forEach((r, i) => {
    const x = r.x || 0, y = r.y || 0;
    ctx.strokeStyle = '#00fff0'; ctx.lineWidth = 3 / s;
    ctx.beginPath();
    ctx.moveTo(x - 16 / s, y); ctx.lineTo(x + 16 / s, y);
    ctx.moveTo(x, y - 16 / s); ctx.lineTo(x, y + 16 / s);
    ctx.stroke();
    ctx.fillStyle = '#00fff0'; ctx.font = `${12 / s}px sans-serif`;
    ctx.fillText(`R${i + 1}`, x + 18 / s, y - 18 / s);
  });
}

function drawWorld(ctx, cam) {
  const { worldW, worldH } = cam;
  const s = cam.zoom * cam.viewportScale;
  ctx.save();
  ctx.translate(cam.cw / 2, cam.ch / 2);
  ctx.rotate(cam.rot);
  ctx.scale(s, s);
  ctx.translate(-cam.camCenterWorld.x, -cam.camCenterWorld.y);
  // 背景
  ctx.fillStyle = '#0b1b2b'; ctx.fillRect(-2000, -2000, worldW + 4000, worldH + 4000);
  // 网格
  ctx.strokeStyle = 'rgba(47,90,122,0.25)'; ctx.lineWidth = 1 / s;
  const step = Math.max(80, Math.round(worldW / 12));
  for (let x = 0; x <= worldW; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, worldH); ctx.stroke(); }
  for (let y = 0; y <= worldH; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(worldW, y); ctx.stroke(); }
  // 世界边界
  ctx.strokeStyle = '#2f5a7a'; ctx.lineWidth = 4 / s; ctx.strokeRect(0, 0, worldW, worldH);
  drawEntities(ctx, cam);
  drawRefs(ctx, cam);
  ctx.restore();
}

function drawPreview(dom) {
  const canvas = dom.cinematicPreviewCanvas;
  if (!canvas || !cur || !stateRef) return;
  const ctx = canvas.getContext('2d');
  const ev = evalAt(playT);
  const cam = camParams(stateRef.level, ev);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawWorld(ctx, cam);
  // alpha 蒙层（淡出到黑）
  ctx.fillStyle = `rgba(0,0,0,${cam.alpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 相机视口框 + 中心十字
  ctx.strokeStyle = 'rgba(77,166,255,0.8)'; ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  ctx.strokeStyle = 'rgba(77,166,255,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2 - 10, canvas.height / 2); ctx.lineTo(canvas.width / 2 + 10, canvas.height / 2);
  ctx.moveTo(canvas.width / 2, canvas.height / 2 - 10); ctx.lineTo(canvas.width / 2, canvas.height / 2 + 10);
  ctx.stroke();
  if (pickAnchor) drawAnchorHint(ctx, canvas, cam);
  updatePlayhead(dom);
}

// 锚点选点模式：顶部提示条 + 选中帧镜头中心十字
function drawAnchorHint(ctx, canvas, cam) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 提示条
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(0, 0, canvas.width, 34);
  ctx.fillStyle = '#00fff0';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('选点中：点击画面拾取中心', canvas.width / 2, 17);
  // 选中帧镜头中心十字/圆环（选中帧中心经当前相机 transform 折算到画布像素）
  if (selectedKf >= 0 && cur && cur.keyframes[selectedKf]) {
    const kf = cur.keyframes[selectedKf];
    const { worldW, worldH } = stateRef.level.world;
    const selCenter = { x: worldW / 2 + kf.panX, y: worldH / 2 + kf.panY };
    const s = cam.zoom * cam.viewportScale;
    const cx = canvas.width / 2 + (selCenter.x - cam.camCenterWorld.x) * s;
    const cy = canvas.height / 2 + (selCenter.y - cam.camCenterWorld.y) * s;
    ctx.strokeStyle = '#ff2255'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy);
    ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

// ── 播放循环 ──
function tickPlay(ts) {
  if (!playing || !cur) { raf = null; return; }
  const dt = ts - lastPaint; lastPaint = ts;
  playT += dt;
  if (playT >= cur.durationMs) {
    playT = cur.durationMs;
    playing = false; raf = null;
    if (domRef.cinematicPlay) domRef.cinematicPlay.disabled = false;
    drawPreview(domRef);
    return;
  }
  drawPreview(domRef);
  raf = requestAnimationFrame(tickPlay);
}

function stopPlay() {
  playing = false;
  if (raf) { cancelAnimationFrame(raf); raf = null; }
}

// ── 关键帧列表 + 时间轴渲染 ──
function easeOptions(sel) {
  return Object.keys(EASES).map(k =>
    `<option value="${k}" ${k === sel ? 'selected' : ''}>${k}</option>`).join('');
}

function renderKeyframes(dom) {
  const box = dom.cinematicKeyframes;
  if (!box) return;
  if (!cur) { box.innerHTML = ''; return; }
  const dur = cur.durationMs || 1;
  const pct = t => Math.max(0, Math.min(100, (t / dur) * 100));
  const ticks = cur.keyframes.map((k, i) =>
    `<button class="cinema-tick ${i === selectedKf ? 'sel' : ''}" style="left:${pct(k.t)}%" data-tick="${i}"></button>`).join('');
  const playhead = `<div class="cinema-playhead" style="left:${pct(playT)}%"></div>`;
  const rows = cur.keyframes.map((k, i) => `
    <div class="cinema-kf" data-kfindex="${i}">
      <label>t<input data-kf="t" type="number" step="50" value="${k.t}"/></label>
      <label>zoom<input data-kf="zoom" type="number" step="0.1" value="${k.zoom}"/></label>
      <label>panX<input data-kf="panX" type="number" step="10" value="${k.panX}"/></label>
      <label>panY<input data-kf="panY" type="number" step="10" value="${k.panY}"/></label>
      <label>rot<input data-kf="rotation" type="number" step="1" value="${k.rotation}"/></label>
      <label>α<input data-kf="alpha" type="number" step="0.05" value="${k.alpha}"/></label>
      <label>ease<select data-kf="ease">${easeOptions(k.ease)}</select></label>
      <button class="kf-del" data-delkf="${i}">删除</button>
    </div>`).join('');
  box.innerHTML = `<div class="cinema-timeline"><div class="cinema-track"></div>${ticks}${playhead}</div>${rows}`;
  box.querySelectorAll('.cinema-tick').forEach(b => {
    b.onclick = () => selectKeyframe(dom, Number(b.dataset.tick), true);
  });
  box.querySelectorAll('.kf-del').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const i = Number(b.dataset.delkf);
      cur.keyframes.splice(i, 1);
      if (selectedKf >= cur.keyframes.length) selectedKf = cur.keyframes.length - 1;
      renderKeyframes(dom); drawPreview(dom);
    };
  });
}

function updatePlayhead(dom) {
  const box = dom.cinematicKeyframes;
  if (!box || !cur) return;
  const pct = t => Math.max(0, Math.min(100, (t / (cur.durationMs || 1)) * 100));
  const ph = box.querySelector('.cinema-playhead');
  if (ph) ph.style.left = pct(playT) + '%';
  box.querySelectorAll('.cinema-tick').forEach((b, i) => b.classList.toggle('sel', i === selectedKf));
}

function selectKeyframe(dom, i, replay) {
  if (!cur || !cur.keyframes[i]) return;
  selectedKf = i;
  if (replay) playT = cur.keyframes[i].t;
  renderKeyframes(dom);
  drawPreview(dom);
}

// ── 设中心锚点（编辑器侧整体平移，不落盘新字段）──
function setAnchorMode(dom, on) {
  pickAnchor = !!on;
  if (pickAnchor) {
    setStatus(dom, '选点中：点击预览画布拾取中心锚点…');
  } else {
    drawPreview(dom);
  }
}

function applyCenterMigration(dom, ax, ay) {
  if (!cur || selectedKf < 0 || !cur.keyframes[selectedKf]) {
    setStatus(dom, '请先选中一个关键帧', true);
    return;
  }
  const { worldW, worldH } = stateRef.level.world;
  const kf = cur.keyframes[selectedKf];
  // 当前帧镜头中心 = worldW/2 + panX, worldH/2 + panY
  const dx = ax - (worldW / 2 + kf.panX);
  const dy = ay - (worldH / 2 + kf.panY);
  // 选中帧镜头中心对准锚点，其余帧按相同 delta 整体平移（相对轨迹不变）
  cur.keyframes.forEach(k => { k.panX += dx; k.panY += dy; });
  renderKeyframes(dom); drawPreview(dom);
  setStatus(dom, `中心已锚定到 (${ax}, ${ay})，其余关键帧已整体平移`);
}

// ── 参照物 ──
function seedRefs(level) {
  const arr = [];
  const spawn = level.spawn || {};
  if (Number.isFinite(Number(spawn.x))) arr.push({ x: Math.round(spawn.x), y: Math.round(spawn.y), type: 'spawn' });
  arr.push({ x: Math.round(level.world.width / 2), y: Math.round(level.world.height / 2), type: 'center' });
  for (const en of (level.enemies || []).slice(0, 2)) arr.push({ x: Math.round(en.x || 0), y: Math.round(en.y || 0), type: 'enemy' });
  return arr;
}

function renderRefs(dom) {
  dom.cinematicRefs.innerHTML = refs.map((r, i) =>
    `<div class="cinema-ref-row"><span>R${i + 1}</span><code>(${r.x},${r.y})</code><span>${r.type || 'marker'}</span><button class="ref-del" data-refdel="${i}">×</button></div>`).join('')
    || '<p class="hint">暂无参照物，点预览可添加</p>';
  dom.cinematicRefs.querySelectorAll('.ref-del').forEach(b => {
    b.onclick = () => { refs.splice(Number(b.dataset.refdel), 1); renderRefs(dom); drawPreview(dom); };
  });
}

function addRefByPrompt(dom) {
  const x = Number(prompt('参照物 X（世界坐标）', ''));
  const y = Number(prompt('参照物 Y（世界坐标）', ''));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  refs.push({ x: Math.round(x), y: Math.round(y), type: 'marker' });
  renderRefs(dom); drawPreview(dom);
}

// ── 下拉 / 保存 / 删除 ──
function refreshSelect(dom) {
  const list = getCinematics(stateRef);
  dom.cinematicSelect.innerHTML = '<option value="">（新建）</option>' +
    list.map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join('');
  if (cur && list.some(c => c.id === cur.id)) dom.cinematicSelect.value = cur.id;
  else dom.cinematicSelect.value = '';
}

function saveCurrent(dom) {
  if (!cur) { setStatus(dom, '没有可保存的运镜', true); return; }
  cur = normDef(cur);
  if (!cur.name) cur.name = cur.id;
  const list = getCinematics(stateRef);
  const i = list.findIndex(c => c.id === cur.id);
  if (i >= 0) list[i] = cur; else list.push(cur);
  refreshSelect(dom);
  setStatus(dom, `运镜已保存：${cur.name}`);
  return saveDraft(stateRef.levelId, stateRef.level)
    .then(() => setStatus(dom, `运镜已保存并落盘：${cur.name}`))
    .catch(e => setStatus(dom, `运镜保存失败：${e.message}`, true));
}

function deleteCurrent(dom) {
  if (!cur) { setStatus(dom, '请先选择要删除的运镜', true); return; }
  const list = getCinematics(stateRef);
  const i = list.findIndex(c => c.id === cur.id);
  if (i >= 0) { list.splice(i, 1); setStatus(dom, `运镜已删除：${cur.name || cur.id}`); }
  stopPlay();
  pickAnchor = false;
  cur = normDef(emptyDef());
  selectedKf = cur.keyframes.length ? 0 : -1;
  playT = 0;
  renderAll(dom);
  refreshSelect(dom);
}

function renderAll(dom) {
  if (!cur) return;
  dom.cinematicName.value = cur.name || '';
  dom.cinematicDuration.value = cur.durationMs;
  if (dom.cinematicTimeScale) dom.cinematicTimeScale.value = cur.timeScale;
  renderKeyframes(dom);
  renderRefs(dom);
  refreshSelect(dom);
  drawPreview(dom);
}

// ── 板显隐 ──
export function showCinematicsBoard(show, dom, state) {
  const b = document.body;
  b.classList.toggle('cinematics-mode', show);
  if (show) b.classList.remove('artboard-mode', 'weapon-mode', 'pet-mode');
  pickAnchor = false;
  if (show) {
    stateRef = state; domRef = dom;
    if (!refs.length) refs = seedRefs(state.level);
    if (!cur) {
      const first = getCinematics(state)[0];
      cur = normDef(first ? structuredClone(first) : emptyDef());
      selectedKf = cur.keyframes.length ? 0 : -1;
    }
    playT = 0; stopPlay();
    if (dom.cinematicPlay) dom.cinematicPlay.disabled = false;
    renderAll(dom);
  } else {
    stopPlay();
  }
}

export function initCinematicsBoard(dom, state) {
  stateRef = state; domRef = dom;
  dom.cinematicBack.onclick = () => showCinematicsBoard(false, dom, state);

  dom.cinematicName.oninput = e => { if (cur) cur.name = e.target.value; };

  dom.cinematicSelect.onchange = e => {
    stopPlay();
    pickAnchor = false;
    const id = e.target.value;
    if (!id) { cur = normDef(emptyDef()); selectedKf = cur.keyframes.length ? 0 : -1; }
    else {
      const c = getCinematics(state).find(c => c.id === id);
      cur = normDef(c ? structuredClone(c) : { id });
      selectedKf = cur.keyframes.length ? 0 : -1;
    }
    playT = 0; renderAll(dom);
  };

  dom.cinematicNew.onclick = () => {
    stopPlay();
    pickAnchor = false;
    cur = normDef(emptyDef());
    selectedKf = cur.keyframes.length ? 0 : -1;
    playT = 0; renderAll(dom);
  };

  dom.cinematicDuration.onchange = () => {
    if (!cur) return;
    const d = Math.max(1, Number(dom.cinematicDuration.value) || 1000);
    cur.durationMs = d;
    cur.keyframes.forEach(k => k.t = Math.min(k.t, d));
    cur.keyframes.sort((a, b) => a.t - b.t);
    renderKeyframes(dom); drawPreview(dom);
  };

  dom.cinematicTimeScale.onchange = () => {
    if (!cur) return;
    const v = Math.max(0.05, Math.min(1, Number(dom.cinematicTimeScale.value) || 1));
    cur.timeScale = v;
    dom.cinematicTimeScale.value = v;
    drawPreview(dom);
  };

  dom.cinematicSave.onclick = () => saveCurrent(dom);
  dom.cinematicDelete.onclick = () => deleteCurrent(dom);
  dom.cinematicSetAnchor.onclick = () => {
    if (selectedKf < 0) { setStatus(dom, '请先选中一个关键帧', true); return; }
    setAnchorMode(dom, true);
  };

  dom.cinematicPlay.onclick = () => {
    if (!cur || cur.keyframes.length < 2) { setStatus(dom, '至少 2 个关键帧才能播放', true); return; }
    stopPlay();
    playT = 0;
    playing = true;
    lastPaint = performance.now();
    dom.cinematicPlay.disabled = true;
    raf = requestAnimationFrame(tickPlay);
  };
  dom.cinematicStop.onclick = () => { stopPlay(); if (dom.cinematicPlay) dom.cinematicPlay.disabled = false; drawPreview(dom); };

  dom.cinematicAddKeyframe.onclick = () => {
    if (!cur) return;
    const last = cur.keyframes[cur.keyframes.length - 1];
    cur.keyframes.push(normKf({ t: last ? last.t + 200 : 0 }));
    selectedKf = cur.keyframes.length - 1;
    renderKeyframes(dom); drawPreview(dom);
  };

  dom.cinematicAddRef.onclick = () => addRefByPrompt(dom);

  // 关键帧输入（input 即时更新模型，change 时按 t 重排）
  dom.cinematicKeyframes.addEventListener('input', e => {
    const t = e.target;
    if (!cur) return;
    const row = t.closest('.cinema-kf'); if (!row) return;
    const i = Number(row.dataset.kfindex); const kf = cur.keyframes[i]; if (!kf) return;
    const key = t.dataset.kf; if (!key) return;
    if (key === 'ease') { kf.ease = t.value; drawPreview(dom); return; }
    const v = Number(t.value);
    if (!Number.isFinite(v)) return;
    kf[key] = v;
    drawPreview(dom);
  });
  dom.cinematicKeyframes.addEventListener('change', e => {
    const t = e.target;
    if (!cur) return;
    const row = t.closest('.cinema-kf'); if (!row) return;
    const i = Number(row.dataset.kfindex); const kf = cur.keyframes[i]; if (!kf) return;
    const key = t.dataset.kf; if (!key) return;
    if (key === 't') {
      kf.t = Math.max(0, Number(t.value) || 0);
      cur.keyframes.sort((a, b) => a.t - b.t);
      selectedKf = cur.keyframes.findIndex(k => k === kf);
      cur.keyframes.forEach(k => k.t = Math.min(k.t, cur.durationMs));
      renderKeyframes(dom); drawPreview(dom);
    } else if (key === 'ease') {
      kf.ease = t.value; drawPreview(dom);
    }
  });

  // 预览画布点击：锚点选点模式 → 拾取中心锚点；否则添加参照物
  dom.cinematicPreviewCanvas.onclick = e => {
    if (!cur) return;
    const canvas = dom.cinematicPreviewCanvas;
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (canvas.width / r.width);
    const sy = (e.clientY - r.top) * (canvas.height / r.height);
    if (pickAnchor) {
      const w = screenToWorld(state.level, sx, sy);
      setAnchorMode(dom, false);
      applyCenterMigration(dom, Math.round(w.x), Math.round(w.y));
      return;
    }
    // 原有：添加参照物（用当前相机逆变换得到世界坐标）
    const w = screenToWorld(state.level, sx, sy);
    refs.push({ x: Math.round(w.x), y: Math.round(w.y), type: 'marker' });
    renderRefs(dom); drawPreview(dom);
  };
}
