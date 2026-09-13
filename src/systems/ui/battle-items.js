/**
 * 文件职责：战斗 HUD「药水槽 + 临时武器槽」绘制、数字键 4/5 交互状态机、药水选择轮盘动画与名称文本、世界层状态图标入口
 * 归属分类：UI交互
 * 主要导出：BattleItemsMixin（3 个方法）
 * 依赖：systems/constants.js、systems/combat/weapons.js、systems/economy/inner-shop.js、
 *       systems/art/weapon-store.js、systems/ui/vendor-shop-art.js、systems/ui/battle-items-art.js
 */

import Phaser from 'phaser';
import { FONT_TECH_SC } from '../constants.js';
import { WEAPONS } from '../combat/weapons.js';
import { findConsumable, getItemArt } from '../economy/inner-shop.js';
import { getWeaponDef } from '../art/weapon-store.js';
import { getArtRef, preloadArtRefs } from './vendor-shop-art.js';
import {
  ITEM_SLOT_SIZE, POTION_SLOT_POS, TEMP_SLOT_POS, WHEEL_ANIM_MS, WHEEL_HOVER_FADE_MS,
  WHEEL_NAME_FONT, wheelHoverIndex, wheelNamePos,
  drawPotionSlot, drawPotionQueueDots, drawTempWeaponSlot, drawPotionWheel,
  drawBattleStatusIcons as drawStatusIcons
} from './battle-items-art.js';

const POTION_HOLD_MS = 160;   // 数字键 4 长按超过此时长 → 打开轮盘

export const BattleItemsMixin = {
    // ── 每帧：数字键 4/5 状态机 + 轮盘动画推进（不暂停游戏、不阻止移动/开火）──
    updateBattleItemsInput(dt) {
      // 屏蔽条件：编辑 / 菜单 / 设置 / 非战斗态 → 清空交互态
      if (this.editing || this.menuScreen || this.settingsMode || this.state !== 'playing'
          || this.isMenuLevel?.() || this.isHubLevel?.()) {
        this.potionKeyHold = null;
        this.potionWheel = null;
        this.hidePotionWheelTexts();
        return;
      }

      const now = this.time.now;
      const k4 = this.keys?.NUMPAD4, k4b = this.keys?.DIGIT4;
      const k5 = this.keys?.NUMPAD5, k5b = this.keys?.DIGIT5;
      const k4Down = !!(k4?.isDown || k4b?.isDown);

      // ── 数字键 4：短按用队列首瓶；长按(>=160ms)开轮盘，松开按悬停扇区使用 ──
      if (k4Down) {
        if (!this.potionKeyHold) this.potionKeyHold = { t0: now, opened: false };
        const hold = this.potionKeyHold;
        if (!hold.opened && now - hold.t0 >= POTION_HOLD_MS) {
          const n = this.getRunPotions?.().length || 0;
          if (n > 0) { hold.opened = true; this.potionWheel = { phase: 'in', t0: now, hover: -1, hoverT0: now }; }
        }
      } else if (this.potionKeyHold) {
        const hold = this.potionKeyHold;        // 本帧刚松开（上一帧按住）
        this.potionKeyHold = null;
        if (hold.opened && this.potionWheel) {
          this.potionWheel.phase = 'out';
          this.potionWheel.t0 = now;
          const hover = this.potionWheel.hover;
          if (hover >= 0) this.usePotionAt?.(hover);   // -1（中心叉号）→ 不使用
        } else {
          this.useFrontPotion?.();
        }
      }

      // ── 轮盘：每帧更新 hover（切换扇区时重置渐显起点）+ 推进动画 ──
      const wheel = this.potionWheel;
      if (wheel) {
        // 淡出阶段冻结悬停：避免渐隐过程中高亮跳到别的扇区、或重置渐显重新亮起
        if (wheel.phase !== 'out') {
          const n = this.getRunPotions?.().length || 0;
          const up = this.uiPointer();
          const hi = wheelHoverIndex(up.x, up.y, n);
          if (hi !== wheel.hover) { wheel.hover = hi; wheel.hoverT0 = now; }
        }
        const k = Math.min(1, (now - wheel.t0) / WHEEL_ANIM_MS);
        if (k >= 1) {
          if (wheel.phase === 'in') wheel.phase = 'open';
          else if (wheel.phase === 'out') this.potionWheel = null;
        }
      }

      // ── 数字键 5：切换临时武器（使用 / 取消）──
      let j5 = false;
      if (k5) j5 = Phaser.Input.Keyboard.JustDown(k5) || j5;
      if (k5b) j5 = Phaser.Input.Keyboard.JustDown(k5b) || j5;
      if (j5) this.toggleTempWeapon?.();
    },

    // ── 绘制两个槽位 + 轮盘（由 hud.js:drawHud 调用，g = this.uiG）──
    drawBattleItems(g) {
      if (this.editing || this.isMenuLevel?.() || this.isHubLevel?.() || !this.player) return;
      const tSec = this.time.now / 1000;

      // 药水槽：解析「最先获得且未被使用」那瓶的图标 → 黑底白图；槽下画队列小点
      const front = this.getFrontPotion?.();
      const pc = front ? findConsumable(front.id) : null;
      const part = pc ? getItemArt(pc) : null;
      const pdesign = part?.artType && part?.artName ? getArtRef(part.artType, part.artName) : null;
      if (!pdesign && part?.artType && part?.artName) preloadArtRefs([part]);   // 未加载 → 下一帧补上
      const pScale = this.pressScale?.('battleItemPotion') ?? 1;
      drawPotionSlot(g, POTION_SLOT_POS.x, POTION_SLOT_POS.y, ITEM_SLOT_SIZE * pScale, { design: pdesign, count: front?.count || 0 });
      drawPotionQueueDots(g, POTION_SLOT_POS.x, POTION_SLOT_POS.y, ITEM_SLOT_SIZE, this.getRunPotions?.().length || 0);

      // 临时武器槽：空 / 有武器 / 使用中（使用中多一条上方时间条）+ 武器保持自转（动态）
      const t = this.getTempWeapon?.();
      const wdesign = t ? (getWeaponDef(t.id)?.appearance || null) : null;
      const active = this.isTempWeaponActive?.() === true;
      const remainRatio = t && t.durationSec > 0 ? Math.max(0, Math.min(1, t.remainSec / t.durationSec)) : 0;
      const wcolor = t ? (WEAPONS[t.id]?.ringColor || getWeaponDef(t.id)?.medium?.ringColor || '#ffffff') : '#ffffff';
      const wScale = this.pressScale?.('battleItemWeapon') ?? 1;
      drawTempWeaponSlot(g, TEMP_SLOT_POS.x, TEMP_SLOT_POS.y, ITEM_SLOT_SIZE * wScale, { design: wdesign, active, remainRatio, color: wcolor, t: tSec });

      // 轮盘：开启中才绘制；alpha/scale 按动画相位推进，悬停蒙层按切换时刻渐显
      const wheel = this.potionWheel;
      if (wheel) {
        const k = Math.min(1, (this.time.now - wheel.t0) / WHEEL_ANIM_MS);
        const alpha = wheel.phase === 'out' ? 1 - k : k;
        const scale = wheel.phase === 'out' ? 1 - 0.2 * k : 0.8 + 0.2 * k;
        const hoverFade = wheel.hover >= 0 ? Math.min(1, (this.time.now - (wheel.hoverT0 ?? wheel.t0)) / WHEEL_HOVER_FADE_MS) : 0;
        const entries = this.getRunPotions().slice(0, 4).map(r => {
          const c = findConsumable(r.id);
          const a = c ? getItemArt(c) : null;
          return { id: r.id, name: c?.name || '', artType: a?.artType || '', artName: a?.artName || '' };
        });
        drawPotionWheel(g, entries, wheel.hover, alpha, scale, hoverFade);

        // 每项药水名称显示在**自己图标的正下方**（懒创建 4 个文本并复用；不改字号以免每帧重排文字纹理）
        const texts = this.potionWheelTexts = this.potionWheelTexts || [];
        for (let i = 0; i < entries.length; i++) {
          let tx = texts[i];
          if (!tx) {
            tx = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: `${WHEEL_NAME_FONT}px`, color: '#ffffff' })
              .setOrigin(0.5, 0).setDepth(1002);
            this.cameras.main.ignore(tx);
            texts[i] = tx;
          }
          const p = wheelNamePos(i, scale);
          tx.setPosition(p.x, p.y).setText(entries[i].name || '').setAlpha(alpha).setVisible(!!entries[i].name);
        }
        for (let i = entries.length; i < texts.length; i++) texts[i].setVisible(false);
      } else {
        this.hidePotionWheelTexts();
      }
    },

    // ── 隐藏全部轮盘名称文本（独立 Phaser Text 不随 uiG.clear() 消失，离开战斗态/重开时必须手动隐藏）──
    hidePotionWheelTexts() {
      const texts = this.potionWheelTexts;
      if (texts) for (const tx of texts) tx?.setVisible(false);
    },

    // ── 世界层状态图标（由 world-render.js 调用；转发到纯绘制函数）──
    drawBattleStatusIcons(g, player) {
      if (this.editing || !player) return;
      drawStatusIcons(g, player, this.getRunEffects?.() || []);
    },
};
