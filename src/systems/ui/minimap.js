/**
 * 文件职责：多箱庭关卡小地图（左上角固定视窗 + 玩家居中 + 世界滚动 + 每格标记）
 * 归属分类：UI交互
 * 主要导出：MinimapMixin（drawMinimap / hideMinimapOverlay）
 * 依赖：systems/constants.js、rooms.js、state.js、systems/art/design-store.js、systems/art/asset-render.js
 */
import Phaser from 'phaser';
import { FONT_TECH_SC } from '../constants.js';
import { generateRoomLayout } from '../../rooms.js';
import { MINIMAP_MARKER_LABELS } from '../../state.js';
import { getDesign, ensureDesigns } from '../art/design-store.js';
import { renderAsset, designRadius } from '../art/asset-render.js';

// 小地图视窗布局常量（左上角区域当前空闲）
const MM_X = 16, MM_Y = 16;          // 视窗左上角（UI 坐标）
const MM_VIEW_W = 480 * 0.85, MM_VIEW_H = 270;  // 视窗固定尺寸，宽度短 15% 避免遮 boss 血条
const MM_CELL = 80;                  // 箱庭正方形边长（统一，大小差异不体现）
const MM_GAP = 45;                   // 箱庭间连线（通道）长度
const MM_BG = 0x000000;              // 视窗底色（黑底）
const MM_CELL_BG = 0x0a0a0a;         // 箱庭格子内部（黑底，与箱庭同款）
const MM_BORDER = 0xffffff;          // 箱子白框 / 视窗白框（箱庭同款）
const MM_FRAME_W = 12;               // 视窗白框线宽
const MM_CHANNEL = 0x808080;         // 箱庭间通道（灰）
const MM_CHANNEL_W = 28;             // 通道宽
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
    if (!visible || !this.player) {
      this.minimapContentG?.clear?.();
      this.minimapFrameG?.clear?.();
      this.hideMinimapOverlay();
      return;
    }

    // 持久 mask 对象（视窗裁剪，参照 screens.js shopCard 模式；一次性建立，mask 源每帧刷新）
    if (!this.minimapMaskG) {
      this.minimapMaskG = this.add.graphics().setDepth(999);
      this.minimapMask = new Phaser.Display.Masks.GeometryMask(this, this.minimapMaskG);
      this.cameras.main.ignore(this.minimapMaskG);
      this.minimapContentG = this.add.graphics().setDepth(1001);
      this.minimapContentG.setMask(this.minimapMask);
      this.cameras.main.ignore(this.minimapContentG);
      this.minimapFrameG = this.add.graphics().setDepth(1003);
      this.cameras.main.ignore(this.minimapFrameG);
    }
    // 刷新 mask 源 = 视窗区域
    this.minimapMaskG.clear();
    this.minimapMaskG.fillStyle(0xffffff, 0);
    this.minimapMaskG.fillRect(MM_X, MM_Y, MM_VIEW_W, MM_VIEW_H);

    this.minimapTexts = this.minimapTexts || new Map();
    // 先全隐再按需显示（防跨帧残留）
    this.hideMinimapOverlay();
    const ensure = (id, size, color) => {
      let t = this.minimapTexts.get(id);
      if (!t) {
        t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1002);
        this.cameras.main.ignore(t);          // 双相机 ignore：避免主相机残影双份
        if (this.minimapMask) t.setMask(this.minimapMask);
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

    const cg = this.minimapContentG;
    const fg = this.minimapFrameG;
    cg.clear();
    fg.clear();

    // 视窗中心（屏幕坐标）
    const centerX = MM_X + MM_VIEW_W / 2, centerY = MM_Y + MM_VIEW_H / 2;

    // 玩家小地图世界坐标（所属箱庭内的相对位置）
    // 玩家小地图世界坐标：箱庭内用所属箱庭映射；在通道/间隙时用相邻两箱庭参考系线性融合，
    // 使玩家穿越箱庭边界与世界坐标切换时小地图位置连续，不跳变。
    const p = this.player;
    const refOf = rm => ({
      x: rm.c * (MM_CELL + MM_GAP) + (p.x - rm.x) / rm.w * MM_CELL,
      y: rm.r * (MM_CELL + MM_GAP) + (p.y - rm.y) / rm.h * MM_CELL
    });
    const inBox = rooms.find(rm => p.x >= rm.x && p.x <= rm.x + rm.w && p.y >= rm.y && p.y <= rm.y + rm.h);
    const playerPt = (() => {
      if (inBox) return refOf(inBox);
      // 玩家在道路/间隙：取最近箱庭 A，再取其相邻（上下左右）中距玩家最近者 B
      let A = null, best = Infinity;
      for (const rm of rooms) {
        const d = (rm.x + rm.w / 2 - p.x) ** 2 + (rm.y + rm.h / 2 - p.y) ** 2;
        if (d < best) { best = d; A = rm; }
      }
      let B = null, bBest = Infinity;
      for (const rm of rooms) {
        if (rm === A) continue;
        if (Math.abs(rm.c - A.c) + Math.abs(rm.r - A.r) !== 1) continue;
        const d = (rm.x + rm.w / 2 - p.x) ** 2 + (rm.y + rm.h / 2 - p.y) ** 2;
        if (d < bBest) { bBest = d; B = rm; }
      }
      if (!B) return refOf(A);
      // 玩家沿 A→B 中心连线投影得 u∈[0,1]，按 u 线性融合两箱庭参考系坐标（保证两端各自连续）
      const ax = A.x + A.w / 2, ay = A.y + A.h / 2;
      const bx = B.x + B.w / 2, by = B.y + B.h / 2;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy || 1;
      const u = Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
      const ra = refOf(A), rb = refOf(B);
      return { x: ra.x + (rb.x - ra.x) * u, y: ra.y + (rb.y - ra.y) * u };
    })();
    const playerWX = playerPt.x;
    const playerWY = playerPt.y;

    // 世界坐标 → 视窗屏幕坐标（玩家恒定在视窗中心）
    const toSX = wx => centerX + (wx - playerWX);
    const toSY = wy => centerY + (wy - playerWY);
    const worldX = rm => rm.c * (MM_CELL + MM_GAP);
    const worldY = rm => rm.r * (MM_CELL + MM_GAP);

    // 1. 视窗黑底
    cg.fillStyle(MM_BG, 0.9);
    cg.fillRect(MM_X, MM_Y, MM_VIEW_W, MM_VIEW_H);

    // 2. 箱庭间通道（灰）：画在格子下层，连接相邻箱庭的边缘开口
    const keySet = new Set(rooms.map(rm => `${rm.c},${rm.r}`));
    cg.fillStyle(MM_CHANNEL, 1);
    for (const rm of rooms) {
      const gx = toSX(worldX(rm)), gy = toSY(worldY(rm));
      // 右邻：横向通道
      if (keySet.has(`${rm.c + 1},${rm.r}`)) {
        cg.fillRect(toSX(worldX(rm) + MM_CELL), gy + (MM_CELL - MM_CHANNEL_W) / 2, MM_GAP, MM_CHANNEL_W);
      }
      // 下邻：纵向通道
      if (keySet.has(`${rm.c},${rm.r + 1}`)) {
        cg.fillRect(gx + (MM_CELL - MM_CHANNEL_W) / 2, toSY(worldY(rm) + MM_CELL), MM_CHANNEL_W, MM_GAP);
      }
    }

    // 3. 每个箱庭格子（黑底白框直角，箱庭同款）+ 标记
    for (const rm of rooms) {
      const sx = toSX(worldX(rm)), sy = toSY(worldY(rm));
      const cx = sx + MM_CELL / 2, cy = sy + MM_CELL / 2;
      cg.fillStyle(MM_CELL_BG, 1);
      cg.fillRect(sx, sy, MM_CELL, MM_CELL);
      cg.lineStyle(1.5, MM_BORDER, 1);
      cg.strokeRect(sx, sy, MM_CELL, MM_CELL);

      // 未知房间：未进入前以「未知」占位，不提前暴露内容/标记；进入揭示后显示真实标记
      const revealA = (rm.type === 'unknown') ? this.roomRevealAlpha(rm.x + rm.w / 2, rm.y + rm.h / 2) : 1;
      if (revealA <= 0) {
        ensure(`mm_unknown_${rm.c}_${rm.r}`, MM_TEXT_SIZE, MM_TEXT_COLOR)
          .setOrigin(0.5).setPosition(cx, cy).setText('未知');
        continue;
      }
      const marker = rm.marker;
      if (!marker) continue;
      const icon = marker.icon;
      const design = icon ? getDesign(icon) : null;
      if (design) {
        // 画板动态资产：归一化到格子内（中心对齐，留边距）
        renderAsset(cg, design, cx, cy, this.time.now, (MM_CELL - 12) / designRadius(design));
      } else {
        // 无 icon / 未加载完成：中文文字占位
        const label = MINIMAP_MARKER_LABELS[marker.type];
        if (label) {
          ensure(`mm_${rm.c}_${rm.r}`, MM_TEXT_SIZE, MM_TEXT_COLOR)
            .setOrigin(0.5).setPosition(cx, cy).setText(label);
        }
      }
    }

    // 4. 玩家位置白点（恒定在视窗中心）
    cg.fillStyle(0xffffff, 1);
    cg.fillCircle(centerX, centerY, 6);          // 白圆
    cg.fillStyle(MM_BG, 1);
    cg.fillCircle(centerX, centerY, 2);          // 中心暗点

    // 5. 视窗白色边框（直角、无圆角），画在最上层
    fg.lineStyle(MM_FRAME_W, MM_BORDER, 1);
    fg.strokeRect(MM_X, MM_Y, MM_VIEW_W, MM_VIEW_H);
  },

  hideMinimapOverlay() {
    if (this.minimapTexts) {
      for (const t of this.minimapTexts.values()) t.setVisible(false);
    }
  },
};
