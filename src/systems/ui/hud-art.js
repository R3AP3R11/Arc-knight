// ============================================================
// 战斗 HUD 绘制：头像、血量 / 护盾条、武器轮盘与武器图标底座。
// 分类：UI / 美术绘制（HUD 层）
// 主要导出：drawHudAvatar, drawHudBars, wheelOrder, lerpColor, drawWeaponWheel, drawWeaponIcon
// ============================================================

import Phaser from 'phaser';
import { VIEW_W, VIEW_H, WEAPON_BG_ASSET } from '../constants.js';
import { color, drawHexRingPlayer } from './entity-art.js';
import { getDesign } from '../art/design-store.js';
import { drawDesignCentered } from '../art/asset-render.js';
import { WEAPONS } from '../combat/weapons.js';

// ── 头像与状态条 ──
const ARC_START = -Math.PI / 2;   // 圆弧起点：正上方
const ARC_SWEEP = Math.PI * 1.5;  // 270° 顺时针
const HP_R = 105, SHIELD_R = 84, BAR_W = 7.5;

export function drawHudAvatar(g, cx, cy, player, t = 0) {
  // 左下角「武器外观 + 图标背景」叠加（替代原玩家头像）
  const wc = player?.weapon?.ringColor || '#ffa914';
  const bgD = getDesign(WEAPON_BG_ASSET);
  if (bgD) drawDesignCentered(g, bgD, cx, cy, 144, t);
  const wArt = player?.weaponArt;
  if (wArt && Array.isArray(wArt.elements) && wArt.elements.length) {
    drawDesignCentered(g, wArt, cx, cy, 96, t);
  } else {
    // 普通武器：玩家局内本体造型（优先 art 资产，缺省六边形玩家）
    const artId = (player?.arts && player?.weaponType && player.arts[player.weaponType]) || player?.art;
    const artDes = artId ? getDesign(artId) : null;
    if (artDes) drawDesignCentered(g, artDes, cx, cy, 96, t);
    else drawHexRingPlayer(g, { x: cx, y: cy, weapon: { ringColor: wc }, weaponAngle: t * 2.5, artScale: player?.artScale || 1, moveLeanX: 0, moveLeanY: 0, scheme: 'hex-ring' }, 1.275);
  }
}

// 圆弧条：背景弧(暗) + 主弧(当前 ratio) + 受伤残弧(from→当前，渐隐)。颜色均传 int，直接给 lineStyle
function drawArcBar(g, cx, cy, radius, ratio, ghost, fillColor, ghostColor, bgColor) {
  const start = ARC_START, sweep = ARC_SWEEP;
  g.lineStyle(BAR_W, bgColor, 1);
  g.beginPath(); g.arc(cx, cy, radius, start, start + sweep, false); g.strokePath();
  const end = start + ratio * sweep;
  if (ratio > 0) {
    g.lineStyle(BAR_W, fillColor, 1);
    g.beginPath(); g.arc(cx, cy, radius, start, end, false); g.strokePath();
  }
  if (ghost && ratio < ghost.fromRatio) {
    const alpha = Math.max(0, Math.min(1, 1 - (ghost.age / 1000)));
    if (alpha > 0) {
      const a0 = start + Math.max(ghost.toRatio, ratio) * sweep;
      const a1 = start + ghost.fromRatio * sweep;
      g.lineStyle(BAR_W, ghostColor, alpha);
      g.beginPath(); g.arc(cx, cy, radius, a0, a1, false); g.strokePath();
    }
  }
}

export function drawHudBars(g, player, hpGhost, shieldGhost) {
  const hpRatio = player.maxHp > 0 ? player.hp / player.maxHp : 0;
  const shieldRatio = player.maxShield > 0 ? player.shield / player.maxShield : 0;
  drawArcBar(g, 70, 970, HP_R, hpRatio, hpGhost, 0xffffff, 0xff3b3b, '#2a2f3a');
  drawArcBar(g, 70, 970, SHIELD_R, shieldRatio, shieldGhost, 0x3aa0ff, 0x0a4a7a, '#1a2f3a');
}

// ── 武器轮盘 ──
export function wheelOrder(weapons, index) {
  return [weapons[index], ...weapons.filter((_, i) => i !== index)];
}

export function lerpColor(c1, c2, t) {
  const r = Math.round(((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t);
  const g = Math.round(((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t);
  const b = Math.round((c1 & 255) + ((c2 & 255) - (c1 & 255)) * t);
  return (r << 16) | (g << 8) | b;
}

export function drawWeaponWheel(g, player, anim) {
  const n = player.weapons.length;
  if (!n) return;
  const cx = VIEW_W, cy = VIEW_H - 16;
  const rOuter = 220, rInner = 135;
  const gap = Phaser.Math.DegToRad(2);

  const fromIndex = anim ? anim.from : player.weaponIndex;
  const toIndex = player.weaponIndex;
  const p = anim ? Math.min(1, anim.t / anim.dur) : 1;
  const fromOrder = wheelOrder(player.weapons, fromIndex);
  const toOrder = wheelOrder(player.weapons, toIndex);
  const sweep = Math.PI + (1 - p) * (Math.PI / 2);

  const angles = [];
  for (let i = 0; i < n; i++) angles.push(Phaser.Math.DegToRad(i === 0 ? 60 : 15));

  const drawArc = (a0, a1, fillColor, alpha = 1) => {
    g.fillStyle(fillColor, alpha);
    g.beginPath();
    g.arc(cx, cy, rOuter, a0, a1, false);
    g.arc(cx, cy, rInner, a1, a0, true);
    g.closePath();
    g.fillPath();
  };

  let start = Math.PI;
  for (let i = 0; i < n; i++) {
    const end = start + angles[i] - (i < n - 1 ? gap : 0);
    const fromColor = color(WEAPONS[fromOrder[i]]?.ringColor || '#ffffff');
    const toColor = color(WEAPONS[toOrder[i]]?.ringColor || '#ffffff');
    const wt = toOrder[i];
    const dim = WEAPONS[wt]?.maxAmmo !== Infinity && (player.ammo?.[wt] ?? 0) <= 0 && (player.weaponCharge?.[wt]?.have ?? 0) < (player.weaponCharge?.[wt]?.need ?? 0);
    const alpha = dim ? 0.28 : 1.0;

    if (sweep <= start) {
      drawArc(start, end, toColor, alpha);
    } else if (sweep >= end) {
      drawArc(start, end, fromColor, alpha);
    } else {
      drawArc(start, sweep, fromColor, alpha);
      drawArc(sweep, end, toColor, alpha);
    }
    start += angles[i];
  }
}

// ── 武器图标底座 ──
export function drawWeaponIcon(g, player, anim) {
  const cx = VIEW_W, cy = VIEW_H - 16;
  const rOuter = 214, rInner = 135;
  const center = Math.PI + Phaser.Math.DegToRad(30);
  const rot = anim ? (Math.min(1, anim.t / anim.dur)) * Math.PI * 2 : 0;
  const half = Phaser.Math.DegToRad(22.5);
  const a0 = center - half + rot;
  const a1 = center + half + rot;

  g.fillStyle(0xffffff, 1);
  g.beginPath();
  g.arc(cx, cy, rOuter, a0, a1, false);
  g.arc(cx, cy, rInner, a1, a0, true);
  g.closePath();
  g.fillPath();
}
