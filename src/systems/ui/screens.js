/**
 * 文件职责：全屏弹窗页面绘制（局内商店 / 关卡选择 / 武器与改件商店）
 * 归属分类：UI交互
 * 主要导出：ScreensMixin（8 个方法）
 * 依赖：systems/constants.js、systems/economy/buffs.js、systems/ui/ui-layer.js、systems/combat/weapons.js、state.js
 */
import Phaser from 'phaser';
import { VIEW_W, VIEW_H, FONT_TECH_SC, SETTLE_SUCCESS_COLOR, SETTLE_FAIL_COLOR, SETTLE_BALL_R, WEAPON_BG_ASSET } from '../constants.js';
import { getInnerShopData } from '../economy/inner-shop.js';
import { getArtRef, resolveArtRef, whiteVariant, drawShopIcon, shopIconVariant } from './vendor-shop-art.js';
import { drawWeaponGlyph, drawLock } from '../../ui-layer.js';
import { WEAPONS } from '../combat/weapons.js';
import { WEAPON_LABELS, ITEM_DEFS, MOD_DEFS } from '../../state.js';
import { getWeaponDef } from '../art/weapon-store.js';
import { weaponCatalog } from '../art/weapon-registry.js';
import { getPetDef, listPetDefs } from '../art/pet-store.js';
import { getDesign, ensureDesign } from '../art/design-store.js';
import { drawDesignCentered } from '../art/asset-render.js';
import { drawEnemyShape } from './entity-art.js';

export const ScreensMixin = {
    drawVendorShop() {
      const g = this.uiG;
      const now = this.time.now;
      const tSec = now / 1000;

      this.vendorShopTexts = this.vendorShopTexts || new Map();
      for (const t of this.vendorShopTexts.values()) t.setVisible(false);
      const ensure = (id, size, colorStr = '#ffffff') => {
        let t = this.vendorShopTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color: colorStr }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.vendorShopTexts.set(id, t);
        }
        t.setFontSize(size).setColor(colorStr).setVisible(true);
        return t;
      };

      const stock = this.getVendorStock ? this.getVendorStock() : null;
      if (!stock) {
        ensure('vendorLoading', '40px', '#ffffff').setOrigin(0.5, 0.5).setPosition(VIEW_W / 2, VIEW_H / 2).setText('加载中…');
        return;
      }

      const vendor = this.vendorActive || null;
      const slot = (vendor && vendor.slot) || null;
      const lottery = getInnerShopData()?.lottery || null;
      const kinds = Array.isArray(lottery?.kinds) ? lottery.kinds : [];
      const kindByKey = new Map();
      for (const k of kinds) if (k && k.key != null) kindByKey.set(k.key, k);

      this.vendorView = this.vendorView || {};
      const vv = this.vendorView;
      if (vv.vendor !== vendor) {
        vv.vendor = vendor;
        vv.t0 = now;
        vv.hover = {};
        vv.flip = {};
        vv.bought = {};
        vv.deco = null;
      }
      if (vv.t0 === undefined) vv.t0 = now;
      vv.hover = vv.hover || {};
      vv.flip = vv.flip || {};
      vv.bought = vv.bought || {};

      const pickKey = () => (kinds.length ? (kinds[Math.floor(Math.random() * kinds.length)]?.key ?? null) : null);
      if (!vv.deco || vv.deco.length !== 3) vv.deco = [0, 1, 2].map(() => [pickKey(), pickKey(), pickKey()]);

      // 摇奖动画到点：定格并结算（本方法唯一调用的结算时机）
      if (slot && slot.rolling && now >= slot.settleAt && this.settleVendorRoll) this.settleVendorRoll();

      const gold = this.player?.gold ?? 0;
      const up = this.uiPointer();
      const drawDiamond = (cx, cy, r, colorN, alpha = 1) => {
        g.fillStyle(colorN, alpha);
        g.beginPath();
        g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy);
        g.closePath(); g.fillPath();
      };
      const hoverOf = (id, hit) => {
        const cur = vv.hover[id] || 0;
        vv.hover[id] = cur + ((hit ? 1 : 0) - cur) * 0.18;
        return vv.hover[id];
      };
      const flipAt = delay => Phaser.Math.Clamp((now - vv.t0 - delay) / 200, 0, 1);
      // 黑底卡片（已购买）上的图标统一反转为纯白；按 design 缓存变体
      vv.whiteCache = vv.whiteCache || new Map();
      const wh = d => {
        if (!d) return d;
        let r = vv.whiteCache.get(d);
        if (!r) { r = whiteVariant(d); vv.whiteCache.set(d, r); }
        return r;
      };
      // 按 (design, darkCard) 维度缓存 shopIconVariant 结果（白卡/黑卡两套变体不可混用）
      vv.variantCache = vv.variantCache || new Map();
      const shopIcon = (d, darkCard) => {
        if (!d) return d;
        let m = vv.variantCache.get(d);
        if (!m) { m = new Map(); vv.variantCache.set(d, m); }
        const k = !!darkCard;
        if (!m.has(k)) m.set(k, shopIconVariant(d, k));
        return m.get(k);
      };
      // 老虎机 3 个窗口内的图标直径（窗口白卡 120×120 → 四周各留 16px 内边距）
      const REEL_ICON_SIZE = 88;
      const drawReelIcon = (g2, kd, cx, cy) => {
        if (!kd) { g2.fillStyle(0xffffff, 1); g2.fillCircle(cx, cy, REEL_ICON_SIZE * 0.34); return; }
        const d = getArtRef(kd.artType, kd.artName);
        if (!d) { resolveArtRef(kd.artType, kd.artName); g2.fillStyle(0xffffff, 1); g2.fillCircle(cx, cy, REEL_ICON_SIZE * 0.34); return; }
        drawShopIcon(g2, shopIcon(d, false), cx, cy, REEL_ICON_SIZE, tSec);
      };

      // 老虎机窗口裁剪层（懒建）：滚动图标遮罩到 3 个窗口图标卡内
      if (!this.vendorCardContentG) {
        this.vendorCardMaskG = this.add.graphics().setDepth(999);
        this.vendorCardMask = new Phaser.Display.Masks.GeometryMask(this, this.vendorCardMaskG);
        this.vendorCardContentG = this.add.graphics().setDepth(1001);
        this.vendorCardContentG.setMask(this.vendorCardMask);
        this.cameras.main.ignore(this.vendorCardMaskG);
        this.cameras.main.ignore(this.vendorCardContentG);
        // 关页后 drawUI 不会清理本层（属售货机页私有），用 preupdate 兜底清空避免残留
        this.events.on('preupdate', () => {
          if (this.menuScreen !== 'vendor' && this.vendorCardContentG) this.vendorCardContentG.clear();
        });
      }
      const scg = this.vendorCardContentG;
      scg.clear();
      this.vendorCardMaskG.clear();
      this.vendorCardMaskG.fillStyle(0xffffff, 0);

      // ── 左：老虎机 ──
      const WC_CX = 501;
      const wCx = [330, 501, 675.18];
      const sA = flipAt(0);
      g.fillStyle(0xffffff, 1);
      g.fillRect(WC_CX - 594 * sA / 2, 228, 594 * sA, 330);
      g.fillStyle(0xffff00, 1);
      g.fillRect(WC_CX + (798 - WC_CX) * sA, 285, 78 * sA, 210);
      ensure('vendorJackpot', '72px', '#ffffff').setOrigin(0.5, 0.5)
        .setPosition(WC_CX + (366 - WC_CX) * sA, 156).setText('JACKPOT');
      for (let i = 0; i < 3; i++) {
        const cx = WC_CX + (wCx[i] - WC_CX) * sA;
        g.fillStyle(0x000000, 1);
        g.fillRect(cx - 72 * sA, 318, 144 * sA, 144);
        g.fillStyle(0xffffff, 1);
        g.fillRect(cx - 60 * sA, 330, 120 * sA, 120);
        this.vendorCardMaskG.fillRect(cx - 60 * sA, 330, 120 * sA, 120);
      }
      // 窗口内图标：纵向滚动 / 依次定格
      if (sA >= 1) {
        for (let i = 0; i < 3; i++) {
          const cx = wCx[i];
          const settled = slot && slot.icons && now >= (slot.settleAt + i * 140);
          if (settled) {
            drawReelIcon(scg, kindByKey.get(slot.icons[i]), cx, 390);
          } else {
            const pitch = 130;
            const speed = slot ? 1.2 : 0.35;
            const baseT = slot ? (slot.rollAt || 0) : 0;
            const offset = (((now - baseT) * speed) + i * 37) % pitch;
            const keys = slot ? kinds.map(k => k.key) : vv.deco[i];
            const n = keys.length || 1;
            for (let k = -1; k <= 1; k++) {
              drawReelIcon(scg, kindByKey.get(keys[((k % n) + n) % n]), cx, 390 - offset + k * pitch);
            }
          }
        }
      }

      // 底板（黑底 + 白边）+ 抽奖按钮 + 中奖弹出卡
      // 底板描边居中于路径：用 PANEL_CX=501 使白色外沿落在 204..798，与上半白卡（WC_CX=501/宽594）对齐；
      // PL_CX=502.2 仍用于按钮/价格文本/中奖卡（保持既有坐标不动）。
      const PL_CX = 502.2;
      const PANEL_CX = 501;
      const sB = flipAt(30);
      g.fillStyle(0x000000, 1);
      g.fillRect(PANEL_CX - 570 * sB / 2, 540, 570 * sB, 390);
      g.lineStyle(24, 0xffffff, 1);
      g.strokeRect(PANEL_CX - 570 * sB / 2, 540, 570 * sB, 390);

      const rolling = !!(slot && slot.rolling);
      const rollHit = up.x >= 344.7 && up.x <= 344.7 + 315 && up.y >= 564 && up.y <= 564 + 90;
      const rollScale = (1 + 0.1 * (rolling ? 0 : hoverOf('vendorRoll', rollHit))) * this.pressScale('vendorRoll');
      const rw = 315 * sB * rollScale, rh = 90 * rollScale;
      g.fillStyle(0x000000, 1);
      g.fillRoundedRect(PL_CX - rw / 2, 609 - rh / 2, rw, rh, 8);
      g.lineStyle(6, 0xffffff, 1);
      g.strokeRoundedRect(PL_CX - rw / 2, 609 - rh / 2, rw, rh, 8);
      drawDiamond(PL_CX + (468 - PL_CX) * sB, 609, 18, 0xffff00);
      ensure('vendorRollPrice', '48px', '#ffffff').setOrigin(0.5, 0.5)
        .setPosition(PL_CX + (522 - PL_CX) * sB, 615).setText(`${lottery?.drawCost ?? 0}`);
      if (!rolling) this.buttons.push({ id: 'vendorRoll', x: 344.7, y: 564, w: 315, h: 90 });

      if (slot && !slot.rolling && slot.prizeAt > 0) {
        const pp = Phaser.Math.Clamp((now - slot.prizeAt) / 300, 0, 1);
        const py = 703.5 - 40 * (1 - pp);
        const pCx = PL_CX + (501 - PL_CX) * sB;
        g.fillStyle(0xffffff, pp);
        g.fillRoundedRect(pCx - 271.2 * sB / 2, py, 271.2 * sB, 153, 12);
        const prize = slot.prize;
        const kind = prize?.kind;
        let label = '未中奖';
        if ((kind === 'weapon' || kind === 'consumable') && prize.item) label = prize.item.name || '';
        else if (kind === 'gold') label = `金币 +${prize.amount ?? 0}`;
        if ((kind === 'weapon' || kind === 'consumable') && prize.item) {
          const icx = pCx, icy = py + 58;
          if (kind === 'weapon') {
            if (!getDesign(WEAPON_BG_ASSET)) ensureDesign(WEAPON_BG_ASSET);
            const bgD = getDesign(WEAPON_BG_ASSET);
            if (bgD) drawDesignCentered(g, bgD, icx, icy, 88 * 0.72, tSec);
            const app = getWeaponDef(prize.item.weaponId || prize.item.id)?.appearance;
            if (app) drawDesignCentered(g, app, icx, icy, 88 * 0.5, tSec);
          } else {
            const d = getArtRef(prize.item.artType, prize.item.artName);
            if (!d) resolveArtRef(prize.item.artType, prize.item.artName);
            else drawShopIcon(g, shopIcon(d, false), icx, icy, 88 * 0.5, tSec);
          }
        } else if (kind === 'gold') {
          drawDiamond(pCx, py + 58, 20, 0xffff00, pp);
        }
        ensure('vendorPrize', '30px', '#000000').setOrigin(0.5, 0.5)
          .setPosition(pCx, py + 120).setText(label).setAlpha(pp);
        if (now - slot.prizeAt > 1800) slot.prizeAt = 0;
      }

      // ── 右：商店 ──
      ensure('vendorBuyTitle', '72px', '#ffffff').setOrigin(0.5, 0.5).setPosition(1116, 156).setText('购买');

      const GB_CX = 1488;
      const sG = flipAt(180);
      g.fillStyle(0x000000, 1);
      g.fillRoundedRect(GB_CX - 324 * sG / 2, 30, 324 * sG, 72, 36);
      g.lineStyle(6, 0xffffff, 1);
      g.strokeRoundedRect(GB_CX - 324 * sG / 2, 30, 324 * sG, 72, 36);
      drawDiamond(GB_CX + (1359 - GB_CX) * sG, 64, 18, 0xffff00);
      ensure('vendorGoldValue', '36px', '#ffffff').setOrigin(0.5, 0.5)
        .setPosition(GB_CX + (1602 - GB_CX) * sG, 69).setText(`${gold}`);

      const cardX = [1050, 1410, 1050, 1410];
      const cardY = [228, 228, 618, 618];
      for (let i = 0; i < 4; i++) {
        const x0 = cardX[i], y0 = cardY[i], ccx = x0 + 142.5;
        const bCx = x0 + 141;
        const item = stock[i] || null;
        const bought = !!(this.isVendorBought && this.isVendorBought(i));
        if (vv.bought[i] === undefined) vv.bought[i] = bought;
        else if (!vv.bought[i] && bought) vv.flip[i] = { t0: now };
        vv.bought[i] = bought;
        let s = flipAt(60 + i * 30);
        let showBought = bought;
        const fl = vv.flip[i];
        if (fl) {
          const fp = Phaser.Math.Clamp((now - fl.t0) / 300, 0, 1);
          s *= Math.abs(1 - 2 * fp);
          showBought = fp >= 0.5;
          if (fp >= 1) { delete vv.flip[i]; s = flipAt(60 + i * 30); showBought = bought; }
        }
        g.fillStyle(showBought ? 0x000000 : 0xffffff, 1);
        g.fillRect(ccx - 285 * s / 2, y0, 285 * s, 324);
        if (showBought) {
          g.lineStyle(6, 0xffffff, 1);
          g.strokeRect(ccx - 285 * s / 2, y0, 285 * s, 324);
        }
        const iconCx = ccx + (x0 + 141 - ccx) * s;
        const iconCy = y0 + 129;
        const box = 150 * s;
        if (item && box > 1) {
          if (item.kind === 'weapon') {
            if (!getDesign(WEAPON_BG_ASSET)) ensureDesign(WEAPON_BG_ASSET);
            const bgD = getDesign(WEAPON_BG_ASSET);
            if (bgD) drawDesignCentered(g, bgD, iconCx, iconCy, box * 0.72, tSec);
            const app = getWeaponDef(item.weaponId || item.id)?.appearance;
            if (app) drawDesignCentered(g, showBought ? wh(app) : app, iconCx, iconCy, box * 0.5, tSec);
          } else {
            const d = getArtRef(item.artType, item.artName);
            if (d) drawDesignCentered(g, showBought ? wh(d) : shopIcon(d, false), iconCx, iconCy, box * 0.5, tSec);
            else {
              resolveArtRef(item.artType, item.artName);
              g.fillStyle(0xffffff, 1);
              g.fillCircle(iconCx, iconCy, box * 0.25);
            }
          }
        }
        const hit = up.x >= x0 + 30 && up.x <= x0 + 252 && up.y >= y0 + 252 && up.y <= y0 + 312;
        const insufficient = !item || gold < item.cost;
        const bId = `buyVendor_${i}`;
        const bScale = showBought ? 1 : (1 + 0.1 * hoverOf(bId, hit)) * this.pressScale(bId);
        const bw = 222 * s * bScale, bh = 60 * bScale;
        g.fillStyle(0x000000, 1);
        g.fillRoundedRect(bCx - bw / 2, y0 + 282 - bh / 2, bw, bh, 8);
        g.lineStyle(6, showBought ? 0xcfcfcf : (insufficient ? 0x666666 : 0xffffff), 1);
        g.strokeRoundedRect(bCx - bw / 2, y0 + 282 - bh / 2, bw, bh, 8);
        if (showBought) {
          ensure(`vendorItem_${i}_state`, '30px', '#ffffff').setOrigin(0.5, 0.5)
            .setPosition(bCx, y0 + 282).setScale(s, 1).setText('已购买');
        } else {
          drawDiamond(bCx - 27 * s, y0 + 282, 12 * s, 0xffff00);
          ensure(`vendorItem_${i}_price`, '30px', insufficient ? '#666666' : '#ffffff').setOrigin(0.5, 0.5)
            .setPosition(bCx + 15 * s, y0 + 285).setScale(s, 1).setText(`${item ? item.cost : 0}`);
          this.buttons.push({ id: bId, x: x0 + 30, y: y0 + 252, w: 222, h: 60 });
        }
      }
    },

    drawLevelSelect() {
      if (this.levelSelectPage === undefined) this.levelSelectPage = 1;
      this.levelSelectTexts = this.levelSelectTexts || new Map();
      for (const t of this.levelSelectTexts.values()) t.setVisible(false);
      const ensure = (id, size, color) => {
        let t = this.levelSelectTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1001);
          this.cameras.main.ignore(t);
          this.levelSelectTexts.set(id, t);
        }
        t.setVisible(true);
        return t;
      };
      if (this.levelSelectPage === 1) this.drawBigLevelSelect(ensure);
      else this.drawSmallLevelSelect(ensure);
    },

    // 页1：模式选关（2 卡：探险 / 守卫）
    drawBigLevelSelect(ensure) {
      const g = this.uiG;
      const now = this.time.now;
      // 80% 黑底遮罩
      g.fillStyle(0x000000, 0.8);
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      const playerLevel = this.saveSource()?.progress?.level ?? 1;
      const guardUnlocked = playerLevel >= 30;
      const modes = [
        { key: 'explore', title: '探险模式', desc: '在探索宇宙之路上与怪物战斗，获取战利品与成长经验', unlocked: true },
        { key: 'guard', title: '守卫模式', desc: '面对无尽的敌人攻势，守护目标，证明你的实力！', unlocked: guardUnlocked },
      ];
      const cardW = 460, cardH = 560, gap = 88;
      const startX = (VIEW_W - (cardW * 2 + gap)) / 2;
      const topY = 250;
      const up = this.uiPointer();
      // 翻牌出现动画
      const t = Math.min(1, (now - (this.levelSelectOpenAt ?? now)) / 460);
      const ease = 1 - Math.pow(1 - t, 3);
      const scl = 0.72 + 0.28 * ease;
      this.levelHover = this.levelHover || {};
      for (let i = 0; i < modes.length; i++) {
        const m = modes[i];
        const x = startX + i * (cardW + gap);
        const y = topY;
        const mx = x + cardW / 2, my = y + cardH / 2;
        const hover = up.x >= x && up.x <= x + cardW && up.y >= y && up.y <= y + cardH;
        const target = hover ? 1 : 0;
        const cur = this.levelHover[m.key] || 0;
        this.levelHover[m.key] = cur + (target - cur) * 0.16;
        const hov = this.levelHover[m.key];
        const cs = scl * (1 + 0.1 * hov);
        const rx = mx + (x - mx) * cs, ry = my + (y - my) * cs;
        const rw = cardW * cs, rh = cardH * cs;
        // 卡底
        g.fillStyle(m.unlocked ? 0xffffff : 0xCFCFCF, 1);
        g.fillRoundedRect(rx, ry, rw, rh, 14);
        // 灰色缩略图占位（上半）
        const thW = (cardW - 80) * cs, thH = cardH * 0.44 * cs;
        g.fillStyle(0x999999, 1);
        g.fillRoundedRect(mx + (x + 40 - mx) * cs, my + (y + 36 - my) * cs, thW, thH, 8);
        // 标题（黑色放大）
        const ty = my + (y + 40 + cardH * 0.44 + 54 - my) * cs;
        ensure(`mode_${m.key}_title`, '46px', '#222222').setOrigin(0.5, 0).setPosition(mx, ty).setText(m.title);
        // 描述（灰色小字）
        const dy = my + (y + 40 + cardH * 0.44 + 118 - my) * cs;
        ensure(`mode_${m.key}_desc`, '20px', '#888888').setOrigin(0.5, 0).setPosition(mx, dy).setText(m.desc);
        if (!m.unlocked) drawLock(g, mx + (x + cardW - 66 - mx) * cs, my + (y + 40 - my) * cs, 20);
        this.buttons.push({ id: `levelMode_${m.key}`, x: rx, y: ry, w: rw, h: rh, node: { key: m.key, unlocked: m.unlocked } });
      }
    },

    // 页2：探险子关选关（黑底灰网格可拖 + 3 平行四边形按钮 + 旋转圆环）
    drawSmallLevelSelect(ensure) {
      const g = this.uiG;
      const now = this.time.now;
      const pan = this.smallLevelPan || { x: 0, y: 0 };
      // 黑底 + 灰色 20px 网格
      g.fillStyle(0x000000, 1);
      g.fillRect(0, 0, VIEW_W, VIEW_H);
      g.lineStyle(1, 0x333333, 1);
      for (let gx = pan.x % 20; gx <= VIEW_W; gx += 20) g.lineBetween(gx, 0, gx, VIEW_H);
      for (let gy = pan.y % 20; gy <= VIEW_H; gy += 20) g.lineBetween(0, gy, VIEW_W, gy);
      const completed = this.saveSource()?.levels?.completed || [];
      const unlocked = n => n === 1 || completed.includes(`Level1-Scene${n - 1}`);
      const nodes = [
        { n: 1, wx: 980, wy: 600, label: '1-1 “深蓝”号', levelId: 'Level1-Scene1' },
        { n: 2, wx: 1310, wy: 730, label: '1-2 苍赫之境', levelId: 'Level1-Scene2' },
        { n: 3, wx: 1640, wy: 650, label: '1-3 破败王座', levelId: 'Level1-Scene3' },
      ];
      const up = this.uiPointer();
      this.levelHover = this.levelHover || {};
      this.levelConn = this.levelConn || {};
      for (const nd of nodes) {
        const lock = !unlocked(nd.n);
        const bw = 232, bh = 56, skew = 40;
        const bx = nd.wx + pan.x, by = nd.wy + pan.y;
        const cxm = bx + bw / 2, cym = by + bh / 2;
        const hover = up.x >= bx && up.x <= bx + bw && up.y >= by && up.y <= by + bh;
        const target = hover ? 1 : 0;
        const curH = this.levelHover[`sl${nd.n}`] || 0;
        this.levelHover[`sl${nd.n}`] = curH + (target - curH) * 0.16;
        const hs = 1 + 0.1 * this.levelHover[`sl${nd.n}`];
        // 旋转双弧圆环（科技感），位于按钮左上
        const ringX = bx - 30, ringY = by - 30;
        this.drawTechRing(g, ringX, ringY, 23, now);
        // 圆环 → 按钮 白色连线，仅悬停显示并逐渐伸展
        const curC = this.levelConn[`sl${nd.n}`] || 0;
        this.levelConn[`sl${nd.n}`] = curC + (target - curC) * 0.18;
        const conn = this.levelConn[`sl${nd.n}`];
        if (conn > 0.02) {
          g.lineStyle(2, 0xffffff, conn * 0.9);
          const ex0 = ringX, ey0 = ringY;
          const ex1 = cxm + (ex0 - cxm) * (1 - conn);
          const ey1 = cym + (ey0 - cym) * (1 - conn);
          g.lineBetween(ex1, ey1, ex0, ey0);
        }
        // 平行四边形按钮（悬停放大 10%，绕中心缩放）
        const sbw = bw * hs, sbh = bh * hs;
        const sbx = cxm - sbw / 2, sby = cym - sbh / 2;
        const ssk = skew * hs;
        g.fillStyle(lock ? 0x585858 : 0xffffff, 1);
        g.beginPath();
        g.moveTo(sbx + ssk / 2, sby);
        g.lineTo(sbx + sbw + ssk / 2, sby);
        g.lineTo(sbx + sbw - ssk / 2, sby + sbh);
        g.lineTo(sbx - ssk / 2, sby + sbh);
        g.closePath();
        g.fillPath();
        // 标签
        ensure(`sl_${nd.n}_label`, '24px', lock ? '#999999' : '#111111').setOrigin(0.5, 0.5).setPosition(cxm, cym).setText(nd.label);
        if (lock) drawLock(g, sbx + sbw - 30, cym, 16);
        this.buttons.push({ id: `levelSmall_${nd.n}`, x: sbx, y: sby, w: sbw, h: sbh, node: { levelId: nd.levelId, unlocked: !lock } });
      }
      // 返回页1 按钮
      const bbx = 90, bby = 90, bbw = 96, bbh = 56;
      const bhiover = up.x >= bbx && up.x <= bbx + bbw && up.y >= bby && up.y <= bby + bbh;
      g.fillStyle(bhiover ? 0xffffff : 0x111111, 1);
      g.fillRoundedRect(bbx, bby, bbw, bbh, 8);
      g.lineStyle(2, 0xffffff, 1);
      g.strokeRoundedRect(bbx, bby, bbw, bbh, 8);
      ensure('levelBack', '24px', bhiover ? '#111111' : '#ffffff').setOrigin(0.5, 0.5).setPosition(bbx + bbw / 2, bby + bbh / 2).setText('返回');
      this.buttons.push({ id: 'levelBack', x: bbx, y: bby, w: bbw, h: bbh });
    },

    drawTechRing(g, cx, cy, r, now) {
      const a = now * 0.0006;
      g.lineStyle(2, 0xffffff, 0.85);
      g.beginPath(); g.arc(cx, cy, r, a, a + Math.PI); g.strokePath();
      g.beginPath(); g.arc(cx, cy, r, a + Math.PI, a + Math.PI * 2); g.strokePath();
      g.lineStyle(1.5, 0xffb570, 0.85);
      g.beginPath(); g.arc(cx, cy, r * 0.62, -a * 1.3, -a * 1.3 + Math.PI); g.strokePath();
      g.beginPath(); g.arc(cx, cy, r * 0.62, -a * 1.3 + Math.PI, -a * 1.3 + Math.PI * 2); g.strokePath();
    },

    drawWeaponShop(node) {
      const ctx = this.ctx;
      const g = this.uiG;
      const source = this.saveSource();
      const gold = source?.currency?.gold ?? 0;
      const gems = source?.currency?.gems ?? 0;

      if (this.shopTab === undefined) this.shopTab = 'weapon';
      if (this.shopScroll === undefined) this.shopScroll = 0;
      this.shopScroll = this.shopScroll || 0;

      this.weaponShopTexts = this.weaponShopTexts || new Map();
      for (const t of this.weaponShopTexts.values()) t.setVisible(false);
      const ensure = (id, size, colorStr = '#ffffff') => {
        let t = this.weaponShopTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color: colorStr }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.weaponShopTexts.set(id, t);
        }
        t.setFontSize(size).setColor(colorStr).setVisible(true);
        return t;
      };

      // 布局参数
      const cardsPerRow = node.cardsPerRow || 5;
      const cardW = node.cardW || 300;
      const cardH = node.cardH || 300;
      const gapX = node.gapX || 24;
      const gapY = node.gapY || 24;
      const gridX = node.gridX ?? 260;
      const gridY = node.gridY ?? 140;
      const gridW = node.gridW ?? 1640;
      const gridH = node.gridH ?? 820;
      const padV = node.padV ?? 44;
      const areaY = gridY + padV, areaH = Math.max(1, gridH - padV * 2);
      const tabX = node.tabX ?? 56;
      const tabY = node.tabY ?? 140;
      const tabW = node.tabW ?? 150;
      const tabH = node.tabH ?? 64;
      const tabGap = node.tabGap ?? 16;
      const titleX = node.titleX ?? 56;
      const titleY = node.titleY ?? 40;
      const curX = node.curX ?? 1500;
      const curY = node.curY ?? 56;

      // 顶部标题
      ensure('shopTitle', '34px', '#ffffff').setOrigin(0, 0).setPosition(titleX, titleY).setText('商店');

      // 右上货币区（黄菱形=金币，青菱形=绿币）
      const drawDiamond = (cx, cy, r, color) => {
        g.fillStyle(color, 1);
        g.beginPath();
        g.moveTo(cx, cy - r);
        g.lineTo(cx + r, cy);
        g.lineTo(cx, cy + r);
        g.lineTo(cx - r, cy);
        g.closePath();
        g.fillPath();
      };
      drawDiamond(curX, curY, 12, 0xffd54f);
      ensure('shopGold', '22px', '#ffd54f').setOrigin(0, 0.5).setPosition(curX + 22, curY).setText(`${gold}`);
      drawDiamond(curX + 155, curY, 12, 0x00e5ff);
      ensure('shopGems', '22px', '#00e5ff').setOrigin(0, 0.5).setPosition(curX + 177, curY).setText(`${gems}`);

      // 商品网格背景（黑色面板、无边框）
      g.fillStyle(0x0a0a0a, 1);
      g.fillRoundedRect(gridX - 16, gridY - 16, gridW + 32, gridH + 32, 12);

      // 左侧页签（无边框；选中=白色平行四边形；悬停=加粗+放大20%；切换时平行四边形滑动）
      const up = this.uiPointer();
      const tabs = [['weapon', '武器'], ['mod', '改件'], ['pet', '宠物'], ['relic', '圣物']];
      const tabList = tabs.map(([id, label], i) => ({ id, label, x: tabX, y: tabY + i * (tabH + tabGap) }));
      this.shopHoverT = this.shopHoverT || {};
      if (this.shopTabPrev === undefined) this.shopTabPrev = this.shopTab;
      if (this.shopTab !== this.shopTabPrev) {
        const from = tabList.find(t => t.id === this.shopTabPrev), to = tabList.find(t => t.id === this.shopTab);
        if (from && to) this.shopTabAnim = { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, t0: this.time.now, dur: 260 };
        this.shopTabPrev = this.shopTab;
      }
      const selTab = tabList.find(t => t.id === this.shopTab) || tabList[0];
      let px = selTab.x, py = selTab.y;
      if (this.shopTabAnim) {
        const p = Phaser.Math.Clamp((this.time.now - this.shopTabAnim.t0) / this.shopTabAnim.dur, 0, 1);
        const e = 1 - Math.pow(1 - p, 3);
        px = this.shopTabAnim.fromX + (this.shopTabAnim.toX - this.shopTabAnim.fromX) * e;
        py = this.shopTabAnim.fromY + (this.shopTabAnim.toY - this.shopTabAnim.fromY) * e;
        if (p >= 1) this.shopTabAnim = null;
      }
      // 选中页签背后的白色长方形（长度比页签减少 20%，后按需求 +15%）
      const rectW = Math.round(tabW * 0.92);
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(px + 14, py, rectW, tabH, 6);

      for (const t of tabList) {
        const sel = this.shopTab === t.id;
        const hov = up.x >= t.x && up.x <= t.x + tabW && up.y >= t.y && up.y <= t.y + tabH;
        this.shopHoverT[t.id] = Phaser.Math.Clamp((this.shopHoverT[t.id] || 0) + (hov ? 0.18 : -0.18), 0, 1);
        const ht = this.shopHoverT[t.id];
        const scl = 1 + 0.2 * ht;
        ensure(`shopTabText_${t.id}`, '26px', sel ? '#000000' : (ht > 0.5 ? '#ffffff' : '#cccccc'))
          .setOrigin(0, 0.5).setPosition(t.x + 30, t.y + tabH / 2)
          .setFontStyle(sel || ht > 0.5 ? 'bold' : 'normal').setScale(scl).setText(t.label);
        this.buttons.push({ id: `shopTab_${t.id}`, x: t.x, y: t.y, w: tabW, h: tabH });
      }

      // 裁剪区（懒建：mask 源 G + 卡片内容 G 挂持久 mask；每帧刷新网格裁剪区，避免卡片滚动超框）
      if (!this.shopCardMaskG) {
        this.shopCardMaskG = this.add.graphics().setDepth(999);
        this.shopCardMask = new Phaser.Display.Masks.GeometryMask(this, this.shopCardMaskG);
        this.cameras.main.ignore(this.shopCardMaskG);
        this.shopCardContentG = this.add.graphics().setDepth(1001);
        this.shopCardContentG.setMask(this.shopCardMask);
        this.cameras.main.ignore(this.shopCardContentG);
      }
      this.shopCardMaskG.clear();
      this.shopCardMaskG.fillStyle(0xffffff, 0);
      this.shopCardMaskG.fillRect(gridX, areaY, gridW, areaH);

      // 构建卡片数据（按页签分支）
      let items = [];
      if (this.shopTab === 'weapon') {
        // 武器编辑系统已注册武器（weaponCatalog，不含基础武器 radial），新注册武器自动同步出现
        const types = weaponCatalog().filter(t => t !== 'radial');
        items = types.map(type => {
          const def = getWeaponDef(type);
          return {
            kind: 'weapon', type, id: type,
            name: def?.name || WEAPON_LABELS[type] || type,
            unlockLevel: def?.unlockLevel ?? 1,
            appearance: (def?.appearance && Array.isArray(def.appearance.elements) && def.appearance.elements.length) ? def.appearance : null,
            price: node.prices?.[type] ?? def?.price,
            owned: !!source?.weapons?.[type]?.unlocked
          };
        });
      } else if (this.shopTab === 'mod') {
        const owned = new Set();
        for (const [id, itemDef] of Object.entries(ITEM_DEFS)) {
          if (itemDef.category !== 'mod') continue;
          const has = itemDef.stackable
            ? (source?.items?.stacks?.[id] ?? 0) > 0
            : (source?.items?.uniques || []).some(u => u.itemId === id);
          if (has) owned.add(id);
        }
        items = Object.entries(MOD_DEFS).map(([id, def]) => ({
          kind: 'mod', type: id, id, name: def.name, def,
          price: node.modPrices?.[id],
          owned: owned.has(id)
        }));
      } else if (this.shopTab === 'pet') {
        items = listPetDefs().map(pd => ({
          kind: 'pet', type: pd.id, id: pd.id, name: pd.name || pd.id,
          price: pd.price, unlockLevel: pd.unlockLevel ?? 1, icon: pd.art,
          owned: (source?.items?.uniques || []).some(u => u.itemId === pd.id)
        }));
      } else if (this.shopTab === 'relic') {
        items = Array.from({ length: cardsPerRow }, (_, i) => ({ kind: 'todo', type: `todo_${i}`, id: `todo_${i}`, name: '敬请期待' }));
      }

      // 纵向滚动状态
      this.shopCardRects = [];
      this.shopScrollArea = { x: gridX, y: areaY, w: gridW, h: areaH };
      const rows = Math.ceil(items.length / cardsPerRow);
      const contentHeight = rows * (cardH + gapY) - gapY;
      this.shopMaxScroll = Math.max(0, contentHeight - areaH);
      this.shopScroll = Phaser.Math.Clamp(this.shopScroll, 0, this.shopMaxScroll);

      // 绘制商品卡（卡片形状画进持久 mask 的 contentG，文本各自 setMask；纵向滚动）
      const cardG = this.shopCardContentG;
      cardG.clear();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const col = i % cardsPerRow;
        const row = Math.floor(i / cardsPerRow);
        const cardX = gridX + col * (cardW + gapX);
        const cardY = areaY + row * (cardH + gapY) - this.shopScroll;
        if (cardY + cardH < areaY || cardY > areaY + areaH) continue;
        this.shopCardRects.push({ type: it.type, x: cardX, y: cardY, w: cardW, h: cardH });

        cardG.fillStyle(0xffffff, 1);
        cardG.fillRoundedRect(cardX, cardY, cardW, cardH, 10);

        if (it.kind === 'weapon') {
          // 卡片中央：固定「武器图标背景」资产（下层）+ 武器外观 appearance（上层）叠加
          const tNow = this.time.now / 1000;
          if (!getDesign(WEAPON_BG_ASSET)) ensureDesign(WEAPON_BG_ASSET);
          const bgD = getDesign(WEAPON_BG_ASSET);
          if (bgD) drawDesignCentered(cardG, bgD, cardX + cardW / 2, cardY + cardH * 0.30, cardW * 0.72, tNow);
          if (it.appearance) drawDesignCentered(cardG, it.appearance, cardX + cardW / 2, cardY + cardH * 0.30, cardW * 0.5, tNow);
          else drawWeaponGlyph(cardG, cardX + cardW / 2, cardY + cardH * 0.30, it.type, false, 52);
          ensure(`${it.kind}_${it.id}_name`, '26px', '#000000')
            .setMask(this.shopCardMask).setOrigin(0.5, 0.5)
            .setPosition(cardX + cardW / 2, cardY + cardH * 0.64).setText(it.name);
        } else {
          const nameY = it.kind === 'pet' ? cardY + cardH * 0.66 : cardY + cardH * 0.34;
          ensure(`${it.kind}_${it.id}_name`, '30px', '#000000')
            .setMask(this.shopCardMask).setOrigin(0.5, 0.5)
            .setPosition(cardX + cardW / 2, nameY).setText(it.name);

          if (it.kind === 'pet' && it.icon) {
            // 卡片中央：固定「武器图标背景」资产（下层）+ 宠物外形（上层）叠加，与武器卡一致
            const tNow = this.time.now / 1000;
            if (!getDesign(WEAPON_BG_ASSET)) ensureDesign(WEAPON_BG_ASSET);
            const bgD = getDesign(WEAPON_BG_ASSET);
            if (bgD) drawDesignCentered(cardG, bgD, cardX + cardW / 2, cardY + cardH * 0.34, cardW * 0.72, tNow);
            if (!getDesign(it.icon)) ensureDesign(it.icon);
            const iconD = getDesign(it.icon);
            if (iconD) drawDesignCentered(cardG, iconD, cardX + cardW / 2, cardY + cardH * 0.34, cardW * 0.5, tNow);
          }

          if (it.kind === 'mod' && it.def) {
            const tag = it.def.weapon ? `专属·${getWeaponDef(it.def.weapon)?.name || WEAPON_LABELS[it.def.weapon] || it.def.weapon}` : '通用';
            ensure(`mod_${it.id}_tag`, '15px', '#666666')
              .setMask(this.shopCardMask).setOrigin(0.5, 0.5)
              .setPosition(cardX + cardW / 2, cardY + cardH * 0.34 + 34).setText(tag);
          }

          if (it.kind === 'todo') {
            ensure(`todo_${it.id}_hint`, '16px', '#777777')
              .setMask(this.shopCardMask).setOrigin(0.5, 0.5)
              .setPosition(cardX + cardW / 2, cardY + cardH - 56).setText('（开发中）');
            continue;
          }
        }

        if (it.owned) {
          ensure(`${it.kind}_${it.id}_state`, '18px', '#555555')
            .setMask(this.shopCardMask).setOrigin(0.5, 0.5)
            .setPosition(cardX + cardW / 2, cardY + cardH - 52).setText('已拥有');
          continue;
        }

        const price = it.price;

        // 武器/宠物卡未达解锁等级：锁图标 + 「到达xx级后解锁」；mod 无解锁等级走下方小锁
        if (it.unlockLevel != null) {
          const level = source?.progress?.level ?? 1;
          if (level < it.unlockLevel) {
            drawLock(cardG, cardX + cardW / 2, cardY + cardH * 0.72, 20);
            ensure(`${it.kind}_${it.id}_lock`, '16px', '#999999')
              .setMask(this.shopCardMask).setOrigin(0.5, 0.5)
              .setPosition(cardX + cardW / 2, cardY + cardH * 0.72 + 36).setText(`到达${it.unlockLevel}级后解锁`);
            continue;
          }
        } else {
          drawLock(cardG, cardX + cardW / 2, cardY + cardH - 118, 22);
        }

        if (price != null) {
          const bw = cardW - 56, bh = 44, bx = cardX + 28, by = cardY + cardH - 62;
          const btnId = it.kind === 'weapon' ? `buyWeapon_${it.type}` : it.kind === 'pet' ? `buyPet_${it.id}` : `buyMod_${it.id}`;
          // 购买按钮：黑底；金币图标 + 价格数字（替换「购买」字样）；鼠标聚焦放大 10%
          const hover = up.x >= bx && up.x <= bx + bw && up.y >= by && up.y <= by + bh;
          this.shopBuyHover = this.shopBuyHover || {};
          this.shopBuyHover[btnId] = Phaser.Math.Clamp((this.shopBuyHover[btnId] || 0) + (hover ? 0.18 : -0.18), 0, 1);
          const sc = 1 + 0.1 * this.shopBuyHover[btnId];
          const cbx = bx + bw / 2, cby = by + bh / 2;
          const rw = bw * sc, rh = bh * sc, rx = cbx - rw / 2, ry = cby - rh / 2;
          cardG.fillStyle(0x111111, 1);
          cardG.fillRoundedRect(rx, ry, rw, rh, 6);
          cardG.lineStyle(1, 0x000000, 1);
          cardG.strokeRoundedRect(rx, ry, rw, rh, 6);
          // 金币图标（黄菱形）：画到 cardG（与按钮同层，depth 1001），drawDiamond 画到 uiG(depth 1000) 会被按钮黑底盖住
          cardG.fillStyle(0xffd54f, 1);
          cardG.beginPath();
          cardG.moveTo(cbx - 32, cby - 11);
          cardG.lineTo(cbx - 21, cby);
          cardG.lineTo(cbx - 32, cby + 11);
          cardG.lineTo(cbx - 43, cby);
          cardG.closePath();
          cardG.fillPath();
          ensure(`${it.kind}_${it.id}_price`, '18px', '#ffffff')
            .setMask(this.shopCardMask).setOrigin(0.5, 0.5)
            .setPosition(cbx + 18, cby).setText(`${price}`);
          this.buttons.push({ id: btnId, x: bx, y: by, w: bw, h: bh, node: it.kind === 'weapon' ? { type: it.type, price } : { id: it.id, price } });
        }
      }
    },

    handleShopPointerDown() {
      const up = this.uiPointer();
      const area = this.shopScrollArea;
      if (area && up.x >= area.x && up.x <= area.x + area.w && up.y >= area.y && up.y <= area.y + area.h) {
        const onCard = (this.shopCardRects || []).some(r => up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h);
        if (!onCard) {
          this.shopScrollDrag = { startY: up.y, scroll: this.shopScroll || 0 };
          return true;
        }
      }
      return false;
    },

    updateShopScrollDrag() {
      if (!this.shopScrollDrag) return;
      const up = this.uiPointer();
      this.shopScroll = Phaser.Math.Clamp(this.shopScrollDrag.scroll - (up.y - this.shopScrollDrag.startY), 0, this.shopMaxScroll || 0);
      this.drawUI();
    },

    handleShopPointerUp() {
      this.shopScrollDrag = null;
    },

    buyWeapon(type) {
    const ctx = this.ctx;
      const source = this.saveSource();
      const node = ctx.state.ui?.weapon || {};
      const price = (node.prices || {})[type];
      if (price == null || !source) return;
      if ((source.currency?.gold ?? 0) < price) return;
      if (source.weapons?.[type]?.unlocked) return;
      source.currency.gold -= price;
      if (source.weapons?.[type]) source.weapons[type].unlocked = true;
      if (this.player) {
        this.player.gold = source.currency.gold;
        if (Array.isArray(this.player.weapons) && !this.player.weapons.includes(type)) {
          this.player.weapons.push(type);
          this.player.ammo = this.player.ammo || {};
          this.player.ammo[type] = WEAPONS[type]?.maxAmmo ?? Infinity;
        }
      }
      this.syncUIState();
      this.persistSave(source);
    },

    buyMod(id) {
    const ctx = this.ctx;
      const source = this.saveSource();
      const node = ctx.state.ui?.weapon || {};
      const price = (node.modPrices || {})[id];
      const def = ITEM_DEFS[id];
      if (price == null || !source || !def) return;
      if ((source.currency?.gold ?? 0) < price) return;
      source.currency = source.currency || { gold: 0 };
      source.items = source.items || { stacks: {}, uniques: [] };
      if (def.stackable) {
        const stacks = source.items.stacks || (source.items.stacks = {});
        stacks[id] = (stacks[id] || 0) + 1;
      } else {
        const uniques = source.items.uniques || (source.items.uniques = []);
        if (uniques.some(u => u.itemId === id)) return;
        uniques.push({ uid: `u-${id}`, itemId: id });
      }
      source.currency.gold -= price;
      if (this.player) {
        this.player.gold = source.currency.gold;
        this.player.items = source.items;
      }
      this.syncUIState();
      this.persistSave(source);
    },

    buyPet(id) {
    const ctx = this.ctx;
      const source = this.saveSource();
      const def = getPetDef(id);
      if (!def || !source) return;
      const price = def.price;
      if (price == null) return;
      if ((source.currency?.gold ?? 0) < price) return;
      source.currency = source.currency || { gold: 0 };
      source.items = source.items || { stacks: {}, uniques: [] };
      const uniques = source.items.uniques || (source.items.uniques = []);
      if (uniques.some(u => u.itemId === id)) return;
      uniques.push({ uid: `u-${id}`, itemId: id });
      source.currency.gold -= price;
      if (this.player) {
        this.player.gold = source.currency.gold;
        this.player.items = source.items;
      }
      this.syncUIState();
      this.persistSave(source);
    },

    // 关卡结算全屏页：成功(撤离成功)/失败(撤离失败)共用。
    // 布局按设计稿 320×180 面板映射：screenX=(dx-485)*6, screenY=(dy-376)*6。
    drawSettlement() {
      const ctx = this.ctx;
      const g = this.uiG;
      // 结算动画进度：首次进入记录起始时间，之后用 time.now 差值驱动（不改 update 循环）
      const now = this.time.now;
      if (this.settleStart === undefined) this.settleStart = now;
      const t = now - this.settleStart;

      this.settleTexts = this.settleTexts || new Map();
      const ensure = (id, size, color = '#ffffff') => {
        let tt = this.settleTexts.get(id);
        if (!tt) {
          tt = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1001);
          this.cameras.main.ignore(tt);
          this.settleTexts.set(id, tt);
        }
        tt.setFontSize(size).setColor(color).setVisible(true);
        return tt;
      };
      // 出现进度：0..1（delay 起播）
      const appear = (delay, dur = 420) => Phaser.Math.Clamp((t - delay) / dur, 0, 1);
      // 数字从 0 递增到 target 的 count-up（delay 起播）
      const countUp = (target, delay, dur = 650) =>
        Math.min(target, Math.floor(target * Phaser.Math.Clamp((t - delay) / dur, 0, 1)));

      // 全屏黑底
      g.fillStyle(0x000000, 1);
      g.fillRect(0, 0, VIEW_W, VIEW_H);

      // ── 数据 ──
      const win = this.state === 'end';
      const levelId = ctx.state.levelId || '';
      const lv = /^Level(\d+)-Scene(\d+)$/.exec(levelId);
      const big = lv ? Number(lv[1]) : 1;
      const scene = lv ? Number(lv[2]) : 1;
      const completed = this.saveSource()?.levels?.completed || [];
      const pass = (s) => completed.includes(`Level${big}-Scene${s}`);
      const killTally = this.killTally || {};
      // 局内收获：drops.js 累加（collectDrop），restart() 归零
      const runGold = this.runGoldGained || 0;
      const runExp = this.runExpGained || 0;

      // ── 标题（锚点左对齐）──
      ensure('settleTitle', '84px', win ? SETTLE_SUCCESS_COLOR : SETTLE_FAIL_COLOR)
        .setOrigin(0, 0).setPosition(60, 51).setText(win ? '撤离成功' : '撤离失败').setAlpha(appear(0));

      // ── 「进度」标签 ──
      ensure('progLabel', '48px', '#ffffff')
        .setOrigin(0, 0).setPosition(78, 187).setText('进度').setAlpha(appear(260));

      // ── 3 个进度球 ──
      const BALL_X = [564, 942, 1308];
      const BALL_Y = 366, BALL_R = SETTLE_BALL_R;
      const ballAp = appear(260);
      for (let s = 1; s <= 3; s++) {
        const cx = BALL_X[s - 1];
        const isPass = pass(s);
        if (isPass) {
          g.fillStyle(0x33ff33, 1);
          g.fillCircle(cx, BALL_Y, BALL_R);
          g.lineStyle(3, 0xffffff, 1);
          g.strokeCircle(cx, BALL_Y, BALL_R);
          // 白色 ✓
          g.lineStyle(6, 0xffffff, 1);
          g.lineBetween(cx - 16, BALL_Y + 2, cx - 5, BALL_Y + 13);
          g.lineBetween(cx - 5, BALL_Y + 13, cx + 18, BALL_Y - 16);
        } else {
          g.fillStyle(0xffffff, 0.12);
          g.fillCircle(cx, BALL_Y, BALL_R);
          g.lineStyle(3, 0xffffff, 1);
          g.strokeCircle(cx, BALL_Y, BALL_R);
        }
        ensure(`ball_${s}`, '48px', '#ffffff')
          .setOrigin(0.5, 0).setPosition(cx, BALL_Y + 60).setText(`${big}-${s}`).setAlpha(ballAp);
      }

      // ── 相邻两球都过关 → 白色水平连线（左→右延展动画）──
      for (let s = 1; s <= 2; s++) {
        if (!(pass(s) && pass(s + 1))) continue;
        const xL = BALL_X[s - 1] + BALL_R, xR = BALL_X[s] - BALL_R;
        const lineW = xR - xL;
        const prog = appear(620 + (s - 1) * 160);
        if (prog > 0) {
          g.fillStyle(0xffffff, 1);
          g.fillRect(xL, 357, lineW * prog, 18);
        }
      }

      // ── 「击败列表」标签 ──
      ensure('killLabel', '48px', '#ffffff')
        .setOrigin(0, 0).setPosition(120, 534).setText('击败列表').setAlpha(appear(560));

      // ── 击败行：敌人图标 + ×N（逐个浮现 + count-up）──
      const killTypes = Object.entries(killTally).filter(([, c]) => c > 0);
      const rowY0 = 580, rowH = 64;
      killTypes.slice(0, 5).forEach(([type, count], i) => {
        const delay = 600 + i * 220;
        const rowY = rowY0 + i * rowH;
        const ap = appear(delay);
        if (ap > 0) {
          drawEnemyShape(g, { type, x: 470, y: rowY }, false, null, 0);
          ensure(`kill_${type}`, '44px', '#ffffff')
            .setOrigin(0, 0.5).setPosition(545, rowY)
            .setText(`×${countUp(count, delay)}`).setAlpha(ap);
        } else {
          const tt = this.settleTexts.get(`kill_${type}`);
          if (tt) tt.setVisible(false);
        }
      });

      // ── 「本局收获」标签 ──
      ensure('gainLabel', '48px', '#ffffff')
        .setOrigin(0, 0).setPosition(120, 738).setText('本局收获').setAlpha(appear(700));

      // ── 收获行：金币(黄菱) + 经验(青菱)，各带 ×N count-up ──
      const drawDiamond = (cx, cy, r, colorN) => {
        g.fillStyle(colorN, 1);
        g.beginPath();
        g.moveTo(cx, cy - r);
        g.lineTo(cx + r, cy);
        g.lineTo(cx, cy + r);
        g.lineTo(cx - r, cy);
        g.closePath();
        g.fillPath();
      };
      const gainDelay = 700 + killTypes.length * 220 + 120;
      const goldAp = appear(gainDelay), expAp = appear(gainDelay + 180);
      if (goldAp > 0) {
        drawDiamond(676, 783, 16, 0xffff00);
        ensure('goldGain', '44px', '#ffffff')
          .setOrigin(0, 0.5).setPosition(676 + 34, 783)
          .setText(`×${countUp(runGold, gainDelay)}`).setAlpha(goldAp);
      } else if (this.settleTexts.get('goldGain')) this.settleTexts.get('goldGain').setVisible(false);
      if (expAp > 0) {
        drawDiamond(942, 783, 16, 0x33ffff);
        ensure('expGain', '44px', '#ffffff')
          .setOrigin(0, 0.5).setPosition(942 + 34, 783)
          .setText(`×${countUp(runExp, gainDelay + 180)}`).setAlpha(expAp);
      } else if (this.settleTexts.get('expGain')) this.settleTexts.get('expGain').setVisible(false);

      // ── 「回到大厅」按钮 ──
      const up = this.uiPointer();
      const bx = 1450, by = 930, bw = 200, bh = 80;
      const hover = up.x >= bx && up.x <= bx + bw && up.y >= by && up.y <= by + bh;
      const scl = this.pressScale('settleHome');
      const cw = bw * scl, ch = bh * scl;
      const cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2;
      const btnAp = appear(gainDelay + 360);
      g.fillStyle(hover ? 0xffffff : 0x1a1a1a, btnAp);
      g.fillRoundedRect(cx, cy, cw, ch, 12);
      g.lineStyle(2, hover ? 0x000000 : 0xffffff, btnAp);
      g.strokeRoundedRect(cx, cy, cw, ch, 12);
      if (btnAp > 0) {
        g.fillStyle(hover ? 0x000000 : 0xffffff, btnAp);
        g.fillCircle(bx + 40, by + bh / 2, 20);
        ensure('settleHome', '30px', hover ? '#000000' : '#ffffff')
          .setOrigin(0.5).setPosition(bx + 120, by + bh / 2).setText('回到大厅').setAlpha(btnAp);
      } else if (this.settleTexts.get('settleHome')) this.settleTexts.get('settleHome').setVisible(false);
      this.buttons.push({ id: 'settleHome', x: bx, y: by, w: bw, h: bh });
    },
};
