export const DEFAULT_WALL_COLOR = '#60758b';
export const MIN_WALL_SIZE = 8;

export const ENEMY_TYPES = {
  basic1: { name: '基础敌人1', hp: 30, damage: 10 },
  basic2: { name: '基础敌人2', hp: 50, damage: 15 },
  advanced1: { name: '进阶敌人1', hp: 80, damage: 20 },
  advanced2: { name: '进阶敌人2', hp: 100, damage: 15 }
};

export const DEFAULT_DROPS = { gold: 1, exp: 1, charge: 0 };

export const WEAPON_TYPES = ['radial', 'yellow', 'green'];
export const WEAPON_LABELS = { radial: '基础', yellow: '散射', green: '激光' };

export function normalizeWeapons(weapons) {
  const list = (Array.isArray(weapons) ? weapons : ['radial'])
    .filter(w => WEAPON_TYPES.includes(w))
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
    hp: Number(enemy?.hp ?? def.hp),
    damage: Number(enemy?.damage ?? def.damage),
    drops: {
      gold: Math.max(0, Number(enemy?.drops?.gold ?? DEFAULT_DROPS.gold)),
      exp: Math.max(0, Number(enemy?.drops?.exp ?? DEFAULT_DROPS.exp)),
      charge: Math.max(0, Number(enemy?.drops?.charge ?? DEFAULT_DROPS.charge))
    }
  };
}

export function normalizeWave(w, def) {
  return {
    enemyType: ENEMY_TYPES[w?.enemyType] ? w?.enemyType : (def?.enemyType || 'basic1'),
    mode: w?.mode === 'offscreen' ? 'offscreen' : 'surround',
    count: Math.max(1, Number(w?.count ?? def?.count) || 5),
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
    action: trigger?.action || 'complete',
    once: trigger?.once !== false,
    cooldown: Math.max(0, Number(trigger?.cooldown) || 0),
    resumeOnReturn: trigger?.resumeOnReturn !== false
  };

  if (base.action === 'spawnEnemy') {
    const s = trigger?.spawn || {};
    const def = {
      enemyType: ENEMY_TYPES[s.enemyType] ? s.enemyType : 'basic1',
      mode: 'surround',
      count: Math.max(1, Number(s.count) || 5),
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
    const rawWaves = Array.isArray(s.waves) && s.waves.length ? s.waves : [{ ...s, mode: s.mode, count: s.count }];
    base.spawn = {
      stopOnExit: s.stopOnExit === true,
      waves: rawWaves.map(w => normalizeWave(w, def))
    };
  }

  if (base.action === 'switchLevel') {
    base.target = trigger?.target || '';
    base.spawnPoint = trigger?.spawnPoint
      ? { x: Number(trigger.spawnPoint.x) || 0, y: Number(trigger.spawnPoint.y) || 0 }
      : null;
  }

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
  camera: { width: 1920 },
  walls: [{ x: 450, y: 300, w: 30, h: 210 }],
  enemies: [
    { x: 730, y: 130, type: 'basic1' },
    { x: 730, y: 470, type: 'basic2' },
    { x: 180, y: 460, type: 'advanced1' }
  ],
  spawn: { x: 130, y: 300, scheme: 'default', hp: 100, maxHp: 100, level: 1, exp: 0, expToNext: 100, gold: 0, weapons: ['radial'] },
  triggers: [],
  crates: [],
  barrels: [],
  background: null
};

export const clone = value => structuredClone(value);

function normalizeBackground(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.fx === 'wormhole') {
    return {
      fx: 'wormhole',
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
    x: Number(value.x) || 0,
    y: Number(value.y) || 0,
    w,
    h,
    aspect: Math.max(0.01, Number(value.aspect) || w / h),
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
      width: Math.max(300, Number(data.camera?.width) || 1920)
    },
    walls: (Array.isArray(data.walls) ? data.walls : DEFAULT_LEVEL.walls).map((wall, index) => ({
      ...wall,
      id: wall.id || `wall-${index + 1}`,
      color: wall.color || DEFAULT_WALL_COLOR,
      rotation: Number.isFinite(Number(wall.rotation)) ? Number(wall.rotation) : 0,
      w: Math.max(Number(wall.w) || 30, MIN_WALL_SIZE),
      h: Math.max(Number(wall.h) || 90, MIN_WALL_SIZE)
    })),
    enemies: (Array.isArray(data.enemies) ? data.enemies : clone(DEFAULT_LEVEL.enemies)).map(normalizeEnemy),
    triggers: (Array.isArray(data.triggers) ? data.triggers : []).map(normalizeTrigger),
    crates: (Array.isArray(data.crates) ? data.crates : []).map(normalizeCrate),
    barrels: (Array.isArray(data.barrels) ? data.barrels : []).map(normalizeBarrel),
    spawn: { ...clone(DEFAULT_LEVEL.spawn), ...(data.spawn || {}), weapons: normalizeWeapons(data.spawn?.weapons) },
    background: normalizeBackground(data.background)
  };
}

export function normalizeFlows(value) {
  if (value?.flows) {
    return {
      version: value.version || 2,
      flows: {
        game: normalizeFlow(value.flows.game, '游戏流程', 'level'),
        tutorial: normalizeFlow(value.flows.tutorial, '教程流程', 'tutorial')
      }
    };
  }

  const levels = Array.isArray(value?.levels) ? value.levels : [];
  const sequence = value?.start ? [value.start, ...levels.filter(id => id !== value.start)] : levels;

  return {
    version: 2,
    flows: {
      game: normalizeFlow(
        {
          name: '游戏流程',
          entry: sequence[0] || '',
          nodes: sequence.map(target => ({ id: target, type: 'level', target }))
        },
        '游戏流程',
        'level'
      ),
      tutorial: normalizeFlow(null, '教程流程', 'tutorial')
    }
  };
}

function normalizeFlow(value, name, type) {
  const nodes = Array.isArray(value?.nodes)
    ? value.nodes.map((node, index) => ({
        id: node.id || `${type}-${index + 1}`,
        type: node.type || type,
        target: node.target || node.id || ''
      }))
    : [];

  return { name: value?.name || name, entry: value?.entry || nodes[0]?.id || '', nodes };
}

export function createState() {
  return {
    level: normalizeLevel(),
    levelId: 'level-1',
    levels: [],
    templates: {},
    flows: normalizeFlows(),
    activeFlow: 'game',
    mode: 'editor',
    tool: 'select',
    selected: null,
    showGridInEditor: true,
    flowRuntime: { type: null, index: -1, currentNodeId: '', status: 'idle' },
    ui: { battle: null, interface: null },
    game: null
  };
}
