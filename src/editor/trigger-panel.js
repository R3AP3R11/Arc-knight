/**
 * 触发器事件面板。
 * 职责：触发器实体的事件列表编辑器——事件类型/时机切换、参数表单（召唤敌人多波次、切换关卡、能量门多选），
 *       以及参数 HTML 生成 triggerEventParamsHtml。
 * 分类：关卡设计
 * 导出：renderTriggerEvents
 */
import { saveDraft } from '../api.js';
import { setStatus } from '../ui.js';
import { ctx } from './context.js';
import { pushUndo } from './history.js';
import { setNested } from './entity-properties.js';
import { roomPassagesForPoint, isGateOnPassage } from '../rooms.js';
import { GATE_OUTER_COLOR, GATE_INNER_COLOR } from '../systems/constants.js';

const { state } = ctx;

// ── 事件参数表单 ──
function triggerEventParamsHtml(ev, i, options) {
  const { enemyTypeOptions, levelOptions } = options;
  const type = ev.type || 'complete';

  if (type === 'spawnEnemy') {
    const spawn = ev.spawn || (ev.spawn = {});
    const zoneOptions = [...(state.level.spawnZones || []).map((z, zi) => [z.id, `${zi + 1}. ${z.id}`])];
    if (zoneOptions.length) zoneOptions.unshift(['', '（无：用触发器自身范围）']);
    const waves = Array.isArray(spawn.waves) ? spawn.waves : (spawn.waves = []);
    let html = `
        <label class="te-check"><input type="checkbox" data-event-i="${i}" data-event-field="spawn.stopOnExit" ${spawn.stopOnExit ? 'checked' : ''}/>离开触发器后停止生成</label>
        <label class="te-check"><input type="checkbox" data-event-i="${i}" data-event-field="spawn.resumeOnReturn" ${spawn.resumeOnReturn !== false ? 'checked' : ''}/>离开后重新进入：继续进度</label>
        <label>波数<input data-event-i="${i}" data-event-wavecount="${i}" type="number" min="1" value="${waves.length}"/></label>`;

    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w] || {};
      const no = w + 1;
      const isSurroundCircle = wave.mode !== 'offscreen' && wave.mode !== 'inscreen' && wave.shape === 'circle';
      html += `
          <label>第${no}波敌人类型
            <select data-event-i="${i}" data-event-field="spawn.waves.${w}.enemyType">
              ${enemyTypeOptions.map(([v, name]) => `<option value="${v}" ${(wave.enemyType || 'basic1') === v ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
          </label>
          <label>第${no}波生成方式
            <select data-event-i="${i}" data-event-field="spawn.waves.${w}.mode">
              ${[['surround', '周围生成'], ['offscreen', '屏幕外生成'], ['inscreen', '屏幕内随机']].map(([v, name]) => `<option value="${v}" ${(wave.mode || 'surround') === v ? 'selected' : ''}>${name}</option>`).join('')}
            </select>
          </label>
          <label>第${no}波生成前等待(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.preDelay" type="number" value="${wave.preDelay ?? 0}"/></label>
          <label>第${no}波生成后等待(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.postDelay" type="number" value="${wave.postDelay ?? 1000}"/></label>
          <label class="te-check"><input type="checkbox" data-event-i="${i}" data-event-field="spawn.waves.${w}.waitForClear" ${wave.waitForClear ? 'checked' : ''}/>第${no}波等待清理</label>`;

      if (wave.mode === 'inscreen') {
        html += `
            <label>第${no}波生成区域
              <select data-event-i="${i}" data-event-field="spawn.waves.${w}.zoneId">
                ${zoneOptions.map(([v, name]) => `<option value="${v}" ${(wave.zoneId || '') === v ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </label>
            <label>第${no}波数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.count" type="number" value="${wave.count ?? 5}"/></label>
            <label>第${no}波玩家安全半径<input data-event-i="${i}" data-event-field="spawn.waves.${w}.playerMinRadius" type="number" value="${wave.playerMinRadius ?? 200}"/></label>`;
      } else if (wave.mode !== 'offscreen') {
        html += `
            <label>第${no}波生成形状
              <select data-event-i="${i}" data-event-field="spawn.waves.${w}.shape">
                ${[['polygon', '角形生成'], ['circle', '圆环生成']].map(([v, name]) => `<option value="${v}" ${(wave.shape || 'polygon') === v ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </label>
            <label>第${no}波边数<input data-event-i="${i}" data-event-field="spawn.waves.${w}.sides" type="number" value="${wave.sides ?? 6}"/></label>
            <label>第${no}波半径<input data-event-i="${i}" data-event-field="spawn.waves.${w}.radius" type="number" value="${wave.radius ?? 120}"/></label>
            <label>第${no}波边厚度<input data-event-i="${i}" data-event-field="spawn.waves.${w}.thickness" type="number" value="${wave.thickness ?? 10}"/></label>
            <label>第${no}波绘制时长(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.drawDuration" type="number" value="${wave.drawDuration ?? 500}"/></label>
            <label>第${no}波消失时长(ms)<input data-event-i="${i}" data-event-field="spawn.waves.${w}.fadeDuration" type="number" value="${wave.fadeDuration ?? 500}"/></label>`;
        if (isSurroundCircle) {
          html += `
              <label>第${no}波数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.count" type="number" value="${wave.count ?? 5}"/></label>
              <label>第${no}波圆形数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.circleCount" type="number" value="${wave.circleCount ?? 8}"/></label>`;
        }
      } else {
        html += `<label>第${no}波数量<input data-event-i="${i}" data-event-field="spawn.waves.${w}.count" type="number" value="${wave.count ?? 5}"/></label>`;
      }
    }
    return html;
  }

  if (type === 'switchLevel') {
    const sp = ev.spawnPoint || (ev.spawnPoint = { x: 0, y: 0 });
    return `
        <label>目标关卡
          <select data-event-i="${i}" data-event-field="target">
            ${levelOptions.map(([v, name]) => `<option value="${v}" ${(ev.target || '') === v ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
        </label>
        <label>出生点X<input data-event-i="${i}" data-event-field="spawnPoint.x" type="number" value="${sp.x ?? 0}"/></label>
        <label>出生点Y<input data-event-i="${i}" data-event-field="spawnPoint.y" type="number" value="${sp.y ?? 0}"/></label>`;
  }

  if (type === 'spawnGate' || type === 'removeGate') {
    const arr = Array.isArray(ev.gateIds) ? ev.gateIds : (ev.gateIds = []);
    // 方案：从当前关卡门列表实时生成（而非 options.gateOptions 快照），自动生成门后重渲染即可看到新门
    const doorOpts = (state.level.gates || []).map((g, gi) => [g.id, `${gi + 1}. ${g.id}`]);
    return `
        <label class="te-check"><input type="checkbox" data-event-i="${i}" data-event-auto="${i}" ${ev.auto ? 'checked' : ''}/>自动（触发器所在箱庭通道的门）</label>
        <p class="hint" style="margin-top:2px">勾选后：一键生成/消除触发器所在箱庭通道上的能量门；取消勾选可手动多选。</p>
        <div class="field-multiselect"><span class="ms-title">目标能量门（多选）</span><div class="ms-list">
        ${doorOpts.map(([v, name]) => `<label class="ms-item"><input type="checkbox" data-event-i="${i}" data-ms="events.${i}.gateIds" value="${v}" ${arr.includes(v) ? 'checked' : ''}/>${name}</label>`).join('')}
      </div></div>`;
  }

  if (type === 'playCinematic') {
    const cinematics = state.level.cinematics || [];
    const cineId = ev.cinematicId || '';
    const focusTarget = ev.focusTarget || '';
    return `
        <label>运镜动画
          <select data-event-i="${i}" data-event-field="cinematicId">
            <option value="">（未选择）</option>
            ${cinematics.map(c => `<option value="${c.id}" ${cineId === c.id ? 'selected' : ''}>${c.name || c.id}</option>`).join('')}
          </select>
        </label>
        <label>焦点目标
          <select data-event-i="${i}" data-event-field="focusTarget">
            <option value="" ${focusTarget === '' ? 'selected' : ''}>无（用关键帧 pan）</option>
            <option value="boss" ${focusTarget === 'boss' ? 'selected' : ''}>BOSS（锁定其死亡位置）</option>
          </select>
        </label>
        <p class="hint">选「BOSS」后镜头中心在运镜期间动态锁定到 BOSS 死亡坐标（视口左上角 paX/paY 被换算为中心）。</p>`;
  }

  return '<p class="hint">该事件无参数</p>';
}

// 自动生成：为触发器所在箱庭房间的每个通道补齐门实体，并把门 id 写入 ev.gateIds（供勾选列表回显）
function autoGenerateGateEvent(entity, ev, dom) {
  const layout = state.level.roomLayout;
  if (!layout) {
    setStatus(dom, '该关卡不是多箱庭布局，无法自动生成门', true);
    return false;
  }
  const room = roomPassagesForPoint(layout, entity.x, entity.y);
  if (!room?.passages?.length) {
    setStatus(dom, '触发器不在任何箱庭房间内，请把触发器放入房间再自动生成门', true);
    return false;
  }
  const gates = state.level.gates || (state.level.gates = []);
  const ids = [];
  for (const p of room.passages) {
    let gate = gates.find(g => isGateOnPassage(g, p));
    if (!gate) {
      gate = {
        id: `gate-${entity.id}-${p.edge}`,
        x: p.cx, y: p.cy, w: p.w, h: 45, rotation: p.rotation,
        label: 'Barrier Active', color1: GATE_OUTER_COLOR, color2: GATE_INNER_COLOR,
        active: false, visible: true
      };
      gates.push(gate);
    }
    if (!ids.includes(gate.id)) ids.push(gate.id);
  }
  ev.gateIds = ids;
  return true;
}

// ── 事件列表渲染与交互 ──
export function renderTriggerEvents(entity, options) {
  const dom = ctx.dom;
  const { eventTypeOptions } = options;
  const wrap = document.createElement('div');
  wrap.className = 'trigger-events';
  wrap.innerHTML = `
      <h3>事件列表</h3>
      <div class="trigger-event-list"></div>
      <button type="button" id="triggerEventAdd">添加事件</button>`;
  dom.entityFields.appendChild(wrap);

  const list = wrap.querySelector('.trigger-event-list');
  const saveQuiet = () => saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));

  const render = () => {
    const events = entity.events || (entity.events = []);
    if (!events.length) events.push({ type: 'complete' });
    list.innerHTML = events.map((ev, i) => `
        <div class="trigger-event-row">
          <div class="te-head">
            <label>事件类型
              <select data-event-i="${i}" data-event-type="${i}">
                ${eventTypeOptions.map(([v, name]) => `<option value="${v}" ${(ev.type || 'complete') === v ? 'selected' : ''}>${name}</option>`).join('')}
              </select>
            </label>
            <label>触发时机
              <select data-event-i="${i}" data-event-when="${i}">
                <option value="enter" ${(ev.when || 'enter') === 'enter' ? 'selected' : ''}>进入即触发</option>
                <option value="enemiesCleared" ${ev.when === 'enemiesCleared' ? 'selected' : ''}>击败本触发器召唤敌人后</option>
              </select>
            </label>
            <button type="button" data-event-del="${i}" title="删除此事件">删除</button>
          </div>
          <div class="te-params">${triggerEventParamsHtml(ev, i, options)}</div>
        </div>`).join('');
  };
  render();

  wrap.addEventListener('focusin', e => {
    if (e.target.matches('input,select')) pushUndo();
  });

  wrap.querySelector('#triggerEventAdd').onclick = () => {
    pushUndo();
    const events = entity.events || (entity.events = []);
    events.push({ type: 'complete' });
    render();
    saveQuiet();
  };

  list.addEventListener('click', e => {
    const del = e.target.dataset.eventDel;
    if (del != null) {
      pushUndo();
      const events = entity.events || (entity.events = []);
      events.splice(Number(del), 1);
      render();
      saveQuiet();
    }
  });

  list.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.eventWhen != null) {
      const i = Number(el.dataset.eventWhen);
      const ev = entity.events[i];
      if (!ev) return;
      ev.when = el.value === 'enemiesCleared' ? 'enemiesCleared' : 'enter';
      saveQuiet();
      return;
    }
    if (el.dataset.eventType != null) {
      const i = Number(el.dataset.eventType);
      const ev = entity.events[i];
      if (!ev) return;
      ev.type = el.value;
      delete ev.spawn;
      delete ev.target;
      delete ev.spawnPoint;
      delete ev.gateIds;
      delete ev.cinematicId;
      delete ev.focusTarget;
      if (ev.type === 'spawnEnemy') {
        ev.spawn = { stopOnExit: false, resumeOnReturn: true, waves: [] };
      } else if (ev.type === 'switchLevel') {
        ev.target = state.levels[0] || '';
        ev.spawnPoint = { x: 0, y: 0 };
      } else if (ev.type === 'spawnGate' || ev.type === 'removeGate') {
        ev.gateIds = [];
        ev.auto = false;
      } else if (ev.type === 'playCinematic') {
        ev.cinematicId = '';
        ev.focusTarget = '';
      }
      render();
      saveQuiet();
      return;
    }
    if (el.dataset.eventAuto != null) {
      const i = Number(el.dataset.eventAuto);
      const ev = entity.events[i];
      if (!ev) return;
      ev.auto = el.checked;
      if (ev.auto && !autoGenerateGateEvent(entity, ev, dom)) {
        ev.auto = false;
        render();
        return;
      }
      render();
      saveQuiet();
      return;
    }
    if (el.dataset.ms != null) {
      const i = Number(el.dataset.eventI);
      const ev = entity.events[i];
      if (!ev) return;
      ev.gateIds = [...list.querySelectorAll(`input[data-ms="events.${i}.gateIds"]:checked`)].map(x => x.value);
      saveQuiet();
      return;
    }
    const field = el.dataset.eventField;
    const i = Number(el.dataset.eventI);
    if (!field || !Number.isInteger(i) || !entity.events[i]) return;
    const value = el.type === 'checkbox' ? el.checked
      : el.type === 'number' ? Number(el.value) : el.value;
    setNested(entity.events[i], field, value);
    if (/^spawn\.waves\.\d+\.(mode|shape)$/.test(field)) render();
    saveQuiet();
  });

  list.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.eventWavecount != null) {
      const i = Number(el.dataset.eventWavecount);
      const ev = entity.events[i];
      if (!ev) return;
      const spawn = ev.spawn || (ev.spawn = {});
      const target = Math.max(1, Math.floor(Number(el.value) || 1));
      const waves = spawn.waves || (spawn.waves = []);
      while (waves.length < target) waves.push({});
      while (waves.length > target) waves.pop();
      render();
      return;
    }
    const field = el.dataset.eventField;
    const i = Number(el.dataset.eventI);
    if (!field || !Number.isInteger(i) || !entity.events[i]) return;
    const value = el.type === 'checkbox' ? el.checked
      : el.type === 'number' ? Number(el.value) : el.value;
    setNested(entity.events[i], field, value);
    if (/^spawn\.waves\.\d+\.(mode|shape)$/.test(field)) render();
    saveQuiet();
  });
}
