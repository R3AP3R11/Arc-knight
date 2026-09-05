/**
 * 存档源与开局流程。
 * 职责：正式/测试存档源切换（isTrialSaveStore/listStoreSaves/saveStorePlayer/loadStorePlayer）、
 *       新游戏开局 startNewGame、存档栏位进入 selectSave、编辑器试玩启动 startTrial。
 * 分类：系统玩法
 * 导出：isTrialSaveStore, listStoreSaves, saveStorePlayer, loadStorePlayer, startNewGame, selectSave, startTrial
 */
import { clone, normalizeLevel } from '../state.js';
import { loadLevel, saveDraft, loadPlayer, savePlayer, listPlayers, loadTestPlayer, saveTestPlayer, listTestPlayers } from '../api.js';
import { setStatus } from '../ui.js';
import { normalizePlayer } from '../player-data.js';
import { ctx } from './context.js';
import { fadeAndSwitch, selectLevel, setMode, sync, restoreEditorSnapshot } from './level-flow.js';

const { state } = ctx;

// ── 存档存储源 ──
// 试玩模式（mode==='trial'）走测试存档 API，其余走正式存档 API
export function isTrialSaveStore() {
  return state.saveStore === 'test';
}
export function listStoreSaves() {
  return isTrialSaveStore() ? listTestPlayers() : listPlayers();
}
export function saveStorePlayer(id, player) {
  return isTrialSaveStore() ? saveTestPlayer(id, player) : savePlayer(id, player);
}
export function loadStorePlayer(id) {
  return isTrialSaveStore() ? loadTestPlayer(id) : loadPlayer(id);
}

// ── 新游戏 ──
export function startNewGame() {
  // 新游戏：重置玩家存档，固定进入新手教学关卡；试玩走测试存档，正式走正式存档
  state.player = normalizePlayer();
  saveStorePlayer(state.playerId, state.player).catch(() => {});
  state.hasAnySave = true;
  const target = state.levels.includes('newbee')
    ? 'newbee'
    : state.levels.find(id => id !== 'login') || state.levels[0];
  if (target) fadeAndSwitch(async () => {
    const value = await loadLevel(target);
    state.level = normalizeLevel(value);
    state.levelId = target;
    state.selected = null;
    // 实机游戏模式统一用 trial（saveStore 决定读写测试/正式存档）；play 仅用于"游戏预览"临时数据
    setMode('trial');
    sync();
  });
}

// ── 存档栏位进入 ──
// 选择存档栏位：读取该存档并进入骑士之家家园关卡；试玩走测试存档，正式走原存档
export async function selectSave(id) {
  try {
    const trial = isTrialSaveStore();
    const player = normalizePlayer(await loadStorePlayer(id));
    state.player = player;
    state.playerId = id;
    state.hasAnySave = true;
    state.trialPlayer = clone(player);
    const target = state.levels.includes('knight-home')
      ? 'knight-home'
      : (player.levels?.current && state.levels.includes(player.levels.current)
        ? player.levels.current
        : (state.levels.find(x => x !== 'login') || state.levels[0]));
    fadeAndSwitch(() => selectLevel(target, false, false).then(() => setMode('trial')));
  } catch (error) {
    setStatus(ctx.dom, `读取存档失败：${error.message}`, true);
  }
}

// ── 编辑器试玩 ──
// 试玩：进入登录主页（login 关卡），后续“开始游戏/继续游戏/存档选择”与正式流程一致，
// 但所有玩家存档读写均走测试存档 API（data/test-players/），与正式存档完全隔离。
export async function startTrial() {
  try {
    await saveDraft(state.levelId, state.level);
    ctx.editorSnapshot = { level: clone(state.level), levelId: state.levelId };
    ctx.editorPlayerSnapshot = { player: clone(state.player), playerId: state.playerId, hasAnySave: state.hasAnySave };
    state.saveStore = 'test';
    // 试玩登录主页与后续游戏只使用测试存档数据，先放一个空测试玩家，避免携带编辑器里的正式玩家数据；
    // 但保留编辑器里绑定的「画板美术方案」（纯外观，不含等级/金币等正式数据），使试玩也能看到所绑外观
    state.player = normalizePlayer();
    const prev = ctx.editorPlayerSnapshot?.player || {};
    state.player.arts = { ...(prev.arts || {}) };
    state.player.art = prev.art || '';
    state.player.artScale = Number(prev.artScale) || 1;
    state.playerId = 'save-1';
    // 登录主页的“继续游戏”按钮依赖是否存在测试存档，此处只读测试存档索引，不碰正式存档
    try {
      const { metas } = await listTestPlayers();
      state.hasAnySave = Object.keys(metas || {}).length > 0;
    } catch {
      state.hasAnySave = false;
    }
    const target = state.levels.includes('login')
      ? 'login'
      : (state.levels.find(id => id !== 'login') || state.levels[0]);
    if (!target) throw new Error('暂无关卡');
    fadeAndSwitch(() => selectLevel(target, false, false).then(() => setMode('trial')));
  } catch (error) {
    restoreEditorSnapshot();
    setStatus(ctx.dom, `试玩启动失败：${error.message}`, true);
  }
}
