// ============================================================
// 画板设计稿运行时存取。
// 职责：游戏/编辑器侧按 id 懒加载 design JSON 并缓存；提供设计稿下拉选项（id+name）。
// 主要导出：getDesign, ensureDesign, ensureDesigns, registerDesign,
//           getArtChoices, refreshArtChoices
// ============================================================
import { listAssets, loadAsset } from '../../api.js';

const cache = new Map();   // id -> design
const loads = new Map();   // id -> Promise（进行中的加载）
let choices = [];          // [{id,name}] 下拉选项

export function getDesign(id) { return id ? cache.get(id) || null : null; }

export function ensureDesign(id) {
  if (!id) return Promise.resolve(null);
  if (cache.has(id)) return Promise.resolve(cache.get(id));
  if (!loads.has(id)) {
    loads.set(id, loadAsset(id)
      .then(d => { cache.set(id, d); loads.delete(id); return d; })
      .catch(() => { loads.delete(id); return null; }));
  }
  return loads.get(id);
}

export function ensureDesigns(ids) {
  return Promise.all([...new Set((ids || []).filter(Boolean))].map(ensureDesign));
}

// 直接把一个 design 写入缓存（转换器生成默认方案后无需重新拉取）
export function registerDesign(id, design) { if (id && design) cache.set(id, design); }

export function getArtChoices() { return choices; }

export function refreshArtChoices() {
  return listAssets().then(res => {
    const raw = (res && res.assets) || [];
    choices = raw
      .map(a => typeof a === 'string' ? { id: a, name: a } : a)
      .filter(a => a && a.id && a.id !== 'undefined');
    return choices;
  }).catch(() => { choices = []; return []; });
}
