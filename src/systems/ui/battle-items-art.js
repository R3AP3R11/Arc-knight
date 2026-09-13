/**
 * 文件职责：战斗 HUD 药水槽 / 临时武器槽 / 药水选择轮盘 / 状态图标的纯绘制与几何解析（无 mixin / 无 this）
 * 归属分类：UI交互
 * 主要导出：ITEM_SLOT_SIZE, POTION_SLOT_POS, TEMP_SLOT_POS, SLOT_CORNER, TEMP_TIME_BAR_GAP/H, POTION_DOT_GAP,
 *          WHEEL_CX/CY/RADIUS/ICON_SIZE/DEAD_ZONE/LINE_LEN/LINE_W/RING_R, WHEEL_NAME_FONT/GAP, WHEEL_ANIM_MS,
 *          WHEEL_HOVER_FADE_MS/RINGS/ALPHA_IN/ALPHA_OUT,
 *          STATUS_ICON/PITCH/COLS/ROWS/ORIGIN, wheelHoverIndex, wheelIconPos, wheelNamePos,
 *          drawItemSlotFrame, drawPotionQueueDots, drawPotionSlot, drawTempWeaponSlot, drawPotionWheel,
 *          drawBattleStatusIcons
 * 依赖：systems/constants.js、systems/art/asset-render.js、systems/art/design-store.js、systems/ui/vendor-shop-art.js
 */

import { VIEW_W, VIEW_H, WEAPON_BG_ASSET } from '../constants.js';
import { drawDesignCentered, hexToInt } from '../art/asset-render.js';
import { getDesign } from '../art/design-store.js';
import { getArtRef, whiteVariant } from './vendor-shop-art.js';

// ── 槽位几何（设计稿背景框 320×180 的 ×6 换算，坐标均为「中心点」）──
// 位置与底角 HUD 基准线（VIEW_H-16=1064）平齐：槽底 = y + 45 = 1064
export const ITEM_SLOT_SIZE = 90;
export const POTION_SLOT_POS = { x: 1220, y: 1019 };
export const TEMP_SLOT_POS = { x: 1329.5, y: 1019 };
export const SLOT_CORNER = 12;
export const TEMP_TIME_BAR_GAP = 12, TEMP_TIME_BAR_H = 6;
export const POTION_DOT_GAP = 8;   // 队列小点与槽底间距（槽位下移后留出 4px 屏幕边距）

// ── 药水选择轮盘几何 ──
export const WHEEL_CX = 967.5, WHEEL_CY = 512.25, WHEEL_RADIUS = 224, WHEEL_ICON_SIZE = 114;
export const WHEEL_DEAD_ZONE = 48, WHEEL_LINE_LEN = 212, WHEEL_LINE_W = 3, WHEEL_RING_R = 284;
export const WHEEL_NAME_FONT = 24;                // 轮盘每项描述文本字号
export const WHEEL_NAME_GAP = 12;                 // 描述文本与图标下边缘的间距
export const WHEEL_ANIM_MS = 300;
export const WHEEL_HOVER_FADE_MS = 160;          // 悬停蒙层渐显时长
export const WHEEL_HOVER_RINGS = 24;             // 径向渐变的分层数（越多越接近线性）
export const WHEEL_HOVER_ALPHA_IN = 0.5;         // 最内侧透明度
export const WHEEL_HOVER_ALPHA_OUT = 0.1;        // 最外侧透明度

// ── 状态图标（世界层，玩家左下角）──
export const STATUS_ICON = 18, STATUS_PITCH = 24, STATUS_COLS = 2, STATUS_ROWS = 4;
export const STATUS_ORIGIN = { x: -105, y: -31.5 };

const DEG = Math.PI / 180;
const clamp01 = v => Math.max(0, Math.min(1, Number(v) || 0));

// ── 鼠标位置 → 悬停扇区下标（0=上 1=右 2=下 3=左，顺时针，正上方起）；死区内 / 越界返回 -1 ──
export function wheelHoverIndex(px, py, count = 4) {
  const dx = Number(px) - WHEEL_CX, dy = Number(py) - WHEEL_CY;
  const d = Math.hypot(dx, dy);
  if (!Number.isFinite(d) || d < WHEEL_DEAD_ZONE) return -1;   // 死区（含 NaN）不选中
  const a = Math.atan2(dy, dx);
  const i = ((Math.round((a + Math.PI / 2) / (Math.PI / 2)) % 4) + 4) % 4;
  const n = Math.floor(Number(count) || 0);
  if (i >= n) return -1;                                        // 超出实际药水数量
  return i;
}

// ── 轮盘第 i 项（0=上 1=右 2=下 3=左，顺时针）的图标中心 / 其**正下方**描述文本位置 ──
export function wheelIconPos(i, scale = 1) {
  const ang = (-90 + Number(i) * 90) * DEG;
  const s = Number(scale) > 0 ? Number(scale) : 1;
  return { x: WHEEL_CX + Math.cos(ang) * WHEEL_RADIUS * s, y: WHEEL_CY + Math.sin(ang) * WHEEL_RADIUS * s };
}

export function wheelNamePos(i, scale = 1) {
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const p = wheelIconPos(i, s);
  return { x: p.x, y: p.y + (WHEEL_ICON_SIZE / 2 + WHEEL_NAME_GAP) * s };
}

// ── 通用圆角槽位框：默认黑底 + #CFCFCF 边框；filled=true → 白底白框（供白底黑图场景复用）──
export function drawItemSlotFrame(g, x, y, size, { filled = false, fillColor = 0x000000, borderColor = 0xCFCFCF } = {}) {
  const half = size / 2;
  g.fillStyle(filled ? 0xffffff : fillColor, 1);
  g.fillRoundedRect(x - half, y - half, size, size, SLOT_CORNER);
  g.lineStyle(3, filled ? 0xffffff : borderColor, 1);
  g.strokeRoundedRect(x - half, y - half, size, size, SLOT_CORNER);
}

// ── 药水槽下方队列小点：前 count 个实心白，其余暗色；居中于槽位下方 12px ──
export function drawPotionQueueDots(g, x, y, size, count, total = 4) {
  const n = Math.max(1, Math.floor(Number(total) || 0));
  const filled = Math.max(0, Math.min(n, Math.floor(Number(count) || 0)));
  const dotR = 4, pitch = 14;
  const rowW = (n - 1) * pitch;
  const startX = x - rowW / 2;
  const dotY = y + size / 2 + POTION_DOT_GAP;
  for (let i = 0; i < n; i++) {
    g.fillStyle(i < filled ? 0xffffff : 0x666666, 1);
    g.fillCircle(startX + i * pitch, dotY, dotR);
  }
}

// ── 药水槽：无药水 → 黑底 + #CFCFCF 边框；有药水 → 黑底 + 白框 + 纯白图标（whiteVariant）──
export function drawPotionSlot(g, x, y, size, { design, count } = {}) {
  const filled = (Number(count) || 0) > 0;
  if (!filled) {                              // 无药水：空槽位框
    drawItemSlotFrame(g, x, y, size, { filled: false });
    return;
  }
  const half = size / 2;
  g.fillStyle(0x000000, 1);                   // 黑底（与设计稿「白底黑图」相反，与局内黑底 HUD 统一）
  g.fillRoundedRect(x - half, y - half, size, size, SLOT_CORNER);
  g.lineStyle(3, 0xffffff, 1);
  g.strokeRoundedRect(x - half, y - half, size, size, SLOT_CORNER);
  if (design) drawDesignCentered(g, whiteVariant(design), x, y, size * 0.62, 0);
  else { g.fillStyle(0xffffff, 1); g.fillCircle(x, y, size * 0.2); }   // 图标未加载：白圆占位
}

// ── 临时武器槽：空 → 黑底 #CFCFCF 边框；有武器（未使用）→ **黑底** + 白框 + 武器图案；
//    使用中 → **白底** + 武器色（ringColor）亮框，槽位上方 12px 画同色剩余时间条。
//    两态都叠「圆形背景底盘（WEAPON_BG_ASSET）」+「武器图案（原色）」。
//    t = 秒，驱动设计稿武器与背景盘的旋转元素（动态）──
export function drawTempWeaponSlot(g, x, y, size, { design, active, remainRatio = 0, color = '#ffffff', t = 0 } = {}) {
  if (!design) {                              // 无武器（或武器外观未加载）：空槽位框
    drawItemSlotFrame(g, x, y, size, { filled: false });
    return;
  }
  const half = size / 2;
  g.fillStyle(active ? 0xffffff : 0x000000, 1);        // 使用中 → 白底；未使用 → 黑底
  g.fillRoundedRect(x - half, y - half, size, size, SLOT_CORNER);
  g.lineStyle(3, active ? hexToInt(color) : 0xffffff, 1);   // 使用中 → 武器色亮框；未使用 → 白框
  g.strokeRoundedRect(x - half, y - half, size, size, SLOT_CORNER);
  const bg = getDesign(WEAPON_BG_ASSET);                 // 圆形背景底盘：两态（含使用中）都渲染
  if (bg) drawDesignCentered(g, bg, x, y, size * 0.82, t);
  drawDesignCentered(g, design, x, y, size * 0.62, t);   // 武器图案保持原色（两态一致）
  if (active) {
    const ratio = clamp01(remainRatio);       // 上方剩余时间条（宽 = 槽宽 × 剩余比例）
    if (ratio > 0) {
      const barY = y - half - TEMP_TIME_BAR_GAP - TEMP_TIME_BAR_H;
      g.fillStyle(hexToInt(color), 1);
      g.fillRect(x - half, barY, size * ratio, TEMP_TIME_BAR_H);
    }
  }
}

// ── 90° 扇环填充（多边形近似，rIn=0 退化为扇形）：Graphics 无原生扇环，逐点连线 + fillPath ──
function fillSector(g, cx, cy, rIn, rOut, a0, a1, colorInt, alpha, segs = 24) {
  const inner = Math.max(0, rIn);
  const pts = [];
  for (let i = 0; i <= segs; i++) { const a = a0 + (a1 - a0) * (i / segs); pts.push([cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut]); }
  if (inner > 0.01) for (let i = segs; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / segs); pts.push([cx + Math.cos(a) * inner, cy + Math.sin(a) * inner]); }
  g.fillStyle(colorInt, alpha);
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillPath();
}

// ── 药水选择轮盘：全屏蒙层 + 4 扇区图标 + 悬停灰色扇环 + 分隔线 + 中心死区叉号。
//    scale 以圆心为中心缩放（半径 / 图标尺寸 / 偏移全部乘 scale），alpha 为整体透明度，
//    hoverFade 为悬停蒙层自身的渐显系数（0~1，由调用方按切换时间推进）──
export function drawPotionWheel(g, entries, hoverIndex, alpha, scale = 1, hoverFade = 1) {
  const a = Number(alpha) || 0;
  if (a <= 0) return;
  const s = Number(scale) > 0 ? Number(scale) : 1;
  const cx = WHEEL_CX, cy = WHEEL_CY;
  const list = Array.isArray(entries) ? entries.slice(0, 4) : [];
  const count = list.length;
  const hover = hoverIndex >= 0 && hoverIndex < count ? hoverIndex : -1;

  // 全屏黑色蒙层（alpha 0.5 × 轮盘 alpha）
  g.fillStyle(0x000000, 0.5 * a);
  g.fillRect(0, 0, VIEW_W, VIEW_H);

  // 悬停扇区：径向**线性**渐变（最内侧 WHEEL_HOVER_ALPHA_IN → 最外侧 WHEEL_HOVER_ALPHA_OUT）。
  // 用 WHEEL_HOVER_RINGS 层细密同心扇环逐层插值近似，避免分层跳变；每层再乘 hoverFade 做渐显。
  if (hover >= 0) {
    const hf = clamp01(hoverFade) * a;
    const a0 = (hover * 90 - 135) * DEG, a1 = (hover * 90 - 45) * DEG;
    const R = WHEEL_RING_R * s;
    const step = R / WHEEL_HOVER_RINGS;
    for (let i = 0; i < WHEEL_HOVER_RINGS; i++) {
      const r0 = i * step, r1 = r0 + step;
      const mid = (r0 + r1) / 2 / R;
      const alphaMid = WHEEL_HOVER_ALPHA_IN + (WHEEL_HOVER_ALPHA_OUT - WHEEL_HOVER_ALPHA_IN) * mid;
      fillSector(g, cx, cy, r0, r1, a0, a1, 0xCFCFCF, alphaMid * hf, 10);
    }
  }

  // 4 条 45° 分隔射线（从圆心向外，白色）
  g.lineStyle(WHEEL_LINE_W * s, 0xffffff, a);
  for (let i = 0; i < 4; i++) {
    const ang = (45 + i * 90) * DEG;
    g.lineBetween(cx, cy, cx + Math.cos(ang) * WHEEL_LINE_LEN * s, cy + Math.sin(ang) * WHEEL_LINE_LEN * s);
  }

  // 每个药水：半径 WHEEL_RADIUS 处黑底圆 + 白色图标（无边框）
  const iconR = (WHEEL_ICON_SIZE / 2) * s;
  for (let i = 0; i < count; i++) {
    const p = wheelIconPos(i, s);
    const ix = p.x, iy = p.y;
    g.fillStyle(0x000000, a);
    g.fillCircle(ix, iy, iconR);
    const e = list[i];
    const design = e?.artType && e?.artName ? getArtRef(e.artType, e.artName) : null;
    if (design) drawDesignCentered(g, whiteVariant(design), ix, iy, WHEEL_ICON_SIZE * 0.66 * s, 0);
    else { g.fillStyle(0xffffff, a); g.fillCircle(ix, iy, iconR * 0.4); }   // 图标未加载：白圆占位
  }

  // 圆心死区：黑底白边圆 + 白色叉号（臂长 24）
  const dz = WHEEL_DEAD_ZONE * s;
  g.fillStyle(0x000000, a);
  g.fillCircle(cx, cy, dz);
  g.lineStyle(3, 0xffffff, a);
  g.strokeCircle(cx, cy, dz);
  const arm = 24 * s;
  g.lineStyle(4, 0xffffff, a);
  g.lineBetween(cx - arm, cy - arm, cx + arm, cy + arm);
  g.lineBetween(cx - arm, cy + arm, cx + arm, cy - arm);
}

// ── 状态图标（世界层，玩家左下角白色小图标）：按列填（先第一列自上而下、再第二列），最多 8 个 ──
export function drawBattleStatusIcons(g, player, effects) {
  if (!player) return;
  const list = Array.isArray(effects) ? effects.slice(0, STATUS_COLS * STATUS_ROWS) : [];
  const half = STATUS_ICON / 2;
  for (let i = 0; i < list.length; i++) {
    const col = Math.floor(i / STATUS_ROWS), row = i % STATUS_ROWS;
    const ix = player.x + STATUS_ORIGIN.x + col * STATUS_PITCH + half;
    const iy = player.y + STATUS_ORIGIN.y + row * STATUS_PITCH + half;
    const e = list[i];
    const design = e?.artType && e?.artName ? getArtRef(e.artType, e.artName) : null;
    if (design) drawDesignCentered(g, whiteVariant(design), ix, iy, STATUS_ICON, 0);
    else { g.fillStyle(0xffffff, 1); g.fillCircle(ix, iy, half * 0.5); }    // 图标未加载：白圆占位
  }
}
