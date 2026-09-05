/**
 * 编辑器 DOM 事件接线。
 * 职责：bind() 统一绑定编辑器面板全部交互——工具栏、背景/网格、图片上传、世界与相机参数、
 *       掉落规则、房间面板、玩家面板、模式切换、关卡增删改导入导出、UI 配置页、快捷键与离开兜底保存；
 *       附带 UI 配置页显隐 showUIConfig。
 * 分类：引擎编辑器需求
 * 导出：bind, showUIConfig
 */
import { normalizeLevel, clone } from '../state.js';
import { remove, saveDraft, saveFormal } from '../api.js';
import { setStatus } from '../ui.js';
import { renderUIConfigPage, saveUIConfigPage, addUINode } from '../ui-config.js';
import { getUIEditor } from '../ui-editor.js';
import { showUILibrary, initUILibraryPanel, toggleUILibraryHover } from '../ui-library-panel.js';
import { registerBuiltinComponents } from '../ui-library.js';
import { showWireframe, initWireframe } from '../ui-wireframe.js';
import { showArtboard, initArtboard } from './artboard.js';
import { showWeaponBoard, initWeaponBoard } from './weapon-board.js';
import { showPetBoard, initPetBoard } from './pet-board.js';
import { MIN_ROOM_SIZE, MAX_ROOM_SIZE, MIN_ROOM_THICKNESS, MAX_ROOM_THICKNESS, MIN_ROAD_WIDTH, MAX_ROAD_WIDTH, MIN_ROAD_LENGTH, MAX_ROAD_LENGTH } from '../rooms.js';
import { ctx } from './context.js';
import { pushUndo, undo, copySelected, pasteClipboard } from './history.js';
import { applyRooms, renderRoomPanel, updateRoomNumber, updateRoomPanelSize, toggleRoomCell, openRoomCellPopup, closeRoomCellPopup, applyRoomMarker } from './room-panel.js';
import { bindDropRules } from './drop-rules-panel.js';
import { bindPlayerPanels } from './player-panels.js';
import { redraw, sync, setMode, restoreEditorSnapshot, selectLevel, refreshLevels, rememberLevel } from './level-flow.js';
import { startTrial } from './save-flow.js';

const { state } = ctx;

// ── UI 配置页显隐 ──
export function showUIConfig(show) {
  document.body.classList.toggle('ui-config-mode', show);
  if (show) renderUIConfigPage(ctx.dom, state);
}

// ── 全量接线 ──
export function bind() {
  const dom = ctx.dom;

  dom.tools.forEach(button => {
    button.onclick = () => {
      state.tool = button.dataset.tool;
      dom.tools.forEach(item => item.classList.toggle('active', item === button));
    };
  });

  dom.backgroundColor.onfocus = pushUndo;
  dom.backgroundColor.oninput = e => { state.level.backgroundColor = e.target.value; redraw(); };
  dom.gridColor.onfocus = pushUndo;
  dom.gridColor.oninput = e => { state.level.gridColor = e.target.value; redraw(); };
  dom.showGridInPlay.onchange = e => { pushUndo(); state.level.showGridInPlay = e.target.checked; redraw(); };
  dom.showGridInEditor.onchange = e => { state.showGridInEditor = e.target.checked; redraw(); };

  const saveDraftQuiet = () => saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
  const scene = () => state.game?.scene.scenes[0];

  dom.bgImage.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    pushUndo();

    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = URL.createObjectURL(file);
      });

      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      if (!res.ok) throw new Error(`上传失败 ${res.status}`);
      const data = await res.json();

      state.level.background = {
        id: 'background',
        src: data.path,
        x: Math.round(state.level.world.width / 2),
        y: Math.round(state.level.world.height / 2),
        w: img.width,
        h: img.height,
        aspect: img.width / img.height,
        visible: true
      };
      state.selected = state.level.background;
      URL.revokeObjectURL(img.src);
      scene()?.reloadBackground?.();
      redraw();
    } catch (err) {
      setStatus(dom, `背景图导入失败：${err.message}`, true);
    }
  };

  dom.bgRemove.onclick = () => {
    pushUndo();
    state.level.background = null;
    state.selected = null;
    scene()?.reloadBackground?.();
    redraw();
  };

  dom.levelImage.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    pushUndo();

    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = URL.createObjectURL(file);
      });

      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file
      });
      if (!res.ok) throw new Error(`上传失败 ${res.status}`);
      const data = await res.json();

      const image = {
        id: `image-${Date.now()}`,
        src: data.path,
        x: Math.round(state.level.world.width / 2),
        y: Math.round(state.level.world.height / 2),
        w: img.width,
        h: img.height,
        visible: true
      };
      state.level.images.push(image);
      state.selected = image;
      URL.revokeObjectURL(img.src);
      scene()?.draw?.();
      redraw();
    } catch (err) {
      setStatus(dom, `场景图片导入失败：${err.message}`, true);
    }
  };

  dom.worldWidth.onfocus = pushUndo;
  dom.worldWidth.oninput = e => {
    state.level.world.width = Math.max(600, Number(e.target.value) || 1920);
    scene()?.resetEditorCamera?.();
    scene()?.draw?.();
    saveDraftQuiet();
  };
  dom.worldHeight.onfocus = pushUndo;
  dom.worldHeight.oninput = e => {
    state.level.world.height = Math.max(600, Number(e.target.value) || 1080);
    scene()?.resetEditorCamera?.();
    scene()?.draw?.();
    saveDraftQuiet();
  };
  dom.cameraWidth.onfocus = pushUndo;
  dom.cameraWidth.oninput = e => {
    state.level.camera.width = Math.max(300, Number(e.target.value) || 1920);
    saveDraftQuiet();
  };
  dom.cameraMode.onchange = e => {
    pushUndo();
    state.level.camera.mode = e.target.value === 'center' ? 'center' : 'deadzone';
    saveDraftQuiet();
  };
  dom.levelUi.onchange = e => {
    pushUndo();
    state.level.ui = e.target.value;
    saveDraftQuiet();
  };

  bindDropRules();

  // 多箱庭关卡面板交互
  dom.roomGrid.addEventListener('click', e => {
    const cell = e.target.closest('.room-cell');
    if (!cell) return;
    toggleRoomCell(Number(cell.dataset.c), Number(cell.dataset.r));
  });
  dom.roomGrid.addEventListener('contextmenu', e => {
    e.preventDefault();
    const cell = e.target.closest('.room-cell');
    if (!cell) return;
    openRoomCellPopup(Number(cell.dataset.c), Number(cell.dataset.r));
  });
  dom.roomCellPopupClose.onclick = closeRoomCellPopup;
  dom.roomCellSize.onfocus = pushUndo;
  dom.roomCellSize.oninput = e => {
    if (!ctx.popupCell) return;
    const layout = state.level.roomLayout;
    if (!layout) return;
    const cell = layout.cells.find(x => x.c === ctx.popupCell.c && x.r === ctx.popupCell.r);
    if (!cell) return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    cell.size = Math.min(MAX_ROOM_SIZE, Math.max(MIN_ROOM_SIZE, Math.round(n)));
    applyRooms();
    renderRoomPanel();
    dom.roomCellPopup.hidden = false;
  };
  dom.roomCellMarkerType.onchange = () => {
    if (!ctx.popupCell) return;
    applyRoomMarker(ctx.popupCell.c, ctx.popupCell.r);
  };
  dom.roomCellMarkerIcon.onchange = () => {
    if (!ctx.popupCell) return;
    applyRoomMarker(ctx.popupCell.c, ctx.popupCell.r);
  };
  dom.roomCols.onfocus = pushUndo;
  dom.roomCols.oninput = e => updateRoomPanelSize('cols', e.target.value);
  dom.roomRows.onfocus = pushUndo;
  dom.roomRows.oninput = e => updateRoomPanelSize('rows', e.target.value);
  dom.roomThickness.onfocus = pushUndo;
  dom.roomThickness.oninput = e => updateRoomNumber('wallThickness', e.target.value, MIN_ROOM_THICKNESS, MAX_ROOM_THICKNESS);
  dom.roomWallColor.onfocus = pushUndo;
  dom.roomWallColor.oninput = e => {
    const layout = state.level.roomLayout;
    if (!layout) return;
    if (/^#[0-9a-f]{6}$/i.test(e.target.value)) layout.wallColor = e.target.value;
    applyRooms();
  };
  dom.roomRoadWidth.onfocus = pushUndo;
  dom.roomRoadWidth.oninput = e => updateRoomNumber('roadWidth', e.target.value, MIN_ROAD_WIDTH, MAX_ROAD_WIDTH);
  dom.roomRoadLength.onfocus = pushUndo;
  dom.roomRoadLength.oninput = e => updateRoomNumber('roadLength', e.target.value, MIN_ROAD_LENGTH, MAX_ROAD_LENGTH);

  // 预览玩家数据表单 + 试玩存档面板
  bindPlayerPanels();

  dom.editorMode.onclick = () => { restoreEditorSnapshot(); setMode('editor'); };
  dom.playMode.onclick = async () => {
    await saveDraft(state.levelId, state.level);
    ctx.editorSnapshot = { level: clone(state.level), levelId: state.levelId };
    setMode('play');
  };
  dom.trialPlay.onclick = () => startTrial();

  dom.levelList.onchange = e =>
    selectLevel(e.target.value).catch(e => setStatus(dom, `加载失败：${e.message}`, true));
  dom.load.onclick = () =>
    selectLevel(state.levelId, true).catch(e => setStatus(dom, `加载失败：${e.message}`, true));
  dom.save.onclick = () =>
    saveFormal(state.levelId, state.level)
      .then(() => setStatus(dom, '正式关卡已保存'))
      .catch(e => setStatus(dom, `保存失败：${e.message}`, true));

  // 切换关卡模板选项即切换关卡模式（单箱庭 / 多箱庭）
  function applyTemplate() {
    const item = state.templates[dom.template.value];
    if (!item) return;
    pushUndo();
    state.level = normalizeLevel(clone(item.level));
    state.selected = null;
    if (state.level.roomLayout) applyRooms();
    else redraw();
  }

  dom.template.onchange = applyTemplate;
  dom.applyTemplate.onclick = applyTemplate;

  dom.newLevel.onclick = async () => {
    const id = prompt('关卡 ID', `level-${state.levels.length + 1}`);
    if (!id) return;
    state.levelId = id;
    rememberLevel(id);
    state.level = normalizeLevel(state.templates[dom.template.value]?.level);
    if (state.level.roomLayout) applyRooms();
    await saveFormal(id, state.level);
    await refreshLevels();
    sync();
    setMode('editor');
  };

  dom.copyLevel.onclick = async () => {
    const id = prompt('复制为', `level-${state.levels.length + 1}`);
    if (!id) return;
    await saveFormal(id, state.level);
    await refreshLevels();
    await selectLevel(id);
  };

  dom.deleteLevel.onclick = async () => {
    if (state.levels.length <= 1 || !confirm('删除当前关卡？')) return;
    await remove(`/levels/${state.levelId}`);
    await refreshLevels();
    await selectLevel(state.levels[0]);
  };

  dom.export.onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state.level, null, 2)]));
    a.download = `${state.levelId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  dom.import.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    pushUndo();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        state.level = normalizeLevel(JSON.parse(reader.result));
        redraw();
      } catch {
        setStatus(dom, '导入 JSON 无效', true);
      }
    };
    reader.readAsText(file);
  };

  dom.uiConfig.onclick = () => showUIConfig(true);
  dom.uiConfigBack.onclick = () => showUIConfig(false);
  registerBuiltinComponents();
  dom.uilibrary.onclick = () => { initUILibraryPanel(dom); showUILibrary(true); };
  dom.uilibraryBack.onclick = () => showUILibrary(false);
  dom.uilibraryHover.onchange = () => toggleUILibraryHover(dom);
  dom.wireframe.onclick = () => { initWireframe(dom); showWireframe(true); };
  dom.wireframeBack.onclick = () => showWireframe(false);
  dom.uiGraphSelect.onchange = () => { getUIEditor()?.reset(); renderUIConfigPage(dom, state); };
  dom.uiNodeAdd.onclick = () => addUINode(dom, state);
  dom.uiConfigSave.onclick = () =>
    saveUIConfigPage(dom, state)
      .then(() => setStatus(dom, 'UI 配置已保存'))
      .catch(e => setStatus(dom, `UI 保存失败：${e.message}`, true));

  // 画板工作台
  dom.artboard.onclick = () => showArtboard(true, dom, state);
  initArtboard(dom, state);

  // 武器 · 弹道编辑器工作台
  dom.weaponBoard.onclick = () => showWeaponBoard(true, dom, state);
  initWeaponBoard(dom, state);

  // 宠物编辑器工作台
  dom.petBoard.onclick = () => showPetBoard(true, dom, state);
  initPetBoard(dom, state);

  // Ctrl+Z 撤销 / Ctrl+C 复制 / Ctrl+V 粘贴（仅编辑器模式；画板/武器工作台及其独立面板不参与关卡撤销）
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (state.mode !== 'editor' || document.body.classList.contains('artboard-mode') || document.body.classList.contains('weapon-mode') || document.body.classList.contains('pet-mode')) return;
    if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undo();
    } else if (mod && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      copySelected();
    } else if (mod && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault();
      pasteClipboard();
    }
  });

  // 刷新/关闭前兜底保存：防止最后一次异步 saveDraft 尚未落盘导致实体丢失
  // 仅当初始化完成（已加载真实关卡）后才保存，避免把默认空关卡写入 level-1 覆盖原内容
  window.addEventListener('beforeunload', () => {
    if (!state.ready || state.mode !== 'editor' || !state.levelId) return;
    const url = `/api/levels/${state.levelId}`;
    const body = JSON.stringify(state.level);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  });
}
