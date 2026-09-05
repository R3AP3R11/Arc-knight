// mxGraph 线框 XML 解析器：把 draw.io/mxGraph 的顶点(xml mxCell) 转成可编辑形状。
// 纯函数，浏览器用 DOMParser；不引 mxGraph 库。

export function parseMxGraph(xmlText) {
  if (typeof DOMParser === 'undefined') throw new Error('DOMParser 不可用（需在浏览器运行）');
  const xml = urlDecode(xmlText);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) throw new Error('mxGraph XML 解析失败：不是合法 XML');

  const shapes = [];
  const cells = doc.querySelectorAll('mxCell');
  for (const c of cells) {
    const isEdge = c.getAttribute('edge') === '1' || c.getAttribute('edge') === 'true';
    if (isEdge) continue;
    const isVertex = c.getAttribute('vertex') === '1' || c.getAttribute('vertex') === 'true' || c.querySelector('mxGeometry');
    if (!isVertex) continue;
    const geo = c.querySelector('mxGeometry');
    if (!geo) continue;

    const x = Number(geo.getAttribute('x') || 0);
    const y = Number(geo.getAttribute('y') || 0);
    const w = Number(geo.getAttribute('width') || 120);
    const h = Number(geo.getAttribute('height') || 40);
    const style = c.getAttribute('style') || '';

    // 标签：优先 value 属性，其次元素文本；HTML 化 label 剥成纯文本
    let label = (c.getAttribute('value') || '').trim();
    if (!label) {
      const val = c.querySelector('value');
      if (val && val.textContent) label = val.textContent.trim();
    }
    // 文字颜色/字号：style 优先，其次从 label 的 <font color=...> / font-size / font size 推断
    let fontColor = styleValue(style, 'fontColor') || null;
    let fontSize = Number(styleValue(style, 'fontSize') || 12);
    if (!fontColor) { const m = label.match(/color="([^"]+)"/); if (m) fontColor = m[1]; }
    if (!styleValue(style, 'fontSize')) {
      const m = label.match(/font-size:\s*([\d.]+)px/);
      if (m) fontSize = Number(m[1]);
      else { const s2 = label.match(/<font[^>]*size="(\d)"/); if (s2) fontSize = [10, 13, 16, 18, 24, 32, 48][Number(s2[1]) - 1] || 10; }
    }
    label = stripHtml(label);

    const rounded = /rounded=1/i.test(style);
    const shape = styleValue(style, 'shape') || leadingShapeToken(style) || (rounded ? 'rounded' : 'rect');
    // mxGraph 默认：填充白、描边黑；显式 none 才透明/无边框
    const fill = /fillColor=none/i.test(style) ? null : (styleValue(style, 'fillColor') || '#FFFFFF');
    const stroke = /strokeColor=none/i.test(style) ? null : (styleValue(style, 'strokeColor') || '#000000');
    const fillOpacity = Number(styleValue(style, 'fillOpacity') || styleValue(style, 'opacity') || 1);
    const strokeOpacity = Number(styleValue(style, 'strokeOpacity') || 1);
    shapes.push({
      id: c.getAttribute('id') || `s${shapes.length}`,
      x, y, w, h,
      label,
      style,
      shape,
      rounded,
      wrap: /whiteSpace=wrap/i.test(style),
      fill,
      stroke,
      strokeWidth: Number(styleValue(style, 'strokeWidth') || 1),
      fontColor,
      fontSize,
      align: styleValue(style, 'align') || 'center',
      verticalAlign: styleValue(style, 'verticalAlign') || 'middle',
      rotation: Number(styleValue(style, 'rotation') || 0),
      dashed: /dashed=1/i.test(style),
      fillOpacity, strokeOpacity,
      note: ''
    });
  }
  return shapes;
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
