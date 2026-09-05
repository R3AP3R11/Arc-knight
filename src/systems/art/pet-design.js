// 宠物设计稿数据模型：归一化 + 默认值。
// 一份宠物定义 = 机制行为（硬编码在 pet-runtime.js：环绕玩家+朝最近敌人开火）
//   + 一批可调数值（环绕半径/角速度/大小/弹道/射速/伤害/生命/购买价/解锁等级）。
// 分类：引擎-编辑器（数值可配置，机制不可配）。导出：normalizePetDesign, defaultPetDesign
function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }

export function normalizePetDesign(value = {}) {
  const v = value || {};
  return {
    id: String(v.id || ''),
    name: String(v.name || ''),
    art: String(v.art || ''),            // 画板外形资产 id（renderAsset 渲染）
    weapon: String(v.weapon || 'radial'),// 子弹弹道复用的武器 id（武器编辑系统）
    radius: Math.max(0, num(v.radius, 90)),          // 环绕玩家半径 px
    angularSpeed: num(v.angularSpeed, 90),           // 环绕角速度 °/s
    size: Math.max(0.05, num(v.size, 1)),            // 宠物整体缩放
    fireInterval: Math.max(20, num(v.fireInterval, 500)), // 开火频率 ms
    damage: Math.max(0, num(v.damage, 8)),           // 子弹伤害
    maxHp: Math.max(0, num(v.maxHp, 0)),             // 生命上限（0=无敌）
    hitActive: !!v.hitActive,                        // 是否可被敌弹命中（true 且 maxHp>0 才受击）
    price: Math.max(0, num(v.price, 0)),             // 局内购买价格（金币）
    unlockLevel: Math.max(1, num(v.unlockLevel, 1)), // 购买资格解锁等级
    description: String(v.description || '')
  };
}

export function defaultPetDesign() {
  return normalizePetDesign({
    id: '',
    name: '新宠物',
    art: '',
    weapon: 'radial',
    radius: 90,
    angularSpeed: 90,
    size: 1,
    fireInterval: 500,
    damage: 8,
    maxHp: 0,
    hitActive: false,
    price: 500,
    unlockLevel: 6,
    description: ''
  });
}
