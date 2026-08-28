import './style.css';
import Phaser from 'phaser';
import { createState, normalizeLevel, clone, SCHEME_WEAPONS, ENEMY_TYPES, DROP_ITEMS, WEAPON_LABELS, MOD_DEFS } from './state.js';
import { get, remove, loadLevel, saveDraft, saveFormal, getUi, loadPlayer, savePlayer, listPlayers, loadTestPlayer, saveTestPlayer, listTestPlayers } from './api.js';
import { getDom, setStatus, renderLevels, renderPreviewWeapons, renderPreviewMods } from './ui.js';
import { createGameScene } from './game-scene.js';
import { normalizePlayer } from './player-data.js';
import { renderUIConfigPage, saveUIConfigPage, addUINode } from './ui-config.js';
import { generateRoomLayout, spawnInRooms, ROOM_SIZE, MIN_ROOM_SIZE, MAX_ROOM_SIZE, MIN_ROOM_THICKNESS, MAX_ROOM_THICKNESS, MAX_PANEL_SIZE, MIN_ROAD_WIDTH, MAX_ROAD_WIDTH, MIN_ROAD_LENGTH, MAX_ROAD_LENGTH } from './rooms.js';

const W = 1920, H = 1080, state = createState();
// 打包/纯游戏端：Electron 通过 ?packaged=1 或 preload 暴露 __APP_PACKAGED__ 标记
const PACKAGED = (() => {
  try {
    return window.__APP_PACKAGED__ === true ||
      new URLSearchParams(window.location.search).get('packaged') === '1';
  } catch { return false; }
})();
const LAST_LEVEL_KEY = 'editor:lastLevelId';
// 进入试玩/预览前的编辑器关卡快照；退出时恢复，保证试玩/预览不改变编辑器关卡数据
let editorSnapshot = null;
// 进入试玩前的编辑器玩家快照；试玩期间 state.player 切到测试存档，退出时恢复正式玩家内存数据
let editorPlayerSnapshot = null;

function rememberLevel(id) {
  try { localStorage.setItem(LAST_LEVEL_KEY, id); } catch {}
}

function recallLevel() {
  try { return localStorage.getItem(LAST_LEVEL_KEY); } catch { return null; }
}
state.player = normalizePlayer();
state.playerId = 'save-1';
state.hasAnySave = false;
// 存档存储源：formal=正式 data/players，test=试玩 data/test-players
state.saveStore = 'formal';
// 预览临时玩家数据：仅在"游戏预览"模式生效；给初始升级点数便于体验加点
state.previewPlayer = normalizePlayer();
state.previewPlayer.progress.points = 5;
state.previewPlayer.items = {
  stacks: { 'multi-track': 2, 'relic-vitality': 1 },
  uniques: [{ uid: 'u-ricochet', itemId: 'ricochet' }, { uid: 'u-pet-ember', itemId: 'pet-ember' }]
};
// 试玩临时玩家数据：读真实存档但不写回，避免试玩改变玩家存档
state.trialPlayer = normalizePlayer();

// 试玩模式（mode==='trial'）走测试存档 API，其余走正式存档 API
function isTrialSaveStore() {
  return state.saveStore === 'test';
}
function listStoreSaves() {
  return isTrialSaveStore() ? listTestPlayers() : listPlayers();
}
function saveStorePlayer(id, player) {
  return isTrialSaveStore() ? saveTestPlayer(id, player) : savePlayer(id, player);
}
function loadStorePlayer(id) {
  return isTrialSaveStore() ? loadTestPlayer(id) : loadPlayer(id);
}
let dom;
// 「图标」文件夹素材列表（可交互图标下拉选择）
let iconChoices = [];

// 编辑器撤销栈（Ctrl+Z）
const MAX_UNDO = 60;
const undoStack = [];
function pushUndo() {
  undoStack.push(clone(state.level));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}
function undo() {
  const prev = undoStack.pop();
  if (!prev) { setStatus(dom, '没有可回退的操作'); return; }
  // 跳过无变化的快照（例如仅点击选择、未实际修改）
  if (JSON.stringify(prev) === JSON.stringify(state.level)) { undo(); return; }
  state.level = normalizeLevel(prev);
  state.selected = null;
  state.game?.scene.scenes[0]?.draw?.();
  sync();
  saveFormal(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
}

// 编辑器复制/粘贴（Ctrl+C / Ctrl+V）
let clipboard = null;

function entityKind(l, entity) {
  if (l.walls.includes(entity)) return 'walls';
  if (l.enemies.includes(entity)) return 'enemies';
  if (l.triggers.includes(entity)) return 'triggers';
  if (l.crates.includes(entity)) return 'crates';
  if (l.barrels.includes(entity)) return 'barrels';
  if (l.chests.includes(entity)) return 'chests';
  if (l.images.includes(entity)) return 'images';
  if ((l.spawnZones || []).includes(entity)) return 'spawnZones';
  if (l.gates.includes(entity)) return 'gates';
  if (l.vendors.includes(entity)) return 'vendors';
  if (l.idols.includes(entity)) return 'idols';
  if ((l.icons || []).includes(entity)) return 'icons';
  if ((l.portals || []).includes(entity)) return 'portals';
  return '';
}

const COPY_ID_PREFIX = {
  walls: 'wall', enemies: 'enemy', triggers: 'trigger', crates: 'crate',
  barrels: 'barrel', chests: 'chest', images: 'image', spawnZones: 'spawnzone',
  gates: 'gate', vendors: 'vendor', idols: 'idol', icons: 'icon', portals: 'portal'
};

function copySelected() {
  const entity = state.selected;
  if (!entity) { setStatus(dom, '未选择实体'); return; }
  const kind = entityKind(state.level, entity);
  if (!kind) { setStatus(dom, '该实体不可复制'); return; }
  clipboard = { kind, data: clone(entity) };
  setStatus(dom, '已复制');
}

function pasteClipboard() {
  if (!clipboard) { setStatus(dom, '剪贴板为空'); return; }
  const l = state.level;
  const list = l[clipboard.kind];
  if (!Array.isArray(list)) return;
  const dup = clone(clipboard.data);
  dup.id = `${COPY_ID_PREFIX[clipboard.kind]}-${Date.now()}`;
  dup.x = (Number(dup.x) || 0) + 40;
  dup.y = (Number(dup.y) || 0) + 40;
  pushUndo();
  list.push(dup);
  state.selected = dup;
  redraw();
  setStatus(dom, '已粘贴');
}

function updateWall(field, value) {
  const wall = state.selected && state.level.walls.includes(state.selected) ? state.selected : null;
  if (!wall) return;

  const number = Number(value);
  if (field !== 'color' && !Number.isFinite(number)) return;

  wall[field] = field === 'color' ? value
    : field === 'w' || field === 'h' ? Math.max(number, 8) : number;
  redraw();
}

// 多箱庭关卡：根据方格选择重新生成墙体并自适应关卡尺寸
function applyRooms() {
  const layout = state.level.roomLayout;
  if (!layout) return;
  const result = generateRoomLayout(layout);
  const l = state.level;
  l.walls = [...l.walls.filter(w => !w.room), ...result.walls];
  l.world = result.world;
  if (result.spawn && !spawnInRooms(l.spawn, result.rooms)) {
    l.spawn = { ...l.spawn, x: result.spawn.x, y: result.spawn.y };
  }
  state.game?.scene.scenes[0]?.resetEditorCamera?.();
  redraw();
}

function renderRoomPanel() {
  const layout = state.level.roomLayout;
  const isMulti = layout?.mode === 'multi';
  dom.roomPanel.hidden = !isMulti;
  if (!isMulti) {
    dom.roomGrid.innerHTML = '';
    dom.roomCellPopup.hidden = true;
    popupCell = null;
    return;
  }

  if (Number(dom.roomCols.value) !== layout.cols) dom.roomCols.value = layout.cols;
  if (Number(dom.roomRows.value) !== layout.rows) dom.roomRows.value = layout.rows;
  if (Number(dom.roomThickness.value) !== layout.wallThickness) dom.roomThickness.value = layout.wallThickness;
  if (dom.roomWallColor.value.toLowerCase() !== layout.wallColor.toLowerCase()) dom.roomWallColor.value = layout.wallColor;
  if (Number(dom.roomRoadWidth.value) !== layout.roadWidth) dom.roomRoadWidth.value = layout.roadWidth;
  if (Number(dom.roomRoadLength.value) !== layout.roadLength) dom.roomRoadLength.value = layout.roadLength;

  const selected = new Set(layout.cells.map(cell => `${cell.c},${cell.r}`));
  const sizeOf = new Map(layout.cells.map(cell => [`${cell.c},${cell.r}`, cell.size]));
  dom.roomGrid.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
  dom.roomGrid.innerHTML = Array.from({ length: layout.rows }, (_, r) =>
    Array.from({ length: layout.cols }, (_, c) => {
      const key = `${c},${r}`;
      const on = selected.has(key);
      const size = on ? sizeOf.get(key) : ROOM_SIZE;
      return `<button class="room-cell${on ? ' selected' : ''}" data-c="${c}" data-r="${r}" title="房间 (${c + 1},${r + 1})，大小 ${size}">${on ? `<i>${size}</i>` : ''}</button>`;
    }).join('')
  ).join('');
}

function updateRoomNumber(field, value, min, max) {
  const layout = state.level.roomLayout;
  if (!layout) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  layout[field] = Math.min(max, Math.max(min, Math.round(n)));
  applyRooms();
}

function updateRoomPanelSize(field, value) {
  const layout = state.level.roomLayout;
  if (!layout) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  layout[field] = Math.min(MAX_PANEL_SIZE, Math.max(1, Math.floor(n)));
  layout.cells = layout.cells.filter(cell => cell.c < layout.cols && cell.r < layout.rows);
  renderRoomPanel();
  applyRooms();
}

function toggleRoomCell(c, r) {
  const layout = state.level.roomLayout;
  if (!layout) return;
  const index = layout.cells.findIndex(cell => cell.c === c && cell.r === r);
  if (index >= 0) {
    pushUndo();
    layout.cells.splice(index, 1);
  } else {
    // 新方格必须与已选方格上下左右相邻，保证房间互相连通
    const adjacent = layout.cells.some(cell => Math.abs(cell.c - c) + Math.abs(cell.r - r) === 1);
    if (layout.cells.length && !adjacent) {
      setStatus(dom, '新方格必须与已选方格相邻', true);
      return;
    }
    pushUndo();
    layout.cells.push({ c, r, size: ROOM_SIZE });
  }
  applyRooms();
}

let popupCell = null;

function openRoomCellPopup(c, r) {
  const layout = state.level.roomLayout;
  if (!layout) return;
  const cell = layout.cells.find(x => x.c === c && x.r === r);
  if (!cell) return;
  popupCell = { c, r };
  dom.roomCellPopupTitle.textContent = `房间 (${c + 1},${r + 1}) 大小设置`;
  dom.roomCellSize.value = cell.size;
  dom.roomCellPopup.hidden = false;
}

function closeRoomCellPopup() {
  dom.roomCellPopup.hidden = true;
  popupCell = null;
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
  dom.cameraMode.value = l.camera.mode;
  dom.levelUi.value = l.ui || 'battle';
  dom.template.value = l.roomLayout?.mode === 'multi' ? 'multi' : 'single';
  dom.selection.textContent = state.selected ? '已选择实体（拖拽移动）' : '未选择实体';
  renderFlows();
  dom.levelList.value = state.levelId;
  renderEntityProperties();
  renderDropRules();
  renderRoomPanel();
  renderPreviewPlayer();
  renderTrialPlayer();
}

function renderPreviewPlayer() {
  const p = state.previewPlayer;
  const c = p.combat;
  dom.pvLevel.value = p.progress.level;
  dom.pvExp.value = p.progress.exp;
  dom.pvPoints.value = p.progress.points ?? 0;
  dom.pvGold.value = p.currency.gold;
  dom.pvMoveSpeed.value = c.moveSpeed;
  dom.pvAttackPower.value = c.attackPower;
  dom.pvCritRate.value = c.critRate;
  dom.pvAttackSpeed.value = c.attackSpeed;
  dom.pvMaxHp.value = c.maxHp;
  dom.pvMaxShield.value = c.maxShield;
  dom.pvDamageReduction.value = c.damageReduction;
  dom.pvDodgeRate.value = c.dodgeRate;
  renderPreviewWeapons(dom, p.weapons);
  renderPreviewMods(dom, p.equipment.weaponMods, MOD_DEFS);
}

function renderTrialPlayer() {
  const p = state.player;
  const c = p.combat;
  dom.tpSlot.value = state.playerId;
  dom.tpLevel.value = p.progress.level;
  dom.tpExp.value = p.progress.exp;
  dom.tpPoints.value = p.progress.points ?? 0;
  dom.tpGold.value = p.currency.gold;
  dom.tpMoveSpeed.value = c.moveSpeed;
  dom.tpAttackPower.value = c.attackPower;
  dom.tpCritRate.value = c.critRate;
  dom.tpAttackSpeed.value = c.attackSpeed;
  dom.tpMaxHp.value = c.maxHp;
  dom.tpMaxShield.value = c.maxShield;
  dom.tpDamageReduction.value = c.damageReduction;
  dom.tpDodgeRate.value = c.dodgeRate;
  renderPreviewWeapons(dom, p.weapons, 'tpWeapons');
  renderPreviewMods(dom, p.equipment.weaponMods, MOD_DEFS, 'tpMods');
}

function setModEquipped(player, id, equipped) {
  const def = MOD_DEFS[id];
  if (!def) return;
  const eq = player.equipment && player.equipment.weaponMods;
  if (!eq) return;
  if (def.weapon) {
    const slot = eq[def.weapon];
    if (!slot) return;
    slot.dedicated = equipped ? id : (slot.dedicated === id ? null : slot.dedicated);
  } else {
    for (const w of Object.keys(eq)) {
      const slot = eq[w];
      if (!slot) continue;
      const arr = slot.generic || (slot.generic = []);
      if (equipped) {
        if (!arr.includes(id)) arr.push(id);
      } else {
        slot.generic = arr.filter(x => x !== id);
      }
    }
  }
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
    : l.chests.includes(entity) ? '宝箱'
    : entity === l.background ? '背景图'
    : l.images.includes(entity) ? '场景图片'
    : (l.spawnZones || []).includes(entity) ? '生成区域'
    : l.gates.includes(entity) ? '能量门'
    : l.vendors.includes(entity) ? '售货机'
    : l.idols.includes(entity) ? '神像'
    : (l.icons || []).includes(entity) ? '可交互图标'
    : (l.portals || []).includes(entity) ? '传送门' : '';

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
  const eventTypeOptions = [
    ['complete', '整体通关标记'],
    ['roomComplete', '单房间通关标记'],
    ['combat', '触发战斗'],
    ['spawnEnemy', '召唤敌人'],
    ['switchLevel', '切换关卡'],
    ['spawnGate', '生成能量门'],
    ['removeGate', '消除能量门']
  ];
  const gateOptions = state.level.gates.map((g, i) => [g.id, `${i + 1}. ${g.id}`]);

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
  } else if (l.walls.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['shape', '墙体形状', 'select', [['rect', '矩形'], ['circle', '圆形'], ['arc', '弧形']]],
      ['w', '宽度 / 直径', 'number'],
      ['h', '高度', 'number'],
      ['thickness', '弧形厚度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['startAngle', '弧形起始角度', 'number'],
      ['endAngle', '弧形结束角度', 'number'],
      ['color', '颜色', 'color'],
      ['visible', '游戏中显示', 'boolean']
    ];
  } else if (l.enemies.includes(entity)) {
    fields = [
      ['type', '敌人类型', 'select', enemyTypeOptions],
      ['hp', '生命值', 'number'],
      ['damage', '伤害值', 'number'],
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
      ['once', '一次性触发', 'boolean'],
      ['cooldown', '冷却(ms)', 'number'],
      ['visible', '可见', 'boolean']
    ];
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
        ['introRingCount', '新生成圆环数量', 'number'],
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
  } else if (l.images.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['visible', '游戏中显示', 'boolean']
    ];
  } else if (l.gates.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['color1', '外色块颜色', 'color'],
      ['color2', '内色块颜色', 'color'],
      ['label', '门上文字', 'text'],
      ['active', '初始激活', 'boolean'],
      ['visible', '可见', 'boolean']
    ];
  } else if ((l.spawnZones || []).includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['color', '颜色', 'color']
    ];
  } else if (l.vendors.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['interactRadius', '交互半径', 'number'],
      ['visible', '可见', 'boolean']
    ];
  } else if (l.idols.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['interactRadius', '交互半径', 'number'],
      ['visible', '可见', 'boolean']
    ];
  } else if ((l.icons || []).includes(entity)) {
    const iconSrcOptions = [
      ['', '（无）'],
      ...iconChoices.map(a => [a.url, a.name])
    ];
    if (entity.src && !iconSrcOptions.some(([v]) => v === entity.src)) {
      iconSrcOptions.unshift([entity.src, entity.src]);
    }
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['interactRadius', '交互范围', 'number'],
      ['tipText', 'Tip 文字', 'text'],
      ['event', '交互事件', 'select', [
        ['workshop', '打开工坊页面'],
        ['weapon', '打开武器页面'],
        ['battle', '打开战斗页面']
      ]],
      ['src', '图标', 'select', iconSrcOptions],
      ['visible', '游戏中显示', 'boolean']
    ];
  } else if ((l.portals || []).includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['trigger', '出现方式', 'select', [
        ['start', '游戏开始即存在'],
        ['trigger', '触发器触发（清敌后出现）']
      ]],
      ['triggerId', '触发器', 'select', [
        ['', '（无）'],
        ...l.triggers.map((t, i) => [t.id, `${i + 1}. ${t.id}`])
      ]],
      ['interactRadius', '交互半径', 'number'],
      ['visible', '可见', 'boolean']
    ];
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
  } else if (l.chests.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['trigger', '出现方式', 'select', [
        ['start', '游戏开始即存在'],
        ['trigger', '触发器触发（清敌后出现）']
      ]],
      ['triggerId', '触发器', 'select', [
        ['', '（无）'],
        ...l.triggers.map((t, i) => [t.id, `${i + 1}. ${t.id}`])
      ]],
      ['openRadius', '打开判定半径', 'number']
    ];
    fields.unshift(['id', '编号', 'text']);
    dom.entityFields.innerHTML = fields.map(([key, label, inputType, options]) => {
      const value = getNested(entity, key) ?? '';
      if (inputType === 'select') {
        const opts = options.map(([v, name]) =>
          `<option value="${v}" ${value === v ? 'selected' : ''}>${name}</option>`).join('');
        return `<label>${label}<select data-entity-field="${key}">${opts}</select></label>`;
      }
      return `<label>${label}<input data-entity-field="${key}" type="number" value="${value}"></label>`;
    }).join('');
    // 掉落奖励配置（种类/数量/概率）
    const rewardEditor = document.createElement('div');
    rewardEditor.className = 'chest-rewards';
    rewardEditor.innerHTML = `
      <h3>掉落奖励配置</h3>
      <div class="chest-reward-list"></div>
      <button type="button" id="chestRewardAdd">添加奖励</button>`;
    dom.entityFields.appendChild(rewardEditor);

    const rewardList = rewardEditor.querySelector('.chest-reward-list');
    const renderRewards = () => {
      const rewards = entity.rewards || (entity.rewards = []);
      rewardList.innerHTML = rewards.map((r, i) => `
        <div class="chest-reward-row">
          <div class="cr-head">
            <label>掉落种类
              <select data-reward-i="${i}" data-reward-k="item">
                ${Object.entries(DROP_ITEMS).map(([k, v]) => `<option value="${k}" ${r.item === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
            <button type="button" data-reward-del="${i}" title="删除此条奖励">删除</button>
          </div>
          <div class="cr-fields">
            <label>数量
              <input data-reward-i="${i}" data-reward-k="count" type="number" min="1" value="${r.count}"/>
            </label>
            <label>概率
              <span class="cr-chance"><input data-reward-i="${i}" data-reward-k="chance" type="number" min="0" max="100" value="${r.chance}"/><b>%</b></span>
            </label>
          </div>
        </div>`).join('');
    };
    renderRewards();

    rewardEditor.querySelector('#chestRewardAdd').onclick = () => {
      pushUndo();
      const rewards = entity.rewards || (entity.rewards = []);
      rewards.push({ item: 'gold', count: 1, chance: 100 });
      renderRewards();
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
    };
    rewardList.addEventListener('click', e => {
      const del = e.target.dataset.rewardDel;
      if (del != null) {
        pushUndo();
        entity.rewards.splice(Number(del), 1);
        renderRewards();
        saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
      }
    });
    rewardList.addEventListener('input', e => {
      const i = Number(e.target.dataset.rewardI);
      const k = e.target.dataset.rewardK;
      if (!Number.isInteger(i) || !k || !entity.rewards[i]) return;
      if (k === 'item') entity.rewards[i].item = e.target.value;
      else entity.rewards[i][k] = k === 'count'
        ? Math.max(1, Math.floor(Number(e.target.value) || 1))
        : Math.min(100, Math.max(0, Number(e.target.value) ?? 100));
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
    });

    bindEntityFieldInputs(entity);
    return;
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

  function triggerEventParamsHtml(ev, i) {
    const type = ev.type || 'complete';

    if (type === 'spawnEnemy') {
      const spawn = ev.spawn || (ev.spawn = {});
      const zoneOptions = [...(state.level.spawnZones || []).map((z, zi) => [z.id, `${zi + 1}. ${z.id}`])];
      if (zoneOptions.length) zoneOptions.unshift(['', '（无：用触发器自身范围）']);
      const waves = Array.isArray(spawn.waves) ? spawn.waves : (spawn.waves = []);
      let html = `
        <label class="te-check"><input type="checkbox" data-event-i="${i}" data-event-field="spawn.stopOnExit" ${spawn.stopOnExit ? 'checked' : ''}/>离开触发器后停止生成</label>
        <label class="te-check"><input type="checkbox" data-event-i="${i}" data-event-field="spawn.resumeOnReturn" ${spawn.resumeOnReturn !== false ? 'checked' : ''}/>离开后重新进入：继续进度</label>
        <label>波数<input data-event-i="${i}" data-event-wavecount="${i}" type="number" min="1" value="${waves.length}"/></label>`;

      for (let w = 0; w < waves.length; w++) {
        const wave = waves[w] || {};
        const no = w + 1;
        const isSurroundCircle = wave.mode !== 'offscreen' && wave.mode !== 'inscreen' && wave.shape === 'circle';
        html += `
          <label>第${no}波敌人类型
            <select data-event-i="${i}" data-event-field="spawn.waves.${w}.enemyType">
              ${enemyTypeOptions.map(([v, name]) => `<option value="${v}" ${(wave.enemyType || 'basic1') === v ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
          </label>
          <label>第${no}波生成方式
            <select data-event-i="${i}" data-event-field="spawn.waves.${w}.mode">
              ${[['surround', '周围生成'], ['offscreen', '屏幕外生成'], ['inscreen', '屏幕内随机']].map(([v, name]) => `<option value="${v}" ${(wave.mode || 'surround') === v ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
          </label>
          <label>第${no}波生成前等待(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.preDelay" type="number" value="${wave.preDelay ?? 0}"/></label>
          <label>第${no}波生成后等待(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.postDelay" type="number" value="${wave.postDelay ?? 1000}"/></label>
          <label class="te-check"><input type="checkbox" data-event-i="${i}" data-event-field="spawn.waves.${w}.waitForClear" ${wave.waitForClear ? 'checked' : ''}/>第${no}波等待清理</label>`;

        if (wave.mode === 'inscreen') {
          html += `
            <label>第${no}波生成区域
              <select data-event-i="${i}" data-event-field="spawn.waves.${w}.zoneId">
                ${zoneOptions.map(([v, name]) => `<option value="${v}" ${(wave.zoneId || '') === v ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </label>
            <label>第${no}波数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.count" type="number" value="${wave.count ?? 5}"/></label>
            <label>第${no}波玩家安全半径<input data-event-i="${i}" data-event-field="spawn.waves.${w}.playerMinRadius" type="number" value="${wave.playerMinRadius ?? 200}"/></label>`;
        } else if (wave.mode !== 'offscreen') {
          html += `
            <label>第${no}波生成形状
              <select data-event-i="${i}" data-event-field="spawn.waves.${w}.shape">
                ${[['polygon', '角形生成'], ['circle', '圆环生成']].map(([v, name]) => `<option value="${v}" ${(wave.shape || 'polygon') === v ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </label>
            <label>第${no}波边数<input data-event-i="${i}" data-event-field="spawn.waves.${w}.sides" type="number" value="${wave.sides ?? 6}"/></label>
            <label>第${no}波半径<input data-event-i="${i}" data-event-field="spawn.waves.${w}.radius" type="number" value="${wave.radius ?? 120}"/></label>
            <label>第${no}波边厚度<input data-event-i="${i}" data-event-field="spawn.waves.${w}.thickness" type="number" value="${wave.thickness ?? 10}"/></label>
            <label>第${no}波绘制时长(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.drawDuration" type="number" value="${wave.drawDuration ?? 500}"/></label>
            <label>第${no}波消失时长(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.fadeDuration" type="number" value="${wave.fadeDuration ?? 500}"/></label>`;
          if (isSurroundCircle) {
            html += `
              <label>第${no}波数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.count" type="number" value="${wave.count ?? 5}"/></label>
              <label>第${no}波圆形数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.circleCount" type="number" value="${wave.circleCount ?? 8}"/></label>`;
          }
        } else {
          html += `<label>第${no}波数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.count" type="number" value="${wave.count ?? 5}"/></label>`;
        }
      }
      return html;
    }

    if (type === 'switchLevel') {
      const sp = ev.spawnPoint || (ev.spawnPoint = { x: 0, y: 0 });
      return `
        <label>目标关卡
          <select data-event-i="${i}" data-event-field="target">
            ${levelOptions.map(([v, name]) => `<option value="${v}" ${(ev.target || '') === v ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
        </label>
        <label>出生点X<input data-event-i="${i}" data-event-field="spawnPoint.x" type="number" value="${sp.x ?? 0}"/></label>
        <label>出生点Y<input data-event-i="${i}" data-event-field="spawnPoint.y" type="number" value="${sp.y ?? 0}"/></label>`;
    }

    if (type === 'spawnGate' || type === 'removeGate') {
      const arr = Array.isArray(ev.gateIds) ? ev.gateIds : (ev.gateIds = []);
      return `<div class="field-multiselect"><span class="ms-title">目标能量门（多选）</span><div class="ms-list">
        ${gateOptions.map(([v, name]) => `<label class="ms-item"><input type="checkbox" data-event-i="${i}" data-ms="events.${i}.gateIds" value="${v}" ${arr.includes(v) ? 'checked' : ''}/>${name}</label>`).join('')}
      </div></div>`;
    }

    return '<p class="hint">该事件无参数</p>';
  }

  function renderTriggerEvents(entity) {
    const wrap = document.createElement('div');
    wrap.className = 'trigger-events';
    wrap.innerHTML = `
      <h3>事件列表</h3>
      <div class="trigger-event-list"></div>
      <button type="button" id="triggerEventAdd">添加事件</button>`;
    dom.entityFields.appendChild(wrap);

    const list = wrap.querySelector('.trigger-event-list');
    const saveQuiet = () => saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));

    const render = () => {
      const events = entity.events || (entity.events = []);
      if (!events.length) events.push({ type: 'complete' });
      list.innerHTML = events.map((ev, i) => `
        <div class="trigger-event-row">
          <div class="te-head">
            <label>事件类型
              <select data-event-i="${i}" data-event-type="${i}">
                ${eventTypeOptions.map(([v, name]) => `<option value="${v}" ${(ev.type || 'complete') === v ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </label>
            <label>触发时机
              <select data-event-i="${i}" data-event-when="${i}">
                <option value="enter" ${(ev.when || 'enter') === 'enter' ? 'selected' : ''}>进入即触发</option>
                <option value="enemiesCleared" ${ev.when === 'enemiesCleared' ? 'selected' : ''}>击败本触发器召唤敌人后</option>
              </select>
            </label>
            <button type="button" data-event-del="${i}" title="删除此事件">删除</button>
          </div>
          <div class="te-params">${triggerEventParamsHtml(ev, i)}</div>
        </div>`).join('');
    };
    render();

    wrap.addEventListener('focusin', e => {
      if (e.target.matches('input,select')) pushUndo();
    });

    wrap.querySelector('#triggerEventAdd').onclick = () => {
      pushUndo();
      const events = entity.events || (entity.events = []);
      events.push({ type: 'complete' });
      render();
      saveQuiet();
    };

    list.addEventListener('click', e => {
      const del = e.target.dataset.eventDel;
      if (del != null) {
        pushUndo();
        const events = entity.events || (entity.events = []);
        events.splice(Number(del), 1);
        render();
        saveQuiet();
      }
    });

    list.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.eventWhen != null) {
        const i = Number(el.dataset.eventWhen);
        const ev = entity.events[i];
        if (!ev) return;
        ev.when = el.value === 'enemiesCleared' ? 'enemiesCleared' : 'enter';
        saveQuiet();
        return;
      }
      if (el.dataset.eventType != null) {
        const i = Number(el.dataset.eventType);
        const ev = entity.events[i];
        if (!ev) return;
        ev.type = el.value;
        delete ev.spawn;
        delete ev.target;
        delete ev.spawnPoint;
        delete ev.gateIds;
        if (ev.type === 'spawnEnemy') {
          ev.spawn = { stopOnExit: false, resumeOnReturn: true, waves: [] };
        } else if (ev.type === 'switchLevel') {
          ev.target = state.levels[0] || '';
          ev.spawnPoint = { x: 0, y: 0 };
        } else if (ev.type === 'spawnGate' || ev.type === 'removeGate') {
          ev.gateIds = [];
        }
        render();
        saveQuiet();
        return;
      }
      if (el.dataset.ms != null) {
        const i = Number(el.dataset.eventI);
        const ev = entity.events[i];
        if (!ev) return;
        ev.gateIds = [...list.querySelectorAll(`input[data-ms="events.${i}.gateIds"]:checked`)].map(x => x.value);
        saveQuiet();
        return;
      }
      const field = el.dataset.eventField;
      const i = Number(el.dataset.eventI);
      if (!field || !Number.isInteger(i) || !entity.events[i]) return;
      const value = el.type === 'checkbox' ? el.checked
        : el.type === 'number' ? Number(el.value) : el.value;
      setNested(entity.events[i], field, value);
      if (/^spawn\.waves\.\d+\.(mode|shape)$/.test(field)) render();
      saveQuiet();
    });

    list.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.eventWavecount != null) {
        const i = Number(el.dataset.eventWavecount);
        const ev = entity.events[i];
        if (!ev) return;
        const spawn = ev.spawn || (ev.spawn = {});
        const target = Math.max(1, Math.floor(Number(el.value) || 1));
        const waves = spawn.waves || (spawn.waves = []);
        while (waves.length < target) waves.push({});
        while (waves.length > target) waves.pop();
        render();
        return;
      }
      const field = el.dataset.eventField;
      const i = Number(el.dataset.eventI);
      if (!field || !Number.isInteger(i) || !entity.events[i]) return;
      const value = el.type === 'checkbox' ? el.checked
        : el.type === 'number' ? Number(el.value) : el.value;
      setNested(entity.events[i], field, value);
      if (/^spawn\.waves\.\d+\.(mode|shape)$/.test(field)) render();
      saveQuiet();
    });
  }

  fields.unshift(['id', '编号', 'text']);
  dom.entityFields.innerHTML = fields.map(([key, label, inputType, options]) => {
    const value = key === '__waveCount'
      ? ((entity.spawn || {}).waves || []).length
      : getNested(entity, key) ?? '';
    if (inputType === 'select') {
      const opts = options.map(([v, name]) =>
        `<option value="${v}" ${value === v ? 'selected' : ''}>${name}</option>`).join('');
      return `<label>${label}<select data-entity-field="${key}">${opts}</select></label>`;
    }
    if (inputType === 'multiselect') {
      const arr = Array.isArray(value) ? value : [];
      const opts = options.map(([v, name]) =>
        `<label class="ms-item"><input type="checkbox" data-ms="${key}" value="${v}" ${arr.includes(v) ? 'checked' : ''}/>${name}</label>`).join('');
      return `<div class="field-multiselect"><span class="ms-title">${label}</span><div class="ms-list">${opts}</div></div>`;
    }
    if (inputType === 'boolean') {
      return `<label>${label}<input data-entity-field="${key}" type="checkbox" ${value ? 'checked' : ''}></label>`;
    }
    if (inputType === 'color') {
      return `<label>${label}<input data-entity-field="${key}" type="color" value="${/^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#60758b'}"></label>`;
    }
    return `<label>${label}<input data-entity-field="${key}" type="${inputType}" value="${value}"></label>`;
  }).join('');

  bindEntityFieldInputs(entity);

  if ((l.icons || []).includes(entity)) {
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.textContent = '上传图标';
    uploadBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        pushUndo();
        try {
          const res = await fetch('/api/uploads', {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file
          });
          if (!res.ok) throw new Error(`上传失败 ${res.status}`);
          const data = await res.json();
          entity.src = data.path;
          state.game?.scene.scenes[0]?.draw?.();
          saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
          renderEntityProperties();
        } catch (err) {
          setStatus(dom, `图标上传失败：${err.message}`, true);
        }
      };
      input.click();
    };
    dom.entityFields.appendChild(uploadBtn);
  }

  if (l.triggers.includes(entity)) renderTriggerEvents(entity);
}

function bindEntityFieldInputs(entity) {
  dom.entityFields.querySelectorAll('input,select').forEach(input => {
    input.onfocus = pushUndo;
    input.oninput = () => {
      const field = input.dataset.entityField;
      if (!field) return;
      if (field === '__waveCount') {
        const target = Math.max(1, Math.floor(Number(input.value) || 1));
        const spawn = entity.spawn || (entity.spawn = {});
        const waves = spawn.waves || (spawn.waves = []);
        while (waves.length < target) waves.push({});
        while (waves.length > target) waves.pop();
        renderEntityProperties();
        return;
      }
      if (input.dataset.ms !== undefined) {
        const values = [...dom.entityFields.querySelectorAll(`input[data-ms="${input.dataset.ms}"]:checked`)].map(i => i.value);
        setNested(entity, input.dataset.ms, values);
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
      if (field === 'spawn.mode' || /^spawn\.waves\.\d+\.(mode|shape)$/.test(field)) {
        const m = /^spawn\.waves\.(\d+)\.mode$/.exec(field);
        if (m) {
          const wave = entity.spawn.waves[Number(m[1])] || {};
          if (value === 'inscreen') {
            if (wave.count === undefined) wave.count = 5;
            if (wave.playerMinRadius === undefined) wave.playerMinRadius = 200;
          }
        }
        renderEntityProperties();
        return;
      }
      // 门/生成区域编号变更后重绘，刷新其它实体引用到的下拉选项
      if (field === 'id' && (state.level.gates.includes(entity) || (state.level.spawnZones || []).includes(entity))) {
        state.game?.scene.scenes[0].draw();
        return;
      }
      state.game?.scene.scenes[0].draw();
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
    };
  });
}

function renderDropRules() {
  const rules = state.level.dropRules || {};
  dom.dropRulesEditor.innerHTML = Object.entries(ENEMY_TYPES).map(([type, t]) => {
    const list = Array.isArray(rules[type]) ? rules[type] : [];
    const rows = list.map((rule, i) => `
      <div class="drop-rule">
        <select data-drop-type="${type}" data-drop-index="${i}" data-drop-field="item">
          ${Object.entries(DROP_ITEMS).map(([k, name]) =>
            `<option value="${k}" ${rule.item === k ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
        <input type="number" min="0" step="1" data-drop-type="${type}" data-drop-index="${i}" data-drop-field="count" value="${rule.count}" title="数量"/>
        <input type="number" min="0" max="100" step="1" data-drop-type="${type}" data-drop-index="${i}" data-drop-field="chance" value="${rule.chance}" title="概率(%)"/>
        <span class="drop-unit">%</span>
        <button data-drop-del="${type}" data-drop-index="${i}" title="删除规则">×</button>
      </div>`).join('');
    return `<div class="drop-rule-group">
      <div class="drop-rule-head"><span>${t.name}</span><button data-drop-add="${type}">添加</button></div>
      ${rows || '<p class="hint">未配置（沿用敌人个体掉落）</p>'}
    </div>`;
  }).join('');
}

function bindDropRules() {
  const saveQuiet = () => saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
  const rulesOf = type => {
    const rules = state.level.dropRules || (state.level.dropRules = {});
    return rules[type] || (rules[type] = []);
  };

  dom.dropRulesEditor.addEventListener('focusin', e => {
    if (e.target.matches('input,select')) pushUndo();
  });

  dom.dropRulesEditor.addEventListener('input', e => {
    const el = e.target;
    const field = el.dataset.dropField;
    if (!field) return;
    const rule = rulesOf(el.dataset.dropType)[Number(el.dataset.dropIndex)];
    if (!rule) return;
    if (field === 'item') return;
    const value = Math.max(0, Math.floor(Number(el.value) || 0));
    rule[field] = field === 'chance' ? Math.min(100, value) : value;
    saveQuiet();
  });

  dom.dropRulesEditor.addEventListener('change', e => {
    const el = e.target;
    if (!el.dataset.dropField || el.type === 'number') return;
    const rule = rulesOf(el.dataset.dropType)[Number(el.dataset.dropIndex)];
    if (rule) rule.item = el.value;
    saveQuiet();
  });

  dom.dropRulesEditor.addEventListener('click', e => {
    const add = e.target.closest('[data-drop-add]');
    const del = e.target.closest('[data-drop-del]');
    if (add) {
      pushUndo();
      rulesOf(add.dataset.dropAdd).push({ item: 'gold', count: 1, chance: 100 });
      renderDropRules();
      saveQuiet();
    } else if (del) {
      pushUndo();
      const list = state.level.dropRules?.[del.dataset.dropDel];
      if (Array.isArray(list)) list.splice(Number(del.dataset.dropIndex), 1);
      renderDropRules();
      saveQuiet();
    }
  });
}

function redraw() {
  state.game?.scene.scenes[0].draw();
  sync();
  // 仅编辑器模式落盘；试玩/预览中的指针事件（射击等）也会触发 redraw，绝不能写关卡文件
  if (state.mode === 'editor') {
    saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
  }
}

function renderFlows() {
  renderLevels(dom, state.levels);
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
      pushUndo,
      onSwitchLevel: (target, spawnPoint, done) => switchToLevel(target, spawnPoint, done),
      onExitPreview: () => {
        // 打包端无编辑器可退出：ESC 在暂停态时改为恢复游戏
        if (PACKAGED) {
          state.game?.scene.scenes[0]?.toggleGrowth?.();
          return;
        }
        restoreEditorSnapshot();
        setMode('editor');
      },
      onStartNew: () => startNewGame(),
      onListSaves: () => listStoreSaves(),
      onSelectSave: id => selectSave(id),
      onOpenLevel: target => {
        // 预览（play）模式下进入战斗关卡保持 play，继续使用 previewPlayer 临时数据；
        // 试玩/正式流程仍走 trial（存档读写由 saveStore 决定）。
        const keepPreview = state.mode === 'play';
        fadeAndSwitch(() => selectLevel(target, false, false).then(() => setMode(keepPreview ? 'play' : 'trial')));
      },
      onSettings: () => {},
      onPlayerSave: player => saveStorePlayer(state.playerId, player).catch(() => {})
    }),
    scale: { mode: Phaser.Scale.NONE, width: W, height: H }
  });
}

// 全屏黑色淡入淡出切换（不依赖场景重建）
const FADE_MS = 350;
let fadeEl = null;
function fadeAndSwitch(callback) {
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

function startNewGame() {
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

// 选择存档栏位：读取该存档并进入骑士之家家园关卡；试玩走测试存档，正式走原存档
async function selectSave(id) {
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
    setStatus(dom, `读取存档失败：${error.message}`, true);
  }
}

function setMode(mode) {
  state.mode = mode;
  document.body.classList.remove('ui-config-mode');
  document.body.classList.toggle('play-mode', mode !== 'editor');
  const editorVisible = !PACKAGED && mode === 'editor';
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
function restoreEditorSnapshot() {
  if (!editorSnapshot) return;
  state.level = editorSnapshot.level;
  state.levelId = editorSnapshot.levelId;
  editorSnapshot = null;
  // 退出试玩/预览回到编辑器后，恢复正式玩家内存数据并切回正式存档存储源
  if (editorPlayerSnapshot) {
    state.player = editorPlayerSnapshot.player;
    state.playerId = editorPlayerSnapshot.playerId;
    state.hasAnySave = editorPlayerSnapshot.hasAnySave;
    editorPlayerSnapshot = null;
  }
  state.saveStore = 'formal';
}

async function selectLevel(id, formalOnly = false, remember = true) {
  const value = formalOnly ? await get(`/levels/${id}`) : await loadLevel(id);
  if (!value || typeof value !== 'object') throw new Error(`Level ${id} unavailable`);
  state.level = normalizeLevel(value);
  state.levelId = id;
  if (remember) rememberLevel(id);
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

// 试玩：进入登录主页（login 关卡），后续“开始游戏/继续游戏/存档选择”与正式流程一致，
// 但所有玩家存档读写均走测试存档 API（data/test-players/），与正式存档完全隔离。
async function startTrial() {
  try {
    await saveDraft(state.levelId, state.level);
    editorSnapshot = { level: clone(state.level), levelId: state.levelId };
    editorPlayerSnapshot = { player: clone(state.player), playerId: state.playerId, hasAnySave: state.hasAnySave };
    state.saveStore = 'test';
    // 试玩登录主页与后续游戏只使用测试存档数据，先放一个空测试玩家，避免携带编辑器里的正式玩家数据
    state.player = normalizePlayer();
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
    setStatus(dom, `试玩启动失败：${error.message}`, true);
  }
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

function bind() {
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
    if (!popupCell) return;
    const layout = state.level.roomLayout;
    if (!layout) return;
    const cell = layout.cells.find(x => x.c === popupCell.c && x.r === popupCell.r);
    if (!cell) return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    cell.size = Math.min(MAX_ROOM_SIZE, Math.max(MIN_ROOM_SIZE, Math.round(n)));
    applyRooms();
    renderRoomPanel();
    dom.roomCellPopup.hidden = false;
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

  // 预览玩家数据表单
  dom.pvLevel.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.previewPlayer.progress.level = Math.floor(n); };
  dom.pvExp.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.progress.exp = Math.floor(n); };
  dom.pvPoints.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.progress.points = Math.floor(n); };
  dom.pvGold.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.currency.gold = Math.floor(n); };
  dom.pvMoveSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.previewPlayer.combat.moveSpeed = n; };
  dom.pvAttackPower.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.combat.attackPower = n; };
  dom.pvCritRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.previewPlayer.combat.critRate = n; };
  dom.pvAttackSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.previewPlayer.combat.attackSpeed = n; };
  dom.pvMaxHp.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.previewPlayer.combat.maxHp = Math.floor(n); };
  dom.pvMaxShield.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.previewPlayer.combat.maxShield = Math.floor(n); };
  dom.pvDamageReduction.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.previewPlayer.combat.damageReduction = n; };
  dom.pvDodgeRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.previewPlayer.combat.dodgeRate = n; };
  dom.pvWeapons.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const w = input.dataset.w, wd = state.previewPlayer.weapons[w];
    if (!wd) return;
    if (input.dataset.u !== undefined) wd.unlocked = input.checked;
    else if (input.dataset.e !== undefined) wd.enhance[Number(input.dataset.e)] = input.checked ? 1 : 0;
  });

  dom.pvMods.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const id = input.dataset.mod;
    if (!id || !MOD_DEFS[id]) return;
    setModEquipped(state.previewPlayer, id, input.checked);
  });

  // 试玩存档面板：直接编辑正式玩家存档 state.player
  dom.tpLevel.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.player.progress.level = Math.floor(n); };
  dom.tpExp.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.progress.exp = Math.floor(n); };
  dom.tpPoints.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.progress.points = Math.floor(n); };
  dom.tpGold.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.currency.gold = Math.floor(n); };
  dom.tpMoveSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.player.combat.moveSpeed = n; };
  dom.tpAttackPower.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.combat.attackPower = n; };
  dom.tpCritRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.player.combat.critRate = n; };
  dom.tpAttackSpeed.oninput = e => { const n = Number(e.target.value); if (n >= 0.1) state.player.combat.attackSpeed = n; };
  dom.tpMaxHp.oninput = e => { const n = Number(e.target.value); if (n >= 1) state.player.combat.maxHp = Math.floor(n); };
  dom.tpMaxShield.oninput = e => { const n = Number(e.target.value); if (n >= 0) state.player.combat.maxShield = Math.floor(n); };
  dom.tpDamageReduction.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.player.combat.damageReduction = n; };
  dom.tpDodgeRate.oninput = e => { const n = Number(e.target.value); if (n >= 0 && n <= 1) state.player.combat.dodgeRate = n; };
  dom.tpWeapons.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const w = input.dataset.w, wd = state.player.weapons[w];
    if (!wd) return;
    if (input.dataset.u !== undefined) wd.unlocked = input.checked;
    else if (input.dataset.e !== undefined) wd.enhance[Number(input.dataset.e)] = input.checked ? 1 : 0;
  });
  dom.tpMods.addEventListener('change', e => {
    const input = e.target;
    if (input.type !== 'checkbox') return;
    const id = input.dataset.mod;
    if (!id || !MOD_DEFS[id]) return;
    setModEquipped(state.player, id, input.checked);
  });
  dom.tpSave.onclick = () => {
    state.player.meta.updatedAt = Date.now();
    renderTrialPlayer();
    savePlayer(state.playerId, state.player)
      .then(() => { state.hasAnySave = true; setStatus(dom, '存档已保存'); })
      .catch(e => setStatus(dom, `存档保存失败：${e.message}`, true));
  };
  dom.tpReload.onclick = async () => {
    try {
      state.player = normalizePlayer(await loadPlayer(state.playerId));
      renderTrialPlayer();
      setStatus(dom, '存档已重新加载');
    } catch (e) {
      setStatus(dom, `存档加载失败：${e.message}`, true);
    }
  };
  // 切换存档栏位：加载所选存档并自动套用数据
  dom.tpSlot.onchange = async e => {
    const id = e.target.value;
    try {
      state.playerId = id;
      try {
        state.player = normalizePlayer(await loadPlayer(id));
        state.hasAnySave = true;
      } catch {
        state.player = normalizePlayer();
        state.hasAnySave = false;
      }
      renderTrialPlayer();
      setStatus(dom, `已切换到 ${id}`);
    } catch (error) {
      setStatus(dom, `切换存档失败：${error.message}`, true);
    }
  };

  dom.editorMode.onclick = () => { restoreEditorSnapshot(); setMode('editor'); };
  dom.playMode.onclick = async () => {
    await saveDraft(state.levelId, state.level);
    editorSnapshot = { level: clone(state.level), levelId: state.levelId };
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
  dom.uiGraphSelect.onchange = () => renderUIConfigPage(dom, state);
  dom.uiNodeAdd.onclick = () => addUINode(dom, state);
  dom.uiConfigSave.onclick = () =>
    saveUIConfigPage(dom, state)
      .then(() => setStatus(dom, 'UI 配置已保存'))
      .catch(e => setStatus(dom, `UI 保存失败：${e.message}`, true));

  // Ctrl+Z 撤销 / Ctrl+C 复制 / Ctrl+V 粘贴（仅编辑器模式）
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (state.mode !== 'editor') return;
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

function showUIConfig(show) {
  document.body.classList.toggle('ui-config-mode', show);
  if (show) renderUIConfigPage(dom, state);
}

async function loadPackagedUi() {
  try {
    state.ui = { battle: await getUi('battle'), interface: await getUi('interface'), login: await getUi('login'), weapon: await getUi('weapon'), workshop: await getUi('workshop') };
  } catch {
    state.ui = { battle: null, interface: null, login: null, weapon: null, workshop: null };
  }
}

// 打包端：正式存档进入登录主页（login 关卡），后续新游戏/继续游戏走正式流程
async function enterPackagedLogin() {
  state.saveStore = 'formal';
  const target = state.levels.includes('login')
    ? 'login'
    : (state.levels.find(id => id !== 'login') || state.levels[0]);
  if (!target) throw new Error('暂无关卡');
  await selectLevel(target, false, false);
  setMode('trial');
}

async function initializePackaged() {
  state.templates = null;
  state.player = normalizePlayer();
  state.playerId = 'save-1';
  state.saveStore = 'formal';
  await loadPackagedUi();
  try {
    const { metas } = await listPlayers();
    state.hasAnySave = Object.keys(metas || {}).length > 0;
  } catch {
    state.hasAnySave = false;
  }
  if (!await refreshLevels()) return;
  await enterPackagedLogin();
  state.ready = true;
  setStatus(dom, '初始化完成');
}

async function initialize() {
  try {
    dom = getDom();
    bind();
    if (PACKAGED) {
      await initializePackaged();
      return;
    }
    dom.editorPanel.hidden = false;
    dom.editorPanel.style.display = '';
    state.templates = await get('/templates');
    try {
      iconChoices = (await get('/icons')).icons || [];
    } catch {
      iconChoices = [];
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
    setStatus(dom, '初始化完成');
  } catch (error) {
    if (dom) setStatus(dom, `初始化失败：${error.message}`, true);
    else document.body.textContent = `初始化失败：${error.message}`;
  }
}

initialize();
