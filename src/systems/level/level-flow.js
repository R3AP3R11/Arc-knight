/**
 * 关卡流程混入模块（分类：关卡设计）
 *
 * 职责：关卡进入与切换阶段的镜头与状态机推进——玩家出生后的相机边界修正、
 * 开场演出（战斗关拉近镜头 / 普通关短过场）的启动与逐帧推进、关卡切换与外部流程的淡出启动。
 *
 * 方法清单：
 *   applyPlayerBounds                  —— 以玩家为中心扩展相机边界
 *   startLevelIntro / updateLevelIntro —— 开场演出启动 / 每帧推进
 *   beginSwitch / beginExternalFade    —— 关卡切换淡出 / 外部流程淡出
 *
 * 通过 Object.assign(EditorScene.prototype, LevelFlowMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import { CELL, SHIELD_MAX, PLAYER_COLLISION_RADIUS, PLAYER_ART } from '../constants.js';
import { WEAPONS } from '../combat/weapons.js';
import { buildGrid } from '../../pathfinding.js';
import { HUD_IDLE_MS } from '../ui/hud.js';
import { normalizeWeapons } from '../../player-data.js';

// 本模块私有常量（重开 / 切换淡出 / 等级血量加成）
const PATH_INFLATE = 24;
const SWITCH_FADE_MS = 500;
const LEVEL_HP_BONUS = 10;

export const LevelFlowMixin = {
  // ── 出生边界与开场演出 ──
    // 保证玩家创建后边界以玩家为中心（padding 足够覆盖任意出生点）
    applyPlayerBounds() {      const { w, h } = this.worldSize();
      const x = this.player ? this.player.x : w / 2;
      const y = this.player ? this.player.y : h / 2;
      const pad = 2000;
      this.cameras.main.setBounds(Math.min(0, x - pad), Math.min(0, y - pad), w + pad * 2, h + pad * 2);
    },

    startLevelIntro() {
      const battle = this.isBattleLevel();
      const duration = battle ? 3.5 : 1.2;
      if (battle) {
        const targetZoom = this.playZoom();
        const startZoom = 1920 / 340;   // 初始视野约 340
        this.levelIntro = { t: 0, duration, battle: true, startZoom, targetZoom };
        this.cameras.main.setZoom(startZoom);
        this.centerCameraOnPlayer();
      } else {
        this.levelIntro = { t: 0, duration, battle: false };
      }
      this.state = 'transition';
    },

    updateLevelIntro(dt) {
      if (!this.levelIntro) return false;
      const intro = this.levelIntro;
      intro.t += dt / 1000;
      const p = Math.min(1, intro.t / intro.duration);
      if (intro.battle) {
        const eased = Math.pow(p, 2.4);   // 先慢后快
        const zoom = intro.startZoom + (intro.targetZoom - intro.startZoom) * eased;
        this.cameras.main.setZoom(zoom);
        this.cameras.main.scrollX = this.player.x - this.cameras.main.width / 2;
        this.cameras.main.scrollY = this.player.y - this.cameras.main.height / 2;
      }
      if (p >= 1) {
        this.levelIntro = null;
        this.state = 'playing';
      }
      return true;
    },

  // ── 关卡切换淡出 ──
    beginSwitch(ev) {
      this.transition = {
        phase: 'out',
        alpha: 0,
        target: ev.target,
        spawnPoint: ev.spawnPoint,
        switching: false
      };
      this.state = 'transition';
    },

    beginExternalFade(done) {
      this.transition = { phase: 'out', alpha: 0, switching: true, external: true };
      this.state = 'transition';
      this.transitionDone = done;
    },

  // ── 回填：重开 / 结算 / 胜利 / 淡出推进 ──
    restart() {
    const ctx = this.ctx;
      this.state = 'playing';
      this.kills = 0;
      this.killTally = {};
      this.runGoldGained = 0;
      this.runExpGained = 0;
      this.settleStart = undefined;
      this.bullets = [];
      this.lasers = [];
      this.orbitHit = new Map();
      if (this.player) this.player.orbit = null;
      this.enemyBullets = [];
      this.drops = [];
      this.hitEffects = [];
      this.fireClock = 0;
      this.triggered = new Set();
      this.triggerState = new Map();
      this.spawnEffects = [];
      this.lockEffects = [];
      this.transition = null;
      this.intro = null;
      this.pageFade = null;
      this.wheelAnim = null;
      this.hudMode = 'explore';
      this.hudAnim = null;
      this.hudIdleClock = HUD_IDLE_MS;
      this.hudIdleStep = null;
      if (this.waveEvents) {
        this.waveEvents.forEach(ev => ev.remove(false));
      }
      this.waveEvents = [];
      this.initNewbee();
      this.initHub();

      const l = ctx.state.level;
      this.crates = (l.crates || []).map(c => ({ ...c, alive: true }));
      this.barrels = (l.barrels || []).map(b => ({ ...b, alive: true }));
      this.chests = (l.chests || []).map(c => ({
        ...c,
        spawned: c.trigger === 'start',
        opened: false,
        fx: null
      }));
      this.portals = (l.portals || []).map(p => ({
        ...p,
        spawned: p.trigger === 'start',
        used: false
      }));
      this.portalNearest = null;
      this.portalTipT = 0;
      this.vendors = (l.vendors || []).map(v => ({ ...v }));
      this.vendorNearest = null;
      this.vendorTipT = 0;
      this.vendorBought = new Set();
      this.idols = (l.idols || []).map(v => ({ ...v, used: false }));
      this.idolNearest = null;
      this.idolTipT = 0;
      this.idolOffer = null;
      this.icons = (l.icons || []).map(v => ({ ...v }));
      this.iconNearest = null;
      this.iconTipT = 0;
      // 指引箭头状态按实体对象键控，重开须清（旧实体引用不再存在）
      this.guideAlphas = new Map();
      this.guideMarkers = null;
      for (const t of (this.guideTexts || new Map()).values()) t.destroy();
      this.guideTexts = new Map();
      this.gates = (l.gates || []).map(gt => ({ ...gt, spawnT: gt.active ? 1 : 0 }));
      this.crateDebris = [];
      this.barrelExplosions = [];

      const obstacles = [
        ...l.walls,
        ...(l.crates || []),
        ...(l.barrels || []).map(b => ({ x: b.x, y: b.y, w: b.r * 2, h: b.r * 2 }))
      ];
      this.grid = buildGrid({ width: l.world.width, height: l.world.height }, obstacles, CELL, PATH_INFLATE);
      // 数据源：游戏预览用临时数据，试玩/正式游戏用真实存档（试玩为测试存档）
      const source = this.isPreviewMode() ? ctx.state.previewPlayer : ctx.state.player;
      // 局内武器：关卡 spawn 配置 + 存档已解锁武器（购买武器后可在战斗中使用）
      const saveUnlocked = !this.editing
        ? Object.entries(source?.weapons || {}).filter(([, v]) => v?.unlocked).map(([k]) => k)
        : [];
      const fallbackWeapons = normalizeWeapons([...new Set([...(l.spawn.weapons || []), ...saveUnlocked])]);
      const loadoutUnlocked = (Array.isArray(source?.loadout) ? source.loadout : [])
        .filter(w => w && source?.weapons?.[w]?.unlocked);
      // 编辑器「游戏预览」：全部已解锁武器便于测试；正式/试玩：严格按出战槽 loadout，空则回退 radial
      const weapons = (!this.editing && ctx.state.mode === 'play')
        ? fallbackWeapons
        : normalizeWeapons(loadoutUnlocked);
      const weaponType = weapons[0];
      const weapon = WEAPONS[weaponType] || WEAPONS.radial;
      const scheme = weapon.scheme;
      const level = l.spawn.level ?? 1;
      const levels = source?.levels;
      // 进入新手关卡即标记已参与过 newbee
      if (!this.editing && ctx.state.levelId === 'newbee' && source) {
        source.playedNewbee = true;
      }
      // 存档关卡未解锁时，正式游戏回退到已解锁关卡
      // 章-节关卡（Level{N}-Scene{M}）由选关 UI 按 completed 控制解锁（screens.js:176），
      // 与旧的 levels.unlocked（扁平 level-N）无关，绝不能在此被改写，否则结算页解析不出章节导致进度球不亮
      const isSceneId = /^Level\d+-Scene\d+$/.test(ctx.state.levelId);
      if (!this.editing && levels && !isSceneId && !levels.unlocked.includes(ctx.state.levelId)) {
        ctx.state.levelId = levels.current || levels.unlocked[0] || 'level-1';
      }
      const combat = (this.editing ? null : (source?.combat || null)) || {};
      const savedProgress = (this.editing ? null : source?.progress) || {};
      const savedCurrency = (this.editing ? null : source?.currency) || {};
      const maxHp = this.editing
        ? (l.spawn.maxHp ?? 100) + (level - 1) * LEVEL_HP_BONUS
        : (combat.maxHp ?? 100);
      const maxShield = this.editing ? SHIELD_MAX : (combat.maxShield ?? SHIELD_MAX);
      const greenSlot = source?.equipment?.weaponMods?.green;
      const greenDed = Array.isArray(greenSlot?.dedicated) ? greenSlot.dedicated : (greenSlot?.dedicated ? [greenSlot.dedicated] : []);
      const hasCapacity = greenDed.includes('capacity')
        || (Array.isArray(greenSlot?.generic) && greenSlot.generic.includes('capacity'));
      const ammo = {};
      for (const w of weapons) {
        let max = WEAPONS[w]?.maxAmmo ?? Infinity;
        // 容量改件：绿色武器弹量翻倍
        if (hasCapacity && w === 'green' && max !== Infinity) max *= 2;
        ammo[w] = max;
      }

      const weaponCharge = {};
      for (const w of weapons) {
        const need = WEAPONS[w]?.chargeRequired;
        if (need) weaponCharge[w] = { need, have: 0 };
      }

      this.player = {
        ...l.spawn,
        r: PLAYER_COLLISION_RADIUS,
        scheme,
        art: source?.art || l.spawn?.art || '',
        artScale: Number(source?.artScale) || Number(l.spawn?.artScale) || 1,
        arts: { ...(l.spawn?.arts || {}), ...(source?.arts || {}) },
        weapon,
        weaponArt: (weapon && weapon.appearance && Array.isArray(weapon.appearance.elements) && weapon.appearance.elements.length) ? weapon.appearance : null,
        weaponType,
        weapons,
        weaponIndex: 0,
        ammo,
        weaponCharge,
        hp: maxHp,
        maxHp,
        level: savedProgress.level ?? l.spawn.level ?? 1,
        exp: savedProgress.exp ?? 0,
        expToNext: savedProgress.expToNext ?? 100,
        gold: savedCurrency.gold ?? 0,
        gems: savedCurrency.gems ?? 0,
        weaponLevel: l.spawn.weaponLevel || 1,
        weaponAngle: 0,
        weaponDirection: 1,
        previousFireDown: false,
        firing: false,
        moveHexRadius: PLAYER_ART.hexagonRadius,
        moveLeanX: 0,
        moveLeanY: 0,
        shieldActive: false,
        shieldAngle: 0,
        shieldTimer: 0,
        shield: maxShield,
        maxShield,
        shieldBroken: false,
        hitFlash: null,
        combat,
        points: source?.points || {},
        loadout: Array.isArray(source?.loadout) ? [...source.loadout] : ['radial'],
        equipment: source?.equipment || {
          weaponMods: {
            radial: { generic: [], dedicated: [] },
            yellow: { generic: [], dedicated: [] },
            green: { generic: [], dedicated: [] }
          },
          relics: [],
          pets: []
        },
        items: source?.items || { stacks: {}, uniques: [] },
        spendablePoints: savedProgress.points ?? 0
      };

      this.enemies = (l.enemies || []).map(e => this.initEnemy(e));
      if (!this.editing) this.applyPlayerBounds();
      if (!this.editing) {
        this.buildUITexts();
        this.syncUIState();
      }
      if (!this.editing) this.setupPlayCamera();
      if (!this.editing && !this.isMenuLevel()) this.startLevelIntro();
      this.draw();
    },

    commitPlayer() {
    const ctx = this.ctx;
      if (this.editing) return;
      const p = this.isPreviewMode() ? ctx.state.previewPlayer : ctx.state.player;
      if (!p) return;
      p.progress.level = this.player.level ?? p.progress.level;
      p.progress.exp = this.player.exp ?? p.progress.exp;
      p.progress.expToNext = this.player.expToNext ?? p.progress.expToNext;
      this.persistSave(p);
    },

    settleVictory() {
    const ctx = this.ctx;
      if (this.editing) return;
      const p = this.isPreviewMode() ? ctx.state.previewPlayer : ctx.state.player;
      if (!p) return;
      if (this.player) {
        p.currency.gold = this.player.gold ?? p.currency.gold;
        p.currency.gems = this.player.gems ?? p.currency.gems;
      }
      const levelId = ctx.state.levelId;
      if (levelId && levelId !== 'newbee' && levelId !== 'login' && levelId !== 'knight-home' && !p.levels.completed.includes(levelId)) {
        p.levels.completed.push(levelId);
      }
      if (levelId) p.levels.current = levelId;
      this.persistSave(p);
    },

    updateTransition(dt) {
    const ctx = this.ctx;
      const tr = this.transition;
      if (!tr) return;
      if (tr.phase === 'out') {
        tr.alpha = Math.min(1, tr.alpha + dt / SWITCH_FADE_MS);
        if (tr.alpha >= 1 && tr.switching) {
          if (tr.external) {
            const done = this.transitionDone;
            this.transition = null;
            done?.();
          } else {
            tr.switching = true;
            ctx.onSwitchLevel?.(tr.target, tr.spawnPoint, () => {
              this.restart();
              tr.phase = 'in';
              tr.alpha = 1;
              this.transition = tr;
              this.state = 'transition';
            });
          }
        }
      } else if (tr.phase === 'in') {
        tr.alpha = Math.max(0, tr.alpha - dt / SWITCH_FADE_MS);
        if (tr.alpha <= 0) {
          this.transition = null;
          this.state = 'playing';
        }
      }
    },
};
