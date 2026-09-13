// mxGraph 线框 XML 解析器：把 draw.io/mxGraph 的顶点(xml mxCell) 与连线(edge=1) 转成可编辑形状。
// 纯函数，浏览器用 DOMParser；不引 mxGraph 库。

export function parseMxGraph(xmlText) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser 不可用（需在浏览器运行）');
  const xml = urlDecode(xmlText);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) throw new Error('mxGraph XML 解析失败：不是合法 XML');

  const cells = [...doc.querySelectorAll('mxCell')];
  // 顶点矩形表：连线端点连在顶点上（无 sourcePoint/targetPoint）时用它取连接点
  const rects = new Map();
  for (const c of cells) {
    if (isTrue(c.getAttribute('edge'))) continue;
    const geo = c.querySelector('mxGeometry');
    if (!geo) continue;
    rects.set(c.getAttribute('id'), {
      x: number(geo.getAttribute('x'), 0),
      y: number(geo.getAttribute('y'), 0),
      w: number(geo.getAttribute('width'), 120),
      h: number(geo.getAttribute('height'), 40)
    });
  }

  const shapes = [];
  for (const c of cells) {
    const geo = c.querySelector('mxGeometry');
    if (!geo) continue;
    const style = c.getAttribute('style') || '';

    if (isTrue(c.getAttribute('edge'))) {
      const line = parseEdgeShape(c, geo, style, rects);
      if (line) shapes.push(line);
      continue;
    }

    const x = number(geo.getAttribute('x'), 0);
    const y = number(geo.getAttribute('y'), 0);
    const w = number(geo.getAttribute('width'), 120);
    const h = number(geo.getAttribute('height'), 40);

    // 标签：优先 value 属性，其次元素文本；HTML 化 label 剥成纯文本
    let label = (c.getAttribute('value') || '').trim();
    if (!label) {
      const val = c.querySelector('value');
      if (val && val.textContent) label = val.textContent.trim();
    }
    // 文字颜色/字号：style 优先，其次从 label 的 <font color=...> / font-size / font size 推断
    let fontColor = colorValue(styleValue(style, 'fontColor')) || null;
    let fontSize = Number(styleValue(style, 'fontSize') || 12);
    if (!fontColor) { const m = label.match(/color="([^"]+)"/); if (m) fontColor = colorValue(m[1]) || null; }
    if (!styleValue(style, 'fontSize')) {
      const m = label.match(/font-size:\s*([\d.]+)px/);
      if (m) fontSize = Number(m[1]);
      else { const s2 = label.match(/<font[^>]*size="(\d)"/); if (s2) fontSize = [10, 13, 16, 18, 24, 32, 48][Number(s2[1]) - 1] || 10; }
    }
    label = stripHtml(label);

    const rounded = /rounded=1/i.test(style);
    const shape = styleValue(style, 'shape') || leadingShapeToken(style) || (rounded ? 'rounded' : 'rect');
    // mxGraph 默认：填充白、描边黑；显式 none 才透明/无边框
    const fill = /fillColor=none/i.test(style) ? null : (colorValue(styleValue(style, 'fillColor')) || '#FFFFFF');
    const stroke = /strokeColor=none/i.test(style) ? null : (colorValue(styleValue(style, 'strokeColor')) || '#000000');
    const fillOpacity = Number(styleValue(style, 'fillOpacity') || styleValue(style, 'opacity') || 1);
    const strokeOpacity = Number(styleValue(style, 'strokeOpacity') || 1);
    shapes.push({
      id: c.getAttribute('id') || `s${shapes.length}`,
      x, y, w, h,
      label,
      style,
      shape,
      rounded,
      // 圆角半径：mxGraph 的 arcSize 默认 15(%)，absoluteArcSize=1 时 arcSize 直接是设计单位
      arcSize: number(styleValue(style, 'arcSize'), 15),
      absoluteArcSize: isTrue(styleValue(style, 'absoluteArcSize')),
      wrap: /whiteSpace=wrap/i.test(style),
      fill,
      stroke,
      strokeWidth: Number(styleValue(style, 'strokeWidth') || 1),
      fontColor,
      fontSize,
      align: styleValue(style, 'align') || 'center',
      verticalAlign: styleValue(style, 'verticalAlign') || 'middle',
      rotation: Number(styleValue(style, 'rotation') || 0),
      direction: styleValue(style, 'direction') || '',
      // 部分 shape（parallelogram 等 stencil）用 size 控制几何：倾斜量/边长
      size: number(styleValue(style, 'size'), 0),
      dashed: /dashed=1/i.test(style),
      fillOpacity, strokeOpacity,
      note: ''
    });
  }
  return shapes;
}

// 连线 → { shape:'line', points:[相对 bbox 原点的折线顶点] }；端点定位不到则返回 null
function parseEdgeShape(c, geo, style, rects) {
  const a = edgePoint(geo, 'sourcePoint') || terminalPoint(c.getAttribute('source'), 'exit', style, rects);
  const b = edgePoint(geo, 'targetPoint') || terminalPoint(c.getAttribute('target'), 'entry', style, rects);
  if (!a || !b) return null;
  const pts = [a, ...edgeWaypoints(geo), b];
  const x = Math.min(...pts.map(p => p.x));
  const y = Math.min(...pts.map(p => p.y));
  return {
    id: c.getAttribute('id') || 'edge',
    x, y,
    w: Math.max(...pts.map(p => p.x)) - x,
    h: Math.max(...pts.map(p => p.y)) - y,
    label: stripHtml((c.getAttribute('value') || '').trim()),
    style,
    shape: 'line',
    points: pts.map(p => ({ x: p.x - x, y: p.y - y })),
    fill: null,
    stroke: /strokeColor=none/i.test(style) ? null : (styleValue(style, 'strokeColor') || '#000000'),
    strokeWidth: Number(styleValue(style, 'strokeWidth') || 1),
    strokeOpacity: Number(styleValue(style, 'strokeOpacity') || 1),
    dashed: /dashed=1/i.test(style),
    note: ''
  };
}

// 游离端点（as="sourcePoint"/"targetPoint"）：模型坐标
function edgePoint(geo, as) {
  const el = geo.querySelector(`mxPoint[as="${as}"]`);
  return el ? { x: number(el.getAttribute('x'), 0), y: number(el.getAttribute('y'), 0) } : null;
}

// 折点（<Array as="points">）：模型坐标
function edgeWaypoints(geo) {
  const arr = geo.querySelector('Array[as="points"]');
  if (!arr) return [];
  return [...arr.querySelectorAll('mxPoint')].map(el => ({ x: number(el.getAttribute('x'), 0), y: number(el.getAttribute('y'), 0) }));
}

// 连在顶点上的端点：有 exitX/exitY（entryX/entryY）按比例取，否则取中心
function terminalPoint(id, prefix, style, rects) {
  const r = id ? rects.get(id) : null;
  if (!r) return null;
  const fx = Number(styleValue(style, `${prefix}X`));
  const fy = Number(styleValue(style, `${prefix}Y`));
  if (styleValue(style, `${prefix}X`) !== '' && styleValue(style, `${prefix}Y`) !== '' && Number.isFinite(fx) && Number.isFinite(fy)) {
    return { x: r.x + fx * r.w, y: r.y + fy * r.h };
  }
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function isTrue(v) {
  return v === '1' || v === 'true';
}

function number(v, dflt) {
  if (v === null || v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// URL 编码解密：%3C -> < 等。含 %XX 且能解码则用解码结果，否则原样返回。
export function urlDecode(text) {
  if (typeof text !== 'string' || /%[0-9a-fA-F]{2}/.test(text)) {
    try { return decodeURIComponent(text); } catch {}
  }
  return text;
}

// 去掉 value 里的 HTML 标签（<font><b>...</b></font> -> 纯文本）
export function stripHtml(text) {
  const t = decodeHTML(text || '');
  return t.indexOf('<') >= 0 || t.indexOf('>') >= 0 ? t.replace(/<[^>]*>/g, '') : t;
}

function styleValue(style, key) {
  const m = style.match(new RegExp(`${key}=([^;]+)`));
  return m ? m[1] : '';
}

// 颜色取值：新版 draw.io 会写 light-dark(#浅,#深)（canvas 不认 → 会静默保持上一次 fillStyle，
// 表现为「白色圆形画成黑色」），这里取浅色分支；仍不是合法颜色则返回 '' 走 mxGraph 默认色。
function colorValue(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  const m = v.match(/^light-dark\(\s*([^,]+?)\s*,/);
  const c = (m ? m[1] : v).trim();
  return /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i.test(c) ? c : '';
}

// draw.io 形态常是样式首 token（ellipse; / rhombus; / text;），非 shape=xxx
function leadingShapeToken(style) {
  const first = (style || '').split(';')[0].trim();
  return (!first || first.includes('=')) ? '' : first;
}

function decodeHTML(s) {
  if (!s) return s;
  const ENTITY = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&', '&nbsp;': ' ' };
  return String(s).replace(/&(?:lt|gt|quot|apos|amp|nbsp|#\d+|#x[\da-fA-F]+);/g, m =>
    ENTITY[m] ?? (m[1] === '#' ? String.fromCodePoint(m[2] === 'x' ? parseInt(m.slice(3), 16) : parseInt(m.slice(2), 10)) : m));
}
