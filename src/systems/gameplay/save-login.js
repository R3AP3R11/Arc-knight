/**
 * 文件职责：存档选择界面、登录主界面按钮与登录页入场动画（虫洞）
 * 归属分类：系统玩法
 * 主要导出：SaveLoginMixin（9 个方法）
 * 依赖：systems/constants.js、systems/ui/entity-art.js
 */
import { VIEW_W, VIEW_H, FONT_TECH_SC } from '../constants.js';
import { INTRO_BLACK_PAUSE, introGrowScale, wormholeMinRadiusFactor } from '../ui/entity-art.js';
import { LoginButton } from '../../ui-library.js';

export const SaveLoginMixin = {
  // ── 登录页按钮点击派发与入场动画 ──
    onLoginButtonClick(id) {
    const ctx = this.ctx;
      if (id === 'new') {
        // 登录页暂时跳过虫洞入场动画，保留 startIntro 供后续启用
        ctx.onStartNew?.();
      } else if (id === 'continue') {
        this.openSaveSelect();
      } else if (id === 'weapon') {
        this.openMenuScreen('weapon');
      } else if (id === 'workshop') {
        this.openMenuScreen('workshop');
      } else if (id === 'settings') {
        ctx.onSettings?.();
      }
    },

    startIntro() {
      if (this.intro) return;
      this.intro = { t: 0, phase: 'fly' };
    },

    updateIntro(dt) {
    const ctx = this.ctx;
      if (!this.intro) return;
      const it = this.intro;
      it.t += dt / 1000;
      const fx = ctx.state.level?.background || {};
      const pause = fx.introPause ?? INTRO_BLACK_PAUSE;

      if (it.phase === 'fly') {
        // 判断所有环是否超出屏幕：最内环半径 > 屏幕对角线
        const minFactor = wormholeMinRadiusFactor(fx.rings || 1);
        const minR = (fx.radius || 0) * minFactor * introGrowScale(it.t, fx);
        if (minR > Math.hypot(VIEW_W, VIEW_H)) {
          it.phase = 'black';
          it.blackT = 0;
        }
      } else if (it.phase === 'black') {
        it.blackT += dt / 1000;
        if (it.blackT >= pause) {
          this.intro = null;
          ctx.onStartNew?.();
        }
      }
    },

  // ── 存档选择 ──
    openSaveSelect() {
    const ctx = this.ctx;
      this.saveSlots = null;
      this.saveSlotsLoading = true;
      this.saveSlotsError = false;
      this.openMenuScreen('saveSelect');
      ctx.onListSaves?.()
        .then(res => {
          if (!this.scene || !this.scene.isActive()) return;
          this.saveSlots = res || { slots: [], metas: {} };
          this.saveSlotsLoading = false;
          this.drawUI();
        })
        .catch(() => {
          if (!this.scene || !this.scene.isActive()) return;
          this.saveSlots = { slots: [], metas: {} };
          this.saveSlotsLoading = false;
          this.saveSlotsError = true;
          this.drawUI();
        });
    },

    drawSaveSelectUI() {
      const g = this.uiG;
      const slots = ['save-1', 'save-2', 'save-3'];
      const metas = this.saveSlots?.metas || {};

      this.saveSelectTexts = this.saveSelectTexts || new Map();
      const ensure = (id, size, colorStr = '#ffffff') => {
        let t = this.saveSelectTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color: colorStr }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.saveSelectTexts.set(id, t);
        }
        t.setFontSize(size).setColor(colorStr).setVisible(true);
        return t;
      };

      ensure('title', '32px', '#ffffff').setOrigin(0.5, 0.5).setPosition(VIEW_W / 2, 140).setText('选择存档');
      if (this.saveSlotsError) {
        ensure('error', '18px', '#e84c5e').setOrigin(0.5, 0.5).setPosition(VIEW_W / 2, 220).setText('读取存档列表失败');
      }

      const cardW = 420, cardH = 240, gap = 50;
      const totalW = slots.length * cardW + (slots.length - 1) * gap;
      const startX = (VIEW_W - totalW) / 2;
      const cardY = 320;

      slots.forEach((id, i) => {
        const meta = metas[id];
        const cx = startX + i * (cardW + gap);
        const has = !!meta;
        g.fillStyle(has ? 0x0e2233 : 0x111111, 0.95);
        g.fillRoundedRect(cx, cardY, cardW, cardH, 10);
        g.lineStyle(2, has ? 0x2f5a7a : 0x333333, 1);
        g.strokeRoundedRect(cx, cardY, cardW, cardH, 10);

        if (this.saveSlotsLoading) {
          ensure(`slot_${id}`, '20px', '#9fc3d8').setOrigin(0.5, 0.5).setPosition(cx + cardW / 2, cardY + cardH / 2).setText('读取中…');
        } else if (has) {
          ensure(`slot_${id}_name`, '22px', '#ffffff').setOrigin(0, 0.5).setPosition(cx + 24, cardY + 44).setText(`存档 ${i + 1} · ${meta.name || '未命名'}`);
          ensure(`slot_${id}_level`, '18px', '#9fc3d8').setOrigin(0, 0.5).setPosition(cx + 24, cardY + 96).setText(`等级 ${meta.level ?? 1}`);
          const updated = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : '未知';
          ensure(`slot_${id}_time`, '14px', '#666666').setOrigin(0, 0.5).setPosition(cx + 24, cardY + 138).setText(`更新 ${updated}`);
          ensure(`slot_${id}_sel`, '16px', '#ffd54f').setOrigin(0, 0.5).setPosition(cx + 24, cardY + cardH - 40).setText('点击进入');
          this.buttons.push({ id: `selectSave_${id}`, x: cx, y: cardY, w: cardW, h: cardH, node: { id } });
        } else {
          ensure(`slot_${id}_empty`, '20px', '#555555').setOrigin(0.5, 0.5).setPosition(cx + cardW / 2, cardY + cardH / 2).setText(`存档 ${i + 1} · 空`);
        }
      });

      const by = cardY + cardH + 60;
      ensure('back', '18px', '#9fc3d8').setOrigin(0.5, 0.5).setPosition(VIEW_W / 2, by).setText('返回登录界面');
      this.buttons.push({ id: 'saveSelectBack', x: VIEW_W / 2 - 110, y: by - 30, w: 220, h: 60, node: {} });
    },

    // ── 登录按钮（可复用组件 render）──
    loginButtons() {
      const hasSave = !!this.ctx.state.hasAnySave;
      const defs = [
        { id: 'new', label: '新游戏', show: true },
        { id: 'continue', label: '继续游戏', show: hasSave },
        { id: 'settings', label: '设置', show: true }
      ];
      const x = 120, startY = 700, h = 66, gap = 22;
      return defs.map((d, i) => ({ ...d, x, y: startY + i * (h + gap), w: 420, h }));
    },

    drawLoginButtons() {
      const ctx = this.ctx;
      const g = this.uiG;
      const up = this.uiPointer();
      const ids = this.loginButtons();
      this.loginButtonRects = {};
      this.loginButtonTexts = this.loginButtonTexts || new Map();

      // 命中与 hover 目标
      let hoverId = null;
      for (const b of ids) {
        if (!b.show) continue;
        const r = { x: b.x, y: b.y, w: b.w, h: b.h };
        this.loginButtonRects[b.id] = r;
        if (up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h) hoverId = b.id;
      }

      // 扫光进度动画
      this.uiLoginHover = this.uiLoginHover || { id: null, t: 0, last: this.time.now };
      const st = this.uiLoginHover;
      const dt = Math.max(0, this.time.now - st.last) / 1000;
      st.last = this.time.now;
      if (hoverId !== st.id) { st.id = hoverId; st.t = hoverId ? 0 : 0; }
      const step = dt / 0.24;
      st.t = Math.max(0, Math.min(1, st.t + (st.id ? step : -step)));

      // 绘制每个按钮（含扫光 + 文字）
      for (const b of ids) {
        if (!b.show) { this.loginButtonTexts.get(b.id)?.setVisible(false); continue; }
        let t = this.loginButtonTexts.get(b.id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: '28px', color: '#eaf4fb' }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.loginButtonTexts.set(b.id, t);
        }
        const k = st.id === b.id ? st.t : 0;
        LoginButton.drawPhaser(g, { x: b.x, y: b.y, w: b.w, h: b.h, label: b.label }, { hover: k }, t);
      }
    },

    hideLoginButtonTexts() {
      if (this.loginButtonTexts) for (const t of this.loginButtonTexts.values()) t.setVisible(false);
    },

};
