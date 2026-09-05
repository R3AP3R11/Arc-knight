// 宠物设计稿运行时存取：按 id 缓记载入 / 构建运行时可查询定义。
// 分类：引擎-编辑器（画板系统衍生）。导出：registerPet, ensurePetDef, ensurePetDefs,
//        getPetDef, listPetDefs, loadPetDefs, getPetChoices, refreshPetChoices,
//        registerBuiltinPets
import { listPets, loadPet } from '../../api.js';
import { normalizePetDesign } from './pet-design.js';
import { buildBuiltinPetDesigns } from './default-pets.js';

const designCache = new Map();
const loads = new Map();
let choices = [];

// 把一份宠物设计归一化并缓存（不重复 id 则覆盖）
export function registerPet(design) {
  if (!design || !design.id) return null;
  const d = normalizePetDesign(design);
  designCache.set(d.id, d);
  return d;
}

export function getPetDef(id) { return id ? (designCache.get(id) || null) : null; }

export function listPetDefs() { return [...designCache.values()]; }

export function ensurePetDef(id) {
  if (!id) return Promise.resolve(null);
  const cached = designCache.get(id);
  if (cached) return Promise.resolve(cached);
  if (!loads.has(id)) {
    loads.set(id, loadPet(id)
      .then(raw => registerPet(raw))
      .catch(() => { loads.delete(id); return null; }));
    loads.get(id).then(v => { if (v) loads.delete(id); });
  }
  return loads.get(id);
}

export function ensurePetDefs(ids) {
  return Promise.all([...new Set((ids || []).filter(Boolean))].map(ensurePetDef));
}

// 拉取全部宠物定义并逐个覆盖缓存（编辑器保存后刷新用；避免 registerBuiltinPets 预注册命中缓存短路）
export async function loadPetDefs() {
  const res = await listPets();
  const ids = (res && res.pets || []).map(p => p.id);
  await Promise.all(ids.map(id => loadPet(id).then(raw => registerPet(raw)).catch(() => null)));
  return ids;
}

export function getPetChoices() { return choices; }

export function refreshPetChoices() {
  return listPets().then(res => {
    const raw = (res && res.pets) || [];
    choices = raw.map(a => (typeof a === 'string' ? { id: a, name: a } : a)).filter(a => a && a.id && a.id !== 'undefined');
    return choices;
  }).catch(() => { choices = []; return []; });
}

export function ensurePetChoices() { return choices.length ? Promise.resolve(choices) : refreshPetChoices(); }

// 打包端无 /api/pets 服务器：启动时注册内置宠物，使定义可查询（可被编辑器保存后的磁盘文件覆盖）
export function registerBuiltinPets() {
  for (const d of buildBuiltinPetDesigns()) registerPet(d);
}
