/**
 * 关卡敌人默认数值面板（关卡级兜底）。
 * 职责：按敌人类型配置本关卡兜底的血量/伤害/尺寸倍率——触发器波次未配置时套用，
 *       波次与关卡都未配置则用 ENEMY_TYPES / ENEMY_BEHAVIOR 全局默认；留空 = 未配置（不落盘该键）。
 * 分类：关卡设计
 * 导出：renderEnemyDefaults, bindEnemyDefaults
 */
import { ENEMY_TYPES } from '../state.js';
import { saveDraft } from '../api.js';
import { setStatus } from '../ui.js';
import { ctx } from './context.js';
import { pushUndo } from './history.js';

const { state } = ctx;

// [字段, 标签, 步长, 最小值文案]
const FIELDS = [
  ['hp', '血量', '1'],
  ['damage', '伤害', '1'],
  ['scale', '尺寸倍率', '0.1']
];

// ── 渲染 ──
export function renderEnemyDefaults() {
  const dom = ctx.dom;
  const defaults = state.level.enemyDefaults || {};
  dom.enemyDefaultsEditor.innerHTML = Object.entries(ENEMY_TYPES).map(([type, t]) => {
    const d = defaults[type] || {};
    const fields = FIELDS.map(([key, label, step]) => `
        <label>${label}
          <input type="number" min="0" step="${step}" data-ed-type="${type}" data-ed-field="${key}"
                 value="${d[key] ?? ''}" placeholder="未配置"/>
        </label>`).join('');
    return `<div class="drop-rule-group">
      <div class="drop-rule-head"><span>${t.name}</span><span class="drop-unit">默认 ${t.hp} HP / ${t.damage} 伤害 / ×1</span></div>
      <div class="drop-rule">${fields}</div>
    </div>`;
  }).join('');
}

// ── 事件绑定 ──
export function bindEnemyDefaults() {
  const dom = ctx.dom;
  const saveQuiet = () => saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));

  dom.enemyDefaultsEditor.addEventListener('focusin', e => {
    if (e.target.matches('input')) pushUndo();
  });

  dom.enemyDefaultsEditor.addEventListener('input', e => {
    const el = e.target;
    const type = el.dataset.edType;
    const field = el.dataset.edField;
    if (!type || !field) return;
    const map = state.level.enemyDefaults || (state.level.enemyDefaults = {});
    const entry = map[type] || (map[type] = {});
    const raw = String(el.value ?? '').trim();
    if (raw === '') {
      delete entry[field];
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      if (field === 'damage') {
        if (n >= 0) entry.damage = n; else delete entry.damage;
      } else if (n > 0) {
        entry[field] = n;
      } else {
        delete entry[field];
      }
    }
    if (!Object.keys(entry).length) delete map[type];
    saveQuiet();
  });
}
