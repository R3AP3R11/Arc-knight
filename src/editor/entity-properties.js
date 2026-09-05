/**
 * 实体属性面板。
 * 职责：渲染当前选中实体的属性字段表（含出生点/墙体/敌人/触发器/背景/图片/门/区域/售货机/神像/图标/传送门/箱子/油桶/宝箱），
 *       宝箱掉落奖励子编辑器，字段输入绑定（bindEntityFieldInputs），以及嵌套路径读写工具 getNested/setNested。
 * 分类：引擎编辑器需求
 * 导出：getNested, setNested, renderEntityProperties, bindEntityFieldInputs, updateWall
 */
import { SCHEME_WEAPONS, ENEMY_TYPES, DROP_ITEMS, WEAPON_LABELS } from '../state.js';
import { saveDraft } from '../api.js';
import { setStatus } from '../ui.js';
import { ctx } from './context.js';
import { pushUndo } from './history.js';
import { getArtChoices } from '../systems/art/design-store.js';
import { getWeaponDef } from '../systems/art/weapon-store.js';
import { weaponCatalog } from '../player-data.js';

const { state } = ctx;

// ── 嵌套路径读写 ──
export function getNested(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function setNested(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

// ── 墙体快捷修改 ──
export function updateWall(field, value) {
  const wall = state.selected && state.level.walls.includes(state.selected) ? state.selected : null;
  if (!wall) return;

  const number = Number(value);
  if (field !== 'color' && !Number.isFinite(number)) return;

  wall[field] = field === 'color' ? value
    : field === 'w' || field === 'h' ? Math.max(number, 8) : number;
  ctx.hooks.redraw();
}

// ── 属性面板渲染 ──
export function renderEntityProperties() {
  const dom = ctx.dom;
  const entity = state.selected;
  const l = state.level;

  const type = entity === l.spawn ? '玩家出生点'
    : l.walls.includes(entity) ? '墙体'
    : l.enemies.includes(entity) ? '敌人'
    : l.triggers.includes(entity) ? '触发器'
    : l.crates.includes(entity) ? '箱子'
    : l.barrels.includes(entity) ? '油桶'
    : l.chests.includes(entity) ? '宝箱'
    : entity === l.background ? '背景图'
    : l.images.includes(entity) ? '场景图片'
    : (l.spawnZones || []).includes(entity) ? '生成区域'
    : l.gates.includes(entity) ? '能量门'
    : l.vendors.includes(entity) ? '售货机'
    : l.idols.includes(entity) ? '神像'
    : (l.icons || []).includes(entity) ? '可交互图标'
    : (l.portals || []).includes(entity) ? '传送门' : '';

  dom.entityProperties.hidden = state.mode !== 'editor' || !entity;
  dom.entityTitle.textContent = type ? `${type}属性` : '实体属性';
  if (!entity || state.mode !== 'editor') return;

  const schemeOptions = [
    ['default', '默认方案（示例）'],
    ['hex-ring', '基础武器方案'],
    ['yellow', '黄色武器方案'],
    ['green', '绿色武器方案']
  ];
  const enemyTypeOptions = Object.entries(ENEMY_TYPES).map(([k, t]) => [k, t.name]);
  const levelOptions = state.levels.map(id => [id, id]);
  const weaponOptions = [...weaponCatalog().map(id => [id, WEAPON_LABELS[id] || getWeaponDef(id)?.name || id]), ['', '无']];
  const eventTypeOptions = [
    ['complete', '整体通关标记'],
    ['roomComplete', '单房间通关标记'],
    ['combat', '触发战斗'],
    ['spawnEnemy', '召唤敌人'],
    ['switchLevel', '切换关卡'],
    ['spawnGate', '生成能量门'],
    ['removeGate', '消除能量门']
  ];
  const gateOptions = state.level.gates.map((g, i) => [g.id, `${i + 1}. ${g.id}`]);
  const artOptions = [['', '（默认美术）'], ...getArtChoices().map(c => [c.id, c.name])];
  const guideIconOptions = [['', '（实体名称占位）'], ...getArtChoices().map(c => [c.id, c.name])];
  // 游戏内指引字段：勾选「是否游戏内指引」后才显示距离/图标/交互后停止指引
  const guideRows = (e, withStop) => [
    ['guide', '是否游戏内指引', 'boolean'],
    ...(e.guide ? [
      ['guideRange', '指引距离(px)', 'number'],
      ['guideIcon', '指引图标(动态资产)', 'select', guideIconOptions],
      ...(withStop ? [['guideStopAfterUse', '是否交互后停止指引', 'boolean']] : [])
    ] : [])
  ];

  let fields;
  if (entity === l.spawn) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['weapons.0', '武器1', 'select', weaponOptions],
      ['weapons.1', '武器2', 'select', weaponOptions],
      ['weapons.2', '武器3', 'select', weaponOptions],
      ['level', '等级', 'number'],
      ['gold', '金币', 'number']
    ];
  } else if (l.walls.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['shape', '墙体形状', 'select', [['rect', '矩形'], ['circle', '圆形'], ['arc', '弧形']]],
      ['w', '宽度 / 直径', 'number'],
      ['h', '高度', 'number'],
      ['thickness', '弧形厚度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['startAngle', '弧形起始角度', 'number'],
      ['endAngle', '弧形结束角度', 'number'],
      ['color', '颜色', 'color'],
      ['visible', '游戏中显示', 'boolean']
    ];
  } else if (l.enemies.includes(entity)) {
    fields = [
      ['type', '敌人类型', 'select', enemyTypeOptions],
      ['art', '画板美术方案', 'select', artOptions],
      ['hp', '生命值', 'number'],
      ['damage', '伤害值', 'number'],
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number']
    ];
  } else if (l.triggers.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度 / 直径', 'number'],
      ['h', '高度', 'number'],
      ['shape', '几何形状', 'select', [['rect', '矩形'], ['circle', '圆形']]],
      ['color', '编辑器颜色', 'color'],
      ['once', '一次性触发', 'boolean'],
      ['cooldown', '冷却(ms)', 'number'],
      ['visible', '可见', 'boolean']
    ];
  } else if (entity === l.background) {
    if (entity.fx === 'wormhole') {
      fields = [
        ['x', 'X 坐标', 'number'],
        ['y', 'Y 坐标', 'number'],
        ['radius', '半径', 'number'],
        ['rings', '圆环数', 'number'],
        ['orbitCount', '小球数', 'number'],
        ['driftAmp', '漂移幅度', 'number'],
        ['driftSpeed', '漂移速度', 'number'],
        ['yDrift', 'Y 漂移幅度', 'number'],
        ['ySpeed', 'Y 漂移速度', 'number'],
        ['scaleAmp', '缩放幅度', 'number'],
        ['scaleSpeed', '缩放速度', 'number'],
        ['orbitSpeed', '小球转速', 'number'],
        ['introShrink', '入场偏移归零时长', 'number'],
        ['introCamera', '镜头移动时长', 'number'],
        ['introHold', '到位停顿时长', 'number'],
        ['introSlow', '极慢放大时长', 'number'],
        ['introRingCount', '新生成圆环数量', 'number'],
        ['introGrow', '入场放大加速度', 'number'],
        ['introPause', '全黑停顿时长', 'number'],
        ['visible', '可见', 'boolean']
      ];
    } else {
      fields = [
        ['x', 'X 坐标', 'number'],
        ['y', 'Y 坐标', 'number'],
        ['w', '宽度', 'number'],
        ['h', '高度', 'number'],
        ['visible', '可见', 'boolean']
      ];
    }
  } else if (l.images.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['visible', '游戏中显示', 'boolean']
    ];
  } else if (l.gates.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['color1', '外色块颜色', 'color'],
      ['color2', '内色块颜色', 'color'],
      ['label', '门上文字', 'text'],
      ['active', '初始激活', 'boolean'],
      ['visible', '可见', 'boolean']
    ];
  } else if ((l.spawnZones || []).includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['color', '颜色', 'color']
    ];
  } else if (l.vendors.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['interactRadius', '交互半径', 'number'],
      ['visible', '可见', 'boolean'],
      ...guideRows(entity, true)
    ];
  } else if (l.idols.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['interactRadius', '交互半径', 'number'],
      ['visible', '可见', 'boolean'],
      ...guideRows(entity, true)
    ];
  } else if ((l.icons || []).includes(entity)) {
    const iconSrcOptions = [
      ['', '（无）'],
      ...ctx.iconChoices.map(a => [a.url, a.name])
    ];
    if (entity.src && !iconSrcOptions.some(([v]) => v === entity.src)) {
      iconSrcOptions.unshift([entity.src, entity.src]);
    }
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['interactRadius', '交互范围', 'number'],
      ['tipText', 'Tip 文字', 'text'],
      ['event', '交互事件', 'select', [
        ['workshop', '打开工坊页面'],
        ['weapon', '打开武器页面'],
        ['battle', '打开战斗页面']
      ]],
      ['src', '图标', 'select', iconSrcOptions],
      ['visible', '游戏中显示', 'boolean'],
      ...guideRows(entity, true)
    ];
  } else if ((l.portals || []).includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['trigger', '出现方式', 'select', [
        ['start', '游戏开始即存在'],
        ['trigger', '触发器触发（清敌后出现）']
      ]],
      ['triggerId', '触发器', 'select', [
        ['', '（无）'],
        ...l.triggers.map((t, i) => [t.id, `${i + 1}. ${t.id}`])
      ]],
      ['interactRadius', '交互半径', 'number'],
      ['visible', '可见', 'boolean'],
      ...guideRows(entity, true)
    ];
  } else if (l.crates.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number']
    ];
  } else if (l.barrels.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['explodeRadius', '爆炸半径', 'number']
    ];
  } else if (l.chests.includes(entity)) {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['trigger', '出现方式', 'select', [
        ['start', '游戏开始即存在'],
        ['trigger', '触发器触发（清敌后出现）']
      ]],
      ['triggerId', '触发器', 'select', [
        ['', '（无）'],
        ...l.triggers.map((t, i) => [t.id, `${i + 1}. ${t.id}`])
      ]],
      ['openRadius', '打开判定半径', 'number'],
      ...guideRows(entity, false)
    ];
    fields.unshift(['id', '编号', 'text']);
    dom.entityFields.innerHTML = fields.map(([key, label, inputType, options]) => {
      const value = getNested(entity, key) ?? '';
      if (inputType === 'select') {
        const opts = options.map(([v, name]) =>
          `<option value="${v}" ${value === v ? 'selected' : ''}>${name}</option>`).join('');
        return `<label>${label}<select data-entity-field="${key}">${opts}</select></label>`;
      }
      if (inputType === 'text') {
        return `<label>${label}<input data-entity-field="${key}" type="text" value="${value}"></label>`;
      }
      if (inputType === 'boolean') {
        return `<label>${label}<input data-entity-field="${key}" type="checkbox" ${value ? 'checked' : ''}></label>`;
      }
      return `<label>${label}<input data-entity-field="${key}" type="number" value="${value}"></label>`;
    }).join('');
    // 掉落奖励配置（种类/数量/概率）
    const rewardEditor = document.createElement('div');
    rewardEditor.className = 'chest-rewards';
    rewardEditor.innerHTML = `
      <h3>掉落奖励配置</h3>
      <div class="chest-reward-list"></div>
      <button type="button" id="chestRewardAdd">添加奖励</button>`;
    dom.entityFields.appendChild(rewardEditor);

    const rewardList = rewardEditor.querySelector('.chest-reward-list');
    const renderRewards = () => {
      const rewards = entity.rewards || (entity.rewards = []);
      rewardList.innerHTML = rewards.map((r, i) => `
        <div class="chest-reward-row">
          <div class="cr-head">
            <label>掉落种类
              <select data-reward-i="${i}" data-reward-k="item">
                ${Object.entries(DROP_ITEMS).map(([k, v]) => `<option value="${k}" ${r.item === k ? 'selected' : ''}>${v}</option>`).join('')}
              </select>
            </label>
            <button type="button" data-reward-del="${i}" title="删除此条奖励">删除</button>
          </div>
          <div class="cr-fields">
            <label>数量
              <input data-reward-i="${i}" data-reward-k="count" type="number" min="1" value="${r.count}"/>
            </label>
            <label>概率
              <span class="cr-chance"><input data-reward-i="${i}" data-reward-k="chance" type="number" min="0" max="100" value="${r.chance}"/><b>%</b></span>
            </label>
          </div>
        </div>`).join('');
    };
    renderRewards();

    rewardEditor.querySelector('#chestRewardAdd').onclick = () => {
      pushUndo();
      const rewards = entity.rewards || (entity.rewards = []);
      rewards.push({ item: 'gold', count: 1, chance: 100 });
      renderRewards();
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
    };
    rewardList.addEventListener('click', e => {
      const del = e.target.dataset.rewardDel;
      if (del != null) {
        pushUndo();
        entity.rewards.splice(Number(del), 1);
        renderRewards();
        saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
      }
    });
    rewardList.addEventListener('input', e => {
      const i = Number(e.target.dataset.rewardI);
      const k = e.target.dataset.rewardK;
      if (!Number.isInteger(i) || !k || !entity.rewards[i]) return;
      if (k === 'item') entity.rewards[i].item = e.target.value;
      else entity.rewards[i][k] = k === 'count'
        ? Math.max(1, Math.floor(Number(e.target.value) || 1))
        : Math.min(100, Math.max(0, Number(e.target.value) ?? 100));
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
    });

    bindEntityFieldInputs(entity);
    return;
  } else {
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['rotation', '旋转角度(°)', 'number'],
      ['color', '颜色', 'color']
    ];
  }

  fields.unshift(['id', '编号', 'text']);
  dom.entityFields.innerHTML = fields.map(([key, label, inputType, options]) => {
    const value = key === '__waveCount'
      ? ((entity.spawn || {}).waves || []).length
      : getNested(entity, key) ?? '';
    if (inputType === 'select') {
      const opts = options.map(([v, name]) =>
        `<option value="${v}" ${value === v ? 'selected' : ''}>${name}</option>`).join('');
      return `<label>${label}<select data-entity-field="${key}">${opts}</select></label>`;
    }
    if (inputType === 'multiselect') {
      const arr = Array.isArray(value) ? value : [];
      const opts = options.map(([v, name]) =>
        `<label class="ms-item"><input type="checkbox" data-ms="${key}" value="${v}" ${arr.includes(v) ? 'checked' : ''}/>${name}</label>`).join('');
      return `<div class="field-multiselect"><span class="ms-title">${label}</span><div class="ms-list">${opts}</div></div>`;
    }
    if (inputType === 'boolean') {
      return `<label>${label}<input data-entity-field="${key}" type="checkbox" ${value ? 'checked' : ''}></label>`;
    }
    if (inputType === 'color') {
      return `<label>${label}<input data-entity-field="${key}" type="color" value="${/^#[0-9a-f]{6}$/i.test(String(value)) ? value : '#60758b'}"></label>`;
    }
    return `<label>${label}<input data-entity-field="${key}" type="${inputType}" value="${value}"></label>`;
  }).join('');

  bindEntityFieldInputs(entity);

  if ((l.icons || []).includes(entity)) {
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.textContent = '上传图标';
    uploadBtn.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        pushUndo();
        try {
          const res = await fetch('/api/uploads', {
            method: 'POST',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file
          });
          if (!res.ok) throw new Error(`上传失败 ${res.status}`);
          const data = await res.json();
          entity.src = data.path;
          state.game?.scene.scenes[0]?.draw?.();
          saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
          renderEntityProperties();
        } catch (err) {
          setStatus(dom, `图标上传失败：${err.message}`, true);
        }
      };
      input.click();
    };
    dom.entityFields.appendChild(uploadBtn);
  }

  if (l.triggers.includes(entity)) {
    ctx.hooks.renderTriggerEvents(entity, { enemyTypeOptions, levelOptions, gateOptions, eventTypeOptions });
  }
}

// ── 字段输入绑定 ──
export function bindEntityFieldInputs(entity) {
  const dom = ctx.dom;
  dom.entityFields.querySelectorAll('input,select').forEach(input => {
    input.onfocus = pushUndo;
    input.oninput = () => {
      const field = input.dataset.entityField;
      if (!field) return;
      if (field === '__waveCount') {
        const target = Math.max(1, Math.floor(Number(input.value) || 1));
        const spawn = entity.spawn || (entity.spawn = {});
        const waves = spawn.waves || (spawn.waves = []);
        while (waves.length < target) waves.push({});
        while (waves.length > target) waves.pop();
        renderEntityProperties();
        return;
      }
      if (input.dataset.ms !== undefined) {
        const values = [...dom.entityFields.querySelectorAll(`input[data-ms="${input.dataset.ms}"]:checked`)].map(i => i.value);
        setNested(entity, input.dataset.ms, values);
        return;
      }
      const value = input.type === 'checkbox' ? input.checked
        : input.type === 'number' ? Number(input.value) : input.value;
      setNested(entity, field, value);
      if (field === 'type') {
        const def = ENEMY_TYPES[value];
        if (def) {
          entity.hp = def.hp;
          entity.damage = def.damage;
        }
      }
      if (field === 'scheme') entity.weaponType = SCHEME_WEAPONS[value];
      // 指引开关联动：勾选后才显示距离/图标等字段，需重渲染面板
      if (field === 'guide') renderEntityProperties();
      if (field === 'spawn.mode' || /^spawn\.waves\.\d+\.(mode|shape)$/.test(field)) {
        const m = /^spawn\.waves\.(\d+)\.mode$/.exec(field);
        if (m) {
          const wave = entity.spawn.waves[Number(m[1])] || {};
          if (value === 'inscreen') {
            if (wave.count === undefined) wave.count = 5;
            if (wave.playerMinRadius === undefined) wave.playerMinRadius = 200;
          }
        }
        renderEntityProperties();
        return;
      }
      // 门/生成区域编号变更后重绘，刷新其它实体引用到的下拉选项
      if (field === 'id' && (state.level.gates.includes(entity) || (state.level.spawnZones || []).includes(entity))) {
        state.game?.scene.scenes[0].draw();
        return;
      }
      state.game?.scene.scenes[0].draw();
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
    };
  });
}
