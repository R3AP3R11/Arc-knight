/**
 * 编辑器共享上下文。
 * 职责：承载原先 main.js 的模块级共享状态（W/H/state/PACKAGED/dom/编辑器快照/图标素材/房间弹窗格子），
 *       并提供 ctx.hooks 钩子表，用于打破 level-flow 与 history / room-panel / trigger-panel / save-flow 之间的循环依赖。
 * 分类：引擎编辑器需求
 * 导出：ctx
 */
import { createState } from '../state.js';

// ── 画布尺寸与运行环境 ──
const W = 1920, H = 1080;
// 打包/纯游戏端：Electron 通过 ?packaged=1 或 preload 暴露 __APP_PACKAGED__ 标记
const PACKAGED = (() => {
  try {
    return window.__APP_PACKAGED__ === true ||
      new URLSearchParams(window.location.search).get('packaged') === '1';
  } catch { return false; }
})();

// ── 共享上下文对象 ──
export const ctx = {
  W,
  H,
  PACKAGED,
  state: createState(),
  // getDom() 结果，initialize() 时赋值
  dom: null,
  // 进入试玩/预览前的编辑器关卡快照；退出时恢复，保证试玩/预览不改变编辑器关卡数据
  editorSnapshot: null,
  // 进入试玩前的编辑器玩家快照；试玩期间 state.player 切到测试存档，退出时恢复正式玩家内存数据
  editorPlayerSnapshot: null,
  // 「图标」文件夹素材列表（可交互图标下拉选择）
  iconChoices: [],
  // 房间大小弹窗当前编辑的方格
  popupCell: null,
  // 钩子表：由 main.js 统一注册（sync/redraw/renderTriggerEvents/存档开局流程）
  hooks: {}
};
