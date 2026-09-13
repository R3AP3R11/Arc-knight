/**
 * 文件职责：局内商店刷新与老虎机抽奖的纯逻辑（无 Phaser 依赖，可在 node 中直接跑）
 * 归属分类：数值_经济
 * 主要导出：SHOP_ITEM_COUNT、LOTTERY_ROLL_MS、loadInnerShop、getInnerShopData、setInnerShopData、rollShopStock、rollLottery、
 *           isInstantItem、isPotionItem、getPotionList、findConsumable、getItemEffect、getItemArt
 * 依赖：api.js、systems/art/weapon-store.js、systems/art/weapon-registry.js
 */
import { getInnerShop } from '../../api.js';
import { getWeaponDef } from '../art/weapon-store.js';
import { weaponCatalog } from '../art/weapon-registry.js';

// 右侧商店一次刷出的商品数
export const SHOP_ITEM_COUNT = 4;
// 老虎机摇奖动画时长（设计稿规定 2.5s）
export const LOTTERY_ROLL_MS = 2500;

// 取数失败 / 配表为空时的兜底结构
const emptyShop = () => ({ consumables: [], weapons: [], lottery: { drawCost: 15, goldPrize: 15, kinds: [] } });

let shopData = null;
let loadPromise = null;

export function getInnerShopData() {
  return shopData;
}

export function setInnerShopData(data) {
  shopData = data && typeof data === 'object' ? data : emptyShop();
  return shopData;
}

// 拉取并缓存：并发调用复用同一 Promise；失败回退空结构且不抛（下次调用可重试）
export async function loadInnerShop() {
  if (!loadPromise) {
    loadPromise = getInnerShop()
      .then(data => setInnerShopData(data))
      .catch(() => { loadPromise = null; return setInnerShopData(null); });
  }
  return loadPromise;
}

// ——消耗品效果相关访问（全部基于 getInnerShopData()，不发网络请求、不缓存副本）——

// 是否「即时生效」类：购买/获得时立刻生效，不进药水槽位（表格列「是否即时生效」）
export function isInstantItem(c) {
  return (c || {}).instant === true;
}

// 是否「药水」类：未即时生效 且 局内栏位 === 1（进 HUD 药水槽位、可用数字键 4 使用）
export function isPotionItem(c) {
  const e = c || {};
  return !isInstantItem(e) && Number(e.slot) === 1;
}

// 当前配置里的全部药水（数据未就绪时返回 []）
export function getPotionList() {
  const list = getInnerShopData()?.consumables;
  return Array.isArray(list) ? list.filter(isPotionItem) : [];
}

// 按消耗品 id 查配置（String 比较，数据未就绪返回 null）
export function findConsumable(id) {
  const list = getInnerShopData()?.consumables;
  if (!Array.isArray(list)) return null;
  const key = String(id ?? '');
  return list.find(c => String(c?.id ?? '') === key) || null;
}

// 归一化效果：→ { type, value, sec }；type 为空串表示无效果（sec > 0 限时，sec === 0 本局永久）
export function getItemEffect(c) {
  const e = c || {};
  return {
    type: String(e.effectType ?? '').trim(),
    value: Number(e.effectValue) || 0,
    sec: Number(e.effectSec) || 0
  };
}

// 局内表现美术方案：优先「局内表现」两列（两者都非空才用），否则回退「图标」两列
export function getItemArt(c) {
  const e = c && typeof c === 'object' ? c : {};
  const t = String(e.artTypeInRun ?? '').trim();
  const n = String(e.artNameInRun ?? '').trim();
  if (t && n) return { artType: t, artName: n };
  return { artType: String(e.artType ?? '').trim(), artName: String(e.artName ?? '').trim() };
}

function resolveName(entry) {
  const e = entry || {};
  return e.name || getWeaponDef(e.id)?.name || String(e.id ?? '');
}

// 武器表的编号是表格编号（"101"…），与项目武器 id（"yellow"…）不同：
// 优先用导表补的 weaponId；旧版数据（无该字段）时按 name 反查武器目录兜底。
function reverseWeaponId(name) {
  const n = String(name ?? '').trim();
  if (!n) return '';
  for (const id of weaponCatalog()) if (getWeaponDef(id)?.name === n) return id;
  return '';
}

function resolveWeaponId(entry) {
  const e = entry || {};
  const explicit = String(e.weaponId ?? '').trim();
  if (explicit) return explicit;
  return reverseWeaponId(e.name || getWeaponDef(e.id)?.name || '');
}

// 商店卡片统一结构：消耗品带 desc / artType / artName，武器美术复用商城武器卡故留空串
function toShopCard(entry, kind) {
  const e = entry || {};
  const id = String(e.id ?? '');
  const cost = Number(e.cost) || 0;
  if (kind === 'weapon') {
    return { kind, id, weaponId: resolveWeaponId(e), name: resolveName(e), desc: '', cost, artType: '', artName: '', durationSec: Number(e.durationSec) || 0 };
  }
  return { kind, id, weaponId: '', name: resolveName(e), desc: e.desc || '', cost, artType: e.artType || '', artName: e.artName || '' };
}

// Fisher-Yates 洗牌，用传入 rng 保证可复现
function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

function pick(list, rng) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

export function rollShopStock(data, rng = Math.random) {
  const pool = [
    ...(data?.consumables || []).map(c => toShopCard(c, 'consumable')),
    ...(data?.weapons || []).map(w => toShopCard(w, 'weapon'))
  ];
  shuffle(pool, rng);
  return pool.slice(0, Math.min(SHOP_ITEM_COUNT, pool.length));
}

const toLotteryWeapon = entry => {
  const w = entry || {};
  return {
    id: String(w.id ?? ''), weaponId: resolveWeaponId(w), name: resolveName(w), cost: Number(w.cost) || 0,
    durationSec: Number(w.durationSec) || 0, artType: w.artType || '', artName: w.artName || ''
  };
};

const toLotteryConsumable = entry => {
  const c = entry || {};
  return {
    id: String(c.id ?? ''), weaponId: '', name: resolveName(c), desc: c.desc || '', cost: Number(c.cost) || 0,
    artType: c.artType || '', artName: c.artName || ''
  };
};

function resolvePrize(icons, data, rng) {
  if (icons[0] !== icons[1] || icons[1] !== icons[2]) return null;
  const key = icons[0];
  if (key === 'weapon') {
    const pool = (data?.weapons || []).filter(w => w?.inLottery === true);
    const w = pick(pool, rng);
    return w ? { kind: 'weapon', item: toLotteryWeapon(w) } : null;
  }
  if (key === 'shield') {
    const pool = (data?.consumables || []).filter(c => c?.inLottery === true);
    const c = pick(pool, rng);
    return c ? { kind: 'consumable', item: toLotteryConsumable(c) } : null;
  }
  if (key === 'gold') return { kind: 'gold', amount: Number(data?.lottery?.goldPrize) || 0 };
  if (key === 'trash') return { kind: 'trash' };
  // 策划扩展的未知 key：无奖励但不抛
  return { kind: 'none' };
}

export function rollLottery(data, rng = Math.random) {
  const kinds = data?.lottery?.kinds;
  if (!Array.isArray(kinds) || !kinds.length) {
    return { icons: ['trash', 'trash', 'trash'], prize: { kind: 'trash' } };
  }

  // 直接出货判定：r 落在某个 kind 的累计权重区间内 → 该 kind 三连出货
  const r = rng() * 100;
  let acc = 0;
  let hit = null;
  for (const k of kinds) {
    acc += Number(k?.weight) || 0;
    if (r < acc) { hit = k?.key; break; }
  }

  const pickKey = () => kinds[Math.min(kinds.length - 1, Math.floor(rng() * kinds.length))]?.key;
  // 未命中直接出货时：3 个窗口各自独立等概率
  const icons = hit ? [hit, hit, hit] : [pickKey(), pickKey(), pickKey()];
  return { icons, prize: resolvePrize(icons, data, rng) };
}
