// ============================================================
// 玩家伤害结算（攻击力 / 暴击 / 免伤 / 闪避）与改件（Mods）生效集合计算。
// 分类：经济与数值相关
// 主要导出：playerDamage, playerIncomingDamage, activeMods
// ============================================================

import { MOD_DEFS } from '../../state.js';
import { BULLET_DAMAGE } from '../constants.js';
import { WEAPONS } from '../combat/weapons.js';
import { getWeaponCaps } from '../art/weapon-caps.js';

// ── 玩家伤害结算 ──
// 玩家战斗属性计算（combat 数据来自存档）
// 返回玩家本次攻击的伤害值
export function playerDamage(scene, weaponType) {
  const combat = scene.player.combat;
  if (!combat) return BULLET_DAMAGE;
  const base = WEAPONS[weaponType]?.baseDamage ?? BULLET_DAMAGE;
  let dmg = base * (combat.attackPower ?? 1);
  if (Math.random() < (combat.critRate ?? 0)) dmg *= 2;
  return dmg;
}

// 玩家收到伤害：免伤 + 闪避
// 返回实际扣除的血量
export function playerIncomingDamage(scene, dmg) {
  const combat = scene.player.combat;
  if (!combat) return dmg;
  if (Math.random() < (combat.dodgeRate ?? 0)) return 0;
  return dmg * (combat.damageReduction ?? 1);
}

// ── 改件（Mods） ──
// ============================================================
// 改件（Mods）系统
// 通用改件：任意武器可用；专属改件：weapon 字段指定专属武器
// （改件定义 MOD_DEFS 见 state.js）
// ============================================================
export function activeMods(scene, weaponType) {
  const player = scene.player;
  const slot = player?.equipment?.weaponMods?.[weaponType];
  const caps = getWeaponCaps(weaponType);
  const generic = (Array.isArray(slot?.generic) ? slot.generic : []).filter(id => {
    const def = MOD_DEFS[id];
    return def && (def.weapon === '' || def.weapon === weaponType);
  }).slice(0, caps.generic);
  const dedRaw = Array.isArray(slot?.dedicated) ? slot.dedicated : (slot?.dedicated ? [slot.dedicated] : []);
  // 火堆等写入的局内临时改件（仅当局，挂 player，不落存档）：一并计入生效集合
  const tempRaw = Array.isArray(player?.tempMods?.[weaponType]) ? player.tempMods[weaponType] : [];
  const list = [...generic, ...dedRaw, ...tempRaw];
  return new Set(
    list.filter(id => {
      const def = MOD_DEFS[id];
      return def && (def.weapon === '' || def.weapon === weaponType);
    })
  );
}
