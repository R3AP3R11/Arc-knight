/**
 * 文件职责：局内消耗品（药水队列、即时生效）与限时加成的纯逻辑（无 Phaser，可在 node 中直接跑）
 * 归属分类：数值_经济
 * 主要导出：POTION_CAP、statMul、normalizeEffect、potionQueueAdd、potionQueueTakeFront、applyStatEffect
 * 依赖：无
 */

// 药水最多同时持有 4 瓶（对应局内轮盘 4 格）；满格后再获得「新 id」的药水直接丢弃
export const POTION_CAP = 4;

// 百分比数值 → 乘子：25 → 1.25（药水/祝福统一用「百分比」配表）
export function statMul(value) {
  return 1 + (Number(value) || 0) / 100;
}

// 归一化效果结构：任何非法输入一律兜底为「无效果」，避免下游读 undefined
export function normalizeEffect(raw) {
  const e = raw || {};
  return {
    type: String(e.type ?? '').trim(),
    value: Number(e.value) || 0,
    sec: Number(e.sec) || 0
  };
}

// 药水队列（先进先出，可重叠：同 id 叠加 count，不占新格）。
// 满 POTION_CAP 且是新 id → 返回 false 且不改动 list（丢弃新获得的这瓶）。
export function potionQueueAdd(list, id, count = 1) {
  const q = Array.isArray(list) ? list : [];
  const key = String(id);
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const found = q.find(r => r && String(r.id) === key);
  if (found) { found.count = (Number(found.count) || 0) + n; return true; }
  if (q.length >= POTION_CAP) return false;
  q.push({ id: key, count: n });
  return true;
}

// 取出「最先获得且未被使用」的一瓶：返回副本 { id, count: 1 }，并就地扣 1；
// 该条目 count 减到 0 时从队列移除。空队列 → null。
export function potionQueueTakeFront(list) {
  const q = Array.isArray(list) ? list : [];
  const front = q.find(r => r && (Number(r.count) || 0) > 0);
  if (!front) return null;
  const out = { id: String(front.id), count: 1 };
  front.count = (Number(front.count) || 0) - 1;
  if (front.count <= 0) q.splice(q.indexOf(front), 1);
  return out;
}

// combat 属性加成（dir = 1 生效、「乘 mul」）与回退（dir = -1、「乘 1/mul」）。
// heal / shield / 空 type 不是乘算属性，直接跳过（由调用方另行处理）。
// mul <= 0 按 1 处理，避免除零 / 值被抹平。
export function applyStatEffect(combat, type, mul, dir) {
  if (!combat || typeof combat !== 'object') return;
  const key = String(type ?? '').trim();
  if (!key || key === 'heal' || key === 'shield') return;
  const m = Number(mul) > 0 ? Number(mul) : 1;
  const cur = Number(combat[key] ?? 1);
  const base = Number.isFinite(cur) ? cur : 1;
  combat[key] = base * (Number(dir) < 0 ? 1 / m : m);
}
