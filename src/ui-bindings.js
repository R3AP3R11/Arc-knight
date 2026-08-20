export const BINDINGS = {
  hpRatio: s => (s.maxHp > 0 ? s.hp / s.maxHp : 0),
  hpText: s => `${s.hp}/${s.maxHp}`,
  shieldRatio: s => (s.maxShield > 0 ? s.shield / s.maxShield : 0),
  shieldText: s => `${s.shield}/${s.maxShield}`,
  expRatio: s => (s.expToNext > 0 ? s.exp / s.expToNext : 0),
  gold: s => String(s.gold),
  level: s => `Lv.${s.level}`,
  kills: s => `击杀 ${s.kills}`,
  weaponLevel: s => `武器 Lv.${s.weaponLevel}`
};
