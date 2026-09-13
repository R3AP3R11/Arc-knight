---
name: engine-editor
description: 改关卡编辑器交互（拖拽/画墙/手柄）、实体属性面板、撤销剪贴板、编辑器与试玩相机、运镜（过场动画）编辑器与播放器、server.js 存读盘 API、UI 配置页、画板/美术资产/独立画板轮廓绘制/轮廓库、导表（策划表格 xlsx → JSON）、打包前导表、Electron 打包时读这份。触发词：消耗品表 / 导表效果列 / 局内表现美术 / potionId / 武器本体美术 / 环链 / 内圈环链 / 出场动画 / 武器出场 / 运镜 / 过场运镜 / 死亡运镜 / 玩家被击败 / 运镜预览。
---
# 引擎(编辑器)需求 开发指南

## 1. 这块负责什么
本分类覆盖「编辑器」侧的全部代码：编辑器鼠标/键盘交互、相机与视图、DOM 面板层、后端读写 API、Electron 打包端。
### 双模架构（先读懂这个，否则改哪都容易踩雷）
同一个 Phaser 场景类 `EditorScene`（`src/game-scene.js:36`）既跑编辑器也跑游戏，用两个开关区分：

| 开关 | 定义处 | 语义 |
|---|---|---|
| `this.editing` | `src/game-scene.js:37` `this.editing = ctx.state.mode === 'editor'` | **场景构造时一次性快照**，构造后不再变；`true` = 编辑器，`false` = 跑游戏 |
| `ctx.state.mode` | `src/state.js:490` 初值 `'editor'` | 运行期真实模式，切换必须走 `setMode()`（会 destroy 并重建 Phaser.Game） |
`state.mode` 实测取值只有 **3 个**（全部 setMode 调用点已核实）：

| mode | 含义 | 谁设置 |
|---|---|---|
| `editor` | 关卡编辑 | `bindings.js:221`（编辑器模式按钮）、`bindings.js:262`（新建关卡）、`level-flow.js:93`（退出预览）、`level-flow.js:183`（selectLevel 末尾） |
| `play` | 「游戏预览」，用 `state.previewPlayer` 临时玩家数据，不读写存档 | `bindings.js:225`（游戏预览按钮） |
| `trial` | 「流程试玩」/ 打包端实机流程，走 `state.player`，存档读写由 `state.saveStore`（`formal`/`test`）决定 | `save-flow.js:47/67/96`、`packaged.js:34` |
> 注意别混淆：`level-flow.js:141/146`、`entity-properties.js:66/68`、`bindings.js:316/332` 里的 `mode !== 'editor'` 是「非编辑器」判定，不是第 4 个 mode。`trigger-panel.js` 与 `rooms.js` 里的 `mode` 是波次生成模式 / 房间布局模式，完全无关。
> 场景侧判定辅助：`ui-runtime.js:167 isPreviewMode()`（`!editing && mode==='play'`）、`ui-runtime.js:173 isTrialMode()`（`!editing && mode==='trial'`）。
因为 `this.editing` 是构造快照，**切模式必须重建游戏实例**：`level-flow.js:137 setMode()` 里 `state.game.destroy(true)` → `startGame()`。想「不重建就切模式」是错的。
### 两层分工
- **场景层**（`src/systems/editor/**`，mixin 装到 `EditorScene.prototype`）：画布内的一切——命中判定、拖拽、缩放、旋转、相机、滚轮。写在 mixin 里，`this` 恒为场景实例。
- **DOM 面板层**（`src/editor/**`，14 文件，含画板/武器/宠物工作台）：侧边栏面板、按钮、关卡增删改、撤销剪贴板、存档面板、打包端启动、**画板工作台（artboard）**、**武器 · 弹道编辑器（weapon-board）**、**宠物编辑器（pet-board）**。共享状态走 `src/editor/context.js` 的 `ctx` 单例。
- **美术渲染核心 + 武器/宠物系统**（`src/systems/art/**`，14 文件）：画板「设计稿 JSON」→ 矢量渲染（`asset-render.js`）+ 武器设计稿/统一弹道解释器/运行时武器目录（`weapon-registry.js`）/运行时注册 + 宠物设计稿/存取/内置（`pet-design.js`/`pet-store.js`/`default-pets.js`）。详见 §2 备注与 §4.9/§4.10。
- **后端**（`server.js`）：关卡/UI/存档/设计稿 JSON 落盘 + 静态服务（开发用 vite 中间件，打包用 staticDir）。
关卡数据结构（`normalizeLevel` / 房间布局 / 触发器事件语义）详见 **level-design skill**；UI 节点渲染与 `renderGraph` 详见 **ui-interaction skill**；战斗/掉落/存档数值详见 **gameplay-systems skill**。

## 2. 文件地图
### 场景侧（画布内交互，mixin 装到 EditorScene.prototype）

| 文件 | 职责 | 关键导出 | 行数 |
|---|---|---|---|
| `src/systems/editor/editor-input.js` | 编辑器鼠标/键盘：命中、拖拽、画墙、放实体、擦除、方向键微调；非编辑态下额外拦截选关页2背景拖动（`menuScreen==='levelSelect'&&levelSelectPage===2` 时 `pointerDown` 不命中按钮则记 `levelSelectDrag`，`pointerMove` 更新 `smallLevelPan`，`pointerup` 清空） | `EditorInputMixin`（`pointerDown` / `pointerMove` / `updateEditorKeys`） | 259 |
| `src/systems/editor/editor-camera.js` | 世界与视口尺寸、缩放适配、滚轮、编辑器钳制、试玩跟随；**运镜**：`playCutsceneById`/`playCutscene` 按关键帧插值（`_stepCutscene`/`_cutsceneStateAt`/`_applyCutsceneState`/`_resolveFocusTarget`/`_easeValue`，`this.time.addEvent` 每 16ms 自驱动）、全屏黑蒙层 alpha 淡入淡出（`cinematicFade`）、**动态焦点**（`_resolveFocusTarget` 优先序 `opts.x/y` > `opts.focusTarget` > `clip.focus`；`'player'` 取 `this.player` 坐标、`'boss'` 取 `this.bossTarget`/激活母舰；动态目标存 `this.cinematicFocusTarget` **每帧重解析（跟随）**、显式坐标存 `this.cinematicFocus`（固定，向后兼容 BOSS 击破），`_applyCutsceneState` 按 `focus.x - cam.width/2` 换算）、**慢动作**（`cinematicTimeScale` 改为**每帧由关键帧 `timeScale` 插值写入**，`game-scene.update` 里 `dt *= slowmo`）、**叠层**（`_ensureCinematicOverlays`/`_createCinematicVignette`/`_applyCinematicOverlays`/`_hideCinematicOverlays`/`hideCinematicFade`/`cinematicInputLocked`/`_hexToInt`：黑幕 `cinematicFade`、上下黑边 `cinematicLetterbox`、暗角 `cinematicVignette`、色调 `cinematicTint`、闪光 `cinematicFlash`、去饱和 `cinematicDesat`，**全部挂屏幕空间相机 `uiCam`（创建时 `cameras.main.ignore(obj)`，绝不能 `uiCam.ignore`）**）、`stopCutscene(opts)` 支持 `opts.holdBlack`（保留黑幕 α=1、不调 `setupPlayCamera`，仍 `setRotation(0)`+`onComplete`）；运镜期间 `updatePlayCamera` 首行 `if (this.cinematicActive) return` 让权；`onWheel` 在 `this.switchWeapon` 前有 `if (this.isTempWeaponActive?.()) return` 守卫（临时武器使用中禁滚轮切主武器） | `EditorCameraMixin`（26 方法） | 635 |
| `src/systems/editor/editor-geometry.js` | 纯函数：手柄命中、矩形/背景缩放、实体拾取、闸门绘制 | `resizeRect` `rotationHandleAt` `handleAtRect` `hitBackground` `backgroundHandleAt` `resizeBackground` `pickTopEntity` `drawGates` `BG_HANDLE_SIZE` `MIN_BG_SIZE` | 280 |
| `src/systems/ui/world-render.js` | `draw()` 主绘制 + 选中框/手柄绘制（`:377` `:382` `:442` `:446`）+ 精灵同步 + 画板设计稿按需加载 + `drawPlayer` 之前调 `drawBoss25T5Vortices`（`:582`）与 `drawBoss25T5Zones`（`:585`） | `WorldRenderMixin` `requestArtDesigns` | 735 |
| `src/systems/ui/boss25t5-art.js` | BOSS「原型机-2-5T5」渲染（子任务 C）：本体（圆弧4/5 各自自转 / 护盾渐显渐隐 / 受击闪白 / 技能3 紫弧合并、中心取两弧中点）+ 技能区域 `e.zones`（延长线/**三种技能统一多条同心弧 + `MAX_RINGS` 上限**/紫重叠/黑遮罩；`drawZone` 按 `visMin/visMax` 径向裁剪实现方向性消散）+ 技能4 灰弧 + **技能5 蓝色漩涡 `drawBoss25T5Vortices`**（6 槽位蓝色同心弧「旋转+向心收缩+末段渐隐+原位重生」/ 中心白色刻度星环 / 上方细血条 / 模块内 250ms 击杀淡出环） | `drawBoss25T5Body` `drawBoss25T5Zones` `drawBoss25T5Vortices` | 517 |
| `src/systems/ui/world-overlay.js` | 交互提示/Tip 覆盖层，多处 `if (this.editing) return` | `WorldOverlayMixin` | 331 |
| `src/game-scene.js` | 场景类 + mixin 装配（`Object.assign` 共 **25** 个，:902）+ `create()` 输入接线 + `update()`（构造函数注入 `this.playerDamage`，`:58` 初始化场景级 `boss25t5Vortices`；子弹 filter 顺序见 `combat` skill §6.2）；`addKeys` 新增 `NUMPAD4/NUMPAD5/DIGIT4/DIGIT5`（Phaser 4 实测 `NUMPAD_FOUR=100`/`NUMPAD_FIVE=101`/`FOUR=52`/`FIVE=53`，小键盘与主键盘都响应），`update()` 在 `updateVendorSlot()` 后接 `updateRunItems(dt)`/`updateBattleItemsInput(dt)` | `createGameScene(ctx)` | 922 |
### DOM 侧 + 后端

| 文件 | 职责 | 关键导出 | 行数 |
|---|---|---|---|
| `src/main.js` | 入口：模块顶层 `registerBuiltinWeapons()`（先于一切 `normalizePlayer()`）、初始玩家状态、7 钩子注册、`initialize()` | （无，副作用模块） | 93 |
| `src/editor/context.js` | 共享 `ctx` 单例 + `ctx.hooks` 钩子表 | `ctx` | 39 |
| `src/editor/bindings.js` | `bind()` 全量 DOM 接线 + 快捷键 + beforeunload 兜底保存 + 画板/武器/宠物/运镜接线（含 `dom.cinematic`→`showCinematicsBoard`+`initCinematicsBoard`）；Ctrl+Z/C/V 早退加入 `cinematics-mode` | `bind` `showUIConfig` | 384 |
| `src/editor/history.js` | 撤销栈（上限 60）、实体归类、剪贴板 | `pushUndo` `undo` `copySelected` `pasteClipboard` `entityKind` | 86 |
| `src/editor/entity-properties.js` | 实体属性面板（15 种实体分支）、宝箱奖励子编辑器、嵌套读写、敌人「画板美术方案」下拉、指引字段组条件显示（`guideRows`，勾「是否游戏内指引」才出距离/图标/交互后停止）；能量门分支含「只挡子弹」`shieldOnly` 布尔；**触发器事件类型下拉 `eventTypeOptions` 含 `playCinematic`（播放运镜）**；**敌人分支按 `type` 追加两套 BOSS 配置字段：母舰（`artScale`/召唤间隔/召唤表/顶层 `cutsceneId`）与 `boss-2-5t5`（`:150-237`：`artScale` + **81 个 `boss.*`，共 82 项**）——本轮删除 `boss.zoneAimTrackDeg`（旧「技能1/2-成型期瞄准跟随」，**已废弃**）与 `boss.s5PullAccel`，新增 `boss.s5PullMin`「技能5-最小吸力(px/s，半径边缘处)」/`boss.s5PullMax`「技能5-最大吸力(px/s，涡心处，需<玩家移速180)」；上一轮删除 `boss.zoneHitPadDeg`/`boss.s1BulletForce`/`boss.s2BulletForce`、新增 `boss.zoneHitPadPx`「技能1/2-命中像素容差(px)」（技能5 拖尾宽/长旧键 `…RedTrailWidth`/`…RedTrailLength` 形态已于上一轮改名为 `boss.s5BulletTrailWidth`/`boss.s5BulletTrailLength`）；**本轮宝箱奖励子编辑器新增药水下拉（`data-reward-k="potionId"`，模块级 flag 防重入 + `loadInnerShop().then(重渲)` + item 切换清空 `potionId`）** | `renderEntityProperties` `bindEntityFieldInputs` `getNested` `setNested` `updateWall` | 667 |
| `src/editor/level-flow.js` | 面板同步 `sync`、重绘落盘 `redraw`、启动 `startGame`、模式切换、快照恢复、关卡加载 | `sync` `redraw` `startGame` `setMode` `restoreEditorSnapshot` `selectLevel` `refreshLevels` `switchToLevel` `fadeAndSwitch` `rememberLevel` `recallLevel` `renderFlows` `LAST_LEVEL_KEY` | 222 |
| `src/editor/room-panel.js` | 多箱庭房间面板与墙体重生成（含房间大小/标记/类型弹窗：`roomCellSize`/`roomCellMarkerType`/`roomCellMarkerIcon`/`roomCellType`） | `applyRooms` `renderRoomPanel` `updateRoomNumber` `updateRoomPanelSize` `toggleRoomCell` `openRoomCellPopup` `closeRoomCellPopup` `applyRoomMarker` `applyRoomType` | 173 |
| `src/editor/trigger-panel.js` | 触发器事件列表编辑器（波次/切关/能量门多选） | `renderTriggerEvents` | 240 |
| `src/editor/drop-rules-panel.js` | 按敌人类型的掉落规则面板；`item==='potion'` 时在「数量」前插入药水下拉（`data-drop-field="potionId"`，选项来自 `getPotionList()`，空值显示「（随机药水）」），模块级 flag 防重入（首次渲染若 `getPotionList()` 空则 `loadInnerShop().then(renderDropRules)`），`input` 分支挡住 `potionId`（避免 select 的 input 事件当数字写坏）、赋值走 `change`，`item` 切换重渲染并清空 `potionId` | `renderDropRules` `bindDropRules` | 113 |
| `src/editor/player-panels.js` | 预览玩家 / 试玩存档两套属性表单（改件区按**库存数量**配置：通用无上限 / 专属每种最多 1） | `renderPreviewPlayer` `renderTrialPlayer` `bindPlayerPanels` | 172 |
| `src/editor/save-flow.js` | 存档源切换、新游戏、选存档、试玩启动 | `startTrial` `startNewGame` `selectSave` `listStoreSaves` `saveStorePlayer` `loadStorePlayer` `isTrialSaveStore` | 102 |
| `src/editor/packaged.js` | 打包端启动路径 + UI 预载 | `initializePackaged` `enterPackagedLogin` `loadPackagedUi` | 55 |
| `src/editor/artboard.js` | 画板工作台：Canvas 预览/交互（拖元素、手柄缩放）+ 元素属性 + 旋转方向 + 复制元素 + 改名 + 保存/载入 + 生成默认美术 + 轮廓库接线（下拉/一键添加）+ stroke 缩放/旋转手柄（`makeG` 已挪至 asset-render 共享）；**右侧预览视窗支持修改背景色 `design.bgColor`**；**圆弧新增「钟表表盘」显示形式**（`pattern`/`tickShortLen`/`tickLongLen`/`tickDensity`/`tickRatio`/`tickDir` 字段，见 §4.11）**与「长短针」显示形式**（`pattern:'hands'`，只画长短针不画圆环，`handLongRadius`/`handShortRadius`/`handLongColor`/`handShortColor` 字段）；**新增 `shape='pixel'` 元素类型**：字段表（cols/rows/cellSize/gridColor/rotSpeed/dir/phaseDeg/orbitRadius）+ 选中手柄（虚线圈 + rim 缩放 + 外延旋转）+ pixel-scale（**缩放 `cellSize` 而非格坐标，像素始终对齐网格**）/pixel-rotate（自由角度，不做 5° 吸附）+ `#artPixel` 入口接线 `openPixelBoard` | `showArtboard` `initArtboard` `getArtboardDesign` | 653 |
| `src/editor/draw-board.js` | **独立画板**（轮廓绘制弹层）全量逻辑：加点/选择/填充三工具 + 点编辑（选中/拖动/方向键1px/XY/Delete）+ **点到点连线（边驱动）**：add 点已有点=锚点，有选中锚点再点任一已有点→从锚点连边（**可点起点成环**）；blank 落点有选中→连锚到新点，非选中只放点；`drawEdges` 存边、绘制只按边画线、不从闭合回路续接到新点；写回/填充按**连通分量拆分**（`splitIntoComponents`，剑/箭头等分开图形各自独立）：新建态「完成」写**多个** stroke 元素（保存后分开）、填充/判定逐环（每环纯闭合 `hasClosedRing` 才上色/命中），编辑已有保持单元素；`closed` 由 `drawStyle.closed || hasClosedRing` 推断；点/线/边操作同前；`lastAdded` 记录最近加点下标，Ctrl+Z 精准退点 + **打开即带入当前 stroke 元素点集（所见即所改）** + 填充仿 Windows 画板（调色后点闭合回路内部上色）+ 网格吸附 + 参考图形（圆/弧/多边形转点=追加；**已注册轮廓转点=替换当前点集**）+ 整条变换（「应用变换」带反馈）+ 完成写回（带反馈）+ 保存轮廓（**同名覆盖**；`buildPolyline` 已硬化**不再退化为原始顺序**；保存**无损点+边拓扑**——点取遍历序、边重映射到该点序，读回按 `edges` 精确还原，保证「保存→导入→再保存」逐位一致；已居中则不再减重心避免浮点漂移）+ **删除已注册轮廓** + **框选/复制粘贴/整组移动**：select 模式空白按下拖拽=框选（虚线矩形实时选中矩形内点，`selectedSet` 多选、`selectedPointIndex` 为锚点）、Ctrl+C 复制选区点+点间边、Ctrl+V 偏移一格粘贴并重建边、方向键以 1px 移动整组、Delete 整组删 + Ctrl+Z/Esc/Enter | `openDrawBoard` `closeDrawBoard` `isDrawBoardOpen` | 797 |
| `src/editor/pixel-board.js` | **独立像素画板弹层**（与绘制轮廓并列）：网格背景/网格线色/像素规格(cols×rows/cellSize) + 调色→点击格/**长按拖动画刷**连涂 + 橡皮 + 框选多格 + Ctrl+C/V 复制粘贴 + **自由角度旋转选中块**(绕选区几何中心,四舍五入到格) + 方向键移块 + 滚轮缩放/中键平移 + 撤销/清空；写回 `boardDesign.elements`(选中已是 pixel 则替换,否则 push 新 `shape='pixel'` 元素)；**「保存为像素设计稿」`#pixelSaveLibrary` 落盘 `/api/pixels`(同名覆盖,回调 `hooks.onSaved`)**；**网格线开关 `showGrid` 决定写回 `gridColor`(关→`null`)** | `openPixelBoard` `closePixelBoard` `isPixelBoardOpen` | 578 |
| `src/systems/art/asset-render.js` | 画板矢量渲染核心：设计稿 JSON → 图形（多边形/圆弧/手绘轮廓 + 旋转/方向/轨道半径；**arc 支持 count 绕圆心等角排布多环且每副本以自身 ca 朝向**；**arc 支持 `pattern:'clock'` 钟表表盘花纹——沿弧长均布径向刻度，长/短针按 `tickRatio` 比例排布、朝向 `tickDir`（in/out/both）可配**；**arc 支持 `pattern:'hands'` 长短针花纹——只画长短针不画圆环，长/短针分别以 `handLongRadius`/`handShortRadius` 为轨道半径、颜色取 `handLongColor`/`handShortColor`**；stroke 支持 count 绕圆心等角排布多份 + orbit>0 重心挂轨道）。`normalizeOutline` 现**保留 `edges`（点序下标对，用于轮廓无损还原连通拓扑）**。`designBounds` 按当前姿态 `t` 算渲染包围盒（含描边与钟表外伸刻度），`renderAssetFit` 把包围盒「居中+等比缩放」到 boxSize（供图标等用，解决画板资产不居中/描边超框）；**`drawDesignCentered` 以设计原点 (cx,cy) 居中 + 按包围盒半径缩放（不用包围盒几何中心——旋转动画元素使 bcx/bcy 偏移，如 minigun 轨道环/非整圆弧致外观偏离中心，供商店/工坊/HUD 卡片叠加用）**；`designRadius` 已计入 `lineWidth/2` 与钟表外伸刻度；**新增 `shape='pixel'` 像素元素**：字段 `cols`/`rows`/`cellSize`/`gridColor`/`cells`(稀疏 `{x,y,color}` 格索引)，渲染以网格几何中心 `c` 为原点逐格填色 + 可选网格描边（`gridColor` 兼容 `#hex`/`rgba`，`colorInt` 忽略 alpha 取色），`count` 恒 1 | `normalizeDesign` `normalizeElement` `normalizeOutline` `renderAsset`（循环体已抽成导出 `renderElement`，逐元素调用，行为不变） `renderElement` `renderAssetFit` `drawDesignCentered` `designBounds` `elementCenter` `designRadius` `hexToInt` `intToHex` `colorInt` `makeG`（内部 `drawArcTicks`/`drawArcHands`） | 485 |
| `src/systems/art/weapon-ring-chain.js` | 武器「内圈环链 + 出场渐显」纯逻辑（**叶子模块，不 import Phaser**）：以最内侧元素（任意形状：三角形/多边形/弧都行）为样板向内递归复制副本（半径/厚度/径向位置 ×`ratio`）；仅相机 zoom ≥ `minZoom` 才生成环链，再按「屏幕绝对厚度 ≥ `minPx`」剔除（被剔除者不渲染、也不占出场时间片）；保留链环 + 原有元素按有效外径升序排出场顺序 + 逐元素渐显进度。**样板选择优先「描边型（`fill` 为空）」元素**（否则会选到被 `normalizeElement` 强改成 `lineWidth:4` 的黑色实心块，见 §7 坑 54）；**厚度判据用固定参考缩放 `chainRefScale(refZoom)`，不用当帧 zoom**（可见集合稳定，越过 `minZoom` 时整体一次出现，见 §7 坑 56） | `weaponElementExtent` `elementThickness` `innermostElement` `ringChainActive` `chainRefScale` `buildRingChain` `buildWeaponRevealList` `revealAlphaAt` | 157 |
| `src/systems/art/weapon-body.js` | 武器本体渲染入口（设计稿矢量 + 内圈环链 + 出场渐显）：按 `buildWeaponRevealList` 顺序逐元素 `renderElement`，**两趟绘制（原有元素先、链环后）**——链环外径最小、若按外径升序直画会被更晚绘制的不透明填充体整块盖住；出场计时仍按 `item.index`（外径升序，链环在最前），只改 z 序；`elapsedMs` 非有限=已完全出场（alpha 全 1） | `renderWeaponBody` | 46 |
| `src/systems/art/design-store.js` | 画板设计稿运行时存取：按 id 懒加载缓存 + 下拉选项 | `getDesign` `ensureDesign` `ensureDesigns` `registerDesign` `getArtChoices` `refreshArtChoices` | 44 |
| `src/systems/art/default-art.js` | 默认美术 → 画板设计稿转换器（含 yellow/green 武器环；**`buildPlayerDesign` 的 hex-ring 分支本轮不再生成中心白色六边形，yellow/green 保留**） | `buildPlayerDesign` `buildEnemyDesign` `buildAllDefaultArt` | 105 |
| `src/editor/weapon-board.js` | 武器 · 弹道编辑器工作台：独立页（纯 Canvas2D+DOM 表单），编辑武器外形/发射媒介/子弹外形（画板矢量）+ 矢量场/激光束轨迹 + 4 类拖尾 + 弹道/进入游戏参数 + 开火预览 + 保存/载入/模板；**武器下拉同时列出已落盘武器与内置 yellow/green（`buildBuiltinWeaponDesigns`），载入经 `ensureWeaponDef` 兜底；画板矢量圆弧支持数量（`count`）与钟表表盘/长短针（`pattern`+`tickDir`/`tickRatio`/`handLongRadius`/`handShortRadius` 等，经 `miniSelect` 渲染 select、`bindShapeInput` 特判 pattern 重渲）；删除按钮走 `click` 绑 `data-del`；子弹弹道提供 `randomPalette` 调色盘 chip 合集 + `speed` 飞行速度 + `fadeDuration` 消失时长[ms] 字段** | `showWeaponBoard` `initWeaponBoard` `getWeaponDesign` | 606 |
| `src/editor/cinematics-board.js` | **运镜（过场动画）编辑器工作台**：独立页（`body.cinematics-mode`），编辑 `state.level.cinematics`（`CinematicDef` 数组，**契约见 level-design skill §3.12**：`{id,name,durationMs,timeScale,focus,blackHoldMs,keyframes:[{t,zoom,panX,panY,rotation,alpha,ease,timeScale,vignette,letterbox,tint,tintColor,flash,flashColor,desat}]}`）。**时间轴编辑**（总时长 `#cinematicDuration` + 慢动作 `#cinematicTimeScale`[0.05~1] + 关键帧列表 `#cinematicKeyframes` 增删改 + 新增/删除/选中运镜 `#cinematicSelect`）+ **焦点/黑幕/死亡标记**（`#cinematicFocus`(none/player/boss) + `#cinematicBlackHold`(0~3000) + `#cinematicDeathFlag`：勾选写 `state.level.deathCinematic`，**3 个新 DOM id 全部已同步 `src/ui.js` 的 `ids`**）+ **预览视窗**（`#cinematicPreviewCanvas`，**800×450 = 16:9，与运行时视口一致**；`worldToScreen`/`camParams` 1:1 复刻运行时相机数学）——**pan 语义与运行时统一为「视口左上角世界坐标」**：`camParams` 里 `camCenterWorld = { panX + camW/2, panY + camH/2 }`（`camW = level.camera.width`、`camH = camW * VIEW_H/VIEW_W`），`worldToScreen`/`screenToWorld`/`drawAnchorHint`/`applyCenterMigration`/`effectiveEv`(focus 覆盖 pan)/`drawOverlays`/`drawFocusMarker`/`drawPreviewHud` 一并消费 + **参照物放置**（`#cinematicRefs`/`#cinematicAddRef`，编辑器本地占位，`normalizeCinematic` 剥离未知字段故不落盘）+ **运镜锚定中心工具**（`#cinematicSetAnchor`：拾取世界坐标作锚点，`applyCenterMigration` 把选中帧镜头中心对准锚点并整体平移其余关键帧 `panX/panY`；`pickAnchor` 与「添加参照物」点击互斥）；`EASES` 与运行时 `_easeValue` 逐字等价（**12 种**：linear/sineIn/sineOut/sineInOut/quadIn/quadOut/quadInOut/cubicIn/cubicOut/cubicInOut/easeOut/easeInOut；`easeOut`/`easeInOut` = **Sine** 不是二次；`easeIn` 仅兼容旧数据、不进下拉）；关键帧行新增 8 个 `data-kf` 输入（timeScale/vignette/letterbox/tint/tintColor/flash/flashColor/desat）；`deleteCurrent` 删的正是被击败运镜 → 清 `state.level.deathCinematic`（防悬挂引用）；保存走 `saveDraft`；`cinematicPlay`/`cinematicStop` 回放预览 | `showCinematicsBoard` `initCinematicsBoard` | 793 |
| `src/systems/art/weapon-design.js` | 武器设计稿数据模型：归一化 + 默认（外形/媒介/子弹三组画板矢量 + 矢量场/光束轨迹 + 弹道/进入游戏参数；**arc 同 polygon 支持 count，且支持钟表表盘 `pattern`/`tickShortLen`/`tickLongLen`/`tickDensity`/`tickRatio`/`tickDir` 与长短针 `handLongRadius`/`handShortRadius`/`handLongColor`/`handShortColor`（与 asset-render 对齐）**；子弹支持 `randomPalette` 随机颜色合集[规范化为 `#rrggbb`]、`speed` 飞行速度[缺省回退旧 vector.speed]、`fadeDuration` 消失时长[ms]） | `normalizeWeaponDesign` `defaultWeaponDesign` `normalizeVectorField` `WEAPON_TRAIL_TYPES` | 262 |
| `src/systems/art/weapon-runtime.js` | 统一弹道解释器：武器设计稿 → 兼容 `WEAPONS` 表的运行时条目（fire/stepBullet/drawBullet，矢量场+激光束介型，4 类拖尾，改件上限；**随机颜色从 `randomPalette` 合集取，空则回退随机色相；弹速走 `bullet.speed`；超距淡出：`bullet.fadeDuration>0` 时抵其最远距离即停住、在时长内原地渐隐（不拉长射程），并以最后航向 `dirX/dirY` 维持拖尾方向共同渐隐，否则按距离淡出；撞墙渐隐：`bullet.wallFade` 置位后同样停驻原地、在 `fadeDuration` 内渐隐**；技能5 漩涡吸回 / 技能1·2 区域施力的已转化子弹 `b.forceTrail` 走内部 `drawForceTrailBullet`：白色弹体 + 沿航向反向的**可配彩色**拖尾（颜色由 `forceTrail.color` 决定：技能1 蓝 / 技能2 红 / 技能5 蓝），长度只取配置值不看 `b.dist`，且**优先于普通拖尾**） | `buildWeaponRuntimeEntry` `muzzlePosition` | 361 |
| `src/systems/art/weapon-store.js` | 武器运行时存取：按 id 缓记载入 + 把运行时条目并入战斗 `WEAPONS` 表 + 武器目录登记 + 改件上限 + `registerBuiltinWeapons` 启动注册内置设计稿武器；`loadWeaponDefs` 逐个 `loadWeapon` 拉盘**强制覆盖内置缓存**（否则同名磁盘副本被内置值遮蔽） | `registerWeapon` `ensureWeaponDef` `ensureWeaponDefs` `getWeaponDef` `loadWeaponDefs` `getModCaps` `refreshWeaponChoices` `registerBuiltinWeapons` | 84 |
| `src/systems/art/weapon-caps.js` | 每武器改件数量上限同步存取（**无 Phaser 数据模块**，供 player-data/damage 复用不破坏单测） | `setWeaponCaps` `getWeaponCaps` | 19 |
| `src/systems/art/weapon-registry.js` | 运行时武器目录（**无依赖叶子模块**，供 state/player-data 查询，避免 import 环）：基础 3 种 id + 设计武器 id 目录 | `BASE_WEAPONS` `weaponCatalog` `registerWeaponId` `isKnownWeapon` `DEFAULT_UNLOCKED_WEAPONS` | 20 |
| `src/systems/art/default-weapons.js` | 默认武器模板：把现有 3 种玩家武器（radial/yellow/green）还原成武器设计稿 + 空白模板 + `buildBuiltinWeaponDesigns`（把 yellow/green 模板转成 id=`yellow`/`green`、名称「散射/激光」、`isTemplate:false`） | `buildDefaultWeapons` `buildAllDefaultWeapons` `buildBuiltinWeaponDesigns` | 120 |
| `src/systems/art/pet-design.js` | 宠物设计稿数据模型：归一化 + 默认（机制硬编码，只配数值：外形/弹道引用 + 环绕/开火/生命/购买） | `normalizePetDesign` `defaultPetDesign` | 45 |
| `src/systems/art/pet-store.js` | 宠物运行时存取：按 id 懒加载 + 列表/缓存 + `registerBuiltinPets` 启动兜底内置 | `registerPet` `getPetDef` `listPetDefs` `ensurePetDef` `loadPetDefs` `registerBuiltinPets` | 66 |
| `src/systems/art/default-pets.js` | 内置宠物定义（打包端无 `/api/pets` 兜底） | `buildBuiltinPetDesigns` | 23 |
| `src/editor/pet-board.js` | 宠物编辑器工作台：独立页（DOM 表单），改宠物数值（外形/弹道引用 + 环绕/开火/生命/购买），保存到 `data/pets/*.json` | `showPetBoard` `initPetBoard` `getPetDesign` | 146 |
| `src/api.js` | 前端 API 封装（fetch → `/api/*`），共 **26 个导出接口** | `get` `post` `remove` `loadLevel` `saveFormal` `saveDraft` `getUi` `saveUi` `listPlayers` `listAssets` `loadAsset` `saveAsset` `deleteAsset` `listWeapons` `loadWeapon` `saveWeapon` `deleteWeapon` `listOutlines` `loadOutline` `saveOutline` `deleteOutline` `listPixels` `loadPixel` `savePixel` `deletePixel` **`getInnerShop`** … | 82 |
| `src/ui.js` | `getDom()`（id 硬校验）、`setStatus`、关卡下拉、武器/模组渲染（`renderPreviewMods` 接收 `items`，改件区按库存数量渲染） | `getDom` `setStatus` `renderLevels` `renderPreviewWeapons` `renderPreviewMods` | 137 |
| `src/ui-config.js` | UI 配置页：节点列表表单 + 可视化预览 + 保存 + **interact/hover 交互字段 + poly 顶点编辑** | `renderUIConfigPage` `addUINode` `saveUIConfigPage` | 231 |
| `src/ui-editor.js` | **UI 配置页可视化画布编辑器**：在 uiPreviewCanvas 上点选/拖动移动/拖角缩放节点、选中覆盖层与手柄、与左侧表单实时双向同步、点击空白放置所选类型、**hover 实时预览 + poly 点拖动编辑** | `UIEditor` `initUIEditor` `getUIEditor` | 391 |
| `src/ui-library.js` | **可复用 UI 组件库注册表**：组件定义（defaultProps + propsSchema + draw2d(Canvas2D 库预览) + drawPhaser(Phaser 页面)）。组件：`LoginButton`（登录按钮：透明底白字+扫光悬停）、`GiftCard`（神像三选一增幅卡：白卡+图标[可配动态资产/黑圆占位]+名称/描述+悬停放大 10%，`icon` 为画板资产 id；图标缩放 `designRadius` 已挪到 `asset-render.js` 共享导出） | `LoginButton` `GiftCard` `hexToRgb` `mixColor` `colorInt` `registerComponent` `getLibrary` `getComponent` `registerBuiltinComponents` | 204 |
| `src/ui-library-panel.js` | **UI 组件库面板**：列出已注册组件（名称/分类/描述），schema 驱动属性表单 → 实时重绘预览 canvas，模拟悬停看扫光；`asset` 类型字段用 `getArtChoices()` 生成资产下拉，图标动态资产未缓存时 `ensureDesign` 异步加载完成后重绘。选中 `GiftCard` 时切到**赐福卡片多卡编辑器**：列表选卡 + 名称/描述/图标/加成(属性+op+value 行) + `offerCount` + 新增/删除卡，保存调 `saveUi('idol-buffs', cfg)` 写回 `data/ui/idol-buffs.json` 并 `setIdolBuffs` 即时生效 | `initUILibraryPanel` `renderUILibraryList` `renderUILibraryPreview` `toggleUILibraryHover` `showUILibrary` | 294 |
| `src/ui-mxgraph.js` | **mxGraph 线框 XML 解析器**（浏览器 `DOMParser`，不引库）：顶点(`vertex=1`) → `{shape:'rect'/'rounded'/'ellipse'/'rhombus'/'triangle'/…, direction}`；**连线(`edge=1`) → `{shape:'line', points:[相对 bbox 的折线顶点], stroke, strokeWidth, dashed}`**（支持游离端点 `sourcePoint/targetPoint`、连在顶点上的 `source/target` + `exitX/exitY`(`entryX/entryY`)、`Array as="points"` 折点；两端定位不到才丢弃）。颜色统一走 `colorValue()`：解析新版 draw.io 的 `light-dark(#浅,#深)` 取浅色、非法值回落 mxGraph 默认色 | `parseMxGraph` | 199 |
| `src/ui-page-profiles.js` | **已有 UI 页面画像**：把代码绘制的现有页面（工坊 `workshop.js:drawWorkshopUI` / 武器商店 `screens.js:drawWeaponShop` / 关卡选择(2页) `drawLevelSelect='页1 模式选关'` / 结算 `drawSettlement`）按相同布局常量还原成可批注形状数组，供设计稿「导入已有页面」下拉复用，AI 据此精确实现 | `pageProfiles` `profilePage` | 164 |
| `src/ui-wireframe.js` | **UI 设计稿页**：粘贴 mxGraph XML 解析导入 → 画布拖移/点选控件 → 左侧填每控件「功能/动画/逻辑描述」→ 保存设计稿；**新增「导入已有页面」下拉**（从 `ui-page-profiles.js` 生成形状）；绘制支持 `rect/rounded/ellipse/rhombus/triangle(带 direction)/parallelogram/text/line`，连线按折线绘制、命中用「点到线段距离」，圆角半径按 mxGraph `arcSize` 计算，`rotation` 正向=顺时针（与 mxGraph 同向） | `initWireframe` `showWireframe` | 402 |
| `server.js` | HTTP API + 静态/vite 服务（含 `/api/pixels` 像素库路由、`/api/inner-shop` 策划表实时解析 + mtime 缓存 + JSON 回退，`dirs.pixels`/`mkdir`/`readOnlyDenied`） | `startServer(options)` | 523 |
| `tools/export-tables.mjs` | **导表工具**：`策划文档/server/{消耗品,武器,老虎机}.xlsx` → `data/inner-shop.json`（依赖 `exceljs`），**并交叉引用项目数据**（`loadWeaponNameIndex` 读 `data/weapons/*.json` 按 `name` 建「名 → 项目武器 id」，写入 `weapons[].weaponId`），导出 `buildInnerShop` 供 server 开发期复用；`parseConsumables` 本轮新增 5 字段：`effectType`/`effectValue`/`effectSec`（对应消耗品表新增第 16~18 列 `效果类型`/`效果数值`/`效果时长`）+ `artTypeInRun`/`artNameInRun`（对应既有 `美术方案类型（局内表现）`/`美术方案名称（局内表现）` 两列） | `buildInnerShop`、`parseConsumables`、`parseWeapons`、`parseLottery`、`loadWeaponNameIndex`、`DEFAULT_DRAW_COST`、`DEFAULT_GOLD_PRIZE` | 272 |
| `data/inner-shop.json` | 导表生成物（`consumables[4]` / `weapons[3]` / `lottery`；本轮重新生成含局内表现/效果字段）——打包态的回退数据源 | — | 129 |
| `index.html` | 编辑器 DOM 结构（id 集合 + 15 个 `.tool` 按钮 + 画板页 + 独立画板弹层（**绘制轮廓 + 像素画板两个弹层**，7+ 组工具条）+ **像素库下拉 `#artPixelSelect`/`#artAddPixel`/`#artDeletePixel`** + 玩家美术按武器绑定） | — | 503 |
| `electron/main.cjs` | Electron 主进程：起内嵌 server（port 0）+ BrowserWindow | — | 60 |
| `package.json` | scripts（含 `export-tables`，且 `build`/`pack` 前置导表）+ electron-builder 配置（`extraResources` 带 `data/inner-shop.json`） | — | 60 |
> `electron/` 目录**只有 `main.cjs` 一个文件，没有 preload**。`contextIsolation: true` + `nodeIntegration: false`，打包标记靠 URL 参数 `?packaged=1`（`electron/main.cjs:43`）传递，不是 preload 注入。`context.js:15` 里那句 `window.__APP_PACKAGED__` 是预留的另一条判定通路，当前无人写入。
### 改 X 该动哪个文件（速查）

| 需求 | 主改文件:函数 | 必须连带 |
|---|---|---|
| 改拖拽/放置/擦除行为 | `editor-input.js:pointerDown` / `pointerMove` | 新实体要同步 `pickTopEntity` |
| 改缩放/旋转手柄命中范围 | `editor-geometry.js:handleAtRect`（±12）/ `rotationHandleAt`（≤12） | `world-render.js:377/442` 手柄绘制尺寸 |
| 改实体拾取优先级（谁盖谁） | `editor-geometry.js:pickTopEntity`（从上到下的 return 顺序） | — |
| 改编辑器缩放上下限 / 视图钳制 | `editor-camera.js:onWheel:151` / `clampEditorView:34` | `resetEditorCamera:48` 的 `0.1~1` |
| 改试玩镜头跟随 | `editor-camera.js:updatePlayCamera:89` | `setupPlayCamera:76`、`playZoom:60` |
| 加/改属性面板字段 | `entity-properties.js:renderEntityProperties` 对应分支 | `state.js` normalize + 需重绘则 `bindEntityFieldInputs` |
| 改/加小地图箱庭标记配置 | `room-panel.js` 的 `#roomCellPopup`（右键房间弹窗）+ `index.html` 的 `#roomCellMarkerType`/`#roomCellMarkerIcon` + `bindings.js` 事件绑定 + `ui.js` ids；`applyRoomMarker(c,r)` 写 `cell.marker`；数据契约 `MINIMAP_MARKER_TYPES/LABELS` 见 level-design skill §3.8。房间类型下拉另走 `#roomCellType` + `applyRoomType(c,r)` 写 `cell.type`（`ROOM_TYPES/ROOM_TYPE_LABELS`，未知房间详 level-design §3.8） |
| 加编辑器工具（工具栏按钮） | `index.html` `.tool` 按钮 + `editor-input.js:pointerDown` 的 `tool === 'xxx'` 分支 | `state.js` normalize 函数、`history.js:COPY_ID_PREFIX` |
| 加撤销/快捷键 | `bindings.js:314` keydown 监听 | 撤销点要显式 `pushUndo()` |
| 加后端接口 | `server.js` `parts[1] === 'xxx'` 分支 | `src/api.js` 封装、打包只读白名单 `server.js:172` |
| 改/加「策划表格 → 游戏数据」链路（导表） | `tools/export-tables.mjs` 的 `parseXxx` + `server.js:175 getInnerShop()`（mtime 缓存 + JSON 回退） | `src/api.js:getInnerShop` 取数封装、`package.json` 的 `export-tables`/`build`/`pack` 脚本与 `build.extraResources`；数据契约见 economy-numbers skill |
| 改打包随包分发的数据资源 | `package.json` `build.extraResources`（`data/inner-shop.json` 即此例） | 只读资源走 `extraResources`，可写资源走 `dataRoot`；`electron/main.cjs` 路径要与之一致 |
| 改关卡保存/草稿落盘 | `level-flow.js:redraw:59` + `api.js:saveFormal/saveDraft` | `bindings.js:331` beforeunload 兜底 |
| 改模式切换/试玩快照 | `level-flow.js:setMode:137` / `restoreEditorSnapshot:160` / `save-flow.js:startTrial:76` | 快照字段 `ctx.editorSnapshot` `ctx.editorPlayerSnapshot` |
| 改 UI 配置页字段 | `ui-config.js:nodeFields` | `src/ui-editor.js`（可视化拖拽编辑器）、`src/ui-preview.js:renderUIPreview`、运行时 `src/ui-layer.js:renderGraph` |
| 改 Electron 打包 | `package.json` `build` 段 + `electron/main.cjs` | `extraResources` 与 `main.cjs:14-18` 路径必须一致 |
| 加 DOM 控件 | `index.html` + `src/ui.js` `ids` 数组 | 漏一个 id 就 `Missing DOM elements` 直接抛错 |
| 改画板（设计稿渲染/元素字段/手柄） | `src/systems/art/asset-render.js`（几何与 `renderAsset`）+ `src/editor/artboard.js`（主画板交互与面板）+ `src/editor/draw-board.js`（独立画板轮廓绘制） | 设计稿 JSON 结构在 `normalizeDesign/normalizeElement`；新字段要加进 `elementFields`；轮廓库走 `/api/outlines` + `normalizeOutline` |
| 改武器系统（设计/弹道/战斗接入） | `src/systems/art/weapon-runtime.js`（弹道解释器）+ `src/editor/weapon-board.js`（工作台）+ `weapon-design.js`（模型） | 战斗接入要同步 `player-data.js`（weaponCatalog/目录归一化）+ `main.js`（loadWeaponDefs 预载）+ `weapon-store.js`（注册/caps）；新字段要加进 `normalizeWeaponDesign` 与 `scalarFields()`；**武器本体美术（六边形/环链/出场动画）**落点 `src/systems/art/weapon-body.js` + `weapon-ring-chain.js` + `ui/entity-art.js:drawPlayer/drawHexRingPlayer` + `constants.js:WEAPON_RING_CHAIN` |
| 改宠物系统（数值/编辑器/存档） | `src/systems/art/pet-design.js`（模型）+ `pet-store.js`（存取）+ `src/editor/pet-board.js`（工作台） | 战斗行为在 `combat/pet-runtime.js`（硬编码机制）；装备/购买写 `equipment.pets`/`items.uniques`（`screens.js:buyPet`）；新数值字段要加进 `normalizePetDesign` 与 `pet-board.js:FIELDS`；打包端 `main.js` 顶层 `registerBuiltinPets()` |

## 3. 核心数据结构
### 3.1 编辑器 DOM 侧 `ctx`（`src/editor/context.js:21`，共 9 个字段）

| 字段 | 类型 | 可变？ | 说明 |
|---|---|---|---|
| `W` / `H` | `1920` / `1080` | 常量 | 画布逻辑尺寸，传给 `Phaser.Game` |
| `PACKAGED` | boolean | 常量（构造时算） | `window.__APP_PACKAGED__ === true` 或 URL `?packaged=1` |
| `state` | object | **引用固定，内部字段随时改** | `createState()` 结果，见 3.3 |
| `dom` | object \| null | **会被重新赋值** | `main.js:42` `ctx.dom = getDom()`；初始化前是 `null` |
| `editorSnapshot` | `{level, levelId}` \| null | **会被重新赋值** | 进试玩/预览前的关卡快照 |
| `editorPlayerSnapshot` | `{player, playerId, hasAnySave}` \| null | **会被重新赋值** | 进试玩前的玩家快照 |
| `iconChoices` | `[{name,url}]` | **会被重新赋值** | `main.js:52` 从 `/api/icons` 拉；失败置 `[]` |
| `popupCell` | `{c,r}` \| null | **会被重新赋值** | 房间大小弹窗当前格 |
| `hooks` | object | 运行时填 7 个键 | 见 3.2 |
### 3.2 `ctx.hooks` 7 个钩子（注册点全在 `src/main.js:31-37`）

| 钩子 | 签名 | 实现 | 调用点（是否裸调用） |
|---|---|---|---|
| `sync` | `() => void` | `level-flow.js:36` | `history.js:31` **裸调用** |
| `redraw` | `() => void` | `level-flow.js:59` | `entity-properties.js:41` **裸**、`history.js:83` **裸**、`room-panel.js:29` **裸** |
| `renderTriggerEvents` | `(entity, options) => void` | `trigger-panel.js:106` | `entity-properties.js:426` **裸** |
| `startNewGame` | `() => void` | `save-flow.js:33` | `level-flow.js:95` **裸**（包在箭头函数里，只在场景回调时才执行） |
| `selectSave` | `(id) => Promise` | `save-flow.js:54` | `level-flow.js:97` **裸** |
| `listStoreSaves` | `() => Promise` | `save-flow.js:22` | `level-flow.js:96` **裸** |
| `saveStorePlayer` | `(id, player) => Promise` | `save-flow.js:25` | `level-flow.js:105` **裸**（后接 `.catch`） |
实测：**7 个钩子、7 个调用点全部是裸调用，没有一处用 `?.()`**。见第 7 章坑位。
### 3.3 `ctx.state`（`src/state.js:484 createState()`）编辑器关心的字段

| 字段 | 初值 | 说明 |
|---|---|---|
| `level` | `normalizeLevel()` | 当前关卡数据；**整体替换很频繁**（selectLevel / undo / applyTemplate / import） |
| `levelId` | `'level-1'` | 当前关卡 id |
| `levels` | `[]` | 关卡 id 列表（`refreshLevels` 填） |
| `templates` | `{}` | `/api/templates` 结果；打包端置 `null` |
| `mode` | `'editor'` | 见 1 章 |
| `tool` | `'select'` | 当前工具，`bindings.js:36` 设置 |
| `selected` | `null` | 当前选中实体（**对象引用，不是 id**） |
| `showGridInEditor` | `true` | 编辑器网格开关 |
| `ready` | `false` | `initialize` 末尾置 `true`；beforeunload 兜底保存依赖它 |
| `ui` | `{battle,interface,weapon,workshop}` | UI 图，`loadPackagedUi` 填（另含 `login`） |
| `game` | `null` | `Phaser.Game` 实例 |
`main.js:15-28` 又补挂了 6 个字段（不在 `createState` 里）：`player`、`playerId`、`hasAnySave`、`saveStore`（`formal`/`test`）、`previewPlayer`、`trialPlayer`。
### 3.4 场景侧注入 `ctx` ≠ 编辑器 `ctx`（**最易混淆点**）
`level-flow.js:81 createGameScene({...})` 传入的是一个**新建的字面量对象**，只有 9 个键，与 `src/editor/context.js` 导出的 `ctx` 是两个不同对象：

| 场景 ctx 键 | 类型 | 实现 | 场景侧调用点 |
|---|---|---|---|
| `state` | object | **与编辑器 ctx.state 是同一个引用** | 到处 |
| `redraw` | fn | `level-flow.js:redraw` | `game-scene.js:73`、`editor-input.js:189/234`（裸）、`editor-input.js:256`（`?.`） |
| `pushUndo` | fn | `history.js:pushUndo` | `editor-input.js:53/253`（`?.`） |
| `onSwitchLevel` | `(target, spawnPoint, done)` | `switchToLevel` | `systems/level/level-flow.js:296`（`?.`） |
| `onExitPreview` | fn | 打包端恢复游戏 / 否则回编辑器 | `game-scene.js:181`（`?.`） |
| `onStartNew` | fn | `hooks.startNewGame` | `save-login.js:16/53`（`?.`） |
| `onListSaves` | fn | `hooks.listStoreSaves` | `save-login.js:65`（`?.`） |
| `onSelectSave` | `(id)` | `hooks.selectSave` | `ui-runtime.js:519`（`?.`） |
| `onOpenLevel` | `(target)` | 淡出切关 | `ui-runtime.js:421/525`（`?.`） |
| `onSettings` | fn | 空实现 `() => {}` | `save-login.js:24`（`?.`） |
| `onPlayerSave` | `(player)` | `hooks.saveStorePlayer` | `progression.js:63`（`?.`） |
**记忆法**：mixin 里 `const ctx = this.ctx;` 拿到的是场景 ctx（只有 `state` + 回调），**没有 `dom` / `hooks` / `iconChoices`**。DOM 面板文件里 `import { ctx } from './context.js'` 拿到的是编辑器 ctx（有 `dom`/`hooks`，**没有 `redraw`/`pushUndo`** 这些函数字段——面板里要重绘得用 `ctx.hooks.redraw()` 或直接 import `redraw`）。
### 3.5 编辑器选中态 / 拖拽态 / 手柄

| 概念 | 存放位置 | 结构 |
|---|---|---|
| 选中实体 | `ctx.state.selected` | 实体对象引用；`l.spawn` / `l.background` 也可被选中 |
| 拖拽态 | `this.drag`（场景实例字段） | `{ mode, entity, handle? }`；`pointerup` 时清空（`game-scene.js:73`） |
| 平移态 | `this.panning` + `this.panStart` | `{x,y,sx,sy}`；中键或右键触发（`editor-input.js:46`） |
| 框选态 | **主编辑器只有单选** | 实测主编辑器场景无 marquee/框选实现，`state.selected` 是单个对象，需要框选是**新功能**，得自己加（成本高，先确认）。注：**轮廓画板 `draw-board.js` 已实现框选/复制粘贴/方向键整组移动**（点集多选，`selectedSet`），与主编辑器无关 |
`this.drag.mode` 6 种取值：

| mode | 触发条件 | pointerMove 行为 |
|---|---|---|
| `move` | 命中普通实体 | `x/y = snap(wp)` |
| `spawn` | 命中出生点 | 替换 `l.spawn`（唯一无 `entity` 字段的 mode） |
| `resize` | `handleAtRect` 命中角手柄 | `resizeRect` |
| `rotate` | `rotationHandleAt` 命中（仅 wall / gate / portal） | 角度吸附 5° 步进 |
| `bg-move` | 命中 `l.background` | 直接赋值（**不吸附网格**） |
| `bg-resize` | `backgroundHandleAt` 命中 | `resizeBackground`（等比） |
手柄编号约定：字符串 `'nw' | 'ne' | 'se' | 'sw'`（`handleAtRect:141` 顺序与 `wallCorners` 一致，**是 nw,ne,se,sw 顺时针，不是 nw,ne,sw,se**）。`resizeRect` 用 `handle.includes('w'/'e'/'n'/'s')` 判方向，对角固定；`backgroundHandleAt` 的顺序是 `nw,ne,sw,se`（数组顺序不同但返回值语义一致）。
### 3.6 撤销栈与剪贴板（`src/editor/history.js`）

| 项 | 结构 | 说明 |
|---|---|---|
| `undoStack` | `Array<clonedLevel>` | 模块级私有数组；`pushUndo` 存 `clone(state.level)` **整关卡深拷贝** |
| 上限 | `MAX_UNDO = 60`（`history.js:15`） | 超了 `shift()` 丢最早 |
| `undo()` | 弹栈 → 若 JSON 相同则**递归**再弹一次 → `normalizeLevel` → `selected = null` → `draw()` → `hooks.sync()` → `saveFormal` | 注意它调 `saveFormal`（直写正式关卡） |
| `clipboard` | `{ kind, data }` \| null | `kind` 是 `entityKind()` 返回的**关卡数组字段名**（`walls`/`enemies`/…13 种） |
| 粘贴 | `pasteClipboard` | 新 id = `COPY_ID_PREFIX[kind]-Date.now()`，坐标 +40/+40，`pushUndo` 后 push |
`entityKind` 支持 13 类：`walls enemies triggers crates barrels chests images spawnZones gates vendors idols icons portals`。**`spawn` 与 `background` 不可复制**（返回 `''`）。
### 3.7 `server.js` API 路由表（实测 **16 个 `/api` 路由分支** + 2 个静态特殊路由）

| Method | Path | 目录 | 返回 |
|---|---|---|---|
| GET | `/api/levels` | `dirs.levels` | `{levels: string[]}` |
| GET | `/api/levels/:id` | `dirs.levels/:id.json` | 关卡 JSON（读不到 → 404 `{error}`） |
| POST | `/api/levels/:id` | 同上，写 | `{ok:true}`（打包端 403） |
| DELETE | `/api/levels/:id` | 同上，删 | `{ok:true}`（打包端 403） |
| GET | `/api/templates` | 内存常量 `templates`（`server.js:7`） | `{single:{...}, multi:{...}}` |
| GET | `/api/inner-shop` | 开发期：`策划文档/server/{消耗品,武器,老虎机}.xlsx`（`buildInnerShop` 实时解析、按三表 mtime 缓存）；失败回退 `data/inner-shop.json`；都不可用返回空骨架 | `{generatedAt, consumables[], weapons[], lottery}`，**永不 500** |
| GET/POST | `/api/flow` | `data/flow.json` | 流程图 JSON / `{ok:true}` |
| GET/POST | `/api/level/:id?` | `dirs.levels`（默认 id `level-1`） | 旧接口，等价 `/api/levels/:id` |
| GET/POST | `/api/ui/:id` | `dirs.ui/:id.json` | UI 图；GET 读不到回落 `defaultUi[id]` |
| GET | `/api/players` | `dirs.players/index.json` | `{slots:[], metas:{id:{name,updatedAt,level}}}` |
| GET/POST/DELETE | `/api/players/:id` | `data/players/:id.json` + index | 玩家 JSON / `{ok:true}` |
| GET | `/api/test-players` | `data/test-players/index.json` | 同 players 结构 |
| GET/POST/DELETE | `/api/test-players/:id` | `data/test-players/:id.json` | 试玩存档，与正式完全隔离 |
| POST | `/api/uploads` | `data/uploads/`（raw body，按 content-type 推扩展名） | `{path:'/uploads/xxx.png'}` |
| GET | `/api/icons` | `图标/` 目录（`iconsDir`，默认项目根下中文目录） | `{icons:[{name,url:'/icons/<encoded>'}]}` |
| GET | `/api/assets` | `dirs.assets`（`data/assets/`） | `{assets:[{id,name}]}`（name 读自每个设计稿文件） |
| GET/POST/DELETE | `/api/assets/:id` | `data/assets/:id.json` | 画板设计稿 JSON / `{ok:true}`（打包只读） |
| GET | `/api/weapons` | `dirs.weapons`（`data/weapons/`） | `{weapons:[{id,name}]}`（name 读自每个武器设计稿文件） |
| GET/POST/DELETE | `/api/weapons/:id` | `data/weapons/:id.json` | 武器设计稿 JSON / `{ok:true}`（打包只读） |
| GET | `/api/pets` | `dirs.pets`（`data/pets/`） | `{pets:[{id,name}]}` |
| GET/POST/DELETE | `/api/pets/:id` | `data/pets/:id.json` | 宠物定义 JSON / `{ok:true}`（打包只读） |
| GET | `/api/outlines` | `dirs.outlines`（`data/outlines/`） | `{outlines:[{id,name}]}`（name 读自每个轮廓文件） |
| GET/POST/DELETE | `/api/outlines/:id` | `data/outlines/:id.json` | 轮廓 JSON / `{ok:true}`（打包只读） |
| GET | `/api/pixels` | `dirs.pixels`（`data/pixels/`） | `{pixels:[{id,name}]}`（name 读自每个像素画文件） |
| GET/POST/DELETE | `/api/pixels/:id` | `data/pixels/:id.json` | 像素画元素 JSON（`shape='pixel'`，存 cols/rows/cellSize/gridColor/cells/name）/ `{ok:true}`（打包只读） |
非 `/api` 特殊路由：

| Path | 行 | 说明 |
|---|---|---|
| `/uploads/:name` | `server.js:274` | 白名单 `/^[\w.-]+$/`，`Cache-Control: no-store` |
| `/icons/:name` | `server.js:284` | decodeURIComponent + 拒 `..`/`/`/`\`，指向 `iconsDir` |
| 其它 | `server.js:294` | 有 `staticDir` → `serveStatic`（含无扩展名 SPA 回退 index.html）；否则 → vite 中间件 |
`id` 校验统一 `/^[-\w]+$/`，不合法 400。所有 API 异常统一被 `server.js:271` catch 成 404 并 `console.error('[api error]')`——**调后端时看终端日志，别只看 404**。

## 4. 关键流程
### 4.1 应用启动（开发/编辑器）

```
index.html（86 个 id + 15 .tool 按钮）
  → src/main.js（模块顶层）：state.player/playerId/hasAnySave/saveStore/previewPlayer/trialPlayer 初始化（:15-28）
  → ctx.hooks.{sync,redraw,renderTriggerEvents,startNewGame,selectSave,listStoreSaves,saveStorePlayer} 注册（:31-37）
  → initialize()（:40）
      ctx.dom = getDom()          ui.js:56，缺 id 直接 throw
      bind()                       bindings.js:31 全量接线（含 bindDropRules / bindPlayerPanels）
      若 PACKAGED → initializePackaged() 后 return（见 4.2）
      editorPanel 显示
      state.templates = await get('/templates')
      ctx.iconChoices = (await get('/icons')).icons
      loadPackagedUi()             packaged.js:17 预载 5 张 UI 图
      state.player = normalizePlayer(await loadPlayer('save-1'))
      listPlayers() → state.hasAnySave
      refreshLevels()              失败即 return
      selectLevel(defaultId, false, false)   ← 固定 level-1，不恢复上次关卡
      startGame()                  level-flow.js:73 建 Phaser.Game
      state.ready = true; setStatus('初始化完成')
```
> `rememberLevel/recallLevel`（localStorage `editor:lastLevelId`）**目前只写不读**：`main.js:70` 注释明确「打开编辑器固定加载空关卡 level-1，避免自动加载真实关卡导致误覆盖」。想恢复上次关卡就改这行。
### 4.2 打包端启动路径（PACKAGED）

```
electron/main.cjs:7 start()
  → 动态 import('../server.js') 拿 startServer（避免 Electron 直接跑 vite）
  → dataRoot = %APPDATA%/arc-engine（players / test-players / uploads 可写）
  → levelsDir/uiDir = app.isPackaged ? resources/data/{levels,ui} : 项目 data/{levels,ui}
  → staticDir = ../dist（vite build 产物）
  → startServer({ isPackaged:true, host:'127.0.0.1', port:0 })  ← 端口 0 = 随机
  → BrowserWindow 1920x1080，contextIsolation:true / nodeIntegration:false（无 preload）
  → loadURL(`http://127.0.0.1:${port}/?packaged=1`)
页面侧：
  context.js:13 PACKAGED = URL 参数 packaged==='1'（或预留的 window.__APP_PACKAGED__）
  → main.js:44 走 initializePackaged()（packaged.js:38）
      state.templates = null; player = normalizePlayer(); saveStore='formal'
      loadPackagedUi() → listPlayers() → refreshLevels()
      enterPackagedLogin()：进 login 关卡 → setMode('trial')
  → setMode 里 editorVisible = !PACKAGED && mode==='editor' ⇒ 面板永久隐藏
  → server 端 readOnlyDenied（server.js:172）拦 levels/level/ui/flow 的写请求 → 403
```
### 4.3 编辑器鼠标交互（拖拽 / 缩放 / 旋转）

```
Phaser pointerdown（game-scene.js:71） → EditorScene.pointerDown（editor-input.js:12）
  const ctx = this.ctx
  !this.editing → 走游戏侧分支（工坊/登录按钮/暂停/结算），直接 return
  中键或右键 → this.panning = true, 记 panStart，return（不 pushUndo）
  ctx.pushUndo?.()                       ← 每次编辑器左键点击都先存快照
  wp = cameras.main.getWorldPoint(p.x, p.y); x/y = snap(wp)   ← CELL=30 吸附
  tool==='select' 且已选中 →
      rotationHandleAt(selected)（仅 wall/gate/portal）→ drag={mode:'rotate'}
      handleAtRect(selected)              → drag={mode:'resize', handle}
      selected===l.background → backgroundHandleAt → drag={mode:'bg-resize'}
  tool==='erase' → pickTopEntity 命中后按 hit.type 从对应数组 filter 掉；再校验 selected 是否已失效
  tool==='wall'/'enemy'/'trigger'/'gate'/'vendor'/'idol'/'icon'/'portal'/'spawnzone'/'crate'/'barrel'/'chest'/'spawn'
      → push 新实体（wall/trigger/gate/vendor/idol/icon/spawnzone 是内联字面量；enemy/crate/barrel/chest/portal 走 state.js 的 normalizeXxx）
  else（select） → pickTopEntity → drag = move / bg-move / spawn / null；state.selected = entity
  ctx.redraw()
pointermove（editor-input.js:192）
  panning → scrollX/Y = panStart - delta/zoom → clampEditorView() → draw()
  drag.mode 分派：spawn / move（snap）/ rotate（5°吸附）/ bg-move（不吸附）/ bg-resize / 默认 resizeRect
  ctx.redraw()
pointerup（game-scene.js:73）→ handleWorkshopPointerUp(); drag=null; panning=false; ctx.redraw()
方向键微调：update() → updateEditorKeys（editor-input.js:237）
  输入框聚焦时跳过 → pushUndo?.() → sel.x/y = snap(±CELL) → redraw?.()
```
`redraw()`（`level-flow.js:59`）= `draw()` + `sync()` + **仅 editor 模式**才 `saveDraft` 落盘（`:63` 注释强调试玩里的射击 pointer 事件也会走 redraw，绝不能写关卡文件）。
### 4.4 属性面板链路

```
state.selected 变化 → redraw() → sync()（level-flow.js:36）→ renderEntityProperties()（entity-properties.js:45）
  按 15 种归属判定 type（spawn/墙体/敌人/触发器/箱子/油桶/宝箱/背景图/场景图片/生成区域/能量门/售货机/神像/可交互图标/传送门）
  hidden = state.mode!=='editor' || !entity
  组装 fields = [[key, label, inputType, options?]]，inputType ∈ number|text|color|boolean|select|multiselect
  fields.unshift(['id','编号','text'])
  innerHTML 拼串 → bindEntityFieldInputs(entity)（:431）
      input.onfocus = pushUndo
      input.oninput → setNested(entity, field, value)
          field==='type'   → 同步 hp/damage（ENEMY_TYPES）
          field==='scheme' → 同步 weaponType（SCHEME_WEAPONS）
          spawn.mode / spawn.waves.N.mode|shape → 补默认值后 renderEntityProperties() 重渲并 return
          field==='id' 且是 gate/spawnZone → 只 draw() 刷新别处下拉，return
          默认 → scene.draw() + saveDraft
  宝箱分支（:267-353）额外挂「掉落奖励配置」子编辑器后提前 return
  icon 分支（:392）追加「上传图标」按钮 → POST /api/uploads → entity.src
  trigger 分支（:425）→ ctx.hooks.renderTriggerEvents(entity, {enemyTypeOptions, levelOptions, gateOptions, eventTypeOptions})
```
> 敌人分支现在按 `entity.type` 追加 BOSS 配置字段（**两套并行**）：`mothership`（`entity-properties.js:141`）→ 「大小 / 召唤间隔 / 召唤表 / 被击败运镜 id」；`boss-2-5t5`（`entity-properties.js:150`）→ **`artScale` + 81 个 `boss.*`，共 82 项**（基础·移动·护盾·圆弧·技能1-4·技能5 全量数值，含 `boss.name` 与 `boss.cutsceneId`）。本轮改动：删除 `boss.zoneAimTrackDeg`（旧「技能1/2 成型期瞄准跟随」，**已废弃**：跟随会让扇形一直罩住玩家、玩家无法走出躲避）+ `boss.s5PullAccel`（旧单一吸力加速度），新增 `boss.s5PullMin`（技能5-最小吸力(px/s，半径边缘处)）/`boss.s5PullMax`（技能5-最大吸力(px/s，涡心处，**需 < 玩家移速 180**)，同时是向量累加后的速度上限）；扇形方向改为**释放瞬间写死、全程不变（不跟随玩家）**，命中仅保留 `boss.zoneHitPadPx`（技能1/2 命中**像素级**容差(px)、s3 不参与）；技能1/2 对子弹的施力改为**一次性固定速度+固定距离**（速度复用 `s1DragSpeed`/`s2PushSpeed`，**距离 = `s1DragDist`/`s2PushDist` × 2**）。技能5 拖尾宽/长旧键（`boss.*RedTrailWidth`/`boss.*RedTrailLength` 形态）已于**上一轮**改名为 `boss.s5BulletTrailWidth`/`boss.s5BulletTrailLength`（关卡 json 里的 4 / 250 已同步）。字段名必须与运行时读取路径逐字一致（见 `combat` skill §3.7/§5）。上一轮新增 `arc4SpinDeg`；`arc5AlignDeg`→`arcAlignDeg`；`skill2HalfDeg`→`parkMinDeg`；`mergeOverlapPct` 现由渲染端 `boss25t5-art.js:drawBoss25T5Body` 判定两弧是否合并（运行时几何判定已移除）。写路径不同：母舰的运镜 id 写**顶层** `e.cutsceneId`（运行时 `enemy-ai.js:defeatEnemy` 也读 `e.cutsceneId`；该键由 `state.js:normalizeEnemy` 保留，否则落盘→读回会丢）；`boss-2-5t5` 写 **`e.boss.cutsceneId`**（运行时读 `e.bossCfg.cutsceneId`，两侧已对齐，见 §7 坑 33）。其余字段经 `setNested` 写进 `e.boss.*`，由 `state.js:normalizeEnemy` 各自的 normalize 分支消费（`boss-2-5t5` 走 `normalizeBoss25T5Config`）。
### 4.5 保存链路

| 入口 | 调用 | 目标 |
|---|---|---|
| 任意编辑动作 | `redraw()` → `saveDraft(levelId, level)` | `POST /api/levels/:id` → `data/levels/:id.json` |
| 「保存关卡」按钮 | `bindings.js:233` → `saveFormal` | 同一个端点 |
| `undo()` | `history.js:32` `saveFormal` | 同上 |
| 世界/相机数值输入 | `bindings.js:48 saveDraftQuiet()` | 同上 |
| 刷新/关闭页面 | `bindings.js:331` beforeunload → `navigator.sendBeacon('/api/levels/:id')`（无则 `fetch keepalive`） | 同上；需 `state.ready && mode==='editor' && levelId` |
> **关键**：`api.js:24` `export const saveDraft = saveFormal;` —— 草稿=正式，同一端点/同目录；`data/drafts/` 是死数据（详见坑 12）。别被目录名骗了。
### 4.6 试玩链路（快照机制，最易污染编辑器数据）

```
「流程试玩」按钮（bindings.js:227）→ save-flow.js:startTrial:76
  await saveDraft(levelId, level)                      先落盘当前编辑内容
  ctx.editorSnapshot = { level: clone(level), levelId } ← 关卡快照
  ctx.editorPlayerSnapshot = { player: clone(player), playerId, hasAnySave } ← 玩家快照
  state.saveStore = 'test'                             存档读写切到 data/test-players
  state.player = normalizePlayer(); state.playerId='save-1'
  listTestPlayers() → hasAnySave（决定 login 页「继续游戏」是否可点）
  fadeAndSwitch(() => selectLevel('login', false, false).then(() => setMode('trial')))
  catch → restoreEditorSnapshot() 回滚
「游戏预览」按钮（bindings.js:222）→ 只存关卡快照（不存玩家快照），setMode('play')，用 state.previewPlayer
退出（「关卡编辑」按钮 bindings.js:221 / ESC → ctx.onExitPreview → level-flow.js:92）
  → restoreEditorSnapshot()（level-flow.js:160）
      state.level / state.levelId 还原；editorSnapshot = null
      若有 editorPlayerSnapshot → 还原 player/playerId/hasAnySave 并清空
      state.saveStore = 'formal'                       ← 必须复位，否则后续存档写进 test 目录
  → setMode('editor')
```
**新增任何「进游戏」入口都必须成对**：进之前存快照，退出走 `restoreEditorSnapshot()`。漏了会导致游戏内切关（`switchToLevel` 直接改 `state.level`/`state.levelId`）把编辑器当前关卡替换掉，随后一次 `redraw()` 就把 A 关的数据写进 B 关文件。
### 4.7 相机链路

| 场景 | 函数 | 行为 |
|---|---|---|
| 编辑器初始适配 | `resetEditorCamera:48` | `fit = min(VIEW_W/w, VIEW_H/h)`，`zoom = clamp(min(1, fit), 0.1, 1)`；镜头居中世界中心 |
| 编辑器滚轮 | `onWheel:125`（编辑器分支从 `:144`） | 以指针为锚点缩放，`zoom = clamp(z0 * (deltaY>0?0.9:1.1), 0.1, 4)` → `clampEditorView()` → `showZoom()` → `draw()` |
| 编辑器平移钳制 | `clampEditorView:34` | 相机中心 clamp 到 `[-VIEW_W, w+VIEW_W]` / `[-VIEW_H, h+VIEW_H]`（允许超出世界一屏） |
| 试玩缩放 | `playZoom:60` | `min(VIEW_W/min(cameraWidth, worldW), VIEW_H/min(cameraH, worldH))`；`cameraSize:18` 按 16:9 反算高 |
| 试玩初始 | `setupPlayCamera:76` | 菜单关卡（`ui==='login'`）固定 `scroll=0`；否则玩家居中 |
| 试玩跟随 | `updatePlayCamera:89` | 菜单关卡固定 0；`camera.mode==='center'` 每帧居中；否则 **deadzone**：死区 = 可见世界的 1/3（`displayW/3`），越界才推镜头，最后 `cam.clampX/clampY` |
| 世界边界 | `applyWorldBounds:25` | `setBounds` 时四周各 pad 2000，保证 center 模式下任意位置可居中 |
| 缩放显示 | `showZoom:43` | 直接 `document.getElementById('zoomInfo')`（`index.html:218`），**不走 ctx.dom** |
| 滚轮非编辑器 | `onWheel:126-143` | 工坊页横向滚动 / 战斗中切武器 |
### 4.8 UI 配置页链路

```
「UI 配置」按钮（bindings.js:304）→ showUIConfig(true)（bindings.js:25）
  body.classList.add('ui-config-mode') → renderUIConfigPage(dom, state)（ui-config.js:30）
      graph = state.ui[dom.uiGraphSelect.value]
      uiNodeList.innerHTML = graph.nodes.map(nodeRow)   按 node.type 出字段（panel/bar/text/icon/button/shape/image）
      initUIEditor(dom, state) → editor.render()       ui-editor.js（可视化画布编辑器）
      每个 [data-key] 的 oninput → 改 node 字段 → editor.render() 重绘（kind 改变要整页重渲）
  「添加节点」→ addUINode：NEW_NODE[type] 模板 + id = `${graph.id}-${Date.now()}`，随后选中新节点
  「保存」→ saveUIConfigPage → saveUi(id, state.ui[id]) → POST /api/ui/:id → data/ui/:id.json
游戏侧生效：
  下次 loadPackagedUi()/getUi 读回 state.ui → 场景 UiRuntimeMixin 用 src/ui-layer.js:211 renderGraph 绘制
  （节点类型语义与 bindings 详见 ui-interaction skill）
```
注意 UI 配置页**没有撤销**（不走 `pushUndo`），且**改完不保存就切页会丢**（只改内存 `state.ui`）。`state.ui` 有 5 个键（`battle/interface/login/weapon/workshop`，`packaged.js:19`），但 `createState()` 里只列了 4 个（缺 `login`），靠 `loadPackagedUi` 整体覆盖补齐。
**可视化编辑**（`src/ui-editor.js`）：`uiPreviewCanvas` 从只读预览变为可交互画布，`ui-config.js` 的 `renderUIConfigPage` 每次重渲后调 `editor.render()` 绘制节点 + 选中覆盖层。交互：点选节点、拖动移动（默认 4px 吸附）、拖 8 个手柄缩放、点击空白取消（勾选「点击空白放置所选类型」则在空白落点新建节点）；拖动 / 缩放时 `writeNodeToForm()` 实时回填左侧表单的数值字段。切页（`uiGraphSelect.onchange`）时 `bindings.js:308` 调 `getUIEditor()?.reset()` 清选中。渲染仍是 `renderUIPreview`（Canvas2D 纯函数），未引入 Phaser。编辑器内开 RAF 循环（仅 `body.ui-config-mode` 时重绘）以驱动 hover 平滑渐变 + `poly` 顶点圆点拖拽（`shape kind='poly'` 时不显示缩放手柄，改为点拖动编辑 `node.points`）。
**hover/focus 交互（数据驱动，`ui-interact.js` 纯函数）**：节点写 `interact.hover` → 运行时 `ui-runtime.js drawUI` 每帧用 `nodeRect`+`uiPointer()` 算命中集 `this.uiHovered`，经 `interactProgress` 产出进度，`ui-layer.js drawXxx` 按进度混合 fill/stroke/alpha/dx/dy/scale（按 `animMs` 平滑）。编辑器预览（`ui-preview.js`）与游戏运行时共用同一引擎。示例见 `data/ui/interface.json` 的 `close` 按钮（hover 提亮 + 上浮 + 缩放 + press 缩放）。按钮点击的 press 缩放复用现有 `pressScale(id)`（`ui-runtime.js` `onUIPointer` 兜底 `pressAnim(b.id)`）。
### 4.9 UI 组件库（可复用控件，保留原视觉）
**方向**：不把代码绘制页改成数据节点（那样必然动视觉，已于 S1 验证并放弃）。改为**把原控件抽象成可复用组件 + 建组件库**。
- 组件 = `src/ui-library.js`：`defaultProps` + `propsSchema`（可配置属性：背景/边框/颜色/尺寸/文字）+ `draw2d`(Canvas2D，库面板/预览) + `drawPhaser`(Phaser，真机页面)。原绘制逻辑不动，只是参数化 → **视觉保真**且可配置。
- 库入口：`#uilibrary` 按钮（index.html:26）→ `uilibrary-mode` → `initUILibraryPanel` 渲染列表 + schema 属性表单 + 预览 canvas + 「模拟悬停」。注册表由 `registerBuiltinComponents()`（bindings.js:307）填充。选中 `GiftCard` 时表单换成赐福配置编辑器（多卡 + 图标/名称/描述/加成 + offerCount + 保存写回 `data/ui/idol-buffs.json`，保存即 `setIdolBuffs` 生效；面板改的 `propState` 不落盘，真源是那次 POST 的配置 JSON）。
- **登录页已用 `LoginButton` 组件还原**：`save-login.js:drawLoginButtons` 用 `LoginButton.drawPhaser` 逐按钮绘制（扫光悬停 + 文字变深），`loginButtonRects` + `editor-input.js` 恢复点击，`hideLoginButtonTexts` 在非登录页隐藏文本。此前 S1 的「登录按钮改数据节点」已回退（`data/ui/login.json` 还原为 logo/title/version 3 节点）。
- **`GiftCard` 组件已注册**（神像三选一增幅卡）：`defaultProps` 含 `icon`/`iconSize`/`name`/`desc`/`nameSize`/`descSize`/`textColor`/`bgColor`/`hoverScale`；`draw2d` 用 `makeG` + `renderAsset` 渲染 `icon`(画板资产 id) 为动态资产，缺省退化黑圆占位；`drawPhaser` 用单 text 渲染 `名称\n描述` 两行。`propsSchema` 里 `icon` 是 `type:'asset'`（面板用 `getArtChoices()` 生成下拉）。`makeG` 已从 artboard.js 挪到 `asset-render.js` 共享导出（组件库预览与画板共用）。**注意**：组件库预览是 Canvas2D，动态资产需经 `ensureDesign(icon)` 异步拉取，`draw2d` 先画黑圆占位、加载完成后 `renderUILibraryPreview` 重绘换动态资产；神像弹窗 `drawIdolOffer` 已改为读 `offer.cards[i].icon`（`data/ui/idol-buffs.json`）渲染画板资产，缺省才黑圆，张数按 `IDOL_OFFER_COUNT`；后续批量注册其余控件（menuClose✕ / 面板 / 血条 / 卡片等）再逐步替换。
### 4.10 UI 设计稿（mxGraph 线框 → 供 AI 实现）
编辑器「设计稿」按钮（index.html:27 `#wireframe`）→ `wireframe-mode` → `initWireframe`。
- **导入**：文本框粘贴 draw.io/mxGraph XML（**支持 URL 编码 `%3C...` 自动解密**）→ `parseMxGraph`（`ui-mxgraph.js`，`DOMParser`）：**顶点**（`vertex=1`）读 `mxGeometry` x/y/w/h + value=label + style 的 `shape`(椭圆/菱形/rounded/首 token `ellipse;`/`text;`)/`fillColor`/`strokeColor`/`strokeWidth`/`arcSize`/`absoluteArcSize`/`fontColor`/`fontSize`/`align`/`verticalAlign`/`rotation`/`dashed`/`fillOpacity`；**连线**（`edge=1`）→ `{shape:'line', x/y/w/h=折线包围盒, points:[相对 bbox 原点的折线顶点]}`，端点优先取游离 `mxPoint as="sourcePoint"/"targetPoint"`，否则取所连顶点(`source`/`target`)的 `exitX/exitY`(`entryX/entryY`) 比例点或中心，`Array as="points"` 作折点；HTML 化 label 剥纯文本，`<font color>`/`<font-size>` 作为颜色字号兜底。生成可移动形状数组（连线按文档序在顶点之后 → 画在上层）。**形状**：`shape` 支持 `rect/rounded/ellipse/rhombus/triangle/parallelogram`（`triangle` 按 mxTriangle 语义：默认顶点朝东，`direction=north/south/west` 改朝向；`parallelogram` 按 stencil：上下边水平、左右边右倾，倾斜量取 style 的 `size`，缺省 20 设计单位、夹到 `W/2`；其余未知 shape 仍回落矩形）；**颜色**：统一走 `colorValue()` —— 新版 draw.io 的 `light-dark(#浅,#深)` 取浅色分支，非法值回落 mxGraph 默认（填充白/描边黑）；**旋转**：`rotation` 正向 = 顺时针，与 mxGraph/canvas 同向（**别写负号**）。
- **导入已有页面**：`#wireframePageSel` 下拉（`pageProfiles`：workshop/weapon/levelSelect/settlement）+ `#wireframePageImport` 按钮 → `profilePage(pageId)`（`ui-page-profiles.js`）按**与绘制代码相同的布局常量**还原现有页面的控件矩形数组。这些页面是 **代码绘制**（`drawWorkshopUI`/`drawWeaponShop`/`drawLevelSelect`/`drawSettlement`），无节点图，故用静态画像而非节点。画像含一个 **`pg_bg` 全屏背景矩形**(1920×1080)，`computeView()` 取其最大面积当背景 → 缩放系数=1、坐标 1:1 还原到设计坐标，可直接标注 `note`。**改页面布局 ⇒ 同步改 `ui-page-profiles.js` 对应函数及第 2 章行数**。
- **编辑**：画布（`ui-wireframe.js`）拖移控件、点选；左侧填「名称/X/Y/宽/高/功能·动画·逻辑描述(note)」。预览**滚轮缩放（围绕光标）**；`computeView()` 自动把最大面积矩形当背景铺满整窗。
- **保存**：`saveUiDesign(name, {name, shapes})` → `POST /api/ui-designs/<name>` → `docs/ui-designs/<name>.json`。
- **加载/删除**：`#wireframeSelect` 下拉经 `listUiDesigns` 填充 → `loadUiDesign` 加载、`deleteUiDesign` 删除（`api.js` 已有）。
- **名称字符集**：设计稿 id = 文件名 `docs/ui-designs/<name>.json`，**允许中文等 Unicode**。`server.js` ui-designs 分支先把 URL 段 `decodeURIComponent`、再用 `/^[-\w\p{L}\p{N}]+$/u` 校验后才落盘（`server.js:355`）。名字可自由用中文命名，`list` 返回 id/name 均为原样。**别把该正则退回成 `/^[-\w]+$/`**（会拒中文，报 400）；也勿信 `url.pathname` 已是解码态——`parts[2]` 仍是百分号编码，必须先 decode。
- **设计稿格式（AI 消费）**：`{ name, shapes:[{id,x,y,w,h,label,shape,fill,stroke,rounded,fontColor,fontSize,align,verticalAlign,rotation,note}] }`。AI 读每控件 `note`（功能/动画/逻辑）+ 坐标/颜色/形态实现。
- **1:1 关键**：mxGraph 形状**默认填充白、描边黑**（显式 `fillColor=none`/`strokeColor=none` 才透明/无边框）；`whiteSpace=wrap` 已自动换行 + 多行垂直居中；`<font size="N">` 相对字号映射；`fontColor` 从 `<font color>` 兜底。
### 4.11 画板工作台链路
画板是**独立工作台**（仿 UI 配置页），用 **纯 Canvas2D + 手写交互**，**完全不碰 Phaser 场景 / mixin / `this.editing`** —— 这是它低风险的关键。
- **右侧预览视窗支持修改背景色**：`.art-preview` 里 `#artBgColor`(color) → `design.bgColor`（默认 `#0a1220`，存进设计稿随 saveAsset 落盘）。`draw()` 背景用 `design?.bgColor || '#0a1220'`；`normalizeDesign` 已归一化 `bgColor`；`showArtboard/selectDesign/artNew` 会 `syncBgColor(dom)` 同步控件值。独立画板「绘制轮廓」视窗（`draw-board.js:83`）**复用**同一 `boardDesign?.bgColor` 作背景。**新增画板 DOM id 必须同步 `src/ui.js` 的 `ids` 数组**（否则 `getDom()` 抛 Missing DOM elements）。

```
「画板」按钮（bindings.js:304 附近）→ showArtboard(true, dom, state)（artboard.js）
  body.classList.add('artboard-mode')   → body.artboard-mode { main:hidden; #artboardPage:block }
  design = defaultDesign()（首次）     ← 设计稿 JSON，模块级变量
  refreshAssetSelect(dom)              ← GET /api/assets → #artAssetSelect 下拉
  renderElementList(dom)               ← 每个元素一块 .art-element，字段全绑 [data-key]
  startLoop(canvas)                    ← requestAnimationFrame 每秒 ~60 帧 draw()，simT 累加驱动旋转
交互（canvas pointerdown/move/up）
  pointerdown 优先命中已选中元素的「缩放手柄」→ drag={mode:'scale'}；否则 hitElement()（按元素副本中心，阈值16）→ 选中 + drag={mode:'move'}
  pointermove move：polygon → orbitRadius/phase = 指针相对圆心的距离/方位（去掉已转过的角）；arc → radius = 距离
                  scale：polygon → radius = 指针到元素中心的距离
  pointerup → drag=null；pointermove 期间会 renderElementList() 重渲（数字字段随拖拽实时变）
「保存」→ saveAsset(id, design) → POST /api/assets/:id → data/assets/:id.json，然后 refreshAssetSelect(id)
「新建设计」→ defaultDesign()；「添加元素」→ push normalizeElement()
改名：#artboardName 输入框 —— oninput 直接写 design.name，保存时随 JSON 落盘
旋转方向：元素字段「旋转方向」select（`dir=1`逆时针 / `-1`顺时针）→ 写 `item.dir`，`renderAsset`/`elementCenter` 用 `ga = phase + rotSpeed*t*dir` 生效
复制元素：`#artCopySelect` 列出已有元素（`populateCopySelect`），点「复制其他元素」→ `structuredClone` 源元素深拷贝、`phase`/`orbitRadius` 微偏移避免重叠，push 并选中
像素画板（独立弹层，逻辑在 `src/editor/pixel-board.js`）：`#artPixel` → `openPixelBoard(dom,design,{getSelectedIndex,onDone,onSaved})` 弹 `.draw-board` 层（`#pixelBoardCanvas`）。设置 `#pixelCols/#pixelRows/#pixelApplySize`(规格)、`#pixelCellSize`(格宽)、`#pixelBgColor`、`#pixelGridColor`、`#pixelShowGrid`；上色 `#pixelColor` → 点击格/长按拖动画刷连涂，`#pixelEraser` 橡皮、`#pixelUndo` 撤销、`#pixelFillAll` 清空；空白框选多格 → Ctrl+C/V / 方向键移块 / Delete 删,`#pixelRotateDeg`+`#pixelApplyRotate` **自由角度**绕选区几何中心旋转(四舍五入到格,可压格/填洞)——**格坐标是整数格索引(相对网格左上角),几何中心在 `cols/2,rows/2`**；视图滚轮缩放(围指针)+中键平移；完成/保存:≥1有色格→组 `shape='pixel'` 写回 `boardDesign.elements`(选中已是 pixel 则替换,否则 push 新元素)→`hooks.onDone(idx)`;reload 经 `normalizeElement` 过滤越界/负坐标格;keydown 首行 `isPixelBoardOpen()` 早退(坑17)。**「保存为像素设计稿」`#pixelSaveLibrary` 走 `savePixelToLibrary` 落盘 `/api/pixels`(同名覆盖,回调 `onSaved` 通知主画板刷 `#artPixelSelect`)**；**网格线开关 `showGrid` 写回 `el.gridColor = showGrid ? gridColor : null`——关网格线则元素 `gridColor=null`，asset-render 渲染 `hasGrid=!!gridColor` 为 false 不画网格线**。
绘制轮廓（独立画板，全量逻辑在 `src/editor/draw-board.js`）：`#artDraw` 点击 → `openDrawBoard(dom, design, { getSelectedIndex, onDone })` 弹出 `.draw-board` 弹层（独立 `#drawBoardCanvas`）。
  - 三工具：`drawToolAdd`（默认，点空白=按 `GRID=30` 吸附加点，`#drawSnap` 可关；**点击第一个点（≥3 点时）= 闭合/断开轮廓**，实现连回起点成环）/ `drawToolSelect`（点空白=取消选中）/ `drawToolFill`（**填充仿 Windows 画板**：先调色（`#drawFillColor`），在闭合回路内部点击 → `drawStyle.fill = 调色`（射线法 `pointInPolygon` 判定内外，外部点击提示）；再次点填充按钮退出）。点击已有点（8px 阈值）在 add/select 下均选中并进入拖动，新加点自动选中。
  - 点编辑：拖动跟随吸附；**方向键每次 1 像素（不吸附）**；XY 输入框直接改坐标（拖动/选中变化实时回填）；Delete/「删除点」删除；`Ctrl+Z`/「撤销」弹掉上一点（移动不做撤销栈）。
  - 填充语义：**有填充色即按闭合区域上色，不再依赖 closed**（`asset-render.js` stroke 分支已改；closed 仅决定描边是否连回首点）。闭合/填充 checkbox 已移除，由绘画操作决定。
  - 参考图形：`drawInsertShape` 圆（24 等分）/弧（弧角 12 等分）/正多边形（边数即点数）+ `drawRefOutline` 已注册轮廓（`/api/outlines`），均可「作参考底图」（半透明青色，可叠多个，`drawRefClear` 清空）；转点语义不同：**插入图形转点=追加**到点集末尾，**已注册轮廓转点=替换当前点集**（以所选轮廓为基础重绘，带状态反馈）。
  - 画笔样式：颜色/粗细/调色 → 「完成」时写入 stroke 元素（fill 由填充工具决定）；编辑已有 stroke 时初始值取该元素当前值（避免覆盖）。
  - 整条变换：旋转°/缩放% → 「应用」以**点集重心**为中心烘进点坐标（`p' = R(θ)·(k·(p−c)) + c`），应用后输入框复位。
  - 保存为轮廓：名称非空 + ≥2 点 → 点集平移到重心坐标系 → **同名覆盖**（`listOutlines` 查同名 → 复用其 id）→ `saveOutline` → 刷新 `drawRefOutline` 下拉 + `boardHooks.onSaved(id)` 通知主画板刷 `#artOutlineSelect`（保留当前绘制内容）。
  - 「完成」→ ≥2 点写入选中 stroke 元素（替换 points + 同步样式，**写回后状态栏反馈「已写回元素 N」**）或新建 shape='stroke' 元素；Esc/「取消」→ `closeDrawBoard()` 清空会话态。**与关卡撤销解耦**：`bindings.js` 的 Ctrl+Z/C/V 已 `if (artboard-mode) return`，且独立画板 document keydown **首行 `isDrawBoardOpen()` 早退**，避免误触关卡撤销。
  - 反馈约定：弹层内所有「生效类」操作（应用变换/载入轮廓/填充/保存）都 `setStatus` 提示；「应用变换」对 0°/100% 恒等输入提示「无变化，改完请点完成写回」——防止用户把「应用变换」误当「写回」。
载入：#artAssetSelect.onchange → loadAsset(id) → normalizeDesign → 重渲
  > 下拉由 `refreshAssetSelect` 生成：**兼容 `/api/assets` 旧版 `[id,...]` 与新版 `[{id,name},...]` 两种返回**（`typeof a==='string'?{id:a,name:a}:a`），并过滤 `id==='undefined'`。若本地 server 未重启仍返回旧版，下拉会回退显示 id（不会出现 undefined / 404）。
主画板 stroke 增强（artboard.js）：
  - 字段：轨道半径 `orbitRadius`（numberField）、填充色 `fill`、「填充」checkbox；`fillOn` oninput 保留已设色：`item.fill = checked ? (item.fill || '#ffa914') : null`。
  - 手柄：选中 stroke 画「重心最远点距离」虚线圈（不画无意义的 el.radius 圈）+ 沿 ga 方向 rim 缩放手柄（≤14 命中，拖动以拖起时重心为原点等比缩放点集，k 下限保底 maxDist≥2px）+ 外延 24px 旋转手柄（≤12 命中，拖动 5° 吸附反推 `phase = ga − simT·rotSpeed·dir`）。手柄锚点一律 `elementCenter` 现算（orbit>0 时返回轨道点而非圆心）。
  - 拖动 stroke（move 分支）改 orbitRadius/phase（phase 计算已修 `* (el.dir || 1)`）。
圆弧钟表花纹（artboard.js `elementFields` arc 分支）：元素字段末尾新增「显示形式」select（`pattern`：普通圆弧/钟表表盘/长短针）；`pattern==='clock'` 时才追加长针长度(`tickLongLen`)/短针长度(`tickShortLen`)/刻度密度总针数(`tickDensity`)/长短针比例(`tickRatio`，每1长配N短)/刻度方向(`tickDir` in/out/both) 五字段；`pattern==='hands'`（只画长短针不画圆环）时追加长针轨道半径(`handLongRadius`)/短针轨道半径(`handShortRadius`)/长针颜色(`handLongColor`)/短针颜色(`handShortColor`)/长针长度/短针长度/刻度密度/长短针比例/刻度方向。切换 `pattern` 走 `renderElementList` 重渲（oninput 特判，参考 `key==='shape'`）。**渲染在 `asset-render.js` 的 `renderAsset` arc 分支**（`drawArcTicks` 用 `i % (tickRatio+1) === 0` 判长针、`drawArcHands` 走长短针），武器设计稿走独立路径（`normalizeWeaponShape` 携带同样的 `pattern` 字段，见 weapon-board 圆弧分支）。
轮廓库（`data/outlines/` + `/api/outlines`）：`refreshOutlineSelect` 填 `#artOutlineSelect`（showArtboard 时刷新），`#artAddOutline` → `loadOutline` → `normalizeOutline` → push 新 stroke 元素（rotSpeed 0.5 / orbitRadius 0）并选中；`#artDeleteOutline` → `deleteOutline` → 刷新下拉（独立画板内 `#drawRefOutlineDelete` 同样可删，删后经 `hooks.onSaved` 通知主画板刷新）。
  ⚠️ **弹层布局**：`.draw-board-panel` 必须**固定宽度**（`width:664px; max-width:96vw`）——若让其自适应内容，工具条 7 组的 max-content 会把面板撑满整个视口，canvas 块级靠左，视觉上「绘制板靠左」（flex 居中其实一直在工作，但 panel 已占满视口）。
游戏侧生效（已实现；玩家按武器类型绑定，敌人直接替换）：
  entity-art.js:drawPlayer 顶部 `const aid = (player.arts && player.weaponType && player.arts[player.weaponType]) || player.art;` —— 当前武器的设计稿（或旧单 art 回退）命中且已缓存（`getDesign`）→ `renderAsset(g, design, x, y, t, artScale)` 覆盖默认绘制并 return，否则走 scheme 默认。
  drawEnemyShape 顶部 `e.art` → `renderAsset`（敌人无武器类型，直接替换）。
  设计稿懒加载：world-render.js `requestArtDesigns()` 收集玩家（各武器 arts）+敌人 art id → `ensureDesigns()`（幂等，首次拉 /api/assets/:id 缓存，可 `registerDesign` 注入转换器产物免拉取）。
  art 字段落点：`normalizePlayer`（player-data.js）新增 `arts`（按 PLAYER_WEAPONS 的 {radial:yellow:green: 设计稿id} 映射）与 `art`/`artScale`；`normalizeEnemy`（state.js）新增 `art`/`artScale`；level-flow.js `this.player` 里 `arts: {...spawn.arts, ...source.arts}`、`art: source?.art || spawn.art`。
  附加 UI：**玩家面板已移除「画板美术方案」下拉**（`#pvArt`/`#tpArt` 已删，武器美术方案集成到武器系统 —— 装备设计武器时玩家本体用其 `appearance`，见 entity-art.drawPlayer 的 `player.weaponArt` 分支）。敌人属性面板（entity-properties 敌人分支）「画板美术方案」下拉仍写 enemy.art。
「生成默认美术方案」`#artGenDefaults`：调 default-art.js `buildAllDefaultArt()`（默认玩家圆、hex-ring/yellow/green 三色环、basic1..advanced2 敌人），逐个 saveAsset + registerDesign。
```
**设计稿 JSON 结构**（`normalizeDesign` / `normalizeElement` 钳制并补默认值）：
```js
{ id, name, scale, center:{x,y},
  elements:[ { shape:'polygon'|'arc'|'stroke'|'pixel',
    count,        // 围绕圆心等角放置的副本数（"一组"）；arc/stroke 同 polygon 支持，仅 pixel 恒为 1
    orbitRadius,  // polygon：形状中心到设计圆心的轨道半径；stroke/pixel >0 时元素中心挂轨道公转
    radius, sides,                    // polygon：外接半径 / 边数
    lineWidth, color, fill,           // 描边粗细(=环厚) / 颜色 / 填充色（null=不填充；**有填充色即按闭合区域上色**）
    rotSpeed, dir, phase,             // 旋转角速度 rad/s / 方向(1=逆时针,-1=顺时针) / 初始相位 rad
    arcStart, arcEnd,                 // arc：起止角（°）
    pattern,                          // arc：plain=普通圆弧 / clock=钟表表盘 / hands=长短针（只画针不画环）
    tickShortLen, tickLongLen, tickDensity, tickRatio, tickDir,        // clock/hands：短/长针长 px(6/12)、总针数(12)、长短比(1)、朝向 in/out/both
    handLongRadius, handShortRadius, handLongColor, handShortColor,    // hands：长/短针轨道半径(0)、颜色（默认继承 color）
    points, closed,                   // stroke：轮廓点 [{x,y}]（orbit=0 相对设计圆心，orbit>0 相对轮廓重心）/ 是否闭合
    cols, rows, cellSize, gridColor,  // pixel：规格(12/12, 1~64)、每格边长(8, 1~2000)、网格线色（空=不描网格）
    cells } ] }                       // pixel：稀疏有色格 [{x,y,color}]，整数格索引（相对网格左上角），越界/负坐标在 normalize 时过滤
```
**轮廓库 JSON**（`data/outlines/<id>.json`，归一化 `normalizeOutline`，同文件导出）：
```js
{ id, name, points:[{x,y}],   // 点相对轮廓重心（保存时已平移）
  color, lineWidth, closed, fill }
```
注意：**本分类的编辑器场景统一用 `this.editing` 区分编辑器/游戏；画板是唯一不依赖场景、也不走 `state.mode` 的独立页**（靠 `body.artboard-mode` 接管）。它有自己的属性面板，与 `entity-properties.js` 的实体属性面板**互不相通**。
### 4.10 武器 · 弹道编辑器链路（批3 工作台 + 批4 战斗接入）
武器系统 = **独立设计页**（纯 Canvas2D + DOM 表单，复用画板矢量渲染 `renderAsset` + 统一弹道解释器 `weapon-runtime`），**不碰 EditorScene / `this.editing` / `state.mode`**。一份武器设计 = 武器外形(画板) + 发射媒介(最外层圆环小球) + 发射逻辑(子弹外形+子弹轨迹) + 弹道/进入游戏参数。

```
「武器」按钮（bindings.js 附近，body.weapon-mode）→ showWeaponBoard(true, dom, state)（weapon-board.js）
  登录 body.weapon-mode；body 隐藏 main、显示 #weaponPage
  design = defaultWeaponDesign()（首次）
  renderForm(dom)      ← 左侧表单分组（标量字段 data-path + 三段画板矢量组 + 矢量场/光束 + 拖尾）
  fillTemplateSelect(dom)  ← buildDefaultWeapons().filter(isTemplate) 载入 3 模板 + 空白
  refreshWeaponSelect(dom) ← GET /api/weapons 合并 buildBuiltinWeaponDesigns()（内置 yellow/green，未落盘也能列出）→ #weaponSelect
  loop(canvas)         ← requestAnimationFrame 驱动开火预览（buildWeaponRuntimeEntry(design).fire→stepBullet→drawBullet）
「保存」→ saveWeapon(id, design) + registerWeapon(design)（回注册到 WEAPONS 表，会话内即用）+ refreshWeaponSelect
「载入」→ ensureWeaponDef(id)（内置/已注册武器从目录取，其它从 /api/weapons/:id 取，取不到则报「未找到武器」）→ normalizeWeaponDesign → renderForm + registerWeapon + preview
「模板」→ buildDefaultWeapons().find(isTemplate) 载入 3 模板 + 空白
表单编辑：标量字段走 data-path；画板矢量组（外形/媒介/子弹）走「+多边形/圆弧/轮廓 + 从画板导入」，每个字段输入必须带 data-index（否则 bindShapeInput 定位不到，改了不生效——已踩坑）。
开火预览：drawPreview(canvas) 用 makeG(ctx) Canvas2D 适配器绘制 外形/媒介环/媒介小球 + 模拟发弹（beam 也画成激光束 / ttl 淡出）。
```
**战斗接入（批4）**：
- 运行时武器目录：`player-data.js` `weaponCatalog()`/`registerWeaponId()`，设计武器 id 成为合法武器类型（loadout/weapons/mods/arts 归一化都用它）。**静态数据源要读目录而非 `PLAYER_WEAPONS` 写死 3 种**。
- 启动预载：`main.js` **模块顶层 `registerBuiltinWeapons()`**（在任何 `normalizePlayer()` 之前的副作用，注册内置 yellow/green 进 WEAPONS+目录+改件上限）+ `initialize()` 里 `await loadWeaponDefs()`（从 `/api/weapons` 载入设计武器）。**打包端无 `/api/weapons` 服务器，故内置武器必须靠顶层 `registerBuiltinWeapons()`**。
**宠物编辑器流程**（`pet-mode`）：「宠物」按钮（bindings.js，body.`pet-mode`）→ `showPetBoard(true, dom, state)`（pet-board.js）→ 重置 `<select id="petSelect">`（GET `/api/pets` 合并 `listPetDefs()` 缓存，无则回退已缓存）→ 选「新建」`defaultPetDesign()`；选已有宠物 `getPetDef(id)` 载入 → `renderPetForm` 渲染数值表单（`pet-board.js:FIELDS` 字段驱动，type: number/bool/text/art/weapon）+ `petHint` 机制说明 → 改值 `onPetInput` → 保存 `savePet(id)`（POST `/api/pets/:id`）+ `registerPet` 更新缓存。**新数值字段要同时加 `normalizePetDesign`（pet-design.js）与 `pet-board.js:FIELDS`**。外形/弹道是下拉（art=画板资产 `getArtChoices()`、weapon=`weaponCatalog()`），映射到 `icon`/`weapon` 字段。
- 统一解释器 `buildWeaponRuntimeEntry(design)` → `{scheme:'default', ringColor, fireInterval, baseDamage, maxAmmo, chargeRequired, maxGenericMods, maxDedicatedMods, medium, fire, stepBullet, drawBullet}`，与 WEAPONS 表完全兼容。
- 改件数量上限：`weapon-caps.js`（**无 Phaser** 数据模块，避免 player-data→WEAPONS→Phaser 拖死 node 单测）存 caps；`normalizeWeaponMods`/`activeMods` 按上限截断。
- 数值管道：设计稿 `baseDamage/fireInterval/maxAmmo/chargeRequired` 进运行时 WEAPONS 条目 → 现有 `playerDamage()`/`fireClock` 零改动生效。
- 武器轮/工坊/图标：`WEAPONS[type]?.ringColor` + `drawWeaponGlyph` 对未知武器走 else 分支（橙圆+环）优雅回退，不崩。
- 设计页保存/载入/载入模板即 `registerWeapon`，当前浏览器会话即可用（不必刷新）。
**武器设计稿 JSON 结构**（`normalizeWeaponDesign` 钳制）：
```js
{ id, name, baseDamage, fireInterval, maxAmmo, chargeRequired,
  purchasable, price, unlockLevel, slot(1/2/3), maxGenericMods, maxDedicatedMods, isTemplate,
  appearance: { scale, center, elements:[画板矢量] },      // 武器外形
  medium: { ringIndex, angle, radius, size, ringColor, ringWidth, orbitSpeed, fireSpeed, elements:[画板矢量] },  // 发射媒介
  bullet: { count, spreadDeg, spreadRandom, range, speed, fadeDuration, randomColor, randomPalette, baseAngleOffset, size,
            shape: { scale, center, elements:[画板矢量] },  // 子弹外形
            trail: { type:'cone'|'equal'|'snake'|'particle', length, width, color, fade, tailWidth, midWidth, midAt, particleSize, particleGap, historyMax },
            trajectory: { kind:'vector'|'beam',
                          vector: { speed, angleOffset, gravityX, gravityY, zigzag:{enabled,ampDeg,wavelength}, jitter:{enabled,amount,freq} },
                          beam: { width, color } } } }
```
> 画板矢量元素（外形/媒介/子弹共用，`normalizeWeaponShape`+`renderAsset`）新增 **`offsetX/offsetY/offsetSpeed`**（移动滞后：`renderAsset(g,design,x,y,t,scale,motion,alpha)` 第 7 参 `motion`（归一化移动向量，game 用 `moveLeanX/Y÷PLAYER_LEAN.hex`）驱动元素沿移动方向错位；第 8 参 `alpha` 供子弹淡出）。圆弧新增**钟表表盘/长短针**：`pattern`（plain/clock/hands）+ `tickShortLen`/`tickLongLen`/`tickDensity`/`tickRatio`/`tickDir` 与长短针 `handLongRadius`/`handShortRadius`/`handLongColor`/`handShortColor`（与 asset-render 对齐，渲染走 `renderAsset` arc 分支的 `drawArcTicks`/`drawArcHands`；`normalizeWeaponShape` 携带这些字段，故武器外形/媒介/子弹圆弧都能用钟表/长短针花纹）。媒介新增 **`ringWidth`**（环线宽）、**`orbitSpeed`/`fireSpeed`**（球怠速/射击转速°/s，`game-scene.js` 转动角速度改用之，回退 180/20）。子弹新增 **`range`**（射程，超出淡出消失）、**`speed`**（飞行速度，缺省回退旧 `vector.speed`）、**`fadeDuration`**（消失时长 ms：到达最远距离（配 `range`）**或撞墙**时停驻原地、在时长内原地渐隐——被墙壁阻挡时同样渐隐而非直接销毁；0=按距离淡出）、**`spreadRandom`**（每发随机偏移°）、**`randomColor`**（每发随机色，`randomPalette` 指定随机合集[调色盘 chip，规范化为 `#rrggbb`，空则全场随机色相]）；拖尾新增 **`midWidth`**（菱形中间宽，>0 时渲染头尾尖中间宽的 6 顶点菱形）与 **`midAt`**（最宽处占比）。发射媒介环上小球由 `entity-art.drawPlayer` 的 `drawWeaponMedium()` 绘制（球兜底色取 `medium.ringColor`，非硬编码白）。**weapon-board 圆弧钟表 UI**：`shapeFieldEdit` arc 分支追加「显示形式」select（`pattern`）+ 条件性钟表/长短针子字段；`bindShapeInput` 对 `pattern` 特判 `renderForm(dom)` 重渲（钟表子字段显隐）、`tickDir` 特判字符串写入；`miniSelect` 为新增 select 渲染助手。
### 4.12 导表 → server 实时解析 → 打包分发（策划表格链路）

```
策划文档/server/{消耗品,武器,老虎机}.xlsx
  ├─（开发期）server.js:175 getInnerShop()
  │    key = 三份表 mtime 拼接（server.js:160 tableMtimeKey，缺文件记 'missing'）
  │    命中 innerShopCache → 直接返回；否则 await import('./tools/export-tables.mjs').buildInnerShop({tablesDir})   ← **动态 import**
  │    失败（文件缺失 / 被 ~$ 锁文件占用 / 格式异常 / 打包态无 exceljs）→ console.warn + 回退 data/inner-shop.json（:168 readInnerShopFallback）
  │    两者都不可用 → 返回空骨架（{consumables:[],weapons:[],lottery:{drawCost:15,goldPrize:15,kinds:[]}}），**永不 500**
  └─（打包态）无 策划文档目录、无 exceljs → 直接读 extraResources 带进来的 data/inner-shop.json（JSON 回退路径）
GET /api/inner-shop → src/api.js:81 getInnerShop → economy/inner-shop.js:31 loadInnerShop（Promise 去重 + 失败可重试）
  → InnerShopMixin.setupVendorStock → screens.js:drawVendorShop

打包链：npm run pack = node tools/export-tables.mjs && vite build && electron-builder --win
        build.files          = electron/** dist/** server.js package.json（**不含 tools/**）
        build.extraResources = data/levels、data/ui、data/inner-shop.json
```
**设计意图（重要）**：`tools/` 与 `exceljs`（devDependency）**故意不进 `build.files`** —— 打包态用不到导表脚本，靠 `extraResources` 里的 `data/inner-shop.json` 兜底；server 端因此必须**动态** `import()` 导表模块（写成顶层静态 import 会让打包后启动直接崩）。开发期策划改表免重启（mtime 缓存自动失效）。**导表产物不止来自 xlsx**：`buildInnerShop` 还会**交叉引用项目数据**——`loadWeaponNameIndex()` 读 `data/weapons/*.json` 的 `name` 建「武器名 → 项目武器 id」，写入 `weapons[].weaponId`，故产物字段依赖 `data/` 的现状（不能只看 xlsx）；匹配不到时 `weaponId` 留空串（不报错）。

## 5. 关键常量与数值

| 常量 | 所在文件:行 | 当前值 | 含义 | 调它影响什么 |
|---|---|---|---|---|
| `VIEW_W` / `VIEW_H` | `systems/constants.js:9` | `1920` / `1080` | 视口逻辑尺寸 | 编辑器缩放适配、钳制范围、试玩 playZoom 全部按它算 |
| `CELL` | `systems/constants.js:9` | `30` | 网格吸附步长 | `snap()` 精度、新建墙/触发器默认尺寸（`CELL*4×CELL*3` 等）、方向键微调步长 |
| `ROTATE_HANDLE_OFFSET` | `systems/constants.js:79` | `28` | 旋转手柄离实体上边距离 | `rotationHandleAt` 命中位置 + `world-render.js:382/446` 手柄绘制位置（两处必须一致） |
| `WEAPON_RING_CHAIN` | `systems/constants.js:64` | `{count:120, ratio:0.75, minPx:1, minZoom:1.8, refZoom:3.5, stepMs:100, fadeMs:100}` | 武器内圈环链 / 出场动画参数（链环数 / 半径厚度比 / 屏幕最小厚度px / 最小相机zoom / **厚度判据的参考相机缩放 refZoom（固定值）** / 每元素出场间隔ms / 单元素渐显ms） | 只影响放大（zoom ≥ minZoom）时武器本体的观感；改它同步 `weapon-ring-chain.js`（`chainRefScale`/`elementThickness`）与 `entity-art.js:drawHexRingPlayer`。**厚度判据用固定 `refZoom` 而非当帧 zoom**（见 §7 坑 56） |
| 运镜叠层几何 | `editor-camera.js:_applyCinematicOverlays` | 黑边上下各 `12.5% × letterbox` 屏高；tint alpha=`tint*0.55`、flash alpha=`flash*0.8`；vignette 用 `textures.createCanvas` 径向渐变贴图（失败降级 Graphics 同心矩形） | 叠层大小/透明度 | 运镜氛围强度 |
| 运镜叠层 depth | `editor-camera.js:_ensureCinematicOverlays` | `cinematicFade`/`cinematicLetterbox`/`cinematicFlash` 9999、`cinematicVignette`/`cinematicTint` 9998、`cinematicDesat` 9997 | 叠层层级 | 见 §7 坑 48（**必须挂 `uiCam`**，否则 zoom≥2 / rotation 下黑边黑幕移出屏幕） |
| 旋转手柄命中半径 | `editor-geometry.js:135` | `12`（`<= 12`） | 圆形命中 | 太小难点中，太大会盖住角手柄 |
| 角手柄命中半宽 | `editor-geometry.js:139` | `handleSize = 12` | `abs(dx)<=12 && abs(dy)<=12` | 与绘制尺寸 10×10（`world-render.js:377`）不等，命中略大于视觉，属故意 |
| `BG_HANDLE_SIZE` | `editor-geometry.js:157` | `10` | 背景图角手柄命中半宽 | 背景缩放手感 |
| `MIN_BG_SIZE` | `editor-geometry.js:170` | `20` | 背景最小边长 | `resizeBackground` 的 scale 下限 |
| `MIN_WALL_SIZE` | `state.js:2` | `8` | 矩形缩放最小边长 | `resizeRect` 保底、`normalizeLevel` 墙/触发器尺寸下限 |
| 编辑器缩放区间 | `editor-camera.js:151` | `clamp(..., 0.1, 4)` | 滚轮缩放上下限 | 放大上限 400%，缩小下限 10% |
| 初始缩放区间 | `editor-camera.js:52` | `clamp(min(1, fit), 0.1, 1)` | 打开关卡的初始 zoom | **上限是 1，不会放大小地图** |
| 缩放步进 | `editor-camera.js:151` | `0.9` / `1.1` | 每格滚轮倍率 | 缩放灵敏度 |
| 世界边界 pad | `editor-camera.js:30` | `2000` | `setBounds` 四周外扩 | center 模式镜头能否越出世界 |
| deadzone 比例 | `editor-camera.js:112` | `displayW/3`、`displayH/3` | 试玩死区半宽/半高 | 值越小镜头越黏玩家 |
| 旋转吸附步进 | `editor-input.js:224` | `5`（`round(deg/5)*5`） | 拖旋转手柄的角度粒度 | 想自由旋转就去掉取整 |
| 粘贴偏移 | `history.js:78-79` | `+40 / +40` | 复制体错位量 | 粘贴后是否叠在原体上 |
| `MAX_UNDO` | `history.js:15` | `60` | 撤销栈上限 | 内存占用（每格是整关卡深拷贝，大关卡很重） |
| 默认端口 | `server.js:62` | `Number(process.env.PORT \|\| 5173)`；打包端 `0` | 开发服务器端口 | 测试用 `TEST_API_BASE` 也默认 `localhost:5173`（`test/player-api.test.js:8`） |
| `FADE_MS` | `level-flow.js:113` | `350` | 切关黑屏淡入淡出时长 | 与 CSS transition `.35s` 成对，改一个要改两个 |
| `W` / `H` | `editor/context.js:11` | `1920` / `1080` | Phaser 画布尺寸 | 与 VIEW_W/H 同值但**是两套常量**，改分辨率要一起改 |
| `GATE_OUTER_COLOR` / `GATE_INNER_COLOR` | `systems/constants.js:81-82` | `#FFE6BE` / `#FFCB85` | 能量门内外色块默认色 | `normalizeGate`（`state.js:418-419`）里**又硬编码了一遍同样的值** |
| `GATE_OFFSET_RATIO` / `GATE_SPAWN_MS` | `systems/constants.js:83/80` | `0.14` / `500` | 门开合位移比例 / 动画时长 | `drawGates` 外观；编辑器里 `t` 固定 1（不放动画） |
| 门选中框比例 | `editor-geometry.js:101` | `h * 1.42` | 编辑器门选中框比视觉高 42% | 因为门开合会上下位移，框要包住 |
| `ROOM_SIZE` 等 | `rooms.js:2-16` | `1120` / 道路 `448×560` / 尺寸 `400~2400` / 厚度 `8~200` | 多箱庭布局参数 | 房间面板输入上下限（`bindings.js:195/205/214/216` 引用），详见 level-design skill |
| `export-tables` 脚本 | `package.json:13` | `node tools/export-tables.mjs` | 手动把策划表重导成 `data/inner-shop.json` | 打包 / 离线场景必跑 |
| `build` / `pack` 前置导表 | `package.json:9` / `:12` | `node tools/export-tables.mjs && vite build [&& electron-builder --win]` | 保证打包产物带最新 `data/inner-shop.json` | 去掉前置步骤 → 打包态读到旧 JSON |
| `DEFAULT_DRAW_COST` / `DEFAULT_GOLD_PRIZE` | `tools/export-tables.mjs:10-11` | `15` / `15` | 老虎机表里没有「抽卡花费 / 金币保底」列，用常量集中定义 | 改值或加列都要改脚本 |
| `BLANK_ROW_STOP` / 表头扫描 | `tools/export-tables.mjs:16` / `:95` | `5`；`findHeaderRow` 只扫前 30 行 | 空行判数据结束 / 找中文表头行 | 表结构大改时可能要调 |
| 导表数据资源 | `package.json:38-51` | `extraResources`: `data/levels`、`data/ui`、`data/inner-shop.json` | 随包分发的只读数据 | 新增表产物必须在此加条目 |

## 6. 扩展指南
### 6.1 新增一种可编辑实体类型（最重的一类需求，跨 6~8 个文件）
以「新增 `turret`（炮台）」为例，按顺序：
1. **`src/state.js`**：仿 `normalizeIcon`（`:204`）写 `normalizeTurret(value, index)`；在 `DEFAULT_LEVEL`（`:323`）加 `turrets: []`；在 `normalizeLevel`（`:438`）返回对象里加 `turrets: (Array.isArray(data.turrets)?data.turrets:[]).map(normalizeTurret)`。
2. **`index.html`**：工具栏加 `<button data-tool="turret" class="tool">炮台</button>`（`:88-102` 区块内）。不需要改 `ui.js` 的 `ids`（工具按钮是 `querySelectorAll('.tool')` 收的）。
3. **`src/systems/editor/editor-input.js`**：
   - `pointerDown` 加 `else if (tool === 'turret') { ... push + state.selected = ... }` 分支（`:137-177` 之间）；
   - 若要支持缩放/旋转手柄，把 `turret` 加进 `:61-70` 的 `selectedXxx` 判定和 `:71` 的长条件、以及 `:72` 的旋转白名单；
   - `erase` 分支（`:91`）加 `hit.type === 'turret'` 的 filter，并把它加进 `:124-134` 的 selected 失效校验链。
4. **`src/systems/editor/editor-geometry.js`**：`pickTopEntity`（`:200`）按期望的遮挡优先级插入 `for` 循环（越靠前越优先命中）。
5. **`src/editor/entity-properties.js`**：`type` 三元链（`:50-64`）加一行；再加 `else if ((l.turrets||[]).includes(entity))` 的 `fields` 分支。
6. **`src/editor/history.js`**：`entityKind`（`:36`）加 `if ((l.turrets||[]).includes(entity)) return 'turrets';`；`COPY_ID_PREFIX`（`:56`）加 `turrets: 'turret'`。**漏这两处 = 该实体不能复制粘贴且不报错**。
7. **`src/systems/ui/world-render.js`**：`draw()` 里加绘制段；若用精灵，仿 `syncIconSprites`（`:220`）写一个 sync 并在 `draw()` 里调用；选中框/手柄绘制仿 `:427-450` 的 portal 段。
8. **游戏侧生效**：`systems/level/spawning.js` 等处把关卡数据实例化为运行时对象（详见 gameplay-systems / level-design skill）。
9. 关卡 json 无需手改（`normalizeLevel` 会补 `turrets: []`），但**已存在的关卡文件不会自动写入该字段**，直到下次保存。
### 6.2 新增一个属性面板字段
1. `entity-properties.js` 对应实体的 `fields` 数组加 `['fieldKey', '中文标签', 'number'|'text'|'color'|'boolean'|'select'|'multiselect', options?]`。嵌套字段直接写点号路径（`getNested`/`setNested` 支持，如 `'spawn.waves.0.count'`）。
2. `src/state.js` 对应 `normalizeXxx` 加该字段的默认值与钳制——**不加会导致关卡重载后字段丢失**。
3. 如果改这个字段需要立刻重绘/重算：在 `bindEntityFieldInputs`（`:435` 的 `oninput`）里加特判（参考 `field === 'type'` / `field === 'id'` 的写法）。默认路径已经会 `draw() + saveDraft`。
4. `select` 的选项若来自其它实体列表（如引用某个 gate/trigger），记得在 `renderEntityProperties` 里现算（参考 `gateOptions:88`、`l.triggers.map(...)`：`:251`），并考虑「被引用实体改 id 后要刷新下拉」——已有的 `field === 'id'` 特判（`:476`）就是为此存在。
5. **条件显示字段**（勾 A 才显示 B/C）：fields 数组按 `entity.A` 值用展开语法条件拼接（参考 `guideRows(e, withStop)`，`:95`），并在 `bindEntityFieldInputs` 里对开关字段特判 `if (field === 'guide') renderEntityProperties()` 重渲染面板（参考 `__waveCount` / `spawn.mode` 的重渲染写法）。宝箱分支有**独立的模板循环**（已补 boolean/text 分支；此前 `id` 的 text 类型落到 number 输入框会触发浏览器 `"chest-1" cannot be parsed` 告警），加新类型时两处模板都要看。
### 6.3 新增一个 server API 端点
1. `server.js` 在 `if (parts[0] === 'api')` 块里加 `if (parts[1] === 'yourthing') { ... }` 分支（参考 `:207` players 段）。目录一律通过 `dirs` 表拿，不要拼裸路径；id 必须过 `/^[-\w]+$/`。
2. 需要新目录 → 在 `dirs`（`:66`）加键，并在 `:90-92` 的 `fs.mkdir(..., {recursive:true})` 处补一行。
3. 写操作要考虑打包只读：把它加进 `readOnlyDenied`（`:172`）判定，否则打包端也能改内置资源（内置目录只读会抛错 → 被 catch 成 404，报错很隐晦）。
4. `src/api.js` 加封装（`export const xxx = id => get('/yourthing/'+id)`）。
5. 若前端要用，`src/editor/*` 里 import 该封装；错误提示统一走 `setStatus(dom, msg, true)`。
6. **改了 server.js 必须起服跑测试**：`node server.js` 后 `node --test test/`，否则 `test/player-api.test.js` 的 5 个 fetch 用例永远是 `fetch failed`，你就发现不了自己写坏了。
### 6.4 新增一个编辑器快捷键
两个入口，选对：
- **DOM 级（Ctrl 组合键、面板类操作）**：`bindings.js:314` 的 `document.addEventListener('keydown')`。已有 `Ctrl+Z / Ctrl+C / Ctrl+V`，且开头就有 `if (state.mode !== 'editor') return;` 守卫。加分支时照抄 `e.preventDefault()`；注意判定用 `e.ctrlKey || e.metaKey` 兼容 Mac，且现有逻辑都排除了 `e.shiftKey`（想加 `Ctrl+Shift+Z` 重做要单独判）。
- **画布级（方向键、单键工具切换）**：`editor-input.js:updateEditorKeys`（每帧从 `update()` 调）。必须：① 在 `game-scene.js:81` 的 `addKeys({...})` 里注册键码；② 用 `Phaser.Input.Keyboard.JustDown()` 防连发；③ **保留 `:243-244` 的输入框聚焦守卫**，否则在侧边栏打字会误触发实体移动；④ 修改数据前 `ctx.pushUndo?.()`，之后 `ctx.redraw?.()`。
### 6.5 改 Electron 打包配置 / 新增随包分发的资源目录
以「让 `图标/` 目录随包分发」为例：
1. `package.json` `build.extraResources`（`:36`）加 `{ "from": "图标", "to": "图标" }`。
2. `electron/main.cjs`：算出 `path.join(process.resourcesPath, '图标')`，`app.isPackaged` 时用它、否则回退项目根，然后作为 `iconsDir` 传给 `startServer`（`server.js:64` 已支持 `options.iconsDir`，当前 main.cjs **没传**，所以打包端 `/api/icons` 目前必然空列表）。
3. 若资源需**可写**（如上传目录），不能放 `extraResources`（只读），要放 `dataRoot`（`%APPDATA%/arc-engine`）下，参考 `server.js:69` 的 `uploads`。
4. `build.files`（`:30`）只含 `electron/**`、`dist/**`、`server.js`、`package.json`——**新增运行时需要的根级 js 文件必须加进这里**，否则打包后 `import('../server.js')` 之外的模块会找不到。
### 6.6 运镜锚定中心工具（`cinematics-board.js`）
给「运行时动态位置」（如 BOSS 死亡坐标）的运镜做**编辑器侧迁移**：选中关键帧 → `#cinematicSetAnchor` 进入 `pickAnchor` 模式 → 点击预览画布拾取世界坐标作锚点 → `applyCenterMigration(dom, ax, ay)`。
**核心换算**（编辑器模型，**已与运行时统一为「视口左上角世界坐标」**：`camParams` 里 `camCenterWorld = { x: panX + camW/2, y: panY + camH/2 }`，`camW = level.camera.width`、`camH = camW * VIEW_H/VIEW_W`）：
```
当前帧镜头中心 = { x: kf.panX + camW/2, y: kf.panY + camH/2 }
delta = { x: ax - 相机中心.x, y: ay - 相机中心.y }
所有关键帧: panX += delta.x, panY += delta.y
```
选中帧镜头中心即对准锚点，其余帧同 delta 平移，**相对轨迹不变**。
**要点**：
1. `applyCenterMigration` 首参放 `dom`（本文件惯例），函数体内要用 `dom`/`stateRef`。
2. **`pickAnchor` 与「添加参照物」互斥**：预览 canvas 单一点击入口，`onclick` 先判 `pickAnchor`，true 只做锚点拾取并 `return`，不进 `refs.push`。
3. `pickAnchor` 复位路径：`showCinematicsBoard`（进出）、`cinematicSelect.onchange`、`cinematicNew.onclick`、`deleteCurrent`。
4. **新增 `#cinematicSetAnchor` 必须进 `src/ui.js` 的 `ids` 数组**（getDom 校验，缺即 Missing DOM elements）。
5. 纯编辑器、不落盘新字段——迁移只改关键帧 `panX/panY` 值；运行时仍由 `focusTarget:'boss'`（`_resolveFocusTarget`）覆盖为真实坐标；`asar: false`（`:26`）是故意的（server.js 要读真实文件）。改成 true 会让 `path.join(__dirname, '..', 'dist')` 之类的路径失效。
6. 验证：`npm run pack`（= `vite build && electron-builder --win`，产物 `release/`，target `portable`）。快速验证不打包也行：`npm run build && npm run electron`（`app.isPackaged` 为 false 时会回退项目 `data/`）。
7. 配套离线预览页 `docs/cinematic-preview.html`（**单文件零依赖** Canvas2D，653 行）：1:1 复刻运行时相机数学（`screen = R(-rot)·(world−camCenterWorld)·z + viewportCenter`，`camCenterWorld = scroll + camW/(2z)`）与叠层顺序，含 A/B（新 3400ms vs 旧 4450ms 方案）对比、播放/暂停/进度条/关键帧刻度/实时参数面板、页内自检徽章（200 随机点误差 < 0.5px 显 PASS）。**改运镜相机数学/叠层顺序时同步它**（`worldToScreen`/`camParams` 的单一真源在 `cinematics-board.js`）。
### 6.7 新增一张策划表 → 供游戏读取
以「再导一张 `策划文档/server/xxx.xlsx` 给前端用」为例（现有 inner-shop 链路即此范式）：
1. `tools/export-tables.mjs` 加 `SHEET_XXX = { file:'xxx.xlsx', sheet:'页签名', headerKey:'某中文列名' }` + `export async function parseXxx(dir)`（`loadSheet` → `findHeaderRow` → `buildColumnMap` → 逐行读）。**跳表头**：有编号列用「编号是数字」，无编号列用「某数值列必须是数值」。**空行终止**：连续 `BLANK_ROW_STOP(5)` 行无有效数据即停。结果并进 `buildInnerShop` 或另开 `buildXxx`。
2. `server.js` 加路由：仿 `:175 getInnerShop` —— `tableMtimeKey()` 做缓存键 + `await import('./tools/export-tables.mjs')` **动态 import** + `try/catch` 回退 JSON / 空骨架（**永不 500**）；分支写法 `if (parts[1] === 'xxx' && req.method === 'GET')`。
3. `src/api.js` 加取数封装（`export const getXxx = () => get('/xxx');`）。
4. 打包：`package.json` 的 `build` / `pack` 前置 `node tools/export-tables.mjs`（已有则自动覆盖新表），并在 `build.extraResources` 加 `{ "from":"data/xxx.json","to":"data/xxx.json" }`。**`tools/` 与 `exceljs` 不进 `build.files`**（见 §4.12 设计意图）。
5. 前端消费：新增纯逻辑模块（如 `economy/xxx.js`）做 `loadXxx` 缓存 + Promise 去重，mixin 里异步取数；注意 `~$xxx.xlsx` 是 Excel 锁文件，导表要忽略。
6. **若新表需引用项目内资源**（如武器 / 美术 / 物品）：在 parse 阶段建「资源名 → 项目 id」索引并写进产物字段（范本：`loadWeaponNameIndex()` 读 `data/weapons/*.json` 按 `name` 建映射，`buildInnerShop` 落成 `weapons[].weaponId`）；同时给出**空值语义**（匹配不到写 `""` 而非抛错）。运行期只做兜底反查、不作首选（见 §7 坑 39）。
7. 验证：`node tools/export-tables.mjs` 重跑幂等 + `GET /api/xxx` 断言 200 与条数 + 临时改名 xlsx 验证回退路径（见 §8）。
> **只有「数值会变且非算法参数」的清单才值得建表**；算法常量（次数上限、动画时长）留在代码里。数据契约与数值含义要同步写进对应分类 skill（inner-shop 的契约在 `economy-numbers` skill §3.3/§5）。

## 7. 坑与约束
1. **mixin 同名覆盖与装配顺序**。`game-scene.js:902`（`Object.assign(EditorScene.prototype, ...)`）按固定顺序装 **25** 个 mixin：`EnemyAi, Boss25T5, PlayerCombat, Destructibles, Pet, Spawning, Triggers, Interactables, LevelFlow, Hud, UiRuntime, Screens, SaveLogin, NewbeeHub, Workshop, Drops, Progression, InnerShop, RunItems, BattleItems, EditorInput, EditorCamera, WorldRender, WorldOverlay, Minimap`（本轮新增 `RunItemsMixin`/`BattleItemsMixin`，紧随 `InnerShopMixin`）。**后者覆盖前者同名方法**，编辑器四件套（EditorInput / EditorCamera / WorldRender / WorldOverlay）排在最后，所以它们的同名方法总是赢。加新方法前先确认全仓无同名，否则静默覆盖、vite build 不报错。
2. **`const ctx = this.ctx;` 约定**。mixin 里任何访问注入 `ctx` 的方法，**首行必须写** `const ctx = this.ctx;`（看 `editor-input.js:13/193/238`、`editor-camera.js:13/19/90` 的缩进风格——就是这么写的）。漏写会在运行时抛 `ReferenceError: ctx is not defined`，而 `vite build` 检测不到（模块作用域没有 `ctx`，但 ESM 只在执行时才报）。`applyWorldBounds`/`clampEditorView`/`resetEditorCamera` 等不访问 ctx 的方法就不写。
3. **场景 ctx 与编辑器 ctx 同名不同物**。见 3.4。典型错误：在 mixin 里写 `ctx.dom.xxx`（场景 ctx 没有 `dom`，必然 undefined）；或在面板文件里写 `ctx.redraw()`（编辑器 ctx 没有 `redraw`，要用 `ctx.hooks.redraw()`）。`editor-camera.js:44 showZoom()` 之所以用 `document.getElementById('zoomInfo')` 而不是 `ctx.dom`，正是这个原因。
4. **`ctx.hooks` 是运行时后绑，且 7 个调用点全是裸调用**（`entity-properties.js:41/426`、`history.js:31/83`、`room-panel.js:29`、`level-flow.js:95/96/97/105`）。任何**不经过 `src/main.js`** 的入口（单测直接 `import` 面板模块、Node 环境跑 `entity-properties.js`、打包端的 `initializePackaged` 早于注册的假设）调到这些函数会 `TypeError: ctx.hooks.redraw is not a function`。相比之下场景注入 ctx 的回调调用点**几乎全用 `?.()`**（`onSwitchLevel` / `onExitPreview` / `onStartNew` / `onListSaves` / `onSelectSave` / `onOpenLevel` / `onSettings` / `onPlayerSave` / `pushUndo` / `redraw?.`），唯一裸调用的是 `game-scene.js:73` 和 `editor-input.js:189/234` 的 `ctx.redraw()`。要给面板写单测就得先手动填 `ctx.hooks`。
5. **`const { state } = ctx;` 是解构快照**。`bindings.js:22`、`history.js:12`、`level-flow.js:22`、`entity-properties.js:14`、`room-panel.js:14`、`drop-rules-panel.js:13`、`player-panels.js:14`、`save-flow.js:15`、`packaged.js:14`、`main.js:12` —— **10 个文件**在模块顶层这么写。含义：这些模块持有的是 `ctx.state` 的**旧引用**。现在没问题（全仓从不整体替换 `ctx.state`，只替换 `state.level`），但**将来若要做「重置整个 state」，必须改成到处 `ctx.state.` 访问**，否则一半模块指向旧 state，症状是「面板显示和画布不一致」。同理 `main.js:12` 还解构了 `PACKAGED`（这个是常量，安全）。
6. **试玩快照机制**。见 4.6。三条硬规则：进游戏前必存 `ctx.editorSnapshot`；退出必走 `restoreEditorSnapshot()`；`state.saveStore` 必须复位 `'formal'`。另外 `redraw()`（`level-flow.js:63`）只在 `mode === 'editor'` 落盘——**别去掉这个判断**，否则试玩时的鼠标射击会不停把游戏中的关卡状态写进关卡文件。
7. **事件类型枚举在两处独立维护**（实测确认）：
   - `src/state.js:219` `export const EVENT_TYPES = ['complete','roomComplete','combat','spawnEnemy','switchLevel','spawnGate','removeGate','bossBattle']`（`:244` 用它过滤非法类型）；`src/editor/entity-properties.js:79-87` `eventTypeOptions` 硬编码同一组 8 项（带中文标签，含 `['bossBattle','BOSS战斗']`），透过 `hooks.renderTriggerEvents` 传给 `trigger-panel.js:128` 渲染下拉。
   **新增事件类型必须改这两处**：只改 `state.js` → 下拉里选不到；只改 `entity-properties.js` → 能选但 `normalizeTrigger` 把它过滤成 null，保存后消失。类似的双份枚举还有：能量门默认色（`constants.js:81-82` vs `state.js:418-419`）、`state.ui` 的键（`state.js:495` 4 个 vs `packaged.js:19` 5 个）。
9. **母舰 Boss 面板字段**：敌人分支（`entity-properties.js` 母舰时）额外渲染 `artScale`(大小) / `boss.spawnInterval`(召唤间隔ms) / `bossSpawnText`(召唤表，文本 `type*count,...`，绑定解析回 `boss.spawnTable`)。`bossBattle` 事件双份枚举见上文；Boss 运行时字段/数据契约见 `combat` skill ⑦ 与 `level-design` skill 的 Boss 战说明。
8. **DOM id 必须与 index.html 一致**。`src/ui.js:6-54` 的 `ids` 数组有 **231 个 id**，`getDom()`（`:56`）会校验并对缺失项 `throw new Error('Missing DOM elements: ...')` —— 直接白屏（`main.js:77` 会把错误写进 body）。加控件顺序：先 `index.html` 加元素 → 再 `ui.js` 的 `ids` 加 id → 再 `bindings.js` 接线。带中划线的 id（`entity-properties` / `entity-title` / `entity-fields`）在 `:30-32` 有驼峰别名，用别名访问。
9. **Phaser 4 相机语义**（代码注释里反复强调，`editor-camera.js:71`、`:109`）：`cam.scrollX` 是**视口左上角的世界坐标**，且**不随 zoom 缩放**。所以居中玩家写 `scrollX = player.x - cam.width/2`（**不是** `- cam.width/2/zoom`）；而「可见世界尺寸」要写 `cam.width / zoom`（`:110-111`）。Phaser 3 的写法搬过来会出现「缩放后镜头偏移」。`onWheel` 里的锚点缩放也依赖这套语义（`:146-154`，含 `originX/originY` 折算）。
10. **`server.js` 是开发用简易服务**。手写 http + 手写 MIME 表（`:47`）+ 无鉴权 + 异常统一吞成 404。开发模式内嵌 vite 中间件（`:160-163`），打包模式改为 `serveStatic(dist)`。打包端不落 `data/levels`、`data/ui` 的写（`:96` 注释 + `:172` 403），关卡/UI 是 `resources/data/*` 只读内置资源，可写数据在 `%APPDATA%/arc-engine`。别在 server.js 里加需要长连接/鉴权/上传大文件的东西。
11. **`editor-input.js` 有 11 个未 import 的标识符（既存隐患，实测确认）**：`rotationHandleAt`（:72）、`handleAtRect`（:76）、`backgroundHandleAt`（:84）、`pickTopEntity`（:92/:179）、`resizeBackground`（:229）、`resizeRect`（:231）、`normalizeEnemy`（:140）、`normalizePortal`（:163）、`normalizeCrate`（:171）、`normalizeBarrel`（:173）、`normalizeChest`（:175），另外 `:223-224` 用了 `Phaser.Math.*` 但文件顶部**也没有 `import Phaser`**。文件只 import 了 `CELL` / `snap` / `DEFAULT_WALL_COLOR`。`vite build` 通过（60 modules），因为这些是运行时才解析的自由变量。**结论**：这条代码路径（编辑器点击画布）在当前构建下会抛 `ReferenceError`。你若要动 `editor-input.js`，顺手补齐 import：
    `import Phaser from 'phaser'; import { rotationHandleAt, handleAtRect, backgroundHandleAt, pickTopEntity, resizeRect, resizeBackground } from './editor-geometry.js'; import { normalizeEnemy, normalizeCrate, normalizeBarrel, normalizeChest, normalizePortal, DEFAULT_WALL_COLOR } from '../../state.js';`
    补完务必按第 8 章冒烟一遍（build 通过不代表这条路径通）。
12. **`saveDraft === saveFormal`**（`api.js:24`）。「保存草稿」其实直写 `data/levels/`，`data/drafts/` 目录是死数据。所以**编辑器里的任何改动都是即时写正式关卡**，没有「不保存就退出」这回事——这也是 `main.js:69` 固定加载 `level-1` 的原因（避免打开就自动覆盖真实关卡）。写涉及数据安全的需求前先想清楚这点。
13. **`undo()` 会递归**（`history.js:27`）。栈里全是无变化快照时会一路弹到底。因为 `pointerDown` **每次点击都 pushUndo**（包括纯选择），栈里大量重复快照属正常设计。别把这个递归改成循环时忘了终止条件（`!prev` 才停）。
14. **框选不存在**。全仓无 marquee / rubber-band / 多选实现，`state.selected` 是单个对象。需求提到「框选」= 新功能，要在 `pointerDown/pointerMove/pointerUp` 加状态机 + `world-render` 加选框绘制 + `state.selected` 改成数组（后者会波及 `entity-properties.js`、`history.js`、`world-render.js` 十几处 `=== ctx.state.selected` 判定，成本很高，先和需求方确认）。
15. **`server.js` 里别用和函数同名的局部变量**。给 `/api/assets` 加列表接口时踩过：`let list = []` 会把同作用域的 `async function list(kind)` 遮蔽，`list('assets')` 变成把数组当函数调用 → TypeError 被外层 `try{}catch{}` 吞掉 → 接口**不报错但永远返回空数组**（症状极隐蔽：`POST` 成功、`GET /api/assets/:id` 能读回、但 `GET /api/assets` 列表为空）。命名用 `names`/`items` 等避开。同理小心 `file` / `body` / `json` 这几个 server 内高层函数名别被局部变量遮蔽。
16. **画板工作台走 `body.artboard-mode`，别接 `state.mode`**。画板是独立页（纯 Canvas），不进 `EditorScene`，因此**不依赖** `this.editing` / `setMode()` / `state.mode` 三态。反例误用：想用 `mode = 'artboard'` 切场景 —— 会触发 setMode 的 destroy+重建游戏实例，画板反而进不来。它和「UI 配置页」同理，靠 body class 接管显示；新增 DOM id 必须同步 `src/ui.js` 的 `ids` 数组，否则 `getDom()` 直接 throw `Missing DOM elements`。
17. **画板/独立画板的 Ctrl+Z 与编辑器关卡撤销共用 document keydown，按场景早退而不是互相挡**。两个监听器都在 `document` 上，注册顺序决定谁先跑；`stopImmediatePropagation` 只能拦比我后注册的，拦不住先注册的（`bindings.js` 里先装）。现行做法：`bindings.js` 编辑器撤销分支前 `if (document.body.classList.contains('artboard-mode')) return;`（画板期间关卡撤销整体失效）+ 独立画板 `draw-board.js` 的 document keydown **首行 `if (!isDrawBoardOpen()) return;`**（只在本弹层打开时接管 Ctrl+C/V 复制粘贴、Ctrl+Z、Esc/Enter、箭头整组移动、Delete 整组删；旧的 `stopImmediatePropagation` 已移除）。凡是要在同一事件上「谁赢」的需求，优先考虑在各 handler 内部按场景早退，而不是依赖事件传播顺序。
18. **武器/画板工作台共用 3 个高频坑（都踩过）**：
   - **画板矢量组编辑器每个字段输入必须带 `data-index`**：`bindShapeInput` 靠 `e.target.dataset.index` 定位元素，`shapeFieldEdit`/`miniField` 生成的半径/颜色/粗细/相位/闭合等**默认没带**，修改会因 `idx===undefined` 直接 return（值没写入、预览不变）。加元素时把下标 `i` 贯穿进每个 `miniField(...)` 与闭合复选框。症状极隐蔽：形状 select（带了 index）能换、其余字段全「改不动」；**`normalizeXxx` 返回新对象 → 绑定处理器捕获的 `group` 会变僵尸**：`bindShapeGroup` 的「+添加/导入」若在绑定时 `const group = getPath(design, groupKey)` 捕获，之后 `normalizeWeaponDesign(design)` 整体换新对象，旧 `group` 脱离当前 design，添加/导入写进孤对象 → 预览看不到。**必须在 handler 调用时重新 `getPath(design, groupKey)`**。
   - **`<input type=number value="Infinity">` 报 `The specified value "Infinity" cannot be parsed`**：`maxAmmo` 等可为 `Infinity` 的数值字段直接 `value="${val}"` 会触发 number 输入框 DOM 异常。显示时把 `Infinity` 归一化显示为 `0`（保存仍按 0=∞ 处理）；**`player-data` 别 import 战斗表/Phaser**：为读武器改件上限若 `import { WEAPONS } from './systems/combat/weapons.js'` 会拖入 Phaser，导致 node 单测 `import '../src/player-data.js'` 直接加载失败（Phaser ESM 无法在纯 node 解析）。改用**无 Phaser 的数据模块**（`weapon-caps.js`）同步存 caps，`weapon-store.registerWeapon` 写入，`normalizeWeaponMods`/`activeMods` 读取。
19. **内置 yellow/green 由启动注册的设计稿驱动，不再硬编码在战斗表**。`combat/weapons.js` 的 `WEAPONS` 字面量**只剩 `radial`/`basic`**（yellow/green 已删），运行时的 yellow/green 靠启动 `registerBuiltinWeapons()` 从 `buildBuiltinWeaponDesigns()`（id=`yellow`/`green`、名称「散射/激光」）注册进 `WEAPONS`。`state.js` 的 `WEAPON_TYPES` 也因此仅剩 `['radial']`——**别再往这两处硬编码 yellow/green**，否则存档/加载/工坊/掉落会出现「目录里认得、战斗表里没有」或反过来。武器目录查询统一用 `weapon-registry.js` 的 `weaponCatalog()`（要新增武器 id 就叫 `registerWeaponId()` 或经 `registerWeapon`）/`isKnownWeapon()`（`state.js:5` 已 import，`normalizeWeapons` 与 charge 掉落的 `weapon` 过滤都用它）。**打包端无 `/api/weapons` 服务器**，所以内置武器必须靠 `main.js` 模块顶层（任何 `normalizePlayer()` 之前）的 `registerBuiltinWeapons()` 副作用注册，不能只依赖 `loadWeaponDefs()` 拉接口。
20. **stroke 元素的 orbitRadius 是「双模式」语义，改渲染/命中必须两模式都测**：`=0` 时保持旧行为（点相对设计圆心自转，旧设计稿全走这条，渲染零变化）；`>0` 时点集先平移到重心、绕重心自转，重心沿 `ga` 方向挂在 `orbitRadius*s` 轨道上公转。`asset-render.js` 的 `renderAsset` stroke 分支与 `elementCenter` stroke 分支**必须同步改**，漏一处则主画板手柄/命中错位。
21. **artboard.js 与 draw-board.js 单向依赖**：`artboard → draw-board`（`openDrawBoard` 接线）；`draw-board.js` **自含** `canvasPoint/pivot`，不 import artboard.js，防止回环与耦合。独立画板事件绑定用模块级 `bound` 标志防重复 addEventListener（artboard 页可能多次进出）。`openDrawBoard(dom, design, hooks)` 的 hooks = `{ getSelectedIndex, onDone, onSaved }`，完成回写用 `design.elements[index]` 现取（坑 18 同源）。
22. **`server.js` 所有 JSON 响应带 `Cache-Control: no-store`**（json() 统一设置）：编辑期资产（轮廓/设计稿/武器）改完立读，若新响应端点**必须复用 json()** 或自带 no-store，否则 Chromium 启发式缓存会让「保存后再拉取」读到旧数据（画板轮廓库曾因此疑似缓存 bug）。
23. **`test/player-api.test.js` 的 round-trip 用例字段过期**（既有问题，非本轮引入）：用例还在断言 `loaded.mods`，而 `normalizePlayer` 早已把 mods 迁移为 `loadout`/`equipment`（输出键无 mods）。基线「5 fail 全 fetch failed」是因为 5173 没起服断言从未执行；**起服状态下该用例会以断言失败暴露**（19 pass / 1 fail）。改测试或改 schema 时二选一同步，别误判为新回归。
24. **内置武器同名磁盘副本会被 `ensureWeaponDef` 缓存短路遮蔽**（真实踩过，症状=编辑器保存了 yellow 的改动、刷新后被重置回初始）：`main.js` 在模块顶层先 `registerBuiltinWeapons()` 把默认 yellow/green `set` 进 `designCache`，随后 `loadWeaponDefs()` 若用 `ensureWeaponDef(id)` 拉盘，会对已缓存的 builtin id **命中缓存直接 return、永不读 `/api/weapons/:id`**，于是用户保存到磁盘的黄色/绿色改动被内置默认值盖住。**正确做法**：`loadWeaponDefs()` 必须逐个 `loadWeapon(id).then(registerWeapon)` 直拉盘强制覆盖缓存（`weapon-store.js` 已改）；`ensureWeaponDef`/`ensureWeaponDefs` 仍可用于「无磁盘副本时补注册」的懒加载路径。判据：任何「内置 + 可编辑落盘」的注册资源，**启动加载逻辑不得走命中即返回的缓存优先**，否则改名/改数保存后刷新即失效。等价的坑：`weapon-board` 武器下拉的「载入」由 `ensureWeaponDef` 兜底——若已有注册缓存则读缓存，未曾注册才拉盘。
25. **形状删除按钮只挂了容器 `input` 事件，`<button>` 点击不触发 `input`**（真实踩过，症状=画板矢量里点「删除」无反应）：`weapon-board.js` 的 `renderShapeGroup` 生成 `<button class="art-element-del" data-del="${i}">删除</button>`，但 `bindShapeGroup` 只给容器绑 `el.addEventListener('input', ...)`，`bindShapeInput` 里虽写了 `t.dataset.del` 分支，**按钮的 `click` 永远不派发 `input`**，故删除对任何形状（含新增的圆弧）都不生效。**正确做法**：给 `.art-element-del` 单独绑 `click`（参考 `artboard.js:279` 的 `.onclick`），并在 handler 内 `stopPropagation()`、`getPath(design, groupKey)` 现取（防坑 18 僵尸引用）。同理：**画布外的 DOM 按钮一律用 `click`，别想复用容器的 `input`/`change` 监听**。
26. **`buildPolyline` 对多连通分量/孤立点会退化为 `points.slice()` 原始顺序 → 保存轮廓读回成「一堆连线」**（真实踩过，症状=保存提示成功但重新载入画板散乱）。旧实现只沿「起点度数=0 唯一链」走，走不完（双份环/孤立点/分叉）就整体回退 `points.slice()`，把分离点按添加顺序串满 → 自交网。**正确做法**（`draw-board.js` 已改）：① `buildPolyline`（`polylineSeq` 取下标）按**连通分量贪心串接 + 孤立点补尾**，永不再退化为原始顺序；② **要「保存/导入数据完全相同」就必须连边一起存**——`outline.edges`（点序下标对，`normalizeOutline` 保留）＋点取遍历序，读回按 `edges` 精确还原 `drawEdges`；仅靠 `points` + `rebuildFullEdges` 顺序重构会丢多分量/孤立点，无法无损。点存遍历序、边重映射到该序，使 `artboard` 单笔 stroke 与 draw-board 双消费都正确；已居中（重心≈0）不再减重心避免浮点漂移，保证保存→导入→再保存逐位一致。判据：凡「点集 + 边」要压成单一折线的地方（保存/回读/写回 stroke），必须处理分量拆分，且要无损就得连边一起存。
27. **弹道随机颜色合集「只能加 1 种颜色」**（真实踩过，症状=点「＋添加颜色」永远只有 1 个 chip，加不进去第二种）：`weapon-board.js` 的 `renderPaletteEdit` 添加按钮**每次都 push 固定色 `#ffa914`**，而 `normalizePalette`（`weapon-design.js`）会**去重**——第一次添加后合集里已有 `#ffa914`，再点又被去重丢弃 → 长度恒为 1。**正确做法**：添加时取一个当前合集「尚未存在」的颜色——优先从候选色板 `PALETTE_CANDIDATES` 挑第一个没用的，全用尽再随机生成新色相（`nextPaletteColor`，weapon-board.js 已改）。判据：凡 `normalizeXxx` 参与去重/裁剪的数组，添加按钮**不能 push 固定值**，必须 push 一个经归一化后不被丢弃的元素。
28. **弹道撞墙直接销毁，绕过 `fadeDuration` 渐隐**（真实踩过，症状=配了消失时长的子弹打墙瞬间消失、没有渐隐）：`game-scene.js` 子弹 filter 里撞墙（`l.walls`/`activeGateWalls`）后 `hit=true`，末尾 `return !b.dead && !hit && ...` 直接把子弹过滤销毁，完全不看 `b.fadeDuration`。**正确做法**（已改）：撞墙且 `b.fadeDuration>0` 时置 `b.wallFade=true` 并 `return true` 保留，`stepBullet` 对 `wallFade` 走与 range 渐隐同一套「停驻+按 fadeDuration 递减 `fade`」逻辑；子弹 filter 顶部对 `wallFade` 子弹**不再前进、不再碰碰撞**，仅调 `stepBullet` 到 `fade<=0` 才 `dead`。判据：凡子弹「到达某条件外应渐隐而非瞬灭」的需求，必须在销毁点对 `fadeDuration>0` 走渐隐分支、且渐隐期间停驻 + 不再做碰撞检测。
29. **像素画板三个协调点**（本批像素功能踩到，都在 `pixel-board.js`/`artboard.js`/`asset-render.js`）：① **新增 `#pixel*`/`#artPixel` DOM id 必须进 `src/ui.js` 的 `ids` 数组**（`getDom()` 逐校验，缺一即白屏 `Missing DOM elements`；顺序：`index.html` 加元素 → `ui.js` 加 id → 接线）。注：这只是「页面缺元素」一面；另一面是**页面有元素但 id 没登记进 `ui.js`** → 报 `Cannot set properties of undefined (setting 'onchange')` 而非 `Missing`，详见坑 32。② **弹层 document keydown 首行 `isPixelBoardOpen()` 早退**（与 draw-board 坑17同源，否则按 Ctrl+Z/C/V 误触关卡撤销/与轮廓弹层冲突）。③ **pixel 元素缩放必须改 `cellSize` 而非缩放格坐标**（`cells` 是整数格索引，网格几何中心在 `cols/2, rows/2`；若仿 stroke 缩放 `startCx/startCy` 会偏心 + 格索引变小数 → 像素错位出锯齿；正确做法 `pixel-scale` 只改 `startCellSize*k`，`cols/rows/cells` 不变，像素始终对齐网格）。④ **pixel 写回网格线必须读 `showGrid` 开关（`el.gridColor = showGrid ? gridColor : null`），不能用 `gridColor` 常量**（真实踩过，症状=画板里关了「显示网格线」但保存/重载后像素画仍带网格线：`buildPixelElement` 之前写 `gridColor: gridColor || null` 恒非空；改成 `showGrid ? gridColor : null`，asset-render `hasGrid=!!gridColor` 即为 false 不描网格；编辑已有元素时 `showGrid` 初始化用 `!!el.gridColor`）。
30. **运镜期间必须让 `updatePlayCamera` 让权 + 结束后恢复相机，且运镜只在 play/trial 生效**。① **让权**：`editor-camera.js` 的 `updatePlayCamera` 是每帧驱动播放相机的函数，运镜播放时若不同时插值会被它覆写 → **必须在函数最前（`const ctx=this.ctx;` 之后、`const cam=...` 之前）加 `if (this.cinematicActive) return;`**，否则运镜被每帧重置、看不到效果。② **结束恢复**：`stopCutscene` 里 `cinematicActive=false` + `cam.setRotation(0)`（清除运镜旋转，Phaser 相机不会自动回零）+ 调 `setupPlayCamera()` 让相机回到播放态（deadzone/center/menu 重新接管）。③ **只在 play/trial 生效**：`playCutscene` 首部 `if (this.editing) { console.warn(...); return; }`——编辑器模式下用户是正在配时间轴，不应被运镜带走；运镜数据由 `state.level.cinematics` 驱动，编辑器 UI 用 canvas 自绘预览，不依赖相机引擎。**判据**：任何「临时接管相机然后交还」的逻辑，都必须同时做「接管期间让 update 让权」+「交还时恢复状态」两件事，否则要么看不到效果，要么运镜结束后相机卡死在运镜末帧。
31. **运镜动态焦点 ≠ 关键帧 pan 的简单平移，且慢动作只作用于世界 dt，编辑器与运行时 panX/panY 语义不同**。① **动态焦点**：关键帧 `panX/panY` 是「视口左上角世界坐标」，但用户语义是「镜头中心对准某点」。运行时 `playCutsceneById(id,{ focusTarget, x, y })`：`_resolveFocusTarget` 取 `opts.x/y`（直接坐标）优先，再 `focusTarget==='boss'` 取 `this.bossTarget`/激活母舰。**有 `cinematicFocus` 时 `_applyCutsceneState` 必须做 `panX = focus.x - cam.width/2` 换算**，否则镜头会偏半屏。**判据**：凡「运镜瞄准非固定点」的需求，必须在 `_resolveFocusTarget` 里区分「直接坐标」与「具名参考物（boss）」，且换算只发生在 `_applyCutsceneState`（勿改关键帧存储的 pan）。② **慢动作**：`clip.timeScale` → `cinematicTimeScale`，在 `game-scene.js:142 update` 开头 `dt *= slowmo`（仅 <1 才缩）——**只缩放走 `dt` 的世界模拟（玩家/敌人/子弹/特效），不影响运镜相机推进**（运镜走 `this.time.addEvent` 真实时间）。**判据**：慢动作放对地方（update 的 dt），别误放 `this.time.timeScale`（会影响运镜计时器本身）。③ **编辑器 vs 运行时 `panX/panY` 语义已统一为「视口左上角世界坐标」**：编辑器 `camParams`（`cinematics-board.js`）`camCenterWorld = { panX + camW/2, panY + camH/2 }`，与运行时（`editor-camera.js`）的 `panX = cam.scrollX`（**视口左上角**）同源；有焦点目标时 `_applyCutsceneState` 覆盖为 `focus.x - cam.width/2`。§6.6「锚定中心」工具已改用该模型（**旧「`worldW/2 + panX` 相对世界中心偏移」口径已作废**），`screenToWorld`/`drawAnchorHint`/`applyCenterMigration` 三处同步改过。
32. **新增 DOM id 漏注册进 `src/ui.js` 的 `ids` → `Cannot set properties of undefined (setting 'onchange')`，且**不会**报 `Missing DOM elements`**（真实踩过：`cinematics-board.js` 加慢动作 `#cinematicTimeScale`，`index.html` 有元素、`ui.js` 的 `ids` 却漏登记，于是 `dom.cinematicTimeScale` 是 `undefined`，`initCinematicsBoard` 里 `dom.cinematicTimeScale.onchange` 直接抛错、编辑器白屏「初始化失败」）。**关键区分**：坑 16/29 讲的是「`index.html` 缺元素 → `getDom()` throw `Missing DOM elements`」；这次是**反过来的第三种**——`index.html` 有元素、但 **id 没登记进 `ui.js` 的 `ids` 数组**，`getDom()` 不会校验没登记过的 id，所以不 throw `Missing`，而是等你代码里某处 `dom.xxx.onchange/onclick` 才因 `undefined` 炸。**排查法**：报 `Cannot set properties of undefined (setting 'xxx')` → 立即查 `src/ui.js` 的 `ids` 数组是否登记了该 id，而非查 `index.html`（index.html 大概率有）。**三处同步**（漏任何一处都崩）：① `index.html` 加 `id="xxx"` 元素；② `src/ui.js` 的 `ids` 数组加 `'xxx'`（getDom 逐项取 `getElementById`，登记了才校验存在——**反过来没登记就不校验，只在你用它的地方炸**）；③ `bindings.js`（或对应模块 `initXxx`）接线。**判据**：凡报「初始化失败 / 白屏」且错误是**属性访问 undefined**，先怀疑 `ui.js` `ids` 漏登记，再怀疑 `index.html` 缺元素；两者症状不同，别只找「页面缺元素」。
33. **BOSS 属性面板字段名必须与「运行时读取路径」逐字一致，且该路径要能穿过 `normalizeEnemy` 不丢键（已踩过）**：`boss-2-5t5` 的「被击败运镜 id」最初写成**顶层** `cutsceneId`（`setNested(entity,'cutsceneId',…)` 写 `e.cutsceneId`），而运行时 `enemy-ai.js:defeatEnemy` 读 `e.bossCfg.cutsceneId`（= `e.boss.cutsceneId`）；更致命的是 `state.js:normalizeEnemy` 对 `boss-2-5t5` 只回传 `boss` 对象，**顶层 `cutsceneId` 在落盘→读回时被静默丢弃** → 面板配的击破运镜既不生效、重开后也丢失，且**全链路无任何报错**。**遗留**：无（母舰的顶层 `cutsceneId` 已在 `state.js:normalizeEnemy` 补保留，见下）。**两处修复**：①`boss-2-5t5` 字段改为 `boss.cutsceneId`（`entity-properties.js` 的 `boss-2-5t5` 分支尾部），与运行时读取路径对齐（`normalizeBoss25T5Config` 保留字符串键 `cutsceneId`）②`state.js:normalizeEnemy` 输出补 `cutsceneId: (typeof enemy?.cutsceneId === 'string' ? enemy.cutsceneId : '')`，使母舰的顶层路径也能穿过落盘→读回；`enemy-ai.js:defeatEnemy` 对 `boss-2-5t5` 改为 `e.bossCfg?.cutsceneId || e.cutsceneId`（手写关卡顶层也能生效）。**判据**：新增 BOSS 面板字段时，先确认 ①运行时读哪个路径（`e.xxx` 还是 `e.bossCfg.xxx`）②该路径是否被 `state.js:normalizeEnemy` 的对应分支保留，两者缺一字段就"能配不生效"。
34. **mxGraph 线框导入的 5 个坑**（斜线全丢 / 圆角矩形变圆 / 三角形变矩形 / 白色变黑 / rotation 反向；本轮一次性修复，都在设计稿页）：
   - **现象 A**：draw.io 里画的斜线（`edge=1` 的 mxCell，几何是 `mxPoint as="sourcePoint"/"targetPoint"`，或连在两个顶点上）粘贴到「设计稿 → 导入」后**一条都不出来**，控件数少一半；**根因 A**：`parseMxGraph` 循环首行 `if (isEdge) continue;` 把连线整体跳过。**正确做法**：连线单独解析成 `{shape:'line', x/y/w/h=折线包围盒, points:[相对 bbox 原点的折线顶点]}`；端点三种来源按序兜底 —— 游离 `mxPoint[as=sourcePoint/targetPoint]` → 所连顶点(`source`/`target`)的 `exitX/exitY`(`entryX/entryY`) 比例点 → 顶点中心；`Array as="points"` 作中间折点；两端都定位不到才丢弃。渲染侧三处配套：`drawShape` 加 line 分支（只描边不填充）、`computeView` 跳过 `line`（否则一条长斜线的包围盒会被当成背景把视图缩飞）、命中检测改「点到线段距离」（细线若用包围盒会点中一大片空白）。**`points` 必须存相对 bbox 原点的偏移**，否则拖动时 `s.x/s.y` 变了而点没动，线立刻脱位。
   - **现象 B**：15×15 的圆角矩形（`rounded=1`，draw.io 缺省 arcSize=15%）在画布上**显示成整圆**（`docs/ui-designs/ui-battle-12.json` 里 15×15 的「消耗品槽」就是这例）；**根因 B**：`drawShape` 圆角半径写死 `Math.min(8 * sc, W / 2, H / 2)`，小尺寸时被 `W / 2` 夹住 → 半径 = 半边长 = 全圆。**正确做法**（`cornerRadius`）：百分比模式取 `arcSize`%（缺省 15，夹到 ≤50）× `min(W,H)`；`absoluteArcSize=1` 时 `arcSize` 直接是设计单位 × `sc`；最后仍夹到半边。**判据**：凡「本应随尺寸变化的视觉参数」都不要写成固定像素再夹到半边长，必然在小尺寸退化成极端形状。
   - **C 三角形画成矩形**。现象：draw.io 的三角形（`triangle;...` 或 `shape=triangle`，常见 `rotation=-90` 旋转成箭头）导入后是个**同色矩形**。根因：`drawShape` 只认 `rect/rounded/ellipse/rhombus/text`，未知 `shape` 全部落到 `else → ctx.rect`。**正确做法**：补 `triangle` 分支，按 mxTriangle 几何 —— 默认顶点朝东（`(X+W,cy)`,`(X,Y)`,`(X,Y+H)`），`direction=north/south/west` 改朝向。同理 `parallelogram`（`ui-smalllevel.json` 有 3 个）曾回落矩形，已按 stencil 补：上下边水平、左右边右倾，倾斜量取 style 的 `size`（设计单位，缺省 20，夹到 `W/2`）；`fixedSize=1` 视为绝对值（mxGraph 语义），若视觉偏斜过多就改按 `size/100 × W` 的相对口径。**其余未知 shape 仍回落矩形**，需要哪个补哪个。
   - **D 白色圆形变黑**。现象：draw.io 里的白色圆形导入后是**黑色**。根因：新版 draw.io 把颜色写成 `fillColor=light-dark(#FFFFFF,#000000)`，`styleValue` 原样取出这串 → 赋给 `ctx.fillStyle` 被浏览器判非法**静默忽略**，canvas 保持上一次（默认黑）→ 白变黑。**正确做法**：颜色统一过 `colorValue()`：`light-dark(#浅,#深)` 取浅色分支；仍不合法（`var(...)`、`bad-value()` 等）回落 mxGraph 默认色，绝不把非法串交给 canvas。**判据**：任何「解析出来的颜色」都要校验后再赋值，canvas 对非法颜色不抛错、会静默沿用旧值。
   - **E `rotation` 符号写反**（同批修）。`ctx.rotate(s.rotation * ...)` —— mxGraph/draw.io 的 `rotation` 正向是**顺时针**，与 canvas `rotate()` 同向，早期代码写的 `-s.rotation` 会把箭头/菱形镜像到反方向（`ui-arrow.json` 的 `rotation=-90` 三角形应指上，负号会指下）。
35. **打包态没有 `策划文档` 目录、`exceljs` 是 devDependency → 必须动态 import + JSON 回退**（现象：`npm run pack` 后启动即崩 / `GET /api/inner-shop` 500）。根因：`server.js` 若在顶层 `import ... from './tools/export-tables.mjs'`，打包态 `tools/` 不在 `build.files` 里、`exceljs` 也未随包 → 模块解析失败。**正确做法**：`server.js:179` 用 `await import('./tools/export-tables.mjs')` 放在 `try` 内，失败回退 `data/inner-shop.json`，再失败返回空骨架；打包链 `build`/`pack` 先跑 `node tools/export-tables.mjs` 并让 `extraResources` 带上 `data/inner-shop.json`。判据：凡「开发期有、打包态没有」的依赖，一律动态 import + 运行时回退。
36. **老虎机表的 Type 表头行「描述」列值是 `Desc` → 只判空会把表头当数据行**（现象：老虎机多导出一类，权重空 / 0）。根因：`parseLottery` 靠 `描述` 列取值，表头行该列文本 `Desc` 非空。**正确做法**：同时要求「直接出货权重」是**有限数值**才收行（`export-tables.mjs:181-184`）；消耗品 / 武器表则用「编号列匹配 `/^\d+$/`」跳表头。判据：跳表头要挑一个「表头行必不满足」的列，别只用「非空」。
37. **消耗品表「描述」列可能为空**（如 `1000004 速度药水`）→ `desc` 要回退「逻辑语言描述（程序不读该字段）」列（`export-tables.mjs:129`），否则商店卡片描述为空。
38. **`~$武器.xlsx` 是 Excel 临时锁文件** → 导表与服务端解析都必须忽略（`TABLE_FILES` 只列三份正式表）；表被 Excel 占用时 `readFile` 可能失败，因此开发期解析失败**必须有回退路径**（`data/inner-shop.json`），否则策划开着表就把商店页打空。
39. **策划表里是人读的编号，项目里是 id，两者不同源 → 必须在导表阶段交叉引用并落成产物字段，运行期只做兜底反查**（踩过：武器表「编号」`101/102/103`，项目武器 id `yellow`/`green`/`weapon-1788012926999`；直接 `getWeaponDef('101')` 为 `undefined`，商品卡只剩背景盘）。**正确做法**：`tools/export-tables.mjs:loadWeaponNameIndex()` 读 `data/weapons/*.json` 的 `name` 建「名 → 项目 id」，`buildInnerShop` 落成 `weapons[].weaponId`；运行期 `inner-shop.js:resolveWeaponId` 仅兜底；UI / 战斗一律 `item.weaponId || item.id`。**空值语义**：匹配不到写 `""`（不抛错）。判据：凡「表里写人读编号 / 项目里用 id」的字段，交叉引用要落在**导表产物**里，别让运行期靠名字猜。（`~$xxx.xlsx` 锁文件 / 表被占用的坑见 38，不重复。）
40. **共用下拉枚举 `DROP_ITEMS`（`state.js:37`）有三处消费**：`editor/drop-rules-panel.js`（敌人掉落规则面板）、`editor/entity-properties.js`（宝箱奖励子编辑器）、`state.js:normalizeDropRules`(121)/`normalizeRewardList`(182) 白名单。新增种类时三处都要能跑通——前两处的下拉会自动出现新选项，但**带子字段的种类（如 `potion` 需要 `potionId`）必须在两个面板各自补一个下拉**（`state.js` 侧只需归一化该子字段）。
41. **编辑器面板里的下拉选项来自运行时的 `/api/inner-shop` 数据**：面板渲染时数据可能还没加载 → 用「模块级 flag 防重入 + `loadInnerShop().then(重渲染)`」补拉一次；不要每帧重渲染。
42. **`select` 的 `input` 事件**在数值分支里会被当成数字写坏 → `potionId` 这种字符串字段必须在 `input` 分支挡住、只在 `change` 分支赋值。
43. **`item` 切换需要重渲染**（`potion` 的子下拉要显隐），重渲染会丢焦点，与既有的「添加/删除」行为一致，未做焦点保持。
44. **`tools/` 与 `exceljs` 有意不进 `build.files`**，只在打包前跑导表；`build`/`pack` 脚本已前置 `node tools/export-tables.mjs`，所以新增表列只要改 `parseConsumables` 就会进 `data/inner-shop.json`（打包回退链详见坑 35）。
45. **临时武器使用中禁止滚轮切武器**（`editor-camera.js:onWheel` 里的 `this.isTempWeaponActive?.()` 守卫）——`onWheel` 同时承担编辑器相机缩放与游戏内武器切换，加守卫时注意别破坏相机分支。
46. **`美术方案类型（局内表现）`/`美术方案名称（局内表现）` 两列是给局内 HUD / 掉落物用的美术方案**：消费侧 `economy/inner-shop.js:getItemArt(c)` 优先取这两列（**两者都非空才用**），否则回退 `美术方案类型（图标）`/`美术方案名称（图标）`。当前表里局内表现 4 行全为空 → 实际都用「图标」列；**策划填了就会自动切过去、无需改代码**（`parseConsumables` 已把它们读成 `artTypeInRun`/`artNameInRun`）。
47. **表头定位靠中文列名**（`findHeaderRow` + `buildColumnMap`），新列加在哪个物理位置都行，但列名必须与代码里的字符串**逐字一致**（含全角括号）。`消耗品.xlsx` 的 `innerItemInfo` 第 3/4 列是空表头，本轮新列（`效果类型`/`效果数值`/`效果时长`）接在第 15 列之后；当前 4 行：1000001 恢复药水(`heal`/25/0)、1000002 力量药水(`attackPower`/25/60)、1000003 即时护盾(`shield`/50/0，即时生效+进老虎机)、1000004 速度药水(`moveSpeed`/25/30)。
48. **`setScrollFactor(0)` ≠ 屏幕空间（运镜叠层必须走 `uiCam`）**。主相机的 `zoomX/zoomY` 与 `rotation` 仍会作用其上（`TransformMatrix.copyWithScrollFactorFrom` 原样复制 a,b,c,d）→ 任何「必须铺满屏幕」的叠层（黑幕/黑边/暗角/闪光/色调）**必须挂屏幕空间相机 `uiCam`**（创建时 `cameras.main.ignore(obj)`，**切勿** `uiCam.ignore(obj)`）。判据：**叠层尺寸写死为视口像素的**，就属于这一类。本次根因：运镜 zoom 最高 **4.2**、rotation 最高 **20°**，挂主相机时 zoom≥2 上下黑边完全移出屏幕、黑幕也盖不住屏（`_ensureCinematicOverlays`/`_createCinematicVignette`/`_applyCinematicOverlays` 已全部改用 `cameras.main.ignore`）。
49. **`playCutscene` 覆盖正在播放的运镜时不回调旧 `onComplete`**（只 `cinematicTimer.remove()`）→ **任何把状态机收尾挂在 `onComplete` 上的流程会永久卡死**。本次症状：母舰贴身秒杀 → `triggerPlayerDefeat` → `mothershipSelfDestruct → defeatEnemy` → BOSS 击破运镜顶掉死亡运镜 → `playerDeathFlow` 卡在 `cinematic` → 结算页永不出现。修法：`enemy-ai.js:defeatEnemy` 里 `if (!this.playerDeathFlow) this.playCutscene(clip, …)` 抑制同帧的 BOSS 运镜。
50. **`stopCutscene` 先置 `cinematicActive=false` 再回调 `onComplete`** → 「运镜已结束但流程还没收尾」的窗口里 `cinematicInputLocked()` 返回 false。**身份类流程锁（如 `playerDeathFlow`）必须自己纳入输入锁条件**，不能只依赖 `cinematicInputLocked()`；否则黑幕里玩家仍能按 F/4/5 打开菜单页把结算页顶掉（`ui-runtime` 的 `menuScreen` 分支优先于结算分支）。`game-scene.js:171` 已改为 `const inputLocked = deathSim || !!this.playerDeathFlow || (this.cinematicInputLocked?.() ?? false);`，并 gate 掉方向键/开火/护盾/`toggleGrowth`/各 `updateXxx(Interact)`/`checkAsyncTriggerEvents`。
51. **Phaser 4.2.1 相机滤镜只在 WebGL 生效**：入口是 `cam.filters.internal.addColorMatrix()`（**`postFX` 是 Phaser 3 的写法，Phaser 4 里不存在**）；但本项目 game config 是 `type: Phaser.CANVAS`（`src/editor/level-flow.js:77`），CanvasRenderer 不消费 `camera.filters` → 挂上去零效果。Canvas 下真实去饱和只能用「中性灰矩形 + `Phaser.BlendModes.SATURATION`」叠加（Canvas2D 混合按源 alpha 加权）；两条探测结果缓存 `_cinematicDesatFX`/`_cinematicDesatBlend`，`stopCutscene` 里复位。
52. **别用 ripgrep 去 `node_modules/phaser` 里找 API**：`node_modules/` 被 `.gitignore` 屏蔽，`grep_search` 会**静默返回「零命中」**，会让你误判「该 API 不存在」。查 Phaser API 用 `findstr` / `type` 直读文件（本次查 `addColorMatrix`/`SATURATION` 时踩到）。

53. **环链的「放大才生成 + 1px 剔除」必须用相机 zoom，不能用固定 scale**（本轮新增）。玩家武器本体的内圈环链只在相机放大到 `WEAPON_RING_CHAIN.minZoom`(1.8) 以上才生成，且「屏幕绝对厚度 = `elementThickness(el) × scale × designScale × chainRefScale(refZoom)`（`refZoom`=3.5 固定、**不是**当帧 zoom）」< `minPx`(1px) 的链环不画、也不占出场时间片。**正确做法**：`screenScale`（只用于 `minZoom` 开关）必须传**相机 zoom** —— 局内 `world-render.js` 调 `drawPlayer(g, this.player, t, { screenScale: this.cameras.main.zoom })`，`entity-art.js:drawPlayer`/`drawHexRingPlayer` 再把它透传给 `renderWeaponBody`/环链逻辑。若误传固定 `scale`（如 1）或漏传：战斗 zoom≈1（蓄力最高 1.6）时会错误生成/保留环链（观感与迭代前不一致），或放大运镜时该出现的环链不出现。HUD / 工坊卡片等 UI 预览传 `opts=null`（静态全显，不参与环链；见 §2 速查表与 `ui-interaction` skill）。**样板是最内侧「描边型」元素而非最内侧元素** —— 散射（三角形外形）的链环必须是三角形，但中心黑色实心三角/实心 20 边形不能当样板（见坑 54）。
54. **`normalizeElement` 会把 `lineWidth:0` 强改成 4 → 「最内侧元素」可能是黑色实心块，环链看不见**（本轮根因，务必先查）。`asset-render.js` 的 `normalizeElement` 用 `lineWidth: clamp(Number(el.lineWidth) || 4, 0.5, 120)`（`:77`；另一处在 `:135`）——数据里的 `lineWidth:0`（实心填充体）被改成 4。于是按「最内侧元素」选样板时：散射（yellow）选到中心黑色实心三角 `r15`、激光（green）选到黑色实心 20 边形 `r4` → 生成的链环是黑色实心块，又恰好被更晚绘制、更大的同形状父元素整块盖住 → 看不到链环。**正确做法**：`innermostElement`（`weapon-ring-chain.js`）样板优先级改为 ①最内侧「描边型」元素（`fill` 为空）→ ②最内侧「有描边宽度」元素 → ③最内侧元素（全填充外形兜底）；`elementThickness` 有描边取 `lineWidth`、无描边取 `radius` 兜底。**判据**：凡「以某元素为样板」的逻辑都不能把「归一化后的 `lineWidth`」当原始数据（`|| 4` 会掩盖真实的 0）。
55. **链环 z 序必须在原有元素之后**（否则被不透明填充体盖住，看起来像「新生成的链环被抹掉」）。`weapon-body.js:renderWeaponBody` 与 `entity-art.js:drawHexRingPlayer`（`drawHexRingPlayer` 链环用**显式 `chain:true` 标记**、不能用半径判断——武器球半径比内环还小）都改成**两趟遍历**：先画全部原有元素、再画链环。原来按外径升序直画时，链环外径最小 → 最先画 → 被后面绘制的不透明填充体（散射中心黑三角内切半径 7.5，链环 extent 3.75/7.13 都在里面）整块盖住。出场计时仍按外径升序的 `item.index`（`drawHexRingPlayer` 里为 `item.revealIndex`），只改 z 序、不动时序。**判据**：凡「向内生成的小元素叠在实心父元素之上」的渲染，绘制顺序必须与原件的不透明性对齐，不能只按几何尺寸排序。
56. **链环厚度剔除的判据必须用固定参考缩放 `refZoom`，不能用当帧 zoom**（否则「生成变慢 + 撕裂」）。用当帧 zoom 时每个链环会在不同时刻依次跨过 `minPx`(1px) 阈值 → 放大过程中环一个接一个冒出来。**正确做法**（`weapon-ring-chain.js:chainRefScale(refZoom = WEAPON_RING_CHAIN.refZoom)`）：`pxFactor = scale × designScale × chainRefScale(opts.refZoom)` 固定，可见集合只由配置决定、与当帧 zoom 无关 —— 相机一旦越过 `minZoom`，该显示的几个环**一次性整体出现**，全程稳定。**实测结论**：散射/激光/禅灭/冥狙/地狱火/普通武器 radial 六个在 zoom ≥ `minZoom` 时都能生成链环；同一武器在 zoom 2 与 zoom 5 的绘制 op 数完全一致（可见集合稳定，不再逐帧级联）；战斗 zoom≈1 时全部不生成。`entity-art.js:drawHexRingPlayer` 的厚度判据同样改用 `chainRefScale()`。

## 8. 验证方式
**1. 构建**
```
npx vite build
```
基线：`✓ 90 modules transformed.`（接线前 86；+4 = 两个新运行时模块 + 因接线才进依赖图的 `run-items.js`/`battle-items-art.js`）无 error；装配 mixin 由 23 → **25**。注意它**检测不出** `const ctx = this.ctx;` 漏写、`ctx.hooks` 未注册、未 import 的自由变量（见坑 11）。
**2. 单测**
```
node --test test/
```
基线 **20 tests / 19 pass / 1 fail**，唯一 fail 是 `test/player-api.test.js` round-trip 里旧 schema 的 `mods` 字段被 `normalizePlayer` 有意丢弃（既有 schema 迁移不一致，非本轮引入）。mixin 同名自检基线 **方法数 285 / 冲突 2**（均为 `if`/`for` 假阳性；较上一轮 +9，`EditorCameraMixin` 由 21 → 26）。**改了 `server.js` 或 `src/api.js` 起服再跑一遍**（表现与上面一致）：
```
node server.js          （另开终端，默认 5173）
node --test test/
```
测试 base 可用 `TEST_API_BASE` 覆盖（`test/player-api.test.js:8`）。
**2b. 导表 / 内购接口**（改了 `tools/export-tables.mjs`、`server.js` 的 inner-shop 分支或 `package.json` 脚本链时）
```
node tools/export-tables.mjs     # 可重跑：除 generatedAt（时间戳）外输出应逐字节一致；打印「消耗品 4 条 / 武器 3 条 / 老虎机 4 类」
node server.js                   # 另开终端
curl http://localhost:5173/api/inner-shop   # 期望 200 + consumables 4 / weapons 3 / lottery.kinds 4，且永不 500
```
- **回退路径**：临时把 `策划文档/server/武器.xlsx` 改名 → 请求应仍 200（走 `data/inner-shop.json`，终端打印 `[inner-shop] 解析策划表格失败，回退…`）；把 `data/inner-shop.json` 也改名 → 应返回空骨架（`consumables:[]`）而非 500。验完改回。
- **交叉引用字段**：重跑导表后断言产物里的交叉引用字段（如 `data/inner-shop.json` 的 `weapons[].weaponId`）**全部非空**；缺资源时**不报错、只留空** `""`（不抛异常）。
**3. 手动冒烟清单**（`node server.js` 后开 `http://localhost:5173`，改任何编辑器代码都过一遍）
1. 页面加载出编辑器面板，状态栏「初始化完成」，右下角 `zoomInfo` 有百分比；控制台无 `Missing DOM elements` / `ReferenceError` / `Cannot set properties of undefined`。
2. **DOM id 三处同步自检**（防坑 32 漏注册）：跑下面脚本，把「代码里 `dom.xxx` 引用」与「`src/ui.js` 的 `ids` 数组」比对，缺即漏注册。注意先确认 `getDom()` 没抛 `Missing`（页面缺元素那面已排除），剩下即坑 32 的漏登记面：
```bash
# node脚本，读某模块引用的 dom.* 与 ui.js ids 比对；缺说明漏注册
node -e "const fs=require('fs');const b=fs.readFileSync('src/editor/xxx-board.js','utf8');const u=fs.readFileSync('src/ui.js','utf8');const used=new Set([...b.matchAll(/dom\.([A-Za-z0-9_]+)/g)].map(m=>m[1]));let d=0;for(const n of used){if(!u.includes(\"'\"+n+\"'\")){console.log('漏注册到 ui.js ids:',n);d++}}console.log(d?d+' 个漏注册':'全部已注册')"
```
2. 关卡下拉切一个有内容的关卡（如 `Level1-Scene1`），画面正常渲染。
3. 拖拽一个墙体 → 松手 → 位置吸附到 30 网格；拖角手柄缩放；拖上方圆手柄旋转（5° 步进）。
4. 选中实体 → 右侧属性面板出现且标题正确 → 改一个数值 → 画布即时变化。
5. `Ctrl+C` / `Ctrl+V` → 出现偏移 40 的副本；`Ctrl+Z` 多次 → 逐步回退且状态栏不报错。
6. 滚轮缩放（应停在 10%~400%）+ 右键/中键拖拽平移，视图不会飞出世界一屏以外。
7. 点「流程试玩」→ 进 login 关卡 → 走一小段/切一次关 → ESC 或点「关卡编辑」退出 → **确认编辑器仍是退出前那个关卡、实体没变、`data/levels/*.json` 未被试玩污染**（可先 `git status` 记录基线）。
8. 点「游戏预览」→ 玩一下 → 退出 → 同样确认关卡数据没变。
9. 点「UI 配置」→ 改一个节点 → 预览画布跟着变 → 「保存」→ `data/ui/*.json` 更新 → 返回关卡编辑。
10. 点「保存关卡」→ 状态栏「正式关卡已保存」；刷新页面后内容仍在。
11. 若改了 icon/上传相关：导入一张背景图（走 `/api/uploads`）+ 可交互图标下拉能列出 `图标/` 目录内容。
12. 若改了画板/轮廓相关：画板 → 「绘制轮廓」→ 加点/选择双模式 + 点选中（拖动/方向键 1px/XY/Delete）→ 插入圆作参考底图与转点 → 整条变换 → 完成写回 stroke；「保存为轮廓」→ `data/outlines/` 落盘 → 主画板「+ 从轮廓库添加」→ stroke 调轨道半径/缩放/旋转手柄均生效。
13. 若改了设计稿页（`ui-mxgraph.js`/`ui-wireframe.js`）：粘贴一段**带斜线 + 圆角矩形 + 三角形 + 白色圆形 + 平行四边形**的 mxGraph XML（斜线 `edge=1` + `mxPoint as="sourcePoint"/"targetPoint"`；圆角矩形 `rounded=1` 且 15×15 见 `docs/ui-designs/ui-battle-12.json`；三角形 + `rotation=-90` + 白色圆形见 `docs/ui-designs/ui-arrow.json`；平行四边形 + `size=` 见 `docs/ui-designs/ui-smalllevel.json`）→ 斜线出现在正确位置（可点选/拖动且端点不脱位）、圆角矩形是**圆角方块而非整圆**、**三角形是三角而非矩形且按 `rotation=-90` 指向正确**、**白色圆形是白色而非黑色**、**平行四边形是斜四边形（倾斜量≈`size` 设计单位）而非矩形**、视图缩放正常（长斜线没被当背景）、保存后重新载入形状数不变。
**4. 打包验证**（仅当改了 `electron/`、`package.json`、`server.js` 的打包分支）
```
npm run pack          （= vite build && electron-builder --win，产物 release/）
```
轻量替代：`npm run build && npm run electron`（`app.isPackaged=false`，回退项目 `data/`，可验证 `?packaged=1` 分支、面板隐藏、只读 403）。检查点：窗口直接进 login 关卡、编辑器面板不出现、尝试写关卡返回 403、存档写到 `%APPDATA%/arc-engine`；另确认 `resources/data/inner-shop.json` 随包存在、打包态 `GET /api/inner-shop` 返回 4/3/4（走 JSON 回退，**不依赖 `tools/` 与 `exceljs`**）。