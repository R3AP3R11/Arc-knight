// ============================================================
// 画板矢量渲染核心。
// 职责：把「设计稿 JSON」（一组绕圆心转动的多边形/圆弧）绘制到任意支持下列方法的图形上下文：
//   lineStyle(w, colorInt, alpha) / fillStyle(colorInt, alpha)
//   beginPath() / moveTo(x,y) / lineTo(x,y) / arc(x,y,r,a0,a1,ccw) / closePath()
//   fillPath() / strokePath()
// Phaser.GameObjects.Graphics 原生满足；Canvas2D 上下文用本文件导出的 makeG 适配器。
// 主要导出：hexToInt, intToHex, normalizeDesign, normalizeElement, normalizeOutline, renderAsset, elementCenter
// ============================================================

export function hexToInt(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.startsWith('#')) return parseInt(v.slice(1), 16);
  return parseInt((v || '').replace('#', ''), 16) || 0;
}

export function intToHex(n) {
  return (n >>> 0).toString(16).padStart(6, '0');
}

// 取色：兼容 #hex 与 rgba(...)（rgba 忽略 alpha 只取色）
function colorInt(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    if (v.startsWith('#')) return hexToInt(v);
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
    if (m) return (parseInt(m[1], 10) << 16) | (parseInt(m[2], 10) << 8) | parseInt(m[3], 10);
  }
  return hexToInt(v);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function numOr(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }

// 从弧心算起的形状/花纹最大外径（design 单位；供包围盒/卡片缩放/选中圈计入）。
// plain/clock 以 el.radius 为环半径；hands 只画长短针，外径由各自轨道半径 + 针长决定。
function patternExt(el) {
  if (el.shape !== 'arc') return 0;
  const lw = (Math.abs(Number(el.lineWidth)) || 0) / 2;
  if (el.pattern === 'hands') {
    const dir = el.tickDir || 'in';
    const longR = Math.abs(Number(el.handLongRadius) || 0);
    const shortR = Math.abs(Number(el.handShortRadius) || 0);
    const longLen = Math.max(0, Number(el.tickLongLen) || 12);
    const shortLen = Math.max(0, Number(el.tickShortLen) || 6);
    const out = dir === 'out' || dir === 'both';
    return Math.max(longR + (out ? longLen : 0), shortR + (out ? shortLen : 0), 1);
  }
  const r = Math.abs(Number(el.radius) || 0);
  if (el.pattern === 'clock') {
    const maxTick = Math.max(Math.abs(Number(el.tickLongLen) || 0), Math.abs(Number(el.tickShortLen) || 0));
    return r + lw + (el.tickDir === 'in' ? 0 : maxTick);
  }
  return r + lw;
}

// 单个形状元素默认值
export function normalizeElement(el = {}, index = 0) {
  const shape = el.shape === 'arc' ? 'arc' : el.shape === 'stroke' ? 'stroke' : el.shape === 'pixel' ? 'pixel' : 'polygon';
  const cols = clamp(Math.round(Number(el.cols) || 12), 1, 64);
  const rows = clamp(Math.round(Number(el.rows) || 12), 1, 64);
  return {
    shape,
    count: shape === 'pixel' ? 1 : clamp(Math.round(Number(el.count) || 1), 1, 16), // 围绕圆心等角分布的副本数（"一组"）
    orbitRadius: clamp(Number(el.orbitRadius) || 0, 0, 2000), // 形状中心距设计圆心的轨道半径
    radius: clamp(Number(el.radius) || 20, 1, 2000),          // polygon 外接半径 / arc 环形半径
    sides: clamp(Math.round(Number(el.sides) || 6), 3, 24),   // polygon 边数
    cols,
    rows,
    cellSize: clamp(numOr(el.cellSize, 8), 1, 2000),
    gridColor: el.gridColor || '',
    cells: Array.isArray(el.cells)
      ? el.cells
        .filter(c => c && Number.isInteger(Number(c.x)) && Number.isInteger(Number(c.y)) && Number(c.x) >= 0 && Number(c.x) < cols && Number(c.y) >= 0 && Number(c.y) < rows && c.color)
        .map(c => ({ x: Number(c.x), y: Number(c.y), color: c.color }))
      : [],
    lineWidth: clamp(Number(el.lineWidth) || 4, 0.5, 120),    // 描边粗细 / 环厚
    color: el.color || '#ffa914',                              // 颜色（描边 / 环）
    fill: el.fill || null,                                     // 填充色，null = 不填充
    rotSpeed: Number(el.rotSpeed) || 0,                        // 旋转角速度 rad/s（大小）
    phase: Number(el.phase) || 0,                              // 初始相位 rad
    dir: Number(el.dir) < 0 ? -1 : 1,                          // 旋转方向：1=逆时针，-1=顺时针
    arcStart: Number(el.arcStart) || 0,                        // arc 起始角（°）
    arcEnd: Number(el.arcEnd) || 300,                          // arc 结束角（°）
    pattern: (el.pattern === 'clock' || el.pattern === 'hands') ? el.pattern : 'plain', // arc 显示形式：plain=普通圆弧 / clock=钟表表盘 / hands=长短针
    tickShortLen: clamp(numOr(el.tickShortLen, 6), 0, 500),    // 钟表：短针长度（px，design 单位）
    tickLongLen: clamp(numOr(el.tickLongLen, 12), 0, 500),     // 钟表：长针长度
    tickDensity: clamp(Math.round(numOr(el.tickDensity, 12)), 2, 120), // 钟表：单一密度（总针数，长短针按比例排布）
    tickRatio: clamp(Math.round(numOr(el.tickRatio, 1)), 1, 24),       // 钟表：长短针比例（每 1 长针之间配 N 短针；1=交替，4=钟表式 1长4短）
    tickDir: (el.tickDir === 'out' || el.tickDir === 'both') ? el.tickDir : 'in', // 针朝向：in=朝圆心 / out=向外 / both=双向
    handLongRadius: Math.max(0, clamp(numOr(el.handLongRadius, Number(el.radius) || 20), 0, 2000)),  // hands：长针轨道半径（针锚定环半径）
    handShortRadius: Math.max(0, clamp(numOr(el.handShortRadius, Number(el.radius) || 20), 0, 2000)),// hands：短针轨道半径
    handLongColor: el.handLongColor || el.color || '#ffa914',                     // hands：长针颜色
    handShortColor: el.handShortColor || el.color || '#ffa914',                   // hands：短针颜色
    points: Array.isArray(el.points)
      ? el.points.map(p => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }))
      : [],                                                    // stroke 轮廓点（相对设计圆心）
    closed: !!el.closed,                                       // stroke 是否闭合
    // 移动滞后偏移：元素相对圆心在移动方向上的最大错位（px，design 单位）与响应强度
    offsetX: Number(el.offsetX) || 0,
    offsetY: Number(el.offsetY) || 0,
    offsetSpeed: (() => { const n = Number(el.offsetSpeed); return Number.isFinite(n) ? clamp(n, 0, 5) : 1; })()
  };
}

export function normalizeDesign(raw = {}) {
  return {
    id: raw.id || 'asset',
    name: raw.name || '未命名设计',
    bgColor: raw.bgColor || '#0a1220',
    center: { x: Number(raw.center?.x) || 0, y: Number(raw.center?.y) || 0 },
    scale: clamp(Number(raw.scale) || 1, 0.05, 20),
    elements: (Array.isArray(raw.elements) ? raw.elements : []).map(normalizeElement)
  };
}

// 轮廓库资产归一化（data/outlines/；点集相对轮廓重心；edges 为「点序下标对」用于无损还原连通拓扑）
export function normalizeOutline(raw = {}) {
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .filter(p => p && typeof p === 'object' && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map(p => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  const n = points.length;
  const edges = Array.isArray(raw.edges)
    ? raw.edges
      .map(pair => [Number(pair?.[0]), Number(pair?.[1])])
      .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < n && b < n && a !== b)
      .filter(([a, b], i, arr) => arr.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a)) === i)
    : [];
  return {
    id: String(raw.id || `outline-${Date.now()}`),
    name: String(raw.name || '未命名轮廓'),
    points,
    edges,
    color: raw.color || '#ffa914',
    lineWidth: clamp(Number(raw.lineWidth) || 4, 0.5, 120),
    closed: !!raw.closed,
    fill: raw.fill || null
  };
}

function drawPolygon(g, cx, cy, sides, radius, rot, lineWidth, colorInt, fillInt, alpha = 1) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (Math.PI * 2 / sides) * i;
    pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  if (fillInt != null) {
    g.fillStyle(fillInt, alpha);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillPath();
  }
  if (lineWidth > 0) {
    g.lineStyle(lineWidth, colorInt, alpha);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.strokePath();
  }
}

// 设计稿最大边界半径（供卡片/挂件把图标缩放成期望直径）。
export function designRadius(design) {
  let r = 1;
  for (const el of (design.elements || [])) {
    const hw = (el.lineWidth || 0) / 2;
    if (el.shape === 'pixel') {
      const pc = clamp(Math.round(Number(el.cols) || 12), 1, 64);
      const pr = clamp(Math.round(Number(el.rows) || 12), 1, 64);
      const cs = clamp(numOr(el.cellSize, 8), 1, 2000);
      r = Math.max(r, Math.abs(el.orbitRadius || 0) + Math.hypot((pc / 2) * cs, (pr / 2) * cs) + hw);
      continue;
    }
    let er;
    if (el.shape === 'arc') {
      er = Math.abs(el.orbitRadius || 0) + patternExt(el);
    } else {
      er = Math.abs(el.orbitRadius || 0) + Math.abs(el.radius || 0) + hw;
    }
    if (el.points?.length) {
      for (const pt of el.points) er = Math.max(er, Math.abs(el.orbitRadius || 0) + Math.hypot(pt.x, pt.y) + hw);
    }
    r = Math.max(r, er);
  }
  return r;
}

// 在 s=1、原点(0,0)、时刻 t 下计算设计稿渲染包围盒。复用 normalizeDesign/normalizeElement 语义：
//   ga = phase + rotSpeed*t*dir；polygon 绕其 orbit 点按 sides 顶点；stroke 若 orbitRadius>0 先算点质心、写点用旋转；
//   arc 用圆心 ±(radius+lineWidth/2)。
export function designBounds(design, t = 0) {
  const d = normalizeDesign(design);
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  const circle = (cx, cy, ext) => { minX = Math.min(minX, cx - ext); maxX = Math.max(maxX, cx + ext); minY = Math.min(minY, cy - ext); maxY = Math.max(maxY, cy + ext); };
  const pt = (px, py) => { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); };
  for (const el of d.elements) {
    const ga = el.phase + el.rotSpeed * t * el.dir;
    if (el.shape === 'arc') {
      const ext = patternExt(el);
      for (let i = 0; i < el.count; i++) { const ca = ga + (Math.PI * 2 / el.count) * i; circle(Math.cos(ca) * el.orbitRadius, Math.sin(ca) * el.orbitRadius, ext); }
    } else if (el.shape === 'stroke') {
      for (let i = 0; i < el.count; i++) {
        let cmx = 0, cmy = 0;
        if (el.orbitRadius > 0 && el.points.length) { for (const p of el.points) { cmx += p.x; cmy += p.y; } cmx /= el.points.length; cmy /= el.points.length; }
        const ca = ga + (Math.PI * 2 / el.count) * i;
        const cos = Math.cos(ca), sin = Math.sin(ca);
        const bx = Math.cos(ca) * el.orbitRadius, by = Math.sin(ca) * el.orbitRadius;
        for (const p of el.points) pt(bx + ((p.x - cmx) * cos - (p.y - cmy) * sin), by + ((p.x - cmx) * sin + (p.y - cmy) * cos));
      }
      const ext = el.lineWidth / 2; minX -= ext; maxX += ext; minY -= ext; maxY += ext;
    } else if (el.shape === 'pixel') {
      const cos = Math.cos(ga), sin = Math.sin(ga);
      const bx = Math.cos(ga) * el.orbitRadius, by = Math.sin(ga) * el.orbitRadius;
      for (const c of el.cells) {
        for (const gx of [c.x, c.x + 1]) for (const gy of [c.y, c.y + 1]) {
          const dx = (gx - el.cols / 2) * el.cellSize, dy = (gy - el.rows / 2) * el.cellSize;
          pt(bx + (dx * cos - dy * sin), by + (dx * sin + dy * cos));
        }
      }
      const ext = el.lineWidth / 2; minX -= ext; maxX += ext; minY -= ext; maxY += ext;
    } else {
      for (let i = 0; i < el.count; i++) { const ca = ga + (Math.PI * 2 / el.count) * i; const px = Math.cos(ca) * el.orbitRadius, py = Math.sin(ca) * el.orbitRadius; for (let k = 0; k < el.sides; k++) { const a = ca + (Math.PI * 2 / el.sides) * k; pt(px + Math.cos(a) * el.radius, py + Math.sin(a) * el.radius); } const ext = el.lineWidth / 2; minX -= ext; maxX += ext; minY -= ext; maxY += ext; }
    }
  }
  return { minX, minY, maxX, maxY };
}

// 把设计稿包围盒「居中 + 等比缩放」到以 (cx,cy) 为心的 boxSize（每边留 pad）。
export function renderAssetFit(g, design, cx, cy, boxSize, pad = 0, t = 0) {
  const d = normalizeDesign(design);
  const b = designBounds(design, t);
  const hw = Math.max(1e-6, (b.maxX - b.minX) / 2);
  const hh = Math.max(1e-6, (b.maxY - b.minY) / 2);
  const fit = (boxSize / 2 - pad) / Math.max(hw, hh);
  const scale = fit / d.scale;
  const bcx = (b.minX + b.maxX) / 2, bcy = (b.minY + b.maxY) / 2;
  renderAsset(g, design, cx - (d.center.x + bcx) * fit, cy - (d.center.y + bcy) * fit, t, scale);
}

// 以设计原点 (cx, cy) 为中心渲染画板设计稿。
// 不用 renderAssetFit（基于包围盒几何中心）——旋转动画元素（不同 phase/rotSpeed）会让
// designBounds 的 bcx/bcy 偏移并随 t 抖动（如 minigun 的轨道环、非整圆弧），导致外观偏离中心；
// 这里用设计原点定位，scale 按包围盒最大半径估算以保证不超框。
export function drawDesignCentered(g, design, cx, cy, boxSize, t = 0) {
  const b = designBounds(design, t);
  const hw = Math.max(1e-6, (b.maxX - b.minX) / 2);
  const hh = Math.max(1e-6, (b.maxY - b.minY) / 2);
  const scale = (boxSize / 2) / Math.max(hw, hh);
  renderAsset(g, design, cx, cy, t, scale);
}

// 在 (x,y) 处绘制设计稿。t = 时间（驱动旋转），scale = 外部缩放（乘 design.scale）。
// motion = 可选归一化移动向量 {x,y}（∈[-1,1]，如 moveLeanX/PLAYER_LEAN.hex），
//          驱动各元素的「移动滞后偏移」——元素沿移动方向按 offsetX/offsetY 错位、offsetSpeed 缩放响应强度。
export function renderAsset(g, design, x, y, t = 0, scale = 1, motion = null, alpha = 1) {
  const d = normalizeDesign(design);
  const s = scale * d.scale;
  const cx0 = x + d.center.x * s, cy0 = y + d.center.y * s;
  const r = Math.PI / 180;
  const mx = motion?.x || 0, my = motion?.y || 0;

  for (const el of d.elements) {
    const ga = el.phase + el.rotSpeed * t * el.dir;
    const lag = (el.offsetSpeed ?? 1);
    const offX = (el.offsetX || 0) * lag * mx * s;
    const offY = (el.offsetY || 0) * lag * my * s;
    const ax = cx0 + offX, ay = cy0 + offY;

    if (el.shape === 'arc') {
      // count>1 时像多边形一样绕设计圆心沿 orbitRadius 等角排布多环，且每个副本以自身 ca 角朝向
      // （count=1 / orbitRadius=0 时退回旧行为，单弧在原点）
      for (let i = 0; i < el.count; i++) {
        const ca = ga + (Math.PI * 2 / el.count) * i;
        const px = ax + Math.cos(ca) * el.orbitRadius * s;
        const py = ay + Math.sin(ca) * el.orbitRadius * s;
        const a0 = ca + el.arcStart * r;
        const a1 = ca + el.arcEnd * r;
        if (el.pattern === 'clock') {
          g.lineStyle(Math.max(0.5, el.lineWidth * s), hexToInt(el.color), alpha);
          g.beginPath();
          g.arc(px, py, Math.max(0.1, el.radius * s), a0, a1, a1 < a0);
          g.strokePath();
          drawArcTicks(g, el, px, py, a0, a1, s, alpha);
        } else if (el.pattern === 'hands') {
          drawArcHands(g, el, px, py, a0, a1, s, alpha);
        } else {
          g.lineStyle(Math.max(0.5, el.lineWidth * s), hexToInt(el.color), alpha);
          g.beginPath();
          g.arc(px, py, Math.max(0.1, el.radius * s), a0, a1, a1 < a0);
          g.strokePath();
        }
      }
      continue;
    }

    if (el.shape === 'stroke') {
      if (!el.points.length) continue;
      for (let i = 0; i < el.count; i++) {
        const ca = ga + (Math.PI * 2 / el.count) * i;
        const cos = Math.cos(ca), sin = Math.sin(ca);
        // orbitRadius>0：轮廓重心挂到轨道上（沿 ca 公转 orbitRadius*s），点相对重心排布并绕重心自转；=0 保持旧行为
        let cmx = 0, cmy = 0;
        if (el.orbitRadius > 0) {
          for (const p of el.points) { cmx += p.x; cmy += p.y; }
          cmx /= el.points.length; cmy /= el.points.length;
        }
        const bx = ax + cos * el.orbitRadius * s, by = ay + sin * el.orbitRadius * s;
        if (el.closed && el.fill) g.fillStyle(hexToInt(el.fill), alpha);
        g.lineStyle(Math.max(0.5, el.lineWidth * s), hexToInt(el.color), alpha);
        g.beginPath();
        el.points.forEach((pt, k) => {
          const wx = bx + ((pt.x - cmx) * cos - (pt.y - cmy) * sin) * s;
          const wy = by + ((pt.x - cmx) * sin + (pt.y - cmy) * cos) * s;
          if (k === 0) g.moveTo(wx, wy); else g.lineTo(wx, wy);
        });
        // 填充仿 Windows 画板：有填充色即按闭合区域上色（描边是否连回首点由 closed 决定）
        if (el.fill) g.fillPath();
        if (el.closed) g.closePath();
        g.strokePath();
      }
      continue;
    }

    if (el.shape === 'pixel') {
      const bx = ax + Math.cos(ga) * el.orbitRadius * s;
      const by = ay + Math.sin(ga) * el.orbitRadius * s;
      const cell = el.cellSize * s;
      const ox = bx - (el.cols / 2) * cell;
      const oy = by - (el.rows / 2) * cell;
      const grid = el.gridColor ? colorInt(el.gridColor) : 0;
      const hasGrid = !!el.gridColor;
      if (hasGrid) g.lineStyle(1, grid, alpha);
      for (const c of el.cells) {
        const px = ox + c.x * cell, py = oy + c.y * cell;
        g.fillStyle(hexToInt(c.color), alpha);
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px + cell, py);
        g.lineTo(px + cell, py + cell);
        g.lineTo(px, py + cell);
        g.closePath();
        g.fillPath();
        if (hasGrid) g.strokePath();
      }
      continue;
    }

    for (let i = 0; i < el.count; i++) {
      const ca = ga + (Math.PI * 2 / el.count) * i;
      const px = ax + Math.cos(ca) * el.orbitRadius * s;
      const py = ay + Math.sin(ca) * el.orbitRadius * s;
      drawPolygon(g, px, py, el.sides, el.radius * s, ca, el.lineWidth * s,
        hexToInt(el.color), el.fill ? hexToInt(el.fill) : null, alpha);
    }
  }
}

// 钟表表盘花纹：在环弧之上沿弧长均匀绘制径向刻度（长/短针按 tickRatio 比例排布），方向由 tickDir 决定。
function drawArcTicks(g, el, cx, cy, a0, a1, s, alpha) {
  const density = Math.max(2, Math.round(el.tickDensity || 12));
  const ratio = Math.max(1, Math.round(el.tickRatio || 1)); // 每 1 长针配 ratio 短针
  const period = ratio + 1;
  let span = a1 - a0;
  if (span < 0) span += Math.PI * 2;
  if (span <= 1e-6) return;
  const dir = el.tickDir || 'in';
  const rr = el.radius * s;
  const lw = Math.max(0.5, el.lineWidth * s * 0.55);
  g.lineStyle(lw, hexToInt(el.color), alpha);
  for (let i = 0; i < density; i++) {
    const ang = a0 + span * (i / density);
    const isLong = (i % period) === 0;
    const len = (isLong ? (el.tickLongLen || 12) : (el.tickShortLen || 6)) * s;
    if (len <= 0) continue;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    let inner = rr, outer = rr;
    if (dir === 'in' || dir === 'both') inner = rr - len;
    if (dir === 'out' || dir === 'both') outer = rr + len;
    g.beginPath();
    g.moveTo(cx + cos * inner, cy + sin * inner);
    g.lineTo(cx + cos * outer, cy + sin * outer);
    g.strokePath();
  }
}

// hands：只画长短针（无圆弧环）。长/短针各自锚定在 handLongRadius/handShortRadius 的环上，
// 沿弧 span 均布，按 tickRatio 区分长短针，长度取 tickLongLen/tickShortLen，方向由 tickDir 决定。
function drawArcHands(g, el, cx, cy, a0, a1, s, alpha) {
  const density = Math.max(2, Math.round(el.tickDensity || 12));
  const ratio = Math.max(1, Math.round(el.tickRatio || 1)); // 每 1 长针配 ratio 短针
  const period = ratio + 1;
  let span = a1 - a0;
  if (span < 0) span += Math.PI * 2;
  if (span <= 1e-6) return;
  const dir = el.tickDir || 'in';
  const longR = Math.max(0, Number(el.handLongRadius) || 0) * s;
  const shortR = Math.max(0, Number(el.handShortRadius) || 0) * s;
  const longLen = Math.max(0, Number(el.tickLongLen) || 12) * s;
  const shortLen = Math.max(0, Number(el.tickShortLen) || 6) * s;
  const longColor = hexToInt(el.handLongColor || el.color);
  const shortColor = hexToInt(el.handShortColor || el.color);
  const lw = Math.max(0.5, el.lineWidth * s * 0.55);
  for (let i = 0; i < density; i++) {
    const ang = a0 + span * (i / density);
    const isLong = (i % period) === 0;
    const rr = isLong ? longR : shortR;
    const len = isLong ? longLen : shortLen;
    if (len <= 0) continue;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    let inner = rr, outer = rr;
    if (dir === 'in' || dir === 'both') inner = rr - len;
    if (dir === 'out' || dir === 'both') outer = rr + len;
    g.lineStyle(lw, isLong ? longColor : shortColor, alpha);
    g.beginPath();
    g.moveTo(cx + cos * inner, cy + sin * inner);
    g.lineTo(cx + cos * outer, cy + sin * outer);
    g.strokePath();
  }
}

// 第 i 个副本的中心与当前公转角（画板命中测试 / 手柄定位用）。
export function elementCenter(design, el, index, x, y, t = 0, scale = 1) {
  const d = normalizeDesign(design);
  const e = normalizeElement(el);
  const s = scale * d.scale;
  const cx0 = x + d.center.x * s, cy0 = y + d.center.y * s;
  const ga = e.phase + e.rotSpeed * t * e.dir;
  if (e.shape === 'arc') {
    const ca = ga + (Math.PI * 2 / e.count) * index;
    return { x: cx0 + Math.cos(ca) * e.orbitRadius * s, y: cy0 + Math.sin(ca) * e.orbitRadius * s, angle: ca, worldScale: s, el: e };
  }
  if (e.shape === 'stroke') {
    // orbitRadius>0：轮廓重心挂轨道上（沿 ca 公转），命中/手柄中心 = 轨道点（与渲染一致）；=0：取轮廓点重心绕圆心旋转（旧行为）
    const ca = ga + (Math.PI * 2 / e.count) * index;
    if (e.orbitRadius > 0) {
      const ox = Math.cos(ca) * e.orbitRadius * s, oy = Math.sin(ca) * e.orbitRadius * s;
      return { x: cx0 + ox, y: cy0 + oy, angle: ca, worldScale: s, el: e };
    }
    // 取轮廓点重心为命中/选中中心，绕圆心旋转
    let mx = 0, my = 0;
    if (e.points.length) { for (const p of e.points) { mx += p.x; my += p.y; } mx /= e.points.length; my /= e.points.length; }
    const cos = Math.cos(ca), sin = Math.sin(ca);
    return { x: cx0 + (mx * cos - my * sin) * s, y: cy0 + (mx * sin + my * cos) * s, angle: ca, worldScale: s, el: e };
  }
  if (e.shape === 'pixel') {
    const ox = Math.cos(ga) * e.orbitRadius * s, oy = Math.sin(ga) * e.orbitRadius * s;
    return { x: cx0 + ox, y: cy0 + oy, angle: ga, worldScale: s, el: e };
  }
  const ca = ga + (Math.PI * 2 / e.count) * index;
  return {
    x: cx0 + Math.cos(ca) * e.orbitRadius * s,
    y: cy0 + Math.sin(ca) * e.orbitRadius * s,
    angle: ca,
    worldScale: s,
    el: e
  };
}

// 面数上限展示用（可选）。
export const MAX_SIDES = 24;

// Canvas2D → renderAsset 表面适配器（与 Phaser Graphics 同方法名）。
// 供 ui-library 组件库预览与画板（artboard.js）复用；它只消费已归一化的设计稿。
export function makeG(ctx) {
  return {
    lineStyle: (w, color, alpha) => { ctx.lineWidth = Math.max(0.1, w); ctx.strokeStyle = '#' + intToHex(color); ctx.globalAlpha = alpha; },
    fillStyle: (color, alpha) => { ctx.fillStyle = '#' + intToHex(color); ctx.globalAlpha = alpha; },
    beginPath: () => ctx.beginPath(),
    moveTo: (x, y) => ctx.moveTo(x, y),
    lineTo: (x, y) => ctx.lineTo(x, y),
    arc: (x, y, r, a0, a1, ccw) => ctx.arc(x, y, r, a0, a1, ccw),
    closePath: () => ctx.closePath(),
    fillPath: () => ctx.fill(),
    strokePath: () => ctx.stroke()
  };
}
