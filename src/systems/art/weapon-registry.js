// 运行时武器目录（无其它依赖的叶子模块，供 state/player-data 等查询，避免 import 环）。
// 基础 3 种（radial/yellow/green）是随游戏内置的已知武器 id：仅 radial 为默认解锁；
// yellow/green 与设计稿武器的「行为/外形/改件上限」在启动时由 registerWeapon 从设计稿注册，
// 目录这里只负责声明「id 存在」，保证存档/归一化/测试都能识别它们。
// 导出：BASE_WEAPONS, weaponCatalog, registerWeaponId, isKnownWeapon, DEFAULT_UNLOCKED_WEAPONS
export const BASE_WEAPONS = ['radial', 'yellow', 'green'];
export const DEFAULT_UNLOCKED_WEAPONS = ['radial'];

const WEAPON_CATALOG = new Set(BASE_WEAPONS);

export function weaponCatalog() { return [...WEAPON_CATALOG]; }

export function registerWeaponId(id) {
  if (typeof id === 'string' && id && id !== 'undefined') WEAPON_CATALOG.add(id);
}

export function isKnownWeapon(id) {
  return typeof id === 'string' && WEAPON_CATALOG.has(id);
}
