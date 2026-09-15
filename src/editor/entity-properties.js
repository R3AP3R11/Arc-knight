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
import { loadInnerShop, getPotionList } from '../systems/economy/inner-shop.js';
import { IDOL_BUFFS } from '../systems/economy/buffs.js';
import { normalizeHeavyMechConfig } from '../systems/combat/heavy-mech.js';

const { state } = ctx;

// 宝箱奖励药水列表：首次渲染时若尚未加载 → 请求一次并重渲染（模块级 flag 防重入）
let potionsRequested = false;

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

// ── 休息火堆「可抽基础属性强化」行编辑器 ──
// 契约：entity.statBuffs = [{ id, name, value }]
//   id    = IDOL_BUFFS 的祝福 id
//   name  = 显示名称（'' = 用表默认 name）
//   value = 数值（null = 用表默认 value）
// 空数组 = 全部祝福、全用表默认（面板打开时按「全部勾选 + 表默认」呈现）
const STAT_LABELS = {
  attackPower: '攻击力',
  critRate: '暴击率',
  dodgeRate: '闪避率',
  moveSpeed: '移动速度',
  maxHp: '生命上限',
  damageReduction: '受到伤害'
};
const OP_LABELS = { add: '加法', mul: '乘法', set: '设置' };

// 带符号百分比文本：15 → "+15%"，-10 → "-10%"
function fmtSignedPct(n) {
  const v = Number(n.toFixed(1));
  return `${v >= 0 ? '+' : ''}${v}%`;
}

// 该祝福 stats 首条 spec（口径与默认值都取自它）
function firstStat(buff) {
  const [key, spec] = Object.entries(buff.stats || {})[0] || [];
  return key && spec ? { key, spec } : null;
}

// 表默认数值（stats 首条的 value；无 stats → null）
function buffTableValue(buff) {
  const s = firstStat(buff);
  return s ? Number(s.spec.value) : null;
}

// 口径只读小字，例：攻击力（乘法，1.15 = +15%）/ 暴击率（加法，0.1 = +10%）
function buffSpecText(buff) {
  const s = firstStat(buff);
  if (!s) return '';
  const label = STAT_LABELS[s.key] || s.key;
  const op = OP_LABELS[s.spec.op] || s.spec.op || '';
  const v = Number(s.spec.value);
  const expr = s.spec.op === 'mul' ? `${v} = ${fmtSignedPct((v - 1) * 100)}`
    : Math.abs(v) < 1 ? `${v} = ${fmtSignedPct(v * 100)}`
      : `${v}`;
  return op ? `${label}（${op}，${expr}）` : `${label}（${expr}）`;
}

// 火堆基础属性强化行编辑器：每行 = 勾选启用 + 名称 + 数值；空数组 = 全部勾选 + 表默认
function renderCampfireStatBuffs(entity, dom) {
  const configured = Array.isArray(entity.statBuffs) ? entity.statBuffs : [];
  const useAllDefault = configured.length === 0;
  // 兼容旧数据（statBuffs 曾为 string[]）：字符串项按其 id 视作「已启用 + 用表默认」
  const byId = new Map(configured
    .map(b => [typeof b === 'string' ? b : (b && b.id), b])
    .filter(([id]) => !!id));

  const editor = document.createElement('div');
  editor.className = 'campfire-buffs';
  editor.innerHTML = `
    <h3>基础属性强化配置</h3>
    <p class="hint">勾选 = 该祝福可从火堆抽出；名称/数值等于表默认（或留空）时按表默认处理</p>
    <div class="campfire-buff-list">
      ${IDOL_BUFFS.map(buff => {
        const cfg = byId.get(buff.id);
        const checked = useAllDefault || !!cfg;
        const nameVal = (cfg && cfg.name) || buff.name;
        const tableValue = buffTableValue(buff);
        const valueVal = cfg && cfg.value != null ? cfg.value : (tableValue == null ? '' : tableValue);
        const spec = buffSpecText(buff);
        return `
      <div class="campfire-buff-row" data-buff-id="${buff.id}">
        <label class="cb-enable"><input type="checkbox" data-buff-enable ${checked ? 'checked' : ''}/>${buff.name}</label>
        <span class="cb-desc">${buff.desc || ''}</span>
        <div class="cb-fields">
          <label>名称<input type="text" data-buff-k="name" value="${nameVal}"/></label>
          <label>数值<input type="number" step="any" data-buff-k="value" value="${valueVal}"/></label>
        </div>
        ${spec ? `<div class="cb-spec">${spec}</div>` : ''}
      </div>`;
      }).join('')}
    </div>`;
  dom.entityFields.appendChild(editor);

  // 勾选行 → [{ id, name, value }]；名称/数值等于表默认（留空同样）时回退为 ''/null
  const collect = () => {
    const list = [];
    editor.querySelectorAll('.campfire-buff-row').forEach(row => {
      if (!row.querySelector('input[data-buff-enable]').checked) return;
      const buff = IDOL_BUFFS.find(b => b.id === row.dataset.buffId);
      if (!buff) return;
      const name = row.querySelector('input[data-buff-k="name"]').value;
      const raw = row.querySelector('input[data-buff-k="value"]').value.trim();
      const num = raw === '' ? NaN : Number(raw);
      list.push({
        id: buff.id,
        name: name === buff.name ? '' : name,
        value: Number.isFinite(num) && num !== buffTableValue(buff) ? num : null
      });
    });
    return list;
  };

  editor.addEventListener('focusin', () => pushUndo());
  editor.addEventListener('input', () => {
    entity.statBuffs = collect();
    saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
  });
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
    : (l.campfires || []).includes(entity) ? '休息火堆'
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
    ['removeGate', '消除能量门'],
    ['bossBattle', 'BOSS战斗'],
    ['playCinematic', '播放运镜'],
    ['lockChest', '宝箱上锁'],
    ['unlockChest', '宝箱解锁']
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
    // 母舰：额外显示 Boss 配置（大小/召唤间隔/召唤表/击败运镜），仅母舰展示
    if (entity.type === 'mothership') {
      fields.push(
        ['artScale', '大小', 'number'],
        ['boss.spawnInterval', '召唤间隔(ms)', 'number'],
        ['bossSpawnText', '召唤表（type*count,...）', 'text'],
        ['cutsceneId', '被击败运镜 id', 'text']
      );
    }
    // 原型机-2-5T5：全部数值走 boss.* 配置对象（[组名] 前缀便于辨认），artScale 用顶层字段
    if (entity.type === 'boss-2-5t5') {
      fields.push(
        ['artScale', '大小', 'number'],
        ['boss.name', '基础-名称', 'text'],
        ['boss.moveSpeed', '移动-速度(px/s)', 'number'],
        ['boss.moveWaitPreMs', '移动-前置等待(ms)', 'number'],
        ['boss.moveWaitPostMs', '移动-后置等待(ms)', 'number'],
        ['boss.approachMinMs', '移动-接近时长下限(ms)', 'number'],
        ['boss.approachMaxMs', '移动-接近时长上限(ms)', 'number'],
        ['boss.spinFastDeg', '移动-快速环绕角速度(°/s)', 'number'],
        ['boss.spinFastMs', '移动-快速环绕时长(ms)', 'number'],
        ['boss.spinSlowDeg', '移动-慢速环绕角速度(°/s)', 'number'],
        ['boss.spinSlowMs', '移动-慢速环绕时长(ms)', 'number'],
        ['boss.fleeMinMs', '移动-远离时长下限(ms)', 'number'],
        ['boss.fleeMaxMs', '移动-远离时长上限(ms)', 'number'],
        ['boss.shieldRadius', '护盾-半径', 'number'],
        ['boss.shieldFadeMs', '护盾-渐显渐隐时长(ms)', 'number'],
        ['boss.shieldRestoreDelayMs', '护盾-技能后恢复延迟(ms)', 'number'],
        ['boss.blockedBulletDamage', '护盾-滞留子弹伤害', 'number'],
        ['boss.shieldClearCost', '护盾-消除红弹扣盾值', 'number'],
        ['boss.arcRadius', '圆弧-半径', 'number'],
        ['boss.arcSpanDeg', '圆弧-张角(°)', 'number'],
        ['boss.arc5SpinDeg', '圆弧5-自转角速度(°/s)', 'number'],
        ['boss.arc4SpinDeg', '圆弧4-自转角速度(°/s)', 'number'],
        ['boss.arcAlignDeg', '圆弧-对准玩家角速度(°/s)', 'number'],
        ['boss.innerRadius', '圆弧1-内圈半径', 'number'],
        ['boss.arc2Radius', '圆弧2-范围半径', 'number'],
        ['boss.s1Range', '技能1-范围', 'number'],
        ['boss.s1ExtendMs', '技能1-延长时长(ms)', 'number'],
        ['boss.s1PauseMs', '技能1-停顿时长(ms)', 'number'],
        ['boss.s1TightenMs', '技能1-收紧时长(ms)', 'number'],
        ['boss.s1RingGap', '技能1-圆弧间隔(px)', 'number'],
        ['boss.s1DragSpeed', '技能1-拖拽速度(px/s)', 'number'],
        ['boss.s1DragDist', '技能1-拖拽距离', 'number'],
        ['boss.s1KeepMs', '技能1-区域保留(ms)', 'number'],
        ['boss.s1FadeMs', '技能1-区域淡出(ms)', 'number'],
        ['boss.s1BossSpeedMult', '技能1-BOSS移速倍率', 'number'],
        ['boss.s1BulletTrailWidth', '技能1-子弹拖尾宽度(px)', 'number'],
        ['boss.s1BulletTrailLength', '技能1-子弹拖尾长度(px)', 'number'],
        ['boss.s1BulletTrailColor', '技能1-子弹拖尾颜色', 'color'],
        ['boss.zoneHitPadPx', '技能1/2-命中像素容差(px)', 'number'],
        ['boss.s2Range', '技能2-范围', 'number'],
        ['boss.s2ExtendMs', '技能2-延长时长(ms)', 'number'],
        ['boss.s2PauseMs', '技能2-停顿时长(ms)', 'number'],
        ['boss.s2ExpandMs', '技能2-扩张时长(ms)', 'number'],
        ['boss.s2PushSpeed', '技能2-击退速度(px/s)', 'number'],
        ['boss.s2PushDist', '技能2-击退距离', 'number'],
        ['boss.s2Damage', '技能2-伤害', 'number'],
        ['boss.s2KeepMs', '技能2-区域保留(ms)', 'number'],
        ['boss.s2FadeMs', '技能2-区域淡出(ms)', 'number'],
        ['boss.s2BulletTrailWidth', '技能2-子弹拖尾宽度(px)', 'number'],
        ['boss.s2BulletTrailLength', '技能2-子弹拖尾长度(px)', 'number'],
        ['boss.s2BulletTrailColor', '技能2-子弹拖尾颜色', 'color'],
        ['boss.mergeOverlapPct', '技能3-合并重叠阈值(%)', 'number'],
        ['boss.parkMinDeg', '非参战圆弧-停靠夹角下限(°)', 'number'],
        ['boss.skillWeightS1', '技能权重-技能1', 'number'],
        ['boss.skillWeightS2', '技能权重-技能2', 'number'],
        ['boss.skillWeightS3', '技能权重-技能3', 'number'],
        ['boss.skillWeightS5', '技能权重-技能5(半血后)', 'number'],
        ['boss.s3Range', '技能3-范围', 'number'],
        ['boss.s3ExtendMs', '技能3-延长时长(ms)', 'number'],
        ['boss.s3PauseMs', '技能3-停顿时长(ms)', 'number'],
        ['boss.s3ExpandMs', '技能3-扩张时长(ms)', 'number'],
        ['boss.s4PushSpeed', '技能4-击飞速度(px/s)', 'number'],
        ['boss.s4PushDist', '技能4-击飞距离', 'number'],
        ['boss.s4Damage', '技能4-伤害', 'number'],
        // 技能5「蓝色漩涡」（半血后才加入技能池）：生成 / 生命 / 吸力 / 拖尾
        ['boss.s5HpPct', '技能5-加入技能组血量阈值(%)', 'number'],
        ['boss.s5CastMs', '技能5-释放时长(ms)', 'number'],
        ['boss.s5SpawnDist', '技能5-生成距玩家距离(px)', 'number'],
        ['boss.s5Radius', '技能5-漩涡半径(px)', 'number'],
        ['boss.s5Hp', '技能5-漩涡生命值', 'number'],
        ['boss.s5PullRadius', '技能5-玩家吸力生效半径(px)', 'number'],
        ['boss.s5PullMin', '技能5-最小吸力(px/s，半径边缘处)', 'number'],
        ['boss.s5PullMax', '技能5-最大吸力(px/s，涡心处，需<玩家移速180)', 'number'],
        ['boss.s5BulletPull', '技能5-子弹吸力(px/s²)', 'number'],
        ['boss.s5HitIntervalMs', '技能5-入漩涡受伤间隔(ms)', 'number'],
        ['boss.s5HitDamage', '技能5-入漩涡伤害', 'number'],
        ['boss.s5BulletTrailWidth', '技能5-子弹拖尾宽度(px)', 'number'],
        ['boss.s5BulletTrailLength', '技能5-子弹拖尾长度(px)', 'number'],
        ['boss.s5BulletTrailColor', '技能5-子弹拖尾颜色', 'color'],
        ['boss.s5CaptureMax', '技能5-漩涡最多捕获子弹数', 'number'],
        ['boss.s5CaptureOrbitRatio', '技能5-捕获环绕半径比例', 'number'],
        ['boss.s5CaptureSpinDeg', '技能5-捕获环绕角速度(°/s)', 'number'],
        // 原型机-2-5T5 的运镜 id 写进 boss.*（运行时 enemy-ai.js:defeatEnemy 读 e.bossCfg.cutsceneId；
        // 母舰走的顶层 cutsceneId 是另一条路径，由 state.js:normalizeEnemy 保留）
        ['boss.cutsceneId', '被击败运镜 id', 'text']
      );
    }
    // 重装机兵：远程激光单位，数值走 mech.* 配置对象（[组名] 前缀便于辨认），artScale 用顶层字段
    if (entity.type === 'heavy-mech') {
      fields.push(
        ['artScale', '大小', 'number'],
        ['mech.moveSpeed', '移动-速度(px/s)', 'number'],
        ['mech.rotateSpeed', '瞄准-旋转速度(°/s)', 'number'],
        ['mech.aimSpeed', '瞄准-瞄准速度(°/s)', 'number'],
        ['mech.fireDelay', '激光-开枪延迟(ms)', 'number'],
        ['mech.fireInterval', '激光-射击间隔(ms)', 'number']
      );
    }
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
      ['shieldOnly', '只挡子弹(不可见/不挡玩家)', 'boolean'],
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
  } else if ((l.campfires || []).includes(entity)) {
    // 休息火堆：编号(id)由下方公共分支 fields.unshift(['id','编号','text']) 统一补上
    fields = [
      ['x', 'X 坐标', 'number'],
      ['y', 'Y 坐标', 'number'],
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
      ['art', '画板美术方案', 'select', artOptions],
      ['artScale', '大小倍率', 'number'],
      ['interactRadius', '交互半径', 'number'],
      ['visible', '游戏中显示', 'boolean'],
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
      ['w', '宽度', 'number'],
      ['h', '高度', 'number'],
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
      if (!getPotionList().length && !potionsRequested) {
        potionsRequested = true;
        loadInnerShop().then(() => renderRewards());
      }
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
            ${r.item === 'potion' ? `
            <label>药水
              <select data-reward-i="${i}" data-reward-k="potionId">
                <option value="">（随机药水）</option>
                ${getPotionList().map(c => `<option value="${c.id}" ${(r.potionId || '') === String(c.id) ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
            </label>` : ''}
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
      if (k === 'item') {
        entity.rewards[i].item = e.target.value;
        // 切离 potion 时清空 potionId，并重渲染以显隐药水下拉
        if (e.target.value !== 'potion') entity.rewards[i].potionId = '';
        renderRewards();
      } else if (k === 'potionId') {
        entity.rewards[i].potionId = e.target.value;
      } else {
        entity.rewards[i][k] = k === 'count'
          ? Math.max(1, Math.floor(Number(e.target.value) || 1))
          : Math.min(100, Math.max(0, Number(e.target.value) ?? 100));
      }
      saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
    });

    const lockHint = document.createElement('p');
    lockHint.className = 'hint';
    lockHint.textContent = '上锁/解锁由触发器事件「宝箱上锁 / 宝箱解锁」控制：上锁的宝箱被红色圆环包围，不可开启，并阻挡玩家/敌人移动与所有子弹。';
    dom.entityFields.appendChild(lockHint);

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
      : key === 'bossSpawnText'
        ? (Array.isArray(entity.boss?.spawnTable)
            ? entity.boss.spawnTable.map(({ type, count }) => `${type}*${count}`).join(',')
            : 'basic1*5,basic2*6,advanced1*2,advanced2*1')
        : key === 'artScale'
          ? (getNested(entity, key) ?? 2)
          : key === 'boss.spawnInterval'
            ? (getNested(entity, key) ?? 5000)
            : getNested(entity, key) ?? '';
    if (inputType === 'select') {
      const opts = options.map(([v, name]) =>
        `<option value="${v}" ${value === v ? 'selected' : ''}>${name}</option>`).join('');
      return `<label>${label}<select data-entity-field="${key}">${opts}</select></label>`;
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

  // 休息火堆：可抽基础属性强化行编辑器（勾选启用 + 名称输入 + 数值输入；空数组 = 全部祝福全用表默认）
  if ((l.campfires || []).includes(entity)) renderCampfireStatBuffs(entity, dom);

  // 母舰：被击败运镜 id 的说明 hint
  if (l.enemies.includes(entity) && entity.type === 'mothership') {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'BOSS 被击败时播放的运镜动画 id（留空则不触发）';
    dom.entityFields.appendChild(hint);
  }

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
      // 母舰召唤表：文本 "type*count,..." → 数组 [{type,count}] 写回 boss.spawnTable
      if (field === 'bossSpawnText') {
        const boss = entity.boss || (entity.boss = {});
        boss.spawnTable = String(input.value).split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(part => {
            const [type, count] = part.split('*').map(x => x.trim());
            return { type: type || '', count: Math.max(1, Math.floor(Number(count) || 1)) };
          });
        saveDraft(state.levelId, state.level).catch(() => setStatus(dom, '保存失败', true));
        return;
      }
      const value = input.type === 'checkbox' ? input.checked
        : input.type === 'number' ? Number(input.value) : input.value;
      // 宝箱尺寸：最小 20（与 state.js:normalizeChest 一致），防拖成 0 后贴图与上锁红环退化
      setNested(entity, field, (field === 'w' || field === 'h') && input.type === 'number' && state.level.chests.includes(entity)
        ? Math.max(20, value || 20)
        : value);
      if (field === 'type') {
        const def = ENEMY_TYPES[value];
        if (def) {
          entity.hp = def.hp;
          entity.damage = def.damage;
        }
        // 重装机兵：切类型时补全 mech.* 配置默认值，否则面板上这几个字段为空
        if (value === 'heavy-mech') entity.mech = normalizeHeavyMechConfig(entity.mech);
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
