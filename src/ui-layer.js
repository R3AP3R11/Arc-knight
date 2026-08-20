import Phaser from 'phaser';

export const UI_COLORS = {
  panelBg: '#0e2233',
  panelStroke: '#2f5a7a',
  hpBg: '#3a1f2b',
  hpFill: '#e84c5e',
  expFill: '#4fc3f7',
  coin: '#ffd54f',
  button: '#2f5a7a',
  buttonHi: '#4fc3f7',
  text: '#eaf4fb',
  textDim: '#9fc3d8'
};

function color(value) {
  return Phaser.Display.Color.HexStringToColor(value).color;
}

export function drawPanel(g, node) {
  const { x, y, w, h } = node;
  const fill = node.fill || UI_COLORS.panelBg;
  const stroke = node.stroke || UI_COLORS.panelStroke;
  const radius = node.radius ?? 8;
  const alpha = node.alpha ?? 0.9;
  g.fillStyle(color(fill), alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(2, color(stroke), 1);
  g.strokeRoundedRect(x, y, w, h, radius);
}

export function drawBar(g, node, ratio) {
  const { x, y, w, h } = node;
  const bg = node.bg || UI_COLORS.hpBg;
  const fill = node.fill || UI_COLORS.hpFill;
  const stroke = node.stroke || UI_COLORS.panelStroke;
  const r = Math.max(0, Math.min(1, ratio));
  g.fillStyle(color(bg), 1);
  g.fillRect(x, y, w, h);
  g.fillStyle(color(fill), 1);
  g.fillRect(x, y, w * r, h);
  g.lineStyle(1, color(stroke), 1);
  g.strokeRect(x, y, w, h);
}

export function drawCoinIcon(g, node) {
  const { x, y } = node;
  const r = node.r || 16;
  const c = node.fill || UI_COLORS.coin;
  g.fillStyle(color(c), 1);
  g.fillCircle(x, y, r);
  g.lineStyle(2, 0x8a6d1a, 1);
  g.strokeCircle(x, y, r);
  g.fillStyle(0x8a6d1a, 1);
  g.fillCircle(x, y, r * 0.55);
}

export function drawHeartIcon(g, node) {
  const { x, y } = node;
  const r = node.r || 16;
  const c = node.fill || '#e84c5e';
  g.fillStyle(color(c), 1);
  g.fillCircle(x - r * 0.4, y - r * 0.2, r * 0.5);
  g.fillCircle(x + r * 0.4, y - r * 0.2, r * 0.5);
  g.fillTriangle(x - r, y - r * 0.1, x + r, y - r * 0.1, x, y + r);
}

export function drawShape(g, node) {
  const { x, y } = node;
  const fill = node.fill || UI_COLORS.text;
  const stroke = node.stroke || null;
  const alpha = node.alpha ?? 1;
  const lw = node.lineWidth ?? 1;
  g.fillStyle(color(fill), alpha);
  g.lineStyle(lw, color(stroke || fill), 1);

  if (node.kind === 'parallelogram') {
    const w = node.w || 0, h = node.h || 0;
    const skew = node.skew || 0;
    g.beginPath();
    g.moveTo(x + skew, y);
    g.lineTo(x + w + skew, y);
    g.lineTo(x + w, y + h);
    g.lineTo(x, y + h);
    g.closePath();
    g.fillPath();
    if (stroke) g.strokePath();
  } else if (node.kind === 'ring' || node.kind === 'arc') {
    const r = node.r || 20;
    const thickness = node.thickness || 8;
    const radius = Math.max(0, r - thickness / 2);
    g.lineStyle(thickness, color(fill), 1);
    if (node.kind === 'arc') {
      const start = Phaser.Math.DegToRad(node.start || 0);
      const sweep = Phaser.Math.DegToRad(node.sweep ?? 360);
      g.beginPath();
      g.arc(x, y, radius, start, start + sweep);
      g.strokePath();
    } else {
      g.strokeCircle(x, y, radius);
    }
  } else {
    const w = node.w || 0, h = node.h || 0;
    const radius = node.radius || 0;
    if (radius > 0) g.fillRoundedRect(x, y, w, h, radius);
    else g.fillRect(x, y, w, h);
    if (stroke) {
      if (radius > 0) g.strokeRoundedRect(x, y, w, h, radius);
      else g.strokeRect(x, y, w, h);
    }
  }
}

export function drawButton(g, node, disabled = false) {
  const { x, y, w, h } = node;
  const fill = node.fill || (disabled ? '#1c3a4f' : UI_COLORS.button);
  g.fillStyle(color(fill), 1);
  g.fillRoundedRect(x, y, w, h, 6);
  g.lineStyle(1, color(UI_COLORS.panelStroke), 1);
  g.strokeRoundedRect(x, y, w, h, 6);
}

function drawCloseX(g, node) {
  const { x, y, w, h } = node;
  const pad = Math.min(w, h) * 0.28;
  g.lineStyle(3, color(UI_COLORS.text), 1);
  g.lineBetween(x + pad, y + pad, x + w - pad, y + h - pad);
  g.lineBetween(x + w - pad, y + pad, x + pad, y + h - pad);
}

function resolve(bindKey, uiState, bindings, fallback) {
  if (!bindKey) return fallback;
  const fn = bindings?.[bindKey];
  if (typeof fn !== 'function') return fallback;
  const value = fn(uiState);
  return value === undefined || value === null ? fallback : value;
}

export function renderGraph(g, graph, uiState, bindings, ctx = {}) {
  const buttons = ctx.buttons || [];
  const texts = ctx.texts || null;
  const images = ctx.images || null;
  const nodes = graph?.nodes || [];

  for (const node of nodes) {
    if (node.visible === false) continue;

    switch (node.type) {
      case 'panel':
        drawPanel(g, node);
        break;
      case 'bar':
        drawBar(g, node, resolve(node.bind?.ratio, uiState, bindings, 0));
        break;
      case 'icon':
        if (node.kind === 'coin') drawCoinIcon(g, node);
        else if (node.kind === 'heart') drawHeartIcon(g, node);
        break;
      case 'shape':
        drawShape(g, node);
        break;
      case 'image': {
        const img = images?.get(node.id);
        if (img) {
          img.setPosition(node.x ?? 0, node.y ?? 0);
          img.setVisible(true);
        }
        break;
      }
      case 'button': {
        const disabled = !!node.disabled;
        drawButton(g, node, disabled);
        if (node.label === '✕') drawCloseX(g, node);
        buttons.push({ id: node.id, x: node.x, y: node.y, w: node.w, h: node.h, disabled, node });
        break;
      }
      case 'text': {
        const text = texts?.get(node.id);
        if (text) {
          text.setText(String(resolve(node.bind?.text, uiState, bindings, node.text ?? '')));
          text.setPosition(node.x, node.y);
          text.setVisible(true);
        }
        break;
      }
    }
  }

  return buttons;
}
