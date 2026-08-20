import { saveUi } from './api.js';
import { renderUIPreview } from './ui-preview.js';

const BINDING_OPTIONS = ['', 'hpRatio', 'hpText', 'shieldRatio', 'shieldText', 'expRatio', 'gold', 'level', 'kills', 'weaponLevel'];

const NEW_NODE = {
  text: { type: 'text', size: 24, color: '#eaf4fb' },
  bar: { type: 'bar', x: 0, y: 0, w: 200, h: 16, fill: '#e84c5e', bg: '#3a1f2b' },
  panel: { type: 'panel', x: 0, y: 0, w: 200, h: 120 },
  icon: { type: 'icon', kind: 'coin', x: 0, y: 0, r: 16 },
  button: { type: 'button', x: 0, y: 0, w: 120, h: 48 },
  shape: { type: 'shape', kind: 'rect', x: 0, y: 0, w: 200, h: 40, fill: '#e84c5e' },
  image: { type: 'image', x: 0, y: 0, w: 80, h: 80, src: '/logo.svg' }
};

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
  const common = [numberField('X', 'x', node.x), numberField('Y', 'y', node.y)];

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
        selectField('形状', 'kind', node.kind || 'rect', ['rect', 'parallelogram', 'ring', 'arc']),
        colorField('填充', 'fill', node.fill),
        ...(node.kind === 'parallelogram'
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

export function renderUIConfigPage(dom, state) {
  const graph = state.ui[dom.uiGraphSelect.value] || { nodes: [] };
  dom.uiNodeList.innerHTML = graph.nodes.map(nodeRow).join('');
  renderUIPreview(dom.uiPreviewCanvas, graph);

  dom.uiNodeList.querySelectorAll('.ui-node').forEach(el => {
    const index = Number(el.dataset.node);
    const node = graph.nodes[index];

    el.querySelectorAll('[data-key]').forEach(input => {
      input.oninput = () => {
        const key = input.dataset.key;
        if (key === 'kind') {
          node.kind = input.value;
          renderUIConfigPage(dom, state);
          return;
        }
        if (key === 'visible') { node.visible = input.checked; renderUIPreview(dom.uiPreviewCanvas, graph); return; }
        if (key === 'bindRatio') { node.bind = { ...(node.bind || {}), ratio: input.value || undefined }; renderUIPreview(dom.uiPreviewCanvas, graph); return; }
        if (key === 'bindText') { node.bind = { ...(node.bind || {}), text: input.value || undefined }; renderUIPreview(dom.uiPreviewCanvas, graph); return; }
        node[key] = input.type === 'number' ? Number(input.value) : input.value;
        renderUIPreview(dom.uiPreviewCanvas, graph);
      };
    });

    el.querySelector('.ui-node-del').onclick = () => {
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
}

export async function saveUIConfigPage(dom, state) {
  const id = dom.uiGraphSelect.value;
  await saveUi(id, state.ui[id]);
}
