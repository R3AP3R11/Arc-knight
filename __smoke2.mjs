import { applyCampfireOption, rollCampfireUpgrades } from './src/systems/economy/campfire.js';

// 假 scene：radial 未装备任何改件（3 个通用槽全空）
const scene = {
  player: {
    weapons: ['radial', 'yellow', 'green'],
    weaponIndex: 0,
    weaponType: 'radial',
    equipment: {
      weaponMods: {
        radial: { generic: [], dedicated: [] },
        yellow: { generic: [], dedicated: [] },
        green: { generic: [], dedicated: [] }
      }
    },
    tempMods: {}
  }
};

// 1) 改件类生效：写入 tempMods
const modOpt = { kind: 'mod', weaponType: 'radial', weaponIndex: 0, weaponName: '基础', entries: [{ id: 'multi-track', name: '多轨改件', desc: '同时向 3 个方向射出弹道' }] };
console.log('applyCampfireOption(mod) ->', applyCampfireOption(scene, modOpt), '| tempMods =', JSON.stringify(scene.player.tempMods));

// 2) activeMods 是否认这个 tempMods（受 Phaser 依赖影响则降级为静态检查）
try {
  const { activeMods } = await import('./src/systems/economy/damage.js');
  console.log('activeMods(radial) ->', [...activeMods(scene, 'radial')]);
  console.log('activeMods(yellow) ->', [...activeMods(scene, 'yellow')]);
} catch (e) {
  console.log('activeMods 无法在 node 加载（Phaser 依赖）:', String(e.message).slice(0, 90));
}

// 3) 重复项统计：3 条 option 是否出现「同武器 + 同改件」
const fire = { statBuffs: [{ id: 'crit', name: '暴击率', value: null }] };
let dupMod = 0, dupStat = 0, runs = 400;
for (let i = 0; i < runs; i++) {
  const opts = rollCampfireUpgrades(scene, fire, {});
  const keys = opts.map(o => `${o.weaponType}|${o.kind}|${(o.entries || []).map(e => e.id).sort().join('+')}`);
  if (new Set(keys).size !== keys.length) {
    for (const o of opts) if (o.kind === 'mod') { }
    if (keys.some((k, idx) => keys.indexOf(k) !== idx)) {
      if (opts.some(o => o.kind === 'mod') && keys.some((k, idx) => k.startsWith('radial|mod') && keys.indexOf(k) !== idx)) dupMod++;
      else dupStat++;
    }
  }
}
console.log(`重复率：${runs} 次运行中，改件类重复 ${dupMod} 次 / 其它重复 ${dupStat} 次`);
const sample = rollCampfireUpgrades(scene, fire, {});
console.log('一次 roll 的三条 ->', JSON.stringify(sample.map(o => ({ w: o.weaponType, kind: o.kind, ids: (o.entries || []).map(e => e.id) }))));
