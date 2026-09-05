---
name: level-design
description: 改关卡结构（房间/墙体/世界尺寸）、触发器与敌人波次、刷怪点与可达性、宝箱传送门售货机神像等交互物、关卡开场与通关切换流程，以及 data/levels/*.json schema 时读这份。
---

# 关卡设计 开发指南

## 1. 这块负责什么

管「一张关卡长什么样、玩家进去会发生什么」——关卡数据 schema、房间/墙体布局生成、触发器事件与敌人波次调度、刷怪点求解、场景交互物、开场演出与关卡间切换。

功能边界：

| 属于本分类 | 不属于（去别的 skill） |
| --- | --- |
| `data/levels/*.json` schema 与 `normalizeLevel` 全部字段 | 玩家存档 schema（`src/player-data.js`）→ economy-numbers skill |
| 触发器点火、事件派发、波次定时链、门开合 | 敌人 AI 追击/环绕/开火 → combat skill |
| 生成点求解（屏幕外/屏幕内/召唤阵顶点）+ 可达性校验 | 敌人移动碰撞、子弹命中判定 → combat skill |
| 召唤阵与锁定框特效的推进与绘制 | HUD / 菜单页 / 商店页绘制 → ui skill |
| 宝箱出现与开箱、传送门撤离、售货机与神像 F 键交互 | 宝箱掉落物数值、神像祝福数值 → economy-numbers skill |
| 多箱庭房间布局生成（墙体 + 世界尺寸自适应） | 编辑器拖拽/框选/旋转手柄 → engine-editor skill |
| 关卡开场演出、通关结算、淡入淡出切关 | 存档写盘细节 `persistSave` → economy-numbers skill |
| 编辑器的房间面板 / 触发器事件面板 / 关卡选择面板 | 编辑器实体属性通用表单 → engine-editor skill |

策划视角可配置项（改这些不用碰逻辑，全部落在关卡 JSON 或编辑器面板）：

- 世界尺寸 `world.width/height`、相机 `camera.width/mode`、背景色/网格色、`ui` 关卡类型
- 房间布局 `roomLayout`：行列数、每格房间尺寸、墙厚、道路宽/长、墙色（房间面板可视化点选）
- 墙体 `walls[]`（矩形/圆/弧、旋转、颜色、可见性）
- 出生点 `spawn`（坐标 + 初始武器 + 等级/血量）
- 触发器 `triggers[]`：矩形/圆形范围、`once`、`cooldown`、事件列表（7 种事件类型）
- 敌人波次 `events[].spawn.waves[]`：类型/数量/生成方式/前后延迟/等待清理/召唤阵形状
- 生成区域 `spawnZones[]`（屏幕内随机生成的矩形范围）
- 交互物：`chests[]`、`portals[]`、`vendors[]`、`idols[]`、`icons[]`、`gates[]`
- 可破坏物：`crates[]`、`barrels[]`
- 静态美术：`background`（图片或 wormhole 特效）、`images[]`
- 关卡内预置敌人 `enemies[]`、掉落规则 `dropRules`（数值详见 economy-numbers skill）

## 2 文件地图

| 文件路径 | 职责 | 关键导出 | 行数 |
| --- | --- | --- | --- |
| `src/systems/level/spawning.js` | 生成点求解 + 可达性校验 + 召唤阵/锁定框特效 | `SpawningMixin`（17 方法） | 398 |
| `src/systems/level/triggers.js` | 触发器点火 / 事件派发 / 波次定时链 / 门开合 | `TriggersMixin`（11 方法） | 242 |
| `src/systems/level/interactables.js` | 宝箱、传送门、售货机、神像、图标交互；`openIdolOffer` 按 `IDOL_OFFER_COUNT` 取 n 张并预载 icon 画板资产；vendor/icon 首次按 F 置运行时 `guideUsed`（指引停止用） | `InteractablesMixin`（16 方法） | 251 |
| `src/systems/level/level-flow.js` | `restart` 关卡构建、开场演出、结算、切关淡出 | `LevelFlowMixin`（9 方法） | 314 |
| `src/rooms.js` | 多箱庭房间布局生成 + 尺寸常量 | `generateRoomLayout`、`normalizeRoomLayout`、`spawnInRooms`、`clampRoomSize`、13 个常量 | 175 |
| `src/state.js` | 关卡 JSON schema 权威定义（所有 `normalize*`） | `normalizeLevel`、`normalizeTrigger`、`normalizeWave`、`normalizeChest`、`normalizePortal`、`EVENT_TYPES`、`MINIMAP_MARKER_TYPES/LABELS`、`normalizeRoomMarker`、`DEFAULT_LEVEL` | 540 |
| `src/pathfinding.js` | 网格构建 + A* 寻路（生成点可达性依赖） | `buildGrid`、`findPath`、`nearestWalkable` | 105 |
| `src/editor/room-panel.js` | 多箱庭房间面板：方格点选、尺寸弹窗、墙体重生成 | `applyRooms`、`renderRoomPanel`、`toggleRoomCell`、`updateRoomNumber` | 124 |
| `src/editor/trigger-panel.js` | 触发器事件列表编辑器（事件类型/时机/波次表单） | `renderTriggerEvents` | 240 |
| `src/editor/level-flow.js` | 关卡加载/切换/模式切换/试玩快照恢复 | `selectLevel`、`switchToLevel`、`setMode`、`restoreEditorSnapshot`、`redraw`、`fadeAndSwitch`、`startGame` | 222 |
| `src/systems/editor/editor-input.js` | 放置工具（trigger/gate/chest/portal/spawnzone…）建实体 | `EditorInputMixin`：`pointerDown`(12)、`pointerMove`(191) | 259 |
| `src/systems/constants.js` | `CELL`、`CHEST_*_FX_MS`、`GATE_SPAWN_MS`、`ENEMY_BEHAVIOR` | 见第 5 章 | 83 |
| `src/game-scene.js` | 场景装配：19 个 Mixin `Object.assign`(559)、`update` 主循环(139) | `createGameScene` | 569 |
| `src/api.js` | 关卡读写 HTTP（`/api/levels/:id`） | `loadLevel`、`saveDraft`(=`saveFormal`) | 40 |
| `data/levels/*.json` | 16 个关卡数据文件（含 `login`、`newbee`、`knight-home`） | — | — |

### 「改 X 该动哪个文件」速查

| 需求 | 动这里 |
| --- | --- |
| 加/改一种触发器事件类型 | `src/state.js:219` `EVENT_TYPES` + `normalizeTriggerEvent`(242) + `triggers.js:36` `dispatchTriggerEvent` + `trigger-panel.js:17` 参数表单 |
| 改波次字段（新增波次参数） | `src/state.js:94` `normalizeWave` + `trigger-panel.js:31-79` 表单 + `triggers.js:111` `runTriggerWave` 消费处 |
| 改屏幕内随机刷怪范围/安全半径逻辑 | `spawning.js:355` `spawnInScreen` |
| 改屏幕外环形刷怪逻辑 | `spawning.js:32` `sampleRingPoint` + `spawning.js:44` `spawnOffscreen` |
| 改召唤阵形状/动画时长 | `spawning.js:171` `createSpawnEffect`（默认值）+ `spawning.js:296` `drawSpawnEffects`（绘制） |
| 敌人卡墙 / 刷在玩家打不到的位置 | `spawning.js:107` `canSpawnAt`、`spawning.js:67` `isReachableWalkable`、`pathfinding.js:1` `buildGrid` 的 `inflate` |
| 加一种交互物（如祭坛） | `state.js` 新增 `normalizeXxx` + `normalizeLevel`(438) 挂载 + `interactables.js` 加 `updateXxxInteract` + `game-scene.js:486` 附近注册调用 + `editor-input.js:150` 附近加放置工具 |
| 改宝箱/传送门出现时机 | `state.js:149/163` 的 `trigger` 字段 + `level-flow.js:119/125`（`spawned` 初值）+ `triggers.js:183` `spawnChestsForTrigger` |
| 改门（gate）开合动画时长 | `constants.js:79` `GATE_SPAWN_MS` + `game-scene.js:150-159` 推进段 |
| 改房间尺寸/道路范围上下限 | `src/rooms.js:2-16` 常量 + `editor/bindings.js:200-216` 面板绑定 |
| 改关卡开场演出（镜头拉近时长） | `level-flow.js:35` `startLevelIntro`、`level-flow.js:50` `updateLevelIntro` |
| 改切关淡入淡出时长 | `level-flow.js:22` `SWITCH_FADE_MS`（场景内）/ `editor/level-flow.js:113` `FADE_MS`（DOM 黑屏） |
| 新增一个关卡文件 | `data/levels/<id>.json` + 编辑器「新建关卡」按钮（`editor/bindings.js:252`） |
| 通关后解锁/结算规则 | `level-flow.js:269` `settleVictory` |

## 3. 核心数据结构

`data/levels/<id>.json` 是唯一关卡数据源，读入后必过 `normalizeLevel`（`src/state.js:438`）；**归一化后的结构才是运行时契约**，缺字段会被补默认值，非法值会被 clamp。默认骨架见 `DEFAULT_LEVEL`（`src/state.js:323`）。

### 3.1 level 根字段

| 字段 | 类型 | 默认 / 取值范围 | 含义 | normalize 位置 |
| --- | --- | --- | --- | --- |
| `backgroundColor` | `#rrggbb` | `#0b1b2b` | 世界底色 | 直接透传 |
| `gridColor` | `#rrggbb` | `#173a55` | 网格线颜色 | 直接透传 |
| `showGridInPlay` | bool | `false` | 游戏态是否画网格 | 直接透传 |
| `ui` | `'battle' \| 'login' \| 'interface'` | `'battle'` | 关卡 UI 类型；`login` 判定为菜单关（`isMenuLevel`），镜头固定全图、无开场演出 | 透传 |
| `world` | `{width,height}` | 各 `max(600, v)`，默认 1920×1080 | 世界尺寸；多箱庭时由 `generateRoomLayout` 覆写 | `state.js:444` |
| `camera` | `{width,mode}` | `width max(300,v)` 默认 1920；`mode` 仅 `'center'`/`'deadzone'`（默认 deadzone） | 可见宽度决定缩放；`center` 始终居中玩家 | `state.js:448` |
| `walls[]` | 数组 | 见 3.2 | 静态墙体（同时喂寻路网格） | `state.js:452` |
| `enemies[]` | 数组 | 默认 3 只示例 | 预置敌人（进关即存在），`normalizeEnemy`(59) | `state.js:465` |
| `spawn` | 对象 | 见 3.3 | 玩家出生点 + 局内初始参数 | `state.js:474` |
| `dropRules` | 对象 | `{}` | 按敌人类型的掉落规则（详见 economy-numbers skill） | `state.js:475` |
| `triggers[]` | 数组 | `[]` | 触发器，见 3.4 | `state.js:466` |
| `crates[]` | 数组 | `[]` | 木箱：固定 `w/h=50`、`hp=1` | `normalizeCrate`(115) |
| `barrels[]` | 数组 | `[]` | 油桶：`r=30`、`hp=1`、`explodeRadius max(30,v)` 默认 150 | `normalizeBarrel`(126) |
| `chests[]` | 数组 | `[]` | 宝箱，见 3.6 | `normalizeChest`(149) |
| `portals[]` | 数组 | `[]` | 传送门（撤离点），见 3.6 | `normalizePortal`(163) |
| `vendors[]` | 数组 | `[]` | 售货机，见 3.6 | `normalizeVendor`(180) |
| `idols[]` | 数组 | `[]` | 神像，见 3.6 | `normalizeIdol`(192) |
| `icons[]` | 数组 | `[]` | 可交互图标（家园入口用），见 3.6 | `normalizeIcon`(204) |
| `gates[]` | 数组 | `[]` | 能量门（战斗封路），见 3.7 | `normalizeGate`(409) |
| `spawnZones[]` | 数组 | `[]` | 屏幕内随机刷怪矩形区域，见 3.7 | `normalizeSpawnZone`(426) |
| `background` | 对象/null | `null` | 单张背景图或 `fx:'wormhole'` 特效背景（20+ 参数，见 `state.js:353`） | `normalizeBackground`(353) |
| `images[]` | 数组 | `[]` | 装饰图片：`src` 必填，`w`默认240 `h`默认135 | `normalizeImage`(396) |
| `roomLayout` | 对象/null | `null` | 多箱庭配置；`mode!=='multi'` 直接返回 null（单箱庭） | `rooms.js:21` |

### 3.2 walls[] 墙体

| 字段 | 默认 / 范围 | 说明 |
| --- | --- | --- |
| `id` | `wall-<i+1>` | 缺省自动补号 |
| `x`,`y` | — | 中心坐标 |
| `w`,`h` | `max(v,8)`，默认 30 / 90 | `MIN_WALL_SIZE=8`（`state.js:2`） |
| `shape` | `'rect'`（可选 `circle`/`arc`） | 非法值回落 rect |
| `thickness` | `max(v,8)` 默认 30 | 圆/弧的环厚度 |
| `rotation` | 0 | 度数，寻路网格按旋转外接盒膨胀 |
| `startAngle`/`endAngle` | 0 / 360 | 仅 `arc` 用 |
| `color` | `#60758b` | `DEFAULT_WALL_COLOR` |
| `visible` | `true` | `false` 仍参与碰撞（仅不画） |
| `room` | 无（多箱庭生成时为 `true`） | `applyRooms` 重生成时只清理 `room:true` 的墙 |

### 3.3 spawn 出生点

```json
"spawn": { "x": 810, "y": 2970, "scheme": "default", "hp": 100, "maxHp": 100,
           "level": 1, "exp": 0, "expToNext": 100, "gold": 0, "weapons": ["radial"], "id": "spawn" }
```

`weapons` 过 `normalizeWeapons`：只保留 `['radial','yellow','green']` 中的项、最多 3 个、空则回落 `['radial']`。`hp/maxHp/level` 仅在编辑器预览态生效；试玩/正式游戏用存档 `combat.maxHp`（`level-flow.js:176-182`）。编辑器态血量另加 `(level-1) * LEVEL_HP_BONUS(10)`。

### 3.4 triggers[] 触发器

| 字段 | 默认 / 范围 | 含义 |
| --- | --- | --- |
| `id` | `trigger-<i+1>` | `triggerState` / `triggered` 的 key；宝箱、传送门用它绑定 |
| `x`,`y` | 0 | 中心坐标 |
| `w`,`h` | `max(v,8)` 默认 90 | `shape:'circle'` 时按 `w/2` 当半径（`hitTrigger`，`geometry.js:94`） |
| `shape` | `'rect'`（或 `circle`） | 命中形状 |
| `color` | `#f3b63f` | 编辑器显示色 |
| `visible` | `true` | 游戏态一般设 `false` |
| `once` | `true` | 只触发一次；`false` 才走 `cooldown` 重复触发 |
| `cooldown` | `max(0,v)` 默认 0 | ms；仅 `once:false` 生效 |
| `resumeOnReturn` | `true` | 旧字段，实际以 `events[].spawn.resumeOnReturn` 为准 |
| `events[]` | 至少 1 条，空则补 `[{type:'complete'}]` | 见 3.5 |

注意：含 `switchLevel` 事件的触发器**强制单次**（`triggers.js:215`）。

### 3.5 trigger.events[] 事件类型（7 种，`EVENT_TYPES` @ `state.js:219`）

所有事件共有 `when` 字段：

| `when` | 含义 | 派发位置 |
| --- | --- | --- |
| `'enter'`（默认） | 玩家进入触发器立即派发 | `triggers.js:30` |
| `'enemiesCleared'` | 异步事件：入队 `st.pendingClearEvents`，等本触发器波次全部生成完 + 其召唤敌人全灭 + 无残留锁定框后派发 | `triggers.js:27` 入队，`triggers.js:168` `checkAsyncTriggerEvents` 派发 |

| `type` | 参数 | 行为 | 处理位置 |
| --- | --- | --- | --- |
| `complete` | 无 | `this.state='end'` + `settleVictory()`（通关结算） | `triggers.js:49` |
| `roomComplete` | 无 | HUD 切 `secure`，1500ms 后自动回 `explore` | `triggers.js:47` |
| `combat` | 无 | HUD 切 `combat` | `triggers.js:45` |
| `spawnEnemy` | `spawn: { stopOnExit, resumeOnReturn, waves[] }` | 启动波次定时链 | `triggers.js:37` → `triggerSpawnEnemy`(93) |
| `switchLevel` | `target`（关卡 id，`''` 默认）、`spawnPoint`（`{x,y}` 或 null） | 淡出后切关卡并按 `spawnPoint` 覆写出生点 | `triggers.js:39` → `beginSwitch`(level-flow.js:70) |
| `spawnGate` | `gateIds[]`（空则取距触发器最近的一扇门） | 开门（封路） | `triggers.js:41` → `setGatesActive(…,true)` |
| `removeGate` | `gateIds[]`（同上兜底） | 关门（`closing=true`，动画后 `active=false`） | `triggers.js:43` |

`spawnEnemy.spawn` 字段：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `stopOnExit` | `false`（仅 `=== true` 才开） | 玩家离开触发器立即中止未生成波次并清残留（`triggers.js:211` → `stopTriggerSpawn`） |
| `resumeOnReturn` | `true`（`!== false`） | 离开再进入是否续上 `waveIndex`；`false` 时离开即把 `waveIndex` 归零（`triggers.js:234`） |
| `waves[]` | 至少 1 条（旧格式会把 spawn 自身当第 1 波，`state.js:237`） | 见 3.5.1 |

一个典型多事件触发器（摘自 `data/levels/Level1-Scene1.json`）：

```json
{
  "id": "trigger-1-1", "x": 2021, "y": 2967, "w": 169, "h": 415,
  "shape": "rect", "visible": false, "once": true, "cooldown": 0,
  "events": [
    { "type": "combat", "when": "enter" },
    { "type": "spawnGate", "when": "enter", "gateIds": ["gate-1-1", "gate-1-2"] },
    { "type": "spawnEnemy", "when": "enter",
      "spawn": { "stopOnExit": false, "resumeOnReturn": true,
        "waves": [
          { "enemyType": "basic1", "mode": "inscreen", "count": 6, "zoneId": "spawnzone-1-1", "preDelay": 500 },
          { "enemyType": "basic2", "mode": "surround", "count": 5, "radius": 420, "waitForClear": true }
        ] } },
    { "type": "roomComplete", "when": "enemiesCleared" },
    { "type": "removeGate", "when": "enemiesCleared", "gateIds": ["gate-1-1", "gate-1-2"] }
  ]
}
```

#### 3.5.1 spawn.waves[] 波次结构（`normalizeWave` @ `state.js:94`）

| 字段 | 默认 | 范围 / 说明 | 生效的 `mode` |
| --- | --- | --- | --- |
| `enemyType` | `'basic1'` | 必须是 `ENEMY_TYPES` 之一：`basic1/basic2/advanced1/advanced2` | 全部 |
| `mode` | `'surround'` | `'surround'` 召唤阵 / `'offscreen'` 屏幕外环 / `'inscreen'` 区域内随机 | — |
| `count` | `max(1,v)` 默认 5 | 本波数量；surround-polygon 时数量由 `sides` 决定，surround-circle 由 `circleCount` 决定 | offscreen / inscreen / surround-circle |
| `playerMinRadius` | `max(0,v)` 默认 200 | 距玩家最小距离；第一轮取点失败后退化为 20 | inscreen |
| `zoneId` | `''` | 指向 `spawnZones[].id`；空则用触发器自身矩形 | inscreen |
| `waitForClear` | `false` | 场上还有存活敌人则每 120ms 重试，直到清空才生成本波 | 全部 |
| `shape` | `'polygon'`（或 `'circle'`） | 召唤阵形状 | surround |
| `sides` | `max(3,v)` 默认 6 | 多边形边数 = 生成敌人数 | surround-polygon |
| `radius` | `max(20,v)` 默认 120 | 召唤阵半径（顶点距玩家） | surround |
| `thickness` | `max(1,v)` 默认 10 | 阵线粗细（px） | surround |
| `circleCount` | `max(1,v)` 默认 8 | 圆环阵生成点数 | surround-circle |
| `drawDuration` | `max(1,v)` 默认 500 | 阵型绘制时长 ms，敌人随绘制进度逐个落地 | surround |
| `fadeDuration` | `max(1,v)` 默认 500 | 阵型消散时长 ms | surround |
| `preDelay` | `max(0,v)` 默认 0 | 本波生成前等待 ms | 全部 |
| `postDelay` | `max(0,v)` 默认 1000 | 本波生成后等待 ms（与下一波 `preDelay` 相加） | 全部 |

三种 `mode` 的落地路径：`surround` → `createSpawnEffect`(spawning.js:171) 入队召唤阵，`draw` 阶段按进度 `spawnAtVertex`(203) 逐顶点生成、敌人 `frozen=true`，`hold` 500ms 后解冻；`offscreen` → `spawnOffscreen`(44) 视口外环取点，最多 60 次尝试、每 12 次外扩一档；`inscreen` → `spawnInScreen`(355) 区域内随机取点，先落 `lockEffects` 四角锁定框（500ms）再生成敌人。

### 3.6 交互物

| 实体 | 关键字段（默认值） | 交互 | normalize |
| --- | --- | --- | --- |
| `chests[]` | `trigger`：`'start'`（进关即有）/`'trigger'`；`triggerId`；`openRadius max(20,v)=50`；`rewards[]`（`item`∈gold/exp/charge/diamond、`count`、`chance` 0-100，`count<=0` 会被过滤）；指引字段组 | 走近 `openRadius` 内**自动**开箱（`updateChests` 78） | `state.js:167` |
| `portals[]` | `w max(30,v)=120`、`h max(20,v)=60`、`rotation=0`、`trigger`/`triggerId`、`interactRadius max(40,v)=90`、`visible`；指引字段组 | 按 F 撤离 → `usePortal` → `state='end'` + `settleVictory` | `state.js:182` |
| `vendors[]` | `w=130`、`h=96`、`interactRadius max(30,v)=120`、`visible`；指引字段组 | 按 F 打开 `vendor` 菜单页（局内商店） | `state.js:200` |
| `idols[]` | `w=h=110`、`interactRadius max(40,v)=130`、`visible`；指引字段组 | 按 F 弹 3 张祝福卡，选 1 生效并 `used=true`（不可再用）；**点空白关闭不消耗**，可再交互 | `state.js:213` |
| `icons[]` | `w=h=64`、`src`、`interactRadius=120`、`tipText='按 F 交互'`、`event`∈`workshop`/`weapon`/`battle`（默认 workshop）；指引字段组 | 按 F 打开对应菜单页：`weapon`→武器商店、`battle`→关卡选择、其他→工坊 | `state.js:226` |

交互半径实际生效值 = `max(interactRadius, 半对角线 + 玩家半径 + 40)`（`interactables.js:115/141/174/233`），所以把实体拉很大时半径会自动跟着放大。

**指引字段组**（5 类交互实体通用，`state.js:157 guideFields()` 平铺展开）：`guide`（bool，默认 false，是否游戏内指引）、`guideRange`（`max(100,v)=600`，实体在视窗外且距玩家 ≤ 该值才显示指引箭头）、`guideIcon`（动态资产名/设计稿 id，空=实体名称文字占位）。F 键交互实体（portals/vendors/idols/icons，**不含 chests**）另有 `guideStopAfterUse`（bool，默认 **true**）：交互后（chest.opened / portal.used / idol.used / vendor·icon 首次按 F 置运行时 `guideUsed`）停止指引；配 false 则交互后继续指引。渲染与淡入淡出见 ui-interaction skill（`world-overlay.js:updateGuideArrows/drawGuideArrows`）。

### 3.7 gates[] / spawnZones[]

| gates 字段 | 默认 | 说明 |
| --- | --- | --- |
| `id` | `gate-<i+1>` | `spawnGate`/`removeGate` 事件按 id 引用 |
| `w`,`h` | `max(20,v)=237` / `max(10,v)=45` | 碰撞时高度按 `h*1.42` 放大（`activeGateWalls` 90） |
| `rotation` | 0 | 度 |
| `label` | `'Barrier Active'` | 门上文字 |
| `color1`/`color2` | `#FFE6BE`/`#FFCB85` | 渐变色 |
| `active` | `false` | 初始是否已封路；运行时 `spawnT` 0→1 为开门动画 |
| `visible` | `true` | `false` 时不参与碰撞（`activeGateWalls` 过滤） |

| spawnZones 字段 | 默认 | 说明 |
| --- | --- | --- |
| `id` | `spawnzone-<i+1>` | 波次 `zoneId` 引用目标 |
| `w`,`h` | `max(40,v)`，默认 300 / 200 | 矩形范围，以 `x,y` 为中心 |
| `color` | `#7ee787` | 编辑器显示色 |
| `visible` | `true` | 仅编辑器可见性 |

### 3.8 roomLayout 多箱庭（`normalizeRoomLayout` @ `rooms.js:21`）

```json
"roomLayout": { "mode": "multi", "cols": 6, "rows": 4, "wallThickness": 30,
  "roadWidth": 360, "roadLength": 560, "wallColor": "#ffffff",
  "cells": [ { "c": 0, "r": 1, "size": 820 }, { "c": 1, "r": 1, "size": 1120 } ] }
```

| 字段 | clamp 范围 | 默认 |
| --- | --- | --- |
| `cols`/`rows` | 1 – `MAX_PANEL_SIZE(8)` | 3 / 3 |
| `wallThickness` | 8 – 200 | 30 |
| `roadWidth` | 120 – 1100 | 448 |
| `roadLength` | 60 – 1680 | 560 |
| `wallColor` | 必须 `#rrggbb` | `#60758b` |
| `cells[].c/r` | 必须整数且在 `cols/rows` 内，越界与重复被丢弃 | — |
| `cells[].size` | 400 – 2400（`clampRoomSize`） | 1120（`ROOM_SIZE`） |
| `cells[].marker` | `null` 或 `{ type, icon }` | `null` | 小地图标记（每箱庭最多 1 个）：`type` ∈ `MINIMAP_MARKER_TYPES`（`state.js:5`）`combat/idol/chest/vendor/boss` ↔ 中文 `战斗/神像/宝箱/商人/BOSS`（`MINIMAP_MARKER_LABELS`）；`icon` 为画板资产 id，空串`''`=文字占位。归一化 `normalizeRoomMarker`（`state.js:9`）：非法/空→`null`、type 不在白名单→丢弃整标记、icon 非字符串→`''`。`generateRoomLayout` 的 `rooms[i]` 透传 `marker`（`rooms.js:109`），供小地图渲染/玩家定位 |

`generateRoomLayout`(rooms.js:55) 输出 `{ walls, world, rooms, spawn }`：列宽取该列最大 `size`、行高取该行最大 `size`，房间在格内居中；相邻格之间开洞（开洞宽 = `max(8, min(roadWidth, aSize-16, bSize-16))`）并补道路侧墙；世界尺寸 = 布局尺寸 + `WORLD_MARGIN(500)`，起点偏移 `ROOM_OFFSET(250)`。生成的墙都带 `room:true`。

### 3.9 关卡形态速查（`data/levels/` 共 16 个文件）

| 关卡 | 形态 | 关键点 |
| --- | --- | --- |
| `login.json` | 菜单关 | `ui:'login'`，`background.fx='wormhole'`，无墙无敌人；镜头固定全图、跳过开场演出 |
| `newbee.json` | 新手教学关 | 1600×1600、`camera.mode:'center'`、`spawn.weapons:['radial','yellow']`、`triggers` 为空（阶段由 `newbee-hub.js` 驱动） |
| `knight-home.json` | 家园关 | `levelId==='knight-home'` 触发 `isHubLevel()`：禁止开火与护盾；3 个 `icons`（战斗/商城/工坊入口） |
| `Level1-Scene1.json` | 标准战斗关 | 7140×3780、`roomLayout` 6×4 多箱庭、36 墙、3 触发器、3 生成区域、4 门、5 宝箱、2 传送门、1 神像、15 木箱、4 油桶、3 装饰图 |
| `level-1..5`、`Level1-3 × Scene1-3` | 战斗关 | 结构同上 |

## 4. 关键流程

**① 关卡加载 → normalize → 场景构建 → 开场演出**

`editor/level-flow.js:176 selectLevel` → `api.js:19 loadLevel`（GET `/api/levels/:id`）→ `state.js:438 normalizeLevel` 写 `state.level` → `editor/level-flow.js:137 setMode` 销毁旧 Phaser.Game → `startGame`(73) 新建场景 → `game-scene.js:40 create`（贴图预载 + 输入注册）→ `game-scene.js:99 this.restart()` → `level/level-flow.js:88 restart`：清空所有运行时数组、重置 `triggered`/`triggerState`/`waveEvents` → 从 `l.crates/barrels/chests/portals/vendors/idols/icons/gates` 浅拷贝出运行时副本（宝箱/传送门 `spawned = trigger==='start'`）→ `pathfinding.js:1 buildGrid`（墙 + 木箱 + 油桶，`CELL=30`、`inflate=PATH_INFLATE(24)`）→ 组装 `this.player`（武器/弹药/充能/装备/存档字段）→ `l.enemies.map(initEnemy)` → `applyPlayerBounds`(28) → `setupPlayCamera` → 非菜单关 `startLevelIntro`(35)：`isBattleLevel()` 时 3.5s 镜头从 `1920/340` 缩放到 `playZoom()`（`pow(p,2.4)` 缓动），否则 1.2s 空过场，期间 `state='transition'` → `updateLevelIntro`(50) 结束置 `state='playing'`。

**② 玩家进入触发器 → 事件派发 → 波次生成 → 敌人清空 → 异步事件**

`game-scene.js:481 updateTriggers`（每帧）→ `triggers.js:203 updateTriggers`：`geometry.js:94 hitTrigger` 判定 inside → 单次触发器（`once!==false` 或含 `switchLevel`）查 `this.triggered` Set；重复触发器按 `cooldown` 判 → `triggers.js:22 fireTrigger`：`when==='enemiesCleared'` 的事件推入 `st.pendingClearEvents`，其余立即 `dispatchTriggerEvent`(36) → `spawnEnemy` 走 `triggerSpawnEnemy`(93)：读 `resumeOnReturn` 决定起始 `waveIndex`，把 `spawn` 回写到 `t.spawn` 供下游读取，`runTriggerWave`(111) → `time.delayedCall(delay)` 定时链，`waitForClear` 时每 120ms 轮询，`fire()` 按 `mode` 分派 `spawnOffscreen`/`spawnInScreen`/`createSpawnEffect`，然后 `waveIndex++` 并挂下一波（延迟 = 本波 `postDelay` + 下波 `preDelay`），所有 timer 都打 `triggerId` 标记并 push 到 `this.waveEvents` → 敌人被击杀走 combat 侧 `defeatEnemy` → `game-scene.js:482 checkAsyncTriggerEvents`(triggers.js:168) 每帧检查：`triggerHasPendingWaves` 为假 + 无 `alive && triggerId===t.id` 的敌人 + 无同 `triggerId` 的 `lockEffects` → 派发挂起事件 + `spawnChestsForTrigger(t.id)` + `spawnPortalsForTrigger(t.id)`。

**③ 门（gate）开合链路**

触发器 `spawnGate` 事件 → `triggers.js:66 setGatesActive(ev,true,t)`：按 `ev.gateIds`/`ev.gateId` 找门，全找不到则取距触发器（或事件）最近的一扇 → `gate.active=true; gate.spawnT=0` → `game-scene.js:150-159` 每帧 `spawnT += dt/GATE_SPAWN_MS(500)` 升到 1（开门动画）→ `triggers.js:86 activeGateWalls` 把 `active && visible!==false` 的门转成碰撞矩形（高度 `h*1.42`），被 `player-combat.js:106 pointInWall`、子弹墙判定（`game-scene.js:342/427`）、敌人碰撞共用；编辑器态返回空数组 → `removeGate` → `closing=true` → 每帧 `spawnT` 递减到 0 后 `active=false`。

**④ 交互物链路**

- 宝箱：`trigger:'start'` 在 `restart` 即 `spawned=true`；`trigger:'trigger'` 等 `checkAsyncTriggerEvents` → `interactables.js:33 spawnChestsForTrigger` → `spawnChest`(26) 置 `fx={t:CHEST_SPAWN_FX_MS(260),kind:'spawn'}` → `updateChests`(76) 每帧递减特效并检测玩家距离 ≤ `openRadius` → `openChest`(66)：`opened=true`、`fx=open(320ms)`、按 `rewards[].chance` 掉落 `spawnDropItems`（economy 侧）。
- 传送门：同样两种出现方式 → `updatePortalInteract`(161) 只认 `spawned && !used && visible!==false`，靠近记 `portalNearest` 并渐显提示（`portalTipT += dt/180`）→ 按 F → `usePortal`(59)：`used=true`、`state='end'`、`settleVictory()`。
- 售货机：`updateVendorInteract`(220) → 按 F → `openMenuScreen('vendor')`（局内商店，数值见 economy-numbers skill）。
- 神像：`updateIdolInteract`(102) → 按 F → `openIdolOffer`(188)：洗牌 `IDOL_BUFFS` 按 `IDOL_OFFER_COUNT` 取 n 张（配置 `data/ui/idol-buffs.json` 的 `offerCount`），`state` 置 `paused` 并存 `prevState` → `chooseIdolBuff`(207) 调 `buff.apply(this)` 改 `player.combat`，`idol.used=true`，`closeIdolOffer`(200) 恢复 `playing`；`onUIPointer` 未命中卡片时置 `idolOffer.closing=true` 走离场滑出后 `closeIdolOffer`（点空白关闭，**不设 `used`**，可再次按 F 重新随机）。
- 图标：`updateIconInteract`(128) → 按 F → `triggerIconEvent`(153) 按 `icon.event` 打开 `weapon`/`levelSelect`/`workshop` 页。

所有交互 update 在 `game-scene.js:486-490` 顺序调用，且 `editing` 或 `state!=='playing'` 时清空 nearest 与 tip 计时。

**⑤ 关卡通关 → 结算 → 切到下一关（含淡入淡出）**

`complete` 事件或 `usePortal` → `state='end'` + `level-flow.js:269 settleVictory`：金币写 `p.currency.gold`；`levelId` 非 `newbee`/`login`/`knight-home` 时 push 进 `p.levels.completed`，并记 `p.levels.current`，`persistSave` 落盘。切关另一条路径：`switchLevel` 事件 → `level-flow.js:70 beginSwitch` 记 `{phase:'out', target, spawnPoint}`、`state='transition'` → `updateTransition`(283) 每帧 `alpha += dt/SWITCH_FADE_MS(500)`，`alpha>=1 && switching` 时调 `ctx.onSwitchLevel`（= `editor/level-flow.js:203 switchToLevel`：拉目标关卡 JSON、`normalizeLevel`、按 `spawnPoint` 覆写 `level.spawn.x/y`）→ 回调里 `this.restart()` 并转 `phase:'in'`，`alpha` 退回 0 后 `state='playing'`。`beginExternalFade`(81) 用于外部流程（返回菜单等），淡黑到底后执行 `transitionDone`。菜单/存档跳转另用 DOM 黑屏 `editor/level-flow.js:115 fadeAndSwitch`（`FADE_MS=350`）。

**⑥ 编辑器改关卡 → 存草稿 / 存正式 → 试玩快照与恢复**

任何编辑操作 → `editor/level-flow.js:59 redraw`：重绘场景 + `sync()` 刷面板，**仅 `state.mode==='editor'`** 时 `saveDraft`（`api.js:24`，实际等于 `saveFormal`，POST `/api/levels/:id` 直接写 `data/levels/<id>.json`）；试玩/预览态的指针事件也会触发 redraw，靠这个 mode 判断避免污染关卡文件。触发器面板 / 房间面板另有 `saveQuiet()` 直接 `saveDraft`。进入试玩前：`editor/bindings.js:222`（游戏预览）与 `editor/save-flow.js:76 startTrial`（试玩）都先 `await saveDraft` 再存快照 `ctx.editorSnapshot = { level: clone(state.level), levelId }`（试玩还存 `editorPlayerSnapshot` 并把 `state.saveStore` 切 `'test'`）→ 退出时 `editor/level-flow.js:160 restoreEditorSnapshot` 用快照还原 `state.level/levelId`、还原玩家数据、`saveStore` 回 `'formal'`，抹掉游戏内切关造成的污染。「保存」按钮（`bindings.js:233`）走 `saveFormal` 同一个接口；「加载」按钮 `selectLevel(id, true)` 用 `get('/levels/:id')` 强制读正式文件。

**⑦ 多箱庭房间改动链路**

房间面板点格 → `room-panel.js:87 toggleRoomCell`（新格必须与已选格四邻相邻，否则报「新方格必须与已选方格相邻」）→ `applyRooms`(18)：`generateRoomLayout` → 保留非 `room` 墙 + 新生成墙、覆写 `l.world`、若出生点不在任何房间内（`spawnInRooms`）则移到首个房间中心 → `resetEditorCamera` → `redraw` 落盘。

## 5. 关键常量与数值

| 常量名 | 所在文件 | 当前值 | 含义 | 调它影响什么 |
| --- | --- | --- | --- | --- |
| `ROOM_SIZE` | `src/rooms.js:2` | 1120 | 默认房间内宽高 | 新点格房间的初始大小 |
| `MIN_ROOM_SIZE` / `MAX_ROOM_SIZE` | `src/rooms.js:14-15` | 400 / 2400 | 单房间尺寸上下限 | 房间尺寸弹窗与 `clampRoomSize` 的钳制范围 |
| `DEFAULT_ROAD_WIDTH` | `src/rooms.js:3` | 448 | 默认道路（墙洞）宽 | 房间之间开口大小；过大时被 `min(size-16)` 压 |
| `MIN_ROAD_WIDTH` / `MAX_ROAD_WIDTH` | `src/rooms.js:10-11` | 120 / 1100 | 道路宽上下限 | 上限留出洞两侧墙段，改大易出现无墙段 |
| `DEFAULT_ROAD_LENGTH` | `src/rooms.js:4` | 560 | 相邻房间内壁间距 | 走廊长度 → 直接改变世界尺寸 |
| `MIN/MAX_ROAD_LENGTH` | `src/rooms.js:12-13` | 60 / 1680 | 走廊长度上下限 | 面板可调范围 |
| `WORLD_MARGIN` / `ROOM_OFFSET` | `src/rooms.js:5-6` | 500 / 250 | 关卡整体外扩边距 / 布局起点 | 世界尺寸与所有房间坐标整体偏移 |
| `MIN/MAX_ROOM_THICKNESS` | `src/rooms.js:7-8` | 8 / 200 | 房间墙厚上下限 | 墙体粗细，影响可通行宽度 |
| `MAX_PANEL_SIZE` | `src/rooms.js:9` | 8 | 房间面板最大行列 | 单关最多 8×8 房间 |
| `MIN_WALL_SIZE` | `src/state.js:2` | 8 | 墙/触发器最小宽高 | 归一化下限，防 0 尺寸实体 |
| `CELL` | `src/systems/constants.js:9` | 30 | 寻路网格与编辑器网格边长 | 寻路精度与性能；改小则 `buildGrid` 开销上升 |
| `PATH_INFLATE` | `src/systems/level/level-flow.js:21` | 24 | 寻路网格障碍膨胀 px | 太小敌人贴墙卡住，太大窄道被判不可通行 |
| `SPAWN_OFFSCREEN_PX` | `src/systems/level/spawning.js:26` | 10 | 屏幕外生成基础外扩（还要除以相机 zoom） | 敌人出现在视口外多远；太小会「当面刷怪」 |
| `ENEMY_EDGE_MARGIN` | `src/systems/level/spawning.js:28` | 60 | 敌人距世界边界最小边距 | 防敌人刷在地图边缘外 |
| `NEWBEE_TRIANGLE_RADIUS` | `src/systems/level/spawning.js:27` | 500 | 新手关三角阵半径 | 仅 `spawnNewbeeEnemies` |
| 召唤阵默认 `radius`/`thickness`/`drawDuration`/`fadeDuration`/`circleCount`/`sides` | `src/systems/level/spawning.js:176-181`（与 `state.js:104-109` 一致） | 120 / 10 / 500 / 500 / 8 / 6 | 波次未填字段时的召唤阵默认值 | 所有未显式配波次的关卡表现 |
| `holdDuration`（召唤阵定格） | `src/systems/level/spawning.js:191` | 500 | 阵型画完后敌人 `frozen` 保持时长 | 敌人解冻开始行动的延迟 |
| 锁定框 `duration` | `src/systems/level/spawning.js:390` | 500 | 屏幕内生成的四角锁定框动画时长 | 玩家的预警时间；期间 `checkAsyncTriggerEvents` 会等待 |
| `waitForClear` 轮询间隔 | `src/systems/level/triggers.js:140` | 120 ms | 等待清场时的重试节奏 | 清场后下一波的响应延迟 |
| `CHEST_SPAWN_FX_MS` / `CHEST_OPEN_FX_MS` | `src/systems/constants.js:25/24` | 260 / 320 | 宝箱（含传送门复用）出现 / 开启十字星特效时长 | 特效手感 |
| `GATE_SPAWN_MS` | `src/systems/constants.js:79` | 500 | 门开/关动画时长 | 封路生效的过渡时间 |
| `SWITCH_FADE_MS` | `src/systems/level/level-flow.js:22` | 500 | 场景内切关淡出/淡入时长 | 切关黑屏节奏（单侧 0.5s） |
| `FADE_MS` | `src/editor/level-flow.js:113` | 350 | DOM 黑屏切换时长 | 菜单/存档跳转的黑屏 |
| 开场演出时长 | `src/systems/level/level-flow.js:38` | 战斗关 3.5s / 其他 1.2s | 开场镜头推进时间 | 进关等待感；`state` 期间不可操作 |
| 开场初始 zoom | `src/systems/level/level-flow.js:40` | `1920/340` | 起始视野宽约 340 px | 拉近幅度 |
| `applyPlayerBounds` 的 `pad` | `src/systems/level/level-flow.js:31` | 2000 | 相机边界外扩 | 出生点在世界外时相机不抖 |
| `LEVEL_HP_BONUS` | `src/systems/level/level-flow.js:23` | 10 | 编辑器预览态每级血量加成 | 仅编辑器/预览，不影响正式档 |
| `HUD_IDLE_MS` | `src/systems/ui/hud.js:18` | 3000 | HUD 常态脉冲周期，`restart` 里重置 | 详见 ui skill |
| `roomComplete` 自动回退 | `src/systems/level/triggers.js:48` | 1500 ms | secure 态自动回 explore 的延迟 | 房间清空后的 HUD 表现 |

## 6. 扩展指南

### 6.1 新增一种触发器事件类型（例：`playSound`）

1. `src/state.js:219` 把 `'playSound'` 加进 `EVENT_TYPES`（不加会被 `normalizeTriggerEvent` 直接丢弃）。
2. `src/state.js:242 normalizeTriggerEvent` 加分支，返回 `{ type, when, ...归一化后的参数 }`；无参数事件可并进 `complete/roomComplete/combat` 那一行（249）。
3. `src/systems/level/triggers.js:36 dispatchTriggerEvent` 加 `else if (ev.type === 'playSound') { ... }` 实现行为。
4. 若需异步（清敌后触发），什么都不用做——`when:'enemiesCleared'` 由 `fireTrigger`(22) 统一入队，但要确认你的事件在 `checkAsyncTriggerEvents`(168) 的时序里成立。
5. `src/editor/trigger-panel.js:17 triggerEventParamsHtml` 加参数表单分支（用 `data-event-i` + `data-event-field` 约定，`setNested` 会自动写回）；同时在 `list` 的 `change` 处理器 `el.dataset.eventType` 分支（177-197）里给新类型初始化默认参数字段。
6. 事件类型下拉是**硬编码**的中文标签数组 `eventTypeOptions`（`src/editor/entity-properties.js:79-87`，与 `EVENT_TYPES` 各自独立维护），必须手动补一行 `['playSound', '播放音效']`，否则面板选不到。同处还传入 `enemyTypeOptions`(76)、`levelOptions`(77)、`gateOptions`(88)。
7. 验证：`npx vite build` → `node server.js` → 编辑器给某触发器加该事件 → 试玩确认派发。

### 6.2 新增一种交互物（例：`shrines`）

1. `src/state.js` 加 `normalizeShrine(v, i)`（照 `normalizeIdol`(192) 写：id 兜底、坐标、`w/h` 下限、`interactRadius`、`visible`）。
2. `src/state.js:323 DEFAULT_LEVEL` 加 `shrines: []`，`normalizeLevel`(438) 加 `shrines: (Array.isArray(data.shrines) ? data.shrines : []).map(normalizeShrine)`。
3. `src/systems/level/level-flow.js:132` 附近的 `restart` 里加运行时副本：`this.shrines = (l.shrines || []).map(v => ({ ...v }))` + `this.shrineNearest = null; this.shrineTipT = 0;`（有一次性语义就加 `used: false`）。
4. `src/systems/level/interactables.js` 加 `updateShrineInteract(dt)`（照 `updateIdolInteract`(102)：`editing || state!=='playing'` 先清状态；`reach = max(interactRadius, halfDiag + p.r + 40)`；`Phaser.Input.Keyboard.JustDown(this.keys.F)` 判 F）。
5. `src/game-scene.js:486-490` 注册每帧调用。
6. 渲染：图标精灵同步加在 `src/systems/ui/world-render.js`（照 `syncIdolSprites`），提示与浮层加在 `src/systems/ui/world-overlay.js`（详见 ui skill）。
7. 编辑器：`src/systems/editor/editor-input.js:150-176` 附近加 `tool === 'shrine'` 放置分支，并在 `pickTopEntity`（`src/systems/editor/editor-geometry.js:200`）与工具按钮列表里补上（详见 engine-editor skill）。

### 6.3 新增一个关卡

1. 建 `data/levels/<id>.json`，最小骨架（其余字段由 `normalizeLevel` 补全）：

```json
{
  "ui": "battle",
  "backgroundColor": "#000000",
  "gridColor": "#173a55",
  "world": { "width": 1920, "height": 1080 },
  "camera": { "width": 1440, "mode": "center" },
  "spawn": { "x": 300, "y": 540, "weapons": ["radial"] },
  "walls": [], "enemies": [], "triggers": [],
  "crates": [], "barrels": [], "chests": [], "portals": [],
  "vendors": [], "idols": [], "icons": [], "gates": [], "spawnZones": [],
  "images": [], "background": null, "dropRules": {}
}
```

2. 或走编辑器：「新建关卡」按钮（`src/editor/bindings.js:252`）输入 id，会创建并进入；模板下拉可选单箱庭 / 多箱庭（`bindings.js:239 applyTemplate`）。
3. 多箱庭：模板选 `multi` 后在房间面板点格（首格任意，后续必须相邻），右键格子改单房间尺寸，墙体与世界尺寸自动生成。
4. 放触发器 / 生成区域 / 门 / 宝箱 / 传送门，在触发器事件面板配波次；每次编辑自动 `saveDraft` 写回 JSON。
5. 该关卡要能被 `switchLevel` 选中：目标关卡下拉来自 `state.levels`（`GET /api/levels`），刷新页面或 `refreshLevels()` 后即出现。
6. 通关解锁：`settleVictory`(level-flow.js:269) 会把非 `newbee/login/knight-home` 的 id 记入存档 `levels.completed`；若关卡 id 未在存档 `levels.unlocked` 中，正式游戏会被 `restart`(173) 回退到已解锁关卡——测试时注意。

### 6.4 改波次生成规则

1. 只调数值/形状：改关卡 JSON 或触发器面板即可，无需碰代码。
2. 加波次字段：`src/state.js:94 normalizeWave` 加字段与 clamp → `src/editor/trigger-panel.js:31-79` 加对应 input（字段名走 `spawn.waves.<w>.<field>`，若该字段会改变表单结构，需要加进 `trigger-panel.js:212/236` 的 `/^spawn\.waves\.\d+\.(mode|shape)$/` 重渲染正则）→ 在 `runTriggerWave`(triggers.js:111) 或对应 spawn 函数里消费。
3. 加一种 `mode`（例如 `'ambush'`）：`state.js:97-98` 的 `mode` 归一化三元表达式要加分支（否则回落 `surround`）→ `triggers.js:118-126 fire()` 加分派 → `spawning.js` 加取点函数（务必复用 `canSpawnAt`(107) 校验并用 `findClearSpawnNearPlayer`(118) 兜底）→ `trigger-panel.js:43` 的 mode 下拉加选项、按需在 50-79 行加该 mode 专属字段。
4. 改「等待清理」判定口径：`triggers.js:137 enemiesCleared` 目前是「场上任何存活敌人」，若要改成「仅本触发器召唤的敌人」，加 `e.triggerId === t.id` 条件——注意这会改变多触发器叠加时的节奏。
5. 验证：用 `data/levels/Level1-Scene1.json`（3 触发器 × 多波、含 `inscreen`+`offscreen`+`surround` 三种 mode）复现。

## 7. 坑与约束

- **Mixin 装配顺序与同名覆盖**：`src/game-scene.js:559` 一次 `Object.assign(EditorScene.prototype, …19 个 Mixin)`，后者覆盖前者。本分类的四个 Mixin 顺序为 `SpawningMixin → TriggersMixin → InteractablesMixin → LevelFlowMixin`（在 `DestructiblesMixin` 之后、`HudMixin` 之前）。新增方法前先确认方法名在其他 Mixin 中不存在，否则会静默覆盖。
- **`const ctx = this.ctx;` 约定**：Mixin 方法体里用到外部注入 `ctx`（`ctx.state`、`ctx.onSwitchLevel`、`ctx.redraw`）时，首行必须写 `const ctx = this.ctx;`（见 `triggers.js:169/189/204`、`level-flow.js:89/259/270/284`、`spawning.js:356`）。不要在 Mixin 里 import `editor/context.js`——场景侧只认注入的 ctx。
- **触发器状态在 `this.triggerState`**：`Map`，key 是 `trigger.id`，value `{ inside, lastFire, waveIndex, timer, pendingClearEvents }`。取出改完必须 `this.triggerState.set(t.id, st)` 回写（`get` 返回引用，但代码里存在「取不到就新建对象」的分支，漏写回会丢状态）。单次触发记录在另一个 `this.triggered` Set 里。两者都在 `restart`(level-flow.js:98-99) 重置。
- **`t.spawn` 是回写的临时字段**：`triggerSpawnEnemy`(triggers.js:107) 把事件里的 `spawn` 赋给 `t.spawn`，因为 `runTriggerWave`/`spawnInScreen`/`createSpawnEffect` 仍从 `t.spawn` 读波次。这意味着**同一触发器只能有一个生效的 `spawnEnemy` 事件**，配两个后者会覆盖前者的波次上下文。
- **波次中止与残留清理时机**：`stopTriggerSpawn`(triggers.js:155) 只在「玩家离开 + `spawn.stopOnExit`」时调用（`triggers.js:211`）。它做四件事：移除当前 timer、按 `triggerId` 过滤 `waveEvents`、清同 id 的 `spawnEffects`（并把其中 `frozen` 的敌人解冻，否则会永久冻在场上）、清同 id 的 `lockEffects`。自己加中止路径时必须复用它，别只 `remove` timer。另外已生成的敌人**不会**被回收。
- **异步事件的三重等待条件**：`checkAsyncTriggerEvents`(triggers.js:174-180) 必须同时满足「无未生成波次」「无本触发器的存活敌人」「无本触发器的 `lockEffects`」。如果波次用了 `waitForClear` 且场上有别的触发器召唤的敌人，本触发器的波次会一直等 → 异步事件（如 `removeGate`）永不触发，表现为「门打不开」。
- **试玩快照机制不能污染编辑器数据**：`redraw`(editor/level-flow.js:63) 只在 `state.mode==='editor'` 时落盘；游戏内 `switchLevel` 会直接改 `state.level`/`state.levelId`，退出必须走 `restoreEditorSnapshot`(160) 还原。新增「进入游戏态」入口时，务必先 `await saveDraft` 再存 `ctx.editorSnapshot`（照 `bindings.js:222` / `save-flow.js:76`），否则玩家会丢编辑内容。试玩存档写 `data/test-players/`，与正式档隔离（`state.saveStore`）。
- **生成点必须过可达性校验**：`canSpawnAt`(spawning.js:107) 检查「世界边界内（留敌人半径）+ 不在墙内 + 与玩家连线 `hasLOS` 通畅 + 可选最小玩家距离」。绕过它直接 push 敌人 → 敌人卡墙或玩家打不到。注意 `canSpawnAt` 用的是视线判定，**不是**寻路判定；真要保证能走到得用 `isReachableWalkable`(67)（`findPath` A*）或 `nearestReachablePoint`(85) 兜底。`this.grid` 在 `restart` 里由 `buildGrid` 生成，编辑器改墙后未 `restart` 时 grid 是旧的。
- **门参与碰撞但编辑器态不参与**：`activeGateWalls`(triggers.js:87) 在 `this.editing` 时返回 `[]`，且门**不进寻路网格**（`buildGrid` 只吃 `walls` + `crates` + `barrels`）。所以门关闭时敌人寻路仍会尝试穿门位置，只是被移动碰撞挡住。
- **`gateIds` 空数组的隐式兜底**：`setGatesActive`(66) 找不到目标时会自动取**距离最近的一扇门**。配置漏填 id 不会报错，只会随机开错门——排查「门乱开」先看事件里的 `gateIds`。
- **房间墙重生成只认 `room:true`**：`applyRooms`(room-panel.js:23) 用 `l.walls.filter(w => !w.room)` 保留手工墙。手工加的墙千万别带 `room:true`，否则下次改房间面板会被删。
- **`spawnInScreen` 依赖 `ctx.state.level.spawnZones`**：`zoneId` 找不到对应 zone 时静默回落到触发器自身矩形（`spawning.js:362`）。删 spawnZone 后波次里的 `zoneId` 不会自动清，表现为刷怪范围突然变小。
- **交互半径会被实体尺寸抬高**：`max(interactRadius, halfDiag + p.r + 40)`。把神像/图标做得很大时，`interactRadius` 配再小也没用。
- **菜单关与家园关的特殊分支**：`isMenuLevel()`（`ui==='login'`）跳过开场演出、相机固定 `(0,0)`；`isHubLevel()`（`levelId==='knight-home'`）禁用开火与护盾（`game-scene.js:225/228`）。新增此类关卡要同步这两个判定（`src/systems/ui/ui-runtime.js:165/186/191`）。

## 8. 验证方式

- 构建：`npx vite build`（Vite 6 + Phaser 4，纯 ESM，只做打包不跑测试）。
- 单测：`node --test test/`。基线 **16 pass / 5 fail**；5 个失败是 `player-api.test.js` 的 `fetch failed`，属正常——它们需要先起 dev server。测试只覆盖玩家存档，**关卡 schema 无自动化测试**，改 `normalize*` 必须手动回归。
- 起服：`node server.js`（默认端口 5173，可 `PORT=5174 node server.js`）。关卡读写走 `GET/POST /api/levels/:id`，直接落 `data/levels/*.json`。
- 手动复现路径：

| 要验的东西 | 用哪个关卡 | 怎么看 |
| --- | --- | --- |
| 触发器多事件 + 三种波次 mode + 门开合 + 异步 `removeGate` | `Level1-Scene1.json` | 进关走到第一个触发器，门应封路 → 清完两波 → HUD 转 secure、门开、宝箱出现 |
| 多箱庭房间生成 / 世界尺寸自适应 | `Level1-Scene1.json`（6×4，7140×3780） | 房间面板改行列或单格尺寸，看墙体与世界尺寸重算、出生点是否被移入房间 |
| 交互物（宝箱自动开、传送门撤离、神像三选一） | `Level1-Scene1.json`（5 宝箱 / 2 传送门 / 1 神像） | 走近宝箱应自动开箱掉落；传送门按 F 直接通关结算 |
| 图标交互与家园分支 | `knight-home.json`（3 icons） | 按 F 分别进战斗选择 / 武器商店 / 工坊；确认禁止开火 |
| 菜单关形态与 wormhole 背景 | `login.json` | 相机固定全图、无开场演出 |
| 开场演出（战斗关镜头拉近 3.5s） | 任意 `ui:'battle'` 且非 hub 的关卡 | 进关前 3.5s 不可操作，镜头由窄到宽 |
| 切关淡入淡出 + `spawnPoint` 覆写 | 任一带 `switchLevel` 事件的关卡 | 黑屏 0.5s → 新关卡出生点应等于事件里的 `spawnPoint` |
| 试玩快照不污染 | 任意关卡 | 编辑器改动 → 试玩并游戏内切关 → ESC 退出 → 关卡 id 与内容应回到试玩前 |
