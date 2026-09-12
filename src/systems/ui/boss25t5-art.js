/**
 * BOSS「原型机-2-5T5」渲染模块（子任务 C）。
 *
 * 职责：
 *   1) 本体：把画板设计稿（asset-1788964413981）动态覆写后交给 renderAsset ——
 *      圆弧4（元素[3]）始终瞄准玩家；圆弧5（元素[4]）按 e.arc5Phase 自转；
 *      护盾（元素[2] 全周刻度圈）单独按 e.shieldAlpha 渐进渐隐；受击闪白；
 *      技能3 合并态（重叠 > mergeOverlapPct）时 [3][4] 合成一条紫色弧。
 *   2) 技能区域 e.zones：延长线 / 收紧同心弧（s1）/ 向外扩张弧（s2·s3）/
 *      紫色重叠上色 / keep·fade 的黑色遮罩。
 *   3) 技能4 灰色弧 e.skill4Fx。
 *   4) 技能5 蓝色漩涡（场景级数组 scene.boss25t5Vortices）：6 槽位蓝色圆弧
 *      「旋转 + 向圆心收缩 + 末段渐隐 + 原位重生」+ 中心星环 + 生命值细血条；
 *      相位只读漩涡自身的 v.t（毫秒），传入的 t（秒）仅用于击杀淡出环。
 *
 * 依赖：systems/art/asset-render.js（renderAsset / hexToInt）、systems/combat/boss25t5.js（常量）。
 *       不 import Phaser、不 import game-scene（避免环）。
 * 导出：drawBoss25T5Body, drawBoss25T5Zones, drawBoss25T5Vortices
 *
 * 元素编号契约（见 combat/boss25t5.js 顶部）：
 *   [0] 白双弧 r80  [1] 红双弧 r80  [2] 全周刻度圈 r220（护盾）
 *   [3] 青弧 r185（圆弧4，瞄玩家）  [4] 红弧 r185（圆弧5，自转）
 *   [5] 核心六边形 r30  [6] 3 红弧 r85
 */
import { renderAsset, hexToInt } from '../art/asset-render.js';
import { BOSS25T5_DESIGN } from '../combat/boss25t5.js';

const DEG = Math.PI / 180;

// 区域配色：s1 蓝 / s2 红 / s3 紫（延长线用偏暗一档，弧用更亮一档）
const KIND_LINE = { s1: '#4fc3f7', s2: '#ff3b3b', s3: '#b06bff' };
const KIND_ARC = { s1: '#00fbff', s2: '#ff3b3b', s3: '#b06bff' };
const PURPLE = '#b06bff';
const SKILL4_COLOR = '#cfcfcf';
// 同心圆弧的最大圈数（三种技能统一口径）：圈数超限时等比放大间隔，避免单帧上千次 stroke
const MAX_RINGS = 64;

// ── 技能5「蓝色漩涡」渲染常量（设计稿 asset-1789096080271）──
const VORTEX_SLOTS = 6;                       // 圆弧槽位（对应设计稿 6 个 arc 元素）
const ARC_LIFE_MS = 900;                      // 单槽位「最大半径 → 圆心消失」的存活时长；回绕即原位重生
const VORTEX_REF_R = 150;                     // 设计稿基准半径（125/150）：旋转量按 v.r 等比缩放
const VORTEX_MAX_R_RATIO = 0.83;              // 最大半径 = v.r * 0.83（设计稿 125/150）
const VORTEX_FADE_FROM = 0.75;                // 生命进度后 25% 开始渐隐
const VORTEX_LW_MAX = 12;                     // 起始线宽（设计稿 12）
const VORTEX_LW_MIN = 2;                      // 收束线宽（设计稿 2）
const VORTEX_SPAN_DEG = [80, 120, 80, 120, 80, 120];   // 张角交替 80°/120°
const VORTEX_SPIN = [6, -6, 12, 4, -4, 9];             // 各槽位旋转量（rad，作用于整段生命；设计稿 ±4~12）
const VORTEX_COLOR_A = hexToInt('#00fbff');   // 青
const VORTEX_COLOR_B = hexToInt('#4fc3f7');   // 浅蓝
// 中心星环（设计稿 pattern:'hands'：r30 / 密度 60 / 刻度长 12 / 内指 / rotSpeed 0.5）
const VORTEX_RING_R_RATIO = 0.2;
const VORTEX_TICK_COUNT = 60;
const VORTEX_TICK_LEN = 12;
const VORTEX_RING_SPIN = 0.5;
const VORTEX_TICK_COLOR = hexToInt('#ffffff');
// 生命值细血条（仅 hp < maxHp 时画）
const VORTEX_BAR_H = 3;
const VORTEX_BAR_GAP = 24;
const VORTEX_BAR_MIN_W = 24;
const VORTEX_BAR_MAX_W = 240;
const VORTEX_BAR_COLOR = hexToInt('#00fbff');
// 击杀消散淡出环（模块级自包含状态）
const VORTEX_FADE_S = 0.25;
const VORTEX_FADE_MAX = 8;                    // 淡出记录上限（超出丢弃最旧）

// ── 小工具 ──
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function wrapPi(a) { let r = a; while (r > Math.PI) r -= Math.PI * 2; while (r < -Math.PI) r += Math.PI * 2; return r; }

// 扇形正张角（a1-a0 取最短正张角，与 combat/boss25t5.js 同口径）
function spanOf(a0, a1) {
  let s = a1 - a0;
  while (s <= 1e-6) s += Math.PI * 2;
  while (s > Math.PI * 2) s -= Math.PI * 2;
  return s;
}

// pointInPolygon：与 combat/geometry.js / combat/boss25t5.js 内实现逐字一致（本地复用，避免 import 环）
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// 区域 extend 相位时长（zoneDur 未导出，此处按 kind 内联同口径的 extend 时长）
function zoneExtendMs(cfg, kind) {
  if (kind === 's1') return Math.max(1, cfg.s1ExtendMs ?? 1000);
  if (kind === 's3') return Math.max(1, cfg.s3ExtendMs ?? cfg.s2ExtendMs ?? 2000);
  return Math.max(1, cfg.s2ExtendMs ?? 2000);
}

// ── 本体 ──
/**
 * 绘制 BOSS 本体（含技能4 灰弧）。
 * @returns {boolean} true = 已按设计稿绘制；false = 设计稿缺失（调用方落回默认形状）
 */
export function drawBoss25T5Body(g, e, design, target, t = 0, alpha = 1) {
  if (!e) return false;

  // 技能4 灰色弧（与设计稿是否存在无关；先画，位于本体之下）
  drawSkill4Fx(g, e, target, alpha);

  if (!design || !Array.isArray(design.elements) || !design.elements.length) return false;

  const artScale = e.artScale || 1;
  const cfg = e.bossCfg || {};
  const spanDeg = cfg.arcSpanDeg ?? BOSS25T5_DESIGN.arcSpanDeg;
  const spanRad = spanDeg * DEG;
  // target 为空（编辑器态 / 无玩家）时兜底朝上（-π/2）——与 drawEnemyShape 其它分支一致
  const aim = target ? Math.atan2(target.y - e.y, target.x - e.x) : -Math.PI / 2;
  // 两弧各有自转角：参战弧在等待期被系统转到玩家方向（boss25t5.js:arcTargetsFor），
  // 因此这里直接读各自相位，不再把 aim 当作圆弧4 的角度。
  const arc4Center = e.arc4Phase ?? 0;
  const arc5Center = e.arc5Phase ?? 0;

  // 与 boss25t5ArcAngles 同公式的角度重叠占比（等宽弧：重叠宽度 = span - 圆心角距）
  const distAng = Math.abs(wrapPi(arc5Center - arc4Center));
  const overlapPct = distAng >= spanRad ? 0 : (1 - distAng / spanRad) * 100;
  const merged = overlapPct > (cfg.mergeOverlapPct ?? 50);
  const flash = (e.hitFlashT || 0) > 0;
  const white = '#ffffff';

  const els = design.elements;
  const dyn = [];
  let shieldEl = null;
  for (let i = 0; i < els.length; i++) {
    const el = els[i];
    if (!el) continue;
    if (i === 2) { shieldEl = el; continue; }              // 护盾：单独按 shieldAlpha 渲染
    if (merged && (i === 3 || i === 4)) continue;          // 合并态：[3][4] 由合成紫弧代替

    const c = { ...el };
    // 圆弧4/5 相位对齐「中心角 − 张角/2」（与 boss25t5ArcAngles 一致），rotSpeed 置 0 防双重旋转
    if (i === 3) { c.phase = arc4Center - spanRad / 2; c.rotSpeed = 0; }
    else if (i === 4) { c.phase = arc5Center - spanRad / 2; c.rotSpeed = 0; }
    // 受击闪白：本体描边色与长短针色临时替换为白
    if (flash) { c.color = white; c.handLongColor = white; c.handShortColor = white; }
    dyn.push(c);
  }

  // 技能3 合并紫弧：合并中心 = arc4Center/arc5Center 最短路径中点，张角 = spanRad
  if (merged) {
    const mid = arc4Center + wrapPi(arc5Center - arc4Center) / 2;
    const src = els[3] || els[4] || {};
    dyn.push({
      ...src,
      shape: 'arc',
      count: 1,
      orbitRadius: 0,
      radius: src.radius || BOSS25T5_DESIGN.arcRadius,
      lineWidth: src.lineWidth || 12,
      pattern: 'plain',
      arcStart: 0,
      arcEnd: spanDeg,
      rotSpeed: 0,
      phase: mid - spanRad / 2,
      color: flash ? white : PURPLE,
      handLongColor: flash ? white : PURPLE,
      handShortColor: flash ? white : PURPLE
    });
  }

  renderAsset(g, { ...design, elements: dyn }, e.x, e.y, t, artScale, undefined, alpha);

  // 护盾（元素[2] 全周刻度圈）：透明度 = e.shieldAlpha（0..1）→ 出现/消失渐进渐隐
  const shieldAlpha = clamp01(e.shieldAlpha ?? 1);
  if (shieldEl && shieldAlpha > 0.02) {
    const sc = { ...shieldEl };
    if (flash) { sc.color = white; sc.handLongColor = white; sc.handShortColor = white; }
    renderAsset(g, { ...design, elements: [sc] }, e.x, e.y, t, artScale, undefined, alpha * shieldAlpha);
  }
  return true;
}

// 技能4：从圆弧2 半径向外的灰色弧（半径 r0→r1 线性插值，角度以「指向玩家」为中心，随时间渐隐）
function drawSkill4Fx(g, e, target, alpha) {
  const fx = e.skill4Fx;
  if (!fx || !(fx.dur > 0)) return;
  const k = clamp01(fx.t / fx.dur);
  const R = fx.r0 + (fx.r1 - fx.r0) * k;
  const aim = target ? Math.atan2(target.y - e.y, target.x - e.x) : -Math.PI / 2;
  const spanRad = ((e.bossCfg?.arcSpanDeg ?? BOSS25T5_DESIGN.arcSpanDeg) * DEG) * 0.85;
  g.lineStyle(6, hexToInt(SKILL4_COLOR), clamp01(alpha) * (1 - k));
  g.beginPath();
  g.arc(e.x, e.y, Math.max(0.1, R), aim - spanRad / 2, aim + spanRad / 2, false);
  g.strokePath();
}

// ── 技能区域 ──
/**
 * 绘制 BOSS 技能区域（含黑色遮罩）。必须在「玩家之下、其余世界元素之上」调用
 * ——调用点见 systems/ui/world-render.js 的 draw()，紧贴 drawPlayer 之前。
 */
export function drawBoss25T5Zones(g, e, t = 0) {
  if (!e || !Array.isArray(e.zones) || !e.zones.length) return;
  const cfg = e.bossCfg || {};
  for (const z of e.zones) {
    if (z) drawZone(g, z, cfg, t);
  }
}

// ── 技能5：蓝色漩涡 ──
// 模块级淡出记录 { id, x, y, r, stamp, fadeBorn }：本帧消失的漩涡在下一帧起画 250ms 扩散渐隐环。
// 用「帧号 + 双状态」原地更新，避免每帧 new 对象/新建数组（GC 友好）。
const _vortexPrev = [];
let _vortexFrame = 0;
// 复用的「本帧有效漩涡」列表（渲染循环内不 new）
const _vortexCur = [];

// 漩涡字段容错：空对象 / 缺字段 / NaN / r <= 0 一律视为无效（绝不画 NaN）
function isValidVortex(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.r) && v.r > 0;
}

// 登记本帧存在的漩涡，并把「上一帧有、本帧无」的记录标记为进入淡出（被击杀 → 已从数组移除）
function syncVortexFadeState(cur, t) {
  _vortexFrame++;
  for (let i = 0; i < cur.length; i++) {
    const v = cur[i];
    const id = v.id ?? `#${i}`;
    let rec = null;
    for (let j = 0; j < _vortexPrev.length; j++) {
      if (_vortexPrev[j].id === id) { rec = _vortexPrev[j]; break; }
    }
    if (!rec) {
      if (_vortexPrev.length >= VORTEX_FADE_MAX) _vortexPrev.shift();
      rec = { id, x: v.x, y: v.y, r: v.r, stamp: 0, fadeBorn: -1 };
      _vortexPrev.push(rec);
    }
    rec.x = v.x; rec.y = v.y; rec.r = v.r;
    rec.stamp = _vortexFrame; rec.fadeBorn = -1;
  }
  for (let i = 0; i < _vortexPrev.length; i++) {
    const rec = _vortexPrev[i];
    if (rec.fadeBorn < 0 && rec.stamp !== _vortexFrame) rec.fadeBorn = t;
  }
}

// 画淡出环（在当前漩涡弧之下）；过期的记录原地移除
function drawVortexFades(g, t) {
  for (let i = _vortexPrev.length - 1; i >= 0; i--) {
    const rec = _vortexPrev[i];
    if (rec.fadeBorn < 0) continue;
    const age = t - rec.fadeBorn;
    if (!(age >= 0) || age >= VORTEX_FADE_S) { _vortexPrev.splice(i, 1); continue; }
    const k = age / VORTEX_FADE_S;
    g.lineStyle(2, VORTEX_COLOR_A, (1 - k) * 0.6);
    g.beginPath();
    g.arc(rec.x, rec.y, Math.max(0.1, rec.r * (1 + 0.12 * k)), 0, Math.PI * 2, false);
    g.strokePath();
  }
}

/**
 * 绘制技能5 蓝色漩涡（场景级数组 scene.boss25t5Vortices）。
 * 相位只用漩涡自身的 v.t（存活毫秒），保证不同漩涡相位互不窜动；
 * 传入的 t（秒）仅用于「击杀消散」淡出环计时。
 * 必须在 drawBoss25T5Zones 之前调用（紫色领域黑遮罩须盖住漩涡）。
 *
 * @param {*} g Phaser.GameObjects.Graphics（或 makeG 的 Canvas2D 适配器）
 * @param {Array<{id:*,x:number,y:number,r:number,hp:number,maxHp:number,t:number}>} vortices 场景级漩涡数组
 * @param {number} t 场景时间（秒）
 */
export function drawBoss25T5Vortices(g, vortices, t = 0) {
  if (!g) return;
  const tt = Number.isFinite(t) ? t : 0;
  _vortexCur.length = 0;
  if (Array.isArray(vortices)) {
    for (let i = 0; i < vortices.length; i++) {
      if (isValidVortex(vortices[i])) _vortexCur.push(vortices[i]);
    }
  }
  syncVortexFadeState(_vortexCur, tt);
  drawVortexFades(g, tt);
  for (let i = 0; i < _vortexCur.length; i++) drawVortex(g, _vortexCur[i]);
}

function drawVortex(g, v) {
  const r = v.r;
  const maxR = r * VORTEX_MAX_R_RATIO;
  const vt = Math.max(0, Number.isFinite(v.t) ? v.t : 0);
  const spinScale = Math.max(0.3, r / VORTEX_REF_R);   // 旋转量按半径等比缩放

  // ── 1) 6 槽位蓝色圆弧：边转边向圆心收缩；life 回绕 = 在最大半径处「重生」 ──
  for (let i = 0; i < VORTEX_SLOTS; i++) {
    const life = ((vt / ARC_LIFE_MS) + i / VORTEX_SLOTS) % 1;
    const R = maxR * (1 - life);
    const a = life <= VORTEX_FADE_FROM ? 1 : (1 - life) / (1 - VORTEX_FADE_FROM);
    if (R < 0.6 || a <= 0.01) continue;
    const ang = i * (Math.PI * 2 / VORTEX_SLOTS) + life * VORTEX_SPIN[i] * spinScale;
    const span = VORTEX_SPAN_DEG[i] * DEG;
    g.lineStyle(
      VORTEX_LW_MAX - (VORTEX_LW_MAX - VORTEX_LW_MIN) * life,
      i % 2 ? VORTEX_COLOR_B : VORTEX_COLOR_A,
      a
    );
    g.beginPath();
    g.arc(v.x, v.y, R, ang - span / 2, ang + span / 2, false);
    g.strokePath();
  }

  // ── 2) 中心星环：白色短刻度内指（设计稿 pattern:'hands'），一次 stroke 画完 60 根 ──
  const ringR = r * VORTEX_RING_R_RATIO;
  if (ringR > 1) {
    const tick = Math.min(VORTEX_TICK_LEN, ringR * 0.6);
    const step = (Math.PI * 2) / VORTEX_TICK_COUNT;
    const rot = (vt / 1000) * VORTEX_RING_SPIN;
    g.lineStyle(1.5, VORTEX_TICK_COLOR, 0.85);
    g.beginPath();
    for (let i = 0; i < VORTEX_TICK_COUNT; i++) {
      const a = rot + i * step;
      const ca = Math.cos(a), sa = Math.sin(a);
      g.moveTo(v.x + ca * ringR, v.y + sa * ringR);
      g.lineTo(v.x + ca * (ringR - tick), v.y + sa * (ringR - tick));
    }
    g.strokePath();
  }

  // ── 3) 生命值：hp < maxHp 时在漩涡上方（y - r - 24）画细血条 ──
  const hp = v.hp, maxHp = v.maxHp;
  if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || !(maxHp > 0) || hp >= maxHp) return;
  const pct = clamp01(hp / maxHp);
  const bw = Math.min(VORTEX_BAR_MAX_W, Math.max(VORTEX_BAR_MIN_W, r));
  const bx = v.x - bw / 2;
  const by = v.y - r - VORTEX_BAR_GAP;
  fillBarPath(g, bx - 1, by - 1, bw + 2, VORTEX_BAR_H + 2, 0x000000, 0.45);
  fillBarPath(g, bx, by, bw, VORTEX_BAR_H, 0xffffff, 0.3);
  if (pct > 0) fillBarPath(g, bx, by, bw * pct, VORTEX_BAR_H, VORTEX_BAR_COLOR, 0.95);
}

// 矩形填充：用 moveTo/lineTo 多边形实现（makeG 的 Canvas2D 适配器没有 fillRect）
function fillBarPath(g, x, y, w, h, colorInt, alpha) {
  if (!(w > 0) || !(h > 0) || !(alpha > 0.001)) return;
  g.fillStyle(colorInt, alpha);
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h);
  g.lineTo(x, y + h);
  g.closePath();
  g.fillPath();
}

function drawZone(g, z, cfg, t) {
  // 容错：几何字段缺失 / 非法（编辑器或旧存档可能没有 zone）直接跳过，避免画 NaN
  if (!Number.isFinite(z.x) || !Number.isFinite(z.y)
    || !Number.isFinite(z.a0) || !Number.isFinite(z.a1)
    || !(z.rMin >= 0) || !(z.rMax >= z.rMin)) return;
  const alpha = clamp01(z.alpha ?? 1);
  const purpleAlpha = clamp01(z.purpleAlpha ?? alpha);
  if (alpha <= 0.01 && purpleAlpha <= 0.01) return;
  const span = spanOf(z.a0, z.a1);
  const lineColor = KIND_LINE[z.kind] || KIND_LINE.s2;
  const arcColor = KIND_ARC[z.kind] || KIND_ARC.s2;
  // 可见径向范围：消散阶段方向性收缩（s1 从外向内 / s2·s3 从内向外），非整体淡出
  const visMin = Number.isFinite(z.visMin) ? Math.max(z.rMin, z.visMin) : z.rMin;
  const visMax = Number.isFinite(z.visMax) ? Math.min(z.rMax, Math.max(visMin, z.visMax)) : z.rMax;

  // ── 1) 扇形两侧延长线：extend 由 rMin 线性延长到 rMax；pause 及之后为满长 ──
  let outerR;
  if (z.phase === 'extend') {
    const k = clamp01((z.t ?? 0) / zoneExtendMs(cfg, z.kind));
    outerR = z.rMin + (z.rMax - z.rMin) * k;
  } else {
    outerR = z.rMax;
  }
  outerR = Math.min(outerR, visMax);          // 消散时外侧先消失
  if (outerR > visMin) {
    g.lineStyle(3, hexToInt(lineColor), alpha * 0.9);
    for (const a of [z.a0, z.a0 + span]) {
      g.lineBetween(
        z.x + Math.cos(a) * visMin, z.y + Math.sin(a) * visMin,
        z.x + Math.cos(a) * outerR, z.y + Math.sin(a) * outerR
      );
    }
  }
  // rMax 处很淡的外弧：延展到位后给出范围提示（消散收缩时随 visMax 一起退场）
  if ((z.phase !== 'extend' || outerR >= z.rMax - 0.5) && visMax >= z.rMax - 0.5) {
    g.lineStyle(1.5, hexToInt(lineColor), alpha * 0.25);
    g.beginPath();
    g.arc(z.x, z.y, z.rMax, z.a0, z.a0 + span, false);
    g.strokePath();
  }

  // ── 2) anim / keep / fade：推进圆弧（按可见范围裁剪，实现方向性消失）──
  // 三种技能统一为「多条同心圆弧」的绘制风格（间隔 = s1RingGap，超过 MAX_RINGS 圈时等比放大间隔）：
  //   s1：arcR 为最内圈，圆弧由 arcR 铺到 visMax（向内收紧 → 从外向内消失）
  //   s2/s3：arcR 为最外圈，圆弧由 visMin 铺到 arcR（向外扩张 → 从内向外消失）
  const rArc = Math.max(0.1, Number.isFinite(z.arcR) ? z.arcR : z.rMin);
  if (z.phase === 'anim' || z.phase === 'keep' || z.phase === 'fade') {
    const rFrom = z.kind === 's1' ? rArc : visMin;
    const rTo = z.kind === 's1' ? visMax : Math.min(rArc, visMax);
    const range = rTo - rFrom;
    const gap = Math.max(1, cfg.s1RingGap ?? 10, range / MAX_RINGS);
    for (let r = rFrom; r <= rTo + 0.001; r += gap) {
      if (r < visMin - 0.001) continue;
      if (z.kind === 's1') {
        g.lineStyle(2, hexToInt(arcColor), alpha);
        g.beginPath();
        g.arc(z.x, z.y, r, z.a0, z.a0 + span, false);
        g.strokePath();
      } else {
        // 技能2/3：落在紫色重叠区的弧段转紫
        strokeClassifiedArc(g, z, r, span, arcColor, alpha);
      }
    }
  }

  // ── 3) 紫色区域填充 + 紫色描边 ──
  const pulse = 0.85 + 0.15 * Math.sin((t || 0) * 4);   // 领域高亮的轻微呼吸
  const purpleRegion = (z.kind === 's3' || z.purplePolys === null);
  if (purpleRegion) {
    // s3 整区紫：扇环本身可按可见范围裁剪（与弧线同步方向性消失）
    if (visMax > visMin) {
      fillSector(g, z.x, z.y, z.a0, span, visMin, visMax, hexToInt(PURPLE), 0.25 * purpleAlpha * pulse);
      g.lineStyle(2, hexToInt(PURPLE), 0.9 * purpleAlpha);
      g.beginPath();
      g.arc(z.x, z.y, visMax, z.a0, z.a0 + span, false);
      g.strokePath();
    }
  } else if (Array.isArray(z.purplePolys)) {
    // 重叠多边形无法径向裁剪 → 用 purpleAlpha 淡出
    for (const poly of z.purplePolys) {
      if (!poly || poly.length < 3) continue;
      fillPolygon(g, poly, hexToInt(PURPLE), 0.25 * purpleAlpha * pulse);
      strokePolygon(g, poly, hexToInt(PURPLE), 0.9 * purpleAlpha);
    }
  }

  // ── 4) keep/fade：同一区域叠黑色遮罩（玩家之下、其余世界元素之上；图层由调用点保证）──
  if (z.phase === 'keep' || z.phase === 'fade') {
    const maskA = 0.55 * purpleAlpha;
    if (purpleRegion) {
      if (visMax > visMin) fillSector(g, z.x, z.y, z.a0, span, visMin, visMax, 0x000000, maskA);
    } else if (Array.isArray(z.purplePolys)) {
      for (const poly of z.purplePolys) {
        if (!poly || poly.length < 3) continue;
        fillPolygon(g, poly, 0x000000, maskA);
      }
    }
  }
}

// 圆弧按「是否落在紫色重叠区」分段上色：沿扇形 ~2° 采样，连续同色段合并描弧
function strokeClassifiedArc(g, z, r, span, baseColor, alpha) {
  const steps = Math.max(2, Math.round((span / DEG) / 2));   // ~2° 一步
  const cls = new Array(steps);
  for (let i = 0; i < steps; i++) {
    const mid = z.a0 + span * ((i + 0.5) / steps);
    cls[i] = classifyAt(z, mid, r) ? 1 : 0;
  }
  let i = 0;
  while (i < steps) {
    const v = cls[i];
    let j = i;
    while (j + 1 < steps && cls[j + 1] === v) j++;
    const aStart = z.a0 + span * (i / steps);
    const aEnd = z.a0 + span * ((j + 1) / steps);
    g.lineStyle(3, hexToInt(v ? PURPLE : baseColor), alpha);
    g.beginPath();
    g.arc(z.x, z.y, r, aStart, aEnd, false);
    g.strokePath();
    i = j + 1;
  }
}

// 采样点 (ang, r) 是否属于紫色区：s3 / purplePolys===null → 整区紫；数组 → 落在任一多边形内为紫
function classifyAt(z, ang, r) {
  if (z.kind === 's3' || z.purplePolys === null) return true;
  const polys = z.purplePolys;
  if (!Array.isArray(polys) || !polys.length) return false;
  const px = z.x + Math.cos(ang) * r;
  const py = z.y + Math.sin(ang) * r;
  return polys.some(poly => pointInPolygon(px, py, poly));
}

// 填充扇环多边形（顶点 zone 圆心，a0..a0+span，半径 r0..r1）
function fillSector(g, cx, cy, a0, span, r0, r1, colorInt, alpha) {
  if (!(alpha > 0.001)) return;
  const steps = Math.max(2, Math.ceil(span / (Math.PI / 36)));
  g.fillStyle(colorInt, alpha);
  g.beginPath();
  g.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
  for (let i = 1; i <= steps; i++) {
    const a = a0 + span * (i / steps);
    g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + span * (i / steps);
    g.lineTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
  }
  g.closePath();
  g.fillPath();
}

function fillPolygon(g, poly, colorInt, alpha) {
  if (!(alpha > 0.001)) return;
  g.fillStyle(colorInt, alpha);
  g.beginPath();
  g.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
  g.closePath();
  g.fillPath();
}

function strokePolygon(g, poly, colorInt, alpha) {
  g.lineStyle(2, colorInt, alpha);
  g.beginPath();
  g.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
  g.closePath();
  g.strokePath();
}
