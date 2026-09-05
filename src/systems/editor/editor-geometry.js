// ============================================================
// 编辑器交互几何：缩放 / 旋转手柄命中、背景框缩放、实体拾取与闸门绘制。
// 分类：编辑器相关
// 主要导出：resizeRect, rotationHandleAt, handleAtRect, hitBackground, backgroundHandleAt, resizeBackground, pickTopEntity, drawGates
// ============================================================

import Phaser from 'phaser';
import { MIN_WALL_SIZE } from '../../state.js';
import { FONT_TECH_SC, CHEST_SIZE, ROTATE_HANDLE_OFFSET, GATE_OUTER_COLOR, GATE_INNER_COLOR, GATE_OFFSET_RATIO } from '../constants.js';
import { wallRotationRad, wallCorners, hitWall, hitTrigger } from '../combat/geometry.js';
import { color, fillRotatedRoundedRect } from '../ui/entity-art.js';

// ── 矩形缩放 ──
export function resizeRect(entity, drag, pointerX, pointerY) {
  const rot = wallRotationRad(entity);
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const dx = pointerX - entity.x, dy = pointerY - entity.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  const halfW = entity.w / 2, halfH = entity.h / 2;
  const fixedCorner = {
    nw: { x: halfW, y: halfH },
    ne: { x: -halfW, y: halfH },
    sw: { x: halfW, y: -halfH },
    se: { x: -halfW, y: -halfH }
  }[drag.handle];

  const left = drag.handle.includes('w')
    ? Math.min(lx, fixedCorner.x - MIN_WALL_SIZE)
    : fixedCorner.x;
  const right = drag.handle.includes('e')
    ? Math.max(lx, fixedCorner.x + MIN_WALL_SIZE)
    : fixedCorner.x;
  const top = drag.handle.includes('n')
    ? Math.min(ly, fixedCorner.y - MIN_WALL_SIZE)
    : fixedCorner.y;
  const bottom = drag.handle.includes('s')
    ? Math.max(ly, fixedCorner.y + MIN_WALL_SIZE)
    : fixedCorner.y;

  const w = right - left;
  const h = bottom - top;
  const localCx = left + w / 2;
  const localCy = top + h / 2;

  const r = wallRotationRad(entity);
  const c = Math.cos(r), s = Math.sin(r);
  entity.x += localCx * c - localCy * s;
  entity.y += localCx * s + localCy * c;
  entity.w = w;
  entity.h = h;
}

// ── 闸门（Gate）绘制 ──
export function drawGates(scene, g, level, selected) {
  const l = level;
  const gates = scene.editing ? (l.gates || []) : scene.gates;
  const seen = new Set();

  for (const gt of gates) {
    if (!scene.editing && !gt.active) continue;
    seen.add(gt.id);

    const t = scene.editing ? 1 : Math.min(1, gt.spawnT ?? 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const fadeIn = Math.min(1, t * 2);
    const baseAlpha = scene.editing && !gt.active ? 0.4 : 1;
    const alpha = fadeIn * baseAlpha;
    const offset = gt.h * GATE_OFFSET_RATIO * ease;
    const rad = Phaser.Math.DegToRad(gt.rotation || 0);
    const sinR = Math.sin(rad), cosR = Math.cos(rad);
    const outerCx = gt.x + sinR * offset, outerCy = gt.y - cosR * offset;
    const innerCx = gt.x - sinR * offset, innerCy = gt.y + cosR * offset;

    g.fillStyle(color(gt.color1 || GATE_OUTER_COLOR), 0.7 * alpha);
    fillRotatedRoundedRect(g, outerCx, outerCy, gt.w, gt.h, 10, rad);

    const innerW = gt.w * 0.91;
    g.fillStyle(color(gt.color2 || GATE_INNER_COLOR), 0.5 * alpha);
    fillRotatedRoundedRect(g, innerCx, innerCy, innerW, gt.h, 10, rad);

    let text = scene.gateTexts?.get(gt.id);
    if (!text) {
      text = scene.add.text(gt.x, gt.y, gt.label || 'Barrier Active', {
        fontFamily: FONT_TECH_SC,
        fontSize: '14px',
        color: '#12233f',
        letterSpacing: 2
      }).setOrigin(0.5).setDepth(10);
      if (scene.uiCam) scene.uiCam.ignore(text);
      scene.gateTexts.set(gt.id, text);
    }
    text.setText(gt.label || 'Barrier Active');
    text.setPosition(gt.x, gt.y);
    text.setRotation(rad);
    text.setAlpha(alpha);
    text.setVisible(true);

    if (scene.editing && selected === gt) {
      const box = { x: gt.x, y: gt.y, w: gt.w, h: gt.h * 1.42, rotation: gt.rotation };
      const corners = wallCorners(box);
      g.lineStyle(2, 0xffe083);
      g.beginPath();
      g.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) g.lineTo(corners[i].x, corners[i].y);
      g.closePath();
      g.strokePath();
      for (const c of corners) {
        g.fillStyle(0xffffff);
        g.fillRect(c.x - 5, c.y - 5, 10, 10);
      }
    }
  }

  if (scene.gateTexts) {
    for (const [id, text] of scene.gateTexts) {
      if (!seen.has(id)) {
        text.destroy();
        scene.gateTexts.delete(id);
      } else {
        text.setVisible(scene.editing || (gates.find(x => x.id === id)?.active === true));
      }
    }
  }
}

// ── 手柄命中判定 ──
export function rotationHandleAt(wall, pointerX, pointerY) {
  const r = wallRotationRad(wall);
  const cos = Math.cos(r), sin = Math.sin(r);
  const lx = 0, ly = -wall.h / 2 - ROTATE_HANDLE_OFFSET;
  const x = wall.x + lx * cos - ly * sin;
  const y = wall.y + lx * sin + ly * cos;
  return Math.hypot(pointerX - x, pointerY - y) <= 12;
}

export function handleAtRect(entity, pointerX, pointerY) {
  const handleSize = 12;
  const corners = wallCorners(entity);
  const names = ['nw', 'ne', 'se', 'sw'];
  for (let i = 0; i < 4; i++) {
    const c = corners[i];
    if (Math.abs(pointerX - c.x) <= handleSize && Math.abs(pointerY - c.y) <= handleSize) {
      return names[i];
    }
  }
  return null;
}

// ── 背景框命中与缩放 ──
export function hitBackground(bg, x, y) {
  return x >= bg.x - bg.w / 2 && x <= bg.x + bg.w / 2
    && y >= bg.y - bg.h / 2 && y <= bg.y + bg.h / 2;
}

export const BG_HANDLE_SIZE = 10;
export function backgroundHandleAt(bg, x, y) {
  const handles = [
    ['nw', bg.x - bg.w / 2, bg.y - bg.h / 2],
    ['ne', bg.x + bg.w / 2, bg.y - bg.h / 2],
    ['sw', bg.x - bg.w / 2, bg.y + bg.h / 2],
    ['se', bg.x + bg.w / 2, bg.y + bg.h / 2]
  ];
  return handles.find(([, hx, hy]) =>
    Math.abs(x - hx) <= BG_HANDLE_SIZE && Math.abs(y - hy) <= BG_HANDLE_SIZE
  )?.[0] || null;
}

export const MIN_BG_SIZE = 20;
export function resizeBackground(bg, drag, pointerX, pointerY) {
  const fixedCorner = {
    nw: { x: bg.x + bg.w / 2, y: bg.y + bg.h / 2 },
    ne: { x: bg.x - bg.w / 2, y: bg.y + bg.h / 2 },
    sw: { x: bg.x + bg.w / 2, y: bg.y - bg.h / 2 },
    se: { x: bg.x - bg.w / 2, y: bg.y - bg.h / 2 }
  }[drag.handle];

  const dx = pointerX - fixedCorner.x;
  const dy = pointerY - fixedCorner.y;
  const scale = Math.max(
    Math.abs(dx) / bg.w,
    Math.abs(dy) / bg.h,
    MIN_BG_SIZE / bg.w,
    MIN_BG_SIZE / bg.h
  );

  const w = bg.w * scale;
  const h = bg.h * scale;
  const dirX = drag.handle.includes('w') ? -1 : 1;
  const dirY = drag.handle.includes('n') ? -1 : 1;

  bg.x = fixedCorner.x + dirX * w / 2;
  bg.y = fixedCorner.y + dirY * h / 2;
  bg.w = w;
  bg.h = h;
}

// ── 实体拾取 ──
export function pickTopEntity(l, x, y) {
  for (let i = l.enemies.length - 1; i >= 0; i--) {
    const e = l.enemies[i];
    if (Math.hypot(e.x - x, e.y - y) < 30) return { entity: e, type: 'enemy' };
  }

  const spawn = Math.hypot(l.spawn.x - x, l.spawn.y - y) < 22 ? l.spawn : null;
  if (spawn) return { entity: spawn, type: 'spawn' };

  for (let i = l.barrels.length - 1; i >= 0; i--) {
    const b = l.barrels[i];
    if (Math.hypot(b.x - x, b.y - y) <= b.r + 2) return { entity: b, type: 'barrel' };
  }

  for (let i = l.crates.length - 1; i >= 0; i--) {
    const c = l.crates[i];
    if (hitWall(c, x, y)) return { entity: c, type: 'crate' };
  }

  for (let i = (l.chests || []).length - 1; i >= 0; i--) {
    const ch = l.chests[i];
    if (Math.hypot(ch.x - x, ch.y - y) <= Math.max(ch.openRadius, CHEST_SIZE / 2)) return { entity: ch, type: 'chest' };
  }

  for (let i = (l.portals || []).length - 1; i >= 0; i--) {
    const p = l.portals[i];
    const halfDiag = Math.hypot(p.w, p.h) / 2;
    if (Math.hypot(p.x - x, p.y - y) <= Math.max(p.interactRadius, halfDiag)) return { entity: p, type: 'portal' };
  }

  for (let i = l.triggers.length - 1; i >= 0; i--) {
    const t = l.triggers[i];
    if (hitTrigger(t, x, y)) return { entity: t, type: 'trigger' };
  }

  for (let i = (l.gates || []).length - 1; i >= 0; i--) {
    const gt = l.gates[i];
    if (hitBackground(gt, x, y)) return { entity: gt, type: 'gate' };
  }

  for (let i = (l.vendors || []).length - 1; i >= 0; i--) {
    const v = l.vendors[i];
    if (hitBackground(v, x, y)) return { entity: v, type: 'vendor' };
  }

  for (let i = (l.idols || []).length - 1; i >= 0; i--) {
    const v = l.idols[i];
    if (hitBackground(v, x, y)) return { entity: v, type: 'idol' };
  }

  for (let i = (l.icons || []).length - 1; i >= 0; i--) {
    const ic = l.icons[i];
    if (hitBackground(ic, x, y)) return { entity: ic, type: 'icon' };
  }

  for (let i = (l.spawnZones || []).length - 1; i >= 0; i--) {
    const z = l.spawnZones[i];
    if (hitBackground(z, x, y)) return { entity: z, type: 'spawnZone' };
  }

  for (let i = l.walls.length - 1; i >= 0; i--) {
    const w = l.walls[i];
    if (hitWall(w, x, y)) return { entity: w, type: 'wall' };
  }

  for (let i = (l.images || []).length - 1; i >= 0; i--) {
    const im = l.images[i];
    if (hitBackground(im, x, y)) return { entity: im, type: 'image' };
  }

  if (l.background && (
    (l.background.src && l.background.visible !== false && hitBackground(l.background, x, y))
    || (l.background.fx === 'wormhole' && l.background.visible !== false
      && Math.hypot(x - l.background.x, y - l.background.y) <= l.background.radius + 20)
  )) {
    return { entity: l.background, type: 'background' };
  }

  return null;
}
