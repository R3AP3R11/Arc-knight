// 统一弹道解释器：把武器设计稿（weapon-design.js 的 normalizeWeaponDesign 输出）
// 转换成与 combat/weapons.js 的 WEAPONS 表完全兼容的运行时条目
//   { scheme, ringColor, fireInterval, baseDamage, maxAmmo, chargeRequired, fire, stepBullet, drawBullet }
// 设计数据 → 无需写码即可生成可执行开火逻辑。分类：引擎-编辑器（画板系统衍生）。
// 导出：buildWeaponRuntimeEntry, muzzlePosition
import { renderAsset } from './asset-render.js';
import { hexToInt } from './asset-render.js';
import { PLAYER_ART } from '../constants.js';

// 发射媒介位置：球员武器环上的一颗小球（半径/角度可配置）
export function muzzlePosition(player, design) {
  const m = design.medium || {};
  const aim = (player.weaponAngle || 0) + ((m.angle || 0) * Math.PI / 180);
  const r = (m.radius > 0 ? m.radius : (PLAYER_ART.weaponRingRadius)) * (player.artScale || 1);
  return { x: player.x + Math.cos(aim) * r, y: player.y + Math.sin(aim) * r };
}

function degToRad(d) { return d * Math.PI / 180; }

// ── BOSS 施力弹渲染常量 ──
const S5_DIR_EPS = 1e-6;          // 速度低于此值视为方向退化（刚解冻、尚未被施力加速）
const S5_TRAIL_ALPHA = 0.9;

// ── BOSS 施力弹：白弹体 + 彩色拖尾（颜色由 b.forceTrail.color 决定） ──
// 被护盾拦截的子弹被 BOSS 施加吸力/推力后会带上 b.forceTrail（boss25t5.js 写入）；此时它已是
// 普通玩家子弹（blockedBoss=false），但 b.dist 停在「被冻结时」的旧值 → 拖尾长度只取配置值。
// 方向兜底：speed < S5_DIR_EPS 且无 b.dirX/dirY 时跳过拖尾，只画白色弹点。
// 返回 true = 已按该形态绘制（调用方跳过设计稿形状之外的普通拖尾，避免白/红双拖尾）。
function drawForceTrailBullet(g, b, bodyR, fade = 1) {
  const tr = b.forceTrail;
  if (!tr) return false;
  const alpha = Math.max(0.02, fade);
  const speed = Math.hypot(b.vx, b.vy);
  let ux = 0, uy = 0;
  if (speed > S5_DIR_EPS) { ux = b.vx / speed; uy = b.vy / speed; }
  else if (Number.isFinite(b.dirX) && Number.isFinite(b.dirY)) { ux = b.dirX || 0; uy = b.dirY || 0; }
  if (ux || uy) {
    const len = Math.max(0, Number(tr.length) || 0);
    const halfW = Math.max(0, Number(tr.width) || 0);   // width = 垂直航向的半宽（尾部收成尖）
    if (len > 0 && halfW > 0) {
      const px = -uy, py = ux;
      const tailX = b.x - ux * len, tailY = b.y - uy * len;
      g.fillStyle(hexToInt(tr.color || '#ff3b3b'), S5_TRAIL_ALPHA * alpha);
      g.beginPath();
      g.moveTo(b.x + px * halfW, b.y + py * halfW);
      g.lineTo(tailX, tailY);
      g.lineTo(b.x - px * halfW, b.y - py * halfW);
      g.closePath();
      g.fillPath();
    }
  }
  g.fillStyle(0xffffff, alpha);
  g.fillCircle(b.x, b.y, bodyR);
  return true;
}

// 生成环绕六边形的动态外观克隆：仅改 orbitIndexes 元素的 orbitRadius/rotSpeed/radius，
// 其余元素保持基础（本体/装饰不变）。phase = { radius, speedMult, sizeMult }。
// 公转沿用 rotSpeed*t 移动方式（保留切换轨道时的瞬移手感），rotSpeed 整体乘 speedScale（默认 0.8=转速-20%）。
export function buildOrbitInstance(weaponArt, orbit, phase) {
  const idx = new Set((orbit?.orbitIndexes || []));
  const speedScale = (orbit?.speedScale ?? 0.8);
  const els = (weaponArt?.elements || []).map((e, i) => {
    if (!idx.has(i)) return e;
    return {
      ...e,
      orbitRadius: phase.radius,
      rotSpeed: (Number(e.rotSpeed) || 0) * (phase.speedMult ?? 1) * speedScale,
      radius: (Number(e.radius) || 20) * (phase.sizeMult ?? 1)
    };
  });
  return { ...(weaponArt || {}), elements: els };
}

// 随机颜色：在色相环上取一个高饱和中等亮度的颜色（用于「子弹随机颜色」）
function randomHueColor() {
  const h = Math.random() * 360;
  const s = 0.7 + Math.random() * 0.3;
  const l = 0.55 + Math.random() * 0.15;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

// 随机颜色：优先从指定颜色合集 randomPalette 里取；合集为空时回落为全场随机色相
function randomBulletColor(palette) {
  if (palette && palette.length) return palette[Math.floor(Math.random() * palette.length)];
  return randomHueColor();
}

// 生成单发子弹（含轨迹/拖尾配置挂载，供 stepBullet/drawBullet 读取）
function makeBullet(weaponType, design, muzzle, aim, level) {
  const vf = design.bullet.trajectory.vector;
  const spd = Math.max(1, design.bullet.speed || vf.speed || 500);
  const b = {
    x: muzzle.x, y: muzzle.y,
    vx: Math.cos(aim) * spd, vy: Math.sin(aim) * spd,
    dist: 0,
    weaponType,
    level,
    trailColor: design.medium.ringColor || '#ffffff',
    baseAngle: aim,
    age: 0,
    // 射击距离与淡出
    range: design.bullet.range || 0,
    fadeDuration: design.bullet.fadeDuration || 0,
    fade: 1,
    // 子弹+拖尾颜色（随机色[指定合集] / 预设媒介色）
    colorStr: design.bullet.randomColor ? randomBulletColor(design.bullet.randomPalette) : (design.medium.ringColor || '#ffffff'),
    // 挂载渲染所需配置
    bulletShape: design.bullet.shape,
    bulletSize: Math.max(0.05, design.bullet.size || 1),
    trail: design.bullet.trail,
    vf
  };
  if (design.bullet.trail.type === 'snake') b.history = [{ x: muzzle.x, y: muzzle.y }];
  return b;
}

export function buildWeaponRuntimeEntry(design) {
  const d = design;
  const wt = d.id;

  return {
    scheme: 'default',
    ringColor: d.medium?.ringColor || '#ffffff',
    fireInterval: d.fireInterval,
    baseDamage: d.baseDamage,
    maxAmmo: d.maxAmmo,
    chargeRequired: d.chargeRequired,
    maxGenericMods: d.maxGenericMods ?? 3,
    maxDedicatedMods: d.maxDedicatedMods ?? 1,
    medium: d.medium,
    appearance: d.appearance,   // 武器外形（画板矢量），供 entity-art 画玩家本体
    mechanic: d.mechanic,       // 特殊机制字段（aim/charge/ampArcs），combat 侧按此激活

    fire(player, level, scene) {
      if (d.mechanic?.orbit?.enabled) return [];   // 环绕六边形武器：不开火、不产生子弹，碰撞伤害由 game-scene 侧 mechanics.orbit 分支处理
      const muzzle = muzzlePosition(player, d);
      const aim = (player.weaponAngle || 0) + degToRad(d.bullet.baseAngleOffset || 0);
      const kind = d.bullet.trajectory.kind;

      // 激光束介型：返回 beam 描述符，由 game-scene 走 spawnLaser
      if (kind === 'beam') {
        return [{ beam: true, ox: muzzle.x, oy: muzzle.y, angle: (player.weaponAngle || 0), width: d.bullet.trajectory.beam.width, color: d.bullet.trajectory.beam.color }];
      }

      const results = [];
      const count = d.bullet.count;
      const mech = d.mechanic;
      // 蓄力修正：charge 为玩家蓄力进度 0..1（game-scene 维护），蓄力武器把随机散射从 spreadMax→0，
      // 并让速度/大小/伤害随蓄力增大（蓄满 = spreadMax*0、速度/大小 *speed/sizeMult、伤害 *damageMult）
      const chg = mech?.charge?.enabled ? mech.charge : null;
      const charge = chg ? (player.charge || 0) : 0;
      const speedMult = chg ? (1 + (chg.speedMult - 1) * charge) : 1;
      const sizeMult = chg ? (1 + (chg.sizeMult - 1) * charge) : 1;
      const dmgMult = chg ? (1 + (chg.damageMult - 1) * charge) : 1;
      const spread = d.bullet.spreadDeg || 0;
      const spreadRandom = chg ? Math.max(0, chg.spreadMax * (1 - charge)) : (d.bullet.spreadRandom || 0);
      for (let i = 0; i < count; i++) {
        const offset = (count > 1 ? (i / (count - 1) - 0.5) * spread : 0)
          + (Math.random() - 0.5) * 2 * spreadRandom;
        const a = aim + degToRad(offset);
        const b = makeBullet(wt, d, muzzle, a, level);
        if (chg) {
          b.vx *= speedMult; b.vy *= speedMult;
          b.bulletSize = Math.max(0.05, (b.bulletSize || 1) * sizeMult);
          b.damageMult = dmgMult;
        }
        results.push(b);
      }
      return results;
    },

    stepBullet(b, dt, scene) {
      const vf = b.vf;
      if (!vf) return;
      const s = dt / 1000;
      b.age = (b.age || 0) + dt;
      // 撞墙渐隐：停驻在原地（不前进、不闪回），在 fadeDuration 内逐渐消失。
      // 与 range 渐隐独立：撞墙时不看 b.dist 是否到 range。
      if (b.wallFade && b.fadeDuration > 0) {
        b.overTime = (b.overTime || 0) + dt;
        b.fade = Math.max(0, Math.min(1, 1 - b.overTime / b.fadeDuration));
        // 保留最末航向，供拖尾渐隐时维持方向（vx/vy 归零后方向会丢失）
        const dirSpd = Math.hypot(b.vx, b.vy);
        if (dirSpd > 0) { b.dirX = b.vx / dirSpd; b.dirY = b.vy / dirSpd; }
        b.vx = 0; b.vy = 0;
        if (b.fade <= 0) b.dead = true;
        return;
      }
      const range = b.range || 0;
      // 抵达最远距离且配置了消失时长：停住，在 fadeDuration 内原地渐隐，不再前进（避免拉长射程）
      if (range > 0 && b.fadeDuration > 0 && b.dist >= range) {
        b.overTime = (b.overTime || 0) + dt;
        b.fade = Math.max(0, Math.min(1, 1 - b.overTime / b.fadeDuration));
        // 保留最后一帧航向，供拖尾渐隐时维持方向（vx/vy 归零后方向会丢失）
        const dirSpd = Math.hypot(b.vx, b.vy);
        if (dirSpd > 0) { b.dirX = b.vx / dirSpd; b.dirY = b.vy / dirSpd; }
        b.vx = 0; b.vy = 0;
        if (b.fade <= 0) b.dead = true;
        return;
      }
      // 重力
      if (vf.gravityX || vf.gravityY) {
        b.vx += vf.gravityX * s;
        b.vy += vf.gravityY * s;
      }
      // 蛇形：按行进距离交替 ±amp 修正速度方向
      if (vf.zigzag?.enabled) {
        const phase = Math.floor(b.dist / vf.zigzag.wavelength);
        const dir = phase % 2 === 0 ? 1 : -1;
        const spd = Math.hypot(b.vx, b.vy) || 1;
        const a = Math.atan2(b.vy, b.vx) + dir * degToRad(vf.zigzag.ampDeg);
        b.vx = Math.cos(a) * spd;
        b.vy = Math.sin(a) * spd;
      }
      // 抖动：每帧随机角度扰动
      if (vf.jitter?.enabled && vf.jitter.amount > 0) {
        const spd = Math.hypot(b.vx, b.vy) || 1;
        const a = Math.atan2(b.vy, b.vx) + (Math.random() - 0.5) * 2 * degToRad(vf.jitter.amount);
        b.vx = Math.cos(a) * spd;
        b.vy = Math.sin(a) * spd;
      }
      // 蛇形航迹记录
      if (b.history) {
        b.history.push({ x: b.x, y: b.y });
        const maxLen = (b.trail?.length || 120);
        while (b.history.length > 1 && Math.hypot(b.x - b.history[0].x, b.y - b.history[0].y) > maxLen) b.history.shift();
      }
      // 射击距离：超过后淡出直至消失
      if (range > 0) {
        if (b.fadeDuration > 0) {
          // 未抵达距离前 fade=1（抵达后的渐隐由上方早退分支处理）
          b.fade = 1;
        } else {
          // 原距离淡出：超距后在 fadeDist 内按额外行进距离淡出
          const fadeDist = Math.min(range * 0.25, 160);
          b.fade = b.dist >= range ? Math.max(0, Math.min(1, 1 - (b.dist - range) / fadeDist)) : 1;
          if (b.fade <= 0) b.dead = true;
        }
      }
    },

    drawBullet(g, b) {
      const fade = b.fade ?? 1;
      if (fade <= 0) return;
      const shape = b.bulletShape;
      const colInt = hexToInt(b.colorStr || b.trailColor || '#ffffff');
      // 护盾拦截弹（vx=vy=0、已被 boss25t5TryBlock 置红）：叠加一枚至少 5px 半径的红色弹体，
      // 避免设计稿子弹本身很小 / 形状在速度为 0 时看不清。
      if (b.blockedBoss) {
        g.fillStyle(colInt, 1);
        g.fillCircle(b.x, b.y, Math.max(b.blockedR ?? 3, (b.bulletSize || 1) * 4));
      }
      // BOSS 施力弹：彩色拖尾 + 白色弹体；设计稿形状仍按白色（colorStr 已置 #ffffff）叠加，
      // 但跳过普通拖尾（否则会叠出一条白拖尾）。
      if (b.forceTrail) {
        const bodyR = Math.max(b.blockedR ?? 5, (b.bulletSize || 1) * 4);
        drawForceTrailBullet(g, b, bodyR, fade);
        if (shape && Array.isArray(shape.elements) && shape.elements.length) {
          renderAsset(g, shape, b.x, b.y, (b.age || 0) / 1000, b.bulletSize || 1, null, fade);
        }
        return;
      }
      if (shape && Array.isArray(shape.elements) && shape.elements.length) {
        renderAsset(g, shape, b.x, b.y, (b.age || 0) / 1000, b.bulletSize || 1, null, fade);
      } else {
        g.fillStyle(colInt, fade);
        g.fillCircle(b.x, b.y, Math.max(2, (b.bulletSize || 1) * 4));
      }
      drawTrail(g, b, fade);
    }
  };
}

// ── 拖尾渲染（4 形态：锥形渐变 / 等宽 / 蛇形航迹 / 粒子点；锥形可菱形化为头尾尖中间宽）──
function drawTrail(g, b, fade = 1) {
  const trail = b.trail;
  if (!trail) return;
  const t = trail.type || 'cone';
  const colorInt = hexToInt(b.colorStr || b.trailColor || trail.color || '#ffffff');
  const a0 = fade ?? 1;

  if (t === 'equal') {
    g.lineStyle(Math.max(0.5, trail.width), colorInt, Math.max(0.1, (trail.fade ?? 0.5)) * a0);
    g.lineBetween(b.x, b.y, b.x - Math.cos(b.baseAngle) * trail.length, b.y - Math.sin(b.baseAngle) * trail.length);
    return;
  }

  if (t === 'cone') {
    const headR = Math.max(0.5, ((trail.width || 8) / 2) * (b.bulletSize || 1));
    const tailR = Math.max(0, ((trail.tailWidth ?? 0) / 2) * (b.bulletSize || 1));
    const midR = Math.max(0, ((trail.midWidth ?? 0) / 2) * (b.bulletSize || 1));
    const spd = Math.hypot(b.vx, b.vy);
    const ux = spd > 0 ? b.vx / spd : (b.dirX || 0);
    const uy = spd > 0 ? b.vy / spd : (b.dirY || 0);
    const px = -uy, py = ux;
    const len = Math.min(trail.length || 60, (b.dist || 0));
    const tailX = b.x - ux * len, tailY = b.y - uy * len;
    g.fillStyle(colorInt, Math.max(0.02, (trail.fade ?? 1)) * a0);
    g.beginPath();
    if (midR > 0) {
      // 菱形：头尾尖、中间宽（中间位置可按比例分割）
      const midAt = Math.max(0.05, Math.min(0.95, trail.midAt ?? 0.5));
      const midX = b.x - ux * len * midAt, midY = b.y - uy * len * midAt;
      g.moveTo(b.x + px * headR, b.y + py * headR);
      g.lineTo(midX + px * midR, midY + py * midR);
      g.lineTo(tailX + px * tailR, tailY + py * tailR);
      g.lineTo(tailX - px * tailR, tailY - py * tailR);
      g.lineTo(midX - px * midR, midY - py * midR);
      g.lineTo(b.x - px * headR, b.y - py * headR);
    } else {
      g.moveTo(b.x + px * headR, b.y + py * headR);
      g.lineTo(tailX + px * tailR, tailY + py * tailR);
      g.lineTo(tailX - px * tailR, tailY - py * tailR);
      g.lineTo(b.x - px * headR, b.y - py * headR);
    }
    g.closePath();
    g.fillPath();
    return;
  }

  if (t === 'snake') {
    if (!b.history || b.history.length < 2) return;
    const pts = b.history;
    for (let i = 0; i < pts.length - 1; i++) {
      const k = (i + 1) / (pts.length - 1);
      const w = Math.max(((trail.width || 4) / 2) * k, 0.5);
      g.lineStyle(w * 2, colorInt, Math.max(0.05, (trail.fade ?? 0.8) * k) * a0);
      g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    return;
  }

  // particle：离散粒子点带
  if (t === 'particle') {
    const gap = Math.max(2, trail.particleGap || 6);
    const size = Math.max(1, trail.particleSize || 3);
    const max = Math.floor((b.dist || 0) / gap);
    const count = Math.min(max, Math.floor((trail.length || 120) / gap));
    for (let i = 1; i <= count; i++) {
      const dd = (b.dist || 0) - i * gap;
      if (dd < 0) break;
      const spd = Math.hypot(b.vx, b.vy);
      const ux = spd > 0 ? b.vx / spd : (b.dirX || 0);
      const uy = spd > 0 ? b.vy / spd : (b.dirY || 0);
      const px = b.x - ux * dd, py = b.y - uy * dd;
      const alpha = Math.max(0.05, (trail.fade ?? 0.6) * (1 - i / (count + 1))) * a0;
      g.fillStyle(colorInt, alpha);
      g.fillCircle(px, py, size * (1 - 0.4 * (i / (count + 1))));
    }
    return;
  }
}
