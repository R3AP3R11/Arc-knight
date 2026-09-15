export const DEFAULT_WALL_COLOR = '#60758b';
export const MIN_WALL_SIZE = 8;

// 多箱庭小地图标记类型（渲染子任务按此消费）
export const MINIMAP_MARKER_TYPES = ['combat', 'idol', 'chest', 'vendor', 'boss'];
export const MINIMAP_MARKER_LABELS = { combat: '战斗', idol: '神像', chest: '宝箱', vendor: '商人', boss: 'BOSS' };

// 多箱庭房间类型（房间面板按此消费）：unknown=未知房间（进入前内容不可见，进入后 0.8s 渐显）
export const ROOM_TYPES = ['normal', 'unknown'];
export const ROOM_TYPE_LABELS = { normal: '普通房间', unknown: '未知房间' };

// 多箱庭小地图标记归一化：非法/空 → null；type 不在白名单 → 丢弃整个 marker；icon 字符串否则空串
export function normalizeRoomMarker(value) {
  if (!value || typeof value !== 'object') return null;
  const type = value.type;
  if (!MINIMAP_MARKER_TYPES.includes(type)) return null;
  return { type, icon: typeof value.icon === 'string' ? value.icon : '' };
}

import { normalizeRoomLayout } from './rooms.js';
import { CHEST_SIZE, CHEST_LOCK_RING_THICKNESS } from './systems/constants.js';
import { isKnownWeapon } from './systems/art/weapon-registry.js';
import { normalizeBoss25T5Config } from './systems/combat/boss25t5.js';
import { HEAVY_MECH_ART, normalizeHeavyMechConfig } from './systems/combat/heavy-mech.js';

export const ENEMY_TYPES = {
  basic1: { name: '基础敌人1', hp: 30, damage: 10 },
  basic2: { name: '基础敌人2', hp: 50, damage: 15 },
  advanced1: { name: '进阶敌人1', hp: 80, damage: 20 },
  advanced2: { name: '进阶敌人2', hp: 100, damage: 15 },
  mothership: { name: '母舰', hp: 1500, damage: 0, art: 'asset-1788764178616', artScale: 2 },
  // 原型机-2-5T5（Boss）：art 直接写字符串字面量，避免 state.js ↔ combat 模块的循环引用；artScale 由关卡/编辑器决定
  'boss-2-5t5': { name: '原型机-2-5T5', hp: 1500, damage: 0, art: 'asset-1788964413981' },
  // 重装机兵：远程激光（数据契约与行为见 combat/heavy-mech.js / enemy-ai.js 的 stepHeavyMech）
  'heavy-mech': { name: '重装机兵', hp: 200, damage: 20, art: HEAVY_MECH_ART }
};

export const DEFAULT_DROPS = { gold: 1, exp: 1, diamond: 0 };

// 掉落物种类（下拉/归一白名单）；potion 需配合 potionId 指定具体药水（空=随机药水）
export const DROP_ITEMS = { gold: '金币', exp: '经验', charge: '充能球', potion: '药水', diamond: '钻石' };

// 展示顺序基础列表（仅 radial 硬编码；yellow/green 与设计稿武器启动后并入 isKnownWeapon）
export const WEAPON_TYPES = ['radial'];
export const WEAPON_LABELS = { radial: '基础', yellow: '散射', green: '激光', 'weapon-1788679714207': '禅灭' };

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
    // BOSS 被击败时播放的运镜 id（母舰用顶层字段；编辑器母舰分支写的就是这里，
    // 若不在 normalize 里保留，落盘→读回会被静默丢弃，导致运镜不生效）
    cutsceneId: (typeof enemy?.cutsceneId === 'string' ? enemy.cutsceneId : ''),
    drops: {
      gold: Math.max(0, Number(enemy?.drops?.gold ?? DEFAULT_DROPS.gold)),
      exp: Math.max(0, Number(enemy?.drops?.exp ?? DEFAULT_DROPS.exp)),
      diamond: Math.max(0, Number(enemy?.drops?.diamond ?? DEFAULT_DROPS.diamond))
    },
    // Boss 配置（母舰 / 原型机-2-5T5；非 Boss 敌人为 null，无害）——按 type 分派，字段各自保留
    boss: type === 'boss-2-5t5'
      ? normalizeBoss25T5Config(enemy?.boss)
      : (enemy?.boss && typeof enemy.boss === 'object') ? {
        spawnInterval: Number(enemy.boss.spawnInterval) || 0,
        spawnTable: Array.isArray(enemy.boss.spawnTable)
          ? enemy.boss.spawnTable
            .map(s => ({ type: ENEMY_TYPES[s?.type] ? s.type : null, count: Math.max(1, Math.floor(Number(s?.count) || 1)) }))
            .filter(s => s.type)
          : [],
        name: (typeof enemy.boss.name === 'string' && enemy.boss.name) ? enemy.boss.name : ''
      } : null,
    // 重装机兵配置（移动/旋转/瞄准/开枪延迟/射击间隔）；其余敌人在 editor 里不显示该组字段
    mech: type === 'heavy-mech' ? normalizeHeavyMechConfig(enemy?.mech) : null
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
      weapon: r?.item === 'charge' && isKnownWeapon(r?.weapon) ? r.weapon : '',
      potionId: r?.item === 'potion' ? String(r?.potionId ?? '').trim() : ''
    }));
    if (entries.length) rules[type] = entries;
  }
  return rules;
}

// 「未配置」判定：null / undefined / '' → null。
// 不能用 Number() 直接判：Number(null) 与 Number('') 都是 0（有限数），会把「未配置」误判成「覆盖为 0」。
function optionalNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// 关卡级敌人默认数值（按类型）：触发器波次未配置时套用；都未配置则用 ENEMY_TYPES / ENEMY_BEHAVIOR 全局默认。
// 字段：hp（>0）/ damage（≥0）/ scale（>0，尺寸倍率 = 美术与碰撞半径等比缩放）；未配置的键不落盘。
export function normalizeEnemyDefaults(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [type, def] of Object.entries(value)) {
    if (!ENEMY_TYPES[type] || !def || typeof def !== 'object') continue;
    const entry = {};
    const hp = optionalNum(def.hp);
    if (hp !== null && hp > 0) entry.hp = hp;
    const damage = optionalNum(def.damage);
    if (damage !== null && damage >= 0) entry.damage = damage;
    const scale = optionalNum(def.scale);
    if (scale !== null && scale > 0) entry.scale = scale;
    if (Object.keys(entry).length) out[type] = entry;
  }
  return out;
}

// 敌人数值三层回落：波次覆盖 > 关卡兜底 enemyDefaults[type] > 全局默认。
// 返回 { hp, damage, scale }，各字段为 null = 未配置（由 enemy-ai.js:initEnemy 用全局默认兜底）。
export function resolveEnemyStats(level, type, wave) {
  const d = level?.enemyDefaults?.[type] || {};
  const pick = (a, b) => (a !== null && a !== undefined ? a : (b !== null && b !== undefined ? b : null));
  return {
    hp: pick(wave?.hp, d.hp),
    damage: pick(wave?.damage, d.damage),
    scale: pick(wave?.scale, d.scale)
  };
}

export function normalizeWave(w, def) {
  const out = {
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
  // 本波敌人数值覆盖（可选；留空 = 回落关卡兜底 → 全局默认）
  const hp = optionalNum(w?.hp);
  if (hp !== null && hp > 0) out.hp = hp;
  const damage = optionalNum(w?.damage);
  if (damage !== null && damage >= 0) out.damage = damage;
  const scale = optionalNum(w?.scale);
  if (scale !== null && scale > 0) out.scale = scale;
  return out;
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

// 通用掉落条目列表（宝箱等）：item + count + chance（potion 时附 potionId）
export function normalizeRewardList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(r => ({
      item: DROP_ITEMS[r?.item] ? r.item : 'gold',
      count: Math.max(0, Math.floor(Number(r?.count) || 0)),
      chance: Math.min(100, Math.max(0, Number(r?.chance) ?? 100)),
      potionId: r?.item === 'potion' ? String(r?.potionId ?? '').trim() : ''
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
    // 尺寸：贴图按 max(w,h) 等比缩放（不变形）；同时是命中盒与上锁红环的包围盒
    w: Math.max(20, Number(chest?.w) || CHEST_SIZE),
    h: Math.max(20, Number(chest?.h) || CHEST_SIZE),
    // 出现方式：start=游戏开始即存在；trigger=触发器触发（清敌后出现）
    trigger: chest?.trigger === 'trigger' ? 'trigger' : 'start',
    triggerId: chest?.triggerId || '',
    // 打开判定半径（无碰撞体积）
    openRadius: Math.max(20, Number(chest?.openRadius) || 50),
    ...guideFields(chest),
    rewards: normalizeRewardList(chest?.rewards)
  };
}

// 宝箱上锁红环半径：以宝箱 w/h 为包围盒取半对角线 + 环厚一半（环内缘刚好贴住宝箱角点，把宝箱包住）
export function chestLockRadius(chest) {
  const w = Math.max(20, Number(chest?.w) || CHEST_SIZE);
  const h = Math.max(20, Number(chest?.h) || CHEST_SIZE);
  return Math.hypot(w, h) / 2 + CHEST_LOCK_RING_THICKNESS / 2;
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

// 火堆祝福数值：null / undefined / 空串 / 非有限数 一律回落为 null（= 用祝福表默认值）。
// 不能直接用 Number.isFinite(Number(v))——Number(null) 与 Number('') 都是 0，会把「用默认值」误判成「覆盖为 0」。
function buffValueOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCampfire(cf, index) {
  return {
    id: cf?.id || `campfire-${index + 1}`,
    x: Number(cf?.x) || 0,
    y: Number(cf?.y) || 0,
    w: Math.max(20, Number(cf?.w) || 290),
    h: Math.max(20, Number(cf?.h) || 290),
    art: (typeof cf?.art === 'string' && cf.art) ? cf.art : 'asset-1789356238754',
    artScale: (() => { const n = Number(cf?.artScale); return Number.isFinite(n) && n > 0 ? n : 1; })(),
    interactRadius: Math.max(40, Number(cf?.interactRadius) || 150),
    visible: cf?.visible !== false,
    statBuffs: (Array.isArray(cf?.statBuffs) ? cf.statBuffs : []).map(e => (typeof e === 'string'
      ? { id: e, name: '', value: null }
      : { id: String(e?.id ?? ''), name: typeof e?.name === 'string' ? e.name : '', value: buffValueOrNull(e?.value) })).filter(e => e.id),
    ...guideFields(cf, { stopAfterUse: true })
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

export const EVENT_TYPES = ['complete', 'roomComplete', 'combat', 'spawnEnemy', 'switchLevel', 'spawnGate', 'removeGate', 'bossBattle', 'playCinematic', 'lockChest', 'unlockChest'];

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

  if (type === 'playCinematic') {
    const cinematicId = typeof ev.cinematicId === 'string' ? ev.cinematicId : '';
    const focusTarget = typeof ev.focusTarget === 'string' && ev.focusTarget ? ev.focusTarget : '';
    return { type, when, cinematicId, focusTarget };
  }

  // lockChest（宝箱上锁）/ unlockChest（宝箱解锁）：作用于所选宝箱，空选择 = 不作用任何宝箱
  if (type === 'lockChest' || type === 'unlockChest') {
    const raw = Array.isArray(ev.chestIds) ? ev.chestIds : ev.chestId ? [ev.chestId] : [];
    return { type, when, chestIds: [...new Set(raw.filter(v => typeof v === 'string' && v))] };
  }

  // spawnGate | removeGate
  const raw = Array.isArray(ev.gateIds) ? ev.gateIds
    : ev.gateId ? [ev.gateId]
    : Array.isArray(trigger?.gateIds) ? trigger.gateIds
    : trigger?.gateId ? [trigger.gateId] : [];
  return { type, when, auto: ev.auto === true, gateIds: raw.filter(Boolean) };
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

// 0~1 归一：非法/缺失 → fallback（默认 0）
function clampUnit(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

// 颜色归一：接受 #rgb / #rrggbb，规整为 #rrggbb 小写；非法/缺失回退 fallback
function normalizeHexColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  let hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return `#${hex.toLowerCase()}`;
}

// 运镜动画（过场运镜特效）定义归一：补默认字段、过滤非法 id/keyframes、按 t 升序
function normalizeCinematic(value, index) {
  if (!value || typeof value !== 'object' || !value.id) return null;
  const durationMs = Math.max(0, Number(value.durationMs) || 0);
  // timeScale 需先于关键帧算出，作为关键帧 timeScale 的缺省值
  const rawTimeScale = Number(value.timeScale);
  const timeScale = Number.isFinite(rawTimeScale) ? Math.min(1, Math.max(0.05, rawTimeScale)) : 1;
  const rawKeyframes = Array.isArray(value.keyframes) ? value.keyframes : [];
  const keyframes = rawKeyframes
    .map(k => {
      if (!k || typeof k !== 'object') return null;
      const t = Number(k.t);
      if (!Number.isFinite(t)) return null;
      return {
        t: Math.max(0, Math.min(t, durationMs)),
        zoom: Number.isFinite(Number(k.zoom)) ? Number(k.zoom) : 1,
        panX: Number.isFinite(Number(k.panX)) ? Number(k.panX) : 0,
        panY: Number.isFinite(Number(k.panY)) ? Number(k.panY) : 0,
        rotation: Number.isFinite(Number(k.rotation)) ? Number(k.rotation) : 0,
        alpha: Number.isFinite(Number(k.alpha)) ? Number(k.alpha) : 0,
        ease: k.ease == null ? 'linear' : String(k.ease),
        timeScale: Number.isFinite(Number(k.timeScale)) ? Math.min(1, Math.max(0.05, Number(k.timeScale))) : timeScale,
        vignette: clampUnit(k.vignette),
        letterbox: clampUnit(k.letterbox),
        tint: clampUnit(k.tint),
        tintColor: normalizeHexColor(k.tintColor, '#1a0a0a'),
        flash: clampUnit(k.flash),
        flashColor: normalizeHexColor(k.flashColor, '#ffffff'),
        desat: clampUnit(k.desat)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
  const rawBlackHoldMs = Number(value.blackHoldMs);
  const blackHoldMs = Number.isFinite(rawBlackHoldMs) ? Math.min(3000, Math.max(0, Math.round(rawBlackHoldMs))) : 0;
  return {
    id: String(value.id),
    name: value.name == null ? '' : String(value.name),
    durationMs,
    timeScale,
    focus: ['none', 'player', 'boss'].includes(value.focus) ? value.focus : 'none',
    blackHoldMs,
    keyframes
  };
}

// 美术方案 → 武器类型强绑定（切换方案即切换弹道）
// default 仅为示例方案，正式游戏不使用
export const SCHEME_WEAPONS = {
  default: 'basic',
  'hex-ring': 'radial',
  yellow: 'yellow',
  green: 'green'
};

// 默认「玩家被击败运镜」：所有关卡共用（关卡自带同 id 的运镜时以关卡数据为准；自定义 deathCinematic 的关卡不注入）。
// 数据来源：data/levels/Level1-Scene1.json 的 cine-1789288387998，逐字搬运。
export const DEFAULT_DEATH_CINEMATIC = {
  id: 'cine-1789288387998',
  name: '玩家被击败运镜',
  durationMs: 4450,
  timeScale: 0.2,
  focus: 'none',
  blackHoldMs: 0,
  keyframes: [
    { t: 0, zoom: 1, panX: 0, panY: 0, rotation: 0, alpha: 0, ease: 'linear', timeScale: 0.2, vignette: 0, letterbox: 0, tint: 0, tintColor: '#1a0a0a', flash: 0, flashColor: '#ffffff', desat: 0 },
    { t: 2000, zoom: 5, panX: 40, panY: 40, rotation: -16, alpha: 0, ease: 'linear', timeScale: 0.2, vignette: 0, letterbox: 0, tint: 0, tintColor: '#1a0a0a', flash: 0, flashColor: '#ffffff', desat: 0 },
    { t: 4450, zoom: 1000, panX: 0, panY: 0, rotation: 0, alpha: 1, ease: 'linear', timeScale: 0.2, vignette: 0, letterbox: 0, tint: 0, tintColor: '#1a0a0a', flash: 0, flashColor: '#ffffff', desat: 0 }
  ]
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
  enemyDefaults: {},
  triggers: [],
  cinematics: [],
  deathCinematic: DEFAULT_DEATH_CINEMATIC.id,
  crates: [],
  barrels: [],
  chests: [],
  portals: [],
  vendors: [],
  idols: [],
  campfires: [],
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
    color1: value.color1 || '#ffa200',
    color2: value.color2 || '#ffa200',
    active: value.active === true,
    shieldOnly: value.shieldOnly === true,
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
  // 死亡运镜 id：关卡未配置（空串/缺字段）时回落到默认死亡运镜
  const deathId = (typeof data.deathCinematic === 'string' && data.deathCinematic) || DEFAULT_DEATH_CINEMATIC.id;

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
    cinematics: (() => {
      const list = (Array.isArray(data.cinematics) ? data.cinematics : clone(DEFAULT_LEVEL.cinematics)).map(normalizeCinematic).filter(Boolean);
      // 所有关卡默认共用「玩家被击败运镜」：关卡自带同 id 的运镜时以关卡数据为准；自定义 deathCinematic 的关卡不注入。
      if (deathId === DEFAULT_DEATH_CINEMATIC.id && !list.some(c => c.id === deathId)) {
        const preset = normalizeCinematic(clone(DEFAULT_DEATH_CINEMATIC));
        if (preset) list.push(preset);
      }
      return list;
    })(),
    deathCinematic: deathId,    crates: (Array.isArray(data.crates) ? data.crates : []).map(normalizeCrate),
    barrels: (Array.isArray(data.barrels) ? data.barrels : []).map(normalizeBarrel),
    chests: (Array.isArray(data.chests) ? data.chests : []).map(normalizeChest),
    portals: (Array.isArray(data.portals) ? data.portals : []).map(normalizePortal),
    vendors: (Array.isArray(data.vendors) ? data.vendors : []).map(normalizeVendor),
    idols: (Array.isArray(data.idols) ? data.idols : []).map(normalizeIdol),
    campfires: (Array.isArray(data.campfires) ? data.campfires : []).map(normalizeCampfire),
    icons: (Array.isArray(data.icons) ? data.icons : []).map(normalizeIcon),
    spawn: { ...clone(DEFAULT_LEVEL.spawn), ...(data.spawn || {}), id: data.spawn?.id || 'spawn', weapons: normalizeWeapons(data.spawn?.weapons) },
    dropRules: normalizeDropRules(data.dropRules),
    enemyDefaults: normalizeEnemyDefaults(data.enemyDefaults),
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
