/**
 * 敌人掉落规则面板。
 * 职责：按敌人类型渲染掉落规则列表（种类/数量/概率），并绑定增删改事件与静默落盘。
 * 分类：数值经济
 * 导出：renderDropRules, bindDropRules
 */
import { ENEMY_TYPES, DROP_ITEMS } from '../state.js';
import { saveDraft } from '../api.js';
import { setStatus } from '../ui.js';
import { ctx } from './context.js';
import { pushUndo } from './history.js';
import { loadInnerShop, getPotionList } from '../systems/economy/inner-shop.js';

const { state } = ctx;

// 药水列表首次渲染时若尚未加载 → 请求一次并重渲染（模块级 flag 防重入）
let potionsRequested = false;

// ── 渲染 ──
export function renderDropRules() {
  const dom = ctx.dom;
  const rules = state.level.dropRules || {};
  if (!getPotionList().length && !potionsRequested) {
    potionsRequested = true;
    loadInnerShop().then(() => renderDropRules());
  }
  dom.dropRulesEditor.innerHTML = Object.entries(ENEMY_TYPES).map(([type, t]) => {
    const list = Array.isArray(rules[type]) ? rules[type] : [];
    const rows = list.map((rule, i) => `
      <div class="drop-rule">
        <select data-drop-type="${type}" data-drop-index="${i}" data-drop-field="item">
          ${Object.entries(DROP_ITEMS).map(([k, name]) =>
            `<option value="${k}" ${rule.item === k ? 'selected' : ''}>${name}</option>`).join('')}
        </select>
        ${rule.item === 'potion' ? `
        <select data-drop-type="${type}" data-drop-index="${i}" data-drop-field="potionId" title="药水">
          <option value="">（随机药水）</option>
          ${getPotionList().map(c =>
            `<option value="${c.id}" ${(rule.potionId || '') === String(c.id) ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>` : ''}
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

// ── 事件绑定 ──
export function bindDropRules() {
  const dom = ctx.dom;
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
    if (field === 'item' || field === 'potionId') return;
    const value = Math.max(0, Math.floor(Number(el.value) || 0));
    rule[field] = field === 'chance' ? Math.min(100, value) : value;
    saveQuiet();
  });

  dom.dropRulesEditor.addEventListener('change', e => {
    const el = e.target;
    const field = el.dataset.dropField;
    if (!field || el.type === 'number') return;
    const rule = rulesOf(el.dataset.dropType)[Number(el.dataset.dropIndex)];
    if (rule) {
      if (field === 'potionId') {
        rule.potionId = el.value;
      } else {
        rule.item = el.value;
        // 切离 potion 时清空 potionId，保持落盘干净；同时重渲染以显隐药水下拉
        if (rule.item !== 'potion') rule.potionId = '';
        renderDropRules();
      }
    }
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
