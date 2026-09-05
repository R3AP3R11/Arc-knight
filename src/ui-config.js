import { saveUi } from './api.js';
import { setStatus } from './ui.js';
import { initUIEditor, getUIEditor } from './ui-editor.js';

const BINDING_OPTIONS = ['', 'hpRatio', 'hpText', 'shieldRatio', 'shieldText', 'expRatio', 'gold', 'level', 'kills', 'weaponLevel'];

const NEW_NODE = {
  text: { type: 'text', size: 24, color: '#eaf4fb' },
  bar: { type: 'bar', x: 0, y: 0, w: 200, h: 16, fill: '#e84c5e', bg: '#3a1f2b' },
  panel: { type: 'panel', x: 0, y: 0, w: 200, h: 120 },
  icon: { type: 'icon', kind: 'coin', x: 0, y: 0, r: 16 },
  button: { type: 'button', x: 0, y: 0, w: 120, h: 48 },
  shape: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 200, h: 40, fill: '#e84c5e' },
  poly: { type: 'shape', kind: 'poly', x: 120, y: 120, fill: '#4fc3f7', stroke: '#2f5a7a', lineWidth: 2, points: [{ x: 0, y: 0 }, { x: 130, y: 0 }, { x: 130, y: 90 }, { x: 65, y: 140 }, { x: 0, y: 90 }] },
  image: { type: 'image', x: 0, y: 0, w: 80, h: 80, src: '/logo.svg' }
};

function applyPath(obj, parts, val) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

function hoverFields(node) {
  const h = node.interact?.hover || {};
  return `<fieldset class="ui-interact"><legend>悬停交互 (hover)</legend>
    ${colorField('悬停填充', 'interact.hover.fill', h.fill)}
    ${colorField('悬停描边', 'interact.hover.stroke', h.stroke)}
    ${numberField('X偏移', 'interact.hover.dx', h.dx)}
    ${numberField('Y偏移', 'interact.hover.dy', h.dy)}
    ${numberField('缩放', 'interact.hover.scale', h.scale)}
    ${numberField('透明度', 'interact.hover.alpha', h.alpha)}
    ${numberField('时长ms', 'interact.hover.animMs', h.animMs)}
  </fieldset>`;
}

function polyEditor(node) {
  if (!Array.isArray(node.points)) return `<p class="hint">请先添加顶点</p>`;
  const rows = node.points.map((pt, i) => `
    <div class="poly-point"><span>P${i}</span>
      <input data-key="points.${i}.x" type="number" value="${pt.x}">
      <input data-key="points.${i}.y" type="number" value="${pt.y}">
      <button class="ui-pt-del" data-ptdel="${i}" type="button">删</button>
    </div>`).join('');
  return `<fieldset class="ui-poly"><legend>顶点（相对节点原点）</legend>${rows}
    <button class="ui-pt-add" type="button">+ 添加顶点</button></fieldset>`;
}

function numberField(label, key, value) {
  return `<label>${label}<input data-key="${key}" type="number" value="${value ?? ''}"></label>`;
}

function colorField(label, key, value) {
  return `<label>${label}<input data-key="${key}" type="color" value="${value || '#ffffff'}"></label>`;
}

function textField(label, key, value) {
  return `<label>${label}<input data-key="${key}" type="text" value="${value ?? ''}"></label>`;
}

function selectField(label, key, value, options = BINDING_OPTIONS) {
  const opts = options.map(o =>
    `<option value="${o}" ${o === value ? 'selected' : ''}>${o || '（无绑定）'}</option>`
  ).join('');
  return `<label>${label}<select data-key="${key}">${opts}</select></label>`;
}

function nodeFields(node) {
  const common = [numberField('X', 'x', node.x), numberField('Y', 'y', node.y), hoverFields(node)];

  switch (node.type) {
    case 'panel':
      return common.concat([
        numberField('宽', 'w', node.w),
        numberField('高', 'h', node.h),
        colorField('填充', 'fill', node.fill),
        colorField('描边', 'stroke', node.stroke)
      ]);
    case 'bar':
      return common.concat([
        numberField('宽', 'w', node.w),
        numberField('高', 'h', node.h),
        colorField('填充', 'fill', node.fill),
        colorField('底槽', 'bg', node.bg),
        selectField('比例绑定', 'bindRatio', node.bind?.ratio || '')
      ]);
    case 'text':
      return common.concat([
        numberField('字号', 'size', node.size),
        colorField('颜色', 'color', node.color),
        textField('静态文本', 'text', node.text),
        selectField('文本绑定', 'bindText', node.bind?.text || '')
      ]);
    case 'icon':
      return common.concat([
        numberField('半径', 'r', node.r),
        colorField('颜色', 'fill', node.fill)
      ]);
    case 'button':
      return common.concat([
        numberField('宽', 'w', node.w),
        numberField('高', 'h', node.h),
        colorField('填充', 'fill', node.fill),
        textField('标签', 'label', node.label)
      ]);
    case 'shape':
      return common.concat([
        selectField('形状', 'kind', node.kind || 'rect', ['rect', 'parallelogram', 'ring', 'arc', 'poly']),
        colorField('填充', 'fill', node.fill),
        ...(node.kind === 'poly'
          ? [polyEditor(node)]
          : node.kind === 'parallelogram'
            ? [numberField('宽', 'w', node.w), numberField('高', 'h', node.h), numberField('倾斜', 'skew', node.skew)]
            : node.kind === 'ring'
              ? [numberField('半径', 'r', node.r), numberField('环厚', 'thickness', node.thickness)]
              : node.kind === 'arc'
                ? [numberField('半径', 'r', node.r), numberField('环厚', 'thickness', node.thickness),
                   numberField('起始角°', 'start', node.start), numberField('扫过角°', 'sweep', node.sweep)]
                : [numberField('宽', 'w', node.w), numberField('高', 'h', node.h), numberField('圆角', 'radius', node.radius)])
      ]);
    case 'image':
      return common.concat([
        textField('图片路径', 'src', node.src),
        numberField('宽', 'w', node.w),
        numberField('高', 'h', node.h),
        numberField('旋转角度°', 'angle', node.angle)
      ]);
    default:
      return common;
  }
}

function nodeRow(node, index) {
  return `<div class="ui-node" data-node="${index}">
    <div class="ui-node-head">
      <strong>${node.id}</strong> <em>${node.type}</em>
      <label class="inline"><input data-key="visible" type="checkbox" ${node.visible !== false ? 'checked' : ''}> 显示</label>
      <button class="ui-node-del" data-del="${index}">删除</button>
    </div>
    <div class="ui-node-body">${nodeFields(node).join('')}</div>
  </div>`;
}

function placeNodeAt(dom, state, pos) {
  const graph = state.ui[dom.uiGraphSelect.value];
  if (!graph) return;
  const type = dom.uiNodeType.value;
  const base = NEW_NODE[type] || NEW_NODE.text;
  const node = { id: `${graph.id}-${Date.now()}`, ...base };
  node.x = Math.round(pos.x);
  node.y = Math.round(pos.y);
  graph.nodes.push(node);
  renderUIConfigPage(dom, state);
  getUIEditor()?.selectIndex(graph.nodes.length - 1);
}

function markDirty(dom) {
  setStatus(dom, 'UI 已修改，建议保存');
}

export function renderUIConfigPage(dom, state) {
  const graph = state.ui[dom.uiGraphSelect.value] || { nodes: [] };
  dom.uiNodeList.innerHTML = graph.nodes.map(nodeRow).join('');

  const editor = initUIEditor(dom, state, {
    onPlaceEmpty: pos => placeNodeAt(dom, state, pos),
    onDirty: () => markDirty(dom)
  });
  editor.setNodeListEl(dom.uiNodeList);
  editor.render();

  dom.uiNodeList.querySelectorAll('.ui-node').forEach(el => {
    const index = Number(el.dataset.node);
    const node = graph.nodes[index];

    el.addEventListener('click', e => {
      if (e.target.closest('input') || e.target.closest('select') || e.target.closest('.ui-node-del')) return;
      editor.selectIndex(index);
    });

    el.querySelectorAll('[data-key]').forEach(input => {
      input.oninput = () => {
        const key = input.dataset.key;
        if (key === 'kind') {
          node.kind = input.value;
          if (node.kind === 'poly' && !Array.isArray(node.points)) node.points = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 80 }, { x: 0, y: 80 }];
          renderUIConfigPage(dom, state);
          return;
        }
        if (key === 'visible') { node.visible = input.checked; editor.render(); return; }
        if (key === 'bindRatio') { node.bind = { ...(node.bind || {}), ratio: input.value || undefined }; editor.render(); return; }
        if (key === 'bindText') { node.bind = { ...(node.bind || {}), text: input.value || undefined }; editor.render(); return; }
        if (key.startsWith('interact.')) { applyPath(node, key.split('.'), input.type === 'number' ? Number(input.value) : input.value); editor.render(); return; }
        if (key.startsWith('points.')) { applyPath(node, key.split('.'), Number(input.value)); editor.render(); return; }
        node[key] = input.type === 'number' ? Number(input.value) : input.value;
        editor.render();
      };
    });

    el.querySelectorAll('.ui-pt-del').forEach(btn => {
      btn.onclick = () => { node.points.splice(Number(btn.dataset.ptdel), 1); renderUIConfigPage(dom, state); };
    });
    const ptAdd = el.querySelector('.ui-pt-add');
    if (ptAdd) ptAdd.onclick = () => { if (!Array.isArray(node.points)) node.points = []; node.points.push({ x: 0, y: 0 }); renderUIConfigPage(dom, state); };

    el.querySelector('.ui-node-del').onclick = () => {
      if (editor.selectedIndex === index) editor.reset();
      graph.nodes.splice(index, 1);
      renderUIConfigPage(dom, state);
    };
  });
}

export function addUINode(dom, state) {
  const graph = state.ui[dom.uiGraphSelect.value];
  if (!graph) return;
  const type = dom.uiNodeType.value;
  const base = NEW_NODE[type] || NEW_NODE.text;
  graph.nodes.push({ id: `${graph.id}-${Date.now()}`, ...base });
  renderUIConfigPage(dom, state);
  getUIEditor()?.selectIndex(graph.nodes.length - 1);
}

export async function saveUIConfigPage(dom, state) {
  const id = dom.uiGraphSelect.value;
  await saveUi(id, state.ui[id]);
}
