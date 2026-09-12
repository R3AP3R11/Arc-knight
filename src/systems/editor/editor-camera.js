/**
 * 文件职责：编辑器 / 试玩相机控制（世界与视口尺寸、缩放适配、滚轮、试玩跟随、编辑器视图钳制）
 * 归属分类：引擎(编辑器)需求
 * 主要导出：EditorCameraMixin（18 个方法）
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
      // 运镜过场期间让权：不覆写相机，交由 _stepCutscene 驱动
      if (this.cinematicActive) return;
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

  // ── 运镜过场（Cinematic / Cutscene 播放器）──
    // 按 id 从关卡运镜定义表查询并播放；找不到则无操作并告警。
    playCutsceneById(id, opts = {}) {
      const clip = this.ctx?.state?.level?.cinematics?.find(c => c.id === id);
      if (!clip) {
        console.warn(`[cutscene] 未找到运镜定义: ${id}`);
        return;
      }
      this.playCutscene(clip, opts);
    },

    // 核心运镜播放器：仅试玩/播放模式生效；编辑器模式告警并 no-op。
    // 通过 this.time.addEvent(loop) 驱动 _stepCutscene，避免与 updatePlayCamera 抢帧。
    playCutscene(clip, opts = {}) {
      const mode = this.ctx?.state?.mode;
      if (mode !== 'play' && mode !== 'trial') {
        console.warn(`[cutscene] 仅试玩/播放模式可运镜，当前模式: ${mode}`);
        return;
      }
      if (!clip) { console.warn('[cutscene] 运镜定义为空'); return; }

      // 清理可能残留的运镜计时器（不触发 onComplete / setupPlayCamera）
      if (this.cinematicTimer) { this.cinematicTimer.remove(); this.cinematicTimer = null; }
      this.cinematicActive = false;

      const cam = this.cameras.main;
      // 保存运镜前的相机状态，便于结束恢复。
      const prev = { zoom: cam.zoomX, scrollX: cam.scrollX, scrollY: cam.scrollY, rotation: cam.rotation };

      // 全屏黑色蒙层（叠加层：setScrollFactor(0) 固定于视口，depth 极高）。
      if (!this.cinematicFade) {
        this.cinematicFade = this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0)
          .setOrigin(0, 0).setScrollFactor(0).setDepth(9999);
      } else {
        this.cinematicFade.setSize(cam.width, cam.height);
        this.cinematicFade.setFillStyle(0x000000, 0);
      }
      this.cinematicFade.setVisible(true);

      // 关键帧按 t 升序排序，并补齐默认值（zoom=1 / pan=0 / rotation=0 / alpha=0 / ease='linear'）。
      const kfs = (clip.keyframes || []).slice().sort((a, b) => a.t - b.t).map(kf => ({
        zoom: kf.zoom ?? 1, panX: kf.panX ?? 0, panY: kf.panY ?? 0,
        rotation: kf.rotation ?? 0, alpha: kf.alpha ?? 0, ease: kf.ease ?? 'linear', t: kf.t,
      }));
      if (!kfs.length) { // 无关键帧：直接结束并恢复。
        this.stopCutscene(opts);
        return;
      }

      this.cinematicActive = true;
      this.cinematicClip = clip;
      this.cinematicKfs = kfs;
      this.cinematicStart = this.time.now;
      this.cinematicPrev = prev;
      this.cinematicOpts = opts;
      this.cinematicFocus = this._resolveFocusTarget(opts.focusTarget, opts);
      this.cinematicTimeScale = (clip.timeScale ?? 1) || 1;

      // 立即应用首个关键帧视觉，随后由计时器推进。
      this._applyCutsceneState(this._cutsceneStateAt(0));
      this.cinematicTimer = this.time.addEvent({
        delay: 16, loop: true, callback: () => this._stepCutscene(),
      });
    },

    // 解析运镜动态目标：opts.x/y 直接坐标 > focusTarget==='boss' 取当前激活 BOSS 坐标 > null。
    _resolveFocusTarget(target, opts = {}) {
      if (opts.x != null && opts.y != null) return { x: opts.x, y: opts.y };
      if (target === 'boss') {
        const boss = this.bossTarget
          || (this.enemies || []).find(e => (e.type === 'mothership' || e.type === 'boss-2-5t5') && e.bossActive);
        if (boss) return { x: boss.x, y: boss.y };
      }
      return null;
    },

    // 运镜推进（由 time 计时器每帧回调）：按 time.now 线性推进插值。
    _stepCutscene() {
      if (!this.cinematicActive) {
        if (this.cinematicTimer) { this.cinematicTimer.remove(); this.cinematicTimer = null; }
        return;
      }
      const kfs = this.cinematicKfs || [];
      if (!kfs.length) { this.stopCutscene(this.cinematicOpts || {}); return; }
      const T = this.time.now - this.cinematicStart;
      const dur = this.cinematicClip?.durationMs ?? kfs[kfs.length - 1].t ?? 0;
      if (T >= dur) { // 已结束：施加末帧，然后停止。
        this._applyCutsceneState(kfs[kfs.length - 1]);
        this.stopCutscene(this.cinematicOpts || {});
        return;
      }
      this._applyCutsceneState(this._cutsceneStateAt(T));
    },

    // 在时刻 T 求相邻关键帧插值。
    _cutsceneStateAt(T) {
      const kfs = this.cinematicKfs || [];
      if (!kfs.length) return null;
      let a = kfs[0], b = kfs[kfs.length - 1];
      for (let i = 0; i < kfs.length - 1; i++) {
        if (T >= kfs[i].t && T <= kfs[i + 1].t) { a = kfs[i]; b = kfs[i + 1]; break; }
      }
      const span = (b.t - a.t) || 1;
      const p = Phaser.Math.Clamp((T - a.t) / span, 0, 1);
      const eased = this._easeValue(a.ease || 'linear', p);
      const lerp = (v0, v1) => v0 + (v1 - v0) * eased;
      return {
        zoom: lerp(a.zoom, b.zoom),
        panX: lerp(a.panX, b.panX),
        panY: lerp(a.panY, b.panY),
        rotation: lerp(a.rotation, b.rotation),
        alpha: lerp(a.alpha, b.alpha),
      };
    },

    // 应用插值状态到相机与蒙层。
    _applyCutsceneState(s) {
      if (!s) return;
      const cam = this.cameras.main;
      let px = s.panX, py = s.panY;
      if (this.cinematicFocus) {           // 有动态目标 → pan 换算为镜头中心（视口左上角世界坐标）
        px = this.cinematicFocus.x - cam.width / 2;
        py = this.cinematicFocus.y - cam.height / 2;
      }
      cam.setZoom(s.zoom);
      cam.scrollX = px;
      cam.scrollY = py;
      cam.setRotation(Phaser.Math.DegToRad(s.rotation));
      if (this.cinematicFade) this.cinematicFade.setFillStyle(0x000000, s.alpha);
    },

    // 运镜结束 / 停止：撤销蒙层、清状态、恢复播放相机并回调。
    stopCutscene(opts = {}) {
      const cam = this.cameras.main;
      if (this.cinematicTimer) { this.cinematicTimer.remove(); this.cinematicTimer = null; }
      this.cinematicActive = false;
      if (this.cinematicFade) {
        this.cinematicFade.setFillStyle(0x000000, 0);
        this.cinematicFade.setVisible(false);
      }
      opts.onComplete?.();
      // 恢复播放态（setupPlayCamera 更稳），并清除运镜带来的旋转。
      cam.setRotation(0);
      this.setupPlayCamera();
      this.cinematicClip = null;
      this.cinematicKfs = null;
      this.cinematicOpts = null;
      this.cinematicPrev = null;
      this.cinematicFocus = null;
      this.cinematicTimeScale = 1;
    },

    // 缓动插值：linear / sine / quad / cubic（In / Out / InOut）。缺省线性。
    _easeValue(ease, t) {
      const E = Phaser.Math.Easing;
      const p = Phaser.Math.Clamp(t, 0, 1);
      switch (ease) {
        case 'sineIn': return E.Sine.In(p);
        case 'sineOut': return E.Sine.Out(p);
        case 'sineInOut': return E.Sine.InOut(p);
        case 'quadIn': return E.Quadratic.In(p);
        case 'quadOut': return E.Quadratic.Out(p);
        case 'quadInOut': return E.Quadratic.InOut(p);
        case 'cubicIn': return E.Cubic.In(p);
        case 'cubicOut': return E.Cubic.Out(p);
        case 'cubicInOut': return E.Cubic.InOut(p);
        case 'easeOut': return E.Sine.Out(p);
        case 'easeInOut': return E.Sine.InOut(p);
        case 'linear':
        default: return p;
      }
    },
};
