const ids = [
  'status', 'editorPanel', 'backgroundColor', 'gridColor', 'showGridInPlay', 'showGridInEditor',
  'bgImage', 'bgRemove',
  'worldWidth', 'worldHeight', 'cameraWidth',
  'draftStatus', 'selection', 'entity-properties', 'entity-title', 'entity-fields',
  'levelList', 'flowType', 'flowStart', 'flowAdd', 'flowList', 'template',
  'applyTemplate', 'editorMode', 'playMode', 'flowPlay', 'tutorialPlay',
  'save', 'load', 'newLevel', 'copyLevel', 'deleteLevel',
  'addFlow', 'saveFlow', 'previewFlow', 'export', 'import', 'game',
  'uiConfig', 'uiConfigPage', 'uiConfigBack', 'uiGraphSelect', 'uiNodeType',
  'uiNodeAdd', 'uiConfigSave', 'uiNodeList', 'uiPreviewCanvas', 'levelUi'
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

export function renderLevels(dom, levels, flow, type = 'game') {
  const currentLevel = dom.levelList.value;
  const options = levels.map(id => `<option value="${id}">${id}</option>`).join('');

  dom.levelList.innerHTML = options;
  dom.flowStart.innerHTML = flow.nodes.map(node => `<option value="${node.id}">${node.target}</option>`).join('');
  dom.flowAdd.innerHTML = options;
  dom.flowStart.value = flow.entry || flow.nodes[0]?.id || '';
  dom.flowList.innerHTML = flow.nodes.map((node, i) =>
    `<div>${i + 1}. ${node.target} <button data-flow="${i}" data-id="${node.id}">删除</button></div>`
  ).join('');
  dom.levelList.value = levels.includes(currentLevel) ? currentLevel : levels[0] || '';
}
