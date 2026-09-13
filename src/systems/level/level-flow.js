/**
 * 关卡流程混入模块（分类：关卡设计）
 *
 * 职责：关卡进入与切换阶段的镜头与状态机推进——玩家出生后的相机边界修正、
 * 开场演出（黑幕渐显，不再做镜头拉近）的启动与逐帧推进、关卡切换与外部流程的淡出启动。
 *
 * 方法清单：
 *   applyPlayerBounds                  —— 以玩家为中心扩展相机边界
 *   startLevelIntro / updateLevelIntro —— 开场演出启动 / 每帧推进
 *   beginSwitch / beginExternalFade    —— 关卡切换淡出 / 外部流程淡出
 *
 * 通过 Object.assign(EditorScene.prototype, LevelFlowMixin) 混入，
 * 内部 this 恒为 EditorScene 实例，语义与原类内方法完全一致。
 */
import { CELL, SHIELD_MAX, PLAYER_COLLISION_RADIUS } from '../constants.js';
import { WEAPONS } from '../combat/weapons.js';
import { buildGrid } from '../../pathfinding.js';
import { HUD_IDLE_MS } from '../ui/hud.js';
import { normalizeWeapons } from '../../player-data.js';
import { generateRoomLayout } from '../../rooms.js';

// 本模块私有常量（重开 / 切换淡出 / 等级血量加成）
const PATH_INFLATE = 24;
const SWITCH_FADE_MS = 500;
const LEVEL_HP_BONUS = 10;
const ROOM_REVEAL_MS = 800;   // 未知房间进入后内容渐显时长

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
        // 战斗关开场只保留黑幕渐显（ui-runtime 按 levelIntro.t / duration 推进），镜头不再做「拉近」演出
        this.cameras.main.setZoom(this.playZoom());
        this.centerCameraOnPlayer();
      }
      this.levelIntro = { t: 0, duration };
      this.state = 'transition';
    },

    updateLevelIntro(dt) {
      if (!this.levelIntro) return false;
      const intro = this.levelIntro;
      intro.t += dt / 1000;
      const p = Math.min(1, intro.t / intro.duration);
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
      // 玩家被击败演出状态随重开清零；残留黑幕一并撤掉（避免上一局死亡演出遗黑）。
      this.playerDeathFlow = null;
      this.hideCinematicFade?.();
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
      this.hudIntro = null;         // 战斗 HUD 入场动画状态机（restart 后重置）
      this.hudIntroDone = false;
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
      this.runItems = [];                 // 局内消耗品（药水队列；仅当局，随关卡重开清零，不写存档）
      this.runTimedWeapons = [];          // 局内限时武器（仅当局）
      this.runEffects = [];               // 局内限时加成（生效中，仅当局）
      this.tempWeaponActive = false;      // 临时武器是否使用中（仅当局）
      this.tempWeaponSaved = null;        // 启用临时武器时保存的主武器态（仅当局）
      this.potionWheel = null;            // 药水选择轮盘状态（仅当局）
      this.potionKeyHold = null;          // 数字键 4 按住状态（仅当局）
      this.vendorActive = null;           // 当前打开的售货机实体
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
      // 未知房间运行时状态：进入前内容不可见，进入后 0.8s 渐显（一次性揭示）
      const roomLayout = l.roomLayout;
      this.unknownRooms = (roomLayout?.mode === 'multi')
        ? generateRoomLayout(roomLayout).rooms
            .filter(rm => rm.type === 'unknown')
            .map(rm => ({ c: rm.c, r: rm.r, x: rm.x, y: rm.y, w: rm.w, h: rm.h, revealed: false, revealT: 0 }))
        : [];
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
        weaponIntroAt: this.time?.now || 0,
        moveLeanX: 0,
        moveLeanY: 0,
        shieldActive: false,
        shieldAngle: 0,
        shieldTimer: 0,
        shield: maxShield,
        maxShield,
        shieldBroken: false,
        itemShields: [],            // 局内即时护盾（按顺序吸收伤害；仅当局，不写存档）
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
      if (!this.editing) this.preloadRunItemArt();   // 预取药水图标（fire-and-forget）
      this.hidePotionWheelTexts?.();                   // 重开时隐藏轮盘名称文本（独立 Phaser Text）
      if (!this.editing) this.setupPlayCamera();
      if (!this.editing && !this.isMenuLevel()) this.startLevelIntro();
      this.draw();
    },

    // 未知房间揭示推进：玩家进入房间即一次性揭示，revealT 在 0.8s 内升到 1
    updateRoomReveal(dt) {
      if (!this.unknownRooms?.length || !this.player) return;
      const p = this.player;
      for (const rm of this.unknownRooms) {
        if (rm.revealed) {
          if (rm.revealT < 1) rm.revealT = Math.min(1, rm.revealT + dt / ROOM_REVEAL_MS);
        } else if (p.x >= rm.x && p.x <= rm.x + rm.w && p.y >= rm.y && p.y <= rm.y + rm.h) {
          rm.revealed = true;
        }
      }
    },

    // (x,y) 处内容在未知房间揭示状态下的可见透明度：非未知房间/编辑态=1；未进入=0；揭示中=revealT
    roomRevealAlpha(x, y) {
      if (this.editing || !this.unknownRooms?.length) return 1;
      for (const rm of this.unknownRooms) {
        if (x >= rm.x && x <= rm.x + rm.w && y >= rm.y && y <= rm.y + rm.h) {
          return rm.revealed ? rm.revealT : 0;
        }
      }
      return 1;
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

    // 玩家被击败流程：先播死亡运镜（可选）→ 黑幕停留 → 再进结算页。
    // 幂等：多个失败入口（玩家受击 / BOSS 秒杀 / 母舰贴身）都会调用，重复调用直接返回。
    // 无死亡运镜（id 为空）/ 找不到 clip / 非 play|trial 模式（编辑器态、打包端异常态）→ 走 fallback 直接结算。
    triggerPlayerDefeat() {
      const ctx = this.ctx;
      if (this.editing) return;
      if (this.playerDeathFlow) return;   // 演出进行中，防重复进入
      const failStraight = () => { this.state = 'fail'; this.syncUIState(); };
      const mode = ctx?.state?.mode;
      if (mode !== 'play' && mode !== 'trial') { failStraight(); return; }
      const id = ctx?.state?.level?.deathCinematic;
      const clip = id ? (ctx.state.level.cinematics || []).find(c => c.id === id) : null;
      if (!clip) { failStraight(); return; }
      this.playerDeathFlow = { phase: 'cinematic' };
      // playCutscene 可能因 clip 无关键帧而同步调用 stopCutscene → 触发下方 onComplete，链路须能承受同步回调。
      this.playCutscene(clip, {
        focusTarget: (clip.focus && clip.focus !== 'none') ? clip.focus : 'player',
        holdBlack: true,
        onComplete: () => {
          this.playerDeathFlow = { phase: 'hold' };
          this.time.delayedCall(Math.max(0, clip.blackHoldMs ?? 500), () => {
            this.playerDeathFlow = null;
            this.state = 'fail';
            this.syncUIState();
            this.draw();               // 先把结算页画出来（此时黑幕仍盖着，不会闪帧）
            this.hideCinematicFade?.(); // 画完再撤黑幕
          });
        },
      });
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
