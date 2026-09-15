/**
 * 关卡流程与视图同步。
 * 职责：关卡记忆（rememberLevel/recallLevel）、面板同步 sync、重绘落盘 redraw、关卡列表 renderFlows、
 *       Phaser 游戏启动 startGame、黑屏淡入淡出切换 fadeAndSwitch、模式切换 setMode、
 *       编辑器快照恢复 restoreEditorSnapshot、关卡选择/刷新/游戏内切关。
 * 分类：关卡设计
 * 导出：LAST_LEVEL_KEY, rememberLevel, recallLevel, sync, redraw, renderFlows, startGame,
 *       fadeAndSwitch, setMode, restoreEditorSnapshot, selectLevel, refreshLevels, switchToLevel
 */
import Phaser from 'phaser';
import { normalizeLevel } from '../state.js';
import { get, loadLevel, saveDraft } from '../api.js';
import { setStatus, renderLevels } from '../ui.js';
import { createGameScene } from '../game-scene.js';
import { ctx } from './context.js';
import { pushUndo } from './history.js';
import { renderRoomPanel } from './room-panel.js';
import { renderEntityProperties } from './entity-properties.js';
import { renderDropRules } from './drop-rules-panel.js';
import { renderEnemyDefaults } from './enemy-defaults-panel.js';
import { renderPreviewPlayer, renderTrialPlayer } from './player-panels.js';

const { state } = ctx;

// ── 上次编辑关卡记忆 ──
export const LAST_LEVEL_KEY = 'editor:lastLevelId';

export function rememberLevel(id) {
  try { localStorage.setItem(LAST_LEVEL_KEY, id); } catch {}
}

export function recallLevel() {
  try { return localStorage.getItem(LAST_LEVEL_KEY); } catch { return null; }
}

// ── 面板同步 ──
export function sync() {
  const dom = ctx.dom;
  const l = state.level;
  dom.backgroundColor.value = l.backgroundColor;
  dom.gridColor.value = l.gridColor;
  dom.showGridInPlay.checked = l.showGridInPlay;
  dom.showGridInEditor.checked = state.showGridInEditor;
  dom.worldWidth.value = l.world.width;
  dom.worldHeight.value = l.world.height;
  dom.cameraWidth.value = l.camera.width;
  dom.cameraMode.value = l.camera.mode;
  dom.levelUi.value = l.ui || 'battle';
  dom.template.value = l.roomLayout?.mode === 'multi' ? 'multi' : 'single';
  dom.selection.textContent = state.selected ? '已选择实体（拖拽移动）' : '未选择实体';
  renderFlows();
  dom.levelList.value = state.levelId;
  renderEntityProperties();
  renderEnemyDefaults();
  renderDropRules();
  renderRoomPanel();
  renderPreviewPlayer();
  renderTrialPlayer();
}

export function redraw() {
  state.game?.scene.scenes[0].draw();
  sync();
  // 仅编辑器模式落盘；试玩/预览中的指针事件（射击等）也会触发 redraw，绝不能写关卡文件
  if (state.mode === 'editor') {
    saveDraft(state.levelId, state.level).catch(() => setStatus(ctx.dom, '保存失败', true));
  }
}

export function renderFlows() {
  renderLevels(ctx.dom, state.levels);
}

// ── 游戏启动 ──
export function startGame() {
  if (state.game) return;
  ctx.dom.game.replaceChildren();
  state.game = new Phaser.Game({
    type: Phaser.CANVAS,
    width: ctx.W,
    height: ctx.H,
    parent: 'game',
    scene: createGameScene({
      state,
      redraw,
      pushUndo,
      onSwitchLevel: (target, spawnPoint, done) => switchToLevel(target, spawnPoint, done),
      onExitPreview: () => {
        // 打包端无编辑器可退出：ESC 在暂停态时改为恢复游戏
        if (ctx.PACKAGED) {
          state.game?.scene.scenes[0]?.toggleGrowth?.();
          return;
        }
        restoreEditorSnapshot();
        setMode('editor');
      },
      onStartNew: () => ctx.hooks.startNewGame(),
      onListSaves: () => ctx.hooks.listStoreSaves(),
      onSelectSave: id => ctx.hooks.selectSave(id),
      onOpenLevel: target => {
        // 预览（play）模式下进入战斗关卡保持 play，继续使用 previewPlayer 临时数据；
        // 试玩/正式流程仍走 trial（存档读写由 saveStore 决定）。
        const keepPreview = state.mode === 'play';
        fadeAndSwitch(() => selectLevel(target, false, false).then(() => setMode(keepPreview ? 'play' : 'trial')));
      },
      onSettings: () => {},
      onPlayerSave: player => ctx.hooks.saveStorePlayer(state.playerId, player).catch(() => {})
    }),
    scale: { mode: Phaser.Scale.NONE, width: ctx.W, height: ctx.H }
  });
}

// ── 黑屏切换 ──
// 全屏黑色淡入淡出切换（不依赖场景重建）
const FADE_MS = 350;
let fadeEl = null;
export function fadeAndSwitch(callback) {
  if (!fadeEl) {
    fadeEl = document.createElement('div');
    fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:9999;transition:opacity .35s ease;';
    document.body.appendChild(fadeEl);
  }
  fadeEl.style.transition = 'none';
  fadeEl.style.opacity = '0';
  requestAnimationFrame(() => {
    fadeEl.style.transition = 'opacity 350ms ease';
    fadeEl.style.opacity = '1';
    setTimeout(async () => {
      await callback();
      requestAnimationFrame(() => {
        fadeEl.style.transition = 'opacity 350ms ease';
        fadeEl.style.opacity = '0';
      });
    }, FADE_MS);
  });
}

// ── 模式切换与快照 ──
export function setMode(mode) {
  const dom = ctx.dom;
  state.mode = mode;
  document.body.classList.remove('ui-config-mode');
  document.body.classList.toggle('play-mode', mode !== 'editor');
  const editorVisible = !ctx.PACKAGED && mode === 'editor';
  dom.editorPanel.hidden = !editorVisible;
  dom.editorPanel.style.display = editorVisible ? '' : 'none';

  if (mode !== 'editor') {
    dom.entityProperties.hidden = true;
    dom.entityFields.innerHTML = '';
  }

  if (state.game) {
    state.game.destroy(true);
    state.game = null;
  }
  startGame();
  renderEntityProperties();
}

// 从试玩/预览退出回编辑器时恢复进入前快照，抹除游戏内切关对编辑器数据的污染
export function restoreEditorSnapshot() {
  if (!ctx.editorSnapshot) return;
  state.level = ctx.editorSnapshot.level;
  state.levelId = ctx.editorSnapshot.levelId;
  ctx.editorSnapshot = null;
  // 退出试玩/预览回到编辑器后，恢复正式玩家内存数据并切回正式存档存储源
  if (ctx.editorPlayerSnapshot) {
    state.player = ctx.editorPlayerSnapshot.player;
    state.playerId = ctx.editorPlayerSnapshot.playerId;
    state.hasAnySave = ctx.editorPlayerSnapshot.hasAnySave;
    ctx.editorPlayerSnapshot = null;
  }
  state.saveStore = 'formal';
}

// ── 关卡加载 ──
export async function selectLevel(id, formalOnly = false, remember = true) {
  const value = formalOnly ? await get(`/levels/${id}`) : await loadLevel(id);
  if (!value || typeof value !== 'object') throw new Error(`Level ${id} unavailable`);
  state.level = normalizeLevel(value);
  state.levelId = id;
  if (remember) rememberLevel(id);
  state.selected = null;
  setMode('editor');
  sync();
}

export async function refreshLevels() {
  const response = await get('/levels');
  state.levels = Array.isArray(response?.levels) ? response.levels : [];

  if (!state.levels.length) {
    renderFlows();
    setStatus(ctx.dom, '暂无关卡，请新建关卡', true);
    return false;
  }

  renderFlows();
  if (!state.levels.includes(state.levelId)) state.levelId = state.levels[0];
  ctx.dom.levelList.value = state.levelId;
  return true;
}

export async function switchToLevel(target, spawnPoint, done) {
  try {
    const value = await loadLevel(target);
    if (!value || typeof value !== 'object') throw new Error(`关卡 ${target} 不存在`);
    state.level = normalizeLevel(value);
    state.levelId = target;
    state.selected = null;
    if (spawnPoint) {
      state.level.spawn = {
        ...state.level.spawn,
        x: Number(spawnPoint.x) || 0,
        y: Number(spawnPoint.y) || 0
      };
    }
  } catch (error) {
    setStatus(ctx.dom, `切换关卡失败：${error.message}`, true);
  }
  done();
}
