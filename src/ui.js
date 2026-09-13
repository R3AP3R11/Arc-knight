import { WEAPON_LABELS, ITEM_DEFS } from './state.js';
import { weaponCatalog } from './player-data.js';
import { getWeaponDef } from './systems/art/weapon-store.js';
import { listPetDefs } from './systems/art/pet-store.js';

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
  'roomCellPopup', 'roomCellPopupTitle', 'roomCellPopupClose', 'roomCellSize', 'roomCellType', 'roomCellMarkerType', 'roomCellMarkerIcon',
  'pvLevel', 'pvExp', 'pvPoints', 'pvGold', 'pvWeapons', 'pvMods', 'pvPets',
  'pvMoveSpeed', 'pvAttackPower', 'pvCritRate', 'pvAttackSpeed',
  'pvMaxHp', 'pvMaxShield', 'pvDamageReduction', 'pvDodgeRate',
  'tpLevel', 'tpExp', 'tpPoints', 'tpGold', 'tpWeapons', 'tpMods', 'tpPets',
  'tpMoveSpeed', 'tpAttackPower', 'tpCritRate', 'tpAttackSpeed',
  'tpMaxHp', 'tpMaxShield', 'tpDamageReduction', 'tpDodgeRate',
  'tpSlot', 'tpSave', 'tpReload',
  'artboard', 'artboardPage', 'artboardBack', 'artAssetSelect', 'artNew', 'artSave',
  'artElementList', 'artElementAdd', 'artPreviewCanvas', 'artboardName', 'artDraw', 'artBgColor',
  'artCopySelect', 'artCopyOther', 'artDrawBoard', 'artGenDefaults',
  'drawBoardCanvas', 'drawSnap', 'drawUndo', 'drawClear', 'drawCancel', 'drawDone',
  'drawToolAdd', 'drawToolSelect', 'drawToolFill', 'drawColor', 'drawLineWidth', 'drawFillColor',
  'drawInsertShape', 'drawRefRadius', 'drawRefSides', 'drawRefArcDeg', 'drawRefUnderlay', 'drawRefToPoints',
  'drawRefOutline', 'drawRefOutlineUnderlay', 'drawRefOutlineToPoints', 'drawRefOutlineDelete', 'drawRefClear',
  'drawSelX', 'drawSelY', 'drawDelPoint', 'drawRotateDeg', 'drawScalePct', 'drawApplyTransform',
  'drawOutlineName', 'drawSaveOutline', 'artOutlineSelect', 'artAddOutline', 'artDeleteOutline',
  'artPixelSelect', 'artAddPixel', 'artDeletePixel',
  'pixelBoard', 'pixelBoardCanvas', 'pixelCols', 'pixelRows', 'pixelApplySize', 'pixelCellSize',
  'pixelBgColor', 'pixelGridColor', 'pixelShowGrid', 'pixelColor', 'pixelEraser', 'pixelFillAll',
  'pixelUndo', 'pixelRotateDeg', 'pixelApplyRotate', 'pixelName', 'pixelSave', 'pixelSaveLibrary', 'pixelCancel',
  'pixelDone', 'pixelSnapGrid', 'artPixel',
  'weaponBoard', 'weaponPage', 'weaponBack', 'weaponName', 'weaponSelect', 'weaponNew',
  'weaponTemplate', 'weaponSave', 'weaponForm', 'weaponPreviewCanvas',
  'petBoard', 'petPage', 'petBack', 'petName', 'petSelect', 'petNew', 'petSave', 'petForm', 'petHint',
  'uilibrary', 'uilibraryPage', 'uilibraryBack', 'uilibraryList', 'uilibraryCanvas',
  'uilibraryForm', 'uilibraryHover', 'uilibraryHint',
  'wireframe', 'wireframePage', 'wireframeBack', 'wireframeName', 'wireframeImport',
  'wireframeSave', 'wireframeStatus', 'wireframeXml', 'wireframeList', 'wireframeNote', 'wireframeCanvas',
  'wireframeSelect', 'wireframeLoad', 'wireframeRefresh', 'wireframeDelete',
  'wireframePageSel', 'wireframePageImport',
  'cinematic', 'cinematicsPage', 'cinematicBack', 'cinematicName', 'cinematicSelect', 'cinematicNew',
  'cinematicSave', 'cinematicSetAnchor', 'cinematicDelete', 'cinematicPlay', 'cinematicStop',
  'cinematicDuration', 'cinematicTimeScale', 'cinematicFocus', 'cinematicBlackHold',
  'cinematicDeathFlag', 'cinematicKeyframes', 'cinematicAddKeyframe',
  'cinematicRefs', 'cinematicAddRef', 'cinematicPreviewCanvas'
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
  dom[targetId].innerHTML = weaponCatalog().map(id => {
    const w = (assets && assets[id]) || { unlocked: false, enhance: [0, 0, 0] };
    const enhanceChecks = [0, 1, 2]
      .map(i => `<label class="checkbox inline"><input type="checkbox" data-w="${id}" data-e="${i}" ${w.enhance[i] ? 'checked' : ''}/> 强化${i + 1}</label>`)
      .join('');
    return `<div class="pv-weapon-row">
      <label class="checkbox inline"><input type="checkbox" data-w="${id}" data-u="1" ${w.unlocked ? 'checked' : ''}/> 已解锁</label>
      <strong>${getWeaponDef(id)?.name || WEAPON_LABELS[id] || id}</strong>
      ${enhanceChecks}
    </div>`;
  }).join('');
}

export function renderPreviewMods(dom, items, modDefs, targetId = 'pvMods') {
  const stacks = (items && items.stacks) || {};
  const uniques = (items && items.uniques) || [];
  const ownedUnique = new Set(uniques.map(u => u.itemId));
  dom[targetId].innerHTML = Object.entries(modDefs)
    .map(([id, def]) => {
      const tag = def.weapon ? `专属·${getWeaponDef(def.weapon)?.name || WEAPON_LABELS[def.weapon] || def.weapon}` : '通用';
      // 专属改件：每种最多 1 个（进 items.uniques）；通用改件：数量无上限（进 items.stacks）
      if (def.weapon) {
        const checked = ownedUnique.has(id) ? 'checked' : '';
        return `<div class="pv-weapon-row">
          <label class="checkbox inline"><input type="checkbox" data-own="${id}" ${checked}/> ${def.name}</label>
          <span class="hint">${tag}</span>
        </div>`;
      }
      const count = stacks[id] || 0;
      return `<div class="pv-weapon-row">
        <span>${def.name}</span>
        <input type="number" min="0" step="1" value="${count}" data-own="${id}"/>
        <span class="hint">${tag}</span>
      </div>`;
    })
    .join('');
}

// 玩家数据面板：宠物「拥有 / 装备」配置（拥有进 items.uniques，装备进 equipment.pets 上限2）
export function renderPreviewPets(dom, player, targetId, prefix = 'pv') {
  const owned = new Set((player.items?.uniques || []).map(u => u.itemId));
  const equipped = Array.isArray(player.equipment?.pets) ? player.equipment.pets : [];
  dom[targetId].innerHTML = listPetDefs().map(def => {
    const id = def.id;
    const desc = ITEM_DEFS[id]?.effect || '';
    return `<div class="pv-weapon-row">
      <label class="checkbox inline"><input type="checkbox" data-${prefix}-pet-own="${id}" ${owned.has(id) ? 'checked' : ''}/> 拥有</label>
      <label class="checkbox inline"><input type="checkbox" data-${prefix}-pet-eq="${id}" ${equipped.includes(id) ? 'checked' : ''}/> 装备</label>
      <strong>${def.name}</strong>
      <span class="hint">${desc}</span>
    </div>`;
  }).join('');
}
