import './style.css';
import Phaser from 'phaser';
import { createState, normalizeLevel, normalizeFlows, clone, SCHEME_WEAPONS, ENEMY_TYPES, normalizeTrigger, WEAPON_LABELS } from './state.js';
import { get, post, remove, loadLevel, saveDraft, saveFormal, getUi } from './api.js';
import { getDom, setStatus, renderLevels } from './ui.js';
import { createGameScene } from './game-scene.js';
import { renderUIConfigPage, saveUIConfigPage, addUINode } from './ui-config.js';

const W = 1920, H = 1080, state = createState();
let dom;

function updateWall(field, value) {
  const wall = state.selected && state.level.walls.includes(state.selected) ? state.selected : null;
  if (!wall) return;

  const number = Number(value);
  if (field !== 'color' && !Number.isFinite(number)) return;

  wall[field] = field === 'color' ? value
    : field === 'w' || field === 'h' ? Math.max(number, 8) : number;
  redraw();
}

function sync() {
  const l = state.level;
  dom.backgroundColor.value = l.backgroundColor;
  dom.gridColor.value = l.gridColor;
  dom.showGridInPlay.checked = l.showGridInPlay;
  dom.showGridInEditor.checked = state.showGridInEditor;
  dom.worldWidth.value = l.world.width;
  dom.worldHeight.value = l.world.height;
  dom.cameraWidth.value = l.camera.width;
  dom.levelUi.value = l.ui || 'battle';
  dom.selection.textContent = state.selected ? '已选择实体（拖拽移动）' : '未选择实体';
  renderFlows();
  dom.levelList.value = state.levelId;
  renderEntityProperties();
}

function getNested(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setNested(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function renderEntityProperties() {
  const entity = state.selected;
  const l = state.level;

  const type = entity === l.spawn ? '玩家出生点'
    : l.walls.includes(entity) ? '墙体'
    : l.enemies.includes(entity) ? '敌人'
    : l.triggers.includes(entity) ? '触发器'
    : l.crates.includes(entity) ? '箱子'
    : l.barrels.includes(entity) ? '油桶'
    : entity === l.background ? '背景图' : '';

  dom.entityProperties.hidden = state.mode !== 'editor' || !entity;
  dom.entityTitle.textContent = type ? `${type}属性` : '实体属性';
  if (!entity || state.mode !== 'editor') return;

  const schemeOptions = [
    ['default', '默认方案（示例）'],
    ['hex-ring', '基础武器方案'],
    ['yellow', '黄色武器方案'],
    ['green', '绿色武器方案']
  ];
  const enemyTypeOptions = Object.entries(ENEMY_TYPES).map(([k, t]) => [k, t.name]);
  const levelOptions = state.levels.map(id => [id, id]);
  const weaponOptions = [...Object.entries(WEAPON_LABELS).map(([k, v]) => [k, v]), ['', '无']];
  const actionOptions = [
    ['complete', '通关标记'],
    ['spawnEnemy', '召唤敌人'],
    ['switchLevel', '切换关卡']
  ];

  let fields;
  if (entity === l.spawn) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['weapons.0', '武器1', 'select', weaponOptions],
      ['weapons.1', '武器2', 'select', weaponOptions],
      ['weapons.2', '武器3', 'select', weaponOptions],
      ['level', '等级', 'number'],
      ['gold', '金币', 'number']
    ];
  } else if (l.enemies.includes(entity)) {
    fields = [
      ['type', '敌人类型', 'select', enemyTypeOptions],
      ['hp', '生命值', 'number'],
      ['damage', '伤害值', 'number'],
      ['drops.gold', '金币掉落', 'number'],
      ['drops.exp', '经验掉落', 'number'],
      ['drops.charge', '充能掉落', 'number'],
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number']
    ];
  } else if (l.triggers.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度 / 直径', 'number'],
      ['h', '高度', 'number'],
      ['shape', '几何形状', 'select', [['rect', '矩形'], ['circle', '圆形']]],
      ['color', '编辑器颜色', 'color'],
      ['action', '事件类型', 'select', actionOptions],
      ['once', '一次性触发', 'boolean'],
      ['cooldown', '冷却(ms)', 'number'],
      ['visible', '可见', 'boolean']
    ];
    if (entity.action === 'spawnEnemy') {
      fields.push(
        ['spawn.stopOnExit', '离开触发器后停止生成', 'boolean'],
        ['spawn.resumeOnReturn', '离开后重新进入：继续进度', 'boolean']
      );
      const waves = (entity.spawn || {}).waves || [];
      fields.push(['__waveCount', `波数（当前 ${waves.length}）`, 'number']);
      for (let i = 0; i < waves.length; i++) {
        const no = i + 1;
        const wave = entity.spawn.waves[i] || {};
        const isSurroundCircle = wave.mode !== 'offscreen' && wave.shape === 'circle';
        fields.push(
          [`spawn.waves.${i}.enemyType`, `第${no}波敌人类型`, 'select', enemyTypeOptions],
          [`spawn.waves.${i}.mode`, `第${no}波生成方式`, 'select', [['surround', '周围生成'], ['offscreen', '屏幕外生成']]],
          [`spawn.waves.${i}.preDelay`, `第${no}波生成前等待(ms)`, 'number'],
          [`spawn.waves.${i}.postDelay`, `第${no}波生成后等待(ms)`, 'number']
        );
        if (wave.mode !== 'offscreen') {
          fields.push(
            [`spawn.waves.${i}.shape`, `第${no}波生成形状`, 'select', [['polygon', '角形生成'], ['circle', '圆环生成']]],
            [`spawn.waves.${i}.sides`, `第${no}波边数`, 'number'],
            [`spawn.waves.${i}.radius`, `第${no}波半径`, 'number'],
            [`spawn.waves.${i}.thickness`, `第${no}波边厚度`, 'number'],
            [`spawn.waves.${i}.drawDuration`, `第${no}波绘制时长(ms)`, 'number'],
            [`spawn.waves.${i}.fadeDuration`, `第${no}波消失时长(ms)`, 'number']
          );
          if (isSurroundCircle) {
            fields.push(
              [`spawn.waves.${i}.count`, `第${no}波数量`, 'number'],
              [`spawn.waves.${i}.circleCount`, `第${no}波圆形数量`, 'number']
            );
          }
        } else {
          fields.push([`spawn.waves.${i}.count`, `第${no}波数量`, 'number']);
        }
      }
    } else if (entity.action === 'switchLevel') {
      fields.push(
        ['target', '目标关卡', 'select', levelOptions],
        ['spawnPoint.x', '出生点X', 'number'],
        ['spawnPoint.y', '出生点Y', 'number']
      );
    }
  } else if (entity === l.background) {
    if (entity.fx === 'wormhole') {
      fields = [
        ['x', 'X 坐标', 'number'],
        ['y', 'Y 坐标', 'number'],
        ['radius', '半径', 'number'],
        ['rings', '圆环数', 'number'],
        ['orbitCount', '小球数', 'number'],
        ['driftAmp', '漂移幅度', 'number'],
        ['driftSpeed', '漂移速度', 'number'],
        ['yDrift', 'Y 漂移幅度', 'number'],
        ['ySpeed', 'Y 漂移速度', 'number'],
        ['scaleAmp', '缩放幅度', 'number'],
        ['scaleSpeed', '缩放速度', 'number'],
        ['orbitSpeed', '小球转速', 'number'],
        ['introShrink', '入场偏移归零时长', 'number'],
        ['introCamera', '镜头移动时长', 'number'],
        ['introHold', '到位停顿时长', 'number'],
        ['introSlow', '极慢放大时长', 'number'],
        ['introGrow', '入场放大加速度', 'number'],
        ['introPause', '全黑停顿时长', 'number'],
        ['visible', '可见', 'boolean']
      ];
    } else {
      fields = [
        ['x', 'X 坐标', 'number'],
        ['y', 'Y 坐标', 'number'],
        ['w', '宽度', 'number'],
        ['h', '高度', 'number'],
        ['visible', '可见', 'boolean']
      ];
    }
  } else if (l.crates.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number']
    ];
  } else if (l.barrels.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['explodeRadius', '爆炸半径', 'number']
    ];
  } else {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['color', '颜色', 'color']
    ];
  }

  dom.entityFields.innerHTML = fields.map(([key, label, inputType, options]) => {
    const value = key === '__waveCount'
      ? ((entity.spawn || {}).waves || []).length
      : getNested(entity, key) ?? '';
    if (inputType === 'select') {
      const opts = options.map(([v, name]) =>
        `<option value="${v}" ${value === v ? 'selected' : ''}>${name}</option>`).join('');
      return `<label>${label}<select data-entity-field="${key}">${opts}</select></label>`;
    }
    if (inputType === 'boolean') {
      return `<label>${label}<input data-entity-field="${key}" type="checkbox" ${value ? 'checked' : ''}></label>`;
    }
    return `<label>${label}<input data-entity-field="${key}" type="${inputType}" value="${value}"></label>`;
  }).join('');

  dom.entityFields.querySelectorAll('input,select').forEach(input => {
    input.oninput = () => {
      const field = input.dataset.entityField;
      if (field === '__waveCount') {
        const target = Math.max(1, Math.floor(Number(input.value) || 1));
        const spawn = entity.spawn || (entity.spawn = {});
        const waves = spawn.waves || (spawn.waves = []);
        while (waves.length < target) waves.push({});
        while (waves.length > target) waves.pop();
        renderEntityProperties();
        return;
      }
      const value = input.type === 'checkbox' ? input.checked
        : input.type === 'number' ? Number(input.value) : input.value;
      setNested(entity, field, value);
      if (field === 'type') {
        const def = ENEMY_TYPES[value];
        if (def) {
          entity.hp = def.hp;
          entity.damage = def.damage;
        }
      }
      if (field === 'scheme') entity.weaponType = SCHEME_WEAPONS[value];
      if (field === 'action') {
        if (value === 'spawnEnemy' && !entity.spawn) {
          entity.spawn = normalizeTrigger(entity, 0).spawn;
        } else if (value === 'switchLevel' && !entity.target) {
          entity.target = state.levels[0] || '';
        }
        renderEntityProperties();
        return;
      }
      if (field === 'spawn.mode' || /^spawn\.waves\.\d+\.(mode|shape)$/.test(field)) {
        renderEntityProperties();
        return;
      }
      state.game?.scene.scenes[0].draw();
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '草稿保存失败', true));
    };
  });
}

function redraw() {
  state.game?.scene.scenes[0].draw();
  sync();
  saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '草稿保存失败', true));
}

function renderFlows() {
  renderLevels(dom, state.levels, state.flows.flows[state.activeFlow], state.activeFlow);
}

function startGame() {
  if (state.game) return;
  dom.game.replaceChildren();
  state.game = new Phaser.Game({
    type: Phaser.CANVAS,
    width: W,
    height: H,
    parent: 'game',
    scene: createGameScene({
      state,
      redraw,
      onSwitchLevel: (target, spawnPoint, done) => switchToLevel(target, spawnPoint, done),
      onExitPreview: () => setMode('editor'),
      onLevelResult: result => result === 'completed' && completeFlowNode(),
      onStartNew: () => startNewGame(),
      onContinue: () => continueGame(),
      onSettings: () => {}
    }),
    scale: { mode: Phaser.Scale.NONE, width: W, height: H }
  });
}

function startNewGame() {
  localStorage.removeItem('arc_save');
  const firstGame = state.levels.find(id => id !== 'login') || state.levels[0];
  if (firstGame) selectLevel(firstGame).then(() => setMode('play'));
}

function continueGame() {
  const save = localStorage.getItem('arc_save');
  if (!save) return;
  try {
    const data = JSON.parse(save);
    if (data.level && state.levels.includes(data.level)) {
      selectLevel(data.level).then(() => setMode('play'));
    }
  } catch {
    /* 忽略损坏存档 */
  }
}

function setMode(mode) {
  state.mode = mode;
  document.body.classList.remove('ui-config-mode');
  document.body.classList.toggle('play-mode', mode !== 'editor');
  dom.editorPanel.hidden = mode !== 'editor';
  dom.editorPanel.style.display = mode === 'editor' ? '' : 'none';

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

async function selectLevel(id, formalOnly = false) {
  const value = formalOnly ? await get(`/levels/${id}`) : await loadLevel(id);
  if (!value || typeof value !== 'object') throw new Error(`Level ${id} unavailable`);
  state.level = normalizeLevel(value);
  state.levelId = id;
  state.selected = null;
  setMode('editor');
  sync();
}

async function refreshLevels() {
  const response = await get('/levels');
  state.levels = Array.isArray(response?.levels) ? response.levels : [];

  if (!state.levels.length) {
    renderFlows();
    setStatus(dom, '暂无关卡，请新建关卡', true);
    return false;
  }

  renderFlows();
  if (!state.levels.includes(state.levelId)) state.levelId = state.levels[0];
  dom.levelList.value = state.levelId;
  return true;
}

function currentFlow() {
  return state.flows.flows[state.activeFlow];
}

function validateFlow(flow) {
  if (!flow.nodes.length) throw new Error('流程至少需要一个关卡');
  if (!flow.entry || !flow.nodes.some(node => node.id === flow.entry)) throw new Error('流程入口无效');
  if (flow.nodes.some(node => !node.target || !state.levels.includes(node.target))) throw new Error('流程存在无效关卡');
}

async function loadFlowNode(index) {
  const flow = currentFlow();
  const node = flow.nodes[index];
  if (!node) return finishFlow();
  state.flowRuntime = { type: state.activeFlow, index, currentNodeId: node.id, status: 'running' };
  await selectLevel(node.target, true);
  setMode('play');
}

async function startFlow(type) {
  state.activeFlow = type;
  const flow = currentFlow();
  try {
    validateFlow(flow);
    const index = Math.max(0, flow.nodes.findIndex(node => node.id === flow.entry));
    await loadFlowNode(index);
  } catch (error) {
    setStatus(dom, `流程启动失败：${error.message}`, true);
  }
}

async function completeFlowNode() {
  if (state.flowRuntime.status !== 'running') return;
  const next = state.flowRuntime.index + 1;
  if (next < currentFlow().nodes.length) await loadFlowNode(next);
  else finishFlow();
}

async function switchToLevel(target, spawnPoint, done) {
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
    setStatus(dom, `切换关卡失败：${error.message}`, true);
  }
  done();
}

function finishFlow() {
  const result = state.activeFlow === 'game' ? '通关' : '教程完成';
  state.flowRuntime.status = 'completed';
  alert(result);
  setMode('editor');
}

function bind() {
  dom.tools.forEach(button => {
    button.onclick = () => {
      state.tool = button.dataset.tool;
      dom.tools.forEach(item => item.classList.toggle('active', item === button));
    };
  });

  dom.backgroundColor.oninput = e => { state.level.backgroundColor = e.target.value; redraw(); };
  dom.gridColor.oninput = e => { state.level.gridColor = e.target.value; redraw(); };
  dom.showGridInPlay.onchange = e => { state.level.showGridInPlay = e.target.checked; redraw(); };
  dom.showGridInEditor.onchange = e => { state.showGridInEditor = e.target.checked; redraw(); };

  const saveDraftQuiet = () => saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '草稿保存失败', true));
  const scene = () => state.game?.scene.scenes[0];

  dom.bgImage.onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

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
    state.level.background = null;
    state.selected = null;
    scene()?.reloadBackground?.();
    redraw();
  };

  dom.worldWidth.oninput = e => {
    state.level.world.width = Math.max(600, Number(e.target.value) || 1920);
    scene()?.resetEditorCamera?.();
    scene()?.draw?.();
    saveDraftQuiet();
  };
  dom.worldHeight.oninput = e => {
    state.level.world.height = Math.max(600, Number(e.target.value) || 1080);
    scene()?.resetEditorCamera?.();
    scene()?.draw?.();
    saveDraftQuiet();
  };
  dom.cameraWidth.oninput = e => {
    state.level.camera.width = Math.max(300, Number(e.target.value) || 1920);
    saveDraftQuiet();
  };
  dom.levelUi.onchange = e => {
    state.level.ui = e.target.value;
    saveDraftQuiet();
  };

  dom.editorMode.onclick = () => setMode('editor');
  dom.playMode.onclick = async () => {
    await saveDraft(state.levelId, state.level);
    setMode('play');
  };
  dom.flowPlay.onclick = () => startFlow('game');
  dom.tutorialPlay.onclick = () => startFlow('tutorial');

  dom.levelList.onchange = e =>
    selectLevel(e.target.value).catch(e => setStatus(dom, `加载失败：${e.message}`, true));
  dom.load.onclick = () =>
    selectLevel(state.levelId, true).catch(e => setStatus(dom, `加载失败：${e.message}`, true));
  dom.save.onclick = () =>
    saveFormal(state.levelId, state.level)
      .then(() => setStatus(dom, '正式关卡已保存'))
      .catch(e => setStatus(dom, `保存失败：${e.message}`, true));

  dom.applyTemplate.onclick = () => {
    const item = state.templates[dom.template.value];
    if (item) {
      state.level = normalizeLevel(clone(item.level));
      state.selected = null;
      redraw();
    }
  };

  dom.newLevel.onclick = async () => {
    const id = prompt('关卡 ID', `level-${state.levels.length + 1}`);
    if (!id) return;
    state.levelId = id;
    state.level = normalizeLevel(state.templates[dom.template.value]?.level);
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

  dom.flowType.onchange = e => { state.activeFlow = e.target.value; renderFlows(); };
  dom.flowStart.onchange = e => { currentFlow().entry = e.target.value; };
  dom.addFlow.onclick = () => {
    const target = dom.flowAdd.value;
    currentFlow().nodes.push({
      id: `${state.activeFlow}-${Date.now()}`,
      type: state.activeFlow === 'game' ? 'level' : 'tutorial',
      target
    });
    renderFlows();
  };
  dom.saveFlow.onclick = async () => {
    try {
      validateFlow(currentFlow());
      await post('/flow', state.flows);
      setStatus(dom, '流程已保存');
    } catch (error) {
      setStatus(dom, `保存失败：${error.message}`, true);
    }
  };
  dom.previewFlow.onclick = () => startFlow(state.activeFlow);

  dom.flowList.onclick = e => {
    const index = Number(e.target.dataset.flow);
    if (!Number.isInteger(index)) return;
    currentFlow().nodes.splice(index, 1);
    if (currentFlow().entry === e.target.dataset.id) {
      currentFlow().entry = currentFlow().nodes[0]?.id || '';
    }
    renderFlows();
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
  dom.uiGraphSelect.onchange = () => renderUIConfigPage(dom, state);
  dom.uiNodeAdd.onclick = () => addUINode(dom, state);
  dom.uiConfigSave.onclick = () =>
    saveUIConfigPage(dom, state)
      .then(() => setStatus(dom, 'UI 配置已保存'))
      .catch(e => setStatus(dom, `UI 保存失败：${e.message}`, true));
}

function showUIConfig(show) {
  document.body.classList.toggle('ui-config-mode', show);
  if (show) renderUIConfigPage(dom, state);
}

async function initialize() {
  try {
    dom = getDom();
    bind();
    dom.editorPanel.hidden = false;
    dom.editorPanel.style.display = '';
    state.templates = await get('/templates');
    state.flows = normalizeFlows(await get('/flow'));
    try {
      state.ui = { battle: await getUi('battle'), interface: await getUi('interface'), login: await getUi('login') };
    } catch {
      state.ui = { battle: null, interface: null, login: null };
    }
    if (!await refreshLevels()) return;
    await selectLevel(state.levelId);
    startGame();
    setStatus(dom, '初始化完成');
  } catch (error) {
    if (dom) setStatus(dom, `初始化失败：${error.message}`, true);
    else document.body.textContent = `初始化失败：${error.message}`;
  }
}

initialize();
