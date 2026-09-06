/**
 * 文件职责：编辑器 / 试玩相机控制（世界与视口尺寸、缩放适配、滚轮、试玩跟随、编辑器视图钳制）
 * 归属分类：引擎(编辑器)需求
 * 主要导出：EditorCameraMixin（11 个方法）
 * 依赖：phaser、systems/constants.js（ctx 经 this.ctx）
 */
import Phaser from 'phaser';
import { VIEW_W, VIEW_H } from '../constants.js';

export const EditorCameraMixin = {
  // ── 世界 / 视口尺寸 ──
    worldSize() {
    const ctx = this.ctx;
      const w = ctx.state.level.world;
      return { w: w.width, h: w.height };
    },

    cameraSize() {
    const ctx = this.ctx;
      const cw = ctx.state.level.camera.width;
      return { w: cw, h: Math.round(cw * VIEW_H / VIEW_W) };
    },

  // ── 边界与缩放 ──
    applyWorldBounds() {
      const { w, h } = this.worldSize();
      const x = this.player ? this.player.x : w / 2;
      const y = this.player ? this.player.y : h / 2;
      // 扩展边界，使玩家在中心模式下可在世界任意位置被镜头居中
      const pad = 2000;
      this.cameras.main.setBounds(Math.min(0, x - pad), Math.min(0, y - pad), w + pad * 2, h + pad * 2);
    },

    clampEditorView() {
      const cam = this.cameras.main;
      const { w, h } = this.worldSize();
      const cx = Phaser.Math.Clamp(cam.scrollX + VIEW_W / 2, -VIEW_W, w + VIEW_W);
      const cy = Phaser.Math.Clamp(cam.scrollY + VIEW_H / 2, -VIEW_H, h + VIEW_H);
      cam.scrollX = cx - VIEW_W / 2;
      cam.scrollY = cy - VIEW_H / 2;
    },

    showZoom() {
      const el = document.getElementById('zoomInfo');
      if (el) el.textContent = `${Math.round(this.cameras.main.zoomX * 100)}%`;
    },

    resetEditorCamera() {
      const cam = this.cameras.main;
      const { w, h } = this.worldSize();
      const fit = Math.min(VIEW_W / w, VIEW_H / h);
      const zoom = Phaser.Math.Clamp(Math.min(1, fit), 0.1, 1);
      cam.setZoom(zoom);
      cam.scrollX = w / 2 - VIEW_W / 2;
      cam.scrollY = h / 2 - VIEW_H / 2;
      this.clampEditorView();
      this.showZoom();
    },

    playZoom() {
      const { w: ww, h: wh } = this.worldSize();
      const c = this.cameraSize();
      return Math.min(VIEW_W / Math.min(c.w, ww), VIEW_H / Math.min(c.h, wh));
    },

  // ── 试玩跟随 ──
    centerCameraOnPlayer() {
      const cam = this.cameras.main;
      const z = this.playZoom();
      cam.setZoom(z);
      // Phaser4：scrollX = 视口左上角世界坐标，居中=目标 - 视口宽/2（不随 zoom 缩放）
      cam.scrollX = this.player.x - cam.width / 2;
      cam.scrollY = this.player.y - cam.height / 2;
    },

    setupPlayCamera() {
      const cam = this.cameras.main;
      cam.setZoom(this.playZoom());
      if (this.isMenuLevel()) {
        // 菜单关卡：镜头固定展示全图（与编辑器一致）
        cam.scrollX = 0;
        cam.scrollY = 0;
      } else {
        cam.scrollX = this.player.x - cam.width / 2;
        cam.scrollY = this.player.y - cam.height / 2;
      }
    },

    updatePlayCamera() {
    const ctx = this.ctx;
      const cam = this.cameras.main;
      // 蓄力武器（冥狙）：蓄力时视窗逐渐放大（最多+60%），发射后 0.6s 内恢复（chargeZoom 因子）
      const z = this.playZoom() * (this.chargeZoom || 1);
      cam.setZoom(z);

      if (this.isMenuLevel()) {
        // 菜单关卡：镜头固定展示全图（与编辑器一致）
        cam.scrollX = 0;
        cam.scrollY = 0;
        return;
      }

      if (ctx.state.level.camera.mode === 'center') {
        // 始终居中玩家
        cam.scrollX = this.player.x - cam.width / 2;
        cam.scrollY = this.player.y - cam.height / 2;
        return;
      }

      // deadzone 死区跟随（Phaser4：相机中心 = scroll + 视口/2，死区尺寸按可见世界算）
      const displayW = cam.width / z;
      const displayH = cam.height / z;
      const dzW = displayW / 3, dzH = displayH / 3;
      let cx = cam.scrollX + cam.width / 2;
      let cy = cam.scrollY + cam.height / 2;

      if (this.player.x < cx - dzW) cx = this.player.x + dzW;
      else if (this.player.x > cx + dzW) cx = this.player.x - dzW;
      if (this.player.y < cy - dzH) cy = this.player.y + dzH;
      else if (this.player.y > cy + dzH) cy = this.player.y - dzH;

      cam.scrollX = cam.clampX(cx - cam.width / 2);
      cam.scrollY = cam.clampY(cy - cam.height / 2);
    },

    onWheel(px, py, deltaY) {
      if (!this.editing) {
        if (this.menuScreen === 'workshop') {
          const up = this.uiPointer();
          const area = this.workshopScrollArea || { x: 544, y: 120, w: 1312, h: 440 };
          if (up.x >= area.x && up.x <= area.x + area.w && up.y >= area.y && up.y <= area.y + area.h) {
            const contentW = 5 * (280 + 24), viewW = 1312;
            const maxScroll = Math.max(0, contentW - viewW);
            if (this.workshopScroll == null) this.workshopScroll = 0;
            this.workshopScroll = Phaser.Math.Clamp(this.workshopScroll + (deltaY > 0 ? 40 : -40), 0, maxScroll);
            this.drawUI();
            return;
          }
          // 仓库纵向滚动
          const invArea = this.workshopInvScrollArea;
          if (invArea && up.x >= invArea.x && up.x <= invArea.x + invArea.w && up.y >= invArea.y && up.y <= invArea.y + invArea.h) {
            const maxScroll = this.workshopInvMaxScroll || 0;
            if (this.workshopInvScroll == null) this.workshopInvScroll = 0;
            this.workshopInvScroll = Phaser.Math.Clamp(this.workshopInvScroll + (deltaY > 0 ? 40 : -40), 0, maxScroll);
            this.drawUI();
            return;
          }
          return;
        }
        if (this.menuScreen === 'weapon') {
          const up = this.uiPointer();
          const area = this.shopScrollArea || { x: 540, y: 170, w: 1300, h: 720 };
          if (up.x >= area.x && up.x <= area.x + area.w && up.y >= area.y && up.y <= area.y + area.h) {
            const maxScroll = this.shopMaxScroll || 0;
            if (this.shopScroll == null) this.shopScroll = 0;
            this.shopScroll = Phaser.Math.Clamp(this.shopScroll + (deltaY > 0 ? 40 : -40), 0, maxScroll);
            this.drawUI();
          }
          return;
        }
        if (this.state === 'playing' && this.player?.weapons?.length > 1) {
          this.switchWeapon(deltaY > 0 ? 1 : -1);
        }
        return;
      }
      const cam = this.cameras.main;
      if (!cam || !cam.width) return;
      const ox = cam.width * cam.originX;
      const oy = cam.height * cam.originY;
      const z0 = cam.zoomX;
      const anchorX = cam.scrollX + ox + (px - ox) / z0;
      const anchorY = cam.scrollY + oy + (py - oy) / z0;
      const zoom = Phaser.Math.Clamp(z0 * (deltaY > 0 ? 0.9 : 1.1), 0.1, 4);
      cam.setZoom(zoom);
      cam.scrollX = anchorX - ox - (px - ox) / zoom;
      cam.scrollY = anchorY - oy - (py - oy) / zoom;
      this.clampEditorView();
      this.showZoom();
      this.draw();
    },
};
