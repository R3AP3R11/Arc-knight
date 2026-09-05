// 内置宠物定义：把基础宠物还原成宠物设计数据（打包端无 /api/pets 服务器也能注册）。
// 分类：引擎-编辑器。导出：buildBuiltinPetDesigns
import { normalizePetDesign } from './pet-design.js';

export function buildBuiltinPetDesigns() {
  return [normalizePetDesign({
    id: 'pet-basic1',
    name: '基础宠物1',
    art: 'asset-1788602786942',
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
    description: '环绕玩家旋转，自动朝最近的敌人开火'
  })];
}
