/**
 * 打包端启动路径。
 * 职责：UI 配置预载 loadPackagedUi（编辑器端亦复用）、打包端登录主页进入 enterPackagedLogin、
 *       打包端初始化 initializePackaged。
 * 分类：引擎编辑器需求
 * 导出：loadPackagedUi, enterPackagedLogin, initializePackaged
 */
import { getUi, listPlayers, getIdolBuffs } from '../api.js';
import { setStatus } from '../ui.js';
import { normalizePlayer } from '../player-data.js';
import { setIdolBuffs } from '../systems/economy/buffs.js';
import { ctx } from './context.js';
import { refreshLevels, selectLevel, setMode } from './level-flow.js';

const { state } = ctx;

// ── UI 配置预载 ──
export async function loadPackagedUi() {
  try {
    state.ui = { battle: await getUi('battle'), interface: await getUi('interface'), login: await getUi('login'), weapon: await getUi('weapon'), workshop: await getUi('workshop') };
  } catch {
    state.ui = { battle: null, interface: null, login: null, weapon: null, workshop: null };
  }
}

// ── 打包端登录主页 ──
// 打包端：正式存档进入登录主页（login 关卡），后续新游戏/继续游戏走正式流程
export async function enterPackagedLogin() {
  state.saveStore = 'formal';
  const target = state.levels.includes('login')
    ? 'login'
    : (state.levels.find(id => id !== 'login') || state.levels[0]);
  if (!target) throw new Error('暂无关卡');
  await selectLevel(target, false, false);
  setMode('trial');
}

// ── 打包端初始化 ──
export async function initializePackaged() {
  state.templates = null;
  state.player = normalizePlayer();
  state.playerId = 'save-1';
  state.saveStore = 'formal';
  await loadPackagedUi();
  try { const cfg = await getIdolBuffs(); if (cfg) setIdolBuffs(cfg); } catch {}
  try {
    const { metas } = await listPlayers();
    state.hasAnySave = Object.keys(metas || {}).length > 0;
  } catch {
    state.hasAnySave = false;
  }
  if (!await refreshLevels()) return;
  await enterPackagedLogin();
  state.ready = true;
  setStatus(ctx.dom, '初始化完成');
}
