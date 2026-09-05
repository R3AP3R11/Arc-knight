import './style.css';
import { get, loadPlayer, listPlayers, getIdolBuffs } from './api.js';
import { getDom, setStatus } from './ui.js';
import { normalizePlayer } from './player-data.js';
import { ctx } from './editor/context.js';
import { redraw, sync, startGame, selectLevel, refreshLevels } from './editor/level-flow.js';
import { renderTriggerEvents } from './editor/trigger-panel.js';
import { startNewGame, selectSave, listStoreSaves, saveStorePlayer } from './editor/save-flow.js';
import { loadPackagedUi, initializePackaged } from './editor/packaged.js';
import { bind } from './editor/bindings.js';
import { loadWeaponDefs, registerBuiltinWeapons } from './systems/art/weapon-store.js';
import { loadPetDefs, registerBuiltinPets } from './systems/art/pet-store.js';
import { refreshArtChoices } from './systems/art/design-store.js';
import { setIdolBuffs } from './systems/economy/buffs.js';

const { state, PACKAGED } = ctx;

// 先注册内置设计稿武器（yellow/green），使运行时武器目录在首次 normalizePlayer 前就包含它们。
// 必须在任何 normalizePlayer() 调用之前执行（含下方 state.player/previewPlayer/trialPlayer 的初始化）。
registerBuiltinWeapons();
registerBuiltinPets();

// ── 初始玩家/存档状态 ──
state.player = normalizePlayer();
state.playerId = 'save-1';
state.hasAnySave = false;
// 存档存储源：formal=正式 data/players，test=试玩 data/test-players
state.saveStore = 'formal';
// 预览临时玩家数据：仅在"游戏预览"模式生效；给初始升级点数便于体验加点。
// 改件库存不再硬编码 mock，改由编辑器「预览玩家数据」面板按玩家数据配置（见 player-panels.js）。
state.previewPlayer = normalizePlayer();
state.previewPlayer.progress.points = 5;
// 试玩临时玩家数据：读真实存档但不写回，避免试玩改变玩家存档
state.trialPlayer = normalizePlayer();

// ── 钩子注册：解开各编辑器模块之间的循环依赖 ──
ctx.hooks.sync = sync;
ctx.hooks.redraw = redraw;
ctx.hooks.renderTriggerEvents = renderTriggerEvents;
ctx.hooks.startNewGame = startNewGame;
ctx.hooks.selectSave = selectSave;
ctx.hooks.listStoreSaves = listStoreSaves;
ctx.hooks.saveStorePlayer = saveStorePlayer;

// ── 初始化入口 ──
async function initialize() {
  try {
    ctx.dom = getDom();
    // 先加载已设计武器，使运行时武器目录（weaponCatalog）包含它们，
    // 这样玩家存档/预览面板中引用设计武器的 loadout/mods 才能被归一化识别。
    try { await loadWeaponDefs(); } catch {}
    // 加载宠物定义（data/pets/*.json），使 shop 宠物卡 / 玩家面板 / 运行时能读到最新数值
    try { await loadPetDefs(); } catch {}
    // 加载神像祝福配置（数量 + 各条的加成/图标），注入 buffs 池
    try { const cfg = await getIdolBuffs(); if (cfg) setIdolBuffs(cfg); } catch {}
    // 填充画板美术方案缓存（敌人美术下拉用）
    try { await refreshArtChoices(); } catch {}
    bind();
    if (PACKAGED) {
      await initializePackaged();
      return;
    }
    ctx.dom.editorPanel.hidden = false;
    ctx.dom.editorPanel.style.display = '';
    state.templates = await get('/templates');
    try {
      ctx.iconChoices = (await get('/icons')).icons || [];
    } catch {
      ctx.iconChoices = [];
    }
    await loadPackagedUi();
    try {
      state.player = normalizePlayer(await loadPlayer(state.playerId));
    } catch {
      state.player = normalizePlayer();
    }
    try {
      const { metas } = await listPlayers();
      state.hasAnySave = Object.keys(metas || {}).length > 0;
    } catch {
      state.hasAnySave = false;
    }
    if (!await refreshLevels()) return;
    // 打开编辑器固定加载空关卡 level-1，不恢复上次编辑的关卡，避免自动加载真实关卡导致误覆盖
    const defaultId = state.levels.includes('level-1') ? 'level-1' : state.levels[0];
    await selectLevel(defaultId, false, false);
    startGame();
    state.ready = true;
    setStatus(ctx.dom, '初始化完成');
  } catch (error) {
    if (ctx.dom) setStatus(ctx.dom, `初始化失败：${error.message}`, true);
    else document.body.textContent = `初始化失败：${error.message}`;
  }
}

initialize();
