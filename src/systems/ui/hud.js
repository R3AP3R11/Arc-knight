/**
 * 文件职责：战斗 HUD 状态机与绘制（状态指示器 / 血盾条 / 弹药 / 充能条 / 设置按钮）
 * 归属分类：UI交互
 * 主要导出：HudMixin（10 个方法）、HUD_IDLE_MS
 * 依赖：systems/constants.js、systems/combat/weapons.js、state.js、systems/ui/entity-art.js、systems/ui/hud-art.js、systems/ui/ui-runtime.js
 */
import Phaser from 'phaser';
import { VIEW_W, VIEW_H, FONT_TECH } from '../constants.js';
import { WEAPONS } from '../combat/weapons.js';
import { WEAPON_LABELS } from '../../state.js';
import { getWeaponDef } from '../art/weapon-store.js';
import { color, strokeDiamond } from './entity-art.js';
import { drawHudAvatar, drawHudBars, drawWeaponWheel, drawWeaponIcon } from './hud-art.js';
import { ICON_SETTINGS } from './ui-runtime.js';

const HUD_RECT_W = 400, HUD_RECT_H = 60;
const HUD_RECT_X = (VIEW_W - HUD_RECT_W) / 2;   // 760
const HUD_RECT_Y = 16;
const HUD_TRANSITION_MS = 500;   // 0.5s 切换动画
export const HUD_IDLE_MS = 3000;        // 3s 常态脉冲
const HUD_STATES = {
  explore: { color: '#ffffff', label: 'EXPLORE', text: '#000000' },
  combat:  { color: '#ff3b3b', label: 'COMBAT',  text: '#ffffff' },
  secure:  { color: '#37d67a', label: 'SECURE',  text: '#ffffff' },
  black:   { color: '#000000', label: '',        text: '#ffffff' }   // 脉冲用黑色，文本沿用当前态
};

export const HudMixin = {
    hudColor(mode) {
      return HUD_STATES[mode]?.color || '#ffffff';
    },

    setHudMode(mode, opts = {}) {
      const from = this.hudMode;
      this.hudMode = mode;
      this.hudAnim = {
        fromColor: this.hudColor(from),
        toColor: this.hudColor(mode),
        fromText: HUD_STATES[from]?.label || '',
        toText: HUD_STATES[mode]?.label || '',
        t: 0,
        dur: HUD_TRANSITION_MS,
        phase: 'switch'
      };
      if (opts.autoReturn) {
        this.time.delayedCall(opts.autoReturn.delay, () => this.setHudMode(opts.autoReturn.mode || 'explore'));
      }
    },

    updateHud(dt) {
      if (this.hudAnim) {
        this.hudAnim.t += dt;
        if (this.hudAnim.t >= this.hudAnim.dur) {
          const phase = this.hudAnim.phase;
          this.hudAnim = null;
          // 脉冲第一段（当前色 → 黑）结束后接第二段（黑 → 当前色）
          if (phase === 'idleBlack') {
            this.hudAnim = {
              fromColor: '#000000',
              toColor: this.hudColor(this.hudMode),
              fromText: HUD_STATES[this.hudMode]?.label || '',
              toText: HUD_STATES[this.hudMode]?.label || '',
              t: 0,
              dur: HUD_TRANSITION_MS,
              phase: 'idleBack'
            };
          }
        }
      }

      if (this.state === 'playing' && !this.hudAnim) {
        this.hudIdleClock -= dt;
        if (this.hudIdleClock <= 0) {
          this.hudIdleClock = HUD_IDLE_MS;
          this.hudAnim = {
            fromColor: this.hudColor(this.hudMode),
            toColor: '#000000',
            fromText: HUD_STATES[this.hudMode]?.label || '',
            toText: HUD_STATES[this.hudMode]?.label || '',
            t: 0,
            dur: HUD_TRANSITION_MS,
            phase: 'idleBlack'
          };
        }
      } else if (this.state === 'playing') {
        this.hudIdleClock = HUD_IDLE_MS;
      }
    },

    drawHudIndicator() {
      const g = this.uiG;
      const st = HUD_STATES[this.hudMode] || HUD_STATES.explore;
      let label = st.label;
      let textColor = st.text || '#000000';

      if (this.hudAnim) {
        const p = Math.min(1, this.hudAnim.t / this.hudAnim.dur);
        const w = HUD_RECT_W * p;   // 左到右：左半目标色，右半来源色
        g.fillStyle(color(this.hudAnim.toColor), 1);
        g.fillRect(HUD_RECT_X, HUD_RECT_Y, w, HUD_RECT_H);
        g.fillStyle(color(this.hudAnim.fromColor), 1);
        g.fillRect(HUD_RECT_X + w, HUD_RECT_Y, HUD_RECT_W - w, HUD_RECT_H);
        label = this.hudAnim.toText;
        if (this.hudAnim.toColor === '#000000') textColor = '#ffffff';
      } else {
        g.fillStyle(color(st.color), 1);
        g.fillRect(HUD_RECT_X, HUD_RECT_Y, HUD_RECT_W, HUD_RECT_H);
      }

      if (this.hudIndicatorText) {
        this.hudIndicatorText.setPosition(HUD_RECT_X + HUD_RECT_W / 2, HUD_RECT_Y + HUD_RECT_H / 2);
        this.hudIndicatorText.setText(label || st.label);
        this.hudIndicatorText.setColor(textColor);
        this.hudIndicatorText.setVisible(true);
      }
    },

    drawHud() {
      const g = this.uiG;
      const p = this.player;
      drawHudAvatar(g, 70, 970, p, this.time.now / 1000);
      this._trackHudGhosts();
      drawHudBars(g, p, this.hpGhost, this.shieldGhost);
      drawWeaponWheel(g, p, this.wheelAnim);
      drawWeaponIcon(g, p, this.wheelAnim);
      this.updateWeaponLabels();
      this.drawAmmo(g);
      this.drawSettingsButton(g);
      this.drawChargeBars(g);
    },

    // 受伤残弧状态：hp/shield 下降时记录旧→新比值，作为「残弧」；约 1s 线性渐隐
    _trackHudGhosts() {
      const p = this.player;
      if (!p) return;
      const hpR = p.maxHp > 0 ? p.hp / p.maxHp : 0;
      const shR = p.maxShield > 0 ? p.shield / p.maxShield : 0;
      const now = this.time.now;
      if (hpR < (this._lastHpR ?? hpR) - 1e-4) this.hpGhost = { fromRatio: this._lastHpR, toRatio: hpR, start: now };
      if (shR < (this._lastShR ?? shR) - 1e-4) this.shieldGhost = { fromRatio: this._lastShR, toRatio: shR, start: now };
      this._lastHpR = hpR;
      this._lastShR = shR;
      for (const k of ['hpGhost', 'shieldGhost']) {
        const gh = this[k];
        if (gh) {
          gh.age = now - gh.start;
          if (gh.age > 1000) this[k] = null;
        }
      }
    },

    drawChargeBars(g) {
      const p = this.player;
      if (!p?.weaponCharge) return;
      const types = ['yellow', 'green'];
      let y = 960;
      for (const type of types) {
        const c = p.weaponCharge[type];
        if (!c) continue;
        const x = 24, w = 180, h = 12;
        g.fillStyle(0x222222, 1);
        g.fillRect(x, y, w, h);
        const ratio = c.need > 0 ? Math.min(1, c.have / c.need) : 0;
        g.fillStyle(color(WEAPONS[type]?.ringColor || '#ffffff'), 1);
        g.fillRect(x, y, w * ratio, h);
        y -= 24;
      }
    },

    drawSettingsButton(g) {
      const bx = VIEW_W - 88, by = 28, bw = 64, bh = 64;
      this.settingsButtonRect = { x: bx, y: by, w: bw, h: bh };
      const up = this.uiPointer();
      const hover = up.x >= bx && up.x <= bx + bw && up.y >= by && up.y <= by + bh;
      const scl = this.pressScale('settingsBtn');
      const cw = bw * scl, ch = bh * scl;
      const cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2;
      g.fillStyle(hover ? 0xffffff : 0x000000, 0.55);
      g.fillRoundedRect(cx, cy, cw, ch, 10);
      g.lineStyle(2, 0xffffff, 1);
      g.strokeRoundedRect(cx, cy, cw, ch, 10);
      const spr = this.iconSprite('settings', ICON_SETTINGS);
      if (spr) {
        spr.setPosition(bx + bw / 2, by + bh / 2);
        spr.setDisplaySize(40, 40);
        spr.setVisible(true);
      }
    },

    drawAmmo(g) {
      const p = this.player;
      const cx = VIEW_W, cy = VIEW_H - 16;
      const wt = p.weaponType;
      const ammo = p.ammo[wt];
      const max = WEAPONS[wt]?.maxAmmo ?? Infinity;
      const ax = cx - 50, ay = cy - 42;

      if (max === Infinity || ammo === Infinity) {
        this.ammoCurrent.setVisible(false);
        this.ammoMax.setVisible(false);
        const rx = 10.8, ry = 14.4;
        const ox = ax - 4, oy = ay - 4 ;
        g.lineStyle(4, 0xffffff, 1);
        strokeDiamond(g, ox - rx, oy, rx, ry);
        strokeDiamond(g, ox + rx, oy, rx, ry);
      } else {
        this.ammoCurrent.setVisible(true);
        this.ammoCurrent.setFontFamily(FONT_TECH);
        this.ammoCurrent.setText(String(ammo));
        this.ammoCurrent.setPosition(ax - 20, ay - 18);
        this.ammoMax.setVisible(true);
        this.ammoMax.setText(String(max));
        this.ammoMax.setPosition(ax + 20, ay + 18);
        g.lineStyle(4, 0xffffff, 1);
        g.lineBetween(ax - 21, ay + 27, ax + 27, ay - 21);
      }
    },

    hideHudOverlay() {
      if (this.weaponLabels) this.weaponLabels.forEach(t => t.setVisible(false));
      if (this.weaponIconImage) this.weaponIconImage.setVisible(false);
      if (this.ammoCurrent) {
        this.ammoCurrent.setVisible(false);
        this.ammoMax.setVisible(false);
      }
      this.hideMinimapOverlay?.();
    },

    updateWeaponLabels() {
      if (!this.weaponLabels) return;
      const p = this.player;
      const cx = VIEW_W, cy = VIEW_H - 16;
      const rMid = (135 + 214) / 2 - 3;
      const center = Math.PI + Phaser.Math.DegToRad(30);
      const ix = cx + Math.cos(center) * rMid;
      const iy = cy + Math.sin(center) * rMid;

      const useImage = p.weaponType === 'yellow' && this.weaponIconImage;
      if (this.weaponIconImage) {
        this.weaponIconImage.setVisible(useImage);
        if (useImage) this.weaponIconImage.setPosition(ix, iy - 2);
      }

      this.weaponLabels.forEach((t, i) => {
        if (i !== 0) {
          t.setVisible(false);
          return;
        }
        t.setVisible(!useImage);
        t.setText(getWeaponDef(p.weaponType)?.name || WEAPON_LABELS[p.weaponType] || p.weaponType);
        t.setColor('#000000');
        t.setPosition(ix, iy);
      });
    },
};
