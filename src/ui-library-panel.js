import { getLibrary, getComponent } from './ui-library.js';
import { getDesign, ensureDesign, getArtChoices, refreshArtChoices } from './systems/art/design-store.js';
import { getIdolBuffs, saveUi } from './api.js';
import { setIdolBuffs } from './systems/economy/buffs.js';

let selectedId = null;
let propState = {};
let hover = false;

// 赐福卡片配置编辑状态（data/ui/idol-buffs.json）
let blessingCfg = null;
let blessingIdx = 0;

const PREVIEW_POS = { x: 60, y: 210 };

// 可加成属性（与 player.combat 字段一致）
const BLESS_COMBAT_ATTRS = [
  ['attackPower', '攻击'], ['critRate', '暴击率'], ['dodgeRate', '闪避率'],
  ['moveSpeed', '移速'], ['attackSpeed', '攻速'], ['maxHp', '生命'],
  ['maxShield', '护盾'], ['damageReduction', '减伤']
];
const BLESS_OPS = [['add', '加算 +'], ['mul', '乘算 ×'], ['set', '设为']];

function currentBuff() { return blessingCfg?.buffs?.[blessingIdx]; }
function esc(v) { return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function attrOptions(sel) {
  return BLESS_COMBAT_ATTRS.map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
}
function opOptions(sel) {
  return BLESS_OPS.map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
}
function statsToRows(stats) {
  return Object.entries(stats || {}).map(([attr, spec]) => ({ attr, op: spec?.op || 'add', value: spec?.value ?? 0 }));
}
function rowsToStats(rows) {
  const s = {};
  for (const r of rows || []) { if (!r.attr) continue; s[r.attr] = { op: r.op || 'add', value: Number(r.value) || 0 }; }
  return s;
}
function seedBlessingCfg() {
  return {
    offerCount: 3,
    buffs: [{ id: `idol-${Date.now()}`, name: '力量祝福', desc: '攻击力 +15%', icon: '', stats: { attackPower: { op: 'mul', value: 1.15 } } }]
  };
}

function renderField(key, label, type, value) {
  if (type === 'asset') {
    const opts = getArtChoices().map(a =>
      `<option value="${a.id}" ${a.id === value ? 'selected' : ''}>${a.name || a.id}</option>`
    ).join('');
    return `<label>${label}<select data-prop="${key}">${opts || '<option value="">无资产</option>'}</select></label>`;
  }
  if (type === 'color') return `<label>${label}<input type="color" data-prop="${key}" value="${value || '#ffffff'}"></label>`;
  if (type === 'text') return `<label>${label}<input type="text" data-prop="${key}" value="${esc(value)}"></label>`;
  return `<label>${label}<input type="number" data-prop="${key}" value="${value ?? ''}"></label>`;
}

function cardHTML(comp, active) {
  return `<div class="uil-library-card ${active ? 'active' : ''}" data-comp="${comp.id}">
    <strong>${comp.name}</strong> <em>${comp.category}</em>
    <p class="hint">${comp.description || ''}</p>
  </div>`;
}

export function renderUILibraryList(dom) {
  const lib = getLibrary();
  dom.uilibraryList.innerHTML = lib.map(c => cardHTML(c, c.id === selectedId)).join('');
  dom.uilibraryList.querySelectorAll('[data-comp]').forEach(card => {
    card.onclick = async () => {
      const comp = getComponent(card.dataset.comp);
      selectedId = comp.id;
      propState = { ...comp.defaultProps };
      hover = false;
      dom.uilibraryHover.checked = false;
      if (selectedId === 'GiftCard') {
        try {
          const cfg = await getIdolBuffs();
          blessingCfg = cfg && Array.isArray(cfg.buffs)
            ? { offerCount: Number(cfg.offerCount) || 3, buffs: cfg.buffs }
            : null;
        } catch {
          blessingCfg = null;
        }
        if (!blessingCfg || !blessingCfg.buffs?.length) blessingCfg = seedBlessingCfg();
        if (blessingIdx >= blessingCfg.buffs.length) blessingIdx = 0;
      }
      renderUILibraryList(dom);
      renderUILibraryPreview(dom);
    };
  });
}

// ── 赐福卡片：预览绘制（仅重绘 canvas，不重建表单，保留输入焦点）──
function drawBlessingCanvas(dom) {
  const comp = getComponent('GiftCard');
  if (!comp) return;
  const canvas = dom.uilibraryCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(W / 1920, H / 1080);
  ctx.fillStyle = hover ? '#0e2233' : '#000';
  ctx.fillRect(0, 0, 1920, 1080);
  const buf = currentBuff();
  if (buf) {
    const p = { ...comp.defaultProps, icon: buf.icon, name: buf.name, desc: buf.desc };
    comp.draw2d(ctx, p, { hover: hover ? 1 : 0 });
  }
  ctx.restore();
  if (buf?.icon && !getDesign(buf.icon)) {
    ensureDesign(buf.icon).then(() => {
      if (document.body.classList.contains('uilibrary-mode')) requestAnimationFrame(() => renderUILibraryPreview(dom));
    });
  }
}

// ── 赐福卡片：多卡编辑表单（icon + 名称/描述/加成 + offerCount，保存写回配置）──
function renderBlessingForm(dom) {
  const cfg = blessingCfg;
  if (!cfg) {
    dom.uilibraryForm.innerHTML = `<div class="hint">赐福配置加载中…</div>`;
    return;
  }
  const buf = currentBuff();
  const opts = getArtChoices().map(a =>
    `<option value="${a.id}" ${a.id === buf?.icon ? 'selected' : ''}>${a.name || a.id}</option>`
  ).join('');
  const pickOpts = (cfg.buffs || []).map((b, i) =>
    `<option value="${i}" ${i === blessingIdx ? 'selected' : ''}>${b.name || b.id || '卡片' + (i + 1)}</option>`
  ).join('');
  const statRows = (buf?.stats ? statsToRows(buf.stats) : []).map((r, i) =>
    `<div class="blessing-stat">
      <select data-stat="attr">${attrOptions(r.attr)}</select>
      <select data-stat="op">${opOptions(r.op)}</select>
      <input type="number" data-stat="value" value="${esc(r.value)}">
      <button type="button" data-stat="del">✕</button>
    </div>`
  ).join('');

  dom.uilibraryForm.innerHTML = `
    <div class="blessing-editor" style="display:flex;flex-direction:column;gap:8px;max-width:640px">
      <label>每次出现几张 <input type="number" data-bless="offerCount" min="1" max="9" value="${cfg.offerCount}"></label>
      <label>编辑卡片 <select data-bless="pick">${pickOpts}</select></label>
      <div class="blessing-fields" style="display:flex;flex-direction:column;gap:6px">
        <label>名称 <input type="text" data-bless="name" value="${esc(buf?.name)}"></label>
        <label>描述 <input type="text" data-bless="desc" value="${esc(buf?.desc)}"></label>
        <label>图标 <select data-bless="icon">${opts || '<option value="">无（黑圆）</option>'}</select></label>
      </div>
      <div class="blessing-stats">
        <h4>加成</h4>
        <div data-stats style="display:flex;flex-direction:column;gap:4px">${statRows || '<div class="hint">暂无加成项</div>'}</div>
        <button type="button" data-bless="addStat">+ 加成项</button>
      </div>
      <div class="blessing-actions" style="display:flex;gap:8px">
        <button type="button" data-bless="addCard">+ 新增卡片</button>
        <button type="button" data-bless="delCard">删除此卡</button>
        <button type="button" data-bless="save">保存配置</button>
      </div>
      <div class="hint" data-bless="status"></div>
    </div>`;

  bindBlessingEvents(dom);
}

function bindBlessingEvents(dom) {
  const root = dom.uilibraryForm;
  const statValueInputs = () => [...root.querySelectorAll('[data-stat="value"]')];
  const statAttrInputs = () => [...root.querySelectorAll('[data-stat="attr"]')];
  const statOpInputs = () => [...root.querySelectorAll('[data-stat="op"]')];

  const onOfferCount = root.querySelector('[data-bless="offerCount"]');
  if (onOfferCount) onOfferCount.oninput = e => { blessingCfg.offerCount = Math.max(1, Math.round(Number(e.target.value) || 1)); };

  const onPick = root.querySelector('[data-bless="pick"]');
  if (onPick) onPick.onchange = e => { blessingIdx = Number(e.target.value) || 0; renderUILibraryPreview(dom); };

  const onName = root.querySelector('[data-bless="name"]');
  if (onName) onName.oninput = e => { const b = currentBuff(); if (b) { b.name = e.target.value; drawBlessingCanvas(dom); } };

  const onDesc = root.querySelector('[data-bless="desc"]');
  if (onDesc) onDesc.oninput = e => { const b = currentBuff(); if (b) { b.desc = e.target.value; drawBlessingCanvas(dom); } };

  const onIcon = root.querySelector('[data-bless="icon"]');
  if (onIcon) onIcon.onchange = e => { const b = currentBuff(); if (b) { b.icon = e.target.value; renderUILibraryPreview(dom); } };

  const addStat = root.querySelector('[data-bless="addStat"]');
  if (addStat) addStat.onclick = () => { const b = currentBuff(); if (!b) return; const rows = statsToRows(b.stats); rows.push({ attr: 'attackPower', op: 'add', value: 1 }); b.stats = rowsToStats(rows); renderUILibraryPreview(dom); };

  const addCard = root.querySelector('[data-bless="addCard"]');
  if (addCard) addCard.onclick = () => { blessingCfg.buffs.push({ id: `idol-${Date.now()}`, name: '新祝福', desc: '', icon: '', stats: {} }); blessingIdx = blessingCfg.buffs.length - 1; renderUILibraryPreview(dom); };

  const delCard = root.querySelector('[data-bless="delCard"]');
  if (delCard) delCard.onclick = () => {
    if (blessingCfg.buffs.length <= 1) { setStatusText(dom, '至少保留 1 张卡片'); return; }
    blessingCfg.buffs.splice(blessingIdx, 1);
    blessingIdx = Math.max(0, blessingIdx - 1);
    renderUILibraryPreview(dom);
  };

  const save = root.querySelector('[data-bless="save"]');
  if (save) save.onclick = () => saveBlessingCfg(dom);

  // 统计行：attr/op/value 就地更新（不重建表单保留焦点），del 重建
  statAttrInputs().forEach((sel, i) => sel.onchange = e => { const b = currentBuff(); if (!b) return; const rows = statsToRows(b.stats); if (rows[i]) { rows[i].attr = e.target.value; b.stats = rowsToStats(rows); } });
  statOpInputs().forEach((sel, i) => sel.onchange = e => { const b = currentBuff(); if (!b) return; const rows = statsToRows(b.stats); if (rows[i]) { rows[i].op = e.target.value; b.stats = rowsToStats(rows); } });
  statValueInputs().forEach((inp, i) => inp.oninput = e => { const b = currentBuff(); if (!b) return; const rows = statsToRows(b.stats); if (rows[i]) { rows[i].value = Number(e.target.value) || 0; b.stats = rowsToStats(rows); } });
  root.querySelectorAll('[data-stat="del"]').forEach((btn, i) => btn.onclick = () => { const b = currentBuff(); if (!b) return; const rows = statsToRows(b.stats); rows.splice(i, 1); b.stats = rowsToStats(rows); renderUILibraryPreview(dom); });
}

function setStatusText(dom, msg) {
  const el = dom.uilibraryForm.querySelector('[data-bless="status"]');
  if (el) el.textContent = msg;
}

async function saveBlessingCfg(dom) {
  setStatusText(dom, '保存中…');
  try {
    await saveUi('idol-buffs', blessingCfg);
    setIdolBuffs(blessingCfg);
    setStatusText(dom, '✓ 已保存，游戏内即时生效');
  } catch (e) {
    setStatusText(dom, '保存失败：' + (e?.message || e));
  }
}

export function renderUILibraryPreview(dom) {
  const comp = getComponent(selectedId);
  if (!comp) return;

  if (selectedId === 'GiftCard') {
    if (!blessingCfg) { renderBlessingForm(dom); return; }
    drawBlessingCanvas(dom);
    renderBlessingForm(dom);
    return;
  }

  const canvas = dom.uilibraryCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(W / 1920, H / 1080);
  ctx.fillStyle = hover ? '#0e2233' : '#000';
  ctx.fillRect(0, 0, 1920, 1080);
  const p = { ...propState, x: PREVIEW_POS.x, y: PREVIEW_POS.y };
  if (comp.draw2d) comp.draw2d(ctx, p, { hover: hover ? 1 : 0 });
  ctx.restore();
  // 图标为动态资产且尚未缓存：异步加载完成后重绘（draw2d 先画黑圆占位）
  const iconId = propState.icon;
  if (iconId && !getDesign(iconId)) {
    ensureDesign(iconId).then(() => {
      if (document.body.classList.contains('uilibrary-mode')) requestAnimationFrame(() => renderUILibraryPreview(dom));
    });
  }
  renderForm(dom, comp);
}

function renderForm(dom, comp) {
  dom.uilibraryForm.innerHTML = comp.propsSchema.map(f =>
    renderField(f.key, f.label, f.type, propState[f.key])
  ).join('');
  dom.uilibraryForm.querySelectorAll('[data-prop]').forEach(input => {
    input.oninput = () => {
      const key = input.dataset.prop;
      propState[key] = input.type === 'number' ? Number(input.value) : input.value;
      renderUILibraryPreview(dom);
    };
  });
}

export function toggleUILibraryHover(dom) {
  hover = !hover;
  renderUILibraryPreview(dom);
}

export function showUILibrary(show) {
  document.body.classList.toggle('uilibrary-mode', show);
}

export function initUILibraryPanel(dom) {
  if (!getLibrary().length) return;
  selectedId = getLibrary()[0].id;
  propState = { ...getComponent(selectedId).defaultProps };
  dom.uilibraryHover.checked = false;
  renderUILibraryList(dom);
  renderUILibraryPreview(dom);
  // 异步拉资产列表填充「图标资产」下拉，加载完成后重刷
  refreshArtChoices().then(() => {
    if (getLibrary().length) { renderUILibraryList(dom); renderUILibraryPreview(dom); }
  });
}
