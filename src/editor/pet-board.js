// 宠物编辑器工作台：编辑宠物数值（外形/弹道引用 + 环绕/开火/生命等），保存到 data/pets/*.json。
// 分类：引擎-编辑器。导出：showPetBoard, getPetDesign, initPetBoard
import { savePet } from '../api.js';
import { normalizePetDesign, defaultPetDesign } from '../systems/art/pet-design.js';
import { registerPet, getPetDef, getPetChoices, listPetDefs } from '../systems/art/pet-store.js';
import { getArtChoices } from '../systems/art/design-store.js';
import { weaponCatalog } from '../systems/art/weapon-registry.js';
import { getWeaponDef } from '../systems/art/weapon-store.js';
import { ITEM_DEFS } from '../state.js';
import { setStatus } from '../ui.js';

let design = defaultPetDesign();
let designId = '';

// 宠物数值表单字段：[path, label, type]（type: number/bool/text/art/weapon）
const FIELDS = [
  ['art', '外形(画板资产)', 'art'],
  ['weapon', '弹道(武器id)', 'weapon'],
  ['radius', '环绕半径', 'number'],
  ['angularSpeed', '环绕角速度°s', 'number'],
  ['size', '宠物大小', 'number'],
  ['fireInterval', '开火频率ms', 'number'],
  ['damage', '伤害', 'number'],
  ['maxHp', '生命上限(0=无敌)', 'number'],
  ['hitActive', '可被击中', 'bool'],
  ['price', '购买价格', 'number'],
  ['unlockLevel', '解锁等级', 'number'],
  ['description', '机制说明', 'text']
];

function coerceField(type, el) {
  if (type === 'bool') return el.checked;
  if (type === 'number') return Number(el.value);
  return el.value;
}

function artOptions() {
  return getArtChoices().map(c => [c.id, c.name || c.id]);
}

function weaponOptions() {
  return weaponCatalog().map(id => [id, getWeaponDef(id)?.name || id]);
}

function fieldHTML([path, label, type]) {
  const val = design[path];
  if (type === 'bool') {
    return `<label>${label}<input data-path="${path}" data-type="bool" type="checkbox" ${val ? 'checked' : ''}></label>`;
  }
  if (type === 'art') {
    const opts = artOptions().map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
    return `<label>${label}<select data-path="${path}" data-type="text">${opts}</select></label>`;
  }
  if (type === 'weapon') {
    const opts = weaponOptions().map(([v, l]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${l}</option>`).join('');
    return `<label>${label}<select data-path="${path}" data-type="text">${opts}</select></label>`;
  }
  if (type === 'text') {
    return `<label>${label}<input data-path="${path}" data-type="text" type="text" value="${val ?? ''}"></label>`;
  }
  return `<label>${label}<input data-path="${path}" data-type="number" type="number" step="any" value="${val == null ? '' : val}"></label>`;
}

function updateHint(dom) {
  const own = design.description || ITEM_DEFS[design.id]?.effect || '';
  dom.petHint.innerHTML = `<p>机制：环绕玩家旋转，自动朝最近敌人开火。</p><p>说明：${own || '（无）'}</p><p>id：${design.id || '（未保存）'}</p>`;
}

function renderPetForm(dom) {
  dom.petForm.innerHTML = FIELDS.map(f => fieldHTML(f)).join('');
  updateHint(dom);
}

function refreshPetSelect(dom) {
  let choices = getPetChoices();
  if (!choices || !choices.length) choices = listPetDefs().map(d => ({ id: d.id, name: d.name || d.id }));
  const opts = ('<option value="">（新建）</option>' + (choices || [])
    .map(c => `<option value="${c.id}">${c.name || c.id}</option>`).join(''));
  dom.petSelect.innerHTML = opts;
  if (designId) dom.petSelect.value = designId;
}

async function saveCurrent(dom) {
  if (!designId) designId = 'pet-' + Date.now();
  design.id = designId;
  design = normalizePetDesign(design);
  try {
    await savePet(designId, design);
    registerPet(design);
    setStatus(dom, `宠物已保存：${designId}`);
    // ITEM_DEFS 未含该宠物时可提示在 state.js 注册物品（否则装备槽归一化会丢弃）
    if (!ITEM_DEFS[designId]) setStatus(dom, `已保存，但请在 state.js:ITEM_DEFS 注册该宠物物品（category:'pet'）以供装备`, true);
    refreshPetSelect(dom);
  } catch (e) {
    setStatus(dom, `保存失败：${e.message}`, true);
  }
}

export function showPetBoard(show, dom, state) {
  const b = document.body;
  b.classList.toggle('pet-mode', show);
  if (show) b.classList.remove('artboard-mode', 'weapon-mode');
  if (show) {
    design = defaultPetDesign();
    designId = '';
    dom.petName.value = '';
    renderPetForm(dom);
    refreshPetSelect(dom);
  }
}

export function getPetDesign() { return design; }

export function initPetBoard(dom, state) {
  dom.petBack.onclick = () => showPetBoard(false, dom, state);

  dom.petForm.addEventListener('input', onPetInput);
  dom.petForm.addEventListener('change', onPetInput);

  dom.petName.addEventListener('input', e => { design.name = e.target.value; design = normalizePetDesign(design); });

  dom.petSelect.addEventListener('change', e => {
    const id = e.target.value;
    if (!id) { design = defaultPetDesign(); designId = ''; dom.petName.value = ''; renderPetForm(dom); return; }
    const d = getPetDef(id);
    if (!d) { setStatus(dom, `未找到宠物 ${id}`, true); return; }
    design = normalizePetDesign(JSON.parse(JSON.stringify(d)));
    designId = id;
    dom.petName.value = design.name;
    renderPetForm(dom);
  });

  dom.petNew.onclick = () => { design = defaultPetDesign(); designId = ''; dom.petName.value = ''; renderPetForm(dom); };

  dom.petSave.onclick = () => saveCurrent(dom);

  function onPetInput(e) {
    const el = e.target;
    if (!el.dataset.path) return;
    design[el.dataset.path] = coerceField(el.dataset.type, el);
    design = normalizePetDesign(design);
    dom.petName.value = design.name;
    updateHint(dom);
  }
}
