---
name: level-design
description: 改关卡结构（房间/墙体/世界尺寸）、触发器与敌人波次、刷怪点与可达性、宝箱传送门售货机（局内商店）神像等交互物、关卡开场与通关切换流程与局内态清零、玩家被击败/死亡运镜失败流程，以及 data/levels/*.json schema 时读这份。触发词：售货机 / 局内商店 / 局内态 / vendors / F 键交互 / 药水掉落 / 掉落规则 / potionId / 运镜 / 过场运镜 / 死亡运镜 / 玩家被击败 / 运镜预览。
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
- 触发器 `triggers[]`：矩形/圆形范围、`once`、`cooldown`、事件列表（8 种事件类型，含 `bossBattle` 触发 Boss 战）
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
| `src/systems/level/triggers.js` | 触发器点火 / 事件派发 / 波次定时链 / 门开合（含 `bulletGateWalls` 挡子弹门） | `TriggersMixin`（13 方法，含 `autoRoomGates`） | 300 |
| `src/systems/level/interactables.js` | 宝箱、传送门、售货机、神像、图标交互；`openIdolOffer` 按 `IDOL_OFFER_COUNT` 取 n 张并预载 icon 画板资产；vendor/icon 首次按 F 置运行时 `guideUsed`（指引停止用）；`updateVendorInteract` 按 F 经 `this.openVendorShop(nearest)` 打开局内商店页 | `InteractablesMixin`（16 方法） | 251 |
| `src/systems/level/level-flow.js` | `restart` 关卡构建、开场演出、结算、切关淡出、未知房间揭示（`updateRoomReveal`/`roomRevealAlpha`）、**玩家被击败失败流程 `triggerPlayerDefeat`（幂等，见 §4⑨）**；**`restart` 是局内态唯一清零点**：清零 `runItems`/`runTimedWeapons`/`vendorActive` + `runEffects`/`tempWeaponActive`/`tempWeaponSaved`/`potionWheel`/`potionKeyHold`（:147-153）+ `playerDeathFlow=null`（:100）+ `hideCinematicFade?.()`，`this.player` 加 `itemShields:[]`（:273），末尾 `if(!this.editing) this.preloadRunItemArt()`（:297）+ `potionWheelText?.setVisible(false)`（:298）（旧 `vendorBought` 已删） | `LevelFlowMixin`（12 方法）`triggerPlayerDefeat` | 411 |
| `src/rooms.js` | 多箱庭房间布局生成 + 通道开口几何计算 + 尺寸常量 | `generateRoomLayout`、`normalizeRoomLayout`、`spawnInRooms`、`clampRoomSize`、`roomPassagesForPoint`（触发器所在房间各通道开口）、`isGateOnPassage`（判定门是否在通道上）、13 个常量 | 213 |
| `src/state.js` | 关卡 JSON schema 权威定义（所有 `normalize*`） | `normalizeLevel`（`state.js:586`，含顶层死亡运镜注入）、`normalizeTrigger`、`normalizeTriggerEvent`（`playCinematic` 含 `focusTarget`）、`normalizeWave`、`normalizeChest`、`normalizePortal`、`normalizeCinematic`（含 `timeScale`/`focus`/`blackHoldMs` + 关键帧 `vignette`/`letterbox`/`tint`/`tintColor`/`flash`/`flashColor`/`desat`，见 §3.12）、模块私有 `clampUnit`/`normalizeHexColor`、`EVENT_TYPES`、`DROP_ITEMS`（含 `potion:'药水'`）、`normalizeDropRules`/`normalizeRewardList`（含 `potionId`）、`MINIMAP_MARKER_TYPES/LABELS`、`ROOM_TYPES/ROOM_TYPE_LABELS`、`normalizeRoomMarker`、`DEFAULT_LEVEL`（`state.js:468`，`deathCinematic` 默认 = `DEFAULT_DEATH_CINEMATIC.id`）、**`DEFAULT_DEATH_CINEMATIC`**（`state.js:454`，默认「玩家被击败运镜」，`normalizeLevel` 注入所有关卡，见 §4⑨） | 663 |
| `src/systems/economy/run-items-runtime.js` | `RunItemsMixin`：局内药水队列 / 限时武器 / 限时加成 的入队、取用、每帧推进（到期回退）、图标预载 | `RunItemsMixin`（14 方法）`updateRunItems` `addRunItem` `preloadRunItemArt` | 210 |
| `src/systems/economy/run-items.js` | 局内消耗品纯逻辑（药水队列增删合并、上限、限时武器/限时加成数据结构，无 Phaser） | `potionQueueAdd` 等 | 63 |
| `src/systems/ui/battle-items.js` | `BattleItemsMixin`：战斗内数字键 4/5 交互（4 短按用队列首瓶药水 / 长按 ≥`POTION_HOLD_MS` 呼出轮盘；5 使用或取消限时武器）+ 轮盘/HUD 绘制 | `BattleItemsMixin` `updateBattleItemsInput` | 138 |
| `src/systems/ui/battle-items-art.js` | 局内消耗品 / 限时武器美术方案（图标）加载与绘制 | — | 205 |
| `src/systems/economy/drops.js` | 掉落物生成 / 磁吸 / 拾取：`spawnDrops` 规则循环含 `item==='potion'` 分支（`resolveDropPotionId(rule.potionId)` 解析具体药水 id）→ `spawnDropItems(...,potionId)` 挂 id；`updateDrops` 磁吸含 `gold/diamond/potion`；`collectDrop` 的 `type==='potion'` → `this.addRunItem(d.potionId,1)`；掉落物世界图标绘制在 `world-render.js` 的 `this.drops.forEach`（30 世界单位，图标未就绪退化白点并 `resolveArtRef` 补拉） | `spawnDrops` `spawnDropItems` `updateDrops` `collectDrop` | 143 |
| `src/pathfinding.js` | 网格构建 + A* 寻路（生成点可达性依赖） | `buildGrid`、`findPath`、`nearestWalkable` | 105 |
| `src/editor/room-panel.js` | 多箱庭房间面板：方格点选、尺寸弹窗、墙体重生成 | `applyRooms`、`renderRoomPanel`、`toggleRoomCell`、`updateRoomNumber` | 124 |
| `src/editor/trigger-panel.js` | 触发器事件列表编辑器（事件类型/时机/波次表单 + 能量门自动生成开关） | `renderTriggerEvents` | 292 |
| `src/editor/level-flow.js` | 关卡加载/切换/模式切换/试玩快照恢复 | `selectLevel`、`switchToLevel`、`setMode`、`restoreEditorSnapshot`、`redraw`、`fadeAndSwitch`、`startGame` | 222 |
| `src/systems/editor/editor-input.js` | 放置工具（trigger/gate/chest/portal/spawnzone…）建实体 | `EditorInputMixin`：`pointerDown`(12)、`pointerMove`(191) | 259 |
| `src/systems/constants.js` | `CELL`、`CHEST_*_FX_MS`、`GATE_SPAWN_MS`、`ENEMY_BEHAVIOR` | 见第 5 章 | 83 |
| `src/game-scene.js` | 场景装配：25 个 Mixin `Object.assign`(:902)、`update` 主循环；含 `InnerShopMixin`（紧跟 `ProgressionMixin`），`updateVendorInteract(dt)` → `updateVendorSlot()` → `updateRunItems(dt)` → `updateBattleItemsInput(dt)`；`addKeys` 注册 `NUMPAD4/NUMPAD5/DIGIT4/DIGIT5`（小键盘与主键盘数字键都响应） | `createGameScene` | 912 |
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
| 改关卡开场演出（黑幕渐显时长） | `level-flow.js:38` `startLevelIntro`、`level-flow.js:50` `updateLevelIntro` |
| 改玩家被击败 / 死亡运镜失败流程 | `level-flow.js:352 triggerPlayerDefeat`（幂等）+ `state.js` 的 **`DEFAULT_DEATH_CINEMATIC`（默认死亡运镜）/ `DEFAULT_LEVEL.deathCinematic` / `normalizeLevel` 注入（所有关卡默认生效，关卡自带同 id 的运镜则以关卡为准）** + §4⑨；运镜播放器/编辑器落点在 engine-editor skill，三个失败入口在 combat skill |
| 改切关淡入淡出时长 | `level-flow.js:22` `SWITCH_FADE_MS`（场景内）/ `editor/level-flow.js:113` `FADE_MS`（DOM 黑屏） |
| 新增一个关卡文件 | `data/levels/<id>.json` + 编辑器「新建关卡」按钮（`editor/bindings.js:252`） |
| 改售货机 F 键交互 / 局内商店落点 | `interactables.js:225 updateVendorInteract`（按 F → `this.openVendorShop(nearest)`）；商品池/老虎机种类由表格驱动（`tools/export-tables.mjs` → `data/inner-shop.json`），页面绘制与交互见 ui-interaction skill（`screens.js:drawVendorShop` / `economy/inner-shop-runtime.js`，详见 economy-numbers skill） |
| 加药水掉落 / 宝箱奖药水（potionId） | `state.js:37 DROP_ITEMS`(potion) + `normalizeDropRules`(121)/`normalizeRewardList`(182) 的 `potionId`；编辑器面板在 engine-editor skill（`drop-rules-panel.js`/`entity-properties.js`）；运行时消费 `economy/drops.js:spawnDrops`。数据契约见 §3.11 |
| 改局内药水/限时武器按键或轮盘 | `ui/battle-items.js:updateBattleItemsInput`（数字键 4/5）+ `game-scene.js:addKeys` 键码注册 + `ui/battle-items-art.js` 绘制；局内态字段与清零见 §3.10 |
| 通关后解锁/结算规则 | `level-flow.js:269` `settleVictory` |

## 3. 核心数据结构

`data/levels/<id>.json` 是唯一关卡数据源，读入后必过 `normalizeLevel`（`src/state.js:586`）；**归一化后的结构才是运行时契约**，缺字段会被补默认值，非法值会被 clamp。默认骨架见 `DEFAULT_LEVEL`（`src/state.js:468`）。

### 3.1 level 根字段

| 字段 | 类型 | 默认 / 取值范围 | 含义 | normalize 位置 |
| --- | --- | --- | --- | --- |
| `backgroundColor` | `#rrggbb` | `#0b1b2b` | 世界底色 | 直接透传 |
| `gridColor` | `#rrggbb` | `#173a55` | 网格线颜色 | 直接透传 |
| `showGridInPlay` | bool | `false` | 游戏态是否画网格 | 直接透传 |
| `ui` | `'battle' \| 'login' \| 'interface'` | `'battle'` | 关卡 UI 类型；`login` 判定为菜单关（`isMenuLevel`），镜头固定全图、无开场演出 | 透传 |
| `world` | `{width,height}` | 各 `max(600, v)`，默认 1920×1080 | 世界尺寸；多箱庭时由 `generateRoomLayout` 覆写 | `state.js:444` |
| `camera` | `{width,mode}` | `width max(300,v)` 默认 1920；`mode` 仅 `'center'`/`'deadzone'`（默认 deadzone） | 可见宽度决定缩放；`center` 始终居中玩家 | `state.js:448` |
| `cinematics[]` | 数组 | `[]`（缺省时 `normalizeLevel` 注入默认死亡运镜） | 运镜（过场动画）定义 `CinematicDef`，见 §3.12；**关卡未自带同 id 时，`normalizeLevel` 会补入一份 `DEFAULT_DEATH_CINEMATIC` 归一化副本**（关卡自带同 id 则以关卡数据为准） | `state.js:617` |
| `deathCinematic` | string | `DEFAULT_DEATH_CINEMATIC.id`（`'cine-1789288387998'`） | 玩家被击败时播放的运镜 id（对应 `cinematics[].id`）。**`normalizeLevel` 把空串/缺字段回落成默认死亡运镜 → 全部 16 个关卡 JSON 一字未改也默认都有玩家被击败运镜；副作用：无法用空串关闭（要关需另加显式开关字段）**，见 §4⑨；`normalizeLevel` 必须显式回传，否则落盘→读回即丢 | `state.js:626` |
| `walls[]` | 数组 | 见 3.2 | 静态墙体（同时喂寻路网格） | `state.js:452` |
| `enemies[]` | 数组 | 默认 3 只示例 | 预置敌人（进关即存在），`normalizeEnemy`(59) | `state.js:465` |
| `spawn` | 对象 | 见 3.3 | 玩家出生点 + 局内初始参数 | `state.js:474` |
| `dropRules` | 对象 | `{}` | 按敌人类型的掉落规则：`dropRules[敌人类型] = [{item,count,chance,potionId?}]`，`item`∈ gold/exp/charge/diamond/**potion**（potion 见 §3.11；数值详见 economy-numbers skill） | `state.js:579` |
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

### 3.5 trigger.events[] 事件类型（9 种，`EVENT_TYPES` @ `state.js:219`）

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
| `spawnGate` | `gateIds[]`（空则取距触发器最近的一扇门）；`auto:true` 时自动生成/启用触发器所在箱庭房间各通道的门 | 开门（封路） | `triggers.js:41` → `setGatesActive(…,true)` |
| `removeGate` | `gateIds[]`（同上兜底）；`auto:true` 时自动消除触发器所在箱庭房间各通道的门 | 关门（`closing=true`，动画后 `active=false`） | `triggers.js:43` |
| `bossBattle` | `bossId`（可选，母舰 enemy id；缺省取首个待机母舰） | 激活预置母舰 Boss（`bossActive=true` + 亮血条 + 开始移动/召唤） | `triggers.js:49` → `startBossBattle` |
| `playCinematic` | `cinematicId`（运镜动画 id，对应 `state.level.cinematics[{id}]`）、`focusTarget`（可选，`'boss'`=镜头中心锁定 BOSS 死亡位置） | 播放一段运镜（过场）动画：按关键帧插值驱动相机 `zoom/scrollX/scrollY/rotation` + 全屏蒙层 alpha；若配 `focusTarget:'boss'` 则镜头中心动态锁定 BOSS 被击败坐标；运镜可带 `timeScale` 慢动作 | `triggers.js` → `this.playCutsceneById(cinematicId, { focusTarget })` → `EditorCameraMixin.playCutscene`（见 engine-editor） |

**多箱庭能量门自动模式**：`spawnGate`/`removeGate` 事件加 `auto:true` 后，运行时 `setGatesActive` 走 `autoRoomGates`（`triggers.js`）——用 `roomPassagesForPoint`（`rooms.js`）算触发器所在箱庭房间各通道开口，经 `isGateOnPassage` 复用已在通道上的门；`spawnGate` 时通道若无门则**运行时新建**一扇（id `gate-<triggerId>-<edge>`）并启用，`removeGate` 时关闭。编辑器触发器事件面板勾选「自动（触发器所在箱庭通道的门）」会在编辑态**一次性生成**缺失门实体、写入 `gateIds` 并落盘（`trigger-panel.js` `autoGenerateGateEvent`），让门成为可见可微调的关卡内容；两者几何一致，已用 `Level1-Scene1` 验证（trigger-1-1→gate-1-1/gate-1-2、trigger-1-2→gate-1-3、trigger-1787751836609→gate-1787751706661）。

**Boss 战（母舰）**：母舰作为 Boss **预置**在关卡 `enemies[]`（`normalizeEnemy` @ state.js 保留 `boss` 配置与 **`cutsceneId`（BOSS 被击败时播放的运镜 id）**；`level-flow:283` 经 `initEnemy` 入队），未激活 `bossActive=false` = 待机（**无敌**、不移动、不召唤、无血条）。踩带 `bossBattle` 事件的触发器激活：`triggers.js:startBossBattle` 置 `bossActive=true` + `bossTarget` + `bossBarReveal=0`，UI 顶部血条见 `ui-interaction`（`drawBossBar`/`updateBossBar`）。大小（`artScale`）/召唤间隔（`boss.spawnInterval`）/召唤表（`boss.spawnTable`，格式 `type*count,...`）在编辑器属性面板配置（`entity-properties.js` 母舰字段）。**BOSS 被击败**：`enemy-ai.js:defeatEnemy` 里 `e.type==='mothership' && e.bossActive && e.cutsceneId` 时 `this.playCutscene(clip, { focusTarget:'boss', x:e.x, y:e.y })`（镜头锁定死亡位置 + 白闪），运镜引擎见 engine-editor 坑 31。`bossBattle` 事件类型双份维护：`state.js:EVENT_TYPES` + `editor/entity-properties.js:eventTypeOptions`。

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
| `chests[]` | `trigger`：`'start'`（进关即有）/`'trigger'`；`triggerId`；`openRadius max(20,v)=50`；`rewards[]`（`item`∈gold/exp/charge/diamond/**potion**、`count`、`chance` 0-100，`count<=0` 会被过滤；`item==='potion'` 时附 `potionId`，见 §3.11）；指引字段组 | 走近 `openRadius` 内**自动**开箱（`updateChests` 78） | `state.js:217` |
| `portals[]` | `w max(30,v)=120`、`h max(20,v)=60`、`rotation=0`、`trigger`/`triggerId`、`interactRadius max(40,v)=90`、`visible`；指引字段组 | 按 F 撤离 → `usePortal` → `state='end'` + `settleVictory` | `state.js:182` |
| `vendors[]` | `w=130`、`h=96`、`interactRadius max(30,v)=120`、`visible`；指引字段组（**商品与老虎机结果不在此包配**，由策划表控制，见 §3.6.1） | 按 F 经 `this.openVendorShop(nearest)` 打开 `vendor` 局内商店页 | `state.js:200` |
| `idols[]` | `w=h=110`、`interactRadius max(40,v)=130`、`visible`；指引字段组 | 按 F 弹 3 张祝福卡，选 1 生效并 `used=true`（不可再用）；**点空白关闭不消耗**，可再交互 | `state.js:213` |
| `icons[]` | `w=h=64`、`src`、`interactRadius=120`、`tipText='按 F 交互'`、`event`∈`workshop`/`weapon`/`battle`（默认 workshop）；指引字段组 | 按 F 打开对应菜单页：`weapon`→武器商店、`battle`→关卡选择、其他→工坊 | `state.js:226` |

交互半径实际生效值 = `max(interactRadius, 半对角线 + 玩家半径 + 40)`（`interactables.js:115/141/174/233`），所以把实体拉很大时半径会自动跟着放大。

**指引字段组**（5 类交互实体通用，`state.js:157 guideFields()` 平铺展开）：`guide`（bool，默认 false，是否游戏内指引）、`guideRange`（`max(100,v)=600`，实体在视窗外且距玩家 ≤ 该值才显示指引箭头）、`guideIcon`（动态资产名/设计稿 id，空=实体名称文字占位）。F 键交互实体（portals/vendors/idols/icons，**不含 chests**）另有 `guideStopAfterUse`（bool，默认 **true**）：交互后（chest.opened / portal.used / idol.used / vendor·icon 首次按 F 置运行时 `guideUsed`）停止指引；配 false 则交互后继续指引。渲染与淡入淡出见 ui-interaction skill（`world-overlay.js:updateGuideArrows/drawGuideArrows`）。

#### 3.6.1 vendors 运行时扩展字段（JSON 里不存在；`restart` 生成副本时 / 首次打开始写）

售货机的 `stock`/`bought`/`slot` 是**运行时**字段，不写进 `data/levels/*.json`，也不落到 `ctx.state.level.vendors`：

| 字段 | 类型 | 何时写 | 说明 |
| --- | --- | --- | --- |
| `stock` | `[{kind,id,name,desc,cost,artType,artName,durationSec?}]` / `undefined` | `openVendorShop` → `ensureVendorStock` → `setupVendorStock` 首次抽取 | 该实体**随机一次并持久**的 4 个商品（池 7 选 4 不重复）；同一实体重复打开不变，不同实体互相独立 |
| `bought` | `Set<index>` | 购买时 `add(index)` | 每商品限购 1 次 |
| `slot` | `{icons,prize,rolling,rollAt,settleAt,prizeAt,granted}` / `null` | `rollVendorSlot` 抽取 | 老虎机状态；每实体独立、不限次数 |

`this.vendors` 是 `(l.vendors||[]).map(v => ({...v}))` 的**副本**（`level-flow.js:144`），故上述字段随 `restart` 天然按局清零；**不要把状态写回 `ctx.state.level.vendors` 的原始实体**（编辑器会看到脏数据，见第 7 章）。

### 3.7 gates[] / spawnZones[]

| gates 字段 | 默认 | 说明 |
| --- | --- | --- |
| `id` | `gate-<i+1>` | `spawnGate`/`removeGate` 事件按 id 引用 |
| `w`,`h` | `max(20,v)=237` / `max(10,v)=45` | 碰撞时高度按 `h*1.42` 放大（`activeGateWalls` 90） |
| `rotation` | 0 | 度 |
| `label` | `'Barrier Active'` | 门上文字（英文，用 `FONT_TECH` 字体，与传送门 `EVACUATION` 同字体）；`drawGates` 渲染时 `setDepth(12)` 置于世界覆盖文字层，避免被门栏/地面实体叠压显糊 |
| `color1`/`color2` | `#ffa200`/`#ffa200` | 两色块默认同为橙色（`GATE_OUTER_COLOR`/`GATE_INNER_COLOR`）；`drawGates` 外侧 inner/outer 两矩形各用其一 |
| `active` | `false` | 初始是否已封路；运行时 `spawnT` 0→1 为开门动画 |
| `shieldOnly` | `false` | 只挡子弹门：`active=false`（触发前）不可见、不挡玩家、只挡子弹（`bulletGateWalls`，triggers.js:129）；被 `spawnGate` 触发 `active=true` 后转为普通可见全挡门；`removeGate` 后回退为只挡子弹。用于「进房间前禁止玩家狙击房内交互物」——玩家子弹被拦、本人可穿过；敌人寻路/移动碰撞仍走 `activeGateWalls`（不含盾门未激活态） |
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
| `cells[].type` | `'normal'` \| `'unknown'` | `'normal'` | 房间类型（房间面板「房间类型」下拉可配，`ROOM_TYPES/ROOM_TYPE_LABELS` @ `state.js`）：`unknown`=未知房间——进入前房内内容物不可见，玩家进入该房间后 0.8s 渐显（`ROOM_REVEAL_MS`，`level-flow.js` `updateRoomReveal`/`roomRevealAlpha`）；墙体轮廓始终可见；小地图未揭示时显示「未知」占位。归一化 `normalizeRoomLayout`（rooms.js）对非法值回落 `normal`，`generateRoomLayout` 的 `rooms[i]` 透传 `type` |
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

### 3.10 局内态运行时字段（挂场景对象、仅当局有效、随关卡重开清零、绝不写存档）

`state.player` **就是存档源**（`progression.js:persistSave` → `ctx.onPlayerSave`），所以「仅本局有效」的字段一律挂**场景对象**（`this.xxx`，见 §3.6.1 售货机同源），由 `level-flow.js:restart`（:147-153）统一清零：

| 字段 | 类型 / 上限 | 含义 |
| --- | --- | --- |
| `runItems` | `[{id,count}]`，上限 4 | 局内药水队列（数字键 4 使用 / 长按呼轮盘） |
| `runTimedWeapons` | `[{id,name,durationSec,remainSec}]`，上限 1 | 局内限时武器（数字键 5 使用 / 取消） |
| `runEffects` | `[{id,name,artType,artName,effect:{type,value,sec},remainSec,totalSec}]` | 限时加成（生效中，到期自动回退） |
| `tempWeaponActive` / `tempWeaponSaved` | bool / 对象\|null | 临时武器是否使用中 / 启用时暂存的主武器态 |
| `potionWheel` / `potionKeyHold` | 对象\|null | 药水选择轮盘状态 / 数字键 4 按住状态 |
| `potionWheelText` | Phaser.Text\|null | 轮盘名称文本（独立 Phaser 对象，重开需额外 `setVisible(false)`） |
| `player.itemShields` | `[{hp,maxHp}]` | 局内即时护盾，按顺序吸收伤害（挂 `this.player`，**非** `state.player`） |

### 3.11 「药水」掉落种类（关卡级掉落规则 + 宝箱奖励，`potionId`）

- **关卡级掉落规则**：`state.level.dropRules[敌人类型] = [{ item:'potion', count, chance, potionId }]`；`potionId` 留空 = 随机药水。
- **宝箱奖励**：`chest.rewards = [{ item:'potion', count, chance, potionId }]`。
- **归一化**：`state.js:normalizeDropRules`(121) 与 `state.js:normalizeRewardList`(182) 共用白名单 `DROP_ITEMS`（`state.js:37`，含 `potion:'药水'`）；`item !== 'potion'` 时把 `potionId` 归空串。
- **敌人个体 `e.drops = {gold,exp,diamond}` 不支持药水**：只有「关卡级掉落规则」与「宝箱奖励」两个面板能配药水。
- **运行时消费**：`drops.js:spawnDrops` → `resolveDropPotionId(rule.potionId)` 解析具体药水 id → `spawnDropItems(...,potionId)`；拾取走 `collectDrop` 的 `type==='potion'` → `addRunItem`。

### 3.12 运镜定义 `cinematics[]`（`normalizeCinematic` @ `state.js:398`）

```json
{ "id": "cine-1789288387998", "name": "玩家被击败运镜", "durationMs": 3400,
  "timeScale": 1,        // clip 级慢动作（0.05~1）
  "focus": "player",     // 'none' | 'player' | 'boss'（默认 'none'）
  "blackHoldMs": 500,    // 结算黑幕保持时长，整数 0~3000（默认 0）
  "keyframes": [ { "t": 0, "zoom": 1, "panX": 0, "panY": 0, "rotation": 0, "alpha": 0, "ease": "linear",
                   "timeScale": 1, "vignette": 0, "letterbox": 0, "tint": 0, "tintColor": "#1a0a0a",
                   "flash": 0, "flashColor": "#ffffff", "desat": 0 } ] }
```

| 字段 | 默认 / 范围 | 说明 |
| --- | --- | --- |
| `durationMs` | 整数 | 运镜总时长 ms |
| `timeScale` | 0.05~1（clip 级） | 运镜慢动作倍率（关键帧 `timeScale` 缺省继承它） |
| `focus` | `'none'`/`'player'`/`'boss'`（默认 none） | 焦点模式；`player`/`boss` 时 pan 被焦点目标覆盖、运行时每帧跟随 |
| `blackHoldMs` | 整数 0~3000（默认 0） | 死亡流程结算黑幕保持时长，见 §4⑨ |
| 关键帧 `timeScale` | 0.05~1（缺省继承 clip `timeScale`） | 该段世界 dt 缩放 |
| 关键帧 `vignette`/`letterbox`/`tint`/`flash`/`desat` | 0~1（默认 0） | 叠层强度（暗角/黑边/色调/闪光/去饱和） |
| 关键帧 `tintColor`/`flashColor` | `'#1a0a0a'` / `'#ffffff'` | 接受 `#rgb`/`#rrggbb` → 规整 `#rrggbb` 小写（`normalizeHexColor`）；**不插值，取所在段起点帧颜色** |
| 关键帧 `panX`/`panY` | 0 | **视口左上角世界坐标**（与运行时相机 `scrollX` 同源，见 engine-editor §7 坑 31） |
| 关键帧 `ease` | `'linear'` | 12 种之一（`linear/sineIn/sineOut/sineInOut/quadIn/quadOut/quadInOut/cubicIn/cubicOut/cubicInOut/easeOut/easeInOut`；`easeOut`/`easeInOut`=Sine） |

- 模块私有工具 `clampUnit(value, fallback)`（0~1 钳制）、`normalizeHexColor(value, fallback)`（颜色规整），**不导出**，只在 `normalizeCinematic` 内用。
- 编辑器（`src/editor/cinematics-board.js`）与播放器（`src/systems/editor/editor-camera.js`）的字段一致性要求见 engine-editor skill；`docs/cinematic-preview.html` 是离线预览页。
- **默认「玩家被击败运镜」**：`state.js:DEFAULT_DEATH_CINEMATIC`（`state.js:454`，逐字搬运 `data/levels/Level1-Scene1.json` 的 `cine-1789288387998`：3 关键帧 t0 zoom1 alpha0 / t2000 zoom5 pan40,40 rot-16 / t4450 zoom**1000** alpha1，`durationMs 4450`、`timeScale 0.2`、`focus:'none'`、`blackHoldMs 0`）。`normalizeLevel`（`state.js:586`）取 `deathId = data.deathCinematic || DEFAULT_DEATH_CINEMATIC.id`，并在 `cinematics` 的 IIFE 里：若列表无同 id 则 push 一份 `normalizeCinematic(clone(DEFAULT_DEATH_CINEMATIC))`，最后 `deathCinematic: deathId`。**→ 所有关卡（16 个 JSON 一字未改）经 `normalizeLevel` 后默认都拥有玩家被击败运镜；关卡自带同 id 的运镜（如 `level-1.json` 的 4 帧变体 t4000 zoom10 / t4450 zoom100）以关卡为准**。副作用：`deathCinematic` 存空串会被回落成默认值，即**无法用空串关闭死亡运镜**（要真正关闭需另加显式开关字段）。

## 4. 关键流程

**① 关卡加载 → normalize → 场景构建 → 开场演出**

`editor/level-flow.js:176 selectLevel` → `api.js:19 loadLevel`（GET `/api/levels/:id`）→ `state.js:586 normalizeLevel` 写 `state.level`（含默认死亡运镜注入）→ `editor/level-flow.js:137 setMode` 销毁旧 Phaser.Game → `startGame`(73) 新建场景 → `game-scene.js:40 create`（贴图预载 + 输入注册）→ `game-scene.js:99 this.restart()` → `level/level-flow.js:88 restart`：清空所有运行时数组、重置 `triggered`/`triggerState`/`waveEvents` → 从 `l.crates/barrels/chests/portals/vendors/idols/icons/gates` 浅拷贝出运行时副本（宝箱/传送门 `spawned = trigger==='start'`；`this.vendors` 为副本，其 `stock`/`bought`/`slot` 随之按局清零）→ 清零局内态 `this.runItems=[]`、`this.runTimedWeapons=[]`、`this.vendorActive=null`（`level-flow.js:147-149`）→ `pathfinding.js:1 buildGrid`（墙 + 木箱 + 油桶，`CELL=30`、`inflate=PATH_INFLATE(24)`）→ 组装 `this.player`（武器/弹药/充能/装备/存档字段）→ `l.enemies.map(initEnemy)` → `applyPlayerBounds`(28) → `setupPlayCamera` → 非菜单关 `startLevelIntro`(38)：只做黑幕渐显、无镜头拉近（战斗关 3.5s / 其他 1.2s），期间 `state='transition'` → `updateLevelIntro`(50) 结束置 `state='playing'`。

**② 玩家进入触发器 → 事件派发 → 波次生成 → 敌人清空 → 异步事件**

`game-scene.js:481 updateTriggers`（每帧）→ `triggers.js:203 updateTriggers`：`geometry.js:94 hitTrigger` 判定 inside → 单次触发器（`once!==false` 或含 `switchLevel`）查 `this.triggered` Set；重复触发器按 `cooldown` 判 → `triggers.js:22 fireTrigger`：`when==='enemiesCleared'` 的事件推入 `st.pendingClearEvents`，其余立即 `dispatchTriggerEvent`(36) → `spawnEnemy` 走 `triggerSpawnEnemy`(93)：读 `resumeOnReturn` 决定起始 `waveIndex`，把 `spawn` 回写到 `t.spawn` 供下游读取，`runTriggerWave`(111) → `time.delayedCall(delay)` 定时链，`waitForClear` 时每 120ms 轮询，`fire()` 按 `mode` 分派 `spawnOffscreen`/`spawnInScreen`/`createSpawnEffect`，然后 `waveIndex++` 并挂下一波（延迟 = 本波 `postDelay` + 下波 `preDelay`），所有 timer 都打 `triggerId` 标记并 push 到 `this.waveEvents` → 敌人被击杀走 combat 侧 `defeatEnemy` → `game-scene.js:482 checkAsyncTriggerEvents`(triggers.js:168) 每帧检查：`triggerHasPendingWaves` 为假 + 无 `alive && triggerId===t.id` 的敌人 + 无同 `triggerId` 的 `lockEffects` → 派发挂起事件 + `spawnChestsForTrigger(t.id)` + `spawnPortalsForTrigger(t.id)`。

**③ 门（gate）开合链路**

触发器 `spawnGate` 事件 → `triggers.js:66 setGatesActive(ev,true,t)`：按 `ev.gateIds`/`ev.gateId` 找门，全找不到则取距触发器（或事件）最近的一扇 → `gate.active=true; gate.spawnT=0` → `game-scene.js:150-159` 每帧 `spawnT += dt/GATE_SPAWN_MS(500)` 升到 1（开门动画）→ `triggers.js:86 activeGateWalls` 把 `active && visible!==false` 的门转成碰撞矩形（高度 `h*1.42`），被 `player-combat.js:106 pointInWall`、子弹墙判定（`game-scene.js:342/427`）、敌人碰撞共用；编辑器态返回空数组 → `removeGate` → `closing=true` → 每帧 `spawnT` 递减到 0 后 `active=false`。

**④ 交互物链路**

- 宝箱：`trigger:'start'` 在 `restart` 即 `spawned=true`；`trigger:'trigger'` 等 `checkAsyncTriggerEvents` → `interactables.js:33 spawnChestsForTrigger` → `spawnChest`(26) 置 `fx={t:CHEST_SPAWN_FX_MS(260),kind:'spawn'}` → `updateChests`(76) 每帧递减特效并检测玩家距离 ≤ `openRadius` → `openChest`(66)：`opened=true`、`fx=open(320ms)`、按 `rewards[].chance` 掉落 `spawnDropItems`（economy 侧）。
- 传送门：同样两种出现方式 → `updatePortalInteract`(161) 只认 `spawned && !used && visible!==false`，靠近记 `portalNearest` 并渐显提示（`portalTipT += dt/180`）→ 按 F → `usePortal`(59)：`used=true`、`state='end'`、`settleVictory()`。
- 售货机：`updateVendorInteract`(225) → 靠近记 `vendorNearest` 渐显提示 → 按 F 置 `guideUsed` + `this.openVendorShop(nearest)`（记 `vendorActive`、抽/持久 `vendor.stock`、开 `vendor` 局内商店页）；页面绘制/购买/抽奖链路见 ui-interaction skill §4⑦，数值见 economy-numbers skill。
- 神像：`updateIdolInteract`(102) → 按 F → `openIdolOffer`(188)：洗牌 `IDOL_BUFFS` 按 `IDOL_OFFER_COUNT` 取 n 张（配置 `data/ui/idol-buffs.json` 的 `offerCount`），`state` 置 `paused` 并存 `prevState` → `chooseIdolBuff`(207) 调 `buff.apply(this)` 改 `player.combat`，`idol.used=true`，`closeIdolOffer`(200) 恢复 `playing`；`onUIPointer` 未命中卡片时置 `idolOffer.closing=true` 走离场滑出后 `closeIdolOffer`（点空白关闭，**不设 `used`**，可再次按 F 重新随机）。
- 图标：`updateIconInteract`(128) → 按 F → `triggerIconEvent`(153) 按 `icon.event` 打开 `weapon`/`levelSelect`/`workshop` 页。

所有交互 update 在 `game-scene.js:486-490` 顺序调用，且 `editing` 或 `state!=='playing'` 时清空 nearest 与 tip 计时。

**⑤ 关卡通关 → 结算 → 切到下一关（含淡入淡出）**

`complete` 事件或 `usePortal` → `state='end'` + `level-flow.js:269 settleVictory`：金币写 `p.currency.gold`；`levelId` 非 `newbee`/`login`/`knight-home` 时 push 进 `p.levels.completed`，并记 `p.levels.current`，`persistSave` 落盘。切关另一条路径：`switchLevel` 事件 → `level-flow.js:70 beginSwitch` 记 `{phase:'out', target, spawnPoint}`、`state='transition'` → `updateTransition`(283) 每帧 `alpha += dt/SWITCH_FADE_MS(500)`，`alpha>=1 && switching` 时调 `ctx.onSwitchLevel`（= `editor/level-flow.js:203 switchToLevel`：拉目标关卡 JSON、`normalizeLevel`、按 `spawnPoint` 覆写 `level.spawn.x/y`）→ 回调里 `this.restart()` 并转 `phase:'in'`，`alpha` 退回 0 后 `state='playing'`。`beginExternalFade`(81) 用于外部流程（返回菜单等），淡黑到底后执行 `transitionDone`。菜单/存档跳转另用 DOM 黑屏 `editor/level-flow.js:115 fadeAndSwitch`（`FADE_MS=350`）。

**⑥ 编辑器改关卡 → 存草稿 / 存正式 → 试玩快照与恢复**

任何编辑操作 → `editor/level-flow.js:59 redraw`：重绘场景 + `sync()` 刷面板，**仅 `state.mode==='editor'`** 时 `saveDraft`（`api.js:24`，实际等于 `saveFormal`，POST `/api/levels/:id` 直接写 `data/levels/<id>.json`）；试玩/预览态的指针事件也会触发 redraw，靠这个 mode 判断避免污染关卡文件。触发器面板 / 房间面板另有 `saveQuiet()` 直接 `saveDraft`。进入试玩前：`editor/bindings.js:222`（游戏预览）与 `editor/save-flow.js:76 startTrial`（试玩）都先 `await saveDraft` 再存快照 `ctx.editorSnapshot = { level: clone(state.level), levelId }`（试玩还存 `editorPlayerSnapshot` 并把 `state.saveStore` 切 `'test'`）→ 退出时 `editor/level-flow.js:160 restoreEditorSnapshot` 用快照还原 `state.level/levelId`、还原玩家数据、`saveStore` 回 `'formal'`，抹掉游戏内切关造成的污染。「保存」按钮（`bindings.js:233`）走 `saveFormal` 同一个接口；「加载」按钮 `selectLevel(id, true)` 用 `get('/levels/:id')` 强制读正式文件。

**⑦ 多箱庭房间改动链路**

房间面板点格 → `room-panel.js:87 toggleRoomCell`（新格必须与已选格四邻相邻，否则报「新方格必须与已选方格相邻」）→ `applyRooms`(18)：`generateRoomLayout` → 保留非 `room` 墙 + 新生成墙、覆写 `l.world`、若出生点不在任何房间内（`spawnInRooms`）则移到首个房间中心 → `resetEditorCamera` → `redraw` 落盘。

**⑧ 局内药水 / 限时武器链路（战斗内数字键 4/5 + 掉落→拾取）**

- **按键**：`game-scene.js:addKeys` 注册 `NUMPAD4/NUMPAD5/DIGIT4/DIGIT5` → `ui/battle-items.js:updateBattleItemsInput(dt)`（每帧）：数字键 4 **短按**使用 `runItems` 队列首瓶药水、**长按 ≥ `POTION_HOLD_MS`(160ms)** 呼出药水选择轮盘（松开按悬停扇区使用）；数字键 5 使用或取消 `runTimedWeapons`。屏蔽条件：编辑态 / 菜单页 / 设置蒙层 / `state!=='playing'` / 菜单关 / 骑士之家。
- **推进**：`economy/run-items-runtime.js:updateRunItems(dt)` 递减 `runEffects` 与 `runTimedWeapons[0].remainSec`，到期清项 / `runTimedWeapons=[]` 并恢复主武器。
- **掉落→拾取**：`economy/drops.js:spawnDrops`（含 `item==='potion'` 分支）→ 世界图标绘制在 `ui/world-render.js` 的 `this.drops.forEach` → `updateDrops` 磁吸（`gold/diamond/potion`）→ `collectDrop` 的 `type==='potion'` → `this.addRunItem(d.potionId, 1)`。
- **调度位置**：`game-scene.js:update()` 里 `updateVendorSlot()`（售货机页面推进）之后依次 `updateRunItems(dt)`、`updateBattleItemsInput(dt)`，保证售货机当帧购买的药水当帧进队列；限时加成本帧到期则晚一帧回退，可忽略。

**⑨ 玩家被击败 → 死亡运镜 → 结算页（`triggerPlayerDefeat`）**

三个失败入口（`combat/player-combat.js:damagePlayer` 血量归零、`combat/boss25t5.js:boss25t5KillPlayer`、`game-scene.js` 母舰贴身秒杀分支）统一调 `level-flow.js:352 triggerPlayerDefeat()`（**幂等**：`this.editing` / 已存在 `this.playerDeathFlow` → return；**`state.level.deathCinematic` 默认 = `DEFAULT_DEATH_CINEMATIC.id`，故所有关卡默认都播死亡运镜**）：

- `ctx.state.mode` 非 `play|trial` → 直接 `state='fail'` + `syncUIState()`（编辑器不播运镜）。
- `ctx.state.level.deathCinematic` 找不到对应 clip → 同上 fallback。
- 否则 `playerDeathFlow={phase:'cinematic'}` → `playCutscene(clip, { focusTarget: clip.focus || 'player', holdBlack:true, onComplete })` → `phase='hold'` → `time.delayedCall(clip.blackHoldMs ?? 500, …)` → `playerDeathFlow=null; state='fail'; syncUIState(); draw(); hideCinematicFade()`（**先画结算页再撤黑幕**，避免闪帧）。能承受 `playCutscene` 的**同步** `onComplete`（clip 无关键帧时）。

`game-scene.js`：`create()` 初始化 `this.playerDeathFlow=null`；`update()` 里 `deathSim = state==='fail' && !!playerDeathFlow`、`inputLocked = deathSim || !!playerDeathFlow || (cinematicInputLocked?.() ?? false)`；早退条件改 `if (state !== 'playing' && !deathSim)`（让世界继续按慢放 dt 跑）；gate 掉方向键/开火/护盾/`toggleGrowth`/各 `updateXxxInteract`/`checkAsyncTriggerEvents`。`ui-runtime.js:drawUI` 新增 `else if (this.playerDeathFlow) hideHudOverlay()` 分支（**放在 `state==='end'||'fail'` 结算分支之前**），`activeGraph` 计算也排除它。`enemy-ai.js:defeatEnemy` 的 BOSS 击破运镜 `if (!this.playerDeathFlow)` 抑制（否则顶掉死亡运镜 → `playerDeathFlow` 卡死，见 engine-editor 坑 49）。`restart()` 清 `playerDeathFlow=null` + `hideCinematicFade?.()`。

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
| 开场演出时长 | `src/systems/level/level-flow.js:40` | 战斗关 3.5s / 其他 1.2s | 开场黑幕渐显时长（无镜头拉近） | 进关等待感；`state` 期间不可操作 |
| `deathCinematic` 默认 / `blackHoldMs` 默认 | `state.js:485` / `state.js:431` | `'cine-1789288387998'`（= `DEFAULT_DEATH_CINEMATIC.id`）/ `0`（clamp 0~3000） | 死亡运镜 id / 结算黑幕保持时长 | 见 §4⑨（默认值由 `normalizeLevel` 注入，见 §3.12） |
| 运镜关键帧叠层默认 | `state.js:419-425` | `vignette`/`letterbox`/`tint`/`flash`/`desat` 各 0；`tintColor '#1a0a0a'`、`flashColor '#ffffff'` | 叠层强度/配色默认 | 见 §3.12 |
| `applyPlayerBounds` 的 `pad` | `src/systems/level/level-flow.js:31` | 2000 | 相机边界外扩 | 出生点在世界外时相机不抖 |
| `LEVEL_HP_BONUS` | `src/systems/level/level-flow.js:23` | 10 | 编辑器预览态每级血量加成 | 仅编辑器/预览，不影响正式档 |
| `HUD_IDLE_MS` | `src/systems/ui/hud.js:18` | 3000 | HUD 常态脉冲周期，`restart` 里重置 | 详见 ui skill |
| `roomComplete` 自动回退 | `src/systems/level/triggers.js:48` | 1500 ms | secure 态自动回 explore 的延迟 | 房间清空后的 HUD 表现 |
| `POTION_HOLD_MS` | `src/systems/ui/battle-items.js:21` | 160 | 数字键 4 长按阈值 ms | 短按=直接用首瓶药水；长按 ≥160ms=呼出选择轮盘 |
| 药水队列上限 / 限时武器上限 | `src/systems/economy/run-items.js` | 4 / 1 | `runItems` 最多 4 瓶、`runTimedWeapons` 最多 1 把 | 超出上限时丢弃/合并；影响 HUD 槽位 |
| 药水效果类型 | `策划文档/server/消耗品.xlsx` → `data/inner-shop.json` | `heal`/`attackPower`/`shield`/`moveSpeed` | 表格驱动（改表 → `node tools/export-tables.mjs`），代码只认这 4 种 type | 新增效果类型要加代码分支（见 engine-editor 导表章） |

## 6. 扩展指南

### 6.1 新增一种触发器事件类型（例：`playSound`）

1. `src/state.js:219` 把 `'playSound'` 加进 `EVENT_TYPES`（不加会被 `normalizeTriggerEvent` 直接丢弃）。
2. `src/state.js:242 normalizeTriggerEvent` 加分支，返回 `{ type, when, ...归一化后的参数 }`；无参数事件可并进 `complete/roomComplete/combat` 那一行（249）。
3. `src/systems/level/triggers.js:36 dispatchTriggerEvent` 加 `else if (ev.type === 'playSound') { ... }` 实现行为。
4. 若需异步（清敌后触发），什么都不用做——`when:'enemiesCleared'` 由 `fireTrigger`(22) 统一入队，但要确认你的事件在 `checkAsyncTriggerEvents`(168) 的时序里成立。
5. `src/editor/trigger-panel.js:17 triggerEventParamsHtml` 加参数表单分支（用 `data-event-i` + `data-event-field` 约定，`setNested` 会自动写回）；同时在 `list` 的 `change` 处理器 `el.dataset.eventType` 分支（177-197）里给新类型初始化默认参数字段。
6. 事件类型下拉是**硬编码**的中文标签数组 `eventTypeOptions`（`src/editor/entity-properties.js:79-87`，与 `EVENT_TYPES` 各自独立维护），必须手动补一行 `['playSound', '播放音效']`，否则面板选不到。同处还传入 `enemyTypeOptions`(76)、`levelOptions`(77)、`gateOptions`(88)。
7. 验证：`npx vite build` → `node server.js` → 编辑器给某触发器加该事件 → 试玩确认派发。

> **已落地实例 `playCinematic`（播放运镜）**：新增事件类型的最佳参考。涉及 4 处同步：① `state.js:EVENT_TYPES` 加 `'playCinematic'` + `normalizeTriggerEvent` 加分支保留 `cinematicId`；② `triggers.js:dispatchTriggerEvent` 加 `this.playCutsceneById(ev.cinematicId)`（方法本体在 `EditorCameraMixin`，见 engine-editor）；③ `trigger-panel.js:triggerEventParamsHtml` 加「运镜动画」下拉（options 取 `state.level.cinematics`）；④ `entity-properties.js:eventTypeOptions` 加 `['playCinematic','播放运镜']`。运镜数据本身是**关卡级**字段 `state.level.cinematics`（`CinematicDef` 数组），在运镜编辑器（`cinematics-board.js`，engine-editor 分类）里配，触发器用 `cinematicId` 引用。**新增事件类型若有动画/数据携带，务必同时加 `DEFAULT_LEVEL` 对应默认数组 + `normalizeLevel` 归一**，否则导入即丢。

### 6.2 新增一种交互物（例：`shrines`）

1. `src/state.js` 加 `normalizeShrine(v, i)`（照 `normalizeIdol`(192) 写：id 兜底、坐标、`w/h` 下限、`interactRadius`、`visible`）。
2. `src/state.js:468 DEFAULT_LEVEL` 加 `shrines: []`，`normalizeLevel`(586) 加 `shrines: (Array.isArray(data.shrines) ? data.shrines : []).map(normalizeShrine)`。
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

### 6.5 在关卡里放一台售货机（局内商店）

1. 编辑器选「售货机」工具 → 画布点击即建实体（`editor-input.js:162` 默认 `{w:130,h:96,interactRadius:120,visible:true}`）。
2. 属性面板（`editor/entity-properties.js:314` 的 vendors 分支）可配字段：`x` / `y` / `w` / `h` / `interactRadius`（交互半径）/ `visible` / 指引字段组（`guide`/`guideRange`/`guideIcon`/`guideStopAfterUse`，由 `guideRows(entity, true)` 展开）。
3. **商品池、老虎机种类、抽奖价/金币奖、图标全部由策划表控制，编辑器不需要也不应加任何字段**（改 `策划文档/server/*.xlsx` → `node tools/export-tables.mjs` → `data/inner-shop.json`，无需改代码；见 ui-interaction skill §6F、economy-numbers skill）。
4. 交互半径实际生效值 = `max(interactRadius, 半对角线 + 玩家半径 + 40)`（`interactables.js:238`），把实体拉大时半径自动放大。
5. 验证：试玩 → 走近按 F 打开商店页；退出试玩确认编辑器实体数据未变（`stock`/`bought`/`slot` 只写在运行期副本上）。

### 6.6 在关卡里配药水掉落 / 宝箱奖药水

1. **关卡级掉落规则**：编辑器「掉落规则」面板（`editor/drop-rules-panel.js`）按敌人类型选「药水」后，会在「数量」前插入**药水下拉**（`data-drop-field="potionId"`，选项来自 `getPotionList()`，空值显示「（随机药水）」）。
2. **宝箱奖励**：属性面板宝箱分支的奖励子编辑器同样加药水下拉（`data-reward-k="potionId"`）。
3. 药水 id 来自策划表：`策划文档/server/消耗品.xlsx` → `node tools/export-tables.mjs` → `data/inner-shop.json`（面板选项由运行时 `/api/inner-shop` 提供，首次打开若数据未加载会自动补拉并重渲染，详见 engine-editor skill 坑）。
4. **不支持**敌人个体 `e.drops`（只有 gold/exp/diamond）——要掉药水只能用上面两个面板。
5. 验证：给某敌人类型配 `potion` 规则 → 试玩击杀看是否掉药水图标 → 拾取后队列 +1 → 短按 4 用首瓶、长按 4 呼轮盘选瓶。

### 6.7 在关卡里配「玩家被击败运镜」（死亡运镜）

1. **配运镜**：编辑器「运镜」页（`editor/cinematics-board.js`，engine-editor skill）新建/编辑一条 `CinematicDef`；关键帧可加 8 个新字段（`timeScale`/`vignette`/`letterbox`/`tint`/`tintColor`/`flash`/`flashColor`/`desat`），并把 `focus` 设成 `player`（镜头跟玩家）、`blackHoldMs` 设结算黑幕保持时长（如 500）。
2. **挂到关卡**：在该运镜页勾选 `#cinematicDeathFlag`（写 `state.level.deathCinematic = <运镜 id>`）；或直接改关卡 JSON 顶层 `deathCinematic: "cine-..."`（见 §3.12）。
3. **归一化必有回传 + 默认注入**：`normalizeLevel` 里 `const deathId = (typeof data.deathCinematic === 'string' && data.deathCinematic) || DEFAULT_DEATH_CINEMATIC.id`（`state.js:589`），返回对象写 `deathCinematic: deathId`（`state.js:626`），并在 `cinematics` IIFE 里按 `deathId` 补入默认运镜 —— **漏回传会被静默丢弃**（与 `cutsceneId` 的坑同源）；**空串会被回落成默认死亡运镜，无法用空串关闭**。
4. **数据样例**：`data/levels/level-1.json` 的 `cine-1789288387998`「玩家被击败运镜」（`durationMs 3400` / `timeScale 1` / `focus 'player'` / `blackHoldMs 500` / 6 关键帧带全部新字段），`Level1-Scene1.json` 追加同一条 + 顶层 `deathCinematic`。
5. **验证**：试玩 → 被打死（或走 `boss25t5KillPlayer` / 母舰贴身秒杀）→ 应播死亡运镜 → 黑幕保持 `blackHoldMs` → 结算页出现；黑幕期间按 F/4/5/ESC **不应**打开菜单页（`playerDeathFlow` 输入锁，见 §4⑨ + engine-editor 坑 50）。

## 7. 坑与约束

- **Mixin 装配顺序与同名覆盖**：`src/game-scene.js:559` 一次 `Object.assign(EditorScene.prototype, …19 个 Mixin)`，后者覆盖前者。本分类的四个 Mixin 顺序为 `SpawningMixin → TriggersMixin → InteractablesMixin → LevelFlowMixin`（在 `DestructiblesMixin` 之后、`HudMixin` 之前）。新增方法前先确认方法名在其他 Mixin 中不存在，否则会静默覆盖。
- **`const ctx = this.ctx;` 约定**：Mixin 方法体里用到外部注入 `ctx`（`ctx.state`、`ctx.onSwitchLevel`、`ctx.redraw`）时，首行必须写 `const ctx = this.ctx;`（见 `triggers.js:169/189/204`、`level-flow.js:89/259/270/284`、`spawning.js:356`）。不要在 Mixin 里 import `editor/context.js`——场景侧只认注入的 ctx。
- **触发器状态在 `this.triggerState`**：`Map`，key 是 `trigger.id`，value `{ inside, lastFire, waveIndex, timer, pendingClearEvents }`。取出改完必须 `this.triggerState.set(t.id, st)` 回写（`get` 返回引用，但代码里存在「取不到就新建对象」的分支，漏写回会丢状态）。单次触发记录在另一个 `this.triggered` Set 里。两者都在 `restart`(level-flow.js:98-99) 重置。
- **`t.spawn` 是回写的临时字段**：`triggerSpawnEnemy`(triggers.js:107) 把事件里的 `spawn` 赋给 `t.spawn`，因为 `runTriggerWave`/`spawnInScreen`/`createSpawnEffect` 仍从 `t.spawn` 读波次。这意味着**同一触发器只能有一个生效的 `spawnEnemy` 事件**，配两个后者会覆盖前者的波次上下文。
- **波次中止与残留清理时机**：`stopTriggerSpawn`(triggers.js:155) 只在「玩家离开 + `spawn.stopOnExit`」时调用（`triggers.js:211`）。它做四件事：移除当前 timer、按 `triggerId` 过滤 `waveEvents`、清同 id 的 `spawnEffects`（并把其中 `frozen` 的敌人解冻，否则会永久冻在场上）、清同 id 的 `lockEffects`。自己加中止路径时必须复用它，别只 `remove` timer。另外已生成的敌人**不会**被回收。
- **异步事件的三重等待条件**：`checkAsyncTriggerEvents`(triggers.js:174-180) 必须同时满足「无未生成波次」「无本触发器的存活敌人」「无本触发器的 `lockEffects`」。如果波次用了 `waitForClear` 且场上有别的触发器召唤的敌人，本触发器的波次会一直等 → 异步事件（如 `removeGate`）永不触发，表现为「门打不开」。
- **试玩快照机制不能污染编辑器数据**：`redraw`(editor/level-flow.js:63) 只在 `state.mode==='editor'` 时落盘；游戏内 `switchLevel` 会直接改 `state.level`/`state.levelId`，退出必须走 `restoreEditorSnapshot`(160) 还原。新增「进入游戏态」入口时，务必先 `await saveDraft` 再存 `ctx.editorSnapshot`（照 `bindings.js:222` / `save-flow.js:76`），否则玩家会丢编辑内容。试玩存档写 `data/test-players/`，与正式档隔离（`state.saveStore`）。
- **生成点必须过可达性校验**：`canSpawnAt`(spawning.js:107) 检查「世界边界内（留敌人半径）+ 不在墙内 + 与玩家连线 `hasLOS` 通畅 + 可选最小玩家距离」。绕过它直接 push 敌人 → 敌人卡墙或玩家打不到。注意 `canSpawnAt` 用的是视线判定，**不是**寻路判定；真要保证能走到得用 `isReachableWalkable`(67)（`findPath` A*）或 `nearestReachablePoint`(85) 兜底。`this.grid` 在 `restart` 里由 `buildGrid` 生成，编辑器改墙后未 `restart` 时 grid 是旧的。**`canSpawnAt` 现追加了「整圆穿墙排除」**（圆心+半径上 8 采样点任一 `pointInWall` 即 false，spawning.js:154），小敌人(r≈15-24)影响可忽略；母舰因其**风筝形 Hitbox**（`geometry.js:mothershipBoundsR`，包围半径≈180×artScale≈360）显著变严，故走 `spawning.js:spawnMothership` 专用生成（整圆不穿墙+三档兜底，防卡墙/波次空转），经既有波次 `mode:'offscreen'` 触发。
- **门参与碰撞但编辑器态不参与**：`activeGateWalls`(triggers.js:87) 在 `this.editing` 时返回 `[]`，且门**不进寻路网格**（`buildGrid` 只吃 `walls` + `crates` + `barrels`）。所以门关闭时敌人寻路仍会尝试穿门位置，只是被移动碰撞挡住。自动模式下运行时新建的门（未落盘）会进 `this.gates`，随 `restart` 重建而清空；要长期保留需在编辑器面板用「自动生成」落盘。
- **`gateIds` 空数组的隐式兜底**：`setGatesActive`(66) 找不到目标时会自动取**距离最近的一扇门**。配置漏填 id 不会报错，只会随机开错门——排查「门乱开」先看事件里的 `gateIds`。**`auto:true` 会覆盖 gateIds**（直接按触发器所在箱庭通道计算），故自动模式与手动多选二选一；自动模式要求触发器**位于某个箱庭房间内**，落在通道/走廊上会算出空集（编辑器面板会提示「触发器不在任何箱庭房间内」并自动取消勾选）。
- **`isGateOnPassage` 原容差会把相邻箱庭的门误配到本通道**（真实踩过：`Level1-Scene2` trigger-2-1-2）。现象：勾选「自动（触发器所在箱庭通道的门）」后，多选列表里出现**另一个箱庭房间**的能量门。根因：`isGateOnPassage`（`rooms.js`）的 `across`（门沿通道法线方向的容差）原先取 `max(160, roadLen+40, w/2+60)`，而 `roadLen`（本关 960，默认 560）恰好等于「本房间房间开口」的间距，于是相邻房间墙上的门（距本开口恰约 roadLen）被当成「就在本通道上」而复用。正确做法：`across` 只按门自身进深 `h` + 墙厚容差计算（`max(120, min(200, h+80))`），让门只能坐到**本房间自己的开口**上，自动模式从而只复用本房间开口的门、不蹭相邻箱庭的门。全量扫描所有含 `auto` 门的关卡：仅 `trigger-2-1-2` 受影响，其余自动门关卡行为不变；`Level1-Scene1` trigger-1-1 走显式 `gateIds`（无 auto），不受影响。
- **盾门（`shieldOnly`）与普通门行为差异**：`activeGateWalls`（玩家/敌人移动碰撞）只含 `active && visible!==false`；`bulletGateWalls`（triggers.js:129，仅子弹/激光碰撞用）含 `shieldOnly || active`。故盾门未激活时玩家可穿、子弹被拦。排查「子弹被莫名挡住 / 门没拦住玩家」先看门的 `shieldOnly` 与 `active`。敌弹碰撞仍走 `activeGateWalls`（盾门未激活态不拦敌弹）；激光 `spawnLaser`（weapons.js:88）现拦截子弹门（含盾门与所有激活门），`pierce` 改件可穿透。
- **未知房间揭示是「一次性」且只隐藏视觉**：`roomRevealAlpha`（level-flow.js）只影响渲染 alpha，不影响碰撞/交互/生成点可达性——内容物在隐藏期间仍物理存在、仍参与碰撞（玩家可能撞到房内隐形木箱）。敌人 AI 的 `isInView` 不看揭示状态，隐藏房内敌人仍可能被激活推进；若需「激活等揭示」要在 `enemy-ai.js` 加 `roomRevealAlpha` 判定。新增房间类型字段务必同步 `rooms.js` 的 `normalizeRoomLayout`/`generateRoomLayout`、`room-panel.js` 的 `applyRoomType`、`bindings.js` / `index.html` / `ui.js` 的 `roomCellType`（否则编辑器配不了/写不回去）。
- **房间墙重生成只认 `room:true`**：`applyRooms`(room-panel.js:23) 用 `l.walls.filter(w => !w.room)` 保留手工墙。手工加的墙千万别带 `room:true`，否则下次改房间面板会被删。
- **`spawnInScreen` 依赖 `ctx.state.level.spawnZones`**：`zoneId` 找不到对应 zone 时静默回落到触发器自身矩形（`spawning.js:362`）。删 spawnZone 后波次里的 `zoneId` 不会自动清，表现为刷怪范围突然变小。
- **触发器矩形贴着刚关闭的门 → `inscreen` 第一波生成 0 只**（真实踩过：`Level1-Scene2` trigger-1788792207315）。现象：配了 2 波（`inscreen` + `zoneId` + `waitForClear:true`），但第一波一只怪都不出，第二波却正常。根因：该触发器同时带 `spawnGate(auto)` 且位于多箱庭房间入口，事件列表里 `spawnGate` 排在 `spawnEnemy` 前，进场即激活房间通道的门；玩家进触发器瞬间站在矩形左缘（≈门厚度包络内，门 `h*1.42` 如左门旋转后 x∈[2298,2362]），且波次 `preDelay:0` 的 `time.delayedCall(0)` **同帧**触发 → `spawnInScreen` 此刻 `canSpawnAt → hasLOS`（`enemy-ai.js:399` 含 `activeGateWalls()`）从生成区任意点到玩家的连线都命中那扇门（玩家贴门时门在射线 t<1 处被命中）→ 两轮取点全失败 → `spawnInScreen` 直接 `continue` 丢弃（无 `findClearSpawnNearPlayer` 兜底）→ 0 个 lockEffect。第二波因 `postDelay` 后玩家已被 `resolveMovementCollision`（`enemy-ai.js:360` 含门）推出门体积、LOS 恢复才正常。**关键**：只有「同帧」且玩家正好卡在门体积内才会触发（实测玩家 x<2362 时 0/10，x>2362 后 10/10，边界极脆）。**正确做法**：①代码层已修——`hasLOS` 现在会跳过「包含任一端点」的门（门贴玩家时不算隔断视线，`enemy-ai.js:399`）；②数据层给此类「入口触发器 + inscreen 首波」补 `preDelay`（≥100ms，让玩家被推出门）或把触发器矩形左缘右移到明显越过门厚度，且勿把触发器矩形左缘压在门体积内。
- **交互半径会被实体尺寸抬高**：`max(interactRadius, halfDiag + p.r + 40)`。把神像/图标做得很大时，`interactRadius` 配再小也没用。
- **菜单关与家园关的特殊分支**：`isMenuLevel()`（`ui==='login'`）跳过开场演出、相机固定 `(0,0)`；`isHubLevel()`（`levelId==='knight-home'`）禁用开火与护盾（`game-scene.js:225/228`）。新增此类关卡要同步这两个判定（`src/systems/ui/ui-runtime.js:165/186/191`）。
- **大地图 + `camera.mode:'center'` + 空场 + `showGridInPlay:false` ⇒ 玩家报「上下不能移动」（真实踩过：`Boss2-Test`）**。现象：某一关「按上/下键角色完全不动，按左/右却正常」，触发某个事件（如 BOSS 战）后又「正常」了，极像输入或碰撞 bug。**根因不是移动逻辑**：`center` 相机每帧把玩家钉在屏幕正中（`editor-camera.js:107-108`），玩家移动时**只有世界元素在屏幕上滑动**才能被看出；若场地里没有参照物（背景纯黑、网格关闭、上/下墙离出生点 ~1000px 在视口外），而画面内唯一的墙恰好是**比视口还高的竖直长条**（`h:2030` vs 视口 1080），那么纵向滑动该长条**看起来毫无变化**、横向滑动却非常明显 → 玩家以为自己只能左右走。事件触发后一个明显物体（BOSS）进入画面 → 纵向移动变得可见 → 「恢复正常」。**判据**：症状与「哪个关卡 / 玩家站在地图哪个位置」强相关，而不是与按键/时间相关，就先怀疑视野参照物。**正确做法**：①给关卡开 `showGridInPlay: true`（网格 30px、`gridColor` 深色，随相机滚动，是最省事的全屏参照）②或把地图缩到接近视口（真实战斗关多为 `1920×1080`，相机被边界钳住时角色本体会在屏幕上直接移动）③或在场地内放可见参照物（`Level1-Scene1` 就是 63 面墙 + 3 张图）。**别去改移动代码**——那段逻辑（`game-scene.js:214-238`）是左右对称的。
- **局内态字段必须挂 scene，不能挂 `state.player`**：`state.player` 就是存档源（`progression.js:persistSave` → `ctx.onPlayerSave`），直接加字段会被写进存档文件。售货机的局内消耗品/限时武器/当前实体改为挂 `scene.runItems` / `scene.runTimedWeapons` / `scene.vendorActive`，随 `restart` 清零（旧 `vendorBought` 已删）。新增任何「仅本局有效」字段都照此，绝不要挂 `state.player`。详见 ui-interaction skill 坑 22。
- **`vendor` 实体是每次 `restart` 由 `(l.vendors||[]).map(v => ({...v}))` 重新生成的副本**（`level-flow.js:144`），所以 `stock`/`bought`/`slot` 天然按局清零；但**不要**把状态写到 `ctx.state.level.vendors` 的原始实体上（编辑器会看到脏数据，且会被 `saveDraft` 落盘污染关卡文件）。同理 `chests`/`portals`/`idols`/`icons`/`gates` 等运行时副本也都别写回 `ctx.state.level`。售货机页面/摇奖交互详见 ui-interaction skill（坑 20-23）与 economy-numbers skill。
- **局内态一律挂场景对象、不挂 `state.player`**：`state.player` 就是存档源（`progression.js:persistSave` → `ctx.onPlayerSave`），往里写会导致药水 / 限时武器 / 限时加成被写进存档文件。挂场景的字段（清单见 §3.10）随 `restart` 重建自然清零。（与既有的售货机 `runItems`/`vendorActive` 同源，详见 ui-interaction skill 坑 22。）
- **`restart` 是局内态唯一的清零点**：新增任何「仅当局」字段都必须在 `level-flow.js:restart`（:147 附近）补一行，否则上一关的残留会带到下一关；其中 `potionWheelText` 这类**独立 Phaser 对象**除了置 `null`/复位，还要额外 `setVisible(false)`（:298），否则轮盘名称文本会跨关残留。
- **售货机实体是每关 `(l.vendors||[]).map(v => ({...v}))` 的浅拷贝**：`vendor.stock`/`vendor.bought`/`vendor.slot` 写在这些副本上安全，但**绝不能写回 `ctx.state.level.vendors`**（会被 `saveDraft` 落盘污染关卡文件）。
- **新增的 4/5 键与 F 键不同层**：F 是「靠近才有」的交互（`updateVendorInteract` 等），4/5 是**战斗内随时可用**；实现落在 `ui/battle-items.js:updateBattleItemsInput`，**别塞进** `updateVendorInteract` 之类的靠近判定里，否则离得远就按不出来。
- **`updateRunItems`/`updateBattleItemsInput` 的调度位置**在 `game-scene.js:update()` 的 `this.updateVendorSlot()` 之后（保证售货机页当帧购买的药水当帧进队列），且在战斗处理之后 → 本帧到期的限时加成晚一帧回退，可忽略。
- **药水只支持「关卡级掉落规则」与「宝箱奖励」两个面板**：敌人个体 `e.drops` 没有药水字段（`{gold,exp,diamond}`），不要以为配了 `e.drops` 就能掉药水；两个面板的药水下拉选项来自运行时的 `/api/inner-shop`，见 engine-editor skill。
- **`deathCinematic` 必须在 `normalizeLevel` 里显式回传，否则静默丢弃**（同 `cutsceneId` 坑）：`state.js:626`（`deathCinematic: deathId`）是唯一回传点，`DEFAULT_LEVEL`（`:485`）的默认值只是骨架。**注意现已改为「默认注入」** —— `normalizeLevel` 会把空串/缺字段回落成 `DEFAULT_DEATH_CINEMATIC.id`，即所有关卡默认都有玩家被击败运镜、且**无法用空串关闭**（要关需显式开关字段）。编辑器勾选 `#cinematicDeathFlag` 后保存，若 `normalizeLevel` 漏回传，重开即丢且**全链路无报错**。
- **死亡运镜会被后播放的运镜顶掉且不回调旧 `onComplete`**：`playCutscene` 覆盖正在播放的运镜时只 `cinematicTimer.remove()`、旧 `onComplete` 永不触发 → 母舰贴身秒杀 → BOSS 击破运镜顶掉死亡运镜 → `playerDeathFlow` 卡死、结算页永不出现。修法见 §4⑨ 与 engine-editor 坑 49-50（`enemy-ai.js:defeatEnemy` 加 `if (!this.playerDeathFlow)` 抑制；输入锁不只依赖 `cinematicInputLocked()`）。`playCinematic` 触发器事件同理会顶掉死亡运镜，故死亡演出期间 `game-scene.update` 会 gate 掉 `checkAsyncTriggerEvents()`。

## 8. 验证方式

- 构建：`npx vite build`（Vite 6 + Phaser 4，纯 ESM，只做打包不跑测试）；基线 **90 modules**（接线前 86；+4 = 两个新运行时模块 + 因接线才进依赖图的 `run-items.js`/`battle-items-art.js`）。装配 mixin 由 23 → **25**（`RunItemsMixin`、`BattleItemsMixin` 紧随 `InnerShopMixin`）。
- 单测：`node --test test/`。基线 **20 tests / 19 pass / 1 fail**；唯一 fail 为 `test/player-api.test.js` 旧 schema `mods` 字段被 `normalizePlayer` 丢弃（属既有的 schema 迁移不一致，非本改动引入）。测试只覆盖玩家存档，**关卡 schema 无自动化测试**，改 `normalize*` 必须手动回归。mixin 同名自检基线：**方法数 285 / 冲突 2**（均为 `if`/`for` 关键字相关的假阳性）。
- 起服：`node server.js`（默认端口 5173，可 `PORT=5174 node server.js`）。关卡读写走 `GET/POST /api/levels/:id`，直接落 `data/levels/*.json`。
- 手动复现路径：

| 要验的东西 | 用哪个关卡 | 怎么看 |
| --- | --- | --- |
| 触发器多事件 + 三种波次 mode + 门开合 + 异步 `removeGate` | `Level1-Scene1.json` | 进关走到第一个触发器，门应封路 → 清完两波 → HUD 转 secure、门开、宝箱出现 |
| 多箱庭房间生成 / 世界尺寸自适应 | `Level1-Scene1.json`（6×4，7140×3780） | 房间面板改行列或单格尺寸，看墙体与世界尺寸重算、出生点是否被移入房间 |
| 交互物（宝箱自动开、传送门撤离、神像三选一） | `Level1-Scene1.json`（5 宝箱 / 2 传送门 / 1 神像） | 走近宝箱应自动开箱掉落；传送门按 F 直接通关结算 |
| 图标交互与家园分支 | `knight-home.json`（3 icons） | 按 F 分别进战斗选择 / 武器商店 / 工坊；确认禁止开火 |
| 菜单关形态与 wormhole 背景 | `login.json` | 相机固定全图、无开场演出 |
| 开场演出（黑幕渐显，战斗关 3.5s） | 任意 `ui:'battle'` 且非 hub 的关卡 | 进关前 3.5s（黑幕渐显、无镜头拉近）不可操作 |
| 切关淡入淡出 + `spawnPoint` 覆写 | 任一带 `switchLevel` 事件的关卡 | 黑屏 0.5s → 新关卡出生点应等于事件里的 `spawnPoint` |
| 试玩快照不污染 | 任意关卡 | 编辑器改动 → 试玩并游戏内切关 → ESC 退出 → 关卡 id 与内容应回到试玩前 |
| 售货机局内商店（放置 → 试玩按 F） | 任意战斗关 + 编辑器放一台 `vendors` | 试玩走近按 F 打开商店页；买 1 件看翻面/扣钱/限购；退出试玩确认编辑器实体数据未变（`stock`/`bought`/`slot` 只写运行期副本） |
| 局内药水（掉落→拾取→数字键 4 使用/轮盘） | 任意配了 `dropRules[类型].item='potion'` 或宝箱 `rewards` 含 `potion` 的关卡 | 击杀掉药水 / 开箱拾取 → 队列 +1；短按 4 用首瓶、长按 4 呼轮盘选瓶；重开关卡应清零 |
| 局内限时武器（数字键 5） | 售货机买限时武器后 | 按 5 启用（滚轮被禁，见 engine-editor 坑）→ 再按 5 取消；重开关卡清零 |
| 死亡运镜（玩家被击败） | 配了顶层 `deathCinematic` 的关卡（如 `level-1.json` / `Level1-Scene1.json`） | 被打死 → 播死亡运镜（`focus:'player'`）→ 黑幕保持 `blackHoldMs` → 结算页出现；黑幕期间按 F/4/5/ESC **不应**打开菜单页（§4⑨） |
