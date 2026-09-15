/**
 * 文件职责：火堆武器祝福（仅当局，作用于 scene.player.combat）的生效 / 回退纯逻辑
 * 归属分类：数值_经济
 * 主要导出：addWeaponBuffs、enterWeapon、leaveWeapon
 * 依赖：无（禁止 import Phaser；局内态挂 player，不写存档）
 * 数据：player.weaponBuffs = { [weaponType]: [{stat,op,value}] }；player.buffedWeapon = 当前已生效的武器 id
 * 说明：op:'mul' 乘 / 除（回退），op:'add' 加 / 减（回退），op:'set' 跳过不实现；
 *       stat==='maxHp' 时同步 scene.player.maxHp，并把超过 maxHp 的 hp 夹紧。
 */

// ── 追加某武器的祝福：展开条目 → 存 player.weaponBuffs[wt]；若是当前武器则立即生效 ──
export function addWeaponBuffs(scene, weaponType, entries) {
  const p = scene?.player;
  if (!p || !weaponType) return false;
  const effects = toEffects(entries);
  if (!effects.length) return false;
  // 先在「旧列表」状态下回退当前武器已生效的加成，再补入新条目重放，保证幂等不叠加
  const wasCurrent = p.buffedWeapon === weaponType || p.weaponType === weaponType;
  if (wasCurrent) leaveWeapon(scene);
  p.weaponBuffs = p.weaponBuffs || {};
  const list = Array.isArray(p.weaponBuffs[weaponType]) ? p.weaponBuffs[weaponType] : (p.weaponBuffs[weaponType] = []);
  for (const fx of effects) list.push(fx);
  if (p.weaponType === weaponType) enterWeapon(scene, weaponType);
  return true;
}

// ── 进入某武器：把它累积的祝福作用于 combat，并记录 buffedWeapon ──
export function enterWeapon(scene, weaponType) {
  const p = scene?.player;
  if (!p || !weaponType) return false;
  const effects = p.weaponBuffs?.[weaponType];
  if (!Array.isArray(effects) || !effects.length) { p.buffedWeapon = null; return false; }
  if (p.buffedWeapon === weaponType) return true;   // 已生效，避免重复叠加
  applyEffects(p, effects, 1);
  p.buffedWeapon = weaponType;
  return true;
}

// ── 离开当前武器：回退 buffedWeapon 的强化并清空标记 ──
export function leaveWeapon(scene) {
  const p = scene?.player;
  if (!p) return false;
  const wt = p.buffedWeapon;
  if (!wt) { p.buffedWeapon = null; return false; }
  const effects = p.weaponBuffs?.[wt];
  applyEffects(p, Array.isArray(effects) ? effects : [], -1);
  p.buffedWeapon = null;
  return true;
}

// ── 内部：祝福条目 → [{stat, op, value}] ──
// op 归一化与 buffs.js:makeApply 一致：显式 'mul'/'set' 保留，其余按 'add' 处理。
function toEffects(entries) {
  const out = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    const stats = e?.stats || {};
    for (const [stat, spec] of Object.entries(stats)) {
      const op = spec?.op === 'mul' ? 'mul' : (spec?.op === 'set' ? 'set' : 'add');
      out.push({ stat, op, value: Number(spec?.value) || 0 });
    }
  }
  return out;
}

// ── 内部：生效(dir=1) / 回退(dir=-1) 一组效果 ──
// mul: 乘 value / 回退除 value（value<=0 按 1，避免除零）；add: 加 / 减；set: 跳过。
// stat==='maxHp' 时同步 player.maxHp 并夹紧 hp。
function applyEffects(player, effects, dir) {
  const c = player.combat = player.combat || {};
  let maxHpTouched = false;
  for (const { stat, op, value } of effects) {
    if (op === 'set') continue;
    if (op === 'mul') {
      const m = Number(value) > 0 ? Number(value) : 1;
      const base = Number(c[stat] ?? 1);
      c[stat] = (Number.isFinite(base) ? base : 1) * (dir < 0 ? 1 / m : m);
    } else {
      const base = Number(c[stat] ?? 0);
      c[stat] = (Number.isFinite(base) ? base : 0) + (dir < 0 ? -value : value);
    }
    if (stat === 'maxHp') maxHpTouched = true;
  }
  if (maxHpTouched) {
    player.maxHp = c.maxHp;
    if (Number(player.hp) > Number(player.maxHp)) player.hp = player.maxHp;
  }
}
