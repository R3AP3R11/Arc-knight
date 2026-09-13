/**
 * 文件职责：编辑器 / 试玩相机控制（世界与视口尺寸、缩放适配、滚轮、试玩跟随、编辑器视图钳制）
 * 归属分类：引擎(编辑器)需求
 * 主要导出：EditorCameraMixin（26 个方法）
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
          // 临时武器使用中：禁止滚轮切换主武器（否则会破坏临时武器的使用态）
          if (this.isTempWeaponActive?.()) return;
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

      // 全部运镜叠层（纯黑遮罩 / 上下黑边 / 暗角 / 色调 / 闪光）惰性创建并适配视口尺寸。
      this._ensureCinematicOverlays(cam);
      this.cinematicFade.setFillStyle(0x000000, 0);
      this.cinematicFade.setVisible(true);
      this._hideCinematicOverlays();

      // 关键帧按 t 升序排序，并补齐默认值（含关键帧级 timeScale 与叠层参数；颜色缺省 '#1a0a0a' / '#ffffff'）。
      const clipTimeScale = clip.timeScale ?? 1;
      const kfs = (clip.keyframes || []).slice().sort((a, b) => a.t - b.t).map(kf => ({
        zoom: kf.zoom ?? 1, panX: kf.panX ?? 0, panY: kf.panY ?? 0,
        rotation: kf.rotation ?? 0, alpha: kf.alpha ?? 0, ease: kf.ease ?? 'linear', t: kf.t,
        timeScale: kf.timeScale ?? clipTimeScale,
        vignette: kf.vignette ?? 0, letterbox: kf.letterbox ?? 0,
        tint: kf.tint ?? 0, tintColor: kf.tintColor ?? '#1a0a0a',
        flash: kf.flash ?? 0, flashColor: kf.flashColor ?? '#ffffff',
        desat: kf.desat ?? 0,
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
      // focus 解析优先级：opts.x/y（固定坐标）> opts.focusTarget > clip.focus；'none' / 空 → 无焦点。
      // cinematicFocusTarget 存需每帧重解析的动态目标（'player' / 'boss'）；cinematicFocus 存显式坐标或 null。
      this.cinematicFocus = null;
      this.cinematicFocusTarget = null;
      if (opts.x == null || opts.y == null) {
        const t = opts.focusTarget || clip.focus || null;
        if (t === 'player' || t === 'boss') this.cinematicFocusTarget = t;
      } else {
        this.cinematicFocus = { x: opts.x, y: opts.y };
      }
      this.cinematicTimeScale = clipTimeScale || 1;

      // 立即应用首个关键帧视觉，随后由计时器推进。
      this._applyCutsceneState(this._cutsceneStateAt(0));
      this.cinematicTimer = this.time.addEvent({
        delay: 16, loop: true, callback: () => this._stepCutscene(),
      });
    },

    // 解析运镜动态目标：opts.x/y 直接坐标 > 'boss' 取当前激活 BOSS 坐标 > 'player' 取玩家坐标 > null。
    _resolveFocusTarget(target, opts = {}) {
      if (opts.x != null && opts.y != null) return { x: opts.x, y: opts.y };
      if (target === 'boss') {
        const boss = this.bossTarget
          || (this.enemies || []).find(e => (e.type === 'mothership' || e.type === 'boss-2-5t5') && e.bossActive);
        if (boss) return { x: boss.x, y: boss.y };
      }
      if (target === 'player') {
        if (!this.player) return null;
        return { x: this.player.x, y: this.player.y };
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
        timeScale: lerp(a.timeScale ?? 1, b.timeScale ?? 1),
        vignette: lerp(a.vignette ?? 0, b.vignette ?? 0),
        letterbox: lerp(a.letterbox ?? 0, b.letterbox ?? 0),
        tint: lerp(a.tint ?? 0, b.tint ?? 0),
        flash: lerp(a.flash ?? 0, b.flash ?? 0),
        desat: lerp(a.desat ?? 0, b.desat ?? 0),
        // 颜色不插值：取所在段起点帧（a 帧）的颜色。
        tintColor: a.tintColor ?? '#1a0a0a',
        flashColor: a.flashColor ?? '#ffffff',
      };
    },

    // 应用插值状态到相机与全部叠层。
    _applyCutsceneState(s) {
      if (!s) return;
      const cam = this.cameras.main;
      let px = s.panX, py = s.panY;
      // 焦点：显式坐标（cinematicFocus）优先；动态目标（'player' / 'boss'）每帧重解析以跟随。
      const focus = this.cinematicFocus
        || (this.cinematicFocusTarget ? this._resolveFocusTarget(this.cinematicFocusTarget, {}) : null);
      if (focus) {                          // 有焦点 → pan 换算为镜头中心（视口左上角世界坐标）
        px = focus.x - cam.width / 2;
        py = focus.y - cam.height / 2;
      }
      cam.setZoom(s.zoom);
      cam.scrollX = px;
      cam.scrollY = py;
      cam.setRotation(Phaser.Math.DegToRad(s.rotation));
      // 关键帧级慢动作：每帧写入，供 game-scene 的 update 缩放 dt。
      this.cinematicTimeScale = (s.timeScale ?? 1) || 1;
      if (this.cinematicFade) this.cinematicFade.setFillStyle(0x000000, s.alpha);
      this._applyCinematicOverlays(s);
    },

    // 叠层对象惰性创建：全部 setScrollFactor(0) 固定于视口，尺寸随 cam.width / cam.height 适配。
    // 【根因】setScrollFactor(0) 只抵消相机滚动平移，不抵消 zoomX/zoomY 与 rotation
    // （TransformMatrix.copyWithScrollFactorFrom 原样复制含缩放/旋转的 a,b,c,d）。运镜 zoom 最高 4.2、
    // rotation 最高 20°，若这些叠层由主相机渲染会被放缩/旋转：zoom≥2 时上下黑边完全移出屏幕、
    // zoom=1.3 时上黑边只剩 ≈1.6% 屏高、zoom<1 时 tint/flash/vignette 四边露空、rotation≠0 时屏幕
    // 四角露出未覆盖三角（黑幕 cinematicFade 亦同时失守）。故叠层必须走屏幕空间相机 uiCam
    // （zoom 1 / rotation 0 / scroll 0）——与 UI 层 uiG 同一约定（ui-runtime.js setupUI）：
    // 主相机 ignore(叠层) 不画，由 uiCam 渲染所有未被显式 ignore 的对象；**切勿** uiCam.ignore(叠层)。
    // 保留 setScrollFactor(0)（无害且语义一致）与既有 depth（fade/letterbox/flash 9999、vignette/tint
    // 9998、desat 9997）；uiCam 亦渲染 uiG(1000)/结算文本(1001)，叠层 depth 远高，顺序正确。
    _ensureCinematicOverlays(cam) {
      if (!cam) return;
      // 纯黑遮罩（原有语义，depth 9999）
      if (!this.cinematicFade) {
        this.cinematicFade = this.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0)
          .setOrigin(0, 0).setScrollFactor(0).setDepth(9999).setVisible(false);
        if (this.uiCam) this.cameras.main.ignore(this.cinematicFade);   // 屏幕空间叠层：主相机不画，交 uiCam
      } else {
        this.cinematicFade.setSize(cam.width, cam.height);
      }
      // 上下黑边：顶部 origin(0,0) 贴 y=0，底部 origin(0,1) 贴 y=cam.height
      if (!this.cinematicLetterbox) {
        this.cinematicLetterbox = {
          top: this.add.rectangle(0, 0, cam.width, 1, 0x000000, 1)
            .setOrigin(0, 0).setScrollFactor(0).setDepth(9999).setVisible(false),
          bottom: this.add.rectangle(0, cam.height, cam.width, 1, 0x000000, 1)
            .setOrigin(0, 1).setScrollFactor(0).setDepth(9999).setVisible(false),
        };
        if (this.uiCam) {   // 屏幕空间叠层：主相机不画，交 uiCam
          this.cameras.main.ignore(this.cinematicLetterbox.top);
          this.cameras.main.ignore(this.cinematicLetterbox.bottom);
        }
      }
      // 暗角（贴图 / Graphics 降级，见 _createCinematicVignette）
      if (!this.cinematicVignette) {
        this.cinematicVignette = this._createCinematicVignette(cam);
        if (this.uiCam && this.cinematicVignette) this.cameras.main.ignore(this.cinematicVignette);   // 贴图 / Graphics 两路同规
      }
      if (this.cinematicVignette && this.cinematicVignette.setDisplaySize) {
        this.cinematicVignette.setDisplaySize(cam.width, cam.height);
      }
      // 色调叠加（depth 9998）
      if (!this.cinematicTint) {
        this.cinematicTint = this.add.rectangle(0, 0, cam.width, cam.height, 0x1a0a0a, 1)
          .setOrigin(0, 0).setScrollFactor(0).setDepth(9998).setVisible(false);
        if (this.uiCam) this.cameras.main.ignore(this.cinematicTint);   // 屏幕空间叠层：主相机不画，交 uiCam
      } else {
        this.cinematicTint.setSize(cam.width, cam.height);
      }
      // 闪光（depth 9999）
      if (!this.cinematicFlash) {
        this.cinematicFlash = this.add.rectangle(0, 0, cam.width, cam.height, 0xffffff, 1)
          .setOrigin(0, 0).setScrollFactor(0).setDepth(9999).setVisible(false);
        if (this.uiCam) this.cameras.main.ignore(this.cinematicFlash);   // 屏幕空间叠层：主相机不画，交 uiCam
      } else {
        this.cinematicFlash.setSize(cam.width, cam.height);
      }
    },

    // 暗角对象：优先 Canvas 径向渐变贴图（textures.createCanvas + refresh）拉伸满屏；
    // 若运行时无 createCanvas / 创建或取上下文抛错，则降级为 Graphics 多层同心矩形描边近似。绝不抛错。
    _createCinematicVignette(cam) {
      try {
        if (this.textures && typeof this.textures.createCanvas === 'function') {
          const key = 'cinematic-vignette';
          if (!this.textures.exists(key)) {
            const tex = this.textures.createCanvas(key, 64, 64);
            const c2d = (tex && tex.getContext) ? tex.getContext() : null;
            if (c2d) {
              const grad = c2d.createRadialGradient(32, 32, 6, 32, 32, 32);
              grad.addColorStop(0, 'rgba(0,0,0,0)');
              grad.addColorStop(0.6, 'rgba(0,0,0,0.45)');
              grad.addColorStop(1, 'rgba(0,0,0,0.95)');
              c2d.fillStyle = grad;
              c2d.fillRect(0, 0, 64, 64);
              tex.refresh();
            }
          }
          if (this.textures.exists(key)) {
            return this.add.image(0, 0, key)
              .setOrigin(0, 0).setScrollFactor(0).setDepth(9998).setVisible(false)
              .setDisplaySize(cam.width, cam.height);
          }
        }
      } catch (err) {
        console.warn('[cutscene] 暗角贴图不可用，降级为 Graphics 近似:', err);
      }
      // 降级：多层同心矩形描边，外圈浓、内圈淡（尺寸按创建时视口取；Graphics 无 setDisplaySize）
      const gfx = this.add.graphics().setScrollFactor(0).setDepth(9998).setVisible(false);
      const minSide = Math.min(cam.width, cam.height);
      const rings = 6;
      for (let i = 0; i < rings; i++) {
        const d = i / (rings - 1);             // 0 = 外圈（最浓）→ 1 = 内圈（最淡）
        const inset = d * minSide * 0.22;
        gfx.lineStyle(Math.max(2, minSide * 0.05), 0x000000, 0.6 * (1 - d) * (1 - d) + 0.05);
        gfx.strokeRect(inset, inset, cam.width - inset * 2, cam.height - inset * 2);
      }
      return gfx;
    },

    // 每帧应用运镜叠层：对应值为 0 时 setVisible(false)，>0 时更新参数。
    _applyCinematicOverlays(s) {
      if (!s) return;
      const cam = this.cameras.main;
      this._ensureCinematicOverlays(cam);

      // 暗角
      const vig = Phaser.Math.Clamp(s.vignette ?? 0, 0, 1);
      if (this.cinematicVignette) this.cinematicVignette.setAlpha(vig).setVisible(vig > 0);

      // 上下黑边（1 = 上下各 12.5% 屏高）
      const lb = Phaser.Math.Clamp(s.letterbox ?? 0, 0, 1);
      const lbH = cam.height * 0.125 * lb;
      if (this.cinematicLetterbox) {
        const on = lbH > 0.5;
        this.cinematicLetterbox.top.setSize(cam.width, lbH).setPosition(0, 0).setVisible(on);
        this.cinematicLetterbox.bottom.setSize(cam.width, lbH).setPosition(0, cam.height).setVisible(on);
      }

      // 闪光
      const flash = Phaser.Math.Clamp(s.flash ?? 0, 0, 1);
      if (this.cinematicFlash) {
        this.cinematicFlash.setFillStyle(this._hexToInt(s.flashColor, 0xffffff), 1);
        this.cinematicFlash.setAlpha(flash * 0.8).setVisible(flash > 0);
      }

      // 色调叠加（基础权重 0.55）
      const tint = Phaser.Math.Clamp(s.tint ?? 0, 0, 1);
      const desat = Phaser.Math.Clamp(s.desat ?? 0, 0, 1);
      let tintAlpha = tint * 0.55;
      if (this.cinematicTint) this.cinematicTint.setFillStyle(this._hexToInt(s.tintColor, 0x1a0a0a), 1);

      // 去饱和（真实生效）：按渲染器能力三选一，探测结果缓存于 _cinematicDesatFX / _cinematicDesatBlend。
      //  ① WebGL：Phaser 4.2.1 的相机色彩矩阵入口是 cam.filters.internal.addColorMatrix()
      //     （node_modules/phaser/src/gameobjects/components/FilterList.js:364），返回
      //     Phaser.Filters.ColorMatrix 控制器，写值用 controller.colorMatrix.grayscale(0~1)
      //     （src/filters/ColorMatrix.js 类注释示例 + node_modules/phaser/types/phaser.d.ts:18696
      //     `addColorMatrix(): Phaser.Filters.ColorMatrix;`；src/display/ColorMatrix.js:280
      //     grayscale(v) → saturate(-v)，v=1 全灰、v=0 恒等）。相机滤镜只由 WebGL 渲染节点消费
      //     （src/renderer/webgl/renderNodes/Camera.js:138）。
      //  ② Canvas：本项目 game config 为 Phaser.CANVAS（src/editor/level-flow.js:77），CanvasRenderer
      //     无相机滤镜实现（src/renderer/canvas/** 里无 filters 消费点）→ 走「中性灰 +
      //     BlendModes.SATURATION」叠加矩形：Canvas2D 混合规范下源饱和度（灰=0）按源 alpha 加权
      //     混合目标，故 alpha=desat 即等价于「按比例真实去饱和」（SetTransform.js:48 写
      //     globalCompositeOperation，GetBlendModes.js:40 映射 'saturation'；
      //     BlendModes.SATURATION 注释即「For Canvas only」）。
      //  ③ 两条路都不可用 → 保持原 fallback：用 tint 权重叠一点做近似褪色。绝不抛错。
      if (desat > 0) {
        if (this._cinematicDesatFX === undefined) {
          this._cinematicDesatFX = null;       // null = 无可用相机滤镜；对象 = 已挂上的 ColorMatrix 控制器
          this._cinematicDesatBlend = false;   // true = 可走 Canvas 'saturation' 合成叠加
          try {
            const renderer = this.game ? this.game.renderer : null;
            const internal = cam.filters ? cam.filters.internal : null;
            if (renderer && renderer.type === Phaser.WEBGL
              && internal && typeof internal.addColorMatrix === 'function') {
              this._cinematicDesatFX = internal.addColorMatrix();
            } else if (renderer && renderer.blendModes
              && renderer.blendModes[Phaser.BlendModes.SATURATION] === 'saturation') {
              this._cinematicDesatBlend = true;
            }
          } catch (err) {
            this._cinematicDesatFX = null;
            this._cinematicDesatBlend = false;
          }
        }
        if (this._cinematicDesatFX) {
          try { this._cinematicDesatFX.colorMatrix.grayscale(desat); }
          catch (err) { this._cinematicDesatFX = null; }
        }
        if (!this._cinematicDesatFX && this._cinematicDesatBlend) {
          // Canvas 路径：惰性创建灰色叠加矩形（仅此路径需要，WebGL 下不分配）
          if (!this.cinematicDesat) {
            this.cinematicDesat = this.add.rectangle(0, 0, cam.width, cam.height, 0x808080, 1)
              .setOrigin(0, 0).setScrollFactor(0).setDepth(9997)
              .setBlendMode(Phaser.BlendModes.SATURATION).setVisible(false);
            if (this.uiCam) this.cameras.main.ignore(this.cinematicDesat);   // 屏幕空间叠层：主相机不画，交 uiCam
          }
          this.cinematicDesat.setSize(cam.width, cam.height).setAlpha(desat).setVisible(true);
        } else if (!this._cinematicDesatFX) {
          tintAlpha = Math.min(1, tintAlpha + desat * 0.3); // fallback：无相机灰度入口也无饱和度合成
        }
      } else {
        if (this.cinematicDesat) this.cinematicDesat.setVisible(false);
        if (this._cinematicDesatFX) {
          try { this._cinematicDesatFX.colorMatrix.grayscale(0); }
          catch (err) { this._cinematicDesatFX = null; }
        }
      }

      if (this.cinematicTint) this.cinematicTint.setAlpha(tintAlpha).setVisible(tintAlpha > 0.01);
    },

    // 隐藏除纯黑遮罩外的全部运镜叠层。
    _hideCinematicOverlays() {
      if (this.cinematicLetterbox) {
        this.cinematicLetterbox.top.setVisible(false);
        this.cinematicLetterbox.bottom.setVisible(false);
      }
      if (this.cinematicVignette) this.cinematicVignette.setVisible(false);
      if (this.cinematicTint) this.cinematicTint.setVisible(false);
      if (this.cinematicFlash) this.cinematicFlash.setVisible(false);
      if (this.cinematicDesat) this.cinematicDesat.setVisible(false);
    },

    // 隐藏纯黑遮罩 + 全部叠层（供调用方在结算页自绘完成后调用）。
    hideCinematicFade() {
      this._hideCinematicOverlays();
      if (this.cinematicFade) {
        this.cinematicFade.setFillStyle(0x000000, 0);
        this.cinematicFade.setVisible(false);
      }
    },

    // 运镜期间是否锁定玩家输入（供 game-scene.js 查询）。
    cinematicInputLocked() {
      return !!this.cinematicActive;
    },

    // 颜色（'#rrggbb' 或数值）→ 0xRRGGBB 整数；非法值返回 fallback。
    _hexToInt(color, fallback = 0xffffff) {
      const n = typeof color === 'number'
        ? color
        : parseInt(String(color == null ? '' : color).replace('#', ''), 16);
      return Number.isFinite(n) ? n : fallback;
    },

    // 运镜结束 / 停止：撤销叠层、清状态、恢复播放相机并回调。
    // opts.holdBlack=true：保留纯黑遮罩（调用方在结算页自绘）且不调 setupPlayCamera；其余状态照常清理。
    stopCutscene(opts = {}) {
      const cam = this.cameras.main;
      if (this.cinematicTimer) { this.cinematicTimer.remove(); this.cinematicTimer = null; }
      this.cinematicActive = false;
      const holdBlack = !!opts.holdBlack;
      if (holdBlack) {
        this._hideCinematicOverlays();
        if (this.cinematicFade) {           // 保持纯黑可见
          this.cinematicFade.setFillStyle(0x000000, 1);
          this.cinematicFade.setVisible(true);
        }
      } else {
        this.hideCinematicFade();
      }
      // 去饱和复位：① 相机色矩阵写回恒等并从过滤器列表移除（移除同时销毁，避免残留的
      // 相机滤镜让 WebGL 每帧多走一次 framebuffer 合成），② Canvas 灰度叠加矩形已由
      // hideCinematicFade / _hideCinematicOverlays 隐藏，③ 两个探测缓存清空，允许下次运镜重新探测。
      if (this._cinematicDesatFX) {
        try {
          this._cinematicDesatFX.colorMatrix.grayscale(0);
          if (cam.filters && cam.filters.internal) cam.filters.internal.remove(this._cinematicDesatFX);
        } catch (err) { /* noop */ }
      }
      this._cinematicDesatFX = undefined;
      this._cinematicDesatBlend = undefined;
      opts.onComplete?.();
      // 清除运镜带来的旋转；非 holdBlack 时恢复播放态（setupPlayCamera 更稳）。
      cam.setRotation(0);
      if (!holdBlack) this.setupPlayCamera();
      this.cinematicClip = null;
      this.cinematicKfs = null;
      this.cinematicOpts = null;
      this.cinematicPrev = null;
      this.cinematicFocus = null;
      this.cinematicFocusTarget = null;
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
