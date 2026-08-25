// 玩家存档数据模型：归一化 + 默认值
// 存储位置：data/players/ 目录，每档一个 JSON 文件，index.json 记录槽位列表

export const PLAYER_VERSION = 1;

// 每把武器的强化方向数量
export const WEAPON_ENHANCE_DIRECTIONS = 3;

// 武器列表（顺序即展示顺序）
export const PLAYER_WEAPONS = ['radial', 'yellow', 'green'];

// 初始已解锁的武器
export const DEFAULT_UNLOCKED_WEAPONS = ['radial'];

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
    gold: 0,
    charge: 0
  },
  // 武器数据：是否获得 + 3 个强化方向（1/0，可共存）
  weapons: {
    radial: { unlocked: true, enhance: [0, 0, 0] },
    yellow: { unlocked: false, enhance: [0, 0, 0] },
    green: { unlocked: false, enhance: [0, 0, 0] }
  },
  // 改件：装备中的改件列表，每项 { id, weapon }，weapon 为空表示通用改件
  mods: [],
  // 改件库存：已拥有但未装备的改件 id 列表
  modInventory: [],
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
    attackPower: 0,
    critRate: 0,
    attackSpeed: 0
  },
  // 物品：可叠加道具（id→数量）+ 独特装备（数组）
  items: {
    stacks: {},
    uniques: []
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
    const n = Math.floor(Number(count) || 0);
    if (n > 0) out[id] = n;
  }
  return out;
}

function normalizeUniques(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((u, i) => ({
      uid: u?.uid || `item-${Date.now()}-${i}`,
      itemId: String(u?.itemId || ''),
      ...(u?.attrs && typeof u.attrs === 'object' ? { attrs: u.attrs } : {})
    }))
    .filter(u => u.itemId);
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

function normalizeMods(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  const out = [];
  for (const m of value) {
    const id = String(m?.id || '');
    if (!id || ids.has(id)) continue;
    ids.add(id);
    out.push({ id, weapon: m?.weapon ? String(m.weapon) : '' });
  }
  return out;
}

function clampPercent(value, def) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(1, Math.max(0, n));
}

function uniqueStrings(value, fallback) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter(Boolean))]
    : [...fallback];
}

export function normalizePlayer(value) {
  const data = value || {};
  const d = DEFAULT_PLAYER;

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
      expToNext: Math.max(1, Math.floor(Number(data.progress?.expToNext) || 100)),
      points: Math.max(0, Math.floor(Number(data.progress?.points) || 0))
    },
    currency: {
      gold: Math.max(0, Math.floor(Number(data.currency?.gold) || 0)),
      charge: Math.max(0, Math.floor(Number(data.currency?.charge) || 0))
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
    mods: normalizeMods(data.mods),
    modInventory: uniqueStrings(data.modInventory, []),
    playedNewbee: !!data.playedNewbee,
    combat: {
      moveSpeed: Math.max(0.1, Number(c.moveSpeed) || 1),
      attackPower: Math.max(0, Number(c.attackPower) || 1),
      critRate: clampPercent(c.critRate, 0),
      attackSpeed: Math.max(0.1, Number(c.attackSpeed) || 1),
      maxHp: Math.max(1, Math.floor(Number(c.maxHp) || 100)),
      maxShield: Math.max(0, Math.floor(Number(c.maxShield) || 50)),
      damageReduction: clampPercent(c.damageReduction, 1),
      dodgeRate: clampPercent(c.dodgeRate, 0)
    },
    points: {
      maxHp: Math.max(0, Math.floor(Number(data.points?.maxHp) || 0)),
      attackPower: Math.max(0, Math.floor(Number(data.points?.attackPower) || 0)),
      critRate: Math.max(0, Math.floor(Number(data.points?.critRate) || 0)),
      attackSpeed: Math.max(0, Math.floor(Number(data.points?.attackSpeed) || 0))
    },
    items: {
      stacks: normalizeStacks(data.items?.stacks),
      uniques: normalizeUniques(data.items?.uniques)
    },
    levels: {
      unlocked: uniqueStrings(data.levels?.unlocked, d.levels.unlocked),
      completed: uniqueStrings(data.levels?.completed, d.levels.completed),
      current: String(data.levels?.current || d.levels.current)
    }
  };
}
