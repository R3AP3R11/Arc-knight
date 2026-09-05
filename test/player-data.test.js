import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlayer,
  DEFAULT_PLAYER,
  PLAYER_WEAPONS,
  DEFAULT_UNLOCKED_WEAPONS,
  SLOT_UNLOCK_LEVELS,
  pointsEarnedForLevel,
  grantLevelUp
} from '../src/player-data.js';
import { ITEM_DEFS, MOD_DEFS } from '../src/state.js';

// 玩家存档归一化纯逻辑单元测试（无需服务器）

test('normalizePlayer 空输入返回完整默认结构', () => {
  const p = normalizePlayer(null);
  for (const key of ['version', 'meta', 'progress', 'currency', 'weapons', 'loadout', 'playedNewbee', 'combat', 'points', 'items', 'equipment', 'levels']) {
    assert.ok(key in p, `缺少字段 ${key}`);
  }
  assert.equal(p.version, 1);
  assert.equal(p.progress.level, 1);
  assert.equal(p.currency.gold, 0);
  assert.equal(p.currency.gems, 0);
  assert.equal(p.playedNewbee, false);
  assert.deepEqual(p.loadout, ['radial', '', '']);
  assert.deepEqual(p.equipment.weaponMods.radial, { generic: [], dedicated: [] });
  assert.deepEqual(p.equipment.relics, []);
  assert.deepEqual(p.equipment.pets, []);
});

test('normalizePlayer 默认解锁武器只有 radial', () => {
  const p = normalizePlayer(null);
  for (const w of PLAYER_WEAPONS) {
    assert.equal(p.weapons[w].unlocked, DEFAULT_UNLOCKED_WEAPONS.includes(w), `${w} 解锁状态错误`);
  }
});

test('normalizePlayer 往返幂等（保存→加载不丢失字段）', () => {
  const sample = {
    version: 1,
    meta: { name: '测试档', createdAt: 123, updatedAt: 456, playTimeSec: 99 },
    progress: { level: 7, exp: 340, expToNext: 800, points: 3 },
    currency: { gold: 1234, gems: 456 },
    weapons: {
      radial: { unlocked: true, enhance: [1, 0, 1] },
      yellow: { unlocked: true, enhance: { 0: 0, 1: 1, 2: 0 } },
      green: { unlocked: false, enhance: [0, 0, 0] }
    },
    loadout: ['radial', 'yellow'],
    playedNewbee: true,
    combat: { moveSpeed: 1.2, attackPower: 1.5, critRate: 0.25, attackSpeed: 0.8, maxHp: 150, maxShield: 60, damageReduction: 0.7, dodgeRate: 0.1 },
    points: { maxHp: 2, maxShield: 1, attackPower: 1, attackSpeed: 0 },
    items: {
      stacks: { 'multi-track': 2, 'relic-vitality': 1 },
      uniques: [{ uid: 'u1', itemId: 'ricochet' }, { uid: 'u2', itemId: 'pet-ember' }]
    },
    equipment: {
      weaponMods: {
        radial: { generic: ['multi-track'], dedicated: null },
        yellow: { generic: ['spin'], dedicated: 'ricochet' },
        green: { generic: [], dedicated: 'capacity' }
      },
      relics: ['relic-power'],
      pets: ['pet-ember']
    },
    levels: { unlocked: ['level-1', 'level-2'], completed: ['level-1'], current: 'level-2' }
  };
  const once = normalizePlayer(sample);
  const twice = normalizePlayer(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once, '往返后数据应完全一致');
});

test('normalizePlayer 数值边界与非法值兜底', () => {
  const p = normalizePlayer({
    progress: { level: -5, exp: -100, expToNext: 0, points: -1 },
    currency: { gold: -50, gems: -7.9 },
    combat: { critRate: 9, dodgeRate: -1, moveSpeed: 0, maxHp: 0 }
  });
  assert.equal(p.progress.level, 1, 'level 最小 1');
  assert.equal(p.progress.exp, 0, 'exp 最小 0');
  assert.equal(p.progress.expToNext, 1, 'expToNext 最小 1');
  assert.equal(p.progress.points, 0, 'points 最小 0');
  assert.equal(p.currency.gold, 0, 'gold 最小 0');
  assert.equal(p.currency.gems, 0, 'gems 最小 0（负数 clamp、浮点 floor）');
  assert.equal(p.combat.critRate, 1, 'critRate 上限 1');
  assert.equal(p.combat.dodgeRate, 0, 'dodgeRate 下限 0');
  assert.equal(p.combat.moveSpeed, 0.1, 'moveSpeed 下限 0.1');
  assert.equal(p.combat.maxHp, 1, 'maxHp 最小 1');
});

test('normalizePlayer loadout 固定3槽、槽1恒 radial、空槽用空串', () => {
  assert.deepEqual(normalizePlayer({ loadout: ['radial', 'yellow', 'green'] }).loadout, ['radial', 'yellow', 'green']);
  assert.deepEqual(normalizePlayer({ loadout: ['radial', '', 'green'] }).loadout, ['radial', '', 'green']);
  assert.deepEqual(normalizePlayer({ loadout: [] }).loadout, ['radial', '', '']);
  assert.deepEqual(normalizePlayer({ loadout: ['bogus'] }).loadout, ['radial', '', '']);
  assert.deepEqual(normalizePlayer({ loadout: ['yellow'] }).loadout, ['radial', '', '']);
  assert.deepEqual(normalizePlayer({ loadout: ['radial', 'radial', 'yellow', 'green', 'green', 'bogus'] }).loadout, ['radial', '', 'yellow']);
});

test('normalizePlayer items.stacks 仅保留正整数且过滤未知 id', () => {
  const p = normalizePlayer({
    items: { stacks: { 'multi-track': 2, 'relic-vitality': '3', 'spin': 0, potion: 5 } }
  });
  assert.deepEqual(p.items.stacks, { 'multi-track': 2, 'relic-vitality': 3 });
});

test('normalizePlayer items.uniques 不可堆叠且同类最多 1 个', () => {
  const p = normalizePlayer({
    items: {
      uniques: [
        { itemId: 'ricochet' },
        { itemId: 'ricochet', uid: 'second' },
        { itemId: 'multi-track' },
        { itemId: 'pet-ember' },
        { itemId: 'pet-ember' },
        { itemId: 'missing' }
      ]
    }
  });
  assert.equal(p.items.uniques.length, 2);
  assert.deepEqual(p.items.uniques.map(u => u.itemId), ['ricochet', 'pet-ember']);
  assert.ok(p.items.uniques[0].uid, 'uid 缺省时应生成');
});

test('normalizePlayer equipment.weaponMods / relics / pets 归一化与上限', () => {
  const p = normalizePlayer({
    equipment: {
      weaponMods: {
        radial: { generic: ['multi-track', 'multi-track', 'ricochet', 'bogus'], dedicated: 'ricochet' },
        yellow: { generic: ['spin'], dedicated: 'capacity' },
        green: { generic: ['triple', 'triple'], dedicated: 'capacity' }
      },
      relics: ['relic-power', 'relic-power', 'relic-vitality', 'relic-haste', 'pet-ember'],
      pets: ['pet-ember', 'pet-moss', 'pet-ember', 'relic-vitality']
    }
  });
  assert.deepEqual(p.equipment.weaponMods.radial, { generic: ['multi-track'], dedicated: [] });
  assert.deepEqual(p.equipment.weaponMods.yellow, { generic: ['spin'], dedicated: [] });
  assert.deepEqual(p.equipment.weaponMods.green, { generic: ['triple'], dedicated: ['capacity'] });
  assert.deepEqual(p.equipment.relics, ['relic-power', 'relic-vitality', 'relic-haste']);
  assert.deepEqual(p.equipment.pets, ['pet-ember', 'pet-moss']);
});

test('normalizePlayer points 归一化为 4 键非负整数', () => {
  const p = normalizePlayer({ points: { maxHp: 2, maxShield: 1, attackPower: 3, attackSpeed: -1, critRate: 9 } });
  assert.deepEqual(p.points, { maxHp: 2, maxShield: 1, attackPower: 3, attackSpeed: 0 });
  assert.deepEqual(Object.keys(p.points).sort(), ['attackPower', 'attackSpeed', 'maxHp', 'maxShield']);
});

test('ITEM_DEFS 分类正确且 MOD_DEFS 由 ITEM_DEFS 派生', () => {
  assert.equal(ITEM_DEFS['multi-track'].category, 'mod');
  assert.equal(ITEM_DEFS['multi-track'].stackable, true);
  assert.equal(ITEM_DEFS['multi-track'].weapon, '');
  assert.equal(ITEM_DEFS['ricochet'].category, 'mod');
  assert.equal(ITEM_DEFS['ricochet'].stackable, false);
  assert.equal(ITEM_DEFS['ricochet'].weapon, 'yellow');
  assert.equal(ITEM_DEFS['relic-vitality'].category, 'relic');
  assert.equal(ITEM_DEFS['relic-vitality'].stackable, true);
  assert.equal(ITEM_DEFS['pet-ember'].category, 'pet');
  assert.equal(ITEM_DEFS['pet-ember'].stackable, false);

  assert.deepEqual(Object.keys(MOD_DEFS).sort(), ['capacity', 'multi-track', 'pierce', 'ricochet', 'spin', 'split', 'triple']);
  assert.equal(MOD_DEFS['multi-track'].name, '多轨改件');
  assert.equal(MOD_DEFS['multi-track'].weapon, '');
  assert.equal(MOD_DEFS['capacity'].weapon, 'green');
});

test('pointsEarnedForLevel 计算正确', () => {
  assert.equal(pointsEarnedForLevel(1), 0);
  assert.equal(pointsEarnedForLevel(2), 1);
  assert.equal(pointsEarnedForLevel(30), 29);
  assert.equal(pointsEarnedForLevel(-5), 0);
});

test('SLOT_UNLOCK_LEVELS 为 [12, 30]', () => {
  assert.deepEqual(SLOT_UNLOCK_LEVELS, [12, 30]);
});

test('grantLevelUp 等级与可分配点数 +1', () => {
  const p = normalizePlayer({ progress: { level: 3, points: 4 } });
  grantLevelUp(p);
  assert.equal(p.progress.level, 4);
  assert.equal(p.progress.points, 5);
});

test('normalizePlayer levels 去重', () => {
  const p = normalizePlayer({ levels: { completed: ['a', 'a', 'b', 'b'], unlocked: ['x', 'x', 'y'] } });
  assert.deepEqual(p.levels.completed, ['a', 'b']);
  assert.deepEqual(p.levels.unlocked, ['x', 'y']);
});

test('normalizePlayer enhance 兼容数组与对象两种写法', () => {
  const p = normalizePlayer({
    weapons: {
      radial: { unlocked: true, enhance: [1, 0, 1] },
      yellow: { unlocked: true, enhance: { 1: 1 } }
    }
  });
  assert.deepEqual(p.weapons.radial.enhance, [1, 0, 1]);
  assert.deepEqual(p.weapons.yellow.enhance, [0, 1, 0]);
});

test('DEFAULT_PLAYER 不随 normalizePlayer 调用被修改', () => {
  const before = JSON.stringify(DEFAULT_PLAYER);
  normalizePlayer({ currency: { gold: 999 } });
  assert.equal(JSON.stringify(DEFAULT_PLAYER), before, '默认值对象不可被污染');
});
