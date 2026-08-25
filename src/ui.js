import { WEAPON_LABELS } from './state.js';

const ids = [
  'status', 'editorPanel', 'backgroundColor', 'gridColor', 'showGridInPlay', 'showGridInEditor',
  'bgImage', 'bgRemove', 'levelImage',
  'worldWidth', 'worldHeight', 'cameraWidth', 'cameraMode',
  'draftStatus', 'selection', 'entity-properties', 'entity-title', 'entity-fields',
  'levelList', 'template',
  'applyTemplate', 'editorMode', 'playMode', 'trialPlay',
  'save', 'load', 'newLevel', 'copyLevel', 'deleteLevel',
  'export', 'import', 'game',
  'uiConfig', 'uiConfigPage', 'uiConfigBack', 'uiGraphSelect', 'uiNodeType',
  'uiNodeAdd', 'uiConfigSave', 'uiNodeList', 'uiPreviewCanvas', 'levelUi', 'dropRulesEditor',
  'roomPanel', 'roomCols', 'roomRows', 'roomThickness', 'roomWallColor', 'roomRoadWidth', 'roomRoadLength', 'roomGrid',
  'roomCellPopup', 'roomCellPopupTitle', 'roomCellPopupClose', 'roomCellSize',
  'pvLevel', 'pvExp', 'pvPoints', 'pvGold', 'pvCharge', 'pvWeapons', 'pvMods',
  'pvMoveSpeed', 'pvAttackPower', 'pvCritRate', 'pvAttackSpeed',
  'pvMaxHp', 'pvMaxShield', 'pvDamageReduction', 'pvDodgeRate',
  'tpLevel', 'tpExp', 'tpPoints', 'tpGold', 'tpCharge', 'tpWeapons', 'tpMods',
  'tpMoveSpeed', 'tpAttackPower', 'tpCritRate', 'tpAttackSpeed',
  'tpMaxHp', 'tpMaxShield', 'tpDamageReduction', 'tpDodgeRate',
  'tpSlot', 'tpSave', 'tpReload'
];

export function getDom() {
  const dom = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  const missing = ids.filter(id => !dom[id]);
  if (missing.length) throw new Error(`Missing DOM elements: ${missing.join(', ')}`);

  dom.entityProperties = dom['entity-properties'];
  dom.entityTitle = dom['entity-title'];
  dom.entityFields = dom['entity-fields'];
  dom.tools = [...document.querySelectorAll('.tool')];

  return dom;
}

export function setStatus(dom, message, error = false) {
  dom.status.textContent = message;
  dom.status.classList.toggle('error', error);
}

export function renderLevels(dom, levels) {
  const currentLevel = dom.levelList.value;
  const options = levels.map(id => `<option value="${id}">${id}</option>`).join('');

  dom.levelList.innerHTML = options;
  dom.levelList.value = levels.includes(currentLevel) ? currentLevel : levels[0] || '';
}

// 预览玩家数据：武器列表 UI 渲染（targetId 用于区分预览面板/试玩面板）
export function renderPreviewWeapons(dom, assets, targetId = 'pvWeapons') {
  dom[targetId].innerHTML = Object.entries(assets)
    .map(([id, w]) => {
      const enhanceChecks = [0, 1, 2]
        .map(i => `<label class="checkbox inline"><input type="checkbox" data-w="${id}" data-e="${i}" ${w.enhance[i] ? 'checked' : ''}/> 强化${i + 1}</label>`)
        .join('');
      return `<div class="pv-weapon-row">
        <label class="checkbox inline"><input type="checkbox" data-w="${id}" data-u="1" ${w.unlocked ? 'checked' : ''}/> 已解锁</label>
        <strong>${id}</strong>
        ${enhanceChecks}
      </div>`;
    })
    .join('');
}

export function renderPreviewMods(dom, mods, modDefs, targetId = 'pvMods') {
  const equipped = new Set((mods || []).map(m => m.id));
  dom[targetId].innerHTML = Object.entries(modDefs)
    .map(([id, def]) => {
      const tag = def.weapon ? `专属·${WEAPON_LABELS[def.weapon] || def.weapon}` : '通用';
      return `<div class="pv-weapon-row">
        <label class="checkbox inline"><input type="checkbox" data-mod="${id}" ${equipped.has(id) ? 'checked' : ''}/> ${def.name}</label>
        <span class="hint">${tag}</span>
      </div>`;
    })
    .join('');
}
