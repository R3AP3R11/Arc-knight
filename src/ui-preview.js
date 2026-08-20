import { BINDINGS } from './ui-bindings.js';

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

export function renderUIPreview(canvas, graph) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.scale(W / 1920, H / 1080);

  for (const node of graph?.nodes || []) {
    if (node.visible === false) continue;

    switch (node.type) {
      case 'panel': {
        const fill = node.fill || '#0e2233';
        const stroke = node.stroke || '#2f5a7a';
        const r = node.radius ?? 8;
        ctx.globalAlpha = node.alpha ?? 0.9;
        ctx.fillStyle = fill;
        roundRect(ctx, node.x, node.y, node.w, node.h, r);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        roundRect(ctx, node.x, node.y, node.w, node.h, r);
        ctx.stroke();
        break;
      }
      case 'bar': {
        const bg = node.bg || '#3a1f2b';
        const fill = node.fill || '#e84c5e';
        const stroke = node.stroke || '#2f5a7a';
        const ratio = Math.max(0, Math.min(1, resolve(node.bind?.ratio, 0)));
        ctx.fillStyle = bg;
        ctx.fillRect(node.x, node.y, node.w, node.h);
        ctx.fillStyle = fill;
        ctx.fillRect(node.x, node.y, node.w * ratio, node.h);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(node.x, node.y, node.w, node.h);
        break;
      }
      case 'icon': {
        if (node.kind === 'coin') {
          const r = node.r || 16;
          const c = node.fill || '#ffd54f';
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#8a6d1a';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = '#8a6d1a';
          ctx.beginPath();
          ctx.arc(node.x, node.y, r * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'shape': {
        const fill = node.fill || '#eaf4fb';
        ctx.fillStyle = fill;
        ctx.globalAlpha = node.alpha ?? 1;
        if (node.kind === 'parallelogram') {
          const w = node.w || 0, h = node.h || 0;
          const skew = node.skew || 0;
          ctx.beginPath();
          ctx.moveTo(node.x + skew, node.y);
          ctx.lineTo(node.x + w + skew, node.y);
          ctx.lineTo(node.x + w, node.y + h);
          ctx.lineTo(node.x, node.y + h);
          ctx.closePath();
          ctx.fill();
          if (node.stroke) { ctx.strokeStyle = node.stroke; ctx.lineWidth = node.lineWidth || 1; ctx.stroke(); }
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
            ctx.arc(node.x, node.y, radius, start, start + sweep);
          } else {
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
          }
          ctx.stroke();
        } else {
          const w = node.w || 0, h = node.h || 0;
          const radius = node.radius || 0;
          ctx.beginPath();
          if (radius > 0) roundRect(ctx, node.x, node.y, w, h, radius);
          else ctx.rect(node.x, node.y, w, h);
          ctx.fill();
          if (node.stroke) { ctx.strokeStyle = node.stroke; ctx.lineWidth = node.lineWidth || 1; ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'button': {
        const fill = node.fill || '#2f5a7a';
        ctx.fillStyle = fill;
        roundRect(ctx, node.x, node.y, node.w, node.h, 6);
        ctx.fill();
        ctx.strokeStyle = '#2f5a7a';
        ctx.lineWidth = 1;
        roundRect(ctx, node.x, node.y, node.w, node.h, 6);
        ctx.stroke();
        if (node.label === '✕') {
          const pad = Math.min(node.w, node.h) * 0.28;
          ctx.strokeStyle = '#eaf4fb';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(node.x + pad, node.y + pad);
          ctx.lineTo(node.x + node.w - pad, node.y + node.h - pad);
          ctx.moveTo(node.x + node.w - pad, node.y + pad);
          ctx.lineTo(node.x + pad, node.y + node.h - pad);
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
        ctx.fillText(value, node.x, node.y);
        break;
      }
      case 'image': {
        if (!node.src) break;
        ensureImage(node.src);
        const img = imageCache.get(node.src);
        if (img) {
          ctx.drawImage(img, node.x - (node.w || 0) / 2, node.y - (node.h || 0) / 2, node.w || img.width, node.h || img.height);
        }
        break;
      }
    }
  }

  ctx.restore();
}
