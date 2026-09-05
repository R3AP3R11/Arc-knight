export function lerp(a, b, k) { return a + (b - a) * k; }

export function easeOutCubic(k) { return 1 - Math.pow(1 - k, 3); }

export function lerpColor(a, b, k) {
  if (!a) return b;
  if (!b) return a;
  const pa = a.replace('#', ''), pb = b.replace('#', '');
  if (pa.length !== 6 || pb.length !== 6) return k >= 0.5 ? b : a;
  const ch = i => parseInt(pa.slice(i * 2, i * 2 + 2), 16);
  const ch2 = i => parseInt(pb.slice(i * 2, i * 2 + 2), 16);
  const o = [0, 1, 2].map(i => Math.round(lerp(ch(i), ch2(i), k)).toString(16).padStart(2, '0')).join('');
  return '#' + o;
}

// 命中/包围矩形（UI 空间 1920x1080 坐标）
export function nodeRect(node) {
  const x = node.x ?? 0, y = node.y ?? 0;
  const center = node.type === 'icon' || node.type === 'image' || (node.type === 'shape' && (node.kind === 'ring' || node.kind === 'arc'));
  if (node.type === 'text') {
    const size = node.size || 24;
    const w = Math.max(size, String(node.text ?? '').length * size * 0.55);
    const h = size * 1.2;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, center: false };
  }
  if (node.type === 'icon') { const r = node.r || 16; return { x, y, w: r * 2, h: r * 2, cx: x, cy: y, center: true }; }
  if (node.type === 'image') { const w = node.w || 80, h = node.h || 80; return { x, y, w, h, cx: x, cy: y, center: true }; }
  if (node.type === 'shape' && (node.kind === 'ring' || node.kind === 'arc')) { const r = node.r || 20; return { x, y, w: r * 2, h: r * 2, cx: x, cy: y, center: true }; }
  let w = node.w || 0, h = node.h || 0;
  const cx = node.x ?? 0, cy = node.y ?? 0;
  return { x, y, w, h, cx: cx + (node.w || 0) / 2, cy: cy + (node.h || 0) / 2, center: false };
}

// hover 进度（0..1，ease 后）。store: Map<node,{p,last}>，now 为 ms
export function interactProgress(node, hoverNow, now, store) {
  const inter = node?.interact;
  if (!inter?.hover) return null;
  let s = store.get(node);
  if (!s) { s = { p: 0, last: now }; store.set(node, s); }
  const dt = Math.max(0, now - s.last) / 1000;
  s.last = now;
  const dur = (inter.hover.animMs ?? 120) / 1000;
  const step = dur > 0 ? dt / dur : 1;
  const target = hoverNow ? 1 : 0;
  if (s.p < target) s.p = Math.min(target, s.p + step);
  else if (s.p > target) s.p = Math.max(target, s.p - step);
  return { p: easeOutCubic(s.p) };
}

// 将 idle 值与 hover 覆盖值按进度 p 混合
export function blend(idle, over, p) {
  if (p <= 0 || over === undefined || over === null) return idle;
  if (typeof idle === 'number' && typeof over === 'number') return lerp(idle, over, p);
  if (typeof idle === 'string' && typeof over === 'string') return lerpColor(idle, over, p);
  return idle;
}
