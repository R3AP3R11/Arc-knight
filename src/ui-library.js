// 可复用 UI 组件库：注册表 + 组件定义
// 每个组件 = id / name / category / description / defaultProps / propsSchema /
//           draw2d(Canvas2D, 库面板预览) / drawPhaser(Phaser Graphics, 真机页面)
// 不修改任何现有游戏绘制逻辑：组件就是原控件，只是抽象成可配置实例。
import { getDesign } from './systems/art/design-store.js';
import { makeG, renderAsset, designRadius, renderAssetFit } from './systems/art/asset-render.js';
import { ITEM_DEFS } from './state.js';

export function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}
export function mixColor(a, b, k) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  return rgbToHex(pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k);
}

// 登录按钮（原透明底+白字，悬停白色平行四边形扫过 + 文字变深）
export const LoginButton = {
  id: 'LoginButton',
  name: '登录按钮',
  category: '按钮',
  description: '原登录页按钮：透明底+白字，悬停白色平行四边形扫过 + 文字变深',
  defaultProps: {
    x: 120, y: 700, w: 420, h: 66,
    label: '新游戏', textSize: 28,
    textColor: '#eaf4fb', hoverTextColor: '#0e2233',
    sweepColor: '#ffffff', sweepAlpha: 0.9, sweepSkew: 42,
    baseAlpha: 0, baseFill: '#000000', strokeAlpha: 0, strokeColor: '#ffffff'
  },
  propsSchema: [
    { key: 'label', label: '文本', type: 'text' },
    { key: 'textSize', label: '字号', type: 'number', min: 10, max: 64 },
    { key: 'textColor', label: '文字色', type: 'color' },
    { key: 'hoverTextColor', label: '悬停文字色', type: 'color' },
    { key: 'sweepColor', label: '扫光色', type: 'color' },
    { key: 'sweepAlpha', label: '扫光透明度', type: 'number', min: 0, max: 1, step: 0.05 },
    { key: 'sweepSkew', label: '扫光倾斜', type: 'number', min: 0, max: 120 },
    { key: 'w', label: '宽', type: 'number' },
    { key: 'h', label: '高', type: 'number' }
  ],

  sweepRect(p, t) {
    // t ∈ [0,1]：扫光带从按钮左侧滑入，t=1 时覆盖按钮（白底+深字可读）
    const w = p.w || 420, h = p.h || 66, skew = p.sweepSkew || 42;
    const left = p.x - (1 - t) * (w + skew);
    return { left, top: p.y, w, h, skew };
  },

  draw2d(ctx, p, st) {
    const q = { ...this.defaultProps, ...p };
    const k = st?.hover ?? 0;
    if (q.baseAlpha > 0) { ctx.globalAlpha = q.baseAlpha; ctx.fillStyle = q.baseFill; ctx.fillRect(q.x, q.y, q.w, q.h); ctx.globalAlpha = 1; }
    if (q.strokeAlpha > 0 && k > 0.001) { ctx.globalAlpha = q.strokeAlpha * k; ctx.strokeStyle = q.strokeColor; ctx.strokeRect(q.x, q.y, q.w, q.h); ctx.globalAlpha = 1; }
    if (q.sweepAlpha > 0 && k > 0.001) {
      const r = this.sweepRect(q, k);
      ctx.globalAlpha = q.sweepAlpha;
      ctx.fillStyle = q.sweepColor;
      ctx.beginPath();
      ctx.moveTo(r.left + r.skew, r.top);
      ctx.lineTo(r.left + r.w + r.skew, r.top);
      ctx.lineTo(r.left + r.w, r.top + r.h);
      ctx.lineTo(r.left, r.top + r.h);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = mixColor(q.textColor, q.hoverTextColor, k);
    ctx.font = `${q.textSize || 28}px 'Segoe UI','Poppins','Noto Sans SC',sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(q.label || '', q.x + 32, q.y + (q.h || 66) / 2);
    ctx.textAlign = 'start';
  },

  drawPhaser(g, p, st, text) {
    const q = { ...this.defaultProps, ...p };
    const k = st?.hover ?? 0;
    if (q.baseAlpha > 0) { g.fillStyle(colorInt(q.baseFill), q.baseAlpha); g.fillRect(q.x, q.y, q.w, q.h); }
    if (q.sweepAlpha > 0 && k > 0.001) {
      const r = this.sweepRect(q, k);
      g.fillStyle(colorInt(q.sweepColor), q.sweepAlpha);
      g.beginPath();
      g.moveTo(r.left + r.skew, r.top);
      g.lineTo(r.left + r.w + r.skew, r.top);
      g.lineTo(r.left + r.w, r.top + r.h);
      g.lineTo(r.left, r.top + r.h);
      g.closePath();
      g.fillPath();
    }
    if (text) {
      text.setText(q.label || '');
      text.setPosition(q.x + 32, q.y + (q.h || 66) / 2);
      text.setColor(mixColor(q.textColor, q.hoverTextColor, k));
      text.setVisible(true);
    }
  }
};

// 赐福卡片（神像三选一增幅卡）：白卡 + 图标(动态资产/黑圆占位) + 名称/描述，悬停放大 10%。
// icon 字段为画板资产 id：有设计稿用 renderAsset 渲染动态资产，缺省退化黑圆占位。
export const GiftCard = {
  id: 'GiftCard',
  name: '赐福卡片',
  category: '卡片',
  description: '神像三选一增幅卡：白卡 + 图标(可配动态资产/黑圆占位) + 名称/描述，悬停放大 10%',
  defaultProps: {
    x: 340, y: 120, w: 408, h: 216,
    icon: '', iconSize: 132,
    name: '力量祝福', desc: '攻击力 +15%',
    nameSize: 24, descSize: 20,
    textColor: '#000000', bgColor: '#ffffff',
    hoverScale: 0.1
  },
  propsSchema: [
    { key: 'icon', label: '图标资产', type: 'asset' },
    { key: 'iconSize', label: '图标直径', type: 'number', min: 8, max: 400 },
    { key: 'name', label: '增幅名称', type: 'text' },
    { key: 'desc', label: '增幅描述', type: 'text' },
    { key: 'nameSize', label: '名称字号', type: 'number', min: 10, max: 64 },
    { key: 'descSize', label: '描述字号', type: 'number', min: 10, max: 64 },
    { key: 'textColor', label: '文字色', type: 'color' },
    { key: 'bgColor', label: '卡片底色', type: 'color' },
    { key: 'hoverScale', label: '悬停放大', type: 'number', min: 0, max: 0.5, step: 0.05 },
    { key: 'w', label: '宽', type: 'number' },
    { key: 'h', label: '高', type: 'number' }
  ],

  draw2d(ctx, p, st) {
    const q = { ...this.defaultProps, ...p };
    const k = st?.hover ?? 0;
    const s = 1 + (q.hoverScale ?? 0.1) * k;
    const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
    const w = q.w * s, h = q.h * s, r = (q.iconSize ?? 132) / 2;
    ctx.globalAlpha = 1;
    ctx.fillStyle = q.bgColor;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);

    const icx = cx, icy = cy - 24 * s;
    const design = q.icon ? getDesign(q.icon) : null;
    if (design) {
      renderAsset(makeG(ctx), design, icx, icy, 0, (r / designRadius(design)) * s);
    } else {
      ctx.fillStyle = '#000000';
      ctx.beginPath(); ctx.arc(icx, icy, r * s, 0, Math.PI * 2); ctx.fill();
    }

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = q.textColor || '#000000';
    ctx.font = `${q.nameSize || 24}px 'Segoe UI','Poppins','Noto Sans SC',sans-serif`;
    ctx.fillText(q.name || '', cx, cy + 62 * s);
    ctx.font = `${q.descSize || 20}px 'Segoe UI','Poppins','Noto Sans SC',sans-serif`;
    ctx.fillText(q.desc || '', cx, cy + 90 * s);
    ctx.textAlign = 'start';
  },

  drawPhaser(g, p, st, text) {
    const q = { ...this.defaultProps, ...p };
    const k = st?.hover ?? 0;
    const s = 1 + (q.hoverScale ?? 0.1) * k;
    const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
    const w = q.w * s, h = q.h * s, r = (q.iconSize ?? 132) / 2;
    g.fillStyle(colorInt(q.bgColor), 1);
    g.fillRect(cx - w / 2, cy - h / 2, w, h);

    const icx = cx, icy = cy - 24 * s;
    const design = q.icon ? getDesign(q.icon) : null;
    if (design) {
      renderAsset(g, design, icx, icy, 0, (r / designRadius(design)) * s);
    } else {
      g.fillStyle(0x000000, 1);
      g.fillCircle(icx, icy, r * s);
    }

    if (text) {
      text.setText(`${q.name || ''}\n${q.desc || ''}`);
      text.setOrigin(0.5, 0.5);
      text.setPosition(cx, cy + 76 * s);
      text.setColor(q.textColor || '#000000');
      text.setVisible(true);
    }
  }
};

export function colorInt(hex) {
  const c = hexToRgb(hex);
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

// 武器卡片（工坊右上武器列表卡）：顶部武器色带 + 通用改件/专属改件两行槽位。
// 槽位数由 genericCount/dedicatedCount 配置（运行时读武器设计稿 maxGenericMods/maxDedicatedMods）。
// slotLayout 供宿主（workshop）取槽位矩形以接线文本/命中区；draw2d/drawPhaser 渲染整卡。
export const WeaponCard = {
  id: 'WeaponCard',
  name: '武器卡片',
  category: '卡片',
  description: '工坊武器卡：顶部武器色带 + 通用/专属改件两行槽位，槽位数可按武器配置',
  defaultProps: {
    x: 544, y: 120, w: 280, h: 440,
    weapon: 'radial', weaponName: '基础', ringColor: '#ffffff',
    unlocked: true, selected: false, slotOrder: 1,
    genericCount: 3, dedicatedCount: 1,
    genericSlots: [], dedicatedSlots: []
  },
  propsSchema: [
    { key: 'weapon', label: '武器id', type: 'text' },
    { key: 'weaponName', label: '武器名', type: 'text' },
    { key: 'ringColor', label: '武器色', type: 'color' },
    { key: 'genericCount', label: '通用改件槽数', type: 'number', min: 0, max: 9 },
    { key: 'dedicatedCount', label: '专属改件槽数', type: 'number', min: 0, max: 3 },
    { key: 'w', label: '宽', type: 'number' },
    { key: 'h', label: '高', type: 'number' }
  ],

  // 返回 {generic:[{x,y,w,h,index}], dedicated:[...]} —— 与 drawModRow 同一几何公式
  slotLayout(p) {
    const q = { ...this.defaultProps, ...p };
    const w = q.w || 280, pad = 18, gap = 6, base = 44;
    const headH = Math.floor((q.h || 440) / 2); // 上/下区 1:1
    const rowW = w - pad * 2;
    const layout = (count, offY) => {
      const out = [];
      const n = Math.max(1, Math.min(count, 9));
      const avail = rowW - (n - 1) * gap;
      const sz = Math.max(18, Math.min(base, Math.floor(avail / n)));
      const total = n * sz + (n - 1) * gap;
      const ox = q.x + pad;
      for (let i = 0; i < n; i++) out.push({ x: ox + i * (sz + gap), y: q.y + offY, w: sz, h: sz, index: i });
      return out;
    };
    return { generic: layout(q.genericCount, headH + 34), dedicated: layout(q.dedicatedCount, headH + 110) };
  },

  drawPlate(g, s, itemId) {
    if (itemId == null || itemId === '') {
      g.fillStyle(0x555555, 1);
      g.fillRoundedRect(s.x, s.y, s.w, s.h, 6);
      return;
    }
    const def = ITEM_DEFS[itemId];
    const design = def?.icon ? getDesign(def.icon) : null;
    if (design) {
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(s.x, s.y, s.w, s.h, 4);
      renderAssetFit(g, design, s.x + s.w / 2, s.y + s.h / 2, s.w * 0.8, 0, 0);
      return;
    }
    g.fillStyle(colorInt(def?.color || '#ffffff'), 1);
    g.fillRoundedRect(s.x, s.y, s.w, s.h, 6);
  },

  draw2d(ctx, p, st) {
    const q = { ...this.defaultProps, ...p };
    const headH = Math.floor((q.h || 440) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(q.x, q.y, q.w, q.h);
    ctx.fillStyle = q.unlocked === false ? '#555555' : '#ffffff';
    ctx.fillRect(q.x, q.y, q.w, headH);
    if (q.selected) {
      ctx.strokeStyle = q.ringColor || '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(q.x, q.y, q.w, q.h);
    }
    const plateColor = (itemId) => {
      if (itemId == null || itemId === '') return '#555555';
      return ITEM_DEFS[itemId]?.color || '#ffffff';
    };
    const layout = this.slotLayout(q);
    for (const row of [layout.generic, layout.dedicated]) {
      const items = row === layout.generic ? q.genericSlots : q.dedicatedSlots;
      for (const sl of row) {
        ctx.fillStyle = plateColor(items[sl.index]);
        ctx.fillRect(sl.x, sl.y, sl.w, sl.h);
      }
    }
    ctx.fillStyle = '#000000';
    ctx.font = '20px "Noto Sans SC",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(q.weaponName || '', q.x + q.w / 2, q.y + q.h - 30);
  },

  drawPhaser(g, p, st, text) {
    const q = { ...this.defaultProps, ...p };
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(q.x, q.y, q.w, q.h, 4);
    g.fillStyle(q.unlocked === false ? 0x555555 : 0xffffff, 1);
    g.fillRoundedRect(q.x, q.y, q.w, Math.floor((q.h || 440) / 2), 4);
    if (q.selected) {
      g.lineStyle(3, colorInt(q.ringColor || '#ffffff'), 1);
      g.strokeRoundedRect(q.x, q.y, q.w, q.h, 4);
    }
    // 两行槽位底板（文本/命中区由宿主用 slotLayout 叠加）
    const layout = this.slotLayout(q);
    for (const row of [layout.generic, layout.dedicated]) {
      const items = row === layout.generic ? q.genericSlots : q.dedicatedSlots;
      for (const sl of row) this.drawPlate(g, sl, items[sl.index]);
    }
    if (text) {
      text.setText(q.weaponName || '');
      text.setPosition(q.x + q.w / 2, q.y + q.h - 30);
      text.setColor('#000000');
      text.setVisible(true);
    }
  }
};

const REGISTRY = [];
export function registerComponent(def) { REGISTRY.push(def); return def; }
export function getLibrary() { return REGISTRY.slice(); }
export function getComponent(id) { return REGISTRY.find(c => c.id === id); }

// 注册内置组件（在 main.js 顶层调用一次）
export function registerBuiltinComponents() {
  if (REGISTRY.length) return;
  registerComponent(LoginButton);
  registerComponent(GiftCard);
  registerComponent(WeaponCard);
}
