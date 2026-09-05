// 武器设计稿运行时存取：按 id 缓记载入 / 构建运行时条目并入战斗 WEAPONS 表。
// 分类：引擎-编辑器（画板系统衍生）。导出：registerWeapon, ensureWeaponDef, ensureWeaponDefs,
//        getWeaponDef, loadWeaponDefs, getWeaponChoices, refreshWeaponChoices, ensureWeaponChoices,
//        registerBuiltinWeapons
import { WEAPONS } from '../combat/weapons.js';
import { listWeapons, loadWeapon } from '../../api.js';
import { normalizeWeaponDesign } from './weapon-design.js';
import { buildWeaponRuntimeEntry } from './weapon-runtime.js';
import { buildBuiltinWeaponDesigns } from './default-weapons.js';
import { registerWeaponId } from '../../player-data.js';
import { setWeaponCaps } from './weapon-caps.js';

const designCache = new Map();
const loads = new Map();
let choices = [];

// 把一份武器设计构建成运行时条目并入 WEAPONS 表，同时缓存设计稿 / 登记武器目录 / 写入改件上限
export function registerWeapon(design) {
  if (!design || !design.id) return null;
  const d = normalizeWeaponDesign(design);
  designCache.set(d.id, d);
  WEAPONS[d.id] = buildWeaponRuntimeEntry(d);
  registerWeaponId(d.id);
  setWeaponCaps(d.id, d.maxGenericMods, d.maxDedicatedMods);
  return d;
}

// 单武器改件数量上限（设计稿定义，缺省回退默认值）
export function getModCaps(weaponId) {
  const d = designCache.get(weaponId);
  if (d) return { generic: d.maxGenericMods ?? 3, dedicated: d.maxDedicatedMods ?? 1 };
  return { generic: 3, dedicated: 1 };
}

export function getWeaponDef(id) { return id ? (designCache.get(id) || null) : null; }

export function ensureWeaponDef(id) {
  if (!id) return Promise.resolve(null);
  const cached = designCache.get(id);
  if (cached) {
    if (!WEAPONS[id]) WEAPONS[id] = buildWeaponRuntimeEntry(cached);
    return Promise.resolve(cached);
  }
  if (!loads.has(id)) {
    loads.set(id, loadWeapon(id)
      .then(raw => registerWeapon(raw))
      .catch(() => { loads.delete(id); return null; }));
    loads.get(id).then((v) => { if (v) loads.delete(id); });
  }
  return loads.get(id);
}

export function ensureWeaponDefs(ids) {
  return Promise.all([...new Set((ids || []).filter(Boolean))].map(ensureWeaponDef));
}

// 加载全部武器设计并注册（游戏启动 / 编辑器武器列表刷新用）。
// 直接 loadWeapon()+registerWeapon 而非 ensureWeaponDef：ensureWeaponDef 会因
// registerBuiltinWeapons 预注册的内置 yellow/green 命中缓存而短路，导致磁盘上的同名覆盖
// （用户编辑保存后）永远读不到、刷新即被内置默认值重置。这里必须逐个拉盘覆盖缓存。
export async function loadWeaponDefs() {
  const res = await listWeapons();
  const ids = (res && res.weapons || []).map(w => w.id);
  await Promise.all(ids.map(id => loadWeapon(id).then(raw => registerWeapon(raw)).catch(() => null)));
  return ids;
}

export function getWeaponChoices() { return choices; }
export function refreshWeaponChoices() {
  return listWeapons().then(res => {
    const raw = (res && res.weapons) || [];
    choices = raw.map(a => (typeof a === 'string' ? { id: a, name: a } : a)).filter(a => a && a.id && a.id !== 'undefined');
    return choices;
  }).catch(() => { choices = []; return []; });
}
export function ensureWeaponChoices() { return choices.length ? Promise.resolve(choices) : refreshWeaponChoices(); }

// 启动时注册内置设计稿武器（yellow/green），使其进入 WEAPONS / 目录 / 改件上限。
// 必须早于首次 normalizePlayer 调用，否则存档 schema/目录不含 yellow/green。
// 打包端无 /api/weapons 服务器，故内置武器不能只靠 loadWeaponDefs 载入。
export function registerBuiltinWeapons() {
  for (const d of buildBuiltinWeaponDesigns()) registerWeapon(d);
}
