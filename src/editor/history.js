/**
 * 编辑器撤销栈与剪贴板。
 * 职责：Ctrl+Z 撤销快照栈（pushUndo/undo）、实体归类与 Ctrl+C/Ctrl+V 复制粘贴。
 * 分类：引擎编辑器需求
 * 导出：pushUndo, undo, copySelected, pasteClipboard, entityKind
 */
import { clone, normalizeLevel } from '../state.js';
import { saveFormal } from '../api.js';
import { setStatus } from '../ui.js';
import { ctx } from './context.js';

const { state } = ctx;

// ── 撤销栈 ──
const MAX_UNDO = 60;
const undoStack = [];

export function pushUndo() {
  undoStack.push(clone(state.level));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) { setStatus(ctx.dom, '没有可回退的操作'); return; }
  // 跳过无变化的快照（例如仅点击选择、未实际修改）
  if (JSON.stringify(prev) === JSON.stringify(state.level)) { undo(); return; }
  state.level = normalizeLevel(prev);
  state.selected = null;
  state.game?.scene.scenes[0]?.draw?.();
  ctx.hooks.sync();
  saveFormal(state.levelId, state.level).catch(() => setStatus(ctx.dom, '保存失败', true));
}

// ── 实体归类 ──
export function entityKind(l, entity) {
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

// ── 复制 / 粘贴 ──
let clipboard = null;

const COPY_ID_PREFIX = {
  walls: 'wall', enemies: 'enemy', triggers: 'trigger', crates: 'crate',
  barrels: 'barrel', chests: 'chest', images: 'image', spawnZones: 'spawnzone',
  gates: 'gate', vendors: 'vendor', idols: 'idol', icons: 'icon', portals: 'portal'
};

export function copySelected() {
  const entity = state.selected;
  if (!entity) { setStatus(ctx.dom, '未选择实体'); return; }
  const kind = entityKind(state.level, entity);
  if (!kind) { setStatus(ctx.dom, '该实体不可复制'); return; }
  clipboard = { kind, data: clone(entity) };
  setStatus(ctx.dom, '已复制');
}

export function pasteClipboard() {
  if (!clipboard) { setStatus(ctx.dom, '剪贴板为空'); return; }
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
  ctx.hooks.redraw();
  setStatus(ctx.dom, '已粘贴');
}
