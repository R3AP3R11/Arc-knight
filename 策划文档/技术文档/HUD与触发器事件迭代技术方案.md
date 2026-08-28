# HUD 状态指示器与触发器多事件迭代技术方案

## 一、需求

### 1. 战斗 HUD 状态指示器（顶部矩形）
- 玩家屏幕顶部显示一个 **400×100** 矩形，含三种状态：
  | 状态 | 颜色 | 文本 |
  |------|------|------|
  | 状态1 EXPLORE | 白色 #ffffff | EXPLORE |
  | 状态2 COMBAT | 红色 #ff3b3b | COMBAT |
  | 状态3 SECURE | 绿色 #37d67a | SECURE |
- 切换时：0.5 秒「从左到右」变色动画（左半先变目标色，右半渐次跟上）。
- 常态：每 3 秒自动执行一次动画，先切到**黑色**，再切回当前颜色（两段各 0.5s）。
- 默认状态1（白/EXPLORE）。

### 2. 触发器事件迭代
- 触发器支持**同时触发多个事件**（事件列表）。
- 新增事件「**触发战斗**」：触发时顶部矩形 状态1→状态2（红）。
- 「通关标记」拆分为：
  - **整体通关标记**：复用现有「通关标记」（结束并结算胜利）。
  - **单房间通关标记**：顶部矩形 状态→状态3（绿/SECURE），持续 1.5s 后回到状态1（白/EXPLORE）。

---

## 二、数据模型（`src/state.js`）

### `normalizeTrigger` 重构
触发器新增 `events` 数组（每个元素是一个事件对象），保留触发器级字段 `id/x/y/w/h/shape/color/visible/once/cooldown/resumeOnReturn`。

事件类型与参数：
```js
const EVENT_TYPES = ['complete', 'roomComplete', 'combat', 'spawnEnemy', 'switchLevel', 'spawnGate', 'removeGate'];
```

各事件对象结构：
- `{ type: 'complete' }`
- `{ type: 'roomComplete' }`
- `{ type: 'combat' }`
- `{ type: 'spawnEnemy', spawn: { stopOnExit, resumeOnReturn, spawnZoneId, waves: [...] } }`（复用现有 `normalizeWave`）
- `{ type: 'switchLevel', target, spawnPoint }`
- `{ type: 'spawnGate'|'removeGate', gateIds: [] }`

**向后兼容**：旧数据 `action` 字段（'complete'/'spawnEnemy'/'switchLevel'/'spawnGate'/'removeGate'）→ 转换为单元素 `events` 数组。若 `trigger.events` 是非空数组则直接规整。

> 约束：每个触发器至多一个 `spawnEnemy` 事件（波次状态用 `triggerState` 按 `t.id` 存）。

## 三、HUD 状态机（`src/game-scene.js`）

### 常量（模块顶部）
```js
const HUD_RECT_W = 400, HUD_RECT_H = 100;
const HUD_RECT_X = (VIEW_W - HUD_RECT_W) / 2;   // 760
const HUD_RECT_Y = 16;
const HUD_TRANSITION_MS = 500;   // 0.5s 切换动画
const HUD_IDLE_MS = 3000;        // 3s 常态脉冲
const HUD_STATES = {
  explore: { color: '#ffffff', label: 'EXPLORE', text: '#000000' },
  combat:  { color: '#ff3b3b', label: 'COMBAT',  text: '#ffffff' },
  secure:  { color: '#37d67a', label: 'SECURE',  text: '#ffffff' },
  black:   { color: '#000000', label: '',        text: '#ffffff' }   // 脉冲用黑色，文本沿用当前态
};
```

### 场景字段（`restart()` 初始化）
```js
this.hudMode = 'explore';
this.hudAnim = null;       // { fromColor, toColor, fromText, toText, t, dur }
this.hudIdleClock = HUD_IDLE_MS;
this.hudIdleStep = null;   // null | 'toBlack' | 'back'
```

### 方法
```js
hudColor(mode) { return HUD_STATES[mode]?.color || '#ffffff'; }

setHudMode(mode, opts = {}) {
  // opts.autoReturn: { mode, delay } —— 一段时间后回到指定状态
  const from = this.hudMode;
  this.hudMode = mode;
  this.hudAnim = { fromColor: this.hudColor(from), toColor: this.hudColor(mode),
                   fromText: HUD_STATES[from].label, toText: HUD_STATES[mode].label,
                   t: 0, dur: HUD_TRANSITION_MS };
  if (opts.autoReturn) {
    this.time.delayedCall(opts.autoReturn.delay, () => this.setHudMode(opts.autoReturn.mode || 'explore'));
  }
}

updateHud(dt) {
  // 推进切换动画
  if (this.hudAnim) {
    this.hudAnim.t += dt;
    if (this.hudAnim.t >= this.hudAnim.dur) this.hudAnim = null;
  }
  // 常态 3s 脉冲：先黑后回当前色
  if (this.state === 'playing' && !this.hudAnim) {
    this.hudIdleClock -= dt;
    if (this.hudIdleClock <= 0) {
      this.hudIdleClock = HUD_IDLE_MS;
      this.hudAnim = { fromColor: this.hudColor(this.hudMode), toColor: '#000000',
                       fromText: HUD_STATES[this.hudMode].label, toText: HUD_STATES[this.hudMode].label,
                       t: 0, dur: HUD_TRANSITION_MS, idleBack: true };
    }
  } else if (this.state === 'playing') {
    // 动画进行中重置计时，避免打断
    this.hudIdleClock = HUD_IDLE_MS;
  }
  // 脉冲第二段：黑 → 当前色
  if (this.hudIdleStep === 'toBlack' && !this.hudAnim) { ... }
}
```

> 更简单可靠的实现：用两段动画串。第一段到黑结束后自动发起第二段「黑→当前色」。字段 `hudAnim.phase`：`'idleBlack'` 结束后续接 `'idleBack'`。

### 绘制（`drawUI()` 战斗分支内，`renderGraph` 之后）
```js
this.drawHudIndicator();
```
```js
drawHudIndicator() {
  const g = this.uiG;
  const st = HUD_STATES[this.hudMode];
  let fillColor = st.color, label = st.label;
  if (this.hudAnim) {
    const p = Math.min(1, this.hudAnim.t / this.hudAnim.dur);
    const w = HUD_RECT_W * p;   // 左到右：左半目标色，右半来源色
    g.fillStyle(color(this.hudAnim.toColor), 1);
    g.fillRect(HUD_RECT_X, HUD_RECT_Y, w, HUD_RECT_H);
    g.fillStyle(color(this.hudAnim.fromColor), 1);
    g.fillRect(HUD_RECT_X + w, HUD_RECT_Y, HUD_RECT_W - w, HUD_RECT_H);
    fillColor = null; // 两段式
    label = this.hudAnim.toText;
  } else {
    g.fillStyle(color(fillColor), 1);
    g.fillRect(HUD_RECT_X, HUD_RECT_Y, HUD_RECT_W, HUD_RECT_H);
  }
  // 居中文本（黑底脉冲时文本用当前状态文本，颜色白色）
  const text = label || st.label;
  const textColor = this.hudAnim && this.hudAnim.toColor === '#000000'
    ? '#ffffff' : (st.text || '#000000');
  // 用 uiTexts 或直接 add.text（建议复用既有 hud 文本机制，或简单 this.add.text + cameras.main.ignore）
}
```

> 文本建议新建场景字段 `this.hudIndicatorText`（`this.add.text(...)`，`this.cameras.main.ignore()`，`setDepth(1001)`），在 `drawUI` 中 `setText/setColor/setPosition`，在非战斗分支 `setVisible(false)`。

### 触发事件映射（`fireTrigger`）
```js
fireTrigger(t) {
  for (const ev of (t.events || [])) {
    if (ev.type === 'spawnEnemy') { this.triggerSpawnEnemy(t, ev); }
    else if (ev.type === 'switchLevel') { this.beginSwitch(ev); }
    else if (ev.type === 'spawnGate') { this.setGatesActive(ev, true); }
    else if (ev.type === 'removeGate') { this.setGatesActive(ev, false); }
    else if (ev.type === 'combat') { this.setHudMode('combat'); }
    else if (ev.type === 'roomComplete') { this.setHudMode('secure', { autoReturn: { mode: 'explore', delay: 1500 } }); }
    else if (ev.type === 'complete') { this.state = 'end'; this.settleVictory(); }
  }
}
```

### 关联改造
- `updateTriggers()`：`t.action === 'spawnEnemy'` → `t.events.some(e => e.type === 'spawnEnemy')`；`t.action === 'switchLevel'` → `t.events.some(e => e.type === 'switchLevel')`。
- `triggerSpawnEnemy(t, ev)`：改用 `ev.spawn`（原 `t.spawn`）。
- `setGatesActive(ev, activate)`：改用 `ev.gateIds`（原 `t.gateIds`）。
- `beginSwitch(ev)`：改用 `ev.target / ev.spawnPoint`（原 `t.target/t.spawnPoint`）。
- `hasPendingSpawnWaves()`：遍历 `t.events` 找 spawnEnemy。
- `stopTriggerSpawn(t)`、`runTriggerWave` 等沿用 `t.id` 键的 triggerState，无需改。

## 四、属性面板（`src/main.js`）

触发器字段区重构为「事件列表编辑器」（参照宝箱奖励编辑器模式）：
- 基础字段：x/y/w/h/shape/color/once/cooldown/visible。
- 「事件列表」：每张事件卡 = 类型下拉 + 该类型参数 + 删除按钮 +「添加事件」按钮。
- 事件类型下拉：
  | value | label |
  |---|---|
  | complete | 整体通关标记 |
  | roomComplete | 单房间通关标记 |
  | combat | 触发战斗 |
  | spawnEnemy | 召唤敌人 |
  | switchLevel | 切换关卡 |
  | spawnGate | 生成能量门 |
  | removeGate | 消除能量门 |
- 各类型参数复用现有逻辑：
  - spawnEnemy：spawnZoneId / stopOnExit / resumeOnReturn / 波数 / 每波字段，路径改为 `events[i].spawn.*`
  - switchLevel：target / spawnPoint.x / spawnPoint.y
  - spawnGate/removeGate：gateIds 多选
- 数据写入 `entity.events`，触发 `renderEntityProperties()` 与 `saveDraft`。

## 五、验证清单
1. `node --check` 全部改动文件。
2. `normalizeTrigger` 往返：旧 `action:'complete'` → `events:[{type:'complete'}]`；新多事件数组保留。
3. 播放测试（新关卡放触发器）：combat 事件 → 顶部矩形变红；roomComplete → 变绿 1.5s 回白；complete → 结算；多事件（combat+spawnEnemy）同时生效。
4. 常态 3s 黑脉冲动画正常。
