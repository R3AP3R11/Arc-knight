// 默认武器模板：把现有 3 种玩家武器（radial/yellow/green）还原成画板武器设计数据，
// 作为模板存在武器弹道编辑系统中；另附一个空白模板供新建。
// 分类：引擎-编辑器（画板系统衍生）。导出：buildAllDefaultWeapons
import { normalizeWeaponDesign } from './weapon-design.js';

// 一个近似圆的多边形元素（画板矢量），用作子弹/媒介/外形的最小单元
function ball(color, r) {
  return { shape: 'polygon', count: 1, orbitRadius: 0, radius: r, sides: 20, lineWidth: 0, color, fill: color, rotSpeed: 0, dir: 1, phase: 0, arcStart: 0, arcEnd: 360, points: [], closed: false };
}

function weaponDef(raw) {
  return normalizeWeaponDesign(raw);
}

export function buildDefaultWeapons() {
  const templates = [];

  // radial：单发直线锥形拖尾，橙环
  templates.push(weaponDef({
    id: 'default-weapon-radial',
    name: '径向环（模板）',
    baseDamage: 10,
    fireInterval: 120,
    maxAmmo: Infinity,
    chargeRequired: 0,
    purchasable: false,
    unlockLevel: 1,
    slot: 1,
    maxGenericMods: 3,
    maxDedicatedMods: 1,
    isTemplate: true,
    appearance: { scale: 1, center: { x: 0, y: 0 }, elements: [ball('#ffa914', 12)] },
    medium: { ringIndex: 0, angle: 0, radius: 28, size: 1, ringColor: '#ffa914', elements: [ball('#ffa914', 5)] },
    bullet: {
      count: 1, spreadDeg: 0,
      shape: { scale: 1, center: { x: 0, y: 0 }, elements: [ball('#ffffff', 5)] },
      size: 1,
      trail: { type: 'cone', length: 60, width: 10, color: '#ffa914', fade: 1, tailWidth: 0, particleSize: 3, particleGap: 6, historyMax: 12 },
      trajectory: { kind: 'vector', vector: { speed: 500, angleOffset: 0, gravityX: 0, gravityY: 0, zigzag: { enabled: false, ampDeg: 15, wavelength: 40 }, jitter: { enabled: false, amount: 0, freq: 10 } }, beam: { width: 10, color: '#ffa914' } }
    }
  }));

  // yellow：3 发 ±15° 散布 + 蛇形曲折 + 蛇形航迹拖尾
  templates.push(weaponDef({
    id: 'default-weapon-yellow',
    name: '黄色蛇形（模板）',
    baseDamage: 8,
    fireInterval: 150,
    maxAmmo: 45,
    chargeRequired: 5,
    purchasable: false,
    unlockLevel: 1,
    slot: 2,
    maxGenericMods: 3,
    maxDedicatedMods: 1,
    isTemplate: true,
    appearance: { scale: 1, center: { x: 0, y: 0 }, elements: [ball('#feed34', 12)] },
    medium: { ringIndex: 0, angle: 0, radius: 28, size: 1, ringColor: '#feed34', elements: [ball('#feed34', 5)] },
    bullet: {
      count: 3, spreadDeg: 30,
      shape: { scale: 1, center: { x: 0, y: 0 }, elements: [ball('#ffffff', 4.5)] },
      size: 1,
      trail: { type: 'snake', length: 120, width: 4, color: '#feed34', fade: 0.8, tailWidth: 0, particleSize: 3, particleGap: 6, historyMax: 12 },
      trajectory: { kind: 'vector', vector: { speed: 500, angleOffset: 0, gravityX: 0, gravityY: 0, zigzag: { enabled: true, ampDeg: 15, wavelength: 40 }, jitter: { enabled: false, amount: 0, freq: 10 } }, beam: { width: 10, color: '#feed34' } }
    }
  }));

  // green：激光束介型
  templates.push(weaponDef({
    id: 'default-weapon-green',
    name: '绿色激光（模板）',
    baseDamage: 16,
    fireInterval: 150,
    maxAmmo: 30,
    chargeRequired: 8,
    purchasable: false,
    unlockLevel: 1,
    slot: 3,
    maxGenericMods: 3,
    maxDedicatedMods: 1,
    isTemplate: true,
    appearance: { scale: 1, center: { x: 0, y: 0 }, elements: [ball('#42d978', 12)] },
    medium: { ringIndex: 0, angle: 0, radius: 28, size: 1, ringColor: '#42d978', elements: [ball('#42d978', 5)] },
    bullet: {
      count: 1, spreadDeg: 0,
      shape: { scale: 1, center: { x: 0, y: 0 }, elements: [] },
      size: 1,
      trail: { type: 'cone', length: 60, width: 10, color: '#42d978', fade: 1, tailWidth: 0, particleSize: 3, particleGap: 6, historyMax: 12 },
      trajectory: { kind: 'beam', vector: { speed: 500, angleOffset: 0, gravityX: 0, gravityY: 0, zigzag: { enabled: false, ampDeg: 15, wavelength: 40 }, jitter: { enabled: false, amount: 0, freq: 10 } }, beam: { width: 10, color: '#42d978' } }
    }
  }));

  // 空白模板：让「新建」有干净起点
  const blank = weaponDef({ id: 'default-weapon-blank', name: '空白模板', maxAmmo: Infinity, purchasable: false, slot: 2, isTemplate: true });
  blank.appearance.elements = [ball('#ffffff', 12)];
  blank.medium.elements = [ball('#ffffff', 5)];
  blank.bullet.shape.elements = [ball('#ffffff', 5)];
  templates.push(blank);

  return templates;
}

export function buildAllDefaultWeapons() { return buildDefaultWeapons(); }

// 内置武器（yellow/green）以「编辑器注册武器」等同地位参与运行时：id 即 'yellow'/'green'（与存档/改件一致），
// 名称用展示名，且不再作为模板。启动时由 weapon-store.registerBuiltinWeapons 注册。
export function buildBuiltinWeaponDesigns() {
  const labels = {
    'default-weapon-yellow': ['yellow', '散射'],
    'default-weapon-green': ['green', '激光']
  };
  const out = [];
  for (const t of buildDefaultWeapons()) {
    const map = labels[t.id];
    if (!map) continue;
    out.push(normalizeWeaponDesign({ ...t, id: map[0], name: map[1], isTemplate: false }));
  }
  return out;
}
