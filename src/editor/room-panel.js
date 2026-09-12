/**
 * 多箱庭房间生成面板。
 * 职责：根据方格选择重新生成墙体并自适应关卡尺寸（applyRooms）、渲染房间网格面板、
 *       房间数值/尺寸修改、方格开关与单房间大小弹窗。
 * 分类：关卡设计
 * 导出：applyRooms, renderRoomPanel, updateRoomNumber, updateRoomPanelSize, toggleRoomCell,
 *       openRoomCellPopup, closeRoomCellPopup, applyRoomMarker
 */
import { setStatus } from '../ui.js';
import { generateRoomLayout, spawnInRooms, ROOM_SIZE, MAX_PANEL_SIZE } from '../rooms.js';
import { MINIMAP_MARKER_TYPES, MINIMAP_MARKER_LABELS, ROOM_TYPES, ROOM_TYPE_LABELS } from '../state.js';
import { getArtChoices } from '../systems/art/design-store.js';
import { ctx } from './context.js';
import { pushUndo } from './history.js';

const { state } = ctx;

// ── 墙体重生成 ──
// 多箱庭关卡：根据方格选择重新生成墙体并自适应关卡尺寸
export function applyRooms() {
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
  ctx.hooks.redraw();
}

// ── 面板渲染 ──
export function renderRoomPanel() {
  const dom = ctx.dom;
  const layout = state.level.roomLayout;
  const isMulti = layout?.mode === 'multi';
  dom.roomPanel.hidden = !isMulti;
  if (!isMulti) {
    dom.roomGrid.innerHTML = '';
    dom.roomCellPopup.hidden = true;
    ctx.popupCell = null;
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
  const typeOf = new Map(layout.cells.map(cell => [`${cell.c},${cell.r}`, cell.type || 'normal']));
  dom.roomGrid.style.gridTemplateColumns = `repeat(${layout.cols}, 1fr)`;
  dom.roomGrid.innerHTML = Array.from({ length: layout.rows }, (_, r) =>
    Array.from({ length: layout.cols }, (_, c) => {
      const key = `${c},${r}`;
      const on = selected.has(key);
      const size = on ? sizeOf.get(key) : ROOM_SIZE;
      const unknown = on && typeOf.get(key) === 'unknown';
      return `<button class="room-cell${on ? ' selected' : ''}${unknown ? ' unknown' : ''}" data-c="${c}" data-r="${r}" title="房间 (${c + 1},${r + 1})，大小 ${size}${unknown ? '，未知房间' : ''}">${on ? `<i>${size}${unknown ? ' ?' : ''}</i>` : ''}</button>`;
    }).join('')
  ).join('');
}

// ── 数值修改 ──
export function updateRoomNumber(field, value, min, max) {
  const layout = state.level.roomLayout;
  if (!layout) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  layout[field] = Math.min(max, Math.max(min, Math.round(n)));
  applyRooms();
}

export function updateRoomPanelSize(field, value) {
  const layout = state.level.roomLayout;
  if (!layout) return;
  const n = Number(value);
  if (!Number.isFinite(n)) return;
  layout[field] = Math.min(MAX_PANEL_SIZE, Math.max(1, Math.floor(n)));
  layout.cells = layout.cells.filter(cell => cell.c < layout.cols && cell.r < layout.rows);
  renderRoomPanel();
  applyRooms();
}

// ── 方格开关 ──
export function toggleRoomCell(c, r) {
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
      setStatus(ctx.dom, '新方格必须与已选方格相邻', true);
      return;
    }
    pushUndo();
    layout.cells.push({ c, r, size: ROOM_SIZE });
  }
  applyRooms();
}

// ── 单房间大小弹窗 ──
export function openRoomCellPopup(c, r) {
  const dom = ctx.dom;
  const layout = state.level.roomLayout;
  if (!layout) return;
  const cell = layout.cells.find(x => x.c === c && x.r === r);
  if (!cell) return;
  ctx.popupCell = { c, r };
  dom.roomCellPopupTitle.textContent = `房间 (${c + 1},${r + 1}) 设置`;
  dom.roomCellSize.value = cell.size;

  // 房间类型下拉（普通房间 / 未知房间）
  const roomTypeEl = dom.roomCellType;
  roomTypeEl.innerHTML = ROOM_TYPES.map(t => `<option value="${t}">${ROOM_TYPE_LABELS[t] || t}</option>`).join('');
  roomTypeEl.value = cell.type || 'normal';

  // 标记类型下拉（无 + 5 类中文标签）
  const typeEl = dom.roomCellMarkerType;
  typeEl.innerHTML = `<option value="">无</option>${MINIMAP_MARKER_TYPES.map(t => `<option value="${t}">${MINIMAP_MARKER_LABELS[t] || t}</option>`).join('')}`;
  typeEl.value = cell.marker?.type || '';

  // 标记图标下拉（画板资产列表，(文字占位) 表示无动态图标）
  const iconEl = dom.roomCellMarkerIcon;
  const choices = getArtChoices() || [];
  iconEl.innerHTML = `<option value="">(文字占位)</option>${choices.map(a => `<option value="${a.id}">${a.name || a.id}</option>`).join('')}`;
  iconEl.value = cell.marker?.icon || '';

  dom.roomCellPopup.hidden = false;
}

// 写回标记配置：读弹窗内两个下拉；类型「无」→ marker=null，否则 { type, icon }
export function applyRoomMarker(c, r) {
  const dom = ctx.dom;
  const layout = state.level.roomLayout;
  if (!layout) return;
  const cell = layout.cells.find(x => x.c === c && x.r === r);
  if (!cell) return;
  const type = dom.roomCellMarkerType.value;
  cell.marker = type ? { type, icon: dom.roomCellMarkerIcon.value || '' } : null;
  pushUndo();
  applyRooms();
  renderRoomPanel();
}

// 写回房间类型：读弹窗下拉；非法回落 normal
export function applyRoomType(c, r) {
  const dom = ctx.dom;
  const layout = state.level.roomLayout;
  if (!layout) return;
  const cell = layout.cells.find(x => x.c === c && x.r === r);
  if (!cell) return;
  const type = dom.roomCellType.value;
  cell.type = ROOM_TYPES.includes(type) ? type : 'normal';
  pushUndo();
  applyRooms();
  renderRoomPanel();
}

export function closeRoomCellPopup() {
  ctx.dom.roomCellPopup.hidden = true;
  ctx.popupCell = null;
}
