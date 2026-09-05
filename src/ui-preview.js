import { BINDINGS } from './ui-bindings.js';
import { interactProgress, blend } from './ui-interact.js';

const SAMPLE_STATE = { hp: 82, maxHp: 100, shield: 30, maxShield: 50, level: 3, exp: 40, expToNext: 100, gold: 1240, kills: 12, weaponLevel: 2 };

const imageCache = new Map();
function ensureImage(src) {
  if (!imageCache.has(src)) {
    const img = new Image();
    img.onload = () => imageCache.set(src, img);
    img.src = src;
    imageCache.set(src, null);
  }
}

function resolve(bindKey, fallback) {
  if (!bindKey) return fallback;
  const fn = BINDINGS[bindKey];
  if (typeof fn !== 'function') return fallback;
  const value = fn(SAMPLE_STATE);
  return value === undefined || value === null ? fallback : value;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function stOf(node, opts) {
  if (!node.interact?.hover) return { p: 0, over: {} };
  const now = opts?.now ?? 0;
  const hoverNow = (opts?.hoverId ?? '') === node.id;
  const prog = interactProgress(node, hoverNow, now, opts.anim);
  if (!prog) return { p: 0, over: {} };
  return { p: prog.p, over: node.interact.hover };
}

function offs(s) {
  return { dx: s.p * (s.over.dx || 0), dy: s.p * (s.over.dy || 0), scale: s.over.scale ? 1 + (s.over.scale - 1) * s.p : 1 };
}

export function renderUIPreview(canvas, graph, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(W / 1920, H / 1080);

  for (const node of graph?.nodes || []) {
    if (node.visible === false) continue;
    const s = stOf(node, opts);
    const { dx, dy, scale } = offs(s);

    switch (node.type) {
      case 'panel': {
        const fill = blend(node.fill || '#0e2233', s.over.fill, s.p);
        const stroke = blend(node.stroke || '#2f5a7a', s.over.stroke, s.p);
        const r = node.radius ?? 8;
        ctx.globalAlpha = blend(node.alpha ?? 0.9, s.over.alpha, s.p);
        ctx.fillStyle = fill;
        roundRect(ctx, node.x + dx, node.y + dy, node.w, node.h, r);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        roundRect(ctx, node.x + dx, node.y + dy, node.w, node.h, r);
        ctx.stroke();
        break;
      }
      case 'bar': {
        const bg = node.bg || '#3a1f2b';
        const fill = blend(node.fill || '#e84c5e', s.over.fill, s.p);
        const stroke = blend(node.stroke || '#2f5a7a', s.over.stroke, s.p);
        const ratio = Math.max(0, Math.min(1, resolve(node.bind?.ratio, 0)));
        ctx.fillStyle = bg;
        ctx.fillRect(node.x + dx, node.y + dy, node.w, node.h);
        ctx.fillStyle = fill;
        ctx.fillRect(node.x + dx, node.y + dy, node.w * ratio, node.h);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(node.x + dx, node.y + dy, node.w, node.h);
        break;
      }
      case 'icon': {
        if (node.kind === 'coin') {
          const r = node.r || 16;
          const c = blend(node.fill || '#ffd54f', s.over.fill, s.p);
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(node.x + dx, node.y + dy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#8a6d1a';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = '#8a6d1a';
          ctx.beginPath();
          ctx.arc(node.x + dx, node.y + dy, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'shape': {
        const fill = blend(node.fill || '#eaf4fb', s.over.fill, s.p);
        const stroke = s.over.stroke ? blend(node.stroke || fill, s.over.stroke, s.p) : node.stroke;
        ctx.globalAlpha = blend(node.alpha ?? 1, s.over.alpha, s.p);
        ctx.fillStyle = fill;
        if (node.kind === 'poly') {
          const pts = node.points || [];
          if (pts.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(node.x + dx + pts[0].x, node.y + dy + pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(node.x + dx + pts[i].x, node.y + dy + pts[i].y);
            if (node.closed !== false) ctx.closePath();
            ctx.fill();
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = blend(node.lineWidth ?? 2, s.over.lineWidth, s.p); ctx.stroke(); }
          } else {
            ctx.fillRect(node.x + dx, node.y + dy, node.w || 80, node.h || 40);
          }
        } else if (node.kind === 'parallelogram') {
          const w = node.w || 0, h = node.h || 0;
          const skew = node.skew || 0;
          ctx.beginPath();
          ctx.moveTo(node.x + dx + skew, node.y + dy);
          ctx.lineTo(node.x + dx + w + skew, node.y + dy);
          ctx.lineTo(node.x + dx + w, node.y + dy + h);
          ctx.lineTo(node.x + dx, node.y + dy + h);
          ctx.closePath();
          ctx.fill();
          if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = blend(node.lineWidth ?? 1, s.over.lineWidth, s.p); ctx.stroke(); }
        } else if (node.kind === 'ring' || node.kind === 'arc') {
          const r = node.r || 20;
          const thickness = node.thickness || 8;
          const radius = Math.max(0, r - thickness / 2);
          ctx.strokeStyle = fill;
          ctx.lineWidth = thickness;
          ctx.beginPath();
          if (node.kind === 'arc') {
            const start = (node.start || 0) * Math.PI / 180;
            const sweep = (node.sweep ?? 360) * Math.PI / 180;
            ctx.arc(node.x + dx, node.y + dy, radius, start, start + sweep);
          } else {
            ctx.arc(node.x + dx, node.y + dy, radius, 0, Math.PI * 2);
          }
          ctx.stroke();
        } else {
          const w = node.w || 0, h = node.h || 0;
          const radius = node.radius || 0;
          ctx.beginPath();
          if (radius > 0) roundRect(ctx, node.x + dx, node.y + dy, w, h, radius);
          else ctx.rect(node.x + dx, node.y + dy, w, h);
          ctx.fill();
          if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = blend(node.lineWidth ?? 1, s.over.lineWidth, s.p); ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'button': {
        const dw = node.w * scale, dh = node.h * scale;
        const bx = node.x + (node.w - dw) / 2 + dx, by = node.y + (node.h - dh) / 2 + dy;
        const fill = blend(node.fill || '#2f5a7a', s.over.fill, s.p);
        ctx.fillStyle = fill;
        roundRect(ctx, bx, by, dw, dh, 6);
        ctx.fill();
        ctx.strokeStyle = '#2f5a7a';
        ctx.lineWidth = 1;
        roundRect(ctx, bx, by, dw, dh, 6);
        ctx.stroke();
        if (node.label === '✕') {
          const pad = Math.min(dw, dh) * 0.28;
          ctx.strokeStyle = '#eaf4fb';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(bx + pad, by + pad);
          ctx.lineTo(bx + dw - pad, by + dh - pad);
          ctx.moveTo(bx + dw - pad, by + pad);
          ctx.lineTo(bx + pad, by + dh - pad);
          ctx.stroke();
        }
        break;
      }
      case 'text': {
        const size = node.size || 24;
        const color = node.color || '#eaf4fb';
        const value = String(resolve(node.bind?.text, node.text ?? ''));
        ctx.fillStyle = color;
        ctx.font = `${size}px 'Poppins', 'Noto Sans SC', sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(value, node.x + dx, node.y + dy);
        break;
      }
      case 'image': {
        if (!node.src) break;
        ensureImage(node.src);
        const img = imageCache.get(node.src);
        if (img) {
          const w = node.w || img.width, h = node.h || img.height;
          ctx.save();
          ctx.translate(node.x + dx, node.y + dy);
          if (node.angle) ctx.rotate(node.angle * Math.PI / 180);
          ctx.drawImage(img, -w / 2, -h / 2, w, h);
          ctx.restore();
        }
        break;
      }
    }
  }

  ctx.restore();
}
