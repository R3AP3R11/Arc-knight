#图层技术方案

## 1. 文档目的

本文档定义界面 UI 系统的渲染、数据与编辑方案。

一个界面（屏幕）由两部分组成：

```text
界面（一个屏幕）
├── 关卡（level）
│   └── 只放置 actor（玩家 / 敌人 / 墙体 / 触发器），不承载 UI 与业务功能
└── 顶层界面 UI（独立图层，浮在关卡上方）
    └── 由 UI 功能读取 UI 图文件动态绘制
```

UI 功能职责：

- 负责绘制 UI 图（UI 支持动态数据绑定，非静态贴图）。
- UI 图以文件形式存在项目文件中，运行期读取渲染。
- 编辑器提供 UI 配置面板，可视化编辑 UI 图文件并保存。

目标界面：

- 游戏主界面（HUD）：战斗中常驻的玩家状态信息。
- 成长界面：展示与提升玩家成长数据的模态面板。

## 2. 需求范围

### 2.1 游戏主界面（HUD）

- 生命值条与数值。
- 等级与经验进度。
- 金币数量。
- 击杀统计（可选）。
- 常驻显示，不拦截战斗输入。

### 2.2 成长界面

- 模态面板，打开时暂停战斗循环。
- 展示玩家等级、经验、金币等成长数据。
- 预留强化入口（武器升级 / 属性加点 / 金币商店），内容当前未最终确定，按数据驱动方式设计，便于后续增减。

### 2.3 渲染技术选型

采用 **Phaser Graphics 屏幕空间图层**：

- 复用现有 `Graphics` 矢量绘制体系。
- UI 以屏幕坐标（固定 1920×1080 视口）绘制。
- 使用独立 UI 相机承载，不随世界相机滚动与缩放。
- 与玩家本体的矢量美术风格统一。

### 2.4 编辑器 UI 配置面板

- 编辑器内单开一页，入口放在 HTML 顶层（`header`）。
- 编辑 UI 图文件（`data/ui/*.json`）：HUD 各元素（血条 / 金币 / 等级 / 击杀）的显隐、位置、尺寸、颜色。
- 编辑成长面板的展示字段与强化区块条目。
- UI 图文件持久化为项目文件，运行期 UI 读取同一份图文件渲染。

## 3. 当前实现现状

当前相关代码在 `src/game-scene.js`：

- 场景类 `EditorScene extends Phaser.Scene`。
- `create()` 中仅创建世界绘图对象 `this.g = this.add.graphics()`。
- `draw()` 每帧清空并重绘世界（背景、网格、墙体、触发器、敌人、玩家、子弹、激光）。
- 玩家属性已具备：`this.hp`（生命值，`restart()` 中初始化为 100）、`level`（等级）、`gold`（金币，后两者随 `l.spawn` 展开到 `this.player`）。
- 战斗循环 `update()` 中 `if (this.state !== 'playing') return;` 已具备暂停语义，可直接被成长界面复用。
- 运行模式通过 `this.editing` 区分编辑 / 游玩，UI 仅在游玩模式显示。

当前缺口：

- 没有任何运行期 UI 图层。
- 无 HUD，玩家生命值、等级、金币不可见。
- 无成长界面。
- 无 UI 专用相机，UI 若直接画在世界图层会随相机滚动缩放。
- 无 UI 文本绘制能力（当前只用 `Graphics`，未使用 `Text`）。

## 4. 总体架构

```text
界面（一个屏幕）
├── 关卡层（level，只放 actor）
│   └── Phaser.Scene (EditorScene)
│       ├── 世界相机 cameras.main
│       │   └── this.g：世界图层（背景 / 实体 / 玩家 / 子弹）
│       └── UI 相机 uiCam（zoom=1, scroll=0, 上层）
│           └── this.uiLayer：UI 图层 ← UI 功能渲染
│
└── UI 图文件（项目文件，驱动 UI 图层）
    ├── data/ui/hud.json      → 游戏主界面 HUD
    └── data/ui/growth.json   → 成长界面
         │
         ├─ 编辑器 UI 配置面板：可视化编辑并保存 UI 图文件
         └─ UI 功能（渲染器）：读取 UI 图文件 + 动态数据绑定 → 绘制
```

层级关系：

- 关卡层只放置 actor，不含 UI 定义；UI 与关卡解耦，互不污染数据。
- UI 图文件是项目资产，描述界面元素与动态绑定，可编辑、可持久化、可版本管理。
- 世界相机先渲染，UI 相机后渲染，UI 永远覆盖在关卡上方。
- UI 相机 `zoom = 1`、`scroll = (0,0)`，视口固定为 1920×1080，与关卡相机解耦。
- 战斗逻辑与 UI 只通过一份 `uiState` 数据通信，UI 不直接修改战斗状态。

## 5. UI 相机与图层

### 5.1 UI 相机跟随界面相机（屏幕视口）

UI 相机的大小必须跟随**界面相机（屏幕视口）**，即 Phaser 游戏画布的固定尺寸 `VIEW_W × VIEW_H`（1920×1080，与 `main.js` 中 `W`/`H` 一致），而不是跟随局内相机。

局内相机（`cameras.main`）的可视世界范围是可调整的：`src/game-scene.js` 中 `cameraSize()` 读取 `level.camera.width`（编辑器「视口宽度」），高度按 16:9 自动推导，`playZoom()` 再据此缩放世界相机，使可视世界面积随配置变化：

```js
// src/game-scene.js
cameraSize() {
  const cw = ctx.state.level.camera.width;
  return { w: cw, h: Math.round(cw * VIEW_H / VIEW_W) };
}

playZoom() {
  const { w: ww, h: wh } = this.worldSize();
  const c = this.cameraSize();
  return Math.min(VIEW_W / Math.min(c.w, ww), VIEW_H / Math.min(c.h, wh));
}
```

无论 `camera.width` 如何调整，屏幕视口始终是 1920×1080。因此 UI 相机必须与局内相机完全解耦：固定视口、`zoom=1`、`scroll=(0,0)`，不调用 `playZoom()`，也不参与 `updatePlayCamera()` 的跟随与缩放。

在 `create()` 中，在世界图层之后创建 UI 相机与 UI 容器：

```js
create() {
  this.g = this.add.graphics();               // 世界图层（跟随局内相机）

  // UI 相机视口 = 界面相机（屏幕）固定 1920×1080
  this.uiCam = this.cameras.add(0, 0, VIEW_W, VIEW_H);
  this.uiCam.setScroll(0, 0).setZoom(1);
  this.uiLayer = this.add.container(0, 0);
  this.uiLayer.setScrollFactor(0).setDepth(1000);

  // 相机互斥：局内相机不画 UI，UI 相机不画世界
  this.cameras.main.ignore(this.uiLayer);
  this.uiCam.ignore(this.g);
}
```

要点：

- `this.uiLayer` 使用 `Phaser.GameObjects.Container`，承载所有 UI 子对象（`Graphics`、`Text`）。
- UI 相机在 `cameras.main` 之后 `add`，Phaser 按添加顺序渲染，UI 自然覆盖世界。
- UI 元素坐标直接使用屏幕坐标（0~1920 / 0~1080），无需换算世界坐标，也不随 `camera.width` 调整而缩放。
- 若未来游戏画布尺寸调整，UI 相机视口应同步取自 `VIEW_W` / `VIEW_H` 常量，而非硬编码 1920/1080。

### 5.2 与局内相机的关系对照

| 相机 | 视口大小 | 缩放 | 跟随对象 | 可视世界范围 |
|---|---|---|---|---|
| 局内相机 `cameras.main` | 固定 1920×1080 | `playZoom()` 动态 | 玩家 | 由 `level.camera.width` 决定，可调整 |
| UI 相机 `uiCam` | 固定 1920×1080 | 恒为 1 | 无 | 恒等于屏幕视口 |

局内相机的 `cameraSize()` / `playZoom()` / `updatePlayCamera()` 全部只作用于 `cameras.main`，UI 相机不共享这些逻辑。

### 5.3 编辑模式处理

编辑器使用 HTML 面板（`index.html` 的 `#editorPanel`），运行期 UI 只在游玩模式启用：

```js
this.uiLayer.setVisible(!this.editing);
```

编辑器切换（`setMode`）时重建场景，`restart()` / `create()` 中按 `this.editing` 决定是否创建与显示 UI。

此外，编辑器侧另有独立的 **UI 配置面板**（HTML 单开一页，见 7.5），只编辑 UI 图文件、不在画布上渲染 UI。二者职责分离：配置页负责文件，运行期场景负责绘制。

### 5.4 文本绘制

UI 需要显示数值与标签，引入 Phaser `Text`：

```js
this.add.text(x, y, 'Lv.1', {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffffff'
}).setScrollFactor(0).setDepth(1001);
```

文本统一添加到 `this.uiLayer`，随 UI 图层一起显示 / 隐藏。`Graphics` 只负责形状（面板、进度条、图标），文本负责数字与标签，二者组合成完整 UI 组件。

## 6. UI 绘制组件

新建 `src/ui-layer.js`，提供纯函数式绘制组件与 UI 图渲染器，风格与现有 `drawRing` / `drawHexagonBody` 一致。

### 6.1 组件 API

```js
// 面板：圆角矩形背景 + 描边
export function drawPanel(g, x, y, w, h, { fill, stroke, radius = 8, alpha = 0.9 });

// 进度条：底槽 + 按比例填充
export function drawBar(g, x, y, w, h, ratio, { bg, fill, stroke });

// 图标：金币圆形图标 / 生命心形等简单矢量
export function drawCoinIcon(g, x, y, r);
export function drawHeartIcon(g, x, y, r);

// 按钮：矩形 + 居中文本（返回命中区域）
export function drawButton(g, x, y, w, h, label, { fill, stroke, disabled });

// 渲染器：读取 UI 图文件，遍历 nodes 绘制，解析 bind 动态绑定
export function renderGraph(g, graph, uiState, bindings);
```

所有绘制函数返回一个可选的命中矩形，供输入系统做按钮点击检测。

### 6.2 节点类型与组件映射

UI 图文件 `nodes` 的 `type` 字段与绘制组件一一对应：

| `type` | 组件 | 关键属性 |
|---|---|---|
| `panel` | `drawPanel` | `x/y/w/h`、`fill/stroke/radius` |
| `bar` | `drawBar` | `x/y/w/h`、`bg/fill`、`bind.ratio` |
| `text` | Phaser `Text` | `x/y`、`size/color`、`bind.text` |
| `icon` | `drawCoinIcon` 等 | `x/y/r`、`kind` |
| `button` | `drawButton` | `x/y/w/h`、`label`、`disabled` |

### 6.3 颜色约定

| 用途 | 建议色值 |
|---|---|
| 面板背景 | `#0e2233`（深蓝，与关卡底色 `#0b1b2b` 同系） |
| 面板描边 | `#2f5a7a` |
| 血条底槽 | `#3a1f2b` |
| 血条填充 | `#e84c5e` |
| 经验条填充 | `#4fc3f7` |
| 金币 | `#ffd54f` |
| 按钮常态 | `#2f5a7a` |
| 按钮高亮 | `#4fc3f7` |
| 文本主色 | `#eaf4fb` |
| 文本次要 | `#9fc3d8` |

颜色集中定义为常量，便于统一调整：

```js
export const UI_COLORS = {
  panelBg: '#0e2233',
  panelStroke: '#2f5a7a',
  hpBg: '#3a1f2b',
  hpFill: '#e84c5e',
  expFill: '#4fc3f7',
  coin: '#ffd54f',
  text: '#eaf4fb',
  textDim: '#9fc3d8'
};
```

颜色优先从 UI 图文件节点属性读取，`UI_COLORS` 仅作为缺省兜底，保持渲染器对未指定颜色节点的兼容。

## 7. UI 数据模型

### 7.1 UI 图文件（界面定义）

UI 图是界面的文件化定义，以 JSON 文件形式存在项目中（`data/ui/*.json`），每个界面一个文件：

```text
data/ui/
├── hud.json       → 游戏主界面
└── growth.json    → 成长界面
```

UI 图文件描述一棵 UI 元素树，节点类型与绘制组件一一对应（`panel` / `bar` / `text` / `icon` / `button`），节点声明坐标、尺寸、颜色等静态样式，以及数据绑定（动态部分，见 7.2）。

HUD 图文件示例 `data/ui/hud.json`：

```json
{
  "id": "hud",
  "name": "游戏主界面",
  "nodes": [
    { "id": "hpBar", "type": "bar", "x": 40, "y": 40, "w": 360, "h": 28,
      "fill": "#e84c5e", "bg": "#3a1f2b", "bind": { "ratio": "hpRatio" } },
    { "id": "hpText", "type": "text", "x": 40, "y": 20,
      "size": 24, "color": "#eaf4fb", "bind": { "text": "hpText" } },
    { "id": "coinIcon", "type": "icon", "kind": "coin", "x": 1560, "y": 40, "r": 16 },
    { "id": "goldText", "type": "text", "x": 1580, "y": 40,
      "size": 24, "color": "#ffd54f", "bind": { "text": "gold" } }
  ]
}
```

成长界面图文件 `data/ui/growth.json` 同理：静态部分描述面板背景、标题、关闭按钮；`stats` 展示字段与 `sections` 强化条目也写入文件，后续增减条目只改文件不改渲染代码。

```json
{
  "id": "growth",
  "name": "成长界面",
  "nodes": [
    { "id": "panel", "type": "panel", "x": 360, "y": 140, "w": 1200, "h": 800 },
    { "id": "levelText", "type": "text", "x": 420, "y": 200, "bind": { "text": "level" } }
  ],
  "stats": [
    { "key": "level", "label": "等级" },
    { "key": "exp", "label": "经验", "progress": true },
    { "key": "gold", "label": "金币" },
    { "key": "kills", "label": "击杀" }
  ],
  "sections": [
    {
      "id": "weapon",
      "title": "武器强化",
      "entries": [{ "id": "weaponLevel", "label": "武器等级", "cost": { "gold": 200 } }]
    }
  ]
}
```

第一版基线：成长界面至少展示 `stats` 只读数据；`sections` 强化条目为预留入口，未确定时渲染为禁用态。

### 7.2 动态数据绑定

UI 支持动态：元素的文本、进度比例等属性绑定到 `uiState` 的派生值，运行期每帧求值并刷新。绑定键由代码注册表解析，UI 图文件只引用绑定键，不写实现：

```js
// src/ui-bindings.js
export const BINDINGS = {
  hpRatio: s => s.hp / s.maxHp,
  hpText: s => `${s.hp}/${s.maxHp}`,
  expRatio: s => s.exp / s.expToNext,
  gold: s => String(s.gold),
  level: s => `Lv.${s.level}`,
  kills: s => String(s.kills)
};
```

渲染流程：

```text
读取 UI 图文件
  ↓
遍历 nodes
  ├─ 静态属性直接使用
  └─ bind 属性 → 查 BINDINGS 键 → 用 uiState 求值
  ↓
绘制到 UI 图层
```

绑定键缺失或类型不符时使用默认值并记录警告，不中断渲染。

### 7.3 运行期 UI 状态

UI 只读地反映战斗状态，每帧由战斗数据映射生成：

```js
this.uiState = {
  screen: 'hud',      // 'hud' | 'growth'
  hp: 100,
  maxHp: 100,
  level: 1,
  exp: 0,
  expToNext: 100,
  gold: 0,
  kills: 0,
  weaponLevel: 1
};
```

刷新时机：

- `restart()` 时初始化。
- `update()` 中当 HP / 金币 / 击杀变化时更新对应字段。
- UI 只在数值变化时重绘，避免每帧重建 `Text` 对象。

### 7.4 玩家属性补全

当前 `this.hp` 为场景级字段，等级、金币来自 `l.spawn`。为支撑 UI 展示与成长，建议统一到 `src/state.js` 的玩家出生点默认值：

```js
spawn: {
  x: 130,
  y: 300,
  scheme: 'default',
  hp: 100,
  maxHp: 100,
  level: 1,
  exp: 0,
  expToNext: 100,
  gold: 0
}
```

`normalizeLevel()` 的 `spawn` 合并逻辑（`{ ...clone(DEFAULT_LEVEL.spawn), ...(data.spawn || {}) }`）会自动兼容旧关卡，无需手工迁移。

### 7.5 编辑器 UI 配置面板（独立页）

需求确定：编辑器内新增 UI 配置面板，**单开一页**，**入口放在 HTML 顶层**。

#### 入口

`index.html` 顶层 `header` 增加「UI 配置」按钮，与现有模式按钮并列：

```html
<header>
  <h1>战术关卡工作台</h1>
  <div class="mode-buttons">
    <button id="editorMode" class="active">关卡编辑</button>
    <button id="playMode">游戏预览</button>
    <button id="flowPlay">流程试玩</button>
    <button id="uiConfig">UI 配置</button>   <!-- 顶层入口 -->
  </div>
</header>
```

#### 页面形态

- `<main>` 之外新增隐藏的全屏配置页 `<section id="uiConfigPage" hidden>`。
- 点击「UI 配置」隐藏 `<main>`，显示配置页；点击返回按钮切回关卡编辑。
- 页面与关卡编辑、游戏预览互斥，一次只显示一个视图。

#### 配置内容

与运行期组件一一对应，全部数据驱动：

| 分组 | 可配置项 |
|---|---|
| HUD · 生命值 | 显隐、坐标 `x/y`、宽高 `w/h`、填充色 |
| HUD · 金币 | 显隐、坐标、颜色 |
| HUD · 等级 / 经验 | 显隐、坐标、宽高、填充色 |
| HUD · 击杀 | 显隐、坐标 |
| 成长 · 展示字段 | `stats` 列表（等级 / 经验 / 金币 / 击杀） |
| 成长 · 强化区块 | `sections` 条目（标签、消耗金币） |

#### 数据模型

UI 配置面板直接编辑 UI 图文件（`data/ui/*.json`），界面文件即数据模型，不引入额外中间配置对象。配置页按 UI 图文件结构渲染表单：

- `nodes` 节点树：编辑每个节点的坐标 / 尺寸 / 颜色 / 绑定键。
- `stats` / `sections`：编辑成长界面的展示字段与强化条目。

#### 持久化

仿照 `flow` 的读写方式：

- `server.js` 增加 `GET/POST /api/ui/:id`，按 `data/ui/:id.json` 读写 UI 图文件。
- `src/api.js` 增加 `getUi(id)` / `saveUi(id, graph)`。
- `src/state.js` 的 `createState()` 增加 `ui`（UI 图文件集合）字段，`initialize()` 中加载 `hud` / `growth`。

#### 运行时联动

- `src/ui-layer.js` 实现 UI 图渲染器：读 `nodes` → 调用对应绘制组件 → 解析 `bind` 动态绑定。
- `src/ui-bindings.js` 提供绑定键注册表，UI 图文件只引用键名，不写实现。
- `src/game-scene.js` 绘制 UI 时读取 `ctx.state.ui`，不再使用硬编码布局。
- 配置页是 HTML 表单编辑 UI 图文件，运行期是 Phaser 按图文件绘制，两者只共享文件、不共享渲染代码。

## 8. 游戏主界面（HUD）设计

### 8.1 布局

固定屏幕 1920×1080，四角布局（即 `data/ui/hud.json` 的默认内容，可在 UI 配置面板调整）：

```text
┌─────────────────────────────────────────────┐
│  HP [████████░░] 82/100    金币 ◎ 1,240      │
│                                            │
│                                            │
│                                            │
│                                            │
│  Lv.1  [████░░░░]  击杀 12                │
└─────────────────────────────────────────────┘
```

| 区域 | 位置 | 内容 |
|---|---|---|
| 生命值 | 左上 (40, 40) | 血条（360×28）+ 数值 `82/100` |
| 金币 | 右上 (1560, 40) | 金币图标 + 数值 |
| 等级 / 经验 | 左下 (40, 1000) | `Lv.1` + 经验条（280×16） |
| 击杀 | 左下偏右 (360, 1000) | 击杀图标 + 数值 |

### 8.2 绘制流程

HUD 常驻，每次 `draw()` 末尾由 UI 图渲染器按图文件绘制：

```js
draw() {
  // ... 世界绘制
  if (!this.editing) this.drawUI();
}

drawUI() {
  const g = this.uiGraphics;      // 挂到 uiLayer 的 Graphics
  g.clear();
  // 读取 UI 图文件，遍历 nodes 绘制，解析 bind 动态绑定
  renderGraph(g, ctx.state.ui.hud, this.uiState, BINDINGS);
}
```

渲染器 `renderGraph` 对每个节点：静态属性直接使用，`bind` 属性查 `BINDINGS` 键并用 `uiState` 求值（血条比例、数值文本等）。

性能要点：形状类节点每帧重绘成本低；文本类节点在绑定值变化时才 `setText`，避免每帧重建对象。

## 9. 成长界面设计

### 9.1 打开与关闭

- 打开：键盘 `ESC` / `P`，或关卡结束时自动弹出（预留）。
- 打开时设置 `this.state = 'paused'`，`update()` 已具备 `if (this.state !== 'playing') return;` 的早退，战斗自然暂停。
- 关闭：点击关闭按钮或再次按 `ESC`，恢复 `this.state = 'playing'`。

### 9.2 布局

居中模态面板，约 1200×800：

```text
        ┌────────────────────────────┐
        │  成长                    ✕ │
        ├──────────────┬─────────────┤
        │  等级  Lv.1    │  武器强化    │
        │  经验  ███░░   │  · 武器等级  │
        │  金币  1,240   │  属性加点    │
        │  击杀  12      │  · 生命上限  │
        └──────────────┴─────────────┘
```

- 左栏：成长数据只读展示（等级、经验条、金币、击杀）。
- 右栏：强化 / 加点 / 商店入口列表，未确定的条目渲染为禁用态。
- 右上角：关闭按钮。

### 9.3 状态机

```text
hud ──ESC/升级/结束──▶ growth ──关闭/ESC──▶ hud
```

场景状态与 UI 状态联动：

| 场景 state | UI screen | 说明 |
|---|---|---|
| `playing` | `hud` | 战斗进行，HUD 常驻 |
| `paused` | `growth` | 成长面板打开，战斗暂停 |
| `end` | `growth` | 关卡结束弹出成长面板（预留） |

## 10. 输入与交互路由

### 10.1 输入优先级

UI 按钮命中必须优先于战斗输入。当前 `pointerDown` 在 `!editing` 分支处理 `restart`，需扩展：

```text
pointerDown
  ↓
screen === 'growth'？
  ├─ 是：命中关闭按钮 → 关闭面板
  │      命中强化条目 → 执行升级（预留）
  │      其余 → 拦截，不传给战斗
  └─ 否：走现有战斗 / restart 逻辑
```

### 10.2 命中检测

按钮命中区域由绘制组件返回：

```js
function hitButton(ui, px, py) {
  return ui.buttons.find(b =>
    px >= b.x && px <= b.x + b.w &&
    py >= b.y && py <= b.y + b.h
  );
}
```

### 10.3 键盘

在 `create()` 的 `addKeys` 中补充：

```js
this.keys.ESC = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
```

`update()` 中检测边沿触发，避免按住重复弹开关闭：

```js
if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.toggleGrowth();
```

## 11. 生命周期与状态机

### 11.1 场景生命周期

```text
create()
  ├─ 创建世界图层 this.g
  ├─ 创建 UI 相机与 UI 图层
  ├─ 绑定输入
  └─ restart()

restart()
  ├─ 重置战斗状态（hp / kills / bullets / player）
  ├─ 初始化 uiState
  └─ 创建 / 重置 UI 文本对象

update(dt)
  ├─ state === 'playing' 时更新战斗
  ├─ 同步 uiState
  └─ draw()（世界 + HUD / 成长面板）

draw()
  ├─ 世界图层绘制
  └─ 非编辑模式绘制 UI 图层
```

### 11.2 UI 对象管理

- 形状类对象（面板、进度条）用 `Graphics` 每帧重绘。
- 文本类对象在 `restart()` 时创建一次，之后只 `setText`。
- 切回编辑器时销毁场景，UI 对象随之释放，无需额外清理。

## 12. 涉及文件

| 文件 | 改造内容 |
|---|---|
| `data/ui/hud.json` | 新增：游戏主界面 UI 图文件 |
| `data/ui/growth.json` | 新增：成长界面 UI 图文件 |
| `src/ui-layer.js` | 新增：UI 图渲染器（读 `nodes` → 绘制组件）、绘制组件、颜色默认值、按钮命中工具 |
| `src/ui-bindings.js` | 新增：动态绑定键注册表（`hpRatio` / `gold` / `level` 等） |
| `src/game-scene.js` | 新增 UI 相机与 UI 图层；读取 `ctx.state.ui` 渲染；输入路由；ESC 键绑定；状态机扩展 |
| `src/ui-config.js` | 新增：UI 配置页渲染、编辑 UI 图文件、保存 / 加载逻辑 |
| `src/state.js` | 玩家出生点默认值补 `hp/maxHp/exp/expToNext/gold`；`createState()` 增加 `ui`（UI 图文件集合）字段 |
| `src/main.js` | 出生点属性面板同步新增字段（可选）；`initialize()` 加载 UI 图文件；「UI 配置」入口绑定与页面切换 |
| `index.html` | `header` 顶层增加「UI 配置」入口；新增 `<section id="uiConfigPage" hidden>` 全屏配置页 |
| `src/ui.js` | `getDom` 增加 `uiConfig` / `uiConfigPage` 等元素 ID |
| `server.js` / `src/api.js` | 增加 `GET/POST /api/ui/:id`，按 `data/ui/:id.json` 读写 UI 图文件 |

## 13. 分阶段实施

### 阶段一：UI 图层基础设施 + UI 图渲染器

- 新建 `src/ui-layer.js`，实现 `drawPanel` / `drawBar` / `drawCoinIcon` 等组件，及 UI 图渲染器（读 `nodes` → 绘制）。
- 新建 `src/ui-bindings.js`，实现绑定键注册表。
- 新建 `data/ui/hud.json`、`data/ui/growth.json` 骨架文件。
- 在场景中创建 UI 相机与 UI 图层，实现相机互斥与显示开关（编辑模式隐藏）。
- 完成标准：读取 UI 图文件，游玩模式渲染出一个固定不随关卡滚动的测试面板。

### 阶段二：游戏主界面 HUD

- 玩家属性补全（`hp/maxHp/level/exp/gold`）。
- 完善 `data/ui/hud.json` 节点与绑定。
- 渲染器按图文件绘制 HUD，动态绑定生命值 / 金币 / 等级 / 击杀。
- 完成标准：战斗中实时显示生命值、等级、金币、击杀，切换关卡不残留旧值。

### 阶段三：成长界面

- 完善 `data/ui/growth.json`（面板、展示字段、预留强化条目）。
- 模态面板绘制与打开 / 关闭逻辑。
- `ESC` 键与关闭按钮交互。
- 完成标准：战斗可按 `ESC` 暂停并打开成长面板，关闭后恢复战斗。

### 阶段四：强化与商店（内容确定后）

- 按 `data/ui/growth.json` 的 `sections` 逐项启用强化条目。
- 金币扣除、属性提升、武器升级逻辑。
- 完成标准：成长面板可消耗金币提升玩家属性并实时生效。

### 阶段五：编辑器 UI 配置面板（独立页）

- `index.html` `header` 顶层增加「UI 配置」入口与全屏配置页。
- 新建 `src/ui-config.js` 编辑 UI 图文件（`nodes` / `stats` / `sections`）。
- `server.js` / `src/api.js` 增加 `GET/POST /api/ui/:id`，读写 `data/ui/:id.json`；`createState()` 增加 `ui` 字段。
- 完成标准：在配置页改 HUD 位置 / 颜色或成长条目，保存后进入游玩模式立即生效，刷新页面后配置仍在。

## 14. 风险与处理

| 风险 | 处理方案 |
|---|---|
| UI 随世界相机缩放 | 使用独立 UI 相机 `zoom=1`，主相机 `ignore` UI 图层 |
| UI 文本字体 / 字号不一致 | 统一在 `ui-layer.js` 定义文本样式常量 |
| 每帧重建 Text 导致卡顿 | 文本对象创建一次，数值变化时仅 `setText` |
| 成长面板打开时战斗仍运行 | 打开时 `state='paused'`，复用现有 `update` 早退逻辑 |
| UI 按钮误触战斗输入 | 成长面板打开时拦截指针事件，不传给战斗分支 |
| 旧关卡缺成长字段 | `normalizeLevel` 合并默认值自动补齐 |
| UI 遮挡关卡内容 | HUD 贴四角小区域，成长面板为可关闭模态层 |
| 多相机绘制顺序不稳定 | UI 相机在 `cameras.main` 之后 `add`，并显式 `setDepth` |

## 15. 验收标准

1. 游玩模式显示 HUD，编辑模式不显示 HUD。
2. HUD 不随世界相机滚动或缩放，位置固定。
3. HUD 实时显示生命值、等级、金币、击杀数。
4. 生命值条按 `hp / maxHp` 比例填充，数值同步。
5. 金币、击杀数变化后 HUD 数值即时更新。
6. 按 `ESC` 暂停战斗并打开成长面板。
7. 成长面板展示等级、经验、金币、击杀等只读数据。
8. 点击关闭按钮或按 `ESC` 关闭面板并恢复战斗。
9. 成长面板打开时战斗完全暂停（玩家、敌人、子弹均不动）。
10. 成长面板打开时点击面板外不触发战斗或关卡重启。
11. 切换关卡后 HUD 数值不残留上一关数据。
12. 加载旧版关卡数据时成长字段自动补默认值。
13. 导出、导入 JSON 后成长字段保持一致。
14. 流程试玩（多关连续）时 HUD 与成长面板正常刷新。
15. `header` 顶层显示「UI 配置」入口。
16. 点击「UI 配置」切换为独立配置页，可返回关卡编辑，一次只显示一个视图。
17. 配置页可编辑 UI 图文件（`nodes` 节点坐标 / 尺寸 / 颜色 / 绑定键，及成长 `stats` / `sections`）。
18. 配置保存后进入游玩模式，HUD 与成长面板立即按新配置渲染。
19. UI 图文件持久化到 `data/ui/*.json`，刷新页面后配置保留。
20. UI 定义以独立 UI 图文件存在项目中，关卡 JSON 只含 actor、不含 UI。
21. 动态绑定生效：绑定键（如 `hpRatio` / `gold`）在运行期随 `uiState` 变化实时刷新。

## 16. 暂不实现范围

第一版暂不实现：

- 成长界面的具体强化 / 加点 / 商店逻辑（内容未定，仅预留禁用入口）。
- 暂停菜单、设置菜单、音量控制等系统界面。
- UI 动画与过渡效果（淡入淡出、弹出动画）。
- 分辨率自适应（当前视口固定 1920×1080）。
- 本地化多语言。
- 小地图、任务指引等战斗辅助 UI。
- UI 皮肤 / 主题切换。

以上能力待成长内容确定、基础 UI 图层稳定后按需扩展。
