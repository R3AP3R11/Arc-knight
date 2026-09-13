// ============================================================
// 局内增益池：神像祝福（仅当局生效，直接作用于 scene.player.combat）。
// 分类：经济与数值相关
// 主要导出：IDOL_BUFFS, IDOL_OFFER_COUNT, setIdolBuffs
// ============================================================


// ── 神像祝福 ──
// 神像祝福池：从配置（data/ui/idol-buffs.json）加载，运行时由 setIdolBuffs 注入；
//             IDOL_BUFFS / IDOL_OFFER_COUNT 为 live binding，随配置更新。仅当局生效。
// 每条祝福 = { id, name, desc, icon(画板资产 id), stats }，stats 为声明式加成：
//   { 属性: { op: 'add'|'mul'|'set', value } }，apply 由 makeApply 生成。
export let IDOL_BUFFS = buildIdolBuffs([
  { id: 'atk', name: '力量祝福', desc: '攻击力 +15%', icon: '', stats: { attackPower: { op: 'mul', value: 1.15 } } },
  { id: 'crit', name: '致命祝福', desc: '暴击率 +10%', icon: '', stats: { critRate: { op: 'add', value: 0.1 } } },
  { id: 'dodge', name: '迅捷祝福', desc: '闪避率 +8%', icon: '', stats: { dodgeRate: { op: 'add', value: 0.08 } } },
  { id: 'speed', name: '疾风祝福', desc: '移动速度 +12%', icon: '', stats: { moveSpeed: { op: 'mul', value: 1.12 } } },
  { id: 'hp', name: '生命祝福', desc: '生命上限 +25', icon: '', stats: { maxHp: { op: 'add', value: 25 } } },
  { id: 'reduction', name: '守护祝福', desc: '受到伤害 -10%', icon: '', stats: { damageReduction: { op: 'mul', value: 0.9 } } }
]);

// 神像三选一展示的张数（可经 setIdolBuffs 配置）
export let IDOL_OFFER_COUNT = 3;

// 从配置 JSON 重建祝福池（data/ui/idol-buffs.json 的 { offerCount, buffs }）
export function setIdolBuffs(cfg) {
  const c = cfg || {};
  IDOL_OFFER_COUNT = Math.max(1, Math.round(Number(c.offerCount) || IDOL_OFFER_COUNT));
  IDOL_BUFFS = buildIdolBuffs(Array.isArray(c.buffs) ? c.buffs : []);
}

function buildIdolBuffs(list) {
  return (list || []).map((e, i) => {
    const stats = e.stats || {};
    return { id: e.id || `idol-${i}`, name: e.name || '未命名祝福', desc: e.desc || '', icon: e.icon || '', stats, apply: makeApply(stats) };
  });
}

// 把声明式 stats 编译成修改 scene.player.combat 的 apply 函数。
// add/mul 以默认值为基数；maxHp 会同步 scene.player.maxHp（HUD / 开局读扁平字段）。
function makeApply(stats) {
  return (scene) => {
    const c = scene.player.combat = scene.player.combat || {};
    for (const [k, spec] of Object.entries(stats || {})) {
      const v = Number(spec?.value) || 0;
      if (spec?.op === 'mul') c[k] = Number(c[k] ?? 1) * v;
      else if (spec?.op === 'set') c[k] = v;
      else c[k] = Number(c[k] ?? 0) + v;
      if (k === 'maxHp') scene.player.maxHp = c.maxHp;
    }
  };
}
