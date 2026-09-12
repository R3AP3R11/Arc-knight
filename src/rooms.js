import { normalizeRoomMarker } from './state.js';

// 多箱庭关卡参数
export const ROOM_SIZE = 1120;   // 默认小房间内宽高
export const DEFAULT_ROAD_WIDTH = 448;  // 连接道路宽度（可配置）
export const DEFAULT_ROAD_LENGTH = 560; // 相邻房间内壁间距 / 道路长度（可配置）
export const WORLD_MARGIN = 500; // 关卡整体外扩边距（宽+500 / 高+500）
export const ROOM_OFFSET = WORLD_MARGIN / 2;    // 布局起点 = 250
export const MIN_ROOM_THICKNESS = 8;
export const MAX_ROOM_THICKNESS = 200;
export const MAX_PANEL_SIZE = 8;
export const MIN_ROAD_WIDTH = 120;
export const MAX_ROAD_WIDTH = 1100;  // 保证墙洞两侧留有墙段
export const MIN_ROAD_LENGTH = 60;
export const MAX_ROAD_LENGTH = 1680;
export const MIN_ROOM_SIZE = 400;    // 单个房间最小内宽高
export const MAX_ROOM_SIZE = 2400;   // 单个房间最大内宽高
export const DEFAULT_WALL_COLOR = '#60758b';

export const clampRoomSize = value => Math.min(MAX_ROOM_SIZE, Math.max(MIN_ROOM_SIZE, Math.round(Number(value) || ROOM_SIZE)));

// 规整多箱庭配置；非 multi 或无有效方格返回 null（单箱庭关卡）
export function normalizeRoomLayout(value) {
  if (!value || value.mode !== 'multi') return null;
  const cols = Math.min(MAX_PANEL_SIZE, Math.max(1, Math.floor(Number(value.cols) || 3)));
  const rows = Math.min(MAX_PANEL_SIZE, Math.max(1, Math.floor(Number(value.rows) || 3)));
  const wallThickness = Math.min(MAX_ROOM_THICKNESS, Math.max(MIN_ROOM_THICKNESS, Number(value.wallThickness) || 30));
  const roadWidth = Math.min(MAX_ROAD_WIDTH, Math.max(MIN_ROAD_WIDTH, Number(value.roadWidth) || DEFAULT_ROAD_WIDTH));
  const roadLength = Math.min(MAX_ROAD_LENGTH, Math.max(MIN_ROAD_LENGTH, Number(value.roadLength) || DEFAULT_ROAD_LENGTH));
  const wallColor = /^#[0-9a-f]{6}$/i.test(String(value.wallColor)) ? value.wallColor : DEFAULT_WALL_COLOR;
  const cells = (Array.isArray(value.cells) ? value.cells : [])
    .map(cell => ({
      c: Math.floor(Number(cell?.c)),
      r: Math.floor(Number(cell?.r)),
      size: clampRoomSize(cell?.size),
      marker: normalizeRoomMarker(cell?.marker),
      type: cell?.type === 'unknown' ? 'unknown' : 'normal'
    }))
    .filter(cell => Number.isInteger(cell.c) && Number.isInteger(cell.r)
      && cell.c >= 0 && cell.c < cols && cell.r >= 0 && cell.r < rows);
  // 去重
  const seen = new Set();
  const unique = cells.filter(cell => {
    const key = `${cell.c},${cell.r}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { mode: 'multi', cols, rows, wallThickness, roadWidth, roadLength, wallColor, cells: unique };
}

function roomRect(layout, id, left, top, w, h) {
  return { id, x: left + w / 2, y: top + h / 2, w, h, shape: 'rect', thickness: Math.min(w, h), rotation: 0, color: layout.wallColor, visible: true, room: true };
}

// 生成墙体 / 世界尺寸 / 房间矩形（内壁坐标）
// 每个格子拥有独立尺寸（内宽高），房间按「尺寸 + 道路长度」累计定位，
// 道路对齐相邻房间边缘的中心。
export function generateRoomLayout(layout) {
  const t = layout.wallThickness;
  const roadW = layout.roadWidth;
  const roadLen = layout.roadLength;
  const build = (id, left, top, w, h) => roomRect(layout, id, left, top, w, h);

  // 归一化：整体平移到最小格为原点
  const minC = Math.min(...layout.cells.map(cell => cell.c), 0);
  const minR = Math.min(...layout.cells.map(cell => cell.r), 0);
  const cells = layout.cells.map(cell => ({ c: cell.c - minC, r: cell.r - minR, size: cell.size, marker: cell.marker, type: cell.type }));
  const maxC = cells.length ? Math.max(...cells.map(cell => cell.c)) : -1;
  const maxR = cells.length ? Math.max(...cells.map(cell => cell.r)) : -1;

  // 每列尺寸 = 该列所有格子尺寸的最大值；每行同理由行内最大值
  const colSize = [];
  for (let c = 0; c <= maxC; c++) {
    colSize[c] = Math.max(...cells.filter(cell => cell.c === c).map(cell => cell.size), clampRoomSize(0));
  }
  const rowSize = [];
  for (let r = 0; r <= maxR; r++) {
    rowSize[r] = Math.max(...cells.filter(cell => cell.r === r).map(cell => cell.size), clampRoomSize(0));
  }

  // 前缀累计原点
  const colX = [ROOM_OFFSET];
  for (let c = 0; c <= maxC; c++) colX[c + 1] = colX[c] + colSize[c] + roadLen;
  const rowY = [ROOM_OFFSET];
  for (let r = 0; r <= maxR; r++) rowY[r + 1] = rowY[r] + rowSize[r] + roadLen;

  const layoutW = colX[maxC + 1] - roadLen - ROOM_OFFSET;
  const layoutH = rowY[maxR + 1] - roadLen - ROOM_OFFSET;
  const world = {
    width: Math.max(600, layoutW + WORLD_MARGIN),
    height: Math.max(600, layoutH + WORLD_MARGIN)
  };

  const cellByKey = new Map(cells.map(cell => [`${cell.c},${cell.r}`, cell]));
  // 道路开口有效宽度：不超过配置道路宽，且保证两侧房间墙至少留 8 墙段
  const effWidth = (a, b) => Math.max(8, Math.min(roadW, a - 16, b - 16));

  const rooms = [];
  const walls = [];

  for (const { c, r } of cells) {
    const cell = cellByKey.get(`${c},${r}`);
    const sw = cell.size, sh = cell.size;
    // 房间在「列宽/行高」内居中（列宽=该列最大尺寸，行高=该行最大尺寸）
    const ox = colX[c] + (colSize[c] - sw) / 2;
    const oy = rowY[r] + (rowSize[r] - sh) / 2;
    const right = ox + sw, bottom = oy + sh;
    const cx = ox + sw / 2, cy = oy + sh / 2;
    rooms.push({ c, r, x: ox, y: oy, w: sw, h: sh, marker: cell.marker, type: cell.type });

    const nbL = cellByKey.get(`${c - 1},${r}`);
    const nbR = cellByKey.get(`${c + 1},${r}`);
    const nbT = cellByKey.get(`${c},${r - 1}`);
    const nbB = cellByKey.get(`${c},${r + 1}`);

    // 上/下墙（覆盖左右墙厚度，含角）
    for (const [edge, top, nb, center] of [
      ['top', oy - t, nbT, cx],
      ['bottom', bottom, nbB, cx]
    ]) {
      if (nb) {
        const ew = effWidth(sw, nb.size);
        const o0 = center - ew / 2, o1 = center + ew / 2;
        walls.push(build(`room-${c}-${r}-${edge}-a`, ox - t, top, o0 - (ox - t), t));
        walls.push(build(`room-${c}-${r}-${edge}-b`, o1, top, ox + sw + t - o1, t));
      } else {
        walls.push(build(`room-${c}-${r}-${edge}`, ox - t, top, sw + t * 2, t));
      }
    }

    // 左/右墙
    for (const [edge, left, nb, center] of [
      ['left', ox - t, nbL, cy],
      ['right', right, nbR, cy]
    ]) {
      if (nb) {
        const ew = effWidth(sh, nb.size);
        const o0 = center - ew / 2, o1 = center + ew / 2;
        walls.push(build(`room-${c}-${r}-${edge}-a`, left, oy, t, o0 - oy));
        walls.push(build(`room-${c}-${r}-${edge}-b`, left, o1, t, oy + sh - o1));
      } else {
        walls.push(build(`room-${c}-${r}-${edge}`, left, oy, t, sh));
      }
    }

    // 道路侧墙：从本房间边缘一直延伸到相邻房间边缘（实际间距，避免断裂）
    if (nbR) {
      const ew = effWidth(sh, nbR.size);
      const bLeft = colX[c + 1] + (colSize[c + 1] - nbR.size) / 2;
      const gap = bLeft - right;
      walls.push(build(`room-${c}-${r}-road-h-t`, right, cy - ew / 2 - t, gap, t));
      walls.push(build(`room-${c}-${r}-road-h-b`, right, cy + ew / 2, gap, t));
    }
    if (nbB) {
      const ew = effWidth(sw, nbB.size);
      const bTop = rowY[r + 1] + (rowSize[r + 1] - nbB.size) / 2;
      const gap = bTop - bottom;
      walls.push(build(`room-${c}-${r}-road-v-l`, cx - ew / 2 - t, bottom, t, gap));
      walls.push(build(`room-${c}-${r}-road-v-r`, cx + ew / 2, bottom, t, gap));
    }
  }

  const first = rooms[0] || null;
  const spawn = first ? { x: first.x + first.w / 2, y: first.y + first.h / 2 } : null;

  return { walls, world, rooms, spawn };
}

// 出生点是否落在任一房间内壁内
export function spawnInRooms(spawn, rooms) {
  if (!spawn || !rooms?.length) return false;
  return rooms.some(rm => spawn.x >= rm.x && spawn.x <= rm.x + rm.w
    && spawn.y >= rm.y && spawn.y <= rm.y + rm.h);
}

// 计算一个坐标点落在哪个箱庭房间，并返回该房间四个边缘的通道开口几何。
// 返回 null（非多箱庭 / 不在任何房间内）；否则 { c, r, x, y, w, h, passages: [{ edge, cx, cy, w, rotation, roadLen }] }。
// 门应放置在通道开口中心 (cx, cy)，w=开口宽度（门长），rotation=-90（左右开口/竖直门）或 0（上下开口/水平门）。
export function roomPassagesForPoint(layout, x, y) {
  if (!layout || layout.mode !== 'multi' || !Array.isArray(layout.cells) || !layout.cells.length) return null;
  const { rooms } = generateRoomLayout(layout);
  const room = rooms.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (!room) return null;

  // generateRoomLayout 内部先把格子平移到最小格为原点，rooms 的 c/r 是平移后的坐标；此处用同款偏移做邻接判定
  const minC = Math.min(...layout.cells.map(cell => cell.c), 0);
  const minR = Math.min(...layout.cells.map(cell => cell.r), 0);
  const cells = layout.cells.map(cell => ({ c: cell.c - minC, r: cell.r - minR, size: cell.size }));
  const has = (c, r) => cells.some(cell => cell.c === c && cell.r === r);
  const nbSize = (c, r) => (cells.find(cell => cell.c === c && cell.r === r)?.size) || room.w;
  const eff = size => Math.max(8, Math.min(layout.roadWidth, room.w - 16, size - 16));
  const cx = room.x + room.w / 2, cy = room.y + room.h / 2;
  const roadLen = layout.roadLength || 0;
  const passages = [];
  if (has(room.c - 1, room.r)) passages.push({ edge: 'left', cx: room.x, cy, w: eff(nbSize(room.c - 1, room.r)), rotation: -90, roadLen });
  if (has(room.c + 1, room.r)) passages.push({ edge: 'right', cx: room.x + room.w, cy, w: eff(nbSize(room.c + 1, room.r)), rotation: -90, roadLen });
  if (has(room.c, room.r - 1)) passages.push({ edge: 'top', cx, cy: room.y, w: eff(nbSize(room.c, room.r - 1)), rotation: 0, roadLen });
  if (has(room.c, room.r + 1)) passages.push({ edge: 'bottom', cx, cy: room.y + room.h, w: eff(nbSize(room.c, room.r + 1)), rotation: 0, roadLen });
  return { c: room.c, r: room.r, x: room.x, y: room.y, w: room.w, h: room.h, passages };
}

// 判定门实体是否位于某个通道开口上（方向一致 + 中心对齐 + 落在道路走廊内）
export function isGateOnPassage(g, p) {
  const rot = ((Math.round(g.rotation || 0) % 180) + 180) % 180;
  const vertical = rot === 90;
  const wantVertical = p.edge === 'left' || p.edge === 'right';
  if (vertical !== wantVertical) return false;
  // across 是「垂直门/水平门沿通道法线方向的容差」：只允许门中心贴近本房间自己的开口，
  // 不能蹭到相邻箱庭房间另一端的开口（那个位置距本开口约 roadLen，原逻辑把 roadLen 当容差导致误配）。
  // 取门自身进深 + 墙厚 + 余量，钳制在 [120,200]，仍远小于房间/走廊间距。
  const across = Math.max(120, Math.min(200, (g.h || 45) + 80));
  if (wantVertical) return Math.abs(g.y - p.cy) <= p.w / 2 + 30 && Math.abs(g.x - p.cx) <= across;
  return Math.abs(g.x - p.cx) <= p.w / 2 + 30 && Math.abs(g.y - p.cy) <= across;
}
