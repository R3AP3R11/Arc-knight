// 武器改件数量上限的轻量同步存取模块（不依赖 Phaser / 战斗表）。
// 设计武器在注册时把 maxGenericMods/maxDedicatedMods 写入，归一化与改件生效逻辑据此截断。
// 基础武器（radial/yellow/green）无设计稿，回退默认 3/1。
// 导出：setWeaponCaps, getWeaponCaps
const CAPS = new Map();
const DEFAULT = { generic: 3, dedicated: 1 };

export function setWeaponCaps(id, generic, dedicated) {
  if (!id) return;
  CAPS.set(id, {
    generic: Number.isFinite(Number(generic)) ? Math.max(0, Math.min(9, Math.round(Number(generic)))) : DEFAULT.generic,
    dedicated: Number.isFinite(Number(dedicated)) ? Math.max(0, Math.min(3, Math.round(Number(dedicated)))) : DEFAULT.dedicated
  });
}

export function getWeaponCaps(id) {
  return CAPS.get(id) || DEFAULT;
}
