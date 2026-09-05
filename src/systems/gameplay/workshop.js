/**
 * 文件职责：工坊页（背包装备 / 武器与改件装卸 / 加点 / 长按拖拽交互）
 * 归属分类：系统玩法
 * 主要导出：WorkshopMixin（19 个方法）
 * 依赖：systems/constants.js、systems/combat/weapons.js、systems/ui/entity-art.js、systems/ui/ui-runtime.js、systems/economy/progression.js、ui-layer.js、state.js
 */
import Phaser from 'phaser';
import { FONT_TECH_SC, PLAYER_ART, VIEW_W, VIEW_H, WEAPON_BG_ASSET } from '../constants.js';
import { WEAPONS } from '../combat/weapons.js';
import { color, drawHexRingPlayer } from '../ui/entity-art.js';
import { WEAPON_SLOT_LEVELS } from '../ui/ui-runtime.js';
import { UPGRADE_STATS } from '../economy/progression.js';
import { drawWeaponGlyph, drawLock } from '../../ui-layer.js';
import { WEAPON_LABELS, ITEM_DEFS } from '../../state.js';
import { weaponCatalog } from '../../player-data.js';
import { getWeaponDef, getModCaps } from '../art/weapon-store.js';
import { renderAsset, renderAssetFit, drawDesignCentered } from '../art/asset-render.js';
import { getDesign, ensureDesign } from '../art/design-store.js';
import { buildWeaponRuntimeEntry } from '../art/weapon-runtime.js';

export const WorkshopMixin = {
    drawWorkshopUI() {
      const g = this.uiG;
      const source = this.saveSource() || {};
      const progress = source.progress || {};
      const level = progress.level ?? this.player?.level ?? 1;
      const exp = progress.exp ?? 0;
      const expToNext = progress.expToNext ?? 100;
      const spendable = progress.points ?? 0;
      const combat = source.combat || {};
      const points = source.points || {};
      const equipment = source.equipment || { weaponMods: {}, relics: [], pets: [] };
      const items = source.items || { stacks: {}, uniques: [] };
      const weaponsState = source.weapons || {};
      const loadout = Array.isArray(source.loadout) ? source.loadout : ['radial'];

      if (!this.workshopTexts) this.workshopTexts = new Map();
      if (this.workshopSelectedSlot == null) this.workshopSelectedSlot = 0;
      const labels = this.workshopTexts;
      for (const t of labels.values()) t.setVisible(false);
      const ensure = (id, size, colorStr = '#ffffff') => {
        let t = labels.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', {
            fontFamily: FONT_TECH_SC,
            fontSize: size, color: colorStr
          }).setDepth(1001);
          this.cameras.main.ignore(t);
          labels.set(id, t);
        }
        t.setFontSize(size);
        t.setColor(colorStr);
        t.setVisible(true);
        return t;
      };

      // 懒加载带画板资产图标的改件设计稿（三发/多轨等），首个工坊帧触发一次
      if (!this._modIconDesignsLoaded) {
        this._modIconDesignsLoaded = true;
        for (const def of Object.values(ITEM_DEFS)) {
          if (def && def.icon) ensureDesign(def.icon);
        }
      }

      // 每帧重置命中区
      this.workshopDropZones = [];
      this.workshopItemRects = [];
      this.workshopCardRects = [];
      this.workshopScrollArea = { x: 544, y: 120, w: 1312, h: 440 };

      // 属性条动画状态
      const now = this.time.now;
      if (this.statBarLast == null) this.statBarLast = now;
      const dt = Math.max(0, now - this.statBarLast);
      this.statBarLast = now;
      this.statBars = this.statBars || {};

      // ===== 左面板 =====
      g.fillStyle(0x0a0a0a, 0.98);
      g.fillRect(40, 40, 460, 1000);

      // 左右分界
      g.lineStyle(2, 0x2a2a2a, 1);
      g.lineBetween(512, 40, 512, 1040);

      // 快照：复用武器编辑器预览思路，绘制「选中槽位」的武器外形+媒介+发射动画，高度+50%
      const selSlot = this.workshopSelectedSlot || 0;
      const current = selSlot === 0 ? 'radial' : (loadout[selSlot] || 'radial');
      this.drawWorkshopSnapshot(g, current);

      // 右上角 3 个武器方案槽（竖排、小尺寸）
      for (let i = 0; i < 3; i++) {
        const sx = 400, sy = 64 + i * 46, sw = 36, sh = 36;
        const slotWeapon = i === 0 ? 'radial' : loadout[i];
        const unlocked = i === 0 ? true : level >= WEAPON_SLOT_LEVELS[i - 1];
        if (!unlocked) {
          g.fillStyle(0x555555, 1);
          g.fillRoundedRect(sx, sy, sw, sh, 6);
          drawLock(g, sx + sw / 2, sy + sh / 2, 12);
        } else if (!slotWeapon) {
          g.fillStyle(0xffffff, 1);
          g.fillRoundedRect(sx, sy, sw, sh, 6);
        } else {
          const wc = this.weaponRingColor(slotWeapon);
          g.fillStyle(color(wc), 1);
          g.fillRoundedRect(sx, sy, sw, sh, 6);
          drawWeaponGlyph(g, sx + sw / 2, sy + sh / 2, slotWeapon, false, 12);
          g.lineStyle(2, color(wc), 1);
          g.strokeRoundedRect(sx, sy, sw, sh, 6);
          if (i === this.workshopSelectedSlot) {
            g.lineStyle(3, 0xffffff, 1);
            g.strokeRoundedRect(sx, sy, sw, sh, 6);
          }
        }
        this.buttons.push({ id: `workshopSlot_${i}`, x: sx, y: sy, w: sw, h: sh });
      }

      // 等级 / 经验条 / 可用点数
      ensure('lv', '30px', '#ffffff').setOrigin(0, 0).setPosition(64, 320).setText(`Lv ${level}`);
      g.fillStyle(0x222222, 1);
      g.fillRect(64, 356, 380, 12);
      const expRatio = expToNext > 0 ? Math.min(1, exp / expToNext) : 0;
      g.fillStyle(0x00e5ff, 1);
      g.fillRect(64, 356, 380 * expRatio, 12);
      ensure('xp', '14px', '#888888').setOrigin(1, 0.5).setPosition(444, 362).setText(`${exp}/${expToNext}`);
      ensure('points', '22px', '#ffffff').setOrigin(0, 0).setPosition(64, 388).setText(`可用升级点数  ${spendable}`);

      // 分隔线
      g.lineStyle(1, 0x333333, 1);
      g.lineBetween(64, 424, 444, 424);

      // 4 属性行
      const keys = Object.keys(UPGRADE_STATS);
      keys.forEach((key, i) => {
        const cfg = UPGRADE_STATS[key];
        const raw = combat[key] ?? 0;
        const spent = points[key] ?? 0;
        const filled = spent >= cfg.cap;
        const rowY = 440 + i * 72;
        const target = Math.min(1, spent / cfg.cap);
        let sb = this.statBars[key];
        if (!sb) sb = this.statBars[key] = { cur: target, target };
        sb.target = target;
        sb.cur += (sb.target - sb.cur) * Math.min(1, dt / 300);

        ensure(`up_${key}_l`, '20px', '#ffffff').setOrigin(0, 0).setPosition(64, rowY + 6).setText(cfg.label);
        ensure(`up_${key}_v`, '18px', '#ffffff').setOrigin(0, 0).setPosition(64, rowY + 34).setText(cfg.fmt(raw));

        const pbX = 64, pbW = 300, pbH = 10, pbY = rowY + 56;
        g.fillStyle(0x222222, 1);
        g.fillRect(pbX, pbY, pbW, pbH);
        g.fillStyle(0xffffff, 1);
        g.fillRect(pbX, pbY, pbW * sb.cur, pbH);

        const bx = 412, by = rowY + 20, bw = 32, bh = 32;
        const up = this.uiPointer();
        const hover = !filled && up.x >= bx && up.x <= bx + bw && up.y >= by && up.y <= by + bh;
        const scl = this.pressScale(`upgrade_${key}`);
        const cw2 = bw * scl, ch2 = bh * scl;
        const cx2 = bx + (bw - cw2) / 2, cy2 = by + (bh - ch2) / 2;
        g.fillStyle(hover ? 0x000000 : 0xffffff, 1);
        g.fillRoundedRect(cx2, cy2, cw2, ch2, 6);
        g.lineStyle(1, hover ? 0xffffff : 0x000000, 1);
        g.strokeRoundedRect(cx2, cy2, cw2, ch2, 6);
        g.fillStyle(hover ? 0xffffff : 0x000000, 1);
        g.fillRect(cx2 + cw2 * 0.18, cy2 + ch2 * 0.43, cw2 * 0.64, ch2 * 0.14);
        if (!filled) {
          g.fillRect(cx2 + cw2 * 0.43, cy2 + ch2 * 0.18, cw2 * 0.14, ch2 * 0.64);
          this.buttons.push({ id: `upgrade_${key}`, x: bx, y: by, w: bw, h: bh });
        }
      });

      // 圣物槽：末条属性条(628) 下 24px 起，50px 格，右对齐 x=444
      const slotSize = 50, slotGap = 10, right = 444;
      ensure('relicLabel', '18px', '#ffffff').setOrigin(0, 0.5).setPosition(64, 771).setText('圣物');
      const relics = Array.isArray(equipment.relics) ? equipment.relics : [];
      const relicStart = right - (3 * slotSize + 2 * slotGap);
      for (let i = 0; i < 3; i++) {
        const sx = relicStart + i * (slotSize + slotGap), sy = 746;
        this.drawItemSlot(g, sx, sy, slotSize, slotSize, relics[i], `relic_${i}`, ensure);
        this.workshopDropZones.push({ x: sx, y: sy, w: slotSize, h: slotSize, slotType: 'relic', index: i });
      }

      // 宠物槽：圣物行下 24px，50px 格，右对齐 x=444
      ensure('petLabel', '18px', '#ffffff').setOrigin(0, 0.5).setPosition(64, 845).setText('宠物');
      const pets = Array.isArray(equipment.pets) ? equipment.pets : [];
      const petStart = right - (2 * slotSize + slotGap);
      for (let i = 0; i < 2; i++) {
        const sx = petStart + i * (slotSize + slotGap), sy = 746 + slotSize + 24;
        this.drawItemSlot(g, sx, sy, slotSize, slotSize, pets[i], `pet_${i}`, ensure);
        this.workshopDropZones.push({ x: sx, y: sy, w: slotSize, h: slotSize, slotType: 'pet', index: i });
      }

      // ===== 右上面板：武器列表 =====
      g.fillStyle(0x0a0a0a, 0.98);
      g.fillRect(520, 40, 1360, 653);
      ensure('weaponTitle', '24px', '#ffffff').setOrigin(0, 0.5).setPosition(544, 76).setText('武器');

      const cardW = 280, cardH = 440, cardGap = 24;
      const headH = Math.floor(cardH / 2); // 上半区（武器快照）与下半区（改件装配）1:1
      const viewW = 1312;
      // 卡列表：只渲染玩家已拥有（unlocked）的武器，不用占位补齐
      const cardTypes = weaponCatalog().filter(t => weaponsState[t]?.unlocked);
      this.workshopCardCount = cardTypes.length;
      const contentW = cardTypes.length * (cardW + cardGap);
      const maxScroll = Math.max(0, contentW - viewW);
      if (this.workshopScroll == null) this.workshopScroll = 0;
      this.workshopScroll = Phaser.Math.Clamp(this.workshopScroll, 0, maxScroll);

      if (!this.workshopCardContentG) {
        this.workshopCardContentG = this.add.graphics().setDepth(1001);
        this.workshopCardContentG.setMask(this.workshopCardMask);
        this.cameras.main.ignore(this.workshopCardContentG);
      }
      const cardG = this.workshopCardContentG;
      cardG.clear();
      for (let i = 0; i < cardTypes.length; i++) {
        const type = cardTypes[i];
        const cardX = 544 + i * (cardW + cardGap) - this.workshopScroll;
        const cardY = 120;
        if (cardX + cardW < 544 || cardX > 1856) continue;

        if (type === 'placeholder') {
          cardG.fillStyle(0xffffff, 1);
          cardG.fillRoundedRect(cardX, cardY, cardW, cardH, 4);
          cardG.lineStyle(2, 0xcccccc, 1);
          cardG.strokeRoundedRect(cardX, cardY, cardW, cardH, 4);
          cardG.fillStyle(0xe8e8e8, 1);
          cardG.fillRoundedRect(cardX, cardY, cardW, headH, 4);
          ensure(`card_ph_${i}`, '20px', '#999999').setMask(this.workshopCardMask).setOrigin(0.5, 0.5).setPosition(cardX + cardW / 2, cardY + cardH / 2).setText('即将开放');
          continue;
        }

        const unlocked = !!weaponsState[type]?.unlocked;
        const selected = loadout.includes(type);
        const wc = this.weaponRingColor(type);
        this.workshopCardRects.push({ type, x: cardX, y: cardY, w: cardW, h: cardH });
        const badgeX = cardX + cardW - 22, badgeY = cardY + 22;

        cardG.fillStyle(0xffffff, 1);
        cardG.fillRoundedRect(cardX, cardY, cardW, cardH, 4);
        if (selected) {
          const slotOrder = loadout.indexOf(type) + 1;
          cardG.lineStyle(3, color(wc), 1);
          cardG.strokeRoundedRect(cardX, cardY, cardW, cardH, 4);
          cardG.fillStyle(0x222222, 1);
          cardG.fillCircle(badgeX, badgeY, 13);
          cardG.lineStyle(2, color(wc), 1);
          cardG.strokeCircle(badgeX, badgeY, 13);
          ensure(`wslot_${type}`, '16px', '#ffffff').setMask(this.workshopCardMask).setOrigin(0.5, 0.5).setPosition(badgeX, badgeY).setText(String(slotOrder));
        } else {
          ensure(`wslot_${type}`, '16px', '#ffffff').setVisible(false);
        }

        cardG.fillStyle(unlocked ? 0xffffff : 0x555555, 1);
        cardG.fillRoundedRect(cardX, cardY, cardW, headH, 4);
        // 上半区：图片背景 + 武器外观（设计武器 appearance）/ 玩家本体（普通武器）叠加
        const headCx = cardX + cardW / 2, headCy = cardY + headH / 2;
        const tNow = this.time.now / 1000;
        if (!getDesign(WEAPON_BG_ASSET)) ensureDesign(WEAPON_BG_ASSET);
        const bgD = getDesign(WEAPON_BG_ASSET);
        if (bgD) drawDesignCentered(cardG, bgD, headCx, headCy, headH * 0.72, tNow);
        const wdef = getWeaponDef(type);
        if (wdef && wdef.appearance && Array.isArray(wdef.appearance.elements) && wdef.appearance.elements.length) {
          drawDesignCentered(cardG, wdef.appearance, headCx, headCy, headH * 0.52, tNow);
        } else {
          // 普通武器：玩家局内本体造型（优先玩家 art 资产，缺省六边形玩家）
          const artId = source.art || (type && source.arts?.[type]);
          const artDes = artId ? getDesign(artId) : null;
          if (artDes) drawDesignCentered(cardG, artDes, headCx, headCy, headH * 0.52, tNow);
          else drawHexRingPlayer(cardG, { x: headCx, y: headCy, weapon: { ringColor: wc }, weaponAngle: 0, artScale: 1, moveHexRadius: PLAYER_ART.hexagonRadius, moveLeanX: 0, moveLeanY: 0, scheme: 'hex-ring' }, 1);
        }
        if (!unlocked) drawLock(cardG, headCx, cardY + headH - 40, 20);
        const splitY = cardY + headH;
        cardG.lineStyle(2, 0x000000, 1);
        cardG.lineBetween(cardX, splitY, cardX + cardW, splitY);

        const modSlot = equipment.weaponMods?.[type] || { generic: [], dedicated: [] };
        const genericItems = Array.isArray(modSlot.generic) ? modSlot.generic : [];
        const dedicatedItems = Array.isArray(modSlot.dedicated) ? modSlot.dedicated : (modSlot.dedicated ? [modSlot.dedicated] : []);
        const caps = getModCaps(type);
        // 两行改件槽：通用改件一行、专属改件一行，槽位数按武器设计稿 maxGenericMods/maxDedicatedMods 配置
        if (caps.generic > 0) {
          ensure(`wgen_lab_${type}`, '14px', '#333333').setMask(this.workshopCardMask).setOrigin(0, 0.5).setPosition(cardX + 18, cardY + headH + 18).setText('通用改件');
          this.drawModRow(cardG, type, cardX + 18, cardY + headH + 34, cardW - 36, caps.generic, genericItems, 'wmodg', 'weaponGeneric', ensure);
        }
        if (caps.dedicated > 0) {
          ensure(`wded_lab_${type}`, '14px', '#333333').setMask(this.workshopCardMask).setOrigin(0, 0.5).setPosition(cardX + 18, cardY + headH + 96).setText('专属改件');
          this.drawModRow(cardG, type, cardX + 18, cardY + headH + 110, cardW - 36, caps.dedicated, dedicatedItems, 'wmodd', 'weaponDedicated', ensure);
        }

        ensure(`weapon_${type}`, '20px', '#000000').setMask(this.workshopCardMask).setOrigin(0.5, 0.5).setPosition(cardX + cardW / 2, cardY + cardH - 30).setText(this.weaponName(type));
        this.buttons.push({ id: `workshopCard_${type}`, x: cardX, y: cardY, w: cardW, h: cardH });
      }

      // ===== 右下仓库面板 =====
      g.fillStyle(0x0a0a0a, 0.98);
      g.fillRect(520, 713, 1360, 327);
      this.workshopTab = this.workshopTab || 'mod';
      const tabs = [['mod', '改件'], ['relic', '圣物'], ['pet', '宠物']];
      for (let i = 0; i < tabs.length; i++) {
        const [cat, label] = tabs[i];
        const tx = 544 + i * 104, ty = 737, tw = 96, th = 32;
        const sel = this.workshopTab === cat;
        ensure(`tab_${cat}`, '20px', sel ? '#ffffff' : '#888888').setOrigin(0, 0).setPosition(tx, ty).setText(label);
        if (sel) {
          g.lineStyle(2, 0xffffff, 1);
          g.lineBetween(tx, ty + 36, tx + tw, ty + 36);
        }
        this.buttons.push({ id: `workshopTab_${cat}`, x: tx, y: ty, w: tw, h: th });
      }

      const inv = this.workshopInventoryItems(source, this.workshopTab);
      // 仓库纵向滚动视口（13 列 ×94 格距，格 89×89，图标 3px 内缩）
      const invArea = { x: 544, y: 795, w: 1280, h: 245 };
      const cols = 13, pitch = 94, cell = 89;
      this.workshopInvScrollArea = invArea;
      const invRows = Math.ceil(inv.length / cols);
      const invContentH = invRows * pitch;
      this.workshopInvMaxScroll = Math.max(0, invContentH - invArea.h);
      if (this.workshopInvScroll == null) this.workshopInvScroll = 0;
      this.workshopInvScroll = Phaser.Math.Clamp(this.workshopInvScroll, 0, this.workshopInvMaxScroll);

      // 单元格绘制到持久 mask 的 contentG（纵向滚动裁剪）
      if (!this.workshopInvContentG) {
        this.workshopInvContentG = this.add.graphics().setDepth(1001);
        this.workshopInvContentG.setMask(this.workshopInvMask);
        this.cameras.main.ignore(this.workshopInvContentG);
      }
      const invG = this.workshopInvContentG;
      invG.clear();
      if (!inv.length) {
        ensure('inventory_empty', '20px', '#888888').setOrigin(0.5, 0).setPosition(1200, 830).setText('暂无物品');
      } else {
        inv.forEach((it, idx) => {
          const col = idx % cols, row = Math.floor(idx / cols);
          const ix = invArea.x + col * pitch;
          const iy = invArea.y + row * pitch - this.workshopInvScroll;
          if (iy + cell < invArea.y || iy > invArea.y + invArea.h) return; // 视口外跳过
          this.drawItemCell(invG, ix, iy, it, idx, ensure, this.workshopInvMask);
          this.workshopItemRects.push({ id: it.id, def: it.def, stackable: it.def.stackable, category: it.def.category, count: it.count, x: ix, y: iy, w: cell, h: cell });
        });
      }

      // 纵向滚动条（固定于面板右侧，不参与 mask）
      if (this.workshopInvMaxScroll > 0) {
        const sbX = 1848, sbW = 10, sbH = invArea.h;
        g.fillStyle(0x222222, 1);
        g.fillRoundedRect(sbX, invArea.y, sbW, sbH, 4);
        const thumbH = Math.max(30, Math.floor(sbH * invArea.h / invContentH));
        const thumbY = invArea.y + Math.floor((this.workshopInvScroll / this.workshopInvMaxScroll) * (sbH - thumbH));
        g.fillStyle(0xffffff, 0.85);
        g.fillRoundedRect(sbX, thumbY, sbW, thumbH, 4);
        this.workshopInvThumb = { x: sbX, y: thumbY, w: sbW, h: thumbH };
      } else {
        this.workshopInvThumb = null;
      }

      // 悬停改件 tip：显示名称/效果；已安装的改件额外显示「卸下」按钮（点击返回仓库）
      // 右键固定：pinnedTip 存在时画固定 tip（不随光标移动），否则画跟随光标的悬停 tip
      if (!this.workshopDrag) {
        const up = this.uiPointer();
        const pin = this.workshopPinnedTip;
        if (pin) {
          this.drawWorkshopTip(this.workshopDragG || this.uiG, pin.def, pin.itemId, pin.equipped, up, ensure, pin.x, pin.y);
        } else {
          let hoverItem = null, hoverDef = null;
          for (const c of this.workshopItemRects) {
            if (up.x >= c.x && up.x <= c.x + c.w && up.y >= c.y && up.y <= c.y + c.h) {
              hoverItem = c.id; hoverDef = c.def;
              break;
            }
          }
          if (!hoverItem) {
            for (const z of this.workshopDropZones) {
              if (up.x >= z.x && up.x <= z.x + z.w && up.y >= z.y && up.y <= z.y + z.h) {
                const slot = equipment?.weaponMods?.[z.weapon];
                const arr = z.slotType === 'weaponGeneric'
                  ? (Array.isArray(slot?.generic) ? slot.generic : [])
                  : (Array.isArray(slot?.dedicated) ? slot.dedicated : (slot?.dedicated ? [slot.dedicated] : []));
                if (arr[z.index]) {
                  const d = ITEM_DEFS[arr[z.index]];
                  if (d?.category === 'mod') { hoverItem = arr[z.index]; hoverDef = d; }
                }
                break;
              }
            }
          }
          // 停在 tip / 卸下按钮上时沿用上一个 hover，保证按钮可点
          const prevHover = this.workshopHover;
          if (!hoverItem && prevHover && prevHover.tipRect
            && up.x >= prevHover.tipRect.x && up.x <= prevHover.tipRect.x + prevHover.tipRect.w
            && up.y >= prevHover.tipRect.y && up.y <= prevHover.tipRect.y + prevHover.tipRect.h) {
            hoverItem = prevHover.itemId; hoverDef = prevHover.def;
          }
          if (hoverItem) {
            const equipped = this.findItemEquip(source, hoverItem);
            this.workshopHover = { itemId: hoverItem, def: hoverDef, equipped };
            this.drawWorkshopTip(this.workshopDragG || this.uiG, hoverDef, hoverItem, equipped, up, ensure);
          } else {
            this.workshopHover = null;
          }
        }
      } else {
        this.workshopHover = null;
      }

      // 拖拽图标（画到高层 workshopDragG，盖过卡片内容）+ 来源高亮
      if (this.workshopDrag) {
        const up = this.uiPointer();
        const def = ITEM_DEFS[this.workshopDrag.itemId];
        if (def) {
          const dragG = this.workshopDragG;
          dragG.fillStyle(0xffffff, 0.9);
          dragG.fillRoundedRect(up.x - 28, up.y - 28, 56, 56, 8);
          const design = def.icon ? getDesign(def.icon) : null;
          if (design) {
            renderAssetFit(dragG, design, up.x, up.y, 56 * 0.8, 0, this.workshopSnapSimT || 0);
            const t = ensure('drag_item', '18px', '#000000');
            t.setDepth(1002).setVisible(false);
          } else {
            dragG.fillStyle(color(def.color || '#ffffff'), 0.9);
            dragG.fillRoundedRect(up.x - 28, up.y - 28, 56, 56, 8);
            const t = ensure('drag_item', '18px', this.isLightColor(def.color) ? '#000000' : '#ffffff');
            t.setDepth(1002).setOrigin(0.5, 0.5).setPosition(up.x, up.y).setText(this.itemShortLabel(def.name));
          }
        }
        const srcCell = (this.workshopItemRects || []).find(c => c.id === this.workshopDrag.itemId);
        if (srcCell && this.workshopInvContentG) {
          const invG = this.workshopInvContentG;
          invG.lineStyle(2, 0xffffff, 0.9);
          invG.strokeRoundedRect(srcCell.x, srcCell.y, srcCell.w, srcCell.h, 6);
        }
      }

      // 顶部提示
      if (this.workshopTip && this.time.now < this.workshopTip.until) {
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(710, 50, 500, 60, 8);
        ensure('tip', '24px', '#000000').setOrigin(0.5, 0.5).setPosition(960, 80).setText(this.workshopTip.text);
      } else if (labels.has('tip')) {
        labels.get('tip').setVisible(false);
      }
    },

    weaponName(type) {
      return getWeaponDef(type)?.name || WEAPON_LABELS[type] || type;
    },
    weaponRingColor(type) {
      return getWeaponDef(type)?.medium?.ringColor || WEAPONS[type]?.ringColor || '#ffffff';
    },

    // 左上角玩家快照：复用武器编辑器预览思路（武器外形 + 发射媒介环/小球 + 发射动画），高度 +50%
    drawWorkshopSnapshot(g, type) {
      const area = { x: 76, y: 56, w: 300, h: 252 };
      this.workshopSnapArea = area;
      const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
      const design = getWeaponDef(type);
      const ringColor = this.weaponRingColor(type);

      // 背景格线（仿武器编辑器预览）
      g.lineStyle(1, 0x1c1c1c, 1);
      for (let x = area.x; x <= area.x + area.w; x += 30) g.lineBetween(x, area.y, x, area.y + area.h);
      for (let y = area.y; y <= area.y + area.h; y += 30) g.lineBetween(area.x, y, area.x + area.w, y);

      // 武器上下文：切换武器时重建执行条目并清空子弹
      if (this.workshopSnapType !== type || !this.workshopSnapEntry) {
        this.workshopSnapEntry = design
          ? buildWeaponRuntimeEntry(design)
          : (WEAPONS[type]?.fire ? {
              fire: WEAPONS[type].fire,
              drawBullet: WEAPONS[type].drawBullet,
              stepBullet: WEAPONS[type].stepBullet,
              fireInterval: WEAPONS[type].fireInterval
            } : null);
        this.workshopSnapType = type;
        this.workshopSnapBullets = [];
        this.workshopSnapBeam = null;
        this.workshopSnapDir = 1;
        this.workshopSnapFireDown = false;
        this.workshopSnapFireClock = 0;
        this.workshopSnapAngle = 0;
      }
      const simT = (this.workshopSnapSimT = (this.workshopSnapSimT || 0) + 0.016);

      // 本体缩小 25%（1.5 * 0.75 = 1.125）
      const bodyScl = 1.5 * 0.75;

      // 武器外形（设计稿 appearance）
      if (design && design.appearance && Array.isArray(design.appearance.elements) && design.appearance.elements.length) {
        renderAsset(g, design.appearance, cx, cy, simT, bodyScl);
      }

      // 发射媒介环 + 小球（随 workshopSnapAngle 自转；radial/基础无 medium → 不画，避免多余圆环/黄球，退化用 hex-ring）
      const med = design?.medium || WEAPONS[type]?.medium;
      if (med) {
        const mColor = med.ringColor || ringColor;
        const ringR = (med.radius > 0 ? med.radius : 28) * bodyScl;
        g.lineStyle(Math.max(2, (med.ringWidth || 4) * bodyScl), color(mColor), 1);
        g.strokeCircle(cx, cy, ringR);
        const ba = (this.workshopSnapAngle || 0) + ((med.angle || 0) * Math.PI) / 180;
        const bx = cx + Math.cos(ba) * ringR, by = cy + Math.sin(ba) * ringR;
        if (Array.isArray(med.elements) && med.elements.length) {
          renderAsset(g, { scale: med.size, center: { x: 0, y: 0 }, elements: med.elements }, bx, by, simT, bodyScl);
        } else {
          g.fillStyle(color(mColor), 1);
          g.fillCircle(bx, by, Math.max(2, 5 * (med.size || 1) * bodyScl));
        }
      }

      // 无设计稿武器（radial/基础）：退化画 hex-ring 玩家（保持原观感，仅缩小）
      if (!design) {
        drawHexRingPlayer(g, {
          x: cx, y: cy,
          weapon: { ringColor },
          scheme: WEAPONS[type]?.scheme || 'hex-ring',
          weaponAngle: this.workshopSnapAngle || 0, moveLeanX: 0, moveLeanY: 0,
          moveHexRadius: PLAYER_ART.hexagonRadius
        }, bodyScl);
      }

      // 武器自转 + 条件开火（复刻 game-scene：weaponAngle 持续自转，仅按住开火才发射）
      const idleSpd = med?.orbitSpeed ?? 180, fireSpd = med?.fireSpeed ?? 20;
      const angularSpeed = Phaser.Math.DegToRad(this.workshopSnapFireDown ? fireSpd : idleSpd);
      this.workshopSnapAngle = Phaser.Math.Angle.Wrap((this.workshopSnapAngle || 0) + this.workshopSnapDir * angularSpeed * 0.016);

      const entry = this.workshopSnapEntry;
      if (entry && entry.fire) {
        this.workshopSnapFireClock -= 16;
        if (this.workshopSnapFireDown && this.workshopSnapFireClock <= 0) {
          const shots = entry.fire({ x: cx, y: cy, weaponAngle: this.workshopSnapAngle || 0 }, 1, null);
          const beam = shots.find(s => s.beam);
          if (beam) this.workshopSnapBeam = { ...beam, ttl: 6 };
          for (const s of shots) if (!s.beam) this.workshopSnapBullets.push(s);
          this.workshopSnapFireClock = entry.fireInterval || 120;
        }
        if (this.workshopSnapBeam) {
          const b = this.workshopSnapBeam;
          const len = area.w * 0.9;
          g.lineStyle(Math.max(2, b.width), color(b.color), Math.max(0.15, b.ttl / 6));
          g.lineBetween(b.ox, b.oy, b.ox + Math.cos(b.angle) * len, b.oy + Math.sin(b.angle) * len);
          this.workshopSnapBeam.ttl -= 1.2;
          if (this.workshopSnapBeam.ttl <= 0) this.workshopSnapBeam = null;
        }
        this.workshopSnapBullets = (this.workshopSnapBullets || []).filter(s => {
          s.x += s.vx * 16 / 1000; s.y += s.vy * 16 / 1000;
          s.dist += Math.hypot(s.vx, s.vy) * 16 / 1000;
          if (entry.stepBullet) entry.stepBullet(s, 16, null);
          if (entry.drawBullet) entry.drawBullet(g, s);
          return !s.dead && s.x > area.x - 40 && s.x < area.x + area.w + 40 && s.y > area.y - 40 && s.y < area.y + area.h + 40;
        });
      }
    },

    // 点击/按住快照预览框 = 按住开火（不再朝指针；松开时翻转自转方向）
    fireWorkshopSnapshot() {
      this.workshopSnapFireDown = true;
      this.workshopSnapFireClock = 0;
    },

    itemShortLabel(name) {
      return String(name || '').slice(0, 2);
    },

    drawItemSlot(g, x, y, w, h, itemId, textId, ensure, mask) {
      if (!itemId) {
        g.fillStyle(0x555555, 1);
        g.fillRoundedRect(x, y, w, h, 6);
        const t = ensure(textId, w >= 64 ? '16px' : '12px', '#000000');
        if (mask) t.setMask(mask);
        t.setVisible(false);
        return;
      }
      const def = ITEM_DEFS[itemId];
      const design = def?.icon ? getDesign(def.icon) : null;
      if (design) {
        // 画板资产图标：白底 + renderAsset 动态资产，不叠加文字
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(x, y, w, h, 4);
        renderAssetFit(g, design, x + w / 2, y + h / 2, Math.min(w, h) * 0.8, 0, this.workshopSnapSimT || 0);
        const t = ensure(textId, w >= 64 ? '16px' : '12px', '#000000');
        if (mask) t.setMask(mask);
        t.setVisible(false);
        return;
      }
      const fillC = def?.color || '#ffffff';
      g.fillStyle(color(fillC), 1);
      g.fillRoundedRect(x, y, w, h, 6);
      g.lineStyle(1, 0x333333, 1);
      g.strokeRoundedRect(x, y, w, h, 6);
      const textC = this.isLightColor(fillC) ? '#000000' : '#ffffff';
      const t = ensure(textId, w >= 64 ? '16px' : '12px', textC);
      if (mask) t.setMask(mask);
      t.setFontSize(w >= 64 ? 16 : 12).setColor(textC).setOrigin(0.5, 0.5).setPosition(x + w / 2, y + h / 2).setText(this.itemShortLabel(def?.name)).setVisible(true);
    },

    drawModRow(g, weapon, x0, y0, w, count, items, prefix, slotType, ensure) {
      const gap = 6, base = 44;
      const n = Math.max(1, Math.min(count, 9));
      const avail = w - (n - 1) * gap;
      const sz = Math.max(18, Math.min(base, Math.floor(avail / n)));
      const total = n * sz + (n - 1) * gap;
      const ox = x0;
      for (let i = 0; i < n; i++) {
        const sx = ox + i * (sz + gap), sy = y0;
        const itemId = items[i] || null;
        this.drawItemSlot(g, sx, sy, sz, sz, itemId, `${prefix}_${weapon}_${i}`, ensure, this.workshopCardMask);
        this.workshopDropZones.push({ x: sx, y: sy, w: sz, h: sz, slotType, weapon, index: i });
      }
    },

    isLightColor(hex) {
      const c = Phaser.Display.Color.HexStringToColor(hex || '#ffffff');
      return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255 > 0.6;
    },

    drawItemCell(g, x, y, it, idx, ensure, mask) {
      const cell = 89, icon = cell - 6; // 图标自适应缩放到离按钮边框 3px
      g.fillStyle(0x1a1a1a, 1);
      g.fillRoundedRect(x, y, cell, cell, 6);
      const def = it.def;
      const design = def?.icon ? getDesign(def.icon) : null;
      if (design) {
        // 画板资产图标：白底 + renderAsset 动态资产，不叠加文字
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(x + 3, y + 3, icon, icon, 4);
        renderAssetFit(g, design, x + cell / 2, y + cell / 2, icon, 0, this.workshopSnapSimT || 0);
      } else {
        const fillC = def.color || '#ffffff';
        g.fillStyle(color(fillC), 1);
        g.fillRoundedRect(x + 3, y + 3, icon, icon, 4);
        const textC = this.isLightColor(fillC) ? '#000000' : '#ffffff';
        const t = ensure(`inv_${idx}`, '18px', textC);
        if (mask) t.setMask(mask);
        t.setOrigin(0.5, 0.5).setPosition(x + cell / 2, y + cell / 2).setText(this.itemShortLabel(def.name));
      }
      if (def.stackable && it.count > 1) {
        // 数量徽标：黑底白字，置于按钮右下角（3px 内缩）
        const bs = 15, bx = x + cell - bs - 3, by = y + cell - bs - 3;
        g.fillStyle(0x000000, 1);
        g.fillRoundedRect(bx, by, bs, bs, 3);
        const t = ensure(`inv_${idx}_c`, '10px', '#ffffff');
        if (mask) t.setMask(mask);
        t.setOrigin(0.5, 0.5).setPosition(bx + bs / 2, by + bs / 2).setText(String(it.count));
      }
    },

    workshopInventoryItems(source, tab) {
      const stacks = source?.items?.stacks || {};
      const uniques = source?.items?.uniques || [];
      const out = [];
      if (tab === 'mod') {
        for (const [id, count] of Object.entries(stacks)) {
          const def = ITEM_DEFS[id];
          if (def && def.category === 'mod' && def.weapon === '') out.push({ id, def, count });
        }
        for (const u of uniques) {
          const def = ITEM_DEFS[u.itemId];
          if (def && def.category === 'mod') out.push({ id: u.itemId, def, count: 1 });
        }
      } else if (tab === 'relic') {
        for (const [id, count] of Object.entries(stacks)) {
          const def = ITEM_DEFS[id];
          if (def && def.category === 'relic') out.push({ id, def, count });
        }
      } else if (tab === 'pet') {
        for (const u of uniques) {
          const def = ITEM_DEFS[u.itemId];
          if (def && def.category === 'pet') out.push({ id: u.itemId, def, count: 1 });
        }
      }
      return out;
    },

    isValidWorkshopDrop(def, zone) {
      if (!def || !zone) return false;
      if (zone.slotType === 'weaponGeneric') return def.category === 'mod' && def.weapon === '';
      if (zone.slotType === 'weaponDedicated') return def.category === 'mod' && def.weapon === zone.weapon;
      if (zone.slotType === 'relic') return def.category === 'relic';
      if (zone.slotType === 'pet') return def.category === 'pet';
      return false;
    },

    workshopSlotContains(source, zone, itemId) {
      if (zone.slotType === 'weaponGeneric') {
        return (source?.equipment?.weaponMods?.[zone.weapon]?.generic || []).includes(itemId);
      }
      if (zone.slotType === 'weaponDedicated') {
        const ded = source?.equipment?.weaponMods?.[zone.weapon]?.dedicated;
        return (Array.isArray(ded) ? ded : (ded ? [ded] : [])).includes(itemId);
      }
      if (zone.slotType === 'relic') {
        return (source?.equipment?.relics || [])[zone.index] === itemId;
      }
      if (zone.slotType === 'pet') {
        return (source?.equipment?.pets || [])[zone.index] === itemId;
      }
      return false;
    },

    workshopRemoveFromInventory(source, itemId) {
      const def = ITEM_DEFS[itemId];
      if (!def) return false;
      source.items = source.items || { stacks: {}, uniques: [] };
      if (def.stackable) {
        const stacks = source.items.stacks || (source.items.stacks = {});
        const n = stacks[itemId] || 0;
        if (n <= 0) return false;
        stacks[itemId] = n - 1;
        if (stacks[itemId] <= 0) delete stacks[itemId];
        return true;
      }
      const uniques = source.items.uniques || (source.items.uniques = []);
      const idx = uniques.findIndex(u => u.itemId === itemId);
      if (idx < 0) return false;
      uniques.splice(idx, 1);
      return true;
    },

    workshopAddToInventory(source, itemId) {
      const def = ITEM_DEFS[itemId];
      if (!def) return;
      source.items = source.items || { stacks: {}, uniques: [] };
      if (def.stackable) {
        const stacks = source.items.stacks || (source.items.stacks = {});
        stacks[itemId] = (stacks[itemId] || 0) + 1;
      } else {
        const uniques = source.items.uniques || (source.items.uniques = []);
        uniques.push({ uid: `u-${itemId}-${Date.now()}`, itemId });
      }
    },

    workshopReplaceSlot(source, zone, itemId) {
      const old = [];
      source.equipment = source.equipment || { weaponMods: {}, relics: [], pets: [] };
      const wm = source.equipment.weaponMods || (source.equipment.weaponMods = {});
      if (zone.slotType === 'weaponGeneric') {
        const slot = wm[zone.weapon] || (wm[zone.weapon] = { generic: [], dedicated: [] });
        const generic = Array.isArray(slot.generic) ? slot.generic : [];
        while (generic.length <= zone.index) generic.push('');
        if (generic[zone.index]) old.push(generic[zone.index]);
        generic[zone.index] = itemId;
        slot.generic = generic;
      } else if (zone.slotType === 'weaponDedicated') {
        const slot = wm[zone.weapon] || (wm[zone.weapon] = { generic: [], dedicated: [] });
        const ded = Array.isArray(slot.dedicated) ? slot.dedicated : (slot.dedicated ? [slot.dedicated] : []);
        while (ded.length <= zone.index) ded.push('');
        if (ded[zone.index]) old.push(ded[zone.index]);
        ded[zone.index] = itemId;
        slot.dedicated = ded;
      } else if (zone.slotType === 'relic') {
        const relics = source.equipment.relics || (source.equipment.relics = []);
        if (zone.index < relics.length) {
          old.push(relics[zone.index]);
          relics[zone.index] = itemId;
        } else {
          relics.push(itemId);
        }
      } else if (zone.slotType === 'pet') {
        const pets = source.equipment.pets || (source.equipment.pets = []);
        if (zone.index < pets.length) {
          old.push(pets[zone.index]);
          pets[zone.index] = itemId;
        } else {
          pets.push(itemId);
        }
      }
      return old;
    },

    workshopEquipItem(drag, zone) {
      const source = this.saveSource();
      if (!source || !drag) return;
      const def = ITEM_DEFS[drag.itemId];
      if (!this.isValidWorkshopDrop(def, zone)) return;
      if (this.workshopSlotContains(source, zone, drag.itemId)) return;
      if (!this.workshopRemoveFromInventory(source, drag.itemId)) return;
      const old = this.workshopReplaceSlot(source, zone, drag.itemId);
      for (const id of old) this.workshopAddToInventory(source, id);
      if (this.player) {
        this.player.items = source.items;
        this.player.equipment = source.equipment;
      }
      this.persistSave(source);
      this.drawUI();
    },

    toggleWorkshopWeapon(type) {
      if (type === 'radial') return;
      const source = this.saveSource();
      if (!source) return;
      if (!source.weapons?.[type]?.unlocked) return;
      const level = source.progress?.level ?? 1;
      const load = Array.isArray(source.loadout) ? [...source.loadout] : ['radial'];
      while (load.length < 3) load.push('');
      load[0] = 'radial';
      const idx = load.indexOf(type);
      if (idx >= 1) {
        load[idx] = '';
      } else {
        let placed = false;
        for (let i = 1; i <= 2; i++) {
          if (level >= WEAPON_SLOT_LEVELS[i - 1] && !load[i]) {
            load[i] = type;
            placed = true;
            break;
          }
        }
        if (!placed) {
          this.showWorkshopTip('出战槽已满');
          return;
        }
      }
      source.loadout = load;
      if (this.player) this.player.loadout = [...load];
      this.persistSave(source);
      const placedIdx = load.indexOf(type);
      this.workshopSelectedSlot = placedIdx >= 0 ? placedIdx : 0;
      this.drawUI();
    },

    clickWorkshopSlot(n) {
      const source = this.saveSource();
      const level = source?.progress?.level ?? this.player?.level ?? 1;
      const lv = WEAPON_SLOT_LEVELS[n - 1];
      if (lv && level < lv) { this.showWorkshopTip(`该槽位将在 ${lv} 级解锁`); return; }
      if (n !== 0 && !(Array.isArray(source?.loadout) && source.loadout[n])) { return; } // 空槽不选
      this.workshopSelectedSlot = n;
      this.drawUI();
    },

    showWorkshopTip(text) {
      this.workshopTip = { text, until: this.time.now + 2000 };
    },

    handleWorkshopPointerDown(p) {
      const up = this.uiPointer();
      // 右键固定 tip：命中「已安装改件」槽即固定（不随光标移动）
      if (p && p.rightButtonDown && p.rightButtonDown()) {
        const source = this.saveSource();
        for (const z of this.workshopDropZones || []) {
          if (up.x >= z.x && up.x <= z.x + z.w && up.y >= z.y && up.y <= z.y + z.h) {
            const slot = source?.equipment?.weaponMods?.[z.weapon];
            const arr = z.slotType === 'weaponGeneric'
              ? (Array.isArray(slot?.generic) ? slot.generic : [])
              : (Array.isArray(slot?.dedicated) ? slot.dedicated : (slot?.dedicated ? [slot.dedicated] : []));
            if (arr[z.index]) {
              const d = ITEM_DEFS[arr[z.index]];
              if (d?.category === 'mod') {
                this.workshopPinnedTip = { itemId: arr[z.index], def: d, equipped: z, x: up.x + 16, y: up.y + 16 };
                return true;
              }
            }
            break;
          }
        }
      }
      // 固定 tip 交互：点「卸下」卸载；点空白（不在 tip/任意 cell/dropZone/按钮内）消失
      const pin = this.workshopPinnedTip;
      if (pin) {
        if (pin.unequipRect && up.x >= pin.unequipRect.x && up.x <= pin.unequipRect.x + pin.unequipRect.w
          && up.y >= pin.unequipRect.y && up.y <= pin.unequipRect.y + pin.unequipRect.h) {
          this.workshopUnequip(this.saveSource(), pin.itemId);
          this.workshopPinnedTip = null;
          return true;
        }
        const inTip = pin.tipRect && up.x >= pin.tipRect.x && up.x <= pin.tipRect.x + pin.tipRect.w
          && up.y >= pin.tipRect.y && up.y <= pin.tipRect.y + pin.tipRect.h;
        const inCell = (this.workshopItemRects || []).some(r => up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h);
        const inZone = (this.workshopDropZones || []).some(z => up.x >= z.x && up.x <= z.x + z.w && up.y >= z.y && up.y <= z.y + z.h);
        const inBtn = (this.buttons || []).some(b => up.x >= b.x && up.x <= b.x + b.w && up.y >= b.y && up.y <= b.y + b.h);
        if (!inTip && !inCell && !inZone && !inBtn) {
          this.workshopPinnedTip = null;
          return true;
        }
      }
      // 悬停 tip 的「卸下」按钮：点击返回仓库
      if (this.workshopHover && this.workshopHover.unequipRect) {
        const ur = this.workshopHover.unequipRect;
        if (up.x >= ur.x && up.x <= ur.x + ur.w && up.y >= ur.y && up.y <= ur.y + ur.h) {
          const itemId = this.workshopHover.itemId;
          this.workshopHover = null;
          this.workshopUnequip(this.saveSource(), itemId);
          return true;
        }
      }
      // 快照预览框内按住左键 → 按住开火（复刻游戏内发射逻辑）
      const snap = this.workshopSnapArea;
      if (snap && up.x >= snap.x && up.x <= snap.x + snap.w && up.y >= snap.y && up.y <= snap.y + snap.h) {
        this.fireWorkshopSnapshot(up.x, up.y);
        return true;
      }
      const cells = this.workshopItemRects || [];
      for (const c of cells) {
        if (up.x >= c.x && up.x <= c.x + c.w && up.y >= c.y && up.y <= c.y + c.h) {
          this.workshopPress = {
            itemId: c.id,
            category: c.def.category,
            stackable: c.def.stackable,
            t0: this.time.now,
            x: up.x,
            y: up.y
          };
          return true;
        }
      }
      // 库存纵向滚动：滚动条滑块 / 视口空白拖动
      const thumb = this.workshopInvThumb;
      if (thumb && up.x >= thumb.x - 6 && up.x <= thumb.x + thumb.w + 6 && up.y >= thumb.y - 6 && up.y <= thumb.y + thumb.h + 6) {
        this.workshopInvScrollDrag = { startY: up.y, scroll: this.workshopInvScroll || 0 };
        return true;
      }
      const invArea = this.workshopInvScrollArea;
      if (invArea && up.x >= invArea.x && up.x <= invArea.x + invArea.w && up.y >= invArea.y && up.y <= invArea.y + invArea.h) {
        const onCell = (this.workshopItemRects || []).some(r => up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h);
        if (!onCell) {
          this.workshopInvScrollDrag = { startY: up.y, scroll: this.workshopInvScroll || 0 };
          return true;
        }
      }
      const area = this.workshopScrollArea;
      if (area && up.x >= area.x && up.x <= area.x + area.w && up.y >= area.y && up.y <= area.y + area.h) {
        const onCard = (this.workshopCardRects || []).some(r => up.x >= r.x && up.x <= r.x + r.w && up.y >= r.y && up.y <= r.y + r.h);
        if (!onCard) {
          this.workshopScrollDrag = { startX: up.x, scroll: this.workshopScroll || 0 };
          return true;
        }
      }
      return false;
    },

    updateWorkshopInvScrollDrag() {
      if (!this.workshopInvScrollDrag) return;
      const up = this.uiPointer();
      const max = this.workshopInvMaxScroll || 0;
      this.workshopInvScroll = Phaser.Math.Clamp(this.workshopInvScrollDrag.scroll - (up.y - this.workshopInvScrollDrag.startY), 0, max);
    },

    updateWorkshopLongPress() {
      if (this.menuScreen !== 'workshop' || !this.workshopPress || this.workshopDrag) return;
      const up = this.uiPointer();
      if (Math.hypot(up.x - this.workshopPress.x, up.y - this.workshopPress.y) > 24) {
        this.workshopPress = null;
        return;
      }
      if (this.time.now - this.workshopPress.t0 >= 100) {
        this.workshopDrag = {
          itemId: this.workshopPress.itemId,
          category: this.workshopPress.category,
          stackable: this.workshopPress.stackable
        };
        this.workshopPress = null;
        this.drawUI();
      }
    },

    updateWorkshopScrollDrag() {
      if (!this.workshopScrollDrag) return;
      const up = this.uiPointer();
      const contentW = (this.workshopCardCount || 5) * (280 + 24), viewW = 1312;
      const maxScroll = Math.max(0, contentW - viewW);
      this.workshopScroll = Phaser.Math.Clamp(this.workshopScrollDrag.scroll - (up.x - this.workshopScrollDrag.startX), 0, maxScroll);
    },

    handleWorkshopPointerUp() {
      // 松开开火：停止发射并翻转自转方向（复刻 game-scene）
      if (this.workshopSnapFireDown) {
        this.workshopSnapFireDown = false;
        this.workshopSnapDir = (this.workshopSnapDir || 1) * -1;
      }
      if (this.workshopDrag) {
        const up = this.uiPointer();
        let zone = null;
        for (const z of this.workshopDropZones || []) {
          if (up.x >= z.x && up.x <= z.x + z.w && up.y >= z.y && up.y <= z.y + z.h) {
            zone = z;
            break;
          }
        }
        if (zone) this.workshopEquipItem(this.workshopDrag, zone);
        this.workshopDrag = null;
        this.drawUI();
      }
      this.workshopPress = null;
      this.workshopScrollDrag = null;
      this.workshopInvScrollDrag = null;
    },

    drawWorkshopTip(g, def, itemId, equipped, up, ensure, px, py) {
      const tipW = 248;
      const tipH = equipped ? 100 : 76;
      let tx = (px != null ? px : up.x + 16), ty = (py != null ? py : up.y + 16);
      if (tx + tipW > VIEW_W - 12) tx = (px != null ? px : up.x) - tipW - 16;
      if (ty + tipH > VIEW_H - 12) ty = (py != null ? py : up.y) - tipH - 16;
      tx = Math.max(12, tx); ty = Math.max(12, ty);
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(tx, ty, tipW, tipH, 8);
      g.lineStyle(1, 0x333333, 1);
      g.strokeRoundedRect(tx, ty, tipW, tipH, 8);
      ensure('tip_name', '20px', '#000000').setDepth(1003).setOrigin(0, 0.5).setPosition(tx + 14, ty + 22).setText(def.name || '改件');
      ensure('tip_effect', '16px', '#333333').setDepth(1003).setOrigin(0, 0.5).setPosition(tx + 14, ty + 48).setText(def.effect || '');
      let unequipRect = null;
      if (equipped) {
        const bw = tipW - 28, bh = 30, bx = tx + 14, by = ty + tipH - 38;
        g.fillStyle(0x111111, 1);
        g.fillRoundedRect(bx, by, bw, bh, 4);
        g.lineStyle(1, 0xffffff, 1);
        g.strokeRoundedRect(bx, by, bw, bh, 4);
        ensure('tip_unequip', '16px', '#ffffff').setDepth(1003).setOrigin(0.5, 0.5).setPosition(bx + bw / 2, by + bh / 2).setText('卸下');
        unequipRect = { x: bx, y: by, w: bw, h: bh };
      } else {
        ensure('tip_unequip', '16px', '#ffffff').setDepth(1003).setVisible(false);
      }
      const tipRect = { x: tx, y: ty, w: tipW, h: tipH };
      if (this.workshopPinnedTip) {
        this.workshopPinnedTip.tipRect = tipRect;
        this.workshopPinnedTip.unequipRect = unequipRect;
      } else if (this.workshopHover) {
        this.workshopHover.tipRect = tipRect;
        this.workshopHover.unequipRect = unequipRect;
      }
    },

    findItemEquip(source, itemId) {
      const eq = source?.equipment || {};
      const wm = eq.weaponMods || {};
      for (const [weapon, slot] of Object.entries(wm)) {
        const g = Array.isArray(slot?.generic) ? slot.generic : [];
        const gi = g.indexOf(itemId);
        if (gi >= 0) return { kind: 'weaponGeneric', weapon, index: gi };
        const d = Array.isArray(slot?.dedicated) ? slot.dedicated : (slot?.dedicated ? [slot.dedicated] : []);
        const di = d.indexOf(itemId);
        if (di >= 0) return { kind: 'weaponDedicated', weapon, index: di };
      }
      const relics = Array.isArray(eq.relics) ? eq.relics : [];
      const ri = relics.indexOf(itemId);
      if (ri >= 0) return { kind: 'relic', index: ri };
      const pets = Array.isArray(eq.pets) ? eq.pets : [];
      const pi = pets.indexOf(itemId);
      if (pi >= 0) return { kind: 'pet', index: pi };
      return null;
    },

    workshopUnequip(source, itemId) {
      const at = this.findItemEquip(source, itemId);
      if (!at) return false;
      const eq = source.equipment || (source.equipment = { weaponMods: {}, relics: [], pets: [] });
      const wm = eq.weaponMods || (eq.weaponMods = {});
      if (at.kind === 'weaponGeneric') { const s = wm[at.weapon] || (wm[at.weapon] = { generic: [], dedicated: [] }); if (s.generic[at.index]) s.generic[at.index] = ''; }
      else if (at.kind === 'weaponDedicated') { const s = wm[at.weapon] || (wm[at.weapon] = { generic: [], dedicated: [] }); if (s.dedicated[at.index]) s.dedicated[at.index] = ''; }
      else if (at.kind === 'relic') { if (eq.relics[at.index]) eq.relics[at.index] = ''; }
      else if (at.kind === 'pet') { if (eq.pets[at.index]) eq.pets[at.index] = ''; }
      this.workshopAddToInventory(source, itemId);
      this.persistSave(source);
      if (this.syncUIState) this.syncUIState();
      this.drawUI();
      return true;
    },
};
