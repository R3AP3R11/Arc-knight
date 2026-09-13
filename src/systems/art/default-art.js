// ============================================================
// 默认美术 → 画板设计稿转换器。
// 职责：把既有玩家/敌人美术（player.scheme 的 hex-ring、敌人 basic1..advanced2）
//       转成画板 design JSON，便于保存为 data/assets 并在画板里再编辑/复用。
// 分类：引擎(编辑器) / 画板
// 主要导出：buildPlayerDesign, buildEnemyDesign, buildAllDefaultArt
// 注意：这些是「约等于原美术」的基础设计稿，实际观感可在画板里微调。
// ============================================================
import { PLAYER_ART, ENEMY_BEHAVIOR, ENEMY_RED } from '../constants.js';
import { ENEMY_TYPES } from '../../state.js';

function poly({ sides, radius, color, fill, lineWidth = 1 }) {
  return { shape: 'polygon', count: 1, orbitRadius: 0, radius, sides, lineWidth, color, fill: fill || null, rotSpeed: 0, phase: 0, dir: 1 };
}
function ring({ radius, lineWidth, color }) {
  return { shape: 'arc', count: 1, orbitRadius: 0, radius, lineWidth, color, arcStart: 0, arcEnd: 360, rotSpeed: 0, phase: 0, dir: 1 };
}
function stroke(points, { color = '#000000', fill = null, lineWidth = 1, closed = false }) {
  return { shape: 'stroke', count: 1, orbitRadius: 0, radius: 1, sides: 3, lineWidth, color, fill: fill || null, closed, points: points.map(p => ({ x: p[0], y: p[1] })), rotSpeed: 0, phase: 0, dir: 1 };
}

// 玩家默认美术：蓝色小圆（近似为正 16 边形填充）
export function buildPlayerDesign(scheme) {
  if (scheme !== 'hex-ring' && scheme !== 'yellow' && scheme !== 'green') {
    return {
      id: 'default-player', name: '默认玩家', center: { x: 0, y: 0 }, scale: 1,
      elements: [poly({ sides: 16, radius: 13, color: '#51b9ff', fill: '#51b9ff', lineWidth: 0 })]
    };
  }
  const meta = {
    'hex-ring': { id: 'default-player-hex-ring', name: '基础武器方案', ringColor: '#ffa914' },
    yellow: { id: 'default-player-yellow', name: '黄色武器方案', ringColor: '#feed34' },
    green: { id: 'default-player-green', name: '绿色武器方案', ringColor: '#42d978' }
  }[scheme];
  const ringColor = meta.ringColor;
  // hex-ring（基础武器方案）去掉中心白色六边形描边；yellow / green 仍保留
  const centerHex = scheme === 'hex-ring' ? [] : [
    poly({ sides: 6, radius: PLAYER_ART.hexagonRadius, color: '#000000', fill: '#ffffff', lineWidth: PLAYER_ART.yLineThickness })
  ];
  return {
    id: meta.id, name: meta.name, center: { x: 0, y: 0 }, scale: 1,
    elements: [
      ...centerHex,
      ring({ radius: PLAYER_ART.innerRingRadius, lineWidth: PLAYER_ART.innerRingThickness, color: ringColor }),
      ring({ radius: PLAYER_ART.outerRingRadius, lineWidth: PLAYER_ART.outerRingThickness, color: ringColor }),
      ring({ radius: PLAYER_ART.outer2RingRadius, lineWidth: PLAYER_ART.outer2RingThickness, color: ringColor }),
      ring({ radius: PLAYER_ART.bodyRingRadius, lineWidth: PLAYER_ART.bodyRingThickness, color: '#ffffff' }),
      ring({ radius: PLAYER_ART.weaponRingRadius, lineWidth: PLAYER_ART.weaponRingThickness, color: ringColor }),
      poly({ sides: 8, radius: PLAYER_ART.weaponOrbRadius * 1.25 * 1.5, color: '#ffffff', fill: '#ffffff', lineWidth: 0 })
    ]
  };
}

// 敌人默认美术：按类型转成 多边形/圆弧/轮廓
export function buildEnemyDesign(type) {
  const size = (ENEMY_BEHAVIOR[type] || ENEMY_BEHAVIOR.basic1).size;
  const id = `default-enemy-${type}`;
  const name = (ENEMY_TYPES[type] && ENEMY_TYPES[type].name) || type;
  const base = { id, name, center: { x: 0, y: 0 }, scale: 1 };

  if (type === 'basic2') {
    const h = size / 2;
    const sq = (rot) => [ [h, 0], [0, h], [-h, 0], [0, -h] ].map(([x, y]) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      return [x * c - y * s, x * s + y * c];
    });
    return { ...base, elements: [
      stroke(sq(0), { color: '#000000', fill: '#ffffff', lineWidth: 1, closed: true }),
      stroke(sq(Math.PI / 4), { color: '#000000', fill: '#ffffff', lineWidth: 1, closed: true })
    ] };
  }
  if (type === 'advanced1') {
    const d = size * 0.35;
    const lw = (ENEMY_BEHAVIOR.advanced1.lineWidth) || 6;
    return { ...base, elements: [
      stroke([[-d, -d], [d, d]], { color: '#ffffff', lineWidth: lw }),
      stroke([[-d, d], [d, -d]], { color: '#ffffff', lineWidth: lw })
    ] };
  }
  if (type === 'advanced2') {
    const bodyR = 18;
    const orbitR = (ENEMY_BEHAVIOR.advanced2.orbitMin) || 30;
    return { ...base, elements: [
      poly({ sides: 16, radius: bodyR, color: '#ffffff', fill: '#ffffff', lineWidth: 0 }),
      ring({ radius: orbitR, lineWidth: 2, color: '#ffffff' }),
      { ...poly({ sides: 8, radius: 4, color: '#ffffff', fill: '#ffffff', lineWidth: 0 }), orbitRadius: orbitR, phase: -Math.PI / 2 }
    ] };
  }
  // basic1（及兜底）：菱形
  const longHalf = size / 2, shortHalf = size * 0.36;
  return { ...base, elements: [
    stroke([[longHalf, 0], [0, shortHalf], [-longHalf, 0], [0, -shortHalf]], { color: '#000000', fill: '#ffffff', lineWidth: 1, closed: true })
  ] };
}

export function buildAllDefaultArt() {
  const out = {};
  out['default-player'] = buildPlayerDesign('default');
  out['default-player-hex-ring'] = buildPlayerDesign('hex-ring');
  out['default-player-yellow'] = buildPlayerDesign('yellow');
  out['default-player-green'] = buildPlayerDesign('green');
  for (const t of Object.keys(ENEMY_TYPES)) out[`default-enemy-${t}`] = buildEnemyDesign(t);
  return out;
}
