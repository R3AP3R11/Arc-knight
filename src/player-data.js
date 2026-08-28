// 玩家存档数据模型：归一化 + 默认值
// 存储位置：data/players/ 目录，每档一个 JSON 文件，index.json 记录槽位列表
import { ITEM_DEFS } from './state.js';

export const PLAYER_VERSION = 1;

// 每把武器的强化方向数量
export const WEAPON_ENHANCE_DIRECTIONS = 3;

// 武器列表（顺序即展示顺序）
export const PLAYER_WEAPONS = ['radial', 'yellow', 'green'];

// 初始已解锁的武器
export const DEFAULT_UNLOCKED_WEAPONS = ['radial'];

// 出战槽解锁等级：槽 0 默认解锁，槽 1 12 级解锁，槽 2 30 级解锁
export const SLOT_UNLOCK_LEVELS = [12, 30];

// 每升 1 级获得 1 点可分配属性点（等级 1 时为 0）
export function pointsEarnedForLevel(level) {
  return Math.max(0, Math.floor(Number(level) || 0) - 1);
}

// 升级：等级 +1，可分配点数 +1（为未来升级流程预留）
export function grantLevelUp(player) {
  if (!player || !player.progress) return player;
  player.progress.level += 1;
  player.progress.points += 1;
  return player;
}

const emptyWeaponMods = () => ({
  radial: { generic: [], dedicated: null },
  yellow: { generic: [], dedicated: null },
  green: { generic: [], dedicated: null }
});

export const DEFAULT_PLAYER = {
  version: PLAYER_VERSION,
  meta: {
    name: '新存档',
    createdAt: 0,
    updatedAt: 0,
    playTimeSec: 0
  },
  // 等级与经验
  progress: {
    level: 1,
    exp: 0,
    expToNext: 100,
    points: 0
  },
  // 货币
  currency: {
    gold: 0
  },
  // 武器数据：是否获得 + 3 个强化方向（1/0，可共存）
  weapons: {
    radial: { unlocked: true, enhance: [0, 0, 0] },
    yellow: { unlocked: false, enhance: [0, 0, 0] },
    green: { unlocked: false, enhance: [0, 0, 0] }
  },
  // 出战槽数组（固定 3 槽：槽1 恒 radial，槽2/槽3 空槽用 '' 表示）
  loadout: ['radial', '', ''],
  // 是否参与过新手 newbee 关卡
  playedNewbee: false,
  // 战斗属性（玩家本体，非武器）
  combat: {
    moveSpeed: 1,        // 移动速度倍率，1 = 100%
    attackPower: 1,      // 攻击力倍率，1 = 100%（作用于每把武器的基础攻击）
    critRate: 0,         // 暴击率，0~1，0 = 0%；暴击伤害翻倍
    attackSpeed: 1,      // 攻击速度倍率，1 = 100%（作用于每把武器的基础射速）
    maxHp: 100,          // 生命值上限
    maxShield: 50,       // 护盾值上限
    damageReduction: 1,  // 免伤，1 = 100%（收到的伤害按此百分比计算）
    dodgeRate: 0         // 闪避率，0~1，0 = 0%
  },
  // 升级点数已分配到各属性（用于上限判断），与 combat 数值联动
  points: {
    maxHp: 0,
    maxShield: 0,
    attackPower: 0,
    attackSpeed: 0
  },
  // 仓库：可堆叠物品（id→数量）+ 不可堆叠物品（[{uid, itemId}]）
  items: {
    stacks: {},
    uniques: []
  },
  // 装备：武器改件槽 + 圣物 + 宠物
  equipment: {
    weaponMods: emptyWeaponMods(),
    relics: [],
    pets: []
  },
  // 关卡解锁进度
  levels: {
    unlocked: ['level-1'],
    completed: [],
    current: 'level-1'
  }
};

function normalizeStacks(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [id, count] of Object.entries(value)) {
    if (!ITEM_DEFS[id]) continue;
    const n = Math.floor(Number(count) || 0);
    if (n > 0) out[id] = n;
  }
  return out;
}

function normalizeUniques(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < value.length; i++) {
    const u = value[i] || {};
    const itemId = String(u.itemId || '');
    const def = ITEM_DEFS[itemId];
    if (!def || def.stackable !== false || seen.has(itemId)) continue;
    seen.add(itemId);
    out.push({
      uid: u.uid ? String(u.uid) : `u-${itemId}-${Date.now()}-${i}`,
      itemId
    });
  }
  return out;
}

function normalizeLoadout(value) {
  const out = ['radial', '', ''];
  if (!Array.isArray(value)) return out;
  const seen = new Set(['radial']);
  for (let i = 0; i < Math.min(value.length, 3); i++) {
    const w = String(value[i] || '');
    if (!w || !PLAYER_WEAPONS.includes(w) || seen.has(w)) continue;
    if (i === 0 && w !== 'radial') continue;
    seen.add(w);
    out[i] = w;
  }
  return out;
}

function normalizeWeaponMods(value) {
  const src = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const w of PLAYER_WEAPONS) {
    const slot = src[w] && typeof src[w] === 'object' ? src[w] : {};
    const generic = Array.isArray(slot.generic)
      ? [...new Set(
          slot.generic
            .map(String)
            .filter(id => {
              const def = ITEM_DEFS[id];
              return def && def.category === 'mod' && def.weapon === '';
            })
        )]
      : [];
    const dedicatedRaw = slot.dedicated == null ? null : String(slot.dedicated);
    const dedicatedDef = dedicatedRaw ? ITEM_DEFS[dedicatedRaw] : null;
    const dedicated = dedicatedDef && dedicatedDef.category === 'mod' && dedicatedDef.weapon === w
      ? dedicatedRaw
      : null;
    out[w] = { generic, dedicated };
  }
  return out;
}

function normalizeItemList(value, category, max) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    if (out.length >= max) break;
    const id = String(raw);
    const def = ITEM_DEFS[id];
    if (!def || def.category !== category || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizePoints(value) {
  const src = value && typeof value === 'object' ? value : {};
  return {
    maxHp: Math.max(0, Math.floor(Number(src.maxHp) || 0)),
    maxShield: Math.max(0, Math.floor(Number(src.maxShield) || 0)),
    attackPower: Math.max(0, Math.floor(Number(src.attackPower) || 0)),
    attackSpeed: Math.max(0, Math.floor(Number(src.attackSpeed) || 0))
  };
}

// 归一化 3 个强化方向：数组或对象 {0/1/2: 1|0} 均可，统一为长度 3 的 0/1 数组
function normalizeEnhance(value) {
  const out = new Array(WEAPON_ENHANCE_DIRECTIONS).fill(0);
  if (Array.isArray(value)) {
    for (let i = 0; i < WEAPON_ENHANCE_DIRECTIONS; i++) {
      out[i] = Number(value[i]) ? 1 : 0;
    }
  } else if (value && typeof value === 'object') {
    for (let i = 0; i < WEAPON_ENHANCE_DIRECTIONS; i++) {
      out[i] = Number(value[i] ?? value[String(i)]) ? 1 : 0;
    }
  }
  return out;
}

function clampPercent(value, def) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(1, Math.max(0, n));
}

// 有限数值取用，否则回退默认值（区分合法 0 与缺省）
function numOr(value, def) {
  const n = Number(value);
  return Number.isFinite(n) ? n : def;
}

function uniqueStrings(value, fallback) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter(Boolean))]
    : [...fallback];
}

export function normalizePlayer(value) {
  const data = value || {};
  const d = DEFAULT_PLAYER;
  const rawExpToNext = Number(data.progress?.expToNext);

  const c = data.combat || {};
  return {
    version: PLAYER_VERSION,
    meta: {
      name: data.meta?.name || '新存档',
      createdAt: Number(data.meta?.createdAt) || 0,
      updatedAt: Number(data.meta?.updatedAt) || 0,
      playTimeSec: Math.max(0, Math.floor(Number(data.meta?.playTimeSec) || 0))
    },
    progress: {
      level: Math.max(1, Math.floor(Number(data.progress?.level) || 1)),
      exp: Math.max(0, Math.floor(Number(data.progress?.exp) || 0)),
      expToNext: Math.max(1, Math.floor(Number.isFinite(rawExpToNext) ? rawExpToNext : 100)),
      points: Math.max(0, Math.floor(Number(data.progress?.points) || 0))
    },
    currency: {
      gold: Math.max(0, Math.floor(Number(data.currency?.gold) || 0))
    },
    weapons: Object.fromEntries(PLAYER_WEAPONS.map(w => {
      const wd = data.weapons?.[w] || {};
      return [w, {
        unlocked: wd.unlocked !== undefined
          ? !!wd.unlocked
          : DEFAULT_UNLOCKED_WEAPONS.includes(w),
        enhance: normalizeEnhance(wd.enhance)
      }];
    })),
    loadout: normalizeLoadout(data.loadout),
    playedNewbee: !!data.playedNewbee,
    combat: {
      moveSpeed: Math.max(0.1, numOr(c.moveSpeed, 1)),
      attackPower: Math.max(0, numOr(c.attackPower, 1)),
      critRate: clampPercent(c.critRate, 0),
      attackSpeed: Math.max(0.1, numOr(c.attackSpeed, 1)),
      maxHp: Math.max(1, Math.floor(numOr(c.maxHp, 100))),
      maxShield: Math.max(0, Math.floor(numOr(c.maxShield, 50))),
      damageReduction: clampPercent(c.damageReduction, 1),
      dodgeRate: clampPercent(c.dodgeRate, 0)
    },
    points: normalizePoints(data.points),
    items: {
      stacks: normalizeStacks(data.items?.stacks),
      uniques: normalizeUniques(data.items?.uniques)
    },
    equipment: {
      weaponMods: normalizeWeaponMods(data.equipment?.weaponMods),
      relics: normalizeItemList(data.equipment?.relics, 'relic', 3),
      pets: normalizeItemList(data.equipment?.pets, 'pet', 2)
    },
    levels: {
      unlocked: uniqueStrings(data.levels?.unlocked, d.levels.unlocked),
      completed: uniqueStrings(data.levels?.completed, d.levels.completed),
      current: String(data.levels?.current || d.levels.current)
    }
  };
}
