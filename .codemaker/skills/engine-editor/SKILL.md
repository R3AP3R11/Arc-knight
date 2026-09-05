---
name: engine-editor
description: 改关卡编辑器交互（拖拽/画墙/手柄）、实体属性面板、撤销剪贴板、编辑器与试玩相机、server.js 存读盘 API、UI 配置页、画板/美术资产/独立画板轮廓绘制/轮廓库、Electron 打包时读这份。
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
- **美术渲染核心 + 武器/宠物系统**（`src/systems/art/**`，12 文件）：画板「设计稿 JSON」→ 矢量渲染（`asset-render.js`）+ 武器设计稿/统一弹道解释器/运行时武器目录（`weapon-registry.js`）/运行时注册 + 宠物设计稿/存取/内置（`pet-design.js`/`pet-store.js`/`default-pets.js`）。详见 §2 备注与 §4.9/§4.10。
- **后端**（`server.js`）：关卡/UI/存档/设计稿 JSON 落盘 + 静态服务（开发用 vite 中间件，打包用 staticDir）。

关卡数据结构（`normalizeLevel` / 房间布局 / 触发器事件语义）详见 **level-design skill**；UI 节点渲染与 `renderGraph` 详见 **ui-interaction skill**；战斗/掉落/存档数值详见 **gameplay-systems skill**。

## 2. 文件地图

### 场景侧（画布内交互，mixin 装到 EditorScene.prototype）

| 文件 | 职责 | 关键导出 | 行数 |
|---|---|---|---|
| `src/systems/editor/editor-input.js` | 编辑器鼠标/键盘：命中、拖拽、画墙、放实体、擦除、方向键微调；非编辑态下额外拦截选关页2背景拖动（`menuScreen==='levelSelect'&&levelSelectPage===2` 时 `pointerDown` 不命中按钮则记 `levelSelectDrag`，`pointerMove` 更新 `smallLevelPan`，`pointerup` 清空） | `EditorInputMixin`（`pointerDown` / `pointerMove` / `updateEditorKeys`） | 259 |
| `src/systems/editor/editor-camera.js` | 世界与视口尺寸、缩放适配、滚轮、编辑器钳制、试玩跟随 | `EditorCameraMixin`（11 方法） | 160 |
| `src/systems/editor/editor-geometry.js` | 纯函数：手柄命中、矩形/背景缩放、实体拾取、闸门绘制 | `resizeRect` `rotationHandleAt` `handleAtRect` `hitBackground` `backgroundHandleAt` `resizeBackground` `pickTopEntity` `drawGates` `BG_HANDLE_SIZE` `MIN_BG_SIZE` | 280 |
| `src/systems/ui/world-render.js` | `draw()` 主绘制 + 选中框/手柄绘制（`:377` `:382` `:442` `:446`）+ 精灵同步 + 画板设计稿按需加载 | `WorldRenderMixin` `requestArtDesigns` | 691 |
| `src/systems/ui/world-overlay.js` | 交互提示/Tip 覆盖层，多处 `if (this.editing) return` | `WorldOverlayMixin` | 331 |
| `src/game-scene.js` | 场景类 + mixin 装配 + `create()` 输入接线 + `update()` | `createGameScene(ctx)` | 588 |

### DOM 侧 + 后端

| 文件 | 职责 | 关键导出 | 行数 |
|---|---|---|---|
| `src/main.js` | 入口：模块顶层 `registerBuiltinWeapons()`（先于一切 `normalizePlayer()`）、初始玩家状态、7 钩子注册、`initialize()` | （无，副作用模块） | 93 |
| `src/editor/context.js` | 共享 `ctx` 单例 + `ctx.hooks` 钩子表 | `ctx` | 39 |
| `src/editor/bindings.js` | `bind()` 全量 DOM 接线 + 快捷键 + beforeunload 兜底保存 + 画板接线 | `bind` `showUIConfig` | 347 |
| `src/editor/history.js` | 撤销栈（上限 60）、实体归类、剪贴板 | `pushUndo` `undo` `copySelected` `pasteClipboard` `entityKind` | 86 |
| `src/editor/entity-properties.js` | 实体属性面板（15 种实体分支）、宝箱奖励子编辑器、嵌套读写、敌人「画板美术方案」下拉、指引字段组条件显示（`guideRows`，勾「是否游戏内指引」才出距离/图标/交互后停止） | `renderEntityProperties` `bindEntityFieldInputs` `getNested` `setNested` `updateWall` | 513 |
| `src/editor/level-flow.js` | 面板同步 `sync`、重绘落盘 `redraw`、启动 `startGame`、模式切换、快照恢复、关卡加载 | `sync` `redraw` `startGame` `setMode` `restoreEditorSnapshot` `selectLevel` `refreshLevels` `switchToLevel` `fadeAndSwitch` `rememberLevel` `recallLevel` `renderFlows` `LAST_LEVEL_KEY` | 222 |
| `src/editor/room-panel.js` | 多箱庭房间面板与墙体重生成 | `applyRooms` `renderRoomPanel` `updateRoomNumber` `updateRoomPanelSize` `toggleRoomCell` `openRoomCellPopup` `closeRoomCellPopup` `applyRoomMarker` | 152 |
| `src/editor/trigger-panel.js` | 触发器事件列表编辑器（波次/切关/能量门多选） | `renderTriggerEvents` | 240 |
| `src/editor/drop-rules-panel.js` | 按敌人类型的掉落规则面板 | `renderDropRules` `bindDropRules` | 89 |
| `src/editor/player-panels.js` | 预览玩家 / 试玩存档两套属性表单（改件区按**库存数量**配置：通用无上限 / 专属每种最多 1） | `renderPreviewPlayer` `renderTrialPlayer` `bindPlayerPanels` | 172 |
| `src/editor/save-flow.js` | 存档源切换、新游戏、选存档、试玩启动 | `startTrial` `startNewGame` `selectSave` `listStoreSaves` `saveStorePlayer` `loadStorePlayer` `isTrialSaveStore` | 102 |
| `src/editor/packaged.js` | 打包端启动路径 + UI 预载 | `initializePackaged` `enterPackagedLogin` `loadPackagedUi` | 55 |
| `src/editor/artboard.js` | 画板工作台：Canvas 预览/交互（拖元素、手柄缩放）+ 元素属性 + 旋转方向 + 复制元素 + 改名 + 保存/载入 + 生成默认美术 + 轮廓库接线（下拉/一键添加）+ stroke 缩放/旋转手柄（`makeG` 已挪至 asset-render 共享）；**右侧预览视窗支持修改背景色 `design.bgColor`**；**圆弧新增「钟表表盘」显示形式**（`pattern`/`tickShortLen`/`tickLongLen`/`tickDensity`/`tickRatio`/`tickDir` 字段，见 §4.11） | `showArtboard` `initArtboard` `getArtboardDesign` | 535 |
| `src/editor/draw-board.js` | **独立画板**（轮廓绘制弹层）全量逻辑：加点/选择/填充三工具 + 点编辑（选中/拖动/方向键1px/XY/Delete）+ **点到点连线（边驱动）**：add 点已有点=锚点，有选中锚点再点任一已有点→从锚点连边（**可点起点成环**）；blank 落点有选中→连锚到新点，非选中只放点；`drawEdges` 存边、绘制只按边画线、不从闭合回路续接到新点；写回/填充按**连通分量拆分**（`splitIntoComponents`，剑/箭头等分开图形各自独立）：新建态「完成」写**多个** stroke 元素（保存后分开）、填充/判定逐环（每环纯闭合 `hasClosedRing` 才上色/命中），编辑已有保持单元素；`closed` 由 `drawStyle.closed || hasClosedRing` 推断；点/线/边操作同前；`lastAdded` 记录最近加点下标，Ctrl+Z 精准退点 + **打开即带入当前 stroke 元素点集（所见即所改）** + 填充仿 Windows 画板（调色后点闭合回路内部上色）+ 网格吸附 + 参考图形（圆/弧/多边形转点=追加；**已注册轮廓转点=替换当前点集**）+ 整条变换（「应用变换」带反馈）+ 完成写回（带反馈）+ 保存轮廓（**同名覆盖**；`buildPolyline` 已硬化**不再退化为原始顺序**；保存**无损点+边拓扑**——点取遍历序、边重映射到该点序，读回按 `edges` 精确还原，保证「保存→导入→再保存」逐位一致；已居中则不再减重心避免浮点漂移）+ **删除已注册轮廓** + **框选/复制粘贴/整组移动**：select 模式空白按下拖拽=框选（虚线矩形实时选中矩形内点，`selectedSet` 多选、`selectedPointIndex` 为锚点）、Ctrl+C 复制选区点+点间边、Ctrl+V 偏移一格粘贴并重建边、方向键以 1px 移动整组、Delete 整组删 + Ctrl+Z/Esc/Enter | `openDrawBoard` `closeDrawBoard` `isDrawBoardOpen` | 797 |
| `src/systems/art/asset-render.js` | 画板矢量渲染核心：设计稿 JSON → 图形（多边形/圆弧/手绘轮廓 + 旋转/方向/轨道半径；**arc 支持 count 绕圆心等角排布多环且每副本以自身 ca 朝向**；**arc 支持 `pattern:'clock'` 钟表表盘花纹——沿弧长均布径向刻度，长/短针按 `tickRatio` 比例排布、朝向 `tickDir`（in/out/both）可配**；stroke 支持 orbit>0 重心挂轨道）。`normalizeOutline` 现**保留 `edges`（点序下标对，用于轮廓无损还原连通拓扑）**。`designBounds` 按当前姿态 `t` 算渲染包围盒（含描边与钟表外伸刻度），`renderAssetFit` 把包围盒「居中+等比缩放」到 boxSize（供图标等用，解决画板资产不居中/描边超框）；**`drawDesignCentered` 以设计原点 (cx,cy) 居中 + 按包围盒半径缩放（不用包围盒几何中心——旋转动画元素使 bcx/bcy 偏移，如 minigun 轨道环/非整圆弧致外观偏离中心，供商店/工坊/HUD 卡片叠加用）**；`designRadius` 已计入 `lineWidth/2` 与钟表外伸刻度 | `normalizeDesign` `normalizeElement` `normalizeOutline` `renderAsset` `renderAssetFit` `drawDesignCentered` `designBounds` `elementCenter` `designRadius` `hexToInt` `intToHex` `makeG`（内部 `drawArcTicks`/`clockTickExt`） | 337 |
| `src/systems/art/design-store.js` | 画板设计稿运行时存取：按 id 懒加载缓存 + 下拉选项 | `getDesign` `ensureDesign` `ensureDesigns` `registerDesign` `getArtChoices` `refreshArtChoices` | 44 |
| `src/systems/art/default-art.js` | 默认美术 → 画板设计稿转换器（含 yellow/green 武器环） | `buildPlayerDesign` `buildEnemyDesign` `buildAllDefaultArt` | 101 |
| `src/editor/weapon-board.js` | 武器 · 弹道编辑器工作台：独立页（纯 Canvas2D+DOM 表单），编辑武器外形/发射媒介/子弹外形（画板矢量）+ 矢量场/激光束轨迹 + 4 类拖尾 + 弹道/进入游戏参数 + 开火预览 + 保存/载入/模板；**武器下拉同时列出已落盘武器与内置 yellow/green（`buildBuiltinWeaponDesigns`），载入经 `ensureWeaponDef` 兜底；画板矢量圆弧支持数量（`count`）与钟表表盘（`pattern`+`tickDir`/`tickRatio` 等，经 `miniSelect` 渲染 select、`bindShapeInput` 特判 pattern 重渲）；删除按钮走 `click` 绑 `data-del`；子弹弹道提供 `randomPalette` 调色盘 chip 合集 + `speed` 飞行速度 + `fadeDuration` 消失时长[ms] 字段** | `showWeaponBoard` `initWeaponBoard` `getWeaponDesign` | 580 |
| `src/systems/art/weapon-design.js` | 武器设计稿数据模型：归一化 + 默认（外形/媒介/子弹三组画板矢量 + 矢量场/光束轨迹 + 弹道/进入游戏参数；**arc 同 polygon 支持 count，且支持钟表表盘 `pattern`/`tickShortLen`/`tickLongLen`/`tickDensity`/`tickRatio`/`tickDir`（与 asset-render 对齐）**；子弹支持 `randomPalette` 随机颜色合集[规范化为 `#rrggbb`]、`speed` 飞行速度[缺省回退旧 vector.speed]、`fadeDuration` 消失时长[ms]） | `normalizeWeaponDesign` `defaultWeaponDesign` `normalizeVectorField` `WEAPON_TRAIL_TYPES` | 200 |
| `src/systems/art/weapon-runtime.js` | 统一弹道解释器：武器设计稿 → 兼容 `WEAPONS` 表的运行时条目（fire/stepBullet/drawBullet，矢量场+激光束介型，4 类拖尾，改件上限；**随机颜色从 `randomPalette` 合集取，空则回退随机色相；弹速走 `bullet.speed`；超距淡出：`bullet.fadeDuration>0` 时抵其最远距离即停住、在时长内原地渐隐（不拉长射程），并以最后航向 `dirX/dirY` 维持拖尾方向共同渐隐，否则按距离淡出；撞墙渐隐：`bullet.wallFade` 置位后同样停驻原地、在 `fadeDuration` 内渐隐**） | `buildWeaponRuntimeEntry` `muzzlePosition` | 274 |
| `src/systems/art/weapon-store.js` | 武器运行时存取：按 id 缓记载入 + 把运行时条目并入战斗 `WEAPONS` 表 + 武器目录登记 + 改件上限 + `registerBuiltinWeapons` 启动注册内置设计稿武器；`loadWeaponDefs` 逐个 `loadWeapon` 拉盘**强制覆盖内置缓存**（否则同名磁盘副本被内置值遮蔽） | `registerWeapon` `ensureWeaponDef` `ensureWeaponDefs` `getWeaponDef` `loadWeaponDefs` `getModCaps` `refreshWeaponChoices` `registerBuiltinWeapons` | 84 |
| `src/systems/art/weapon-caps.js` | 每武器改件数量上限同步存取（**无 Phaser 数据模块**，供 player-data/damage 复用不破坏单测） | `setWeaponCaps` `getWeaponCaps` | 19 |
| `src/systems/art/weapon-registry.js` | 运行时武器目录（**无依赖叶子模块**，供 state/player-data 查询，避免 import 环）：基础 3 种 id + 设计武器 id 目录 | `BASE_WEAPONS` `weaponCatalog` `registerWeaponId` `isKnownWeapon` `DEFAULT_UNLOCKED_WEAPONS` | 20 |
| `src/systems/art/default-weapons.js` | 默认武器模板：把现有 3 种玩家武器（radial/yellow/green）还原成武器设计稿 + 空白模板 + `buildBuiltinWeaponDesigns`（把 yellow/green 模板转成 id=`yellow`/`green`、名称「散射/激光」、`isTemplate:false`） | `buildDefaultWeapons` `buildAllDefaultWeapons` `buildBuiltinWeaponDesigns` | 120 |
| `src/systems/art/pet-design.js` | 宠物设计稿数据模型：归一化 + 默认（机制硬编码，只配数值：外形/弹道引用 + 环绕/开火/生命/购买） | `normalizePetDesign` `defaultPetDesign` | 45 |
| `src/systems/art/pet-store.js` | 宠物运行时存取：按 id 懒加载 + 列表/缓存 + `registerBuiltinPets` 启动兜底内置 | `registerPet` `getPetDef` `listPetDefs` `ensurePetDef` `loadPetDefs` `registerBuiltinPets` | 66 |
| `src/systems/art/default-pets.js` | 内置宠物定义（打包端无 `/api/pets` 兜底） | `buildBuiltinPetDesigns` | 23 |
| `src/editor/pet-board.js` | 宠物编辑器工作台：独立页（DOM 表单），改宠物数值（外形/弹道引用 + 环绕/开火/生命/购买），保存到 `data/pets/*.json` | `showPetBoard` `initPetBoard` `getPetDesign` | 146 |
| `src/api.js` | 前端 API 封装（fetch → `/api/*`） | `get` `post` `remove` `loadLevel` `saveFormal` `saveDraft` `getUi` `saveUi` `listPlayers` `listAssets` `loadAsset` `saveAsset` `deleteAsset` `listWeapons` `loadWeapon` `saveWeapon` `deleteWeapon` `listOutlines` `loadOutline` `saveOutline` `deleteOutline` … | 58 |
| `src/ui.js` | `getDom()`（id 硬校验）、`setStatus`、关卡下拉、武器/模组渲染（`renderPreviewMods` 接收 `items`，改件区按库存数量渲染） | `getDom` `setStatus` `renderLevels` `renderPreviewWeapons` `renderPreviewMods` | 109 |
| `src/ui-config.js` | UI 配置页：节点列表表单 + 可视化预览 + 保存 + **interact/hover 交互字段 + poly 顶点编辑** | `renderUIConfigPage` `addUINode` `saveUIConfigPage` | 231 |
| `src/ui-editor.js` | **UI 配置页可视化画布编辑器**：在 uiPreviewCanvas 上点选/拖动移动/拖角缩放节点、选中覆盖层与手柄、与左侧表单实时双向同步、点击空白放置所选类型、**hover 实时预览 + poly 点拖动编辑** | `UIEditor` `initUIEditor` `getUIEditor` | 391 |
| `src/ui-library.js` | **可复用 UI 组件库注册表**：组件定义（defaultProps + propsSchema + draw2d(Canvas2D 库预览) + drawPhaser(Phaser 页面)）。组件：`LoginButton`（登录按钮：透明底白字+扫光悬停）、`GiftCard`（神像三选一增幅卡：白卡+图标[可配动态资产/黑圆占位]+名称/描述+悬停放大 10%，`icon` 为画板资产 id；图标缩放 `designRadius` 已挪到 `asset-render.js` 共享导出） | `LoginButton` `GiftCard` `hexToRgb` `mixColor` `colorInt` `registerComponent` `getLibrary` `getComponent` `registerBuiltinComponents` | 204 |
| `src/ui-library-panel.js` | **UI 组件库面板**：列出已注册组件（名称/分类/描述），schema 驱动属性表单 → 实时重绘预览 canvas，模拟悬停看扫光；`asset` 类型字段用 `getArtChoices()` 生成资产下拉，图标动态资产未缓存时 `ensureDesign` 异步加载完成后重绘。选中 `GiftCard` 时切到**赐福卡片多卡编辑器**：列表选卡 + 名称/描述/图标/加成(属性+op+value 行) + `offerCount` + 新增/删除卡，保存调 `saveUi('idol-buffs', cfg)` 写回 `data/ui/idol-buffs.json` 并 `setIdolBuffs` 即时生效 | `initUILibraryPanel` `renderUILibraryList` `renderUILibraryPreview` `toggleUILibraryHover` `showUILibrary` | 294 |
| `src/ui-mxgraph.js` | **mxGraph 线框 XML 解析器**（浏览器 `DOMParser`，不引库）：把 draw.io 顶点(mxCell+mxGeometry)转成可编辑形状 `{id,x,y,w,h,label,fill,stroke,note}` | `parseMxGraph` | 58 |
| `src/ui-page-profiles.js` | **已有 UI 页面画像**：把代码绘制的现有页面（工坊 `workshop.js:drawWorkshopUI` / 武器商店 `screens.js:drawWeaponShop` / 关卡选择(2页) `drawLevelSelect='页1 模式选关'` / 结算 `drawSettlement`）按相同布局常量还原成可批注形状数组，供设计稿「导入已有页面」下拉复用，AI 据此精确实现 | `pageProfiles` `profilePage` | 164 |
| `src/ui-wireframe.js` | **UI 设计稿页**：粘贴 mxGraph XML 解析导入 → 画布拖移/点选控件 → 左侧填每控件「功能/动画/逻辑描述」→ 保存设计稿；**新增「导入已有页面」下拉**（从 `ui-page-profiles.js` 生成形状） | `initWireframe` `showWireframe` | 157 |
| `server.js` | HTTP API + 静态/vite 服务 | `startServer(options)` | 406 |
| `index.html` | 编辑器 DOM 结构（id 集合 + 15 个 `.tool` 按钮 + 画板页 + 独立画板弹层（7 组工具条）+ 玩家美术按武器绑定） | — | 435 |
| `electron/main.cjs` | Electron 主进程：起内嵌 server（port 0）+ BrowserWindow | — | 60 |
| `package.json` | scripts + electron-builder 配置 | — | 54 |

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
| 改/加小地图箱庭标记配置 | `room-panel.js` 的 `#roomCellPopup`（右键房间弹窗）+ `index.html` 的 `#roomCellMarkerType`/`#roomCellMarkerIcon` + `bindings.js` 事件绑定 + `ui.js` ids；`applyRoomMarker(c,r)` 写 `cell.marker`；数据契约 `MINIMAP_MARKER_TYPES/LABELS` 见 level-design skill §3.8 |
| 加编辑器工具（工具栏按钮） | `index.html` `.tool` 按钮 + `editor-input.js:pointerDown` 的 `tool === 'xxx'` 分支 | `state.js` normalize 函数、`history.js:COPY_ID_PREFIX` |
| 加撤销/快捷键 | `bindings.js:314` keydown 监听 | 撤销点要显式 `pushUndo()` |
| 加后端接口 | `server.js` `parts[1] === 'xxx'` 分支 | `src/api.js` 封装、打包只读白名单 `server.js:172` |
| 改关卡保存/草稿落盘 | `level-flow.js:redraw:59` + `api.js:saveFormal/saveDraft` | `bindings.js:331` beforeunload 兜底 |
| 改模式切换/试玩快照 | `level-flow.js:setMode:137` / `restoreEditorSnapshot:160` / `save-flow.js:startTrial:76` | 快照字段 `ctx.editorSnapshot` `ctx.editorPlayerSnapshot` |
| 改 UI 配置页字段 | `ui-config.js:nodeFields` | `src/ui-editor.js`（可视化拖拽编辑器）、`src/ui-preview.js:renderUIPreview`、运行时 `src/ui-layer.js:renderGraph` |
| 改 Electron 打包 | `package.json` `build` 段 + `electron/main.cjs` | `extraResources` 与 `main.cjs:14-18` 路径必须一致 |
| 加 DOM 控件 | `index.html` + `src/ui.js` `ids` 数组 | 漏一个 id 就 `Missing DOM elements` 直接抛错 |
| 改画板（设计稿渲染/元素字段/手柄） | `src/systems/art/asset-render.js`（几何与 `renderAsset`）+ `src/editor/artboard.js`（主画板交互与面板）+ `src/editor/draw-board.js`（独立画板轮廓绘制） | 设计稿 JSON 结构在 `normalizeDesign/normalizeElement`；新字段要加进 `elementFields`；轮廓库走 `/api/outlines` + `normalizeOutline` |
| 改武器系统（设计/弹道/战斗接入） | `src/systems/art/weapon-runtime.js`（弹道解释器）+ `src/editor/weapon-board.js`（工作台）+ `weapon-design.js`（模型） | 战斗接入要同步 `player-data.js`（weaponCatalog/目录归一化）+ `main.js`（loadWeaponDefs 预载）+ `weapon-store.js`（注册/caps）；新字段要加进 `normalizeWeaponDesign` 与 `scalarFields()` |
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

### 3.7 `server.js` API 路由表（实测 **12 个 `/api` 路由分支** + 2 个静态特殊路由）

| Method | Path | 目录 | 返回 |
|---|---|---|---|
| GET | `/api/levels` | `dirs.levels` | `{levels: string[]}` |
| GET | `/api/levels/:id` | `dirs.levels/:id.json` | 关卡 JSON（读不到 → 404 `{error}`） |
| POST | `/api/levels/:id` | 同上，写 | `{ok:true}`（打包端 403） |
| DELETE | `/api/levels/:id` | 同上，删 | `{ok:true}`（打包端 403） |
| GET | `/api/templates` | 内存常量 `templates`（`server.js:7`） | `{single:{...}, multi:{...}}` |
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
      ctx.dom = getDom()          ui.js:25，缺 id 直接 throw
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
- **`GiftCard` 组件已注册**（神像三选一增幅卡）：`defaultProps` 含 `icon`/`iconSize`/`name`/`desc`/`nameSize`/`descSize`/`textColor`/`bgColor`/`hoverScale`；`draw2d` 用 `makeG` + `renderAsset` 渲染 `icon`(画板资产 id) 为动态资产，缺省退化黑圆占位；`drawPhaser` 用单 text 渲染 `名称\n描述` 两行。`propsSchema` 里 `icon` 是 `type:'asset'`（面板用 `getArtChoices()` 生成下拉）。`makeG` 已从 artboard.js 挪到 `asset-render.js` 共享导出（组件库预览与画板共用）。**注意**：组件库预览是 Canvas2D，动态资产需经 `ensureDesign(icon)` 异步拉取，`draw2d` 先画黑圆占位、加载完成后 `renderUILibraryPreview` 重绘换动态资产；神像弹窗 `drawIdolOffer` 已改为读 `offer.cards[i].icon`（`data/ui/idol-buffs.json`）渲染画板资产，缺省才黑圆，张数按 `IDOL_OFFER_COUNT`。
- 后续批量注册其余控件（menuClose✕ / 面板 / 血条 / 卡片等）再逐步替换。

### 4.10 UI 设计稿（mxGraph 线框 → 供 AI 实现）

编辑器「设计稿」按钮（index.html:27 `#wireframe`）→ `wireframe-mode` → `initWireframe`。
- **导入**：文本框粘贴 draw.io/mxGraph XML（**支持 URL 编码 `%3C...` 自动解密**）→ `parseMxGraph`（`ui-mxgraph.js`，`DOMParser`，仅解析顶点 `vertex=1` 的 `mxCell`，读 `mxGeometry` x/y/w/h + value=label + style 的 `shape`(椭圆/菱形/rounded/首 token `ellipse;`/`text;`)/`fillColor`/`strokeColor`/`strokeWidth`/`fontColor`/`fontSize`/`align`/`verticalAlign`/`rotation`/`dashed`/`fillOpacity`；HTML 化 label 剥纯文本，`<font color>`/`font-size` 作为颜色字号兜底）→ 生成可移动形状数组。
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
圆弧钟表花纹（artboard.js `elementFields` arc 分支）：元素字段末尾新增「显示形式」select（`pattern`：普通圆弧/钟表表盘）；`pattern==='clock'` 时才追加长针长度(`tickLongLen`)/短针长度(`tickShortLen`)/刻度密度总针数(`tickDensity`)/长短针比例(`tickRatio`，每1长配N短)/刻度方向(`tickDir` in/out/both) 五字段。切换 `pattern` 走 `renderElementList` 重渲（oninput 特判，参考 `key==='shape'`）。**渲染在 `asset-render.js` 的 `renderAsset` arc 分支**（`drawArcTicks` 用 `i % (tickRatio+1) === 0` 判长针），武器设计稿不走此路径（`normalizeWeaponShape` 不携带 pattern，保持普通圆弧）。
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
  elements:[ { shape:'polygon'|'arc'|'stroke',
               count,          // 围绕圆心等角放置的副本数（"一组"）；arc 同 polygon 支持，仅 stroke 恒为 1
               orbitRadius,    // 形状中心到设计圆心的轨道半径（polygon）；stroke >0 时重心挂轨道公转+绕重心自转，=0 保持点绕圆心
               radius,         // polygon 外接半径 / arc 环形半径
               sides,          // polygon 边数
               lineWidth,      // 描边粗细 / 环厚
               color,          // 颜色（描边/环/轮廓）
               fill,           // 填充色，null=不填充（**有填充色即按闭合区域上色**，Windows 画板语义；closed 仅控制描边首尾连线）
               rotSpeed,       // 旋转角速度 rad/s（大小）
               dir,            // 旋转方向：1=逆时针，-1=顺时针
               phase,          // 初始相位 rad
               arcStart, arcEnd,    // arc 起止角（°）
               pattern,       // arc 显示形式：plain=普通圆弧 / clock=钟表表盘（沿弧均布径向刻度，长短针按比例排布）
               tickShortLen,  // clock：短针长度 px（默认 6）
               tickLongLen,   // clock：长针长度 px（默认 12）
               tickDensity,   // clock：单一密度=总针数（默认 12）
               tickRatio,     // clock：长短针比例，每 1 长针配 N 短针（默认 1=交替，4=钟表式 1长4短）
               tickDir,       // clock：针朝向 in=朝圆心 / out=向外 / both=双向（默认 in）
               points,         // stroke：轮廓点 [{x,y}]（orbit=0 时相对设计圆心；orbit>0 时相对轮廓重心）
               closed } ] }    // stroke 是否闭合
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
> 画板矢量元素（外形/媒介/子弹共用，`normalizeWeaponShape`+`renderAsset`）新增 **`offsetX/offsetY/offsetSpeed`**（移动滞后：`renderAsset(g,design,x,y,t,scale,motion,alpha)` 第 7 参 `motion`（归一化移动向量，game 用 `moveLeanX/Y÷PLAYER_LEAN.hex`）驱动元素沿移动方向错位；第 8 参 `alpha` 供子弹淡出）。圆弧新增**钟表表盘**：`pattern`（plain/clock）+ `tickShortLen`/`tickLongLen`/`tickDensity`/`tickRatio`/`tickDir`（与 asset-render 对齐，渲染走 `renderAsset` arc 分支的 `drawArcTicks`；`normalizeWeaponShape` 携带这些字段，故武器外形/媒介/子弹圆弧都能用钟表花纹）。媒介新增 **`ringWidth`**（环线宽）、**`orbitSpeed`/`fireSpeed`**（球怠速/射击转速°/s，`game-scene.js` 转动角速度改用之，回退 180/20）。子弹新增 **`range`**（射程，超出淡出消失）、**`speed`**（飞行速度，缺省回退旧 `vector.speed`）、**`fadeDuration`**（消失时长 ms：到达最远距离（配 `range`）**或撞墙**时停驻原地、在时长内原地渐隐——被墙壁阻挡时同样渐隐而非直接销毁；0=按距离淡出）、**`spreadRandom`**（每发随机偏移°）、**`randomColor`**（每发随机色，`randomPalette` 指定随机合集[调色盘 chip，规范化为 `#rrggbb`，空则全场随机色相]）；拖尾新增 **`midWidth`**（菱形中间宽，>0 时渲染头尾尖中间宽的 6 顶点菱形）与 **`midAt`**（最宽处占比）。发射媒介环上小球由 `entity-art.drawPlayer` 的 `drawWeaponMedium()` 绘制（球兜底色取 `medium.ringColor`，非硬编码白）。**weapon-board 圆弧钟表 UI**：`shapeFieldEdit` arc 分支追加「显示形式」select（`pattern`）+ 条件性钟表子字段；`bindShapeInput` 对 `pattern` 特判 `renderForm(dom)` 重渲（钟表子字段显隐）、`tickDir` 特判字符串写入；`miniSelect` 为新增 select 渲染助手。

## 5. 关键常量与数值

| 常量 | 所在文件:行 | 当前值 | 含义 | 调它影响什么 |
|---|---|---|---|---|
| `VIEW_W` / `VIEW_H` | `systems/constants.js:9` | `1920` / `1080` | 视口逻辑尺寸 | 编辑器缩放适配、钳制范围、试玩 playZoom 全部按它算 |
| `CELL` | `systems/constants.js:9` | `30` | 网格吸附步长 | `snap()` 精度、新建墙/触发器默认尺寸（`CELL*4×CELL*3` 等）、方向键微调步长 |
| `ROTATE_HANDLE_OFFSET` | `systems/constants.js:79` | `28` | 旋转手柄离实体上边距离 | `rotationHandleAt` 命中位置 + `world-render.js:382/446` 手柄绘制位置（两处必须一致） |
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
5. `asar: false`（`:26`）是故意的（server.js 要读真实文件）。改成 true 会让 `path.join(__dirname, '..', 'dist')` 之类的路径失效。
6. 验证：`npm run pack`（= `vite build && electron-builder --win`，产物 `release/`，target `portable`）。快速验证不打包也行：`npm run build && npm run electron`（`app.isPackaged` 为 false 时会回退项目 `data/`）。

## 7. 坑与约束

1. **mixin 同名覆盖与装配顺序**。`game-scene.js:558`（`Object.assign(EditorScene.prototype, ...)`）按固定顺序装 19 个 mixin：`EnemyAi, PlayerCombat, Destructibles, Spawning, Triggers, Interactables, LevelFlow, Hud, UiRuntime, Screens, SaveLogin, NewbeeHub, Workshop, Drops, Progression, EditorInput, EditorCamera, WorldRender, WorldOverlay`。**后者覆盖前者同名方法**，编辑器四件套（EditorInput / EditorCamera / WorldRender / WorldOverlay）排在最后，所以它们的同名方法总是赢。加新方法前先确认全仓无同名，否则静默覆盖、vite build 不报错。

2. **`const ctx = this.ctx;` 约定**。mixin 里任何访问注入 `ctx` 的方法，**首行必须写** `const ctx = this.ctx;`（看 `editor-input.js:13/193/238`、`editor-camera.js:13/19/90` 的缩进风格——就是这么写的）。漏写会在运行时抛 `ReferenceError: ctx is not defined`，而 `vite build` 检测不到（模块作用域没有 `ctx`，但 ESM 只在执行时才报）。`applyWorldBounds`/`clampEditorView`/`resetEditorCamera` 等不访问 ctx 的方法就不写。

3. **场景 ctx 与编辑器 ctx 同名不同物**。见 3.4。典型错误：在 mixin 里写 `ctx.dom.xxx`（场景 ctx 没有 `dom`，必然 undefined）；或在面板文件里写 `ctx.redraw()`（编辑器 ctx 没有 `redraw`，要用 `ctx.hooks.redraw()`）。`editor-camera.js:44 showZoom()` 之所以用 `document.getElementById('zoomInfo')` 而不是 `ctx.dom`，正是这个原因。

4. **`ctx.hooks` 是运行时后绑，且 7 个调用点全是裸调用**（`entity-properties.js:41/426`、`history.js:31/83`、`room-panel.js:29`、`level-flow.js:95/96/97/105`）。任何**不经过 `src/main.js`** 的入口（单测直接 `import` 面板模块、Node 环境跑 `entity-properties.js`、打包端的 `initializePackaged` 早于注册的假设）调到这些函数会 `TypeError: ctx.hooks.redraw is not a function`。相比之下场景注入 ctx 的回调调用点**几乎全用 `?.()`**（`onSwitchLevel` / `onExitPreview` / `onStartNew` / `onListSaves` / `onSelectSave` / `onOpenLevel` / `onSettings` / `onPlayerSave` / `pushUndo` / `redraw?.`），唯一裸调用的是 `game-scene.js:73` 和 `editor-input.js:189/234` 的 `ctx.redraw()`。要给面板写单测就得先手动填 `ctx.hooks`。

5. **`const { state } = ctx;` 是解构快照**。`bindings.js:22`、`history.js:12`、`level-flow.js:22`、`entity-properties.js:14`、`room-panel.js:14`、`drop-rules-panel.js:13`、`player-panels.js:14`、`save-flow.js:15`、`packaged.js:14`、`main.js:12` —— **10 个文件**在模块顶层这么写。含义：这些模块持有的是 `ctx.state` 的**旧引用**。现在没问题（全仓从不整体替换 `ctx.state`，只替换 `state.level`），但**将来若要做「重置整个 state」，必须改成到处 `ctx.state.` 访问**，否则一半模块指向旧 state，症状是「面板显示和画布不一致」。同理 `main.js:12` 还解构了 `PACKAGED`（这个是常量，安全）。

6. **试玩快照机制**。见 4.6。三条硬规则：进游戏前必存 `ctx.editorSnapshot`；退出必走 `restoreEditorSnapshot()`；`state.saveStore` 必须复位 `'formal'`。另外 `redraw()`（`level-flow.js:63`）只在 `mode === 'editor'` 落盘——**别去掉这个判断**，否则试玩时的鼠标射击会不停把游戏中的关卡状态写进关卡文件。

7. **事件类型枚举在两处独立维护**（实测确认）：
   - `src/state.js:219` `export const EVENT_TYPES = ['complete','roomComplete','combat','spawnEnemy','switchLevel','spawnGate','removeGate']`（`:244` 用它过滤非法类型）；
   - `src/editor/entity-properties.js:79-87` `eventTypeOptions` 硬编码同一组 7 项（带中文标签），透过 `hooks.renderTriggerEvents` 传给 `trigger-panel.js:128` 渲染下拉。
   
   **新增事件类型必须改这两处**：只改 `state.js` → 下拉里选不到；只改 `entity-properties.js` → 能选但 `normalizeTrigger` 把它过滤成 null，保存后消失。类似的双份枚举还有：能量门默认色（`constants.js:81-82` vs `state.js:418-419`）、`state.ui` 的键（`state.js:495` 4 个 vs `packaged.js:19` 5 个）。

8. **DOM id 必须与 index.html 一致**。`src/ui.js:3-23` 的 `ids` 数组有 **86 个 id**，`getDom()`（`:25`）会校验并对缺失项 `throw new Error('Missing DOM elements: ...')` —— 直接白屏（`main.js:77` 会把错误写进 body）。加控件顺序：先 `index.html` 加元素 → 再 `ui.js` 的 `ids` 加 id → 再 `bindings.js` 接线。带中划线的 id（`entity-properties` / `entity-title` / `entity-fields`）在 `:30-32` 有驼峰别名，用别名访问。

9. **Phaser 4 相机语义**（代码注释里反复强调，`editor-camera.js:71`、`:109`）：`cam.scrollX` 是**视口左上角的世界坐标**，且**不随 zoom 缩放**。所以居中玩家写 `scrollX = player.x - cam.width/2`（**不是** `- cam.width/2/zoom`）；而「可见世界尺寸」要写 `cam.width / zoom`（`:110-111`）。Phaser 3 的写法搬过来会出现「缩放后镜头偏移」。`onWheel` 里的锚点缩放也依赖这套语义（`:146-154`，含 `originX/originY` 折算）。

10. **`server.js` 是开发用简易服务**。手写 http + 手写 MIME 表（`:47`）+ 无鉴权 + 异常统一吞成 404。开发模式内嵌 vite 中间件（`:160-163`），打包模式改为 `serveStatic(dist)`。打包端不落 `data/levels`、`data/ui` 的写（`:96` 注释 + `:172` 403），关卡/UI 是 `resources/data/*` 只读内置资源，可写数据在 `%APPDATA%/arc-engine`。别在 server.js 里加需要长连接/鉴权/上传大文件的东西。

11. **`editor-input.js` 有 11 个未 import 的标识符（既存隐患，实测确认）**：`rotationHandleAt`（:72）、`handleAtRect`（:76）、`backgroundHandleAt`（:84）、`pickTopEntity`（:92/:179）、`resizeBackground`（:229）、`resizeRect`（:231）、`normalizeEnemy`（:140）、`normalizePortal`（:163）、`normalizeCrate`（:171）、`normalizeBarrel`（:173）、`normalizeChest`（:175），另外 `:223-224` 用了 `Phaser.Math.*` 但文件顶部**也没有 `import Phaser`**。文件只 import 了 `CELL` / `snap` / `DEFAULT_WALL_COLOR`。`vite build` 通过（60 modules），因为这些是运行时才解析的自由变量。**结论**：这条代码路径（编辑器点击画布）在当前构建下会抛 `ReferenceError`。你若要动 `editor-input.js`，顺手补齐 import：
    ```js
    import Phaser from 'phaser';
    import { rotationHandleAt, handleAtRect, backgroundHandleAt, pickTopEntity,
             resizeRect, resizeBackground } from './editor-geometry.js';
    import { normalizeEnemy, normalizeCrate, normalizeBarrel, normalizeChest,
             normalizePortal, DEFAULT_WALL_COLOR } from '../../state.js';
    ```
    补完务必按第 8 章冒烟一遍（build 通过不代表这条路径通）。

12. **`saveDraft === saveFormal`**（`api.js:24`）。「保存草稿」其实直写 `data/levels/`，`data/drafts/` 目录是死数据。所以**编辑器里的任何改动都是即时写正式关卡**，没有「不保存就退出」这回事——这也是 `main.js:69` 固定加载 `level-1` 的原因（避免打开就自动覆盖真实关卡）。写涉及数据安全的需求前先想清楚这点。

13. **`undo()` 会递归**（`history.js:27`）。栈里全是无变化快照时会一路弹到底。因为 `pointerDown` **每次点击都 pushUndo**（包括纯选择），栈里大量重复快照属正常设计。别把这个递归改成循环时忘了终止条件（`!prev` 才停）。

14. **框选不存在**。全仓无 marquee / rubber-band / 多选实现，`state.selected` 是单个对象。需求提到「框选」= 新功能，要在 `pointerDown/pointerMove/pointerUp` 加状态机 + `world-render` 加选框绘制 + `state.selected` 改成数组（后者会波及 `entity-properties.js`、`history.js`、`world-render.js` 十几处 `=== ctx.state.selected` 判定，成本很高，先和需求方确认）。

15. **`server.js` 里别用和函数同名的局部变量**。给 `/api/assets` 加列表接口时踩过：`let list = []` 会把同作用域的 `async function list(kind)` 遮蔽，`list('assets')` 变成把数组当函数调用 → TypeError 被外层 `try{}catch{}` 吞掉 → 接口**不报错但永远返回空数组**（症状极隐蔽：`POST` 成功、`GET /api/assets/:id` 能读回、但 `GET /api/assets` 列表为空）。命名用 `names`/`items` 等避开。同理小心 `file` / `body` / `json` 这几个 server 内高层函数名别被局部变量遮蔽。

16. **画板工作台走 `body.artboard-mode`，别接 `state.mode`**。画板是独立页（纯 Canvas），不进 `EditorScene`，因此**不依赖** `this.editing` / `setMode()` / `state.mode` 三态。反例误用：想用 `mode = 'artboard'` 切场景 —— 会触发 setMode 的 destroy+重建游戏实例，画板反而进不来。它和「UI 配置页」同理，靠 body class 接管显示；新增 DOM id 必须同步 `src/ui.js` 的 `ids` 数组，否则 `getDom()` 直接 throw `Missing DOM elements`。

17. **画板/独立画板的 Ctrl+Z 与编辑器关卡撤销共用 document keydown，按场景早退而不是互相挡**。两个监听器都在 `document` 上，注册顺序决定谁先跑；`stopImmediatePropagation` 只能拦比我后注册的，拦不住先注册的（`bindings.js` 里先装）。现行做法：`bindings.js` 编辑器撤销分支前 `if (document.body.classList.contains('artboard-mode')) return;`（画板期间关卡撤销整体失效）+ 独立画板 `draw-board.js` 的 document keydown **首行 `if (!isDrawBoardOpen()) return;`**（只在本弹层打开时接管 Ctrl+C/V 复制粘贴、Ctrl+Z、Esc/Enter、箭头整组移动、Delete 整组删；旧的 `stopImmediatePropagation` 已移除）。凡是要在同一事件上「谁赢」的需求，优先考虑在各 handler 内部按场景早退，而不是依赖事件传播顺序。

18. **武器/画板工作台共用 3 个高频坑（都踩过）**：
   - **画板矢量组编辑器每个字段输入必须带 `data-index`**：`bindShapeInput` 靠 `e.target.dataset.index` 定位元素，`shapeFieldEdit`/`miniField` 生成的半径/颜色/粗细/相位/闭合等**默认没带**，修改会因 `idx===undefined` 直接 return（值没写入、预览不变）。加元素时把下标 `i` 贯穿进每个 `miniField(...)` 与闭合复选框。症状极隐蔽：形状 select（带了 index）能换、其余字段全「改不动」。
   - **`normalizeXxx` 返回新对象 → 绑定处理器捕获的 `group` 会变僵尸**：`bindShapeGroup` 的「+添加/导入」若在绑定时 `const group = getPath(design, groupKey)` 捕获，之后 `normalizeWeaponDesign(design)` 整体换新对象，旧 `group` 脱离当前 design，添加/导入写进孤对象 → 预览看不到。**必须在 handler 调用时重新 `getPath(design, groupKey)`**。
   - **`<input type=number value="Infinity">` 报 `The specified value "Infinity" cannot be parsed`**：`maxAmmo` 等可为 `Infinity` 的数值字段直接 `value="${val}"` 会触发 number 输入框 DOM 异常。显示时把 `Infinity` 归一化显示为 `0`（保存仍按 0=∞ 处理）。
   - **`player-data` 别 import 战斗表/Phaser**：为读武器改件上限若 `import { WEAPONS } from './systems/combat/weapons.js'` 会拖入 Phaser，导致 node 单测 `import '../src/player-data.js'` 直接加载失败（Phaser ESM 无法在纯 node 解析）。改用**无 Phaser 的数据模块**（`weapon-caps.js`）同步存 caps，`weapon-store.registerWeapon` 写入，`normalizeWeaponMods`/`activeMods` 读取。

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

## 8. 验证方式

**1. 构建**
```
npx vite build
```
基线：`✓ 73 modules transformed.` 无 error。注意它**检测不出** `const ctx = this.ctx;` 漏写、`ctx.hooks` 未注册、未 import 的自由变量（见坑 11）。

**2. 单测**
```
node --test test/
```
基线 **21 tests / 16 pass / 5 fail**，5 个 fail 全是 `test/player-api.test.js` 的 `fetch failed`（需要服务器）。**改了 `server.js` 或 `src/api.js` 必须起服跑一遍**：
```
node server.js          （另开终端，默认 5173）
node --test test/       （应 21 pass / 0 fail）
```
测试 base 可用 `TEST_API_BASE` 覆盖（`test/player-api.test.js:8`）。

**3. 手动冒烟清单**（`node server.js` 后开 `http://localhost:5173`，改任何编辑器代码都过一遍）

1. 页面加载出编辑器面板，状态栏「初始化完成」，右下角 `zoomInfo` 有百分比；控制台无 `Missing DOM elements` / `ReferenceError`。
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

**4. 打包验证**（仅当改了 `electron/`、`package.json`、`server.js` 的打包分支）
```
npm run pack          （= vite build && electron-builder --win，产物 release/）
```
轻量替代：`npm run build && npm run electron`（`app.isPackaged=false`，回退项目 `data/`，可验证 `?packaged=1` 分支、面板隐藏、只读 403）。检查点：窗口直接进 login 关卡、编辑器面板不出现、尝试写关卡返回 403、存档写到 `%APPDATA%/arc-engine`。
