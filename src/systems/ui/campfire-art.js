/**
 * 文件职责：休息火堆两层弹窗 UI（全屏蒙层 + 底部黑条 + 第一层白卡[生命回复/杰作升级] + 第二层武器升级三按钮）
 * 归属分类：UI交互
 * 主要导出：drawCampfireOffer
 * 依赖：systems/constants.js、systems/ui/vendor-shop-art.js、systems/art/design-store.js、
 *       systems/art/asset-render.js、systems/combat/weapons.js、systems/ui/entity-art.js
 * 说明：参考神像弹窗（world-overlay.js 的 drawIdolOffer）实现：黑条+卡片自下而上飞入、closing 向下滑出、
 *       campfireOfferTexts 文本池、this.buttons.push、pressScale 悬停/按下缩放。模块导出函数，import 后直接调用。
 *       两层切换（1↔2）按 offer.switch 分两段：旧层先向下消失，随后新层从下方进场（严格串行，不同帧重叠）。
 */
import { VIEW_W, VIEW_H, FONT_TECH_SC, WEAPON_BG_ASSET, PLAYER_ART } from '../constants.js';
import { resolveArtRef, getArtRef, shopIconVariant, drawShopIcon } from './vendor-shop-art.js';
import { getDesign, ensureDesign } from '../art/design-store.js';
import { drawDesignCentered } from '../art/asset-render.js';
import { WEAPONS } from '../combat/weapons.js';
import { drawHexRingPlayer } from './entity-art.js';

// ── 弹窗几何常量（统一在此调参）──
const SLIDE_MS = 450;                 // 飞入/滑出时长（ms）
const BAR_H = 336;                    // 底部黑条高度（同神像弹窗）
const CARD_W = 408;                   // 卡片宽（同神像常量）
const CARD_H = 216;                   // 卡片高
const CARD_GAP = 96;                  // 卡片间距
const CARD_TOP_IN_BAR = 54;           // 卡片顶相对黑条顶的偏移
const ICON_ZOOM = 1.1;                // 卡片图标统一放大系数（两层共用，保留可调）
const DESC_SIZE_RATIO = 0.85;         // 说明字号相对基准字号比率（标题与说明字号拉开层级）
// 第一层白卡内容偏移（相对卡中心）
const ICON_OFFSET_Y = -24;            // 图标圆心
const ICON_BOX = 66 * ICON_ZOOM;      // 图标绘制框尺寸（66 → 72.6）
const NAME_OFFSET_Y = 62;             // 标题
const DESC_OFFSET_Y = 90;             // 说明
const NAME_SIZE = '24px';             // 第一层标题字号（加粗）
const DESC_SIZE = `${20 * DESC_SIZE_RATIO}px`;   // 第一层说明字号（20 × 0.85 = 17px，普通字重）
// 第二层武器升级按钮内容偏移（相对卡中心）
const UP_ICON_OFFSET_Y = -44;
const UP_ICON_BOX = 84 * ICON_ZOOM;   // 84 → 92.4
const UP_ENTRY_OFFSET_Y = 56;         // 词条文本中心（原武器名位置附近，视觉居中于卡片下半）
const UP_DESC_SIZE = `${Math.round(18 * DESC_SIZE_RATIO)}px`;  // 18 × 0.85 ≈ 15px，普通字重
const UP_DESC_WRAP = CARD_W - 56;     // 词条自动换行宽度
const WEAPON_ART_RATIO = 0.72;        // 武器美术直径 / 底盘直径（工坊口径 0.52 / 0.72）
// 两层切换动画（1↔2）：阶段1 旧层向下消失 → 阶段2 新层自下方进场（严格串行，同一帧只画一层）
const LAYER_OUT_MS = 220;                       // 旧层向下消失时长（ms）
const LAYER_IN_MS = 260;                        // 新层从下方进场时长（ms）
const LAYER_SHIFT = BAR_H - CARD_TOP_IN_BAR;   // 出/入场位移 = 282：卡片顶正好滑到屏幕底部（完全出屏，不留残影）

// 第一层两张白卡：左「生命回复」右「杰作升级！」（图标美术方案见 vendor-shop-art 解析库）
const FIRST_CARDS = [
  { title: '生命回复', desc: '回复100%生命值', artType: '像素', artName: '生命值回满图标' },
  { title: '杰作升级！', desc: '强力升级你的武器..暂时', artType: '动态资产', artName: '杰作升级图标' }
];

// 休息火堆两层弹窗主绘制（由 ui-runtime.drawUI 在隐藏 HUD 后调用）
export function drawCampfireOffer(scene) {
  const g = scene.uiG;
  const offer = scene.campfireOffer;
  if (!offer) return;

  scene.campfireOfferTexts = scene.campfireOfferTexts || new Map();
  // 本帧 setVisible(true) 过的文本 id 集合：帧末据此隐藏未绘制文本（含切层后旧层残留）
  const visibleIds = new Set();
  const ensureText = (id, size, color, bold) => {
    let t = scene.campfireOfferTexts.get(id);
    if (!t) {
      t = scene.add.text(0, 0, '', {
        fontFamily: FONT_TECH_SC, fontSize: size, color, fontStyle: bold ? 'bold' : 'normal'
      }).setDepth(1001);
      scene.cameras.main.ignore(t);
      scene.campfireOfferTexts.set(id, t);
    }
    t.setFontSize(size).setColor(color);
    t.setStyle({ fontStyle: bold ? 'bold' : 'normal' });   // 已有实例也能切换粗细
    t.setVisible(true);
    visibleIds.add(id);
    return t;
  };

  const now = scene.time.now;
  let slide;
  if (offer.closing) {
    // 离场：黑条连同卡片整体向下滑出视窗外，结束后才真正关闭
    const q = Math.min(1, (now - (offer.closeStart ??= now)) / SLIDE_MS);
    const easeQ = 1 - Math.pow(1 - q, 3);
    slide = easeQ * BAR_H;
    if (q >= 1) { scene.closeCampfireOffer(); return; }
  } else {
    const p = Math.min(1, (now - (offer.startT ??= now)) / SLIDE_MS);
    const ease = 1 - Math.pow(1 - p, 3);
    slide = (1 - ease) * BAR_H;
  }

  offer.hoverT = offer.hoverT || [];

  g.fillStyle(0x000000, 0.65);
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.fillStyle(0x000000, 0.8);
  g.fillRect(0, VIEW_H - BAR_H + slide, VIEW_W, BAR_H);

  const hover = scene.uiPointer();
  const t = now / 1000;
  const top = VIEW_H - BAR_H + CARD_TOP_IN_BAR + slide;

  // ── 第一层：2 张白卡（生命回复 / 杰作升级！）──
  const drawLayer1 = (yShift) => {
    const topY = top + yShift;
    const n = FIRST_CARDS.length;
    const totalW = CARD_W * n + CARD_GAP * (n - 1);
    const startX = (VIEW_W - totalW) / 2;
    for (let i = 0; i < n; i++) {
      const card = FIRST_CARDS[i];
      const cx = startX + i * (CARD_W + CARD_GAP) + CARD_W / 2;
      const cy = topY + CARD_H / 2;
      const inCard = hover.x >= cx - CARD_W / 2 && hover.x <= cx + CARD_W / 2
        && hover.y >= topY && hover.y <= topY + CARD_H;
      offer.hoverT[i] = Math.max(0, Math.min(1, (offer.hoverT[i] || 0) + (inCard ? 0.14 : -0.14)));
      const s = (1 + 0.1 * offer.hoverT[i]) * scene.pressScale(`campfireCard_${i}`);

      g.fillStyle(0xffffff, 1);
      g.fillRect(cx - CARD_W * s / 2, cy - CARD_H * s / 2, CARD_W * s, CARD_H * s);

      // 图标：白卡上纯白图标不可见 → 走 shopIconVariant(design,false) 取黑色款；未加载时黑圆占位并触发加载
      const design = getArtRef(card.artType, card.artName);
      if (design) {
        drawShopIcon(g, shopIconVariant(design, false), cx, cy + ICON_OFFSET_Y * s, ICON_BOX * s);
      } else {
        resolveArtRef(card.artType, card.artName);
        g.fillStyle(0x000000, 1);
        g.fillCircle(cx, cy + ICON_OFFSET_Y * s, ICON_BOX * s / 2);
      }

      ensureText(`campfireCard_${i}_name`, NAME_SIZE, '#000000', true).setOrigin(0.5)
        .setPosition(cx, cy + NAME_OFFSET_Y * s).setText(card.title);
      ensureText(`campfireCard_${i}_desc`, DESC_SIZE, '#000000', false).setOrigin(0.5)
        .setPosition(cx, cy + DESC_OFFSET_Y * s).setText(card.desc);

      scene.buttons.push({ id: `campfireCard_${i}`, x: cx - CARD_W / 2, y: topY, w: CARD_W, h: CARD_H });
    }
  };

  // ── 第二层：3 个武器升级按钮横排（黑色武器底盘 + 武器美术 + 属性词条）──
  const drawLayer2 = (yShift) => {
    const topY = top + yShift;
    const opts = offer.options || [];
    const n = opts.length;
    if (!n) return;
    const totalW = CARD_W * n + CARD_GAP * (n - 1);
    const startX = (VIEW_W - totalW) / 2;
    for (let i = 0; i < n; i++) {
      const op = opts[i];
      if (!op || !(op.entries || []).length) continue;   // 无词条：保留按钮位但跳过绘制
      const cx = startX + i * (CARD_W + CARD_GAP) + CARD_W / 2;
      const cy = topY + CARD_H / 2;
      const inCard = hover.x >= cx - CARD_W / 2 && hover.x <= cx + CARD_W / 2
        && hover.y >= topY && hover.y <= topY + CARD_H;
      offer.hoverT[i] = Math.max(0, Math.min(1, (offer.hoverT[i] || 0) + (inCard ? 0.14 : -0.14)));
      const s = (1 + 0.1 * offer.hoverT[i]) * scene.pressScale(`campfireUpgrade_${i}`);

      g.fillStyle(0xffffff, 1);
      g.fillRect(cx - CARD_W * s / 2, cy - CARD_H * s / 2, CARD_W * s, CARD_H * s);

      // 图标：黑色武器底盘（WEAPON_BG_ASSET）→ 武器美术叠加（直径 = 底盘 × 0.72）
      const wt = op.weaponType;
      const iconY = cy + UP_ICON_OFFSET_Y * s;
      if (!getDesign(WEAPON_BG_ASSET)) ensureDesign(WEAPON_BG_ASSET);
      const bgD = getDesign(WEAPON_BG_ASSET);
      if (bgD) drawDesignCentered(g, bgD, cx, iconY, UP_ICON_BOX * s, t);

      // 美术优先级：玩家该武器美术稿 → WEAPONS[wt].appearance → 局内环组兜底（去发射环/武器球）
      const artId = scene.player?.arts?.[wt];
      let design = artId ? getDesign(artId) : null;
      if (!design && artId) ensureDesign(artId);
      if (!design) {
        const app = WEAPONS[wt]?.appearance;
        if (app && Array.isArray(app.elements) && app.elements.length) design = app;
      }
      if (design) {
        drawDesignCentered(g, design, cx, iconY, UP_ICON_BOX * WEAPON_ART_RATIO * s, t);
      } else {
        // 兜底：局内环组美术（drawHexRingPlayer），hideWeaponRing 去掉最外圈发射环与武器球，只留 4 个同心环。
        // 缩放使环组直径 = 底盘直径 × WEAPON_ART_RATIO（最外可见环 = PLAYER_ART.bodyRingRadius）。
        const ringScale = UP_ICON_BOX * WEAPON_ART_RATIO * s / (2 * PLAYER_ART.bodyRingRadius);
        drawHexRingPlayer(g, {
          x: cx, y: iconY, weapon: { ringColor: WEAPONS[wt]?.ringColor || '#ffa914' },
          weaponAngle: 0, artScale: 1, moveLeanX: 0, moveLeanY: 0, scheme: 'hex-ring'
        }, ringScale, { hideWeaponRing: true });
      }

      // 词条文本：属性类 desc（如「暴击率 +10%」）/ 改件类 desc；desc 为空回退 name；多行居中
      const desc = (op.entries || [])
        .map(e => (e && (e.desc || e.name)) || '')
        .filter(Boolean).join('\n');
      const descT = ensureText(`campfireUpgrade_${i}_desc`, UP_DESC_SIZE, '#000000', false);
      descT.setOrigin(0.5).setWordWrapWidth(UP_DESC_WRAP * s)
        .setPosition(cx, cy + UP_ENTRY_OFFSET_Y * s).setText(desc);

      scene.buttons.push({ id: `campfireUpgrade_${i}`, x: cx - CARD_W / 2, y: topY, w: CARD_W, h: CARD_H });
    }
  };

  // ── 两层切换：两段式（严格串行，同一帧只画一层，消除同帧重叠的视觉残留）──
  //   阶段1 [0, OUT)：只画旧层 offer.switch.from，向下移出屏幕底部
  //   阶段2 [OUT, OUT+IN)：只画当前层 offer.layer，从屏幕下方滑入到位
  //   超出总时长：delete offer.switch，之后只画当前层
  const cur = offer.layer ?? 1;
  if (offer.switch) {
    const el = now - (offer.switch.startT ??= now);
    if (el < LAYER_OUT_MS) {
      // 阶段1：旧层向下消失（只画旧层）
      const ease = 1 - Math.pow(1 - el / LAYER_OUT_MS, 3);
      if (offer.switch.from === 1) drawLayer1(ease * LAYER_SHIFT);
      else drawLayer2(ease * LAYER_SHIFT);
    } else if (el < LAYER_OUT_MS + LAYER_IN_MS) {
      // 阶段2：新层从下方进场（只画当前层）
      const ease = 1 - Math.pow(1 - (el - LAYER_OUT_MS) / LAYER_IN_MS, 3);
      if (cur === 1) drawLayer1((1 - ease) * LAYER_SHIFT);
      else drawLayer2((1 - ease) * LAYER_SHIFT);
    } else {
      delete offer.switch;              // 动画结束：之后只画当前层
      if (cur === 1) drawLayer1(0);
      else drawLayer2(0);
    }
  } else if (cur === 1) {
    drawLayer1(0);
  } else {
    drawLayer2(0);
  }

  // 统一隐藏本帧未绘制的文本（修复从第一层切到第二层后第一层文本残留）
  for (const [id, txt] of scene.campfireOfferTexts) {
    if (!visibleIds.has(id)) txt.setVisible(false);
  }
}
