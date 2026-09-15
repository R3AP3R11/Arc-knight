/**
 * 文件职责：休息火堆（局内可交互物）的纯逻辑：三选一升级 roll 与生效（属性祝福 / 通用改件）
 * 归属分类：数值_经济
 * 主要导出：CAMPFIRE_ART_DEFAULT、remainingGenericSlots、genericModPool、rollCampfireUpgrades、applyCampfireOption、campfireHeal
 * 依赖：state.js（MOD_DEFS / ITEM_DEFS / WEAPON_LABELS）、economy/buffs.js（IDOL_BUFFS）、
 *       art/weapon-caps.js（getWeaponCaps）、economy/weapon-buffs.js（addWeaponBuffs）
 * 说明：本模块为纯逻辑（禁止 import Phaser），局内态挂在 scene / player 上，不写存档。
 *
 * campfire.statBuffs 语义（「可抽基础属性强化」配置）：[{ id, name, value }]
 *   - id    = IDOL_BUFFS 的 id（必须存在，否则该项被丢弃）
 *   - name  = 显示名称（空字符串 = 用 IDOL_BUFFS 该条目的默认 name）
 *   - value = 覆盖该祝福「第一条 stat」的数值（null / 非有限数 = 用表默认值）
 *   - 兼容旧数据：数组元素为 string 时按 { id: 该字符串 } 处理
 *   - 空数组 = 全部祝福、全部用表默认（向后兼容）
 * 属性类 option 的每条 entry = { id, name, desc, stats }：
 *   - name  = 显示名；desc = 词条完整文本（`${name} ${deltaText}`）
 *   - stats = { [statKey]: { op, value } }（value 已套用覆盖值，故 weapon-buffs 无需改动即可生效）
 */
import { MOD_DEFS, ITEM_DEFS, WEAPON_LABELS } from '../../state.js';
import { IDOL_BUFFS } from './buffs.js';
import { getWeaponCaps } from '../art/weapon-caps.js';
import { addWeaponBuffs } from './weapon-buffs.js';

// 休息火堆默认美术（画板动态资产 id）；编辑器放置实体时写入的默认值同为该资产。
export const CAMPFIRE_ART_DEFAULT = 'asset-1789356238754';

// ── 该武器还剩几个「通用改件」槽位 ──
// 上限 = getWeaponCaps(weaponType).generic；占用 = 装备槽 generic 去重计数 + 局内临时改件计数。
// 结果不为负（超装配时按 0 处理）。
export function remainingGenericSlots(scene, weaponType) {
  const p = scene?.player;
  const caps = getWeaponCaps(weaponType);
  const raw = p?.equipment?.weaponMods?.[weaponType]?.generic;
  const equipCount = new Set((Array.isArray(raw) ? raw : []).map(String)).size;
  const temp = p?.tempMods?.[weaponType];
  const tempCount = Array.isArray(temp) ? temp.length : 0;
  return Math.max(0, (Number(caps.generic) || 0) - (equipCount + tempCount));
}

// ── 该武器当前可装配的「通用改件」id 数组 ──
// 取 MOD_DEFS 中 weapon==='' 的项，排除该武器已装备的 generic / dedicated 与局内 tempMods。
export function genericModPool(scene, weaponType) {
  const p = scene?.player;
  const slot = p?.equipment?.weaponMods?.[weaponType];
  const used = new Set();
  const g = Array.isArray(slot?.generic) ? slot.generic : (slot?.generic ? [slot.generic] : []);
  for (const id of g) used.add(String(id));
  const ded = Array.isArray(slot?.dedicated) ? slot.dedicated : (slot?.dedicated ? [slot.dedicated] : []);
  for (const id of ded) used.add(String(id));
  const temp = p?.tempMods?.[weaponType];
  for (const id of (Array.isArray(temp) ? temp : [])) used.add(String(id));
  return Object.entries(MOD_DEFS)
    .filter(([id, def]) => def && def.weapon === '' && !used.has(String(id)))
    .map(([id]) => id);
}

// 单条 option 判重失败时的最大「独立重抽」次数（重抽 = 重新随机武器 + 重新随机 kind）
const MAX_RETRY = 12;

// ── 随机 roll 出恰好 3 条火堆升级 option（3 条 key 互不重复） ──
// opt = { weapons, weaponIndex, player }
//   weapons     武器 id 数组（缺省取 scene.player.weapons）
//   weaponIndex 当前武器下标（仅作上下文，不影响随机结果）
//   player      预留（与 scene.player 等价时忽略）
// 单条 option 生成规则：
//   先随机武器（允许重复）→ 再随机词条类型（属性 / 改件）；
//   若该武器 remainingGenericSlots<=0 或 genericModPool 为空 → 回退属性类；
//   属性类池为空 → 回退改件类；两类都空 → entries=[]（drawing 侧会跳过该按钮）。
// 去重：每确定一条 option 计算 key（武器|kind|词条 id 排序集）写入 used；
//       后续 option 与 used 撞 key 时按「重抽 → 只换词条 → 换武器 → 接受重复」降级。
export function rollCampfireUpgrades(scene, campfire, opt) {
  const o = opt || {};
  const weapons = normalizeWeapons(o.weapons, scene, o.weaponIndex);
  const statPool = resolveBuffConfigs(campfire);
  const used = new Set();   // 已确定 option 的 key（只在成功确定一条后写入）
  const out = [];
  for (let i = 0; i < 3; i++) {
    const option = pickDistinctOption(scene, weapons, statPool, used);
    used.add(optionKey(option));
    out.push(option);
  }
  return out;
}

// ── 挑一条与 used 不重复的 option（返回的 entries 一定非空，除非两类池都空） ──
// ① 独立重抽最多 MAX_RETRY 次（每次重新随机武器 + kind，回退逻辑见 buildOption）；
// ② 降级 A：沿用最后一次的武器，只换词条（属性换一批祝福 / 改件换一个 id）；
// ③ 降级 B：换武器（优先 used 里没出现过的武器）；
// ④ 三级都失败 → 接受重复（避免死循环）。
function pickDistinctOption(scene, weapons, statPool, used) {
  let last = null;
  for (let t = 0; t < MAX_RETRY; t++) {
    last = buildOption(scene, weapons, statPool);
    if (!used.has(optionKey(last))) return last;
  }
  return rebuildWithSameWeapon(scene, last, statPool, used)
    || rebuildWithOtherWeapon(scene, weapons, statPool, used)
    || buildOption(scene, weapons, statPool);   // 接受重复；entries 仍非空（除非两类池都空）
}

// ── 生成一条候选 option（forcedWeapon 非空时固定武器，否则随机） ──
// 保持既有回退逻辑：mod 池空 → 回退 stat；stat 池空 → 回退 mod；两类都空 → kind=null、entries=[]。
function buildOption(scene, weapons, statPool, forcedWeapon) {
  const weaponType = forcedWeapon || weapons[Math.floor(Math.random() * weapons.length)];
  const weaponIndex = Math.max(0, weapons.indexOf(weaponType));
  const weaponName = WEAPON_LABELS[weaponType] || weaponType;
  const modPool = (remainingGenericSlots(scene, weaponType) > 0) ? genericModPool(scene, weaponType) : [];
  const modOk = modPool.length > 0;
  const statOk = statPool.length > 0;

  let kind = null;
  if (modOk && statOk) kind = Math.random() < 0.5 ? 'mod' : 'stat';
  else if (modOk) kind = 'mod';
  else if (statOk) kind = 'stat';

  return makeOption(kind, weaponType, weaponIndex, weaponName, modPool, statPool);
}

// 按 kind 组装 option（字段结构不变）；kind=null 表示两类池都空
function makeOption(kind, weaponType, weaponIndex, weaponName, modPool, statPool) {
  if (kind === 'mod') {
    const id = modPool[Math.floor(Math.random() * modPool.length)];
    return { kind: 'mod', weaponType, weaponIndex, weaponName, entries: [makeModEntry(id)] };
  }
  if (kind === 'stat') {
    return { kind: 'stat', weaponType, weaponIndex, weaponName, entries: rollStatEntries(statPool) };
  }
  // 两类都空：保留按钮位但无词条，drawing 侧按 entries.length===0 跳过
  return { kind: 'stat', weaponType, weaponIndex, weaponName, entries: [] };
}

// 降级 A：固定武器，只换词条（改件换一个 id / 属性换一批祝福）
function rebuildWithSameWeapon(scene, base, statPool, used) {
  if (!base) return null;
  const { weaponType, weaponIndex, weaponName } = base;
  const modPool = (remainingGenericSlots(scene, weaponType) > 0) ? genericModPool(scene, weaponType) : [];
  if (modPool.length) {
    for (const id of shuffle(modPool)) {
      const cand = { kind: 'mod', weaponType, weaponIndex, weaponName, entries: [makeModEntry(id)] };
      if (!used.has(optionKey(cand))) return cand;
    }
  }
  if (statPool.length) {
    for (let t = 0; t < MAX_RETRY; t++) {
      const cand = { kind: 'stat', weaponType, weaponIndex, weaponName, entries: rollStatEntries(statPool) };
      if (!used.has(optionKey(cand))) return cand;
    }
  }
  return null;
}

// 降级 B：换武器（优先 used 里没出现过的武器）
function rebuildWithOtherWeapon(scene, weapons, statPool, used) {
  const seen = new Set([...used].map(k => k.split('|')[0]));
  const order = [...weapons].sort((a, b) => (seen.has(a) ? 1 : 0) - (seen.has(b) ? 1 : 0));
  for (const weaponType of order) {
    for (let t = 0; t < MAX_RETRY; t++) {
      const cand = buildOption(scene, weapons, statPool, weaponType);
      if (!used.has(optionKey(cand))) return cand;
    }
  }
  return null;
}

// 判重 key：武器 | kind | 词条 id 集合（升序拼接）；entries=[] 时 id 集合为空串
function optionKey(option) {
  const ids = (Array.isArray(option?.entries) ? option.entries : [])
    .map(e => String(e?.id ?? '')).sort();
  return `${option?.weaponType || ''}|${option?.kind || ''}|${ids.join('+')}`;
}

// 改件 id → 词条 entry = { id, name, desc, icon }
function makeModEntry(id) {
  const def = MOD_DEFS[id] || {};
  const item = ITEM_DEFS[id] || {};
  return { id, name: def.name || '', desc: item.effect || '', icon: item.icon || '' };
}

// 属性类：随机取 1~2 条祝福（池不足 2 条时取 1 条）转 entry
function rollStatEntries(statPool) {
  const n = statPool.length >= 2 ? (Math.random() < 0.5 ? 1 : 2) : Math.min(statPool.length, 1);
  return shuffle(statPool).slice(0, n).map(makeStatEntry);
}

// ── 生效一条 option ──
// 属性类 → addWeaponBuffs(scene, weaponType, entries)；改件类 → 写入 player.tempMods[weaponType]
// （去重、受 remainingGenericSlots 约束，超上限不写）。生效返回 true，未生效返回 false。
export function applyCampfireOption(scene, option) {
  const p = scene?.player;
  if (!p || !option) return false;
  const wt = option.weaponType;
  if (option.kind === 'mod') {
    const id = option.entries?.[0]?.id;
    if (!id) return false;
    if (remainingGenericSlots(scene, wt) <= 0) return false;
    p.tempMods = p.tempMods || {};
    const list = Array.isArray(p.tempMods[wt]) ? p.tempMods[wt] : (p.tempMods[wt] = []);
    if (list.includes(id)) return false;
    list.push(id);
    return true;
  }
  if (option.kind === 'stat') {
    if (!Array.isArray(option.entries) || !option.entries.length) return false;
    return addWeaponBuffs(scene, wt, option.entries);
  }
  return false;
}

// ── 火堆回复：把生命回满（仅当局） ──
export function campfireHeal(scene) {
  const p = scene?.player;
  if (!p) return false;
  p.hp = Number(p.maxHp) || 0;
  return true;
}

// ── 内部工具 ──

// 归一化武器数组：字符串直接用；{type|id} 对象取其 id；缺省回退 scene.player.weapons / ['radial']
function normalizeWeapons(list, scene, fallbackIndex) {
  const src = (Array.isArray(list) && list.length)
    ? list
    : (Array.isArray(scene?.player?.weapons) && scene.player.weapons.length ? scene.player.weapons : ['radial']);
  const out = src
    .map(w => typeof w === 'string' ? w : (w?.type || w?.id || ''))
    .filter(Boolean);
  if (out.length) return out;
  const wt = scene?.player?.weaponType;
  if (wt) return [wt];
  return ['radial'];
}

// 归一化火堆「可抽基础属性强化」配置 → [{ id, name, value }]
//   - 空数组（或非数组）→ 全部 IDOL_BUFFS，name=''/value=null（即全部用表默认）；保持向后兼容语义
//   - 非空 → 逐项转换并过滤掉 IDOL_BUFFS 里不存在的 id
//   - 兼容旧数据：元素为 string 时按 { id: 该字符串, name:'', value:null } 处理
function resolveBuffConfigs(campfire) {
  const all = Array.isArray(IDOL_BUFFS) ? IDOL_BUFFS : [];
  const raw = Array.isArray(campfire?.statBuffs) ? campfire.statBuffs : [];
  if (!raw.length) return all.map(b => ({ id: b.id, name: '', value: null }));
  const known = new Set(all.map(b => String(b.id)));
  return raw
    .map(e => (typeof e === 'string'
      ? { id: e, name: '', value: null }
      : {
        id: String(e?.id ?? ''),
        name: typeof e?.name === 'string' ? e.name : '',
        // null / undefined / 空串 / 非有限数 一律回落 null（= 用表默认）；
        // 不可用 Number.isFinite(Number(v))：Number(null) 与 Number('') 都是 0，会把「用默认值」误判成「覆盖为 0」
        value: (e?.value === null || e?.value === undefined || e?.value === '') ? null
          : (Number.isFinite(Number(e.value)) ? Number(e.value) : null)
      }))
    .filter(e => e.id && known.has(e.id));
}

// 配置项 → 属性类词条 entry = { id, name, desc, stats }
// 取 IDOL_BUFFS 该条目的第一条 stat：statKey / op / 表默认 value；
// 覆盖值 cfg.value（非 null 且有限）优先，否则用表默认。stats 已套用覆盖值，weapon-buffs 无需改动即可生效。
function makeStatEntry(cfg) {
  const b = (Array.isArray(IDOL_BUFFS) ? IDOL_BUFFS : []).find(x => String(x.id) === String(cfg.id)) || {};
  const stats = b.stats || {};
  const statKey = Object.keys(stats)[0] || '';
  const spec = stats[statKey] || {};
  const op = spec.op;
  const tableValue = Number(spec.value);
  const name = cfg.name || b.name || '';
  const value = (cfg.value === null || !Number.isFinite(Number(cfg.value))) ? tableValue : Number(cfg.value);
  const outStats = statKey ? { [statKey]: { op, value } } : {};
  const desc = `${name} ${formatDelta(op, statKey, value)}`;
  return { id: cfg.id, name, desc, stats: outStats };
}

// 数值 → 词条增量文本（不含前导空格）：mul=百分比增减；add=Rate 结尾按百分比、否则原值；set=→value
function formatDelta(op, statKey, value) {
  const v = Number(value);
  if (op === 'mul') {
    const pct = (v - 1) * 100;
    return `${pct >= 0 ? '+' : '-'}${trimNum(Math.abs(pct))}%`;
  }
  if (op === 'set') return `→${trimNum(v)}`;
  if (String(statKey).endsWith('Rate')) return `${v >= 0 ? '+' : '-'}${trimNum(Math.abs(v) * 100)}%`;
  return `${v >= 0 ? '+' : '-'}${trimNum(Math.abs(v))}`;
}

// 保留最多 1 位小数并去掉多余 0（如 15 → '15'、12.5 → '12.5'）；非有限数按 0。
function trimNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 10) / 10);
}

// Fisher–Yates 洗牌（返回新数组，不改原数组）
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
