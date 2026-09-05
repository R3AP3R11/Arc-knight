export const DEFAULT_WALL_COLOR = '#60758b';
export const MIN_WALL_SIZE = 8;

// 多箱庭小地图标记类型（渲染子任务按此消费）
export const MINIMAP_MARKER_TYPES = ['combat', 'idol', 'chest', 'vendor', 'boss'];
export const MINIMAP_MARKER_LABELS = { combat: '战斗', idol: '神像', chest: '宝箱', vendor: '商人', boss: 'BOSS' };

// 多箱庭小地图标记归一化：非法/空 → null；type 不在白名单 → 丢弃整个 marker；icon 字符串否则空串
export function normalizeRoomMarker(value) {
  if (!value || typeof value !== 'object') return null;
  const type = value.type;
  if (!MINIMAP_MARKER_TYPES.includes(type)) return null;
  return { type, icon: typeof value.icon === 'string' ? value.icon : '' };
}

import { normalizeRoomLayout } from './rooms.js';
import { isKnownWeapon } from './systems/art/weapon-registry.js';

export const ENEMY_TYPES = {
  basic1: { name: '基础敌人1', hp: 30, damage: 10 },
  basic2: { name: '基础敌人2', hp: 50, damage: 15 },
  advanced1: { name: '进阶敌人1', hp: 80, damage: 20 },
  advanced2: { name: '进阶敌人2', hp: 100, damage: 15 }
};

export const DEFAULT_DROPS = { gold: 1, exp: 1, diamond: 0 };

export const DROP_ITEMS = { gold: '金币', exp: '经验', charge: '充能球', diamond: '钻石' };

// 展示顺序基础列表（仅 radial 硬编码；yellow/green 与设计稿武器启动后并入 isKnownWeapon）
export const WEAPON_TYPES = ['radial'];
export const WEAPON_LABELS = { radial: '基础', yellow: '散射', green: '激光' };

// 统一物品定义：改件 / 圣物 / 宠物
// category: mod=改件（装备到武器槽）、relic=圣物（装备到玩家，最多3）、pet=宠物（装备到玩家，最多2）
// stackable: true=可堆叠（进 items.stacks），false=不可堆叠（进 items.uniques）
// weapon: 改件专属武器，空字符串表示通用
// color: 图标着色
export const ITEM_DEFS = {
  // 通用改件（可堆叠）；icon=画板资产id（有则用 renderAsset 渲染动态资产，无则颜色块+简称）；effect=悬停提示的效果描述
  'multi-track': { name: '多轨改件', category: 'mod', stackable: true, weapon: '', color: '#ffffff', icon: 'asset-1788404712039', effect: '同时向 3 个方向射出弹道' },
  'spin':        { name: '转速改件', category: 'mod', stackable: true, weapon: '', color: '#ffffff', effect: '射击时武器保持高速旋转不减速' },
  'triple':      { name: '三发改件', category: 'mod', stackable: true, weapon: '', color: '#ffffff', icon: 'asset-1788349008776', effect: '一次射出 3 发扇形弹道' },
  // 黄色武器专属改件（不可堆叠）
  'ricochet':    { name: '反弹改件', category: 'mod', stackable: false, weapon: 'yellow', color: '#feed34', effect: '子弹命中后反弹' },
  'split':       { name: '分裂改件', category: 'mod', stackable: false, weapon: 'yellow', color: '#feed34', effect: '子弹命中后分裂' },
  // 绿色武器专属改件（不可堆叠）
  'capacity':    { name: '容量改件', category: 'mod', stackable: false, weapon: 'green', color: '#42d978', effect: '弹药容量翻倍' },
  'pierce':      { name: '穿透改件', category: 'mod', stackable: false, weapon: 'green', color: '#42d978', effect: '子弹穿透墙体' },
  // 圣物（可堆叠）
  'relic-vitality': { name: '生命圣物', category: 'relic', stackable: true, weapon: '', color: '#ffd54f', effect: '提升最大生命' },
  'relic-power':    { name: '力量圣物', category: 'relic', stackable: true, weapon: '', color: '#ffd54f', effect: '提升攻击力' },
  'relic-haste':    { name: '迅捷圣物', category: 'relic', stackable: true, weapon: '', color: '#ffd54f', effect: '提升攻击速度' },
  // 宠物（不可堆叠）；icon=画板资产 id（外形，经 renderAsset 渲染），effect=悬停提示的机制说明
  'pet-ember':   { name: '焰尾', category: 'pet', stackable: false, weapon: '', color: '#4fc3f7' },
  'pet-moss':    { name: '苔团', category: 'pet', stackable: false, weapon: '', color: '#4fc3f7' },
  'pet-basic1':  { name: '基础宠物1', category: 'pet', stackable: false, weapon: '', color: '#4fc3f7', icon: 'asset-1788602786942', effect: '环绕玩家旋转，自动朝最近的敌人开火' }
};

// 改件定义（由 ITEM_DEFS 派生，保持旧字段形态：{ id: { name, weapon } }）
export const MOD_DEFS = Object.fromEntries(
  Object.entries(ITEM_DEFS)
    .filter(([, def]) => def.category === 'mod')
    .map(([id, def]) => [id, { name: def.name, weapon: def.weapon }])
);

export function normalizeWeapons(weapons) {
  const list = (Array.isArray(weapons) ? weapons : ['radial'])
    .filter(w => isKnownWeapon(w))
    .slice(0, 3);
  return list.length ? list : ['radial'];
}

export function normalizeEnemy(enemy, index) {
  const type = ENEMY_TYPES[enemy?.type] ? enemy.type : 'basic1';
  const def = ENEMY_TYPES[type];
  return {
    id: enemy?.id || `enemy-${index + 1}`,
    x: Number(enemy?.x) || 0,
    y: Number(enemy?.y) || 0,
    type,
    // 画板美术方案（设计稿 id，空串=默认美术）
    art: (typeof enemy?.art === 'string' && enemy.art && enemy.art !== 'undefined') ? enemy.art : '',
    artScale: (() => { const n = Number(enemy?.artScale); return Number.isFinite(n) && n > 0 ? n : 1; })(),
    hp: Number(enemy?.hp ?? def.hp),
    damage: Number(enemy?.damage ?? def.damage),
    drops: {
      gold: Math.max(0, Number(enemy?.drops?.gold ?? DEFAULT_DROPS.gold)),
      exp: Math.max(0, Number(enemy?.drops?.exp ?? DEFAULT_DROPS.exp)),
      diamond: Math.max(0, Number(enemy?.drops?.diamond ?? DEFAULT_DROPS.diamond))
    }
  };
}

// 关卡级掉落规则：按敌人类型统一配置爆率
// 每条规则：item（掉落物种类）+ count（数量）+ chance（概率 0-100）
export function normalizeDropRules(value) {
  const rules = {};
  if (!value || typeof value !== 'object') return rules;
  for (const [type, list] of Object.entries(value)) {
    if (!ENEMY_TYPES[type] || !Array.isArray(list)) continue;
    const entries = list.map(r => ({
      item: DROP_ITEMS[r?.item] ? r.item : 'gold',
      count: Math.max(0, Math.floor(Number(r?.count) || 0)),
      chance: Math.min(100, Math.max(0, Number(r?.chance) ?? 100)),
      weapon: r?.item === 'charge' && isKnownWeapon(r?.weapon) ? r.weapon : ''
    }));
    if (entries.length) rules[type] = entries;
  }
  return rules;
}

export function normalizeWave(w, def) {
  return {
    enemyType: ENEMY_TYPES[w?.enemyType] ? w?.enemyType : (def?.enemyType || 'basic1'),
    mode: w?.mode === 'offscreen' ? 'offscreen'
      : w?.mode === 'inscreen' ? 'inscreen' : 'surround',
    count: Math.max(1, Number(w?.count ?? def?.count) || 5),
    playerMinRadius: Math.max(0, Number(w?.playerMinRadius ?? 200) || 0),
    zoneId: w?.zoneId || '',
    waitForClear: w?.waitForClear === true,
    shape: (w?.shape ?? def?.shape) === 'circle' ? 'circle' : 'polygon',
    sides: Math.max(3, Number(w?.sides ?? def?.sides) || 6),
    radius: Math.max(20, Number(w?.radius ?? def?.radius) || 120),
    thickness: Math.max(1, Number(w?.thickness ?? def?.thickness) || 10),
    circleCount: Math.max(1, Number(w?.circleCount ?? def?.circleCount) || 8),
    drawDuration: Math.max(1, Number(w?.drawDuration ?? def?.drawDuration) || 500),
    fadeDuration: Math.max(1, Number(w?.fadeDuration ?? def?.fadeDuration) || 500),
    preDelay: Math.max(0, Number(w?.preDelay ?? 0) || 0),
    postDelay: Math.max(0, Number(w?.postDelay ?? def?.postDelay) || 1000)
  };
}

export function normalizeCrate(crate, index) {
  return {
    id: crate?.id || `crate-${index + 1}`,
    x: Number(crate?.x) || 0,
    y: Number(crate?.y) || 0,
    w: 50,
    h: 50,
    hp: 1
  };
}

export function normalizeBarrel(barrel, index) {
  return {
    id: barrel?.id || `barrel-${index + 1}`,
    x: Number(barrel?.x) || 0,
    y: Number(barrel?.y) || 0,
    r: 30,
    hp: 1,
    explodeRadius: Math.max(30, Number(barrel?.explodeRadius) || 150)
  };
}

// 通用掉落条目列表（宝箱等）：item + count + chance
export function normalizeRewardList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(r => ({
      item: DROP_ITEMS[r?.item] ? r.item : 'gold',
      count: Math.max(0, Math.floor(Number(r?.count) || 0)),
      chance: Math.min(100, Math.max(0, Number(r?.chance) ?? 100))
    }))
    .filter(r => r.count > 0);
}

// 游戏内指引箭头字段（平铺进实体）：guide=开关；guideRange=距玩家多远处仍显示指引；
// guideIcon=指引图标（动态资产名，空=实体名称占位）；guideStopAfterUse=F 键交互后停止指引（仅 F 键实体）
function guideFields(e, { stopAfterUse = false } = {}) {
  const out = {
    guide: e?.guide === true,
    guideRange: Math.max(100, Number(e?.guideRange) || 600),
    guideIcon: typeof e?.guideIcon === 'string' ? e.guideIcon : ''
  };
  if (stopAfterUse) out.guideStopAfterUse = e?.guideStopAfterUse !== false;
  return out;
}

export function normalizeChest(chest, index) {
  return {
    id: chest?.id || `chest-${index + 1}`,
    x: Number(chest?.x) || 0,
    y: Number(chest?.y) || 0,
    // 出现方式：start=游戏开始即存在；trigger=触发器触发（清敌后出现）
    trigger: chest?.trigger === 'trigger' ? 'trigger' : 'start',
    triggerId: chest?.triggerId || '',
    // 打开判定半径（无碰撞体积）
    openRadius: Math.max(20, Number(chest?.openRadius) || 50),
    ...guideFields(chest),
    rewards: normalizeRewardList(chest?.rewards)
  };
}

export function normalizePortal(portal, index) {
  return {
    id: portal?.id || `portal-${index + 1}`,
    x: Number(portal?.x) || 0,
    y: Number(portal?.y) || 0,
    w: Math.max(30, Number(portal?.w) || 120),
    h: Math.max(20, Number(portal?.h) || 60),
    rotation: Number(portal?.rotation) || 0,
    // 出现方式：start=游戏开始即存在；trigger=触发器触发（清敌后出现）
    trigger: portal?.trigger === 'trigger' ? 'trigger' : 'start',
    triggerId: portal?.triggerId || '',
    // 交互判定半径（无碰撞体积）
    interactRadius: Math.max(40, Number(portal?.interactRadius) || 90),
    visible: portal?.visible !== false,
    ...guideFields(portal, { stopAfterUse: true })
  };
}

export function normalizeVendor(vendor, index) {
  return {
    id: vendor?.id || `vendor-${index + 1}`,
    x: Number(vendor?.x) || 0,
    y: Number(vendor?.y) || 0,
    w: Math.max(20, Number(vendor?.w) || 130),
    h: Math.max(20, Number(vendor?.h) || 96),
    interactRadius: Math.max(30, Number(vendor?.interactRadius) || 120),
    visible: vendor?.visible !== false,
    ...guideFields(vendor, { stopAfterUse: true })
  };
}

export function normalizeIdol(idol, index) {
  return {
    id: idol?.id || `idol-${index + 1}`,
    x: Number(idol?.x) || 0,
    y: Number(idol?.y) || 0,
    w: Math.max(20, Number(idol?.w) || 110),
    h: Math.max(20, Number(idol?.h) || 110),
    interactRadius: Math.max(40, Number(idol?.interactRadius) || 130),
    visible: idol?.visible !== false,
    ...guideFields(idol, { stopAfterUse: true })
  };
}

export function normalizeIcon(icon, index) {
  return {
    id: icon?.id || `icon-${index + 1}`,
    x: Number(icon?.x) || 0,
    y: Number(icon?.y) || 0,
    w: Math.max(20, Number(icon?.w) || 64),
    h: Math.max(20, Number(icon?.h) || 64),
    src: icon?.src || '',
    interactRadius: Math.max(40, Number(icon?.interactRadius) || 120),
    tipText: icon?.tipText ?? '按 F 交互',
    event: ['workshop', 'weapon', 'battle'].includes(icon?.event) ? icon.event : 'workshop',
    visible: icon?.visible !== false,
    ...guideFields(icon, { stopAfterUse: true })
  };
}

export const EVENT_TYPES = ['complete', 'roomComplete', 'combat', 'spawnEnemy', 'switchLevel', 'spawnGate', 'removeGate'];

function normalizeSpawnWaves(s) {
  const def = {
    enemyType: ENEMY_TYPES[s?.enemyType] ? s?.enemyType : 'basic1',
    mode: 'surround',
    count: Math.max(1, Number(s?.count) || 5),
    playerMinRadius: 200,
    shape: 'polygon',
    sides: 6,
    radius: 120,
    thickness: 10,
    circleCount: 8,
    drawDuration: 500,
    fadeDuration: 500,
    preDelay: 0,
    postDelay: 1000
  };
  const rawWaves = Array.isArray(s?.waves) && s.waves.length ? s.waves : [{ ...s, mode: s?.mode, count: s?.count }];
  const legacyZoneId = s?.spawnZoneId || '';
  return rawWaves.map(w => normalizeWave({ ...w, zoneId: w?.zoneId || legacyZoneId }, def));
}

function normalizeTriggerEvent(ev, trigger) {
  if (!ev || typeof ev !== 'object') return null;
  const type = EVENT_TYPES.includes(ev.type) ? ev.type : null;
  if (!type) return null;
  // 触发时机：enter=进入即触发（默认）；enemiesCleared=击败本触发器召唤的敌人后触发
  const when = ev.when === 'enemiesCleared' ? 'enemiesCleared' : 'enter';

  if (type === 'complete' || type === 'roomComplete' || type === 'combat') {
    return { type, when };
  }

  if (type === 'spawnEnemy') {
    const s = ev.spawn || trigger?.spawn || {};
    return {
      type,
      when,
      spawn: {
        stopOnExit: s.stopOnExit === true,
        resumeOnReturn: s.resumeOnReturn !== false,
        waves: normalizeSpawnWaves(s)
      }
    };
  }

  if (type === 'switchLevel') {
    const rawPoint = ev.spawnPoint || trigger?.spawnPoint;
    return {
      type,
      when,
      target: ev.target || trigger?.target || '',
      spawnPoint: rawPoint
        ? { x: Number(rawPoint.x) || 0, y: Number(rawPoint.y) || 0 }
        : null
    };
  }

  // spawnGate | removeGate
  const raw = Array.isArray(ev.gateIds) ? ev.gateIds
    : ev.gateId ? [ev.gateId]
    : Array.isArray(trigger?.gateIds) ? trigger.gateIds
    : trigger?.gateId ? [trigger.gateId] : [];
  return { type, when, gateIds: raw.filter(Boolean) };
}

export function normalizeTrigger(trigger, index) {
  const base = {
    id: trigger?.id || `trigger-${index + 1}`,
    x: Number(trigger?.x) || 0,
    y: Number(trigger?.y) || 0,
    w: Math.max(Number(trigger?.w) || 90, MIN_WALL_SIZE),
    h: Math.max(Number(trigger?.h) || 90, MIN_WALL_SIZE),
    shape: trigger?.shape === 'circle' ? 'circle' : 'rect',
    color: trigger?.color || '#f3b63f',
    visible: trigger?.visible !== false,
    once: trigger?.once !== false,
    cooldown: Math.max(0, Number(trigger?.cooldown) || 0),
    resumeOnReturn: trigger?.resumeOnReturn !== false
  };

  let events;
  if (Array.isArray(trigger?.events) && trigger.events.length) {
    events = trigger.events.map(ev => normalizeTriggerEvent(ev, trigger)).filter(Boolean);
  } else {
    const action = trigger?.action || 'complete';
    events = [normalizeTriggerEvent({ type: action }, trigger)].filter(Boolean);
  }
  if (!events.length) events = [{ type: 'complete' }];
  base.events = events;

  return base;
}

// 美术方案 → 武器类型强绑定（切换方案即切换弹道）
// default 仅为示例方案，正式游戏不使用
export const SCHEME_WEAPONS = {
  default: 'basic',
  'hex-ring': 'radial',
  yellow: 'yellow',
  green: 'green'
};

export const DEFAULT_LEVEL = {
  backgroundColor: '#0b1b2b',
  gridColor: '#173a55',
  showGridInPlay: false,
  ui: 'battle',
  world: { width: 1920, height: 1080 },
  camera: { width: 1920, mode: 'deadzone' },
  walls: [{ x: 450, y: 300, w: 30, h: 210 }],
  enemies: [
    { x: 730, y: 130, type: 'basic1' },
    { x: 730, y: 470, type: 'basic2' },
    { x: 180, y: 460, type: 'advanced1' }
  ],
  spawn: { x: 130, y: 300, scheme: 'default', hp: 100, maxHp: 100, level: 1, exp: 0, expToNext: 100, gold: 0, weapons: ['radial'] },
  dropRules: {},
  triggers: [],
  crates: [],
  barrels: [],
  chests: [],
  portals: [],
  vendors: [],
  idols: [],
  icons: [],
  background: null,
  images: [],
  gates: []
};

export const clone = value => structuredClone(value);

function normalizeBackground(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.fx === 'wormhole') {
    return {
      fx: 'wormhole',
      id: value.id || 'background',
      x: Number(value.x) || 1600,
      y: Number(value.y) || 240,
      radius: Math.max(40, Number(value.radius) || 250),
      rings: Math.max(3, Math.floor(Number(value.rings) || 11)),
      orbitCount: Math.max(0, Math.floor(Number(value.orbitCount) || 6)),
      driftAmp: Math.max(0, Number(value.driftAmp) || 16),
      driftSpeed: Math.max(0, Number(value.driftSpeed) || 0.5),
      yDrift: Math.max(0, Number(value.yDrift) || 12),
      ySpeed: Math.max(0, Number(value.ySpeed) || 0.6),
      scaleAmp: Math.max(0, Number(value.scaleAmp) || 0.06),
      scaleSpeed: Math.max(0, Number(value.scaleSpeed) || 0.4),
      orbitSpeed: Math.max(0, Number(value.orbitSpeed) || 0.7),
      introShrink: Math.max(0, Number(value.introShrink) || 0.8),
      introCamera: Math.max(0, Number(value.introCamera) || 1.5),
      introHold: Math.max(0, Number(value.introHold) || 1),
      introSlow: Math.max(0, Number(value.introSlow) || 1),
      introRingCount: Math.max(0, Math.floor(Number(value.introRingCount) || 12)),
      introGrow: Math.max(0, Number(value.introGrow) || 6),
      introPause: Math.max(0, Number(value.introPause) || 0.5),
      visible: value.visible !== false
    };
  }
  if (!value.src) return null;
  const w = Math.max(1, Number(value.w) || 960);
  const h = Math.max(1, Number(value.h) || 540);
  return {
    src: value.src,
    id: value.id || 'background',
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    w,
    h,
    aspect: Math.max(0.01, Number(value.aspect) || w / h),
    visible: value.visible !== false
  };
}

function normalizeImage(value, index) {
  if (!value || !value.src) return null;
  return {
    id: value.id || `image-${index + 1}`,
    src: value.src,
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    w: Math.max(1, Number(value.w) || 240),
    h: Math.max(1, Number(value.h) || 135),
    visible: value.visible !== false
  };
}

function normalizeGate(value, index) {
  return {
    id: value.id || `gate-${index + 1}`,
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    w: Math.max(20, Number(value.w) || 237),
    h: Math.max(10, Number(value.h) || 45),
    rotation: Number(value.rotation) || 0,
    label: value.label ?? 'Barrier Active',
    color1: value.color1 || '#FFE6BE',
    color2: value.color2 || '#FFCB85',
    active: value.active === true,
    visible: value.visible !== false
  };
}

// 敌人生成区域（矩形）：屏幕内随机生成时划定范围，与触发器分离
function normalizeSpawnZone(value, index) {
  return {
    id: value.id || `spawnzone-${index + 1}`,
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    w: Math.max(40, Number(value.w) || 300),
    h: Math.max(40, Number(value.h) || 200),
    color: value.color || '#7ee787',
    visible: value.visible !== false
  };
}

export function normalizeLevel(value) {
  const data = value || {};

  return {
    ...clone(DEFAULT_LEVEL),
    ...data,
    world: {
      width: Math.max(600, Number(data.world?.width) || 1920),
      height: Math.max(600, Number(data.world?.height) || 1080)
    },
    camera: {
      width: Math.max(300, Number(data.camera?.width) || 1920),
      mode: data.camera?.mode === 'center' ? 'center' : 'deadzone'
    },
    walls: (Array.isArray(data.walls) ? data.walls : DEFAULT_LEVEL.walls).map((wall, index) => ({
      ...wall,
      id: wall.id || `wall-${index + 1}`,
      color: wall.color || DEFAULT_WALL_COLOR,
      shape: ['rect', 'circle', 'arc'].includes(wall.shape) ? wall.shape : 'rect',
      visible: wall.visible !== false,
      rotation: Number.isFinite(Number(wall.rotation)) ? Number(wall.rotation) : 0,
      startAngle: Number.isFinite(Number(wall.startAngle)) ? Number(wall.startAngle) : 0,
      endAngle: Number.isFinite(Number(wall.endAngle)) ? Number(wall.endAngle) : 360,
      thickness: Math.max(Number(wall.thickness) || 30, MIN_WALL_SIZE),
      w: Math.max(Number(wall.w) || 30, MIN_WALL_SIZE),
      h: Math.max(Number(wall.h) || 90, MIN_WALL_SIZE)
    })),
    enemies: (Array.isArray(data.enemies) ? data.enemies : clone(DEFAULT_LEVEL.enemies)).map(normalizeEnemy),
    triggers: (Array.isArray(data.triggers) ? data.triggers : []).map(normalizeTrigger),
    crates: (Array.isArray(data.crates) ? data.crates : []).map(normalizeCrate),
    barrels: (Array.isArray(data.barrels) ? data.barrels : []).map(normalizeBarrel),
    chests: (Array.isArray(data.chests) ? data.chests : []).map(normalizeChest),
    portals: (Array.isArray(data.portals) ? data.portals : []).map(normalizePortal),
    vendors: (Array.isArray(data.vendors) ? data.vendors : []).map(normalizeVendor),
    idols: (Array.isArray(data.idols) ? data.idols : []).map(normalizeIdol),
    icons: (Array.isArray(data.icons) ? data.icons : []).map(normalizeIcon),
    spawn: { ...clone(DEFAULT_LEVEL.spawn), ...(data.spawn || {}), id: data.spawn?.id || 'spawn', weapons: normalizeWeapons(data.spawn?.weapons) },
    dropRules: normalizeDropRules(data.dropRules),
    background: normalizeBackground(data.background),
    images: (Array.isArray(data.images) ? data.images : []).map(normalizeImage).filter(Boolean),
    gates: (Array.isArray(data.gates) ? data.gates : []).map(normalizeGate),
    spawnZones: (Array.isArray(data.spawnZones) ? data.spawnZones : []).map(normalizeSpawnZone),
    roomLayout: normalizeRoomLayout(data.roomLayout)
  };
}

export function createState() {
  return {
    level: normalizeLevel(),
    levelId: 'level-1',
    levels: [],
    templates: {},
    mode: 'editor',
    tool: 'select',
    selected: null,
    showGridInEditor: true,
    ready: false,
    ui: {
      battle: null,
      interface: null,
      weapon: null,
      workshop: null
    },
    game: null
  };
}
