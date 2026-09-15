/**
 * 文件职责：世界层特效与悬浮 UI 绘制（宝箱十字星 / 图标 / 传送门 / 神像 / 休息火堆 / 图标 UI / 神像出价 / 售货机 / 宝箱特效 / 传送门特效 / 屏外实体指引箭头）
 * 归属分类：UI交互
 * 主要导出：WorldOverlayMixin（12 个方法）
 * 依赖：systems/constants.js、systems/ui/entity-art.js、systems/art/design-store.js、systems/art/asset-render.js
 */
import { VIEW_W, VIEW_H, FONT_TECH_SC, CHEST_SIZE, CHEST_OPEN_FX_MS, CHEST_SPAWN_FX_MS } from '../constants.js';
import { color } from './entity-art.js';
import { getDesign, ensureDesign } from '../art/design-store.js';
import { renderAsset, designRadius } from '../art/asset-render.js';

// 屏外实体指引箭头：淡入淡出时长 / 距视窗边缘内缩量
const GUIDE_FADE_MS = 200;
const GUIDE_EDGE_INSET = 44;

export const WorldOverlayMixin = {
    drawChestStar(g, x, y, progress, size) {
      if (progress <= 0 || progress >= 1) return;
      const p = progress;                       // 0..1
      const ease = Math.sin(p * Math.PI);       // 淡入淡出包络
      const r = size * (0.6 + p * 1.6);
      const alpha = ease;

      // 主轴十字（横竖长光束，末端尖端）
      g.lineStyle(3, 0xffd54f, alpha);
      g.lineBetween(x - r, y, x + r, y);
      g.lineBetween(x, y - r, x, y + r);

      // 对角长星芒（45° 四条）
      const d = r * 0.8;
      g.lineStyle(2, 0xffd54f, alpha * 0.9);
      g.lineBetween(x - d, y - d, x + d, y + d);
      g.lineBetween(x - d, y + d, x + d, y - d);

      // 次级短星芒（22.5° 八条，更密集）
      const s = r * 0.5;
      const ang2 = Math.PI / 8;
      g.lineStyle(1.5, 0xffe082, alpha * 0.8);
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4 + ang2;
        g.lineBetween(
          x + Math.cos(a) * s, y + Math.sin(a) * s,
          x - Math.cos(a) * s, y - Math.sin(a) * s
        );
      }

      // 旋转菱形光环（高速旋转，随 p 缩放）
      const rot = p * Math.PI * 2;
      const ring = r * 0.7;
      g.lineStyle(2, 0xffab00, alpha * 0.7);
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = rot + k * Math.PI / 2;
        const px = x + Math.cos(a) * ring;
        const py = y + Math.sin(a) * ring;
        if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      g.strokePath();

      // 中心爆闪点
      g.fillStyle(0xfff3c4, alpha);
      g.fillCircle(x, y, 2 + p * 4);
    },

    drawIcons(g) {
    const ctx = this.ctx;
      const icons = this.editing ? (ctx.state.level.icons || []) : (this.icons || []);
      for (const ic of icons) {
        if (!this.editing && ic.visible === false) continue;
        if (ic.src) continue;
        const r = Math.max(10, Math.min(ic.w || 64, ic.h || 64) / 2);
        g.fillStyle(0x1b3a57, 0.92);
        g.fillCircle(ic.x, ic.y, r);
        g.lineStyle(2, 0x6fd3ff, 0.95);
        g.strokeCircle(ic.x, ic.y, r);
        g.fillStyle(0x6fd3ff, 1);
        g.fillCircle(ic.x, ic.y - r * 0.35, Math.max(1.5, r * 0.12));
        g.fillRect(ic.x - 1.5, ic.y - r * 0.05, 3, r * 0.55);
      }
    },

    drawPortalUI(g) {
      const alpha = this.portalTipT ?? 0;
      if (alpha <= 0 || !this.portalNearest || this.editing || this.state !== 'playing') {
        this.portalTipText?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.portalNearest;
      const halfDiag = Math.hypot(nv.w, nv.h) / 2;
      const reach = Math.max(nv.interactRadius || 90, halfDiag + p.r + 40);
      g.lineStyle(2, 0xffd54f, 0.7 * alpha);
      g.strokeCircle(nv.x, nv.y, reach);

      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.portalTipText) {
        this.portalTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.portalTipText);
      }
      const tip = this.portalTipText;
      tip.setText('撤离');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    },

    drawIdolUI(g) {
      const alpha = this.idolTipT ?? 0;
      if (alpha <= 0 || !this.idolNearest || this.editing || this.state !== 'playing') {
        this.idolTipText?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.idolNearest;
      const halfDiag = Math.hypot(nv.w, nv.h) / 2;
      const reach = Math.max(nv.interactRadius || 130, halfDiag + p.r + 40);
      g.lineStyle(2, 0xffd54f, 0.7 * alpha);
      g.strokeCircle(nv.x, nv.y, reach);

      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.idolTipText) {
        this.idolTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.idolTipText);
      }
      const tip = this.idolTipText;
      tip.setText('神像');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    },

    drawCampfireUI(g) {
      const alpha = this.campfireTipT ?? 0;
      if (alpha <= 0 || !this.campfireNearest || this.editing || this.state !== 'playing') {
        this.campfireTipText?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.campfireNearest;
      const halfDiag = Math.hypot(nv.w, nv.h) / 2;
      const reach = Math.max(nv.interactRadius || 150, halfDiag + p.r + 40);
      g.lineStyle(2, 0xffd54f, 0.7 * alpha);
      g.strokeCircle(nv.x, nv.y, reach);

      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.campfireTipText) {
        this.campfireTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.campfireTipText);
      }
      const tip = this.campfireTipText;
      tip.setText('休息火堆');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    },

    drawIconUI(g) {
      const alpha = this.iconTipT ?? 0;
      if (alpha <= 0 || !this.iconNearest || this.editing || this.state !== 'playing') {
        this.iconTipText?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.iconNearest;
      const halfDiag = Math.hypot(nv.w, nv.h) / 2;
      const reach = Math.max(nv.interactRadius || 120, halfDiag + p.r + 40);
      g.lineStyle(2, 0xffd54f, 0.7 * alpha);
      g.strokeCircle(nv.x, nv.y, reach);

      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.iconTipText) {
        this.iconTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.iconTipText);
      }
      const tip = this.iconTipText;
      tip.setText(nv.tipText || '按 F 交互');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    },

    // 神像三选一弹窗（docs/ui-designs/ui-shenxiang.json，1:6 缩略稿）：
    // 视窗底部 80% 黑条蒙层连同卡片整体从下到上飞入，白卡悬停放大 20%，点击空白处关闭（不消耗神像）。
    drawIdolOffer() {
      const g = this.uiG;
      const offer = this.idolOffer;
      if (!offer) return;
      this.idolOfferTexts = this.idolOfferTexts || new Map();
      const ensure = (id, size, color) => {
        let t = this.idolOfferTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1001);
          this.cameras.main.ignore(t);
          this.idolOfferTexts.set(id, t);
        }
        t.setVisible(true);
        return t;
      };

      const barH = 336;
      const cardW = 408, cardH = 216, gap = 96;
      const cardTopInBar = 54;
      const iconOffsetY = -24; // 圆标圆心相对卡中心
      const nameOffsetY = 62, descOffsetY = 90;
      const SLIDE_MS = 450;

      let slide;
      const now = this.time.now;
      if (offer.closing) {
        // 离场：黑条连同卡片整体向下滑出视窗外，结束后才真正关闭
        const q = Math.min(1, (now - (offer.closeStart ??= now)) / SLIDE_MS);
        const easeQ = 1 - Math.pow(1 - q, 3);
        slide = easeQ * barH;
        if (q >= 1) { this.closeIdolOffer(); return; }
      } else {
        const p = Math.min(1, (now - (offer.startT ??= now)) / SLIDE_MS);
        const ease = 1 - Math.pow(1 - p, 3);
        slide = (1 - ease) * barH;
      }

      offer.hoverT = offer.hoverT || [];

      g.fillStyle(0x000000, 0.65);
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      g.fillStyle(0x000000, 0.8);
      g.fillRect(0, VIEW_H - barH + slide, VIEW_W, barH);

      const n = offer.cards.length;
      const totalW = cardW * n + gap * (n - 1);
      const startX = (VIEW_W - totalW) / 2;
      const hover = this.uiPointer();

      for (let i = 0; i < n; i++) {
        const card = offer.cards[i];
        if (!card) continue;
        const cx = startX + i * (cardW + gap) + cardW / 2;
        const top = VIEW_H - barH + cardTopInBar + slide;

        const inCard = hover.x >= cx - cardW / 2 && hover.x <= cx + cardW / 2
          && hover.y >= top && hover.y <= top + cardH;
        offer.hoverT[i] = offer.hoverT[i] || 0;
        offer.hoverT[i] = Math.max(0, Math.min(1, offer.hoverT[i] + (inCard ? 0.14 : -0.14)));
        const s = (1 + 0.1 * offer.hoverT[i]) * this.pressScale(`idolCard_${i}`);
        const cy = top + cardH / 2;

        g.fillStyle(0xffffff, 1);
        g.fillRect(cx - cardW * s / 2, cy - cardH * s / 2, cardW * s, cardH * s);

        // 图标：有画板资产则渲染动态资产，缺省/未加载完成退化黑圆占位
        const design = card.icon ? getDesign(card.icon) : null;
        if (design) {
          renderAsset(g, design, cx, cy + iconOffsetY * s, 0, (66 / designRadius(design)) * s);
        } else {
          if (card.icon) ensureDesign(card.icon);
          g.fillStyle(0x000000, 1);
          g.fillCircle(cx, cy + iconOffsetY * s, 66 * s);
        }

        ensure(`idolCard_${i}_name`, '24px', '#000000').setOrigin(0.5)
          .setPosition(cx, cy + nameOffsetY * s).setText(card.name);
        ensure(`idolCard_${i}_desc`, '20px', '#000000').setOrigin(0.5)
          .setPosition(cx, cy + descOffsetY * s).setText(card.desc);

        this.buttons.push({ id: `idolCard_${i}`, x: cx - cardW / 2, y: top, w: cardW, h: cardH });
      }
    },

    drawVendorUI(g) {
      const alpha = this.vendorTipT ?? 0;
      if (alpha <= 0 || !this.vendorNearest || this.editing || this.state !== 'playing') {
        this.vendorTipText?.setVisible(false);
        this.vendorTipKeyText?.setVisible(false);
        this.fKeyBadge?.setVisible(false);
        return;
      }

      const p = this.player;
      const nv = this.vendorNearest;
      if (nv) {
        const halfDiag = Math.hypot(nv.w, nv.h) / 2;
        const reach = Math.max(nv.interactRadius || 120, halfDiag + p.r + 40);
        g.lineStyle(2, 0xffd54f, 0.7 * alpha);
        g.strokeCircle(nv.x, nv.y, reach);
      }
      const tx = p.x + 20, ty = p.y - 20;
      const w = 200, h = 44, skew = 18;
      g.fillStyle(0xffffff, 0.92 * alpha);
      g.beginPath();
      g.moveTo(tx + skew, ty - h / 2);
      g.lineTo(tx + w, ty - h / 2);
      g.lineTo(tx + w - skew, ty + h / 2);
      g.lineTo(tx, ty + h / 2);
      g.closePath();
      g.fillPath();

      if (!this.vendorTipText) {
        this.vendorTipText = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC, fontSize: '22px', color: '#000000'
        }).setOrigin(0, 0.5).setDepth(13);
        if (this.uiCam) this.uiCam.ignore(this.vendorTipText);
      }
      const tip = this.vendorTipText;
      tip.setText('售货机');
      tip.setPosition(tx + skew + 42, ty);
      tip.setAlpha(alpha);
      tip.setVisible(true);

      // F 键帽图标
      const badge = this.getFKeyBadge();
      if (badge) {
        badge.setPosition(tx + skew + 21, ty);
        badge.setAlpha(alpha);
        badge.setVisible(true);
      }
    },

    drawChestEffects(g) {
      if (this.editing) return;
      for (const c of (this.chests || [])) {
        if (!c.spawned || !c.fx) continue;
        const dur = c.fx.kind === 'open' ? CHEST_OPEN_FX_MS : CHEST_SPAWN_FX_MS;
        const remaining = Math.max(0, c.fx.t);
        const progress = 1 - remaining / dur; // 0..1
        this.drawChestStar(g, c.x, c.y, progress, CHEST_SIZE * 1.6);
      }
    },

    drawPortalEffects(g) {
      if (this.editing) return;
      for (const p of (this.portals || [])) {
        if (!p.spawned || !p.fx || p.visible === false) continue;
        const remaining = Math.max(0, p.fx.t);
        const progress = 1 - remaining / CHEST_SPAWN_FX_MS; // 0..1
        this.drawChestStar(g, p.x, p.y, progress, Math.max(p.w, p.h) * 1.6);
      }
    },

  // ── 屏外实体指引箭头（docs/ui-designs/ui-arrow.json：白色三角箭头 + 白色圆图标位）──
    // 每帧评估：guide 开启、实体在视窗外且距玩家 ≤ guideRange → 淡入；进入视窗/超距/已交互(可配置停止) → 淡出
    updateGuideArrows(dt) {
      const alphas = this.guideAlphas || (this.guideAlphas = new Map());
      const markers = this.guideMarkers = [];
      if (this.editing || this.state !== 'playing' || !this.player) {
        for (const [e, a] of alphas) {
          const na = a - dt / GUIDE_FADE_MS;
          if (na <= 0) alphas.delete(e); else alphas.set(e, na);
        }
        return;
      }
      const p = this.player;
      const b = this.viewRect();   // 相机可视区（世界坐标，EnemyAiMixin 提供，Phaser 4 无 getWorldBoundingRectangle）
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const hw = Math.max(1, b.w / 2 - GUIDE_EDGE_INSET);
      const hh = Math.max(1, b.h / 2 - GUIDE_EDGE_INSET);
      for (const [list, label] of [
        [this.chests, '宝箱'], [this.portals, '撤离传送门'], [this.vendors, '售货机'],
        [this.idols, '神像'], [this.icons, '图标'], [this.campfires, '休息火堆']
      ]) {
        for (const e of (list || [])) {
          if (!e.guide || e.visible === false || e.spawned === false) continue;
          if ((e.opened || e.used || e.guideUsed) && e.guideStopAfterUse !== false) continue;
          const inside = e.x >= b.x && e.x <= b.x + b.w && e.y >= b.y && e.y <= b.y + b.h;
          const show = !inside && Math.hypot(e.x - p.x, e.y - p.y) <= (e.guideRange || 600);
          const a = Math.max(0, Math.min(1, (alphas.get(e) || 0) + (show ? dt : -dt) / GUIDE_FADE_MS));
          if (a <= 0) { alphas.delete(e); continue; }
          alphas.set(e, a);
          const ang = Math.atan2(e.y - cy, e.x - cx);
          const dx = Math.cos(ang), dy = Math.sin(ang);
          const t = Math.min(
            dx === 0 ? Infinity : (dx > 0 ? hw : -hw) / dx,
            dy === 0 ? Infinity : (dy > 0 ? hh : -hh) / dy
          );
          markers.push({ x: cx + dx * t, y: cy + dy * t, angle: ang, alpha: a, entity: e, label });
        }
      }
    },

    drawGuideArrows(g) {
      this.guideTexts = this.guideTexts || new Map();
      const alive = new Set();
      for (const m of (this.guideMarkers || [])) {
        alive.add(m.entity);
        const a = m.alpha;
        const { x, y, angle } = m;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const px = -sin, py = cos;
        g.fillStyle(0xffffff, a);
        g.fillCircle(x, y, 12);                                 // 圆：图标位（设计稿 r8 × 1.5）
        g.fillTriangle(                                          // 三角：尖端朝实体（设计稿 × 1.5）
          x + cos * 33, y + sin * 33,
          x + cos * 13.5 + px * 9.75, y + sin * 13.5 + py * 9.75,
          x + cos * 13.5 - px * 9.75, y + sin * 13.5 - py * 9.75
        );
        const iconId = m.entity.guideIcon;
        const design = iconId ? getDesign(iconId) : null;
        if (design) {
          renderAsset(g, design, x, y, 0, 11 / designRadius(design));
        } else {
          if (iconId) ensureDesign(iconId);
          let t = this.guideTexts.get(m.entity);
          if (!t) {
            t = this.add.text(0, 0, '', {
              fontFamily: FONT_TECH_SC, fontSize: '20px', color: '#000000'
            }).setOrigin(0.5).setDepth(13);
            if (this.uiCam) this.uiCam.ignore(t);
            this.guideTexts.set(m.entity, t);
          }
          t.setText(m.label).setPosition(x, y).setAlpha(a).setVisible(true);
        }
      }
      for (const [e, t] of this.guideTexts) {
        if (alive.has(e)) continue;
        t.destroy();
        this.guideTexts.delete(e);
      }
    },
};
