/**
 * 文件职责：UI 运行时（UI 相机 / 贴图与文本装配 / 屏幕状态判定 / 主绘制调度 / 点击派发）
 * 归属分类：UI交互
 * 主要导出：UiRuntimeMixin（24 个方法）、WEAPON_SLOT_LEVELS、ICON_SETTINGS / ICON_EXIT / ICON_RETRY / ICON_CONTINUE
 * 依赖：systems/constants.js、ui-layer.js、ui-bindings.js、systems/ui/entity-art.js
 */
import Phaser from 'phaser';
import { VIEW_W, VIEW_H, FONT_TECH, FONT_TECH_SC, SHIELD_MAX } from '../constants.js';
import { renderGraph, nodeHidden } from '../../ui-layer.js';
import { nodeRect } from '../../ui-interact.js';
import { BINDINGS } from '../../ui-bindings.js';
import { color } from './entity-art.js';
import { drawCampfireOffer } from './campfire-art.js';

// 战斗 HUD 设置菜单图标（/图标 文件夹，经 /icons/ 接口提供）
export const ICON_SETTINGS = `/icons/${encodeURIComponent('设置.png')}`;
export const ICON_EXIT = `/icons/${encodeURIComponent('退出.png')}`;
export const ICON_RETRY = `/icons/${encodeURIComponent('再来一次.png')}`;
export const ICON_CONTINUE = `/icons/${encodeURIComponent('继续.png')}`;

export const WEAPON_SLOT_LEVELS = [12, 30];

// 页面 蒙层淡入/淡出 时长（与选关页旧关闭渐隐一致）
export const PAGE_FADE_MS = 140;

export const UiRuntimeMixin = {
    setupUI() {
      this.uiCam = this.cameras.add(0, 0, VIEW_W, VIEW_H).setScroll(0, 0).setZoom(1);
      this.uiG = this.add.graphics().setDepth(1000);
      this.cameras.main.ignore(this.uiG);
      this.uiCam.ignore(this.g);
      this.uiCam.ignore(this.bgG);
      this.workshopCardMaskG = this.add.graphics().setDepth(999);
      this.workshopCardMaskG.fillStyle(0xffffff, 0);
      this.workshopCardMaskG.fillRect(544, 120, 1312, 440);
      this.workshopCardMask = new Phaser.Display.Masks.GeometryMask(this, this.workshopCardMaskG);
      this.cameras.main.ignore(this.workshopCardMaskG);
      // 仓库格纵向滚动：内容 Graphics 遮罩到视口(544,795,1280,245)
      this.workshopInvMaskG = this.add.graphics().setDepth(999);
      this.workshopInvMaskG.fillStyle(0xffffff, 0);
      this.workshopInvMaskG.fillRect(544, 795, 1280, 245);
      this.workshopInvMask = new Phaser.Display.Masks.GeometryMask(this, this.workshopInvMaskG);
      this.cameras.main.ignore(this.workshopInvMaskG);
      this.workshopInvContentG = this.add.graphics().setDepth(1001);
      this.workshopInvContentG.setMask(this.workshopInvMask);
      this.cameras.main.ignore(this.workshopInvContentG);
      // 拖拽中的改件图标：须盖过卡片内容(1001)之上
      this.workshopDragG = this.add.graphics().setDepth(1002);
      this.cameras.main.ignore(this.workshopDragG);
      this.uiTexts = { battle: new Map(), interface: new Map(), login: new Map(), weapon: new Map(), workshop: new Map() };
      this.uiImages = { battle: new Map(), interface: new Map(), login: new Map(), weapon: new Map(), workshop: new Map() };
      this.workshopTexts = new Map();
      this.settingsTexts = new Map();
      this.settingsMode = null;
      this.settingsPrev = null;
      this.menuIconSprites = new Map();
      this.buttons = [];
      this.uiInteractAnim = new Map();
      this.pageFade = null;   // 页面蒙层淡入/淡出状态：null | {phase:'in'|'out', t0, dur}

      this.weaponLabels = [];
      for (let i = 0; i < 3; i++) {
        const t = this.add.text(0, 0, '', {
          fontFamily: FONT_TECH_SC,
          fontSize: '22px', color: '#ffffff'
        }).setOrigin(0.5).setDepth(1001);
        this.cameras.main.ignore(t);
        t.setVisible(false);
        this.weaponLabels.push(t);
      }

      this.ammoCurrent = this.add.text(0, 0, '', {
        fontFamily: FONT_TECH,
        fontSize: '45px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.ammoCurrent);
      this.ammoMax = this.add.text(0, 0, '', {
        fontFamily: FONT_TECH,
        fontSize: '30px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.ammoMax);

      this.hudIndicatorText = this.add.text(0, 0, '', {
        fontFamily: FONT_TECH,
        fontSize: '34px', color: '#000000', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(1001);
      this.cameras.main.ignore(this.hudIndicatorText);
      this.hudIndicatorText.setVisible(false);

      this.weaponIconImage = null;
      this.loadWeaponIcon();
      this.loadUIImages();
    },

    loadUIImages() {
    const ctx = this.ctx;
      const ui = ctx.state.ui || {};
      for (const key of ['battle', 'interface', 'login', 'weapon', 'workshop']) {
        for (const node of ui[key]?.nodes || []) {
          if (node.type !== 'image' || !node.src) continue;
          if (this.uiImages[key].has(node.id)) continue;
          const texKey = `__ui_img_${key}_${node.id}__`;
          const img = new Image();
          img.onload = () => {
            if (!this.textures?.game) return;   // 场景/游戏已销毁，异步加载期间不可再写纹理
            if (this.uiImages[key].has(node.id)) return;
            if (!this.textures.exists(texKey)) this.textures.addImage(texKey, img);
            const texture = this.textures.get(texKey);
            if (!texture || !texture.source?.[0]?.image) return;
            const sprite = this.add.image(node.x, node.y, texKey).setOrigin(0.5).setDepth(1001);
            this.cameras.main.ignore(sprite);
            sprite.setDisplaySize(node.w || img.width, node.h || img.height);
            if (node.angle != null) sprite.setRotation(Phaser.Math.DegToRad(node.angle));
            sprite.setVisible(false);
            this.uiImages[key].set(node.id, sprite);
          };
          img.src = node.src;
        }
      }
    },

    loadWeaponIcon() {
      const key = 'weapon-yellow';
      const img = new Image();
      img.onload = () => {
        if (!this.textures?.game) return;   // 场景/游戏已销毁，异步加载期间不可再写纹理
        if (this.textures.exists(key)) return;
        this.textures.addImage(key, img);
        const texture = this.textures.get(key);
        if (!texture || !texture.source?.[0]?.image) return;
        this.weaponIconImage = this.add.image(0, 0, key).setOrigin(0.5).setDepth(1001);
        this.cameras.main.ignore(this.weaponIconImage);
        this.weaponIconImage.setDisplaySize(80, 80);
        this.weaponIconImage.setVisible(false);
      };
      img.src = '图标/ninja_icon.svg';
    },

    buildUITexts() {
    const ctx = this.ctx;
      if (!this.uiTexts) this.uiTexts = { battle: new Map(), interface: new Map(), login: new Map() };
      if (!this.uiImages) this.uiImages = { battle: new Map(), interface: new Map(), login: new Map() };
      for (const map of Object.values(this.uiTexts)) {
        for (const t of map.values()) t.destroy();
        map.clear();
      }
      for (const map of Object.values(this.uiImages)) {
        for (const s of map.values()) s.destroy();
        map.clear();
      }
      this.loadUIImages();

      const ui = ctx.state.ui || {};
      for (const key of ['battle', 'interface', 'login', 'weapon', 'workshop']) {
        const nodes = ui[key]?.nodes || [];
        for (const node of nodes) {
          if (node.type !== 'text') continue;
          const text = this.add.text(node.x, node.y, '', {
            fontFamily: FONT_TECH_SC,
            fontSize: `${node.size || 24}px`,
            color: node.color || '#eaf4fb',
            fontStyle: node.bold ? 'bold' : 'normal'
          });
          text.setDepth(1001);
          this.cameras.main.ignore(text);
          this.uiTexts[key].set(node.id, text);
        }
      }
    },

    isMenuLevel() {
    const ctx = this.ctx;
      return (ctx.state.level?.ui || 'battle') === 'login';
    },

    isPreviewMode() {
    const ctx = this.ctx;
      return !this.editing && ctx.state.mode === 'play';
    },

    // 试玩模式：与正式一致的实机流程，使用 state.player（试玩时该数据来自测试存档）
    isTrialMode() {
    const ctx = this.ctx;
      return !this.editing && ctx.state.mode === 'trial';
    },

    isNewbeeLevel() {
    const ctx = this.ctx;
      return ctx.state.levelId === 'newbee';
    },

    isHubLevel() {
    const ctx = this.ctx;
      return ctx.state.levelId === 'knight-home';
    },

    isBattleLevel() {
    const ctx = this.ctx;
      return !this.isHubLevel() && (ctx.state.level?.ui || 'battle') === 'battle';
    },

    syncUIState() {
    const ctx = this.ctx;
      const p = this.player || {};
      const interfaceLevel = (ctx.state.level?.ui || 'battle') === 'interface';
      const loginLevel = this.isMenuLevel();
      this.uiState = {
        screen: loginLevel ? 'login' : (this.state === 'paused' || this.state === 'end' || interfaceLevel) ? 'interface' : 'battle',
        hp: p.hp ?? 100,
        maxHp: p.maxHp ?? 100,
        shield: p.shield ?? 0,
        maxShield: p.maxShield ?? SHIELD_MAX,
        slots: 1 + WEAPON_SLOT_LEVELS.filter(lv => (p.level ?? 1) >= lv).length,
        level: p.level ?? 1,
        exp: p.exp ?? 0,
        expToNext: p.expToNext ?? 100,
        gold: p.gold ?? 0,
        kills: this.kills,
        weaponLevel: p.weaponLevel ?? 1,
        weaponType: p.weaponType || 'radial',
        weapons: p.weapons || ['radial'],
        loadout: p.loadout || ['radial'],
        equipment: p.equipment || {},
        items: p.items || { stacks: {}, uniques: [] },
        combat: p.combat || {},
        points: p.points || {},
        spendablePoints: p.spendablePoints ?? 0,
        hasAnySave: !!ctx.state.hasAnySave
      };
    },

    // 把指针位置换算到 UI 坐标（1920x1080 空间），兼容 CSS object-fit: contain 缩放
    uiPointer() {
      const p = this.input?.activePointer;
      if (!p) return { x: 0, y: 0 };
      const canvas = this.game?.canvas;
      const rect = canvas?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return { x: p.x, y: p.y };
      // 显示区按 contain 缩放绘制，Phaser pointer.x 按 canvas 元素尺寸均匀换算，
      // 需还原回 contain 后的实际绘制区
      const scale = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
      const drawW = VIEW_W * scale, drawH = VIEW_H * scale;
      const offX = (rect.width - drawW) / 2, offY = (rect.height - drawH) / 2;
      return {
        x: (p.x / VIEW_W * rect.width - offX) / scale,
        y: (p.y / VIEW_H * rect.height - offY) / scale
      };
    },

    drawUI() {
    const ctx = this.ctx;
      if (!this.uiG) return;
      if (this.uiState) this.uiState.hasAnySave = !!ctx.state.hasAnySave;
      this.uiG.clear();
      this.buttons = [];
      for (const map of Object.values(this.uiTexts || {})) {
        for (const t of map.values()) t.setVisible(false);
      }
      if (this.hudIndicatorText) this.hudIndicatorText.setVisible(false);
      for (const map of Object.values(this.uiImages || {})) {
        for (const s of map.values()) s.setVisible(false);
      }
      if (this.menuIconSprites) for (const s of this.menuIconSprites.values()) s.setVisible(false);
      if (this.settingsTexts) for (const t of this.settingsTexts.values()) t.setVisible(false);
      if (this.minimapTexts) for (const t of this.minimapTexts.values()) t.setVisible(false);
      if (this.menuScreen !== 'workshop' && this.workshopTexts) {
        for (const t of this.workshopTexts.values()) t.setVisible(false);
      }
      if (this.workshopCardContentG) this.workshopCardContentG.clear();
      if (this.workshopInvContentG) this.workshopInvContentG.clear();
      if (this.workshopDragG) this.workshopDragG.clear();
      if (this.menuScreen !== 'weapon' && this.weaponShopTexts) {
        for (const t of this.weaponShopTexts.values()) t.setVisible(false);
      }
      if (this.shopCardContentG) this.shopCardContentG.clear();
      if (this.menuScreen !== 'vendor' && this.vendorShopTexts) {
        for (const t of this.vendorShopTexts.values()) t.setVisible(false);
      }
      if (!this.idolOffer && this.idolOfferTexts) {
        for (const t of this.idolOfferTexts.values()) t.setVisible(false);
      }
      if (!this.campfireOffer && this.campfireOfferTexts) {
        for (const t of this.campfireOfferTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'saveSelect' && this.saveSelectTexts) {
        for (const t of this.saveSelectTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'levelSelect' && this.levelSelectTexts) {
        for (const t of this.levelSelectTexts.values()) t.setVisible(false);
      }
      if (this.menuScreen !== 'levelSelect' && this.levelSelectPage !== undefined) {
        this.levelSelectPage = 1;
        this.levelSelectDrag = null;
      }

      // 结算页文案：非结算状态一律隐藏
      if (!(this.state === 'end' || this.state === 'fail') && this.settleTexts) {
        for (const t of this.settleTexts.values()) t.setVisible(false);
      }

      const ui = ctx.state.ui || {};
      const interfaceLevel = (ctx.state.level?.ui || 'battle') === 'interface';

      // hover / focus 交互状态：为当前数据页计算命中节点集
      const uph = this.uiPointer();
      const activeGraph = this.idolOffer || this.campfireOffer || this.settingsMode || this.menuScreen ? null
        : this.isMenuLevel() ? ui.login
        : (this.state === 'end' || this.state === 'fail' || this.playerDeathFlow) ? null
        : (this.state === 'paused' || interfaceLevel) ? ui.interface
        : this.isHubLevel() ? null
        : ui.battle;
      const hov = new Set();
      if (activeGraph) {
        for (const n of activeGraph.nodes || []) {
          if (nodeHidden(n, this.uiState)) continue;
          if (!n.interact?.hover) continue;
          const r = nodeRect(n);
          if (uph.x >= r.x && uph.x <= r.x + r.w && uph.y >= r.y && uph.y <= r.y + r.h) hov.add(n.id);
        }
      }
      this.uiHovered = hov;
      const uiCtx = (extra) => ({ now: this.time.now, hover: id => hov.has(id), press: id => this.pressScale(id), anim: this.uiInteractAnim, ...extra });
      if (this.idolOffer) {
        this.hideHudOverlay();
        this.drawIdolOffer();
        return;
      }
      if (this.campfireOffer) {
        this.hideHudOverlay();
        drawCampfireOffer(this);
        return;
      }
      if (this.settingsMode) {
        this.hideHudOverlay();
        this.drawSettingsOverlay();
        if (this.drawPageFadeOverlay()) this.finishCloseSettings();
        return;
      }
      if (this.menuScreen) {
        this.hideHudOverlay();
        this.uiG.fillStyle(0x000000, this.menuScreen === 'vendor' ? 0.85 : 1);
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
        if (this.menuScreen === 'weapon') this.drawWeaponShop(ui.weapon || {});
        else if (this.menuScreen === 'workshop') this.drawWorkshopUI();
        else if (this.menuScreen === 'vendor') this.drawVendorShop();
        else if (this.menuScreen === 'saveSelect') this.drawSaveSelectUI();
        else if (this.menuScreen === 'levelSelect') this.drawLevelSelect();
        // 右上角关闭按钮（黑底白线，悬停白底黑线）
        const bx0 = VIEW_W - 100, by0 = 40, bw0 = 64, bh0 = 64;
        const up0 = this.uiPointer();
        const cHover = up0.x >= bx0 && up0.x <= bx0 + bw0 && up0.y >= by0 && up0.y <= by0 + bh0;
        const scl0 = this.pressScale('menuClose');
        const cw0 = bw0 * scl0, ch0 = bh0 * scl0;
        const cx0 = bx0 + (bw0 - cw0) / 2, cy0 = by0 + (bh0 - ch0) / 2;
        this.uiG.fillStyle(cHover ? 0xffffff : 0x000000, 1);
        this.uiG.fillRoundedRect(cx0, cy0, cw0, ch0, 6);
        this.uiG.lineStyle(2, cHover ? 0x000000 : 0xffffff, 1);
        this.uiG.strokeRoundedRect(cx0, cy0, cw0, ch0, 6);
        this.uiG.lineStyle(3, cHover ? 0x000000 : 0xffffff, 1);
        this.uiG.lineBetween(cx0 + cw0 * 0.31, cy0 + ch0 * 0.29, cx0 + cw0 * 0.69, cy0 + ch0 * 0.71);
        this.uiG.lineBetween(cx0 + cw0 * 0.69, cy0 + ch0 * 0.29, cx0 + cw0 * 0.31, cy0 + ch0 * 0.71);
        this.buttons.push({ id: 'menuClose', x: bx0, y: by0, w: bw0, h: bh0 });
        if (this.drawPageFadeOverlay()) this.finishCloseMenuScreen();
      } else if (this.isMenuLevel()) {
        this.hideHudOverlay();
        if (this.intro) {
          // 开场动画：HUD 全部隐藏，只留虫洞
          for (const map of Object.values(this.uiTexts || {})) {
            for (const t of map.values()) t.setVisible(false);
          }
          for (const map of Object.values(this.uiImages || {})) {
            for (const s of map.values()) s.setVisible(false);
          }
          // 全黑阶段覆盖黑屏
          if (this.intro.phase === 'black') {
            this.uiG.fillStyle(0x000000, 1);
            this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
          }
        } else {
          renderGraph(this.uiG, ui.login, this.uiState, BINDINGS, uiCtx({ texts: this.uiTexts?.login, images: this.uiImages?.login, buttons: this.buttons }));
          if (this.drawLoginButtons) this.drawLoginButtons();
        }
      } else if (this.playerDeathFlow) {
        // 玩家被击败演出中（死亡运镜 / 黑幕停留）：世界 + 运镜叠层以外什么都不画。
        this.hideHudOverlay();
      } else if (this.state === 'end' || this.state === 'fail') {
        this.hideHudOverlay();
        this.drawSettlement();
      } else if (this.state === 'paused' || interfaceLevel) {
        this.hideHudOverlay();
        renderGraph(this.uiG, ui.interface, this.uiState, BINDINGS, uiCtx({ texts: this.uiTexts?.interface, images: this.uiImages?.interface, buttons: this.buttons }));
      } else if (this.isHubLevel()) {
        // 骑士之家：不显示战斗 HUD
        this.hideHudOverlay();
      } else {
        // 战斗 HUD（battle 节点图 + 血盾条/弹药/充能/设置 + 顶部 EXPLORE 条 + 小地图）整体入场：
        // 关卡开场动画(levelIntro)期间不显示，结束后淡入 0.5s → 停留 0.2s → 闪烁(消失0.15s→出现)。
        const hudAlpha = this.hudEnterAlpha();
        if (hudAlpha <= 0.001) {
          // 入场中 / 闪烁消失：HUD 完全隐藏（hideHudOverlay 顺带清空小地图持久层）
          this.hideHudOverlay();
          this.hudIndicatorText?.setVisible(false);
        } else {
          this.uiG.setAlpha(hudAlpha);                      // uiG 图形层（battle 节点图 / 血盾条 / EXPLORE 条）随 alpha 淡入
          renderGraph(this.uiG, ui.battle, this.uiState, BINDINGS, uiCtx({ texts: this.uiTexts?.battle, images: this.uiImages?.battle, buttons: this.buttons }));
          if (this.player) this.drawHud();
          this.drawHudIndicator();
          this.drawBossBar(hudAlpha);
          this.drawMinimap(this.uiG);
          if (hudAlpha < 0.999) this.uiG.setAlpha(1);   // 恢复，供后续 transition/levelIntro 黑幕全透明
          this.setHudAlpha(hudAlpha);                   // 独立对象（文本/设置图标/小地图持久层）各自控制透明度
        }
      }

      if (this.transition) {
        this.uiG.fillStyle(0x000000, this.transition.alpha);
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
      }
      if (this.levelIntro) {
        const progress = Math.min(1, this.levelIntro.t / this.levelIntro.duration);
        this.uiG.fillStyle(0x000000, 1 - Math.pow(progress, 2.4));
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
      }
      if (this.hideLoginButtonTexts && !this.isMenuLevel()) this.hideLoginButtonTexts();
    },

    // ── 以下 6 个 HUD 绘制方法归 systems/ui/hud.js 的 HudMixin 所有（此处曾因拆分区间重叠产生重复副本，已移除）──

    toggleGrowth() {
    const ctx = this.ctx;
      if (this.isMenuLevel()) return;
      if ((ctx.state.level?.ui || 'battle') === 'interface') return;
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
      this.syncUIState();
    },

    // ---------- 武器页 / 工坊页（全屏 UI 覆盖层） ----------
    openMenuScreen(screen) {
      if (this.editing || this.menuScreen) return;
      this.menuScreen = screen;
      if (screen === 'weapon') { this.shopTab = 'weapon'; this.shopScroll = 0; this.shopScrollDrag = null; this.shopHoverT = {}; this.shopTabAnim = null; this.shopTabPrev = 'weapon'; }
      if (screen === 'levelSelect') { this.levelSelectPage = 1; this.levelSelectOpenAt = this.time.now; this.smallLevelPan = { x: 0, y: 0 }; this.levelHover = {}; this.levelConn = {}; }
      if (this.state === 'playing') { this.prevState = 'playing'; this.state = 'paused'; }
      else this.prevState = null;
      this.pageFade = { phase: 'in', t0: this.time.now, dur: PAGE_FADE_MS };
    },

    closeMenuScreen() {
      if (!this.menuScreen) return;
      if (this.pageFade?.phase === 'out') return;
      this.pageFade = { phase: 'out', t0: this.time.now, dur: PAGE_FADE_MS };
    },

    finishCloseMenuScreen() {
      this.pageFade = null;
      this.menuScreen = null;
      if (this.prevState === 'playing') { this.state = 'playing'; this.prevState = null; }
    },

    // 页面蒙层淡入/淡出：计算当前覆盖层 alpha。'in' 为页面淡入（蒙层 1→0）；'out' 为页面淡出（蒙层 0→1）
    pageFadeAlpha() {
      if (!this.pageFade) return { a: 0, done: false };
      const p = Math.min(1, (this.time.now - this.pageFade.t0) / this.pageFade.dur);
      return this.pageFade.phase === 'in' ? { a: 1 - p, done: p >= 1 } : { a: p, done: p >= 1 };
    },

    // 绘制当前页面的蒙层覆盖，返回 true 表示淡出完成、调用方应执行收尾关页
    drawPageFadeOverlay() {
      if (!this.pageFade) return false;
      const fa = this.pageFadeAlpha();
      if (fa.a > 0.001) {
        this.uiG.fillStyle(0x000000, fa.a);
        this.uiG.fillRect(0, 0, VIEW_W, VIEW_H);
      }
      if (!fa.done) return false;
      if (this.pageFade.phase === 'in') { this.pageFade = null; return false; }
      return true;
    },

    // ---------- 战斗 HUD 设置菜单（暂停蒙层） ----------
    openSettingsOverlay() {
      if (this.editing || this.settingsMode) return;
      this.settingsMode = 'menu';
      if (this.state === 'playing') { this.settingsPrev = 'playing'; this.state = 'paused'; }
      else this.settingsPrev = null;
      this.pageFade = { phase: 'in', t0: this.time.now, dur: PAGE_FADE_MS };
      this.drawUI();
    },

    closeSettingsOverlay() {
      if (!this.settingsMode) return;
      if (this.pageFade?.phase === 'out') return;
      this.pageFade = { phase: 'out', t0: this.time.now, dur: PAGE_FADE_MS };
      this.drawUI();
    },

    finishCloseSettings() {
      this.pageFade = null;
      this.settingsMode = null;
      if (this.settingsPrev === 'playing') { this.state = 'playing'; this.settingsPrev = null; }
      this.drawUI();
    },

    retryBattle() {
      this.settingsMode = null;
      this.settingsPrev = null;
      this.pageFade = null;
      this.restart();
    },

    exitToHome() {
    const ctx = this.ctx;
      this.settingsMode = null;
      this.settingsPrev = null;
      this.pageFade = null;
      ctx.onOpenLevel?.('knight-home');
    },

    drawSettingsOverlay() {
      const g = this.uiG;
      g.fillStyle(0x000000, 0.82);
      g.fillRect(0, 0, VIEW_W, VIEW_H);

      const ensure = (id, size, color) => {
        let t = this.settingsTexts.get(id);
        if (!t) {
          t = this.add.text(0, 0, '', { fontFamily: FONT_TECH_SC, fontSize: size, color }).setDepth(1002);
          this.cameras.main.ignore(t);
          this.settingsTexts.set(id, t);
        }
        t.setFontSize(size).setColor(color).setVisible(true);
        return t;
      };

      if (this.settingsMode === 'confirm') {
        const pw = 640, ph = 340, px = (VIEW_W - pw) / 2, py = (VIEW_H - ph) / 2;
        g.fillStyle(0x0d1b2d, 0.98);
        g.fillRoundedRect(px, py, pw, ph, 12);
        g.lineStyle(2, 0x6fd3ff, 1);
        g.strokeRoundedRect(px, py, pw, ph, 12);
        ensure('tips1', '28px', '#ffffff').setOrigin(0.5).setPosition(VIEW_W / 2, py + 78).setText('确定退出吗？');
        ensure('tips2', '22px', '#9fc3d8').setOrigin(0.5).setPosition(VIEW_W / 2, py + 150).setText('已经获得的钻石无法带出');

        const bw = 200, bh = 60, gap = 60, by = py + 230;
        const total = bw * 2 + gap;
        const sx = (VIEW_W - total) / 2;
        for (const [id, label] of [['cancel', '取消'], ['confirm', '确定']]) {
          const i = id === 'cancel' ? 0 : 1;
          const bx = sx + i * (bw + gap);
          const scl = this.pressScale(`settings_${id}`);
          const cw = bw * scl, ch = bh * scl;
          const cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2;
          g.fillStyle(id === 'confirm' ? 0xffffff : 0x123047, 1);
          g.fillRoundedRect(cx, cy, cw, ch, 8);
          g.lineStyle(2, id === 'confirm' ? 0x000000 : 0x6fd3ff, 1);
          g.strokeRoundedRect(cx, cy, cw, ch, 8);
          ensure(`btn_${id}`, '24px', id === 'confirm' ? '#000000' : '#ffffff').setOrigin(0.5).setPosition(bx + bw / 2, by + bh / 2).setText(label);
          this.buttons.push({ id: `settings_${id}`, x: bx, y: by, w: bw, h: bh });
        }
        return;
      }

      ensure('title', '38px', '#ffffff').setOrigin(0.5).setPosition(VIEW_W / 2, 220).setText('设置');
      const items = [
        { id: 'exit', label: '退出', src: ICON_EXIT },
        { id: 'retry', label: '再来一次', src: ICON_RETRY },
        { id: 'continue', label: '继续', src: ICON_CONTINUE }
      ];
      const bw = 230, bh = 260, gap = 80;
      const total = bw * 3 + gap * 2;
      const startX = (VIEW_W - total) / 2;
      const by = 360;
      items.forEach((item, i) => {
        const bx = startX + i * (bw + gap);
        const scl = this.pressScale(`settings_${item.id}`);
        const cw = bw * scl, ch = bh * scl;
        const cx = bx + (bw - cw) / 2, cy = by + (bh - ch) / 2;
        g.fillStyle(0x0d1b2d, 0.9);
        g.fillRoundedRect(cx, cy, cw, ch, 12);
        g.lineStyle(2, 0x6fd3ff, 1);
        g.strokeRoundedRect(cx, cy, cw, ch, 12);
        const spr = this.iconSprite(item.id, item.src);
        if (spr) {
          spr.setPosition(bx + bw / 2, by + 86);
          spr.setDisplaySize(84, 84);
          spr.setVisible(true);
        }
        ensure(`btn_${item.id}`, '28px', '#ffffff').setOrigin(0.5).setPosition(bx + bw / 2, by + 200).setText(item.label);
        this.buttons.push({ id: `settings_${item.id}`, x: bx, y: by, w: bw, h: bh });
      });
    },

    onUIPointer(p) {
    const ctx = this.ctx;
      // 神像/火堆弹窗离场动画进行中，或火堆两层切换动画进行中：不响应任何点击
      if (this.idolOffer?.closing || this.campfireOffer?.closing || this.campfireOffer?.switch) return;
      // 页面蒙层淡出进行中：不响应任何点击
      if (this.pageFade?.phase === 'out') return;
      const up = this.uiPointer();
      const px = up.x, py = up.y;
      for (const b of this.buttons) {
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
          if (b.id === 'menuClose') {
            this.pressAnim('menuClose');
            this.closeMenuScreen();
          }
          else if (b.id === 'close') { this.pressAnim(b.id); this.toggleGrowth(); }
          else if (b.id === 'settings_exit') { this.pressAnim(b.id); this.settingsMode = 'confirm'; this.drawUI(); }
          else if (b.id === 'settings_retry') { this.pressAnim(b.id); this.retryBattle(); }
          else if (b.id === 'settings_continue') { this.pressAnim(b.id); this.closeSettingsOverlay(); }
          else if (b.id === 'settings_confirm') { this.pressAnim(b.id); this.exitToHome(); }
          else if (b.id === 'settings_cancel') { this.pressAnim(b.id); this.settingsMode = 'menu'; this.drawUI(); }
          else if (b.id && b.id.startsWith('upgrade_')) { this.pressAnim(b.id); this.applyUpgrade(b.id.slice(8)); }
          else if (b.id && b.id.startsWith('buyWeapon_')) { this.pressAnim(b.id); this.buyWeapon(b.id.slice(10)); }
          else if (b.id && b.id.startsWith('buyMod_')) { this.pressAnim(b.id); this.buyMod(b.id.slice(7)); }
          else if (b.id && b.id.startsWith('buyPet_')) { this.pressAnim(b.id); this.buyPet(b.id.slice(7)); }
          else if (b.id && b.id.startsWith('buyVendor_')) { this.pressAnim(b.id); this.buyVendorItem(Number(b.id.slice(10))); }
          else if (b.id === 'vendorRoll') { this.pressAnim(b.id); this.rollVendorSlot(); }
          else if (b.id && b.id.startsWith('idolCard_')) { this.pressAnim(b.id); this.chooseIdolBuff(Number(b.id.slice(9))); }
          else if (b.id === 'campfireCard_0') { this.pressAnim(b.id); this.campfireChooseHeal(); }
          else if (b.id === 'campfireCard_1') { this.pressAnim(b.id); this.campfireChooseUpgrade(); }
          else if (b.id && b.id.startsWith('campfireUpgrade_')) { this.pressAnim(b.id); this.campfirePickUpgrade(Number(b.id.slice(16))); }
          else if (b.id && b.id.startsWith('workshopCard_')) { this.pressAnim(b.id); this.toggleWorkshopWeapon(b.id.slice(13)); }
          else if (b.id && b.id.startsWith('workshopTab_')) { this.pressAnim(b.id); this.workshopTab = b.id.slice(12); this.drawUI(); }
          else if (b.id && b.id.startsWith('shopTab_')) { this.pressAnim(b.id); this.shopTab = b.id.slice(8); this.shopScroll = 0; this.shopScrollDrag = null; this.drawUI(); }
          else if (b.id && b.id.startsWith('workshopSlot_')) { this.pressAnim(b.id); this.clickWorkshopSlot(Number(b.id.slice(13))); }
          else if (b.id && b.id.startsWith('selectSave_')) { this.pressAnim(b.id); ctx.onSelectSave?.(b.id.slice(11)); }
          else if (b.id === 'levelBack') { this.pressAnim(b.id); this.levelSelectPage = 1; this.drawUI(); }
          else if (b.id && b.id.startsWith('levelMode_')) {
            this.pressAnim(b.id);
            const key = b.node?.key, unlocked = b.node?.unlocked;
            if (key === 'explore') { this.levelSelectPage = 2; this.levelSelectOpenAt = this.time.now; this.drawUI(); }
            else if (key === 'guard' && unlocked) { ctx.onOpenLevel?.('Level2-Scene1'); }
          }
          else if (b.id && b.id.startsWith('levelSmall_')) {
            if (b.node?.unlocked) { this.pressAnim(b.id); ctx.onOpenLevel?.(b.node?.levelId); }
            else this.pressAnim(b.id);
          }
          else if (b.id === 'saveSelectBack') { this.pressAnim('saveSelectBack'); this.closeMenuScreen(); }
          else if (b.id === 'settleHome') { this.pressAnim('settleHome'); this.exitToHome(); }
          else if (b.id === 'new' || b.id === 'continue' || b.id === 'weapon' || b.id === 'workshop' || b.id === 'settings') { this.pressAnim(b.id); this.onLoginButtonClick(b.id); }
          else if (b.id) this.pressAnim(b.id);
          return;
        }
      }
      // 神像弹窗：点击卡片以外的空白处触发离场动画（不消耗神像，可再次交互）
      if (this.idolOffer && !this.idolOffer.closing) this.idolOffer.closing = true;
      // 火堆弹窗：第二层点空白回第一层；第一层点空白触发离场动画
      if (this.campfireOffer && !this.campfireOffer.closing) {
        if (this.campfireOffer.layer === 2) this.campfireBackToFirst();
        else this.campfireOffer.closing = true;
      }
    },

    // 按钮按下缩放动画：记录按下时间，绘制时按剩余时间缩小
    pressAnim(id, duration = 120) {
      this.pressAnims = this.pressAnims || {};
      this.pressAnims[id] = { until: this.time.now + duration, dur: duration };
    },

    pressScale(id) {
      const a = this.pressAnims?.[id];
      if (!a) return 1;
      const remain = a.until - this.time.now;
      if (remain <= 0) { delete this.pressAnims[id]; return 1; }
      const k = remain / a.dur;
      return 0.85 + 0.15 * (1 - k);
    },
};
