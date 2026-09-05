/**
 * 文件职责：多箱庭关卡小地图（左上角等大箱庭网格 + 玩家白点 + 每格标记）
 * 归属分类：UI交互
 * 主要导出：MinimapMixin（drawMinimap / hideMinimapOverlay）
 * 依赖：systems/constants.js、rooms.js、state.js、systems/art/design-store.js、systems/art/asset-render.js
 */
import { FONT_TECH_SC } from '../constants.js';
import { generateRoomLayout } from '../../rooms.js';
import { MINIMAP_MARKER_LABELS } from '../../state.js';
import { getDesign, ensureDesigns } from '../art/design-store.js';
import { renderAsset, designRadius } from '../art/asset-render.js';

// 小地图布局常量（左上角区域当前空闲）
const MM_X = 16, MM_Y = 16;          // 面板左上角（UI 坐标）
const MM_CELL = 40;                  // 每格统一边长（箱庭大小差异不体现）
const MM_GAP = 10;                   // 格间距
const MM_PAD = 12;                   // 面板内边距
const MM_BG = 0x0e2233;              // 面板底色
const MM_PANEL_RADIUS = 10;          // 面板圆角
const MM_CELL_BG = 0x14293d;         // 格子底色
const MM_CELL_RADIUS = 4;            // 格子圆角
const MM_BORDER = 0x6fd3ff;          // 格子描边
const MM_TEXT_COLOR = '#eaf4fb';     // 标记文字颜色
const MM_TEXT_SIZE = '16px';

export const MinimapMixin = {
  drawMinimap(g) {
    const ctx = this.ctx;
    const layout = ctx.state.level?.roomLayout;

    // 仅多箱庭 + 非编辑 + 非菜单/结算/骑士之家时绘制，否则清空并 return
    const visible = layout?.mode === 'multi'
      && !this.editing
      && !this.menuScreen
      && !this.settingsMode
      && this.state !== 'end'
      && this.state !== 'fail'
      && !this.isHubLevel?.();
    if (!visible) {
      this.hideMinimapOverlay();
      return;
    }

    this.minimapTexts = this.minimapTexts || new Map();
    // 先全隐再按需显示（防跨帧残留）
    this.hideMinimapOverlay();
    const ensure = (id, size, color) => {
      let t = this.minimapTexts.get(id);
      if (!t) {
        t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1001);
        this.cameras.main.ignore(t);          // 双相机 ignore：避免主相机残影双份
        this.minimapTexts.set(id, t);
      }
      t.setVisible(true);
      return t;
    };

    // 首帧预载所有 icon（幂等）；加载完成前该格以文字占位，下一帧自动切图标
    const iconIds = [];
    for (const cell of (layout.cells || [])) {
      const icon = cell.marker?.icon;
      if (icon) iconIds.push(icon);
    }
    if (iconIds.length) ensureDesigns(iconIds);

    // 重跑纯函数拿 rooms（每个元素 { c, r, x, y, w, h, marker }，c/r 为相对 0 起行列号）
    const rooms = generateRoomLayout(layout).rooms;
    if (!rooms.length) return;
    const cols = Math.max(...rooms.map(rm => rm.c)) + 1;
    const rows = Math.max(...rooms.map(rm => rm.r)) + 1;

    // 面板尺寸：格子网格 + 间距 + 两侧内边距
    const panelW = cols * MM_CELL + (cols - 1) * MM_GAP + MM_PAD * 2;
    const panelH = rows * MM_CELL + (rows - 1) * MM_GAP + MM_PAD * 2;

    // 箱庭格子 → 小地图坐标
    const gxOf = rm => MM_X + MM_PAD + rm.c * (MM_CELL + MM_GAP);
    const gyOf = rm => MM_Y + MM_PAD + rm.r * (MM_CELL + MM_GAP);

    // 1. 半透明面板底
    g.fillStyle(MM_BG, 0.92);
    g.fillRoundedRect(MM_X, MM_Y, panelW, panelH, MM_PANEL_RADIUS);

    // 2. 每个箱庭格子（统一 MM_CELL）+ 标记
    for (const rm of rooms) {
      const gx = gxOf(rm), gy = gyOf(rm);
      const cx = gx + MM_CELL / 2, cy = gy + MM_CELL / 2;
      g.fillStyle(MM_CELL_BG, 1);
      g.fillRoundedRect(gx, gy, MM_CELL, MM_CELL, MM_CELL_RADIUS);
      g.lineStyle(1.5, MM_BORDER, 0.9);
      g.strokeRoundedRect(gx, gy, MM_CELL, MM_CELL, MM_CELL_RADIUS);

      const marker = rm.marker;
      if (!marker) continue;
      const icon = marker.icon;
      const design = icon ? getDesign(icon) : null;
      if (design) {
        // 画板动态资产：归一化到格子内（中心对齐，留 10px 边距）
        renderAsset(g, design, cx, cy, this.time.now, (MM_CELL - 10) / designRadius(design));
      } else {
        // 无 icon / 未加载完成：中文文字占位
        const label = MINIMAP_MARKER_LABELS[marker.type];
        if (label) {
          ensure(`mm_${rm.c}_${rm.r}`, MM_TEXT_SIZE, MM_TEXT_COLOR)
            .setOrigin(0.5).setPosition(cx, cy).setText(label);
        }
      }
    }

    // 3. 玩家位置白点（映射到所属箱庭格子内的相对位置）
    const p = this.player;
    if (p) {
      let owner = null;
      for (const rm of rooms) {
        if (p.x >= rm.x && p.x <= rm.x + rm.w && p.y >= rm.y && p.y <= rm.y + rm.h) { owner = rm; break; }
      }
      if (!owner) {
        // 玩家在道路/间隙：取矩形中心距玩家最近的箱庭
        let best = Infinity;
        for (const rm of rooms) {
          const d = Math.hypot((rm.x + rm.w / 2) - p.x, (rm.y + rm.h / 2) - p.y);
          if (d < best) { best = d; owner = rm; }
        }
      }
      if (owner) {
        const relX = Math.min(1, Math.max(0, (p.x - owner.x) / owner.w));
        const relY = Math.min(1, Math.max(0, (p.y - owner.y) / owner.h));
        const mapX = gxOf(owner) + relX * MM_CELL;
        const mapY = gyOf(owner) + relY * MM_CELL;
        g.fillStyle(0xffffff, 1);
        g.fillCircle(mapX, mapY, 6);          // 白圆
        g.fillStyle(MM_BG, 1);
        g.fillCircle(mapX, mapY, 2);          // 中心暗点
      }
    }
  },

  hideMinimapOverlay() {
    if (this.minimapTexts) {
      for (const t of this.minimapTexts.values()) t.setVisible(false);
    }
  },
};
