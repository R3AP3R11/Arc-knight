---
name: ui-interaction
description: 改 HUD / 全屏弹窗页 / 世界层渲染与悬浮提示与特效 / data/ui 节点图 / 点击命中与按钮回调时读这份；覆盖 src/systems/ui/**、src/ui-layer.js、src/ui-bindings.js、data/ui/*.json。
---

# UI交互 开发指南

## 1. 这块负责什么

管「玩家在屏幕上看到的一切」：世界层渲染（背景 / 实体 / 特效）+ UI 层绘制（HUD / 弹窗页 / 悬浮提示）+ 点击命中派发。

### 两套 UI 体系（先搞清这个再动手）

| | (a) 数据驱动 UI | (b) 代码绘制 UI |
| --- | --- | --- |
| 定义在哪 | `data/ui/*.json` 节点数组 | mixin 里的 `drawXxx()` 方法体 |
| 谁渲染 | `src/ui-layer.js:renderGraph`（211 行） | 各 mixin 直接调 Phaser Graphics API |
| 数据怎么进来 | `src/ui-bindings.js:BINDINGS` 按 `node.bind.text` / `node.bind.ratio` 键名取 `uiState` 字段 | 方法里直接读 `this.player` / `this.uiState` / `ctx.state` |
| 能否可视化编辑 | 能，可视化画布编辑器（`src/ui-editor.js`）可点选/拖动/缩放节点，表单改字段实时同步，保存回 JSON | 不能，只能改代码 |
| 支持的表现 | panel / bar / icon / shape（含自定义 `poly` 多边形）/ image / button / text 八种 + **hover/press 交互**（`interact.hover`: 颜色/位移/缩放/透明度渐变，按钮点击 press 缩放） | 任意形状、动画、渐变、状态机 |
| 用于 | 静态布局 + 简单数值绑定（金币、等级、击杀、经验条、Logo、标题） | 复杂/动态：血盾条、武器轮盘、弹药、HUD 状态机、全屏商店页、世界层悬浮 tips、特效 |

**选择原则**：纯静态位置 + 一个数字/比例 → 走 (a)，改 JSON 即可、不用碰代码。凡是需要 hover 态、按下动画、循环列表、条件分支、随时间变化的 → 走 (b)。
两套体系在同一帧共存：`drawUI()` 先 `renderGraph` 铺数据驱动节点，再叠代码绘制的 HUD。

### 玩家可见的 UI 面貌清单

| 面貌 | 体系 | 入口 |
| --- | --- | --- |
| 登录页（Logo / ARC ENGINE 标题 / 版本号） | (a) `data/ui/login.json` | `ui-runtime.js:348` |
| 登录页按钮列（新游戏/继续/武器/工坊/设置） | (b) | `save-login.js:113 drawLoginButtons` |
| 战斗 HUD 数值区（金币图标、经验条、Lv、击杀） | (a) `data/ui/battle.json` | `ui-runtime.js:358` |
| 战斗 HUD 状态指示器（EXPLORE / COMBAT / SECURE + 黑色脉冲） | (b) | `hud.js:88 drawHudIndicator` |
| 头像 + 血条 + 护盾条 | (b) | `hud-art.js:13/30` |
| 右下武器轮盘 + 武器图标 + 弹药数 | (b) | `hud-art.js:49/97`、`hud.js:167 drawAmmo` |
| 充能条（yellow / green） | (b) | `hud.js:129 drawChargeBars` |
| 右上设置按钮 | (b) | `hud.js:147 drawSettingsButton` |
| 设置蒙层（退出/再来一次/继续 + 二次确认） | (b) | `ui-runtime.js:541 drawSettingsOverlay` |
| 暂停界面（面板 + 统计 + ✕） | (a) `data/ui/interface.json` | `ui-runtime.js:337`（`state==='paused'` 或 `level.ui==='interface'`） |
| 商店页（页签式·黑白极简，顶部标题+双币、左侧4页签选中=白色矩形、右卡片5/排纵向滚动带顶/底留白；**武器页签列表=`weaponCatalog()` 已注册武器（不含基础 radial）；卡片中央渲染「固定图标背景资产 `assets/asset-1788442424562`（下层）+ 武器外观 `appearance`（上层）」两层叠加，用 `drawDesignCentered` 以设计原点居中；无 `appearance` 回退 `drawWeaponGlyph`；未达解锁等级显示锁+「到达xx级后解锁」；可达则购买按钮黑底+金币图标（画到 cardG）+价格+聚焦放大10%**） | (b) 参数取自 `data/ui/weapon.json`（含 `padV`） | `screens.js:131 drawWeaponShop` |
| 关卡选择（2 页：页1=模式选关 探险/守卫，页2=探险子关选关） | (b) | `screens.js:84 drawLevelSelect` |
| 局内商店 + 老虎机占位（售货机） | (b) | `screens.js:15 drawVendorShop` |
| 神像三选一祝福卡（底部黑条蒙层飞入 + 白卡悬停放大 10%，点空白反向滑出关闭） | (b) | `world-overlay.js:214 drawIdolOffer` |
| 存档选择页 | (b) | `save-login.js:32 drawSaveSelectUI` |
| 工坊页（拖拽/背包/加点） | (b) | `workshop.js:14 drawWorkshopUI`（**属 gameplay，详见 gameplay-systems skill**） |
| 世界层悬浮 tips（传送门「撤离」/神像/图标/售货机 + F 键帽） | (b) | `world-overlay.js:77/122/167/261` |
| 宝箱十字星、传送门特效 | (b) | `world-overlay.js:11/310/321` |
| 关卡结算全屏页（撤离成功/失败 + 进度球 + 击败/收获列表 + 回到大厅） | (b) | `screens.js:416 drawSettlement`（`state==='end'`/`'fail'`） |
| 转场黑幕 / 关卡入场淡入 / 虫洞开场 | (b) | `ui-runtime.js:383-391` |
| 全屏菜单页/设置蒙层开关 蒙层淡入淡出 | (b) | `ui-runtime.js:412 openMenuScreen` / `:422 closeMenuScreen` / `:434 pageFadeAlpha` / `:442 drawPageFadeOverlay` / `:455 openSettingsOverlay` / `:464 closeSettingsOverlay`；恒定 `PAGE_FADE_MS` |

**跨分类指路**：工坊页交互与背包 → gameplay-systems skill；编辑器画布手柄、UI 配置页、关卡 schema → engine-editor skill；伤害/价格/掉落数字 → economy-numbers skill；子弹与武器行为 → combat 相关 skill。

## 2. 文件地图

| 文件 | 职责 | 关键导出 | 行数 |
| --- | --- | --- | --- |
| `src/systems/ui/ui-runtime.js` | UI 运行时核心：相机装配、文本/贴图工厂、屏幕状态判定、`drawUI` 主调度、点击派发、按下动画 | `UiRuntimeMixin`（30 个方法）、`ICON_SETTINGS/EXIT/RETRY/CONTINUE`、`WEAPON_SLOT_LEVELS`、`PAGE_FADE_MS` | 634 |
| `src/systems/ui/hud.js` | 战斗 HUD 状态机（explore/combat/secure/black 脉冲）与 HUD 各元素绘制；`drawHud` 调 `_trackHudGhosts` 维护血/盾受伤残弧状态（hp/shield 下降记 from→to，约 1s 渐隐）；**HUD 整体入场动画**：`hudEnterAlpha()` 在关卡开场(`levelIntro`)后驱动战斗 HUD（battle 节点图+血盾/弹药/充能+顶部 EXPLORE 条+小地图）淡入 0.5s→停留 0.2s→闪烁(消失 0.3s→渐显 0.5s 出现)，渐显用 smoothstep(`hudEaseInOut`，开头慢/中段自然/结尾缓，避免前段跳涨观感像瞬现)；`setHudAlpha(a)` 把 alpha 统一应用到全部独立对象；`hudIntro/hudIntroDone` 由 `level-flow.js restart` 重置 | `HudMixin`（14 个方法）、`HUD_IDLE_MS` | 324 |
| `src/systems/ui/screens.js` | 全屏弹窗页绘制：局内商店 / 关卡选择（2 页：页1 模式选关 探险/守卫 卡、页2 探险子关平行四边形+旋转圆环+可拖背景网格）/ 商店页 / **关卡结算全屏页**（页签式+纵向滚动+购买逻辑，黑白极简：黑面板+白卡+黑字+灰边；**武器页签接入武器系统数据：武器列表 = `weaponCatalog()` 已注册武器（**不含基础武器 radial**，新注册自动同步）；卡片中央用固定「武器图标背景」资产+武器 `appearance` 两层叠加渲染，外观/背景用 `drawDesignCentered`（**以设计原点为中心**而非 `renderAssetFit` 的包围盒几何中心——旋转动画元素致 bcx/bcy 偏移使 minigun 等外观偏离中心）；无 `appearance` 回退 `drawWeaponGlyph`；解锁等级读 `getWeaponDef(type).unlockLevel`，未达级显示锁+「到达xx级后解锁」无购买按钮；购买按钮黑底+金币图标（**黄菱形画到 `cardG`，不能复用 drawDiamond 的 `g`=uiG depth1000 会被按钮黑底 depth1001 盖住**）+价格数字+聚焦放大10%（`shopBuyHover`），价格取 `node.prices[type] ?? def.price`**） | `ScreensMixin`（11 个方法）、`drawWeaponShop`、`drawSettlement`、`drawBigLevelSelect`、`drawSmallLevelSelect`、`drawTechRing`、`handleShopPointerDown/Up`、`updateShopScrollDrag`、`buyPet` | 773 |
| `src/systems/ui/world-render.js` | 世界层：背景图、6 类精灵 Map 同步、主渲染循环 `draw()`（含掉落物绘制分派 `:550`）；未知房间揭示 alpha（`roomRevealAlpha`）应用到敌人/木箱/传送门/掉落及各精灵 sync（`syncXxxSprite` `setAlpha`/`setVisible`） | `WorldRenderMixin`（12 个方法） | 711 |
| `src/systems/ui/world-overlay.js` | 世界层悬浮 UI 与特效：4 种 tips、宝箱十字星、神像祝福卡（底部黑条飞入+白卡悬停放大 20%；卡片图标读 `card.icon` 画板资产渲染，张数按 `offer.cards.length` 自适应）、屏外实体指引箭头（视窗边缘白箭头） | `WorldOverlayMixin`（11 个方法） | 454 |
| `src/systems/ui/minimap.js` | **多箱庭小地图**（左上角**固定视窗** `MM_VIEW_W×MM_VIEW_H=480×270`，玩家白点恒居中、世界随玩家滚动）：等大箱庭正方形（`MM_CELL=80`，大小差异不体现）+ 每格标记（战斗/神像/宝箱/商人/BOSS）+ 灰色通道（`MM_CHANNEL 0x808080`，箱庭间距 `MM_GAP=45`）。仅 `roomLayout.mode==='multi'` 且非编辑态/非菜单/非结算时绘制；黑底白框直角（箱庭同款，`MM_BG 0x000000`/`MM_BORDER 0xffffff`，视窗白框 `MM_FRAME_W=20`）；**视窗裁剪用持久 `GeometryMask`**（`minimapMaskG`/`minimapContentG`/`minimapFrameG`，参照 `screens.js` shopCard 模式）；标记图标走画板动态资产（`getDesign`+`renderAsset`，空则中文文字占位）；**未知房间未揭示时以「未知」占位，揭示后显示真实标记**（`roomRevealAlpha` 判定）；**玩家在箱庭内用所属箱庭映射，在通道/间隙时用相邻两箱庭参考系线性融合（`refOf`+A→B 投影 `u`），保证穿越边界/切换锚点小地图位置连续不跳变**。在 `ui-runtime.js` 战斗态兜底分支调用 | `MinimapMixin`（`drawMinimap` / `hideMinimapOverlay`） | 211 |
| `src/systems/ui/entity-art.js` | 实体美术纯函数（无 `this`）：玩家六边形+环、敌人形状、墙体、木箱、虫洞、护盾弧、平行四边形、掉落货币四角菱形图标 | `color`、`drawPlayer`、`drawEnemyShape`、`drawWallShape`、`drawWormhole`、`drawShieldArc`、`drawParallelogram`、`strokeDiamond`、`drawDropDiamond` 等 30+ | 613 |
| `src/systems/ui/hud-art.js` | HUD 绘制纯函数：左下角「武器外观+图标背景」叠加头像（背景 144px/外观 96px；**普通武器局内本体 `drawHexRingPlayer` 用 `weaponAngle = t*2.5` 动态绕环转动**）、**270° 圆弧血条（外圈 r105）/护盾条（内圈 r84）**（中心 `(70,970)` 上移防遮挡、顶起顺时针、弧厚 7.5；受伤残弧 from→当前，红/深蓝随 `ghost.age` 渐隐）、武器轮盘、武器图标底座 | `drawHudAvatar`、`drawHudBars`、`drawArcBar`、`drawWeaponWheel`、`drawWeaponIcon`、`wheelOrder`、`lerpColor` | 140 |
| `src/ui-layer.js` | 数据驱动渲染器 + 共享绘制件（**含 hover/press 状态感知 + 自定义多边形 poly**） | `renderGraph`、`drawPanel/Bar/Button/Shape/Poly`、`drawWeaponGlyph`、`drawLock`、`UI_COLORS` | 319 |
| `src/ui-bindings.js` | 节点 id → 运行时数据绑定表（9 条） | `BINDINGS` | 12 |
| `src/ui-config.js` | 编辑器 UI 配置页（节点属性表单、新增节点模板、绑定下拉、**可视化画布编辑器入口**、interact/hover 交互字段、poly 顶点编辑） | `NEW_NODE` 模板、表单渲染、`renderUIConfigPage`（**详见 engine-editor skill**） | 231 |
| `src/ui-editor.js` | UI 配置页可视化画布编辑器：点选/拖动/缩放节点、选中覆盖层、与表单实时同步、**hover 实时预览 + poly 点拖动编辑** | `UIEditor` `initUIEditor` `getUIEditor`（**详见 engine-editor skill**） | 391 |
| `src/ui-preview.js` | Canvas 2D 侧的节点图预览（编辑器用，非 Phaser，**支持 hover 渐变 + poly**） | `renderUIPreview` | 215 |
| `src/ui-interact.js` | **数据驱动 UI 交互状态纯函数引擎**：hover 渐变插值、事件/命中矩形、自定义多边形绘制参数混合（Phaser 运行时与 Canvas 编辑器预览共用） | `interactProgress` `blend` `lerpColor` `nodeRect` `lerp` | 57 |
| `src/ui.js` | DOM 辅助：取节点、状态条、关卡列表、预览面板（改件区按库存数量渲染 + 宠物区「拥有/装备」） | `getDom`、`setStatus`、`renderLevels`、`renderPreviewWeapons/Mods/Pets` | 125 |
| `src/ui-library.js` | 可复用 UI 组件库（注册表 + 组件定义）：`LoginButton`（登录按钮）/ `GiftCard`（赐福卡）/ `WeaponCard`（工坊武器卡，含可配置通用/专属改件槽数） | `registerComponent` `getLibrary` `registerBuiltinComponents` `LoginButton` `GiftCard` `WeaponCard` | 323 |
| `src/systems/constants.js` | UI 相关共享常量 | `VIEW_W/VIEW_H`、`FONT_TECH(_SC)`、`PLAYER_ART`、`SETTLE_*`、`WEAPON_BG_ASSET`、各贴图键 | 91 |
| `src/game-scene.js` | 场景骨架：`create` 装 UI、`update` 驱动，末尾 `Object.assign` 装配 21 个 mixin | `createGameScene` | 603 |
| `data/ui/battle.json` | 战斗 HUD 数据节点（5 个） | — | 13 |
| `data/ui/interface.json` | 暂停/界面页节点（6 个）+ `stats` / `sections` | — | 21 |
| `data/ui/login.json` | 登录页节点（3 个：image + 2 text） | — | 11 |
| `data/ui/weapon.json` | 商店页**参数**（`nodes` 为空，靠 `weapons`/`prices`/`modPrices`/卡片与页签布局字段） | — | 28 |
| `data/ui/workshop.json` | 工坊页**参数**（`nodes` 为空，`trees`/布局字段） | — | 14 |

### 改 X 该动哪个文件（速查）

| 需求 | 动这里 |
| --- | --- |
| 改血条 / 护盾条位置或长度 | `src/systems/ui/hud-art.js:30 drawHudBars`（硬编码 `135,1018` / `125,1040`，宽 304 高 16） |
| 改 HUD 状态条颜色 / 文案 / 动画时长 | `src/systems/ui/hud.js:14-24`（`HUD_RECT_*`、`HUD_TRANSITION_MS`、`HUD_STATES`） |
| 母舰 Boss 顶部血条 | `hud.js:drawBossBar/updateBossBar`（条宽 `VIEW_W*(2/3)*0.795625`≈1018、`(VIEW_W-barW)/2` 居中——**缩到与左上小地图留间距**：小地图右缘 `MM_X+MM_VIEW_W`(16+408=424) < 血条左缘(450.8)，间距≈26.8px；名称 `FONT_TECH` **不加粗**、左对齐在条上）。位于 EXPLORE 条 `HUD_RECT_Y+HUD_RECT_H+24` 下方；显示动画名称+条容器随 `bossBarReveal` 0→1（≈0.8s）展开。血量=`bossTarget.hp/maxHp`，**当前血量白色填充**；受击后最近掉的血量经 `_trackBossGhost`（`bossGhost={fromRatio,toRatio,start}`，约 1s 线性渐隐）画成**红色残段**覆盖在白色填充右端，对齐玩家血条 ghost 机制。只消费 `bossTarget/bossBarReveal`（由 `combat/triggers.js:startBossBattle` 设置），目标死亡置 `bossTarget=null` 清除；文本对象懒建并 `cameras.main.ignore`，`hideHudOverlay` 需补 `setVisible(false)` |
| 改金币 / 等级 / 击杀 文本位置或字号 | `data/ui/battle.json`（改 JSON，不用碰代码） |
| 新增一个绑定数值（如「护盾 12/50」） | `src/ui-bindings.js` 加 key → `data/ui/*.json` 节点写 `bind.text` → `src/ui-config.js:4 BINDING_OPTIONS` 补下拉项 |
| 加一个登录页按钮 | `src/systems/gameplay/save-login.js:87 loginButtons` 加 def → 同文件 `onLoginButtonClick` 加分支（纯静态图文可改 `data/ui/login.json`） |
| 加/改武器商店价格 | `data/ui/weapon.json` 的 `prices` / `modPrices`（页签式布局在 `screens.js:131`） |
| 改商店页签 / 卡片布局（一排 5 个、网格尺寸、货币区） | `data/ui/weapon.json` 的 `cardsPerRow/cardW/cardH/gapX/gapY/gridX/gridY/gridW/gridH/tabX/tabY/...` 与 `screens.js:131 drawWeaponShop` |
| 加/改商店页签（新页签，如「时装」） | `screens.js:drawWeaponShop` 的 `tabs` 数组 + `shopTab` 分支 + `onUIPointer` 的 `shopTab_` 前缀（已泛化，仅需加分支） |
| 加/改宠物卡片（局内购买） | `screens.js:drawWeaponShop` 的 `shopTab==='pet'` 分支遍历 `listPetDefs()`（`pet-store.js`，数据在 `data/pets/*.json`）；价格/解锁读 `pd.price/.unlockLevel`；购买 `screens.js:buyPet` 写 `source.items.uniques`；按钮前缀 `buyPet_`（`ui-runtime.js:onUIPointer`） |
| 改玩家数据面板宠物配置 | `index.html` 的 `pvPets`/`tpPets` 区 + `ui.js:renderPreviewPets` + `player-panels.js:bindPetPanel`（拥有进 `items.uniques`、装备进 `equipment.pets` 上限2） |
| 改关卡选择（2 页：模式选关/子关选关/解锁/拖动网格） | `src/systems/ui/screens.js:84 drawLevelSelect`（`drawBigLevelSelect`/`drawSmallLevelSelect`）+ `ui-runtime.js` onUIPointer 分支（`levelMode_`/`levelSmall_`/`levelBack`）+ `editor-input.js` 页2拖动 |
| 改关卡结算页（撤离成功/失败、进度球、击败/收获列表、回到大厅） | `src/systems/ui/screens.js:416 drawSettlement`（布局 `(dx-485)*6,(dy-376)*6`）+ 常量 `SETTLE_SUCCESS_COLOR/SETTLE_FAIL_COLOR/SETTLE_BALL_R`（constants.js:14-16）；数据源 `killTally`/`runGoldGained`/`runExpGained`（enemy-ai/drops/level-flow 维护，结算页只读） |
| 改设置蒙层按钮 / 图标 | `src/systems/ui/ui-runtime.js:541 drawSettingsOverlay` + `ui-runtime.js:16-19` ICON 常量 |
| 改传送门 / 神像 / 售货机悬浮提示文案 | `src/systems/ui/world-overlay.js:109 / :154 / drawVendorUI` 的 `tip.setText` |
| 改屏外实体指引箭头（边缘白箭头 / 图标 / 淡入淡出） | `world-overlay.js:376 updateGuideArrows` + `:414 drawGuideArrows`；数据字段 `guide/guideRange/guideIcon/guideStopAfterUse` 见 level-design skill；外观依设计稿 `docs/ui-designs/ui-arrow.json` 放大 1.5 倍（白圆 r12 图标位 + 白三角尖端朝实体：尖 33/底 13.5/半宽 9.75；图标资产半径系数 11、名称占位文本 20px） |
| 改宝箱 / 传送门 / 桶精灵尺寸与贴图 | `src/systems/constants.js`（`CHEST_SIZE`、`CHEST_*_KEY`、`BARREL_ICON`…）+ `world-render.js` 对应 `syncXxxSprites` |
| 改玩家外观（六边形 / 环 / 倾斜） | `src/systems/constants.js:39 PLAYER_ART` + `src/systems/ui/entity-art.js:523 drawHexRingPlayer` |
| 改敌人形状 | `src/systems/ui/entity-art.js:395 drawEnemyShape`（按 `e.type` 分支） |
| 改掉落物图标（金币黄菱形 / 钻石天蓝菱形 / 经验充能圆点） | `world-render.js:550` 按 `d.type` 分派 + `entity-art.js:423 drawDropDiamond`（颜色在分派处传参 `0xffd54f` / `0x00e5ff`） |
| 新增一个点击按钮回调 | 绘制处 `this.buttons.push({id,x,y,w,h})` → `src/systems/ui/ui-runtime.js:615 onUIPointer` 加 id 分支 |
| 调整每帧渲染顺序 | `src/systems/ui/world-render.js:336 draw()`（世界层）与 `ui-runtime.js:243 drawUI()`（UI 层） |
| 改/加小地图（多箱庭） | `src/systems/ui/minimap.js`（`MinimapMixin:drawMinimap`，战斗态兜底分支 `ui-runtime.js` 调 `this.drawMinimap(this.uiG)`）+ 格子/面板布局常量在文件顶部；标记数据契约见 level-design skill §3.8 `cells[].marker` |
| 加/改一层 depth | 见第 5 章 depth 分层表，改对应 `setDepth()` 调用点 |

## 3. 核心数据结构

### (a) `data/ui/*.json` 节点图 schema

顶层：`{ id, type, name, nodes: [...] }`；`weapon.json` / `workshop.json` 额外挂业务参数（`prices`、`modPrices`、`weapons`、`trees`、`x/y/w/h/listX/listY/cardW/cardH/gap/skew`），这些由 `screens.js:drawWeaponShop(node)` 与 `workshop.js` 读取，不走 `renderGraph`。

节点通用字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一键；`text`/`image` 节点靠它在 `uiTexts`/`uiImages` Map 里查对象；`button` 节点它就是 `onUIPointer` 的分支 id |
| `type` | enum | 见下表，7 种 |
| `x` / `y` | number | 1920×1080 UI 坐标；`text` 为左上角，`image` 为中心（origin 0.5） |
| `w` / `h` | number | panel/bar/button/shape/image 用 |
| `visible` | bool | `false` 时 `renderGraph` 跳过（`ui-layer.js:218`） |
| `bind` | `{text?, ratio?}` | 值为 `BINDINGS` 的 key，见下 |
| `interact` | `{hover:{fill?, stroke?, dx?, dy?, scale?, alpha?, animMs?}}` | **悬停/聚焦交互配置**：鼠标命中该节点时按 `animMs` 平滑渐变到 hover 覆盖值（fill/stroke 颜色 lerp、dx/dy 位移、scale 缩放、alpha），离开渐变回 idle。运行时由 `ui-runtime.js drawUI` 每帧用 `nodeRect` + `uiPointer()` 计算命中集，经 `ui-interact.js:interactProgress` 生成进度，`ui-layer.js:drawXxx` 混合渲染。 |

各 `type` 支持字段与渲染函数：

| type | 专有字段 | 渲染函数 | 备注 |
| --- | --- | --- | --- |
| `panel` | `fill` `stroke` `radius`(默 8) `alpha`(默 0.9) | `ui-layer.js:92 drawPanel` | 圆角面板 |
| `bar` | `fill` `bg` `stroke` + `bind.ratio` | `ui-layer.js:104 drawBar` | 比例条，ratio 夹到 0..1 |
| `icon` | `kind: 'coin'\|'heart'` `r` `fill` | `ui-layer.js:118/130` | 只这 2 种 kind |
| `shape` | `kind: 'parallelogram'\|'ring'\|'arc'\|'poly'\|(默矩形)`、`skew` `r` `thickness` `start` `sweep` `radius` `lineWidth` `alpha`；**`poly` 用 `points:[{x,y}]`（相对 node 原点）+ `closed`** | `ui-layer.js:140 drawShape` / `:201 drawPoly` | 通用几何；`poly` 为自定义多边形（可从编辑器配 `points` 顶点） |
| `image` | `src` `angle` | `ui-layer.js:234` + 精灵在 `loadUIImages` 预建 | `src` 走 HTTP 路径；只定位/缩放/旋转已存在精灵 |
| `button` | `label` `disabled` | `ui-layer.js:244 drawButton` | `label === '✕'` 时额外画叉；自动 push 进 `buttons` |
| `text` | `size`(默 24) `color`(默 `#eaf4fb`) `bold` `text` + `bind.text` | `ui-layer.js:251` | 精灵在 `buildUITexts` 预建；字体固定 `FONT_TECH_SC` |

页面用途：

| 文件 | 何时渲染 | 节点数 |
| --- | --- | --- |
| `login.json` | `isMenuLevel()` 为真（`level.ui === 'login'`，即 `data/levels/login.json`） | 3 |
| `battle.json` | 战斗态兜底分支（非 hub、非 login、非 paused/end） | 5 |
| `interface.json` | `state === 'paused' \| 'end'` 或 `level.ui === 'interface'` | 6 |
| `weapon.json` | `menuScreen === 'weapon'`，只取参数不取 nodes | 0 |
| `workshop.json` | `menuScreen === 'workshop'`，只取参数不取 nodes | 0 |

`BINDINGS` 结构（`src/ui-bindings.js`）：`{ [key]: (uiState) => string|number }`，纯函数，输入只有 `uiState`。`renderGraph` 内 `resolve()`（`ui-layer.js:203`）查表调用，返回 `undefined/null` 时回退到 `node.text` / 0。9 条：`hpRatio` `hpText` `shieldRatio` `shieldText` `expRatio` `gold` `level` `kills` `weaponLevel`。新增绑定必须同步 `ui-config.js:4 BINDING_OPTIONS` 否则编辑器下拉里选不到。

### (b) 运行时 UI 状态

`this.uiState`（`ui-runtime.js:196 syncUIState` 每次产出全新对象，是 `BINDINGS` 唯一数据源）：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `screen` | 计算 | `'login' \| 'interface' \| 'battle'` |
| `hp` / `maxHp` | `player` | 默认 100/100 |
| `shield` / `maxShield` | `player` | maxShield 默认 `SHIELD_MAX`=50 |
| `slots` | 计算 | `1 + WEAPON_SLOT_LEVELS.filter(lv => level >= lv).length`（阈值 12/30） |
| `level` / `exp` / `expToNext` | `player` | 默认 1/0/100 |
| `gold` / `kills` | `player` / `this.kills` | |
| `weaponLevel` / `weaponType` / `weapons` / `loadout` | `player` | 默认 `'radial'` |
| `equipment` / `items` / `combat` / `points` / `spendablePoints` | `player` | 对象，缺省 `{}` / `{stacks:{},uniques:[]}` |

`this.buttons`：每帧在 `drawUI()` 开头清空为 `[]`，绘制过程中各处 push，`onUIPointer` 顺序遍历命中即 return。元素结构：

| 字段 | 说明 |
| --- | --- |
| `id` | 分支键，约定前缀：`upgrade_` `buyWeapon_` `buyMod_` `buyPet_` `buyBuff_` `idolCard_` `workshopCard_` `workshopTab_` `workshopSlot_` `shopTab_` `selectSave_` `levelMode_` `levelSmall_`；固定 id：`menuClose` `close` `levelBack` `settings_exit/retry/continue/confirm/cancel` `saveSelectBack` `settleHome` |
| `x` `y` `w` `h` | UI 坐标矩形（左上角 + 尺寸），命中判定是纯 AABB |
| `disabled` | 仅 `button` 节点会带；`onUIPointer` **当前不检查它** |
| `node` | 可选透传：`levelMode_` 用 `node.key`(explore/guard)+`node.unlocked`、`levelSmall_` 用 `node.levelId`+`node.unlocked`、`buyWeapon_` 用 `node.type/price` |

状态枚举与转移：

| 状态字段 | 取值 | 转移条件 |
| --- | --- | --- |
| `this.hudMode` | `explore` / `combat` / `secure` | 初始 `explore`（`level-flow.js:105`）；`triggers.js:46` 进战 → `combat`；`triggers.js:48` 清场 → `secure` 并 `autoReturn` 1500ms 回 `explore` |
| `this.hudAnim` | `null` / `{fromColor,toColor,fromText,toText,t,dur,phase}` | `phase`：`switch`（切换）→ null；`idleBlack`（当前色→黑）→ 自动接 `idleBack`（黑→当前色）→ null |
| `this.hudIdleClock` | number ms | `playing` 且无 anim 时递减，到 0 触发脉冲并重置为 `HUD_IDLE_MS`=3000 |
| `this.menuScreen` | `null` / `weapon` / `workshop` / `vendor` / `saveSelect` / `levelSelect` | `openMenuScreen(s)`（编辑态或已有页时拒绝）；`closeMenuScreen()`；ESC / `menuClose` 按钮 |
| `this.shopTab` | `'weapon'` / `'mod'` / `'pet'` / `'relic'` | 商店页当前页签；`openMenuScreen('weapon')` 重置为 `'weapon'`；页签按钮 `shopTab_xx` 切换 |
| `this.shopScroll` / `this.shopMaxScroll` | number ≥0 | 商店页卡片网格的纵向滚动量与上限；`drawWeaponShop` 每帧刷新 `shopMaxScroll`，滚动范围 `0..max(0, contentHeight - gridH)` |
| `this.shopScrollDrag` / `this.shopScrollArea` | `null`/`{startY,scroll}`、`{x,y,w,h}` | 商店页拖拽滚动状态与网格可视区；`handleShopPointerDown/Up` 维护，`updateShopScrollDrag` 每帧钳制并 `drawUI()` |
| `this.shopHoverT` / `this.shopTabAnim` / `this.shopTabPrev` | dict / `null`/`{fromX,fromY,toX,toY,t0,dur}` / string | 页签悬停缩放进度(0..1)、选中矩形背景滑动动画、上一页签；`drawWeaponShop` 内每帧维护 |
| `this.shopCardContentG` / `this.workshopCardContentG` | Phaser Graphics | 卡片形状专用 Graphics，创建时一次性 `setMask(mask)`（持久裁剪）；`drawUI` 离开对应页时 `clear()` |
| `this.prevState` | `'playing'` / `null` | `openMenuScreen` 记录暂停前状态，`closeMenuScreen` 恢复 |
| `this.settingsMode` | `null` / `'menu'` / `'confirm'` | 点设置按钮 → `menu`；`settings_exit` → `confirm`；`settings_cancel` → `menu`；`settings_continue`/ESC → null |
| `this.settingsPrev` | `'playing'` / `null` | 同 `prevState` 语义，用于设置蒙层 |
| `this.state`（场景态，非 UI 私有） | `playing` `paused` `transition` `end` `fail` | 决定 `drawUI` 走哪个分支 |
| `this.idolOffer` | `null` / `{idol, cards[3], startT, hoverT[3], closing, closeStart}` | `interactables.js:195` 触发神像；选卡或**点空白触发离场**后置 null，点空白**不消耗神像**可再交互。**优先级最高**，盖过 settings/menu；`startT` 驱动滑入、`hoverT` 插值 hover 放大、`closing=true` 时 `closeStart` 驱动反向滑出，结束调 `closeIdolOffer` |
| `this.levelSelectPage` | `1` / `2` | 选关页当前页：1=模式选关(探险/守卫卡)，2=探险子关选关。`openMenuScreen('levelSelect')` 重置 1；`levelMode_explore` → 2；`levelBack` → 1；关闭时 `ui-runtime.js:268` 重置 1 |
| `this.pageFade` | `null` / `{phase:'in'\|'out', t0, dur}` | 全屏菜单页/设置蒙层开关的蒙层淡入淡出机：`openMenuScreen`/`openSettingsOverlay` 置 `'in'`（蒙层 alpha 1→0，页面淡入）；`closeMenuScreen`/`closeSettingsOverlay` 置 `'out'`（蒙层 0→1，页面淡出），均 `dur=PAGE_FADE_MS`。`drawUI` 内 `pageFadeAlpha()`+`drawPageFadeOverlay()` 每帧叠黑幕，'out' 完成调 `finishCloseMenuScreen`/`finishCloseSettings` 真正关页并恢复 `state`。旧 `levelSelectClosing`/`levelSelectFadeStart`（仅选关页特例）已并入本机制移除 |
| `this.levelSelectOpenAt` | number | 打开选关页时间，驱动页1卡片「翻牌出现」动画（`0.72→1` 缓动 460ms） |
| `this.minimapTexts` | `Map<key, Text>` | 小地图标记文字占位（`minimap.js` 内 `ensure` 懒建，`setDepth(1001)` + `uiCam.ignore`）；`drawUI` 头部与 `hud.js:hideHudOverlay` 均调 `hideMinimapOverlay()` 全隐 |
| `this.smallLevelPan` / `this.levelSelectDrag` | `{x,y}` / `null`/`{sx,sy,ox,oy}` | 页2可拖背景网格的偏移与拖动状态；`pointerDown`(不命中按钮时) 记 drag，`pointerMove` 更新 pan，`pointerup` 清空（`editor-input.js:20/211`） |
| `this.levelHover` / `this.levelConn` | dict | 页1/页2按钮悬停缩放进度(0..1)与圆环→按钮白色连线伸展进度，按帧插值 `target-cur)*0.16/0.18` |
| `this.settleStart` | `number` / `undefined` | 结算页动画时钟：`drawSettlement` 首帧记录 `time.now`，用 `time.now - settleStart` 驱动出现/连线延展/count-up；`restart()`（`level-flow.js`）置回 `undefined` |
| `this.settleTexts` | `Map<id, Text>` | `drawSettlement` 内 `ensure()` 懒建（depth 1001，`cameras.main.ignore`）；`drawUI` 离开 end/fail 态时批量隐藏（`ui-runtime.js:272`） |
| `this.killTally` / `this.runGoldGained` / `this.runExpGained` | 对象 / number | 结算页数据源（**只读**）：`killTally={type:count}` 由 `enemy-ai.js:defeatEnemy` 增量、`runGoldGained/runExpGained` 由 `drops.js:collectDrop` 增量，三者均在 `level-flow.js:restart` 归零（属 combat/economy，见各自 skill） |
| `this.guideAlphas` / `this.guideMarkers` / `this.guideTexts` | `Map<entity,alpha>` / `[{x,y,angle,alpha,entity,label}]` / `Map<entity,Text>` | 屏外实体指引箭头状态：`updateGuideArrows(dt)`（`game-scene.js:510` 调度）每帧重建 markers（淡入淡出 200ms，`GUIDE_FADE_MS/GUIDE_EDGE_INSET` 模块常量）；`drawGuideArrows(g)`（`world-render.js:571`）画白圆+白三角+资产/名称占位文本（depth 13，`uiCam.ignore`）；三者在 `level-flow.js:restart` 清空重建（markers 键是实体对象，重开换引用） |
| `this.wheelAnim` | `null` / `{from,to,t,dur:500}` | 换武器时 `player-combat.js:85` 设置 |

文本 / 贴图 Map 组织：

| 容器 | 结构 | 建立时机 | 生命周期 |
| --- | --- | --- | --- |
| `this.uiTexts` | `{battle,interface,login,weapon,workshop: Map<nodeId, Text>}` | `buildUITexts()`（每次载入关卡） | 载入时全 destroy 重建 |
| `this.uiImages` | 同上，`Map<nodeId, Image>` | `loadUIImages()` 异步 `Image.onload` | 同上；贴图键 `__ui_img_{page}_{id}__` |
| `this.settingsTexts` | `Map<id, Text>` | `drawSettingsOverlay` 内 `ensure()` 懒建 | 常驻，靠 `setVisible` 开关 |
| `this.weaponShopTexts` / `vendorShopTexts` / `levelSelectTexts` / `idolOfferTexts` / `saveSelectTexts` / `workshopTexts` | `Map<id, Text>` | 各 `drawXxx` 内 `ensure()` 懒建 | 常驻，`drawUI` 开头按 `menuScreen` 批量隐藏 |
| `this.menuIconSprites` | `Map<id, Image>` | `world-render.js:14 iconSprite(id, src)` 懒加载 | 常驻，贴图键 `__menu_icon_{id}__` |
| `this.loginLabels` | `Map<id, Text>` | `drawLoginButtons` | 常驻 |
| 世界层精灵 | `barrelSprites` `chestSprites` `vendorSprites` `idolSprites` `iconSprites` `portalTexts` `levelImageSprites` `gateTexts`（均 Map，`game-scene.js:43-52` 初始化） | 各 `syncXxxSprites` 按需建/删 | 数据里消失时 destroy |

## 4. 关键流程

**① 场景启动 → 首帧 UI**
`game-scene.js:40 create()` → 建 `bgG`(depth 0) / `g`(depth 10) 与 8 个精灵 Map → 预载桶/宝箱/售货机/神像贴图 → `:70 if (!this.editing) setupUI()`
→ `ui-runtime.js:24 setupUI()`：`cameras.add` 建 `uiCam` → 建 `uiG`(depth 1000) → **互相 ignore**（`cameras.main.ignore(uiG)`、`uiCam.ignore(g/bgG)`）→ 建工坊遮罩 → 初始化 `uiTexts/uiImages/buttons` 等容器 → 建常驻文本（failTitle/failHint/weaponLabels×3/ammoCurrent/ammoMax/hudIndicatorText，全部 depth 1001 且 `cameras.main.ignore`）→ `loadWeaponIcon()` → `:91 loadUIImages()`（遍历 5 个页面的 `image` 节点，`new Image()` 异步 → `textures.addImage` → `add.image` → 默认 `setVisible(false)`）
→ `create():99 restart()` → `level-flow.js:250 buildUITexts()`（先 destroy 旧文本/贴图 → 再 `loadUIImages()` → 为所有 `text` 节点建 Text）→ `:251 syncUIState()` → `:255 draw()` → `world-render.js:579 drawUI()`。

**② 每帧渲染顺序**
`game-scene.js:139 update(_, dt)` → （编辑态直接 `draw()` 返回）→ 工坊长按/滚动 → 闸门动画 → `updateLoginHover()` → intro/ESC/transition/非 playing 各分支都以 `this.draw()` 收尾 → 正常帧跑玩家移动、战斗、`:480 updateHud(dt)`、`:493 syncUIState()` → `:494 draw()`
→ `world-render.js:336 draw()`（世界层，画到 `bgG`/`g`）：`bgG.clear()` + 底色 → `applyBackground()` → `syncLevelImages()` → `g.clear()` → 虫洞 fx → 网格 → 墙 → 木箱 → `syncBarrelSprites` → `syncChestSprites` / `syncVendorSprites` / `syncIdolSprites` / `syncIconSprites` → `drawIcons` → `syncPortalSprites` → `drawChestEffects` → 传送门形状 + `drawPortalEffects` → `drawGates` → 触发器 / 生成区（编辑态）→ 敌人 + 命中特效 + 掉落 → `drawPlayer` + `drawShieldArc` → 新手提示 → `drawHubUI` / `drawVendorUI` / `drawIdolUI` / `drawIconUI` / `drawPortalUI` / `drawGuideArrows`（`:565-571`）→ 子弹与拖尾 + `drawHitFlash` → **`:579 drawUI()`**
→ `ui-runtime.js:243 drawUI()`（UI 层，画到 `uiG`）：`uiG.clear()` → `buttons = []` → **所有 uiTexts / uiImages / menuIconSprites / settingsTexts 及各页 Map `setVisible(false)`** → fail 分支（黑幕 + 返回）→ 按优先级分支：`idolOffer` > `settingsMode` > `menuScreen`（黑底 + 对应页 + 右上关闭按钮）> `isMenuLevel()`（login 节点图 + 登录按钮，intro 期全隐）> `end/fail`（`drawSettlement` 结算全屏页）> `paused/interface`（interface 节点图）> `isHubLevel()`（只隐 HUD）> 兜底战斗（battle 节点图 + `drawHud()` + `drawHudIndicator()`）→ 最后叠 `transition` 黑幕与 `levelIntro` 淡入。

**③ 点击链路**
`create():72 input.on('pointerdown')` → `editor-input.js:12 pointerDown(p)` → 非编辑态：`menuScreen` 存在时（工坊先吃 `handleWorkshopPointerDown`）→ `onUIPointer(p)`；`isMenuLevel()` 时遍历 `loginButtonRects` → `pressAnim(id)` + `onLoginButtonClick(id)`；`playing` 且命中 `settingsButtonRect` → `openSettingsOverlay()`；`paused` → `onUIPointer(p)`；`end/fail` → `onUIPointer(p)`（命中 `settleHome` → `pressAnim` + `exitToHome()` 回骑士之家，旧 `restart()` 已移除，无重试）
→ `ui-runtime.js:226 uiPointer()` 换算：读 `canvas.getBoundingClientRect()`，按 `scale = min(rect.w/1920, rect.h/1080)` 还原 CSS `object-fit: contain` 的黑边偏移，输出 1920×1080 空间坐标
→ `ui-runtime.js:507 onUIPointer(p)`：`idolOffer.closing` 时直接 `return`；否则遍历 `this.buttons` 做 AABB 命中 → 按 id / id 前缀派发到业务回调（`applyUpgrade` / `buyWeapon` / `buyMod` / `buyBuff` / `chooseIdolBuff` / `toggleWorkshopWeapon` / `clickWorkshopSlot` / `ctx.onSelectSave` / `ctx.onOpenLevel` …）→ 命中即 `return`（一次只触发一个按钮）；**若 `idolOffer` 存在且未命中任何卡 → 置 `closing=true` 触发离场滑出（不消耗神像），动画完成后 `closeIdolOffer()`**。
hover 态不走事件：各 `drawXxx` 每帧自己调 `uiPointer()` 比矩形（如 `hud.js:150`、`ui-runtime.js:317`）。

**④ HUD 状态切换与脉冲**
`triggers.js:46 setHudMode('combat')` / `:48 setHudMode('secure', {autoReturn:{mode:'explore',delay:1500}})`
→ `hud.js:31 setHudMode`：写 `hudMode`，建 `hudAnim{phase:'switch', dur:500}`，有 `autoReturn` 时 `time.delayedCall` 回切
→ 每帧 `game-scene.js:480 updateHud(dt)` → `hud.js:48`：`hudAnim.t += dt`，到期清空；`phase==='idleBlack'` 时自动接 `idleBack` 第二段；无动画且 `playing` 时 `hudIdleClock -= dt`，≤0 触发 `idleBlack` 脉冲并重置 3000ms
→ `hud.js:88 drawHudIndicator()`：有 anim 时按 `p = t/dur` 从左到右画「目标色 | 来源色」两段矩形，label 用 `toText`，目标色为黑时文字转白；无 anim 时整块填当前状态色 → 定位并显示 `hudIndicatorText`。

**⑤ 弹窗页面开关**
- 全屏页：`interactables.js:155-157`（图标事件）/ `newbee-hub.js:122` / `save-login.js:15` / `interactables.js:241`（售货机）→ `ui-runtime.js:500 openMenuScreen(screen)`：编辑态或已有页则拒绝；`state==='playing'` 时记 `prevState='playing'` 并置 `state='paused'`（**暂停态处理点**）→ 下一帧 `drawUI` 走 `menuScreen` 分支 → 点右上 ✕（`buttons` 里 id `menuClose`）或 ESC（`game-scene.js:176`）→ `closeMenuScreen()` 恢复 `state='playing'`。
- 设置蒙层：`editor-input.js:37 openSettingsOverlay()` → `settingsMode='menu'` + `settingsPrev` 暂停 + **立即 `drawUI()`**（不等下一帧，因为暂停后 update 主循环可能不再走绘制）→ `drawSettingsOverlay` 画 82% 黑幕 + 三卡 → `settings_exit` → `settingsMode='confirm'` + `drawUI()` → `settings_confirm` → `exitToHome()`（清状态 + `ctx.onOpenLevel('knight-home')`）；`settings_retry` → `retryBattle()`（关蒙层 + `restart()`）；`settings_continue` → `closeSettingsOverlay()` 恢复 playing。
- ESC 优先级（`game-scene.js:169-186`）：`settingsMode`（confirm→menu，menu→关）> `menuScreen`（关）> `paused`（`ctx.onExitPreview`）> `toggleGrowth()`（playing↔paused）。

**⑥ 世界层精灵同步（为何用 Map 缓存）**
`draw()` 内每帧调 `syncBarrelSprites` / `syncChestSprites` / `syncVendorSprites` / `syncIdolSprites` / `syncIconSprites` / `syncPortalSprites` / `syncLevelImages`。模式统一：贴图未就绪则直接 return → 数据源按 `this.editing` 在 `ctx.state.level.xxx`（编辑态，显示全部）与运行时数组（过滤 `alive`/`spawned`/`visible`）间切换 → `seen` 集合记录本帧存在的 id → Map 里没有则 `add.image(...).setDepth(9)` 并 `uiCam.ignore(sprite)` → 有则只 `setPosition/setTexture/setScale/setVisible` → 遍历 Map，`seen` 里没有的 `destroy()` + 删键。
Map 缓存的原因：Phaser 精灵创建/销毁成本高且贴图是异步的，60fps 下不能每帧重建；用 id 作键可让「数据数组顺序变化 / 元素增删」都稳定复用，同时保证被删数据对应的精灵一定被销毁不残留。

## 5. 关键常量与数值

| 常量 / 数值 | 所在文件:行 | 当前值 | 含义 | 调它影响什么 |
| --- | --- | --- | --- | --- |
| `VIEW_W` / `VIEW_H` | `systems/constants.js:9` | 1920 / 1080 | UI 逻辑分辨率 | 所有 UI 坐标基准；改了必须同步 `uiPointer` 缩放与全部硬编码位置 |
| `CELL` | `systems/constants.js:9` | 30 | 网格尺寸 | 编辑器网格线密度、吸附步长 |
| `FONT_TECH` | `systems/constants.js:11` | `'Orbitron','Rajdhani','Poppins',sans-serif` | 数字/英文科技字体 | HUD 状态标签、弹药数字 |
| `FONT_TECH_SC` | `systems/constants.js:12` | `'Noto Sans SC','Orbitron',sans-serif` | 中文字体 | 所有中文文本（弹窗、tips、data/ui text 节点） |
| `HUD_RECT_W` / `HUD_RECT_H` | `systems/ui/hud.js:14` | 400 / 60 | 状态指示器矩形尺寸 | 顶部 EXPLORE/COMBAT 条大小 |
| `HUD_RECT_X` / `HUD_RECT_Y` | `systems/ui/hud.js:15-16` | 760（居中算得）/ 16 | 指示器位置 | 顶部条水平居中与离顶距离 |
| `HUD_TRANSITION_MS` | `systems/ui/hud.js:17` | 500 | 状态切换 / 脉冲单段时长 | 左右扫过动画快慢（脉冲总时长 = 2×） |
| `HUD_IDLE_MS` | `systems/ui/hud.js:18` | 3000 | 常态脉冲间隔 | 顶部条闪黑频率 |
| `HUD_STATES` | `systems/ui/hud.js:19-24` | explore `#ffffff`/黑字、combat `#ff3b3b`、secure `#37d67a`、black `#000000` | 状态色与文案表 | HUD 配色与标签文字 |
| 血条 / 护盾条 | `systems/ui/hud-art.js:33-34` | `(135,1018,304,16,skew8)` / `(125,1040,304,16)` | 平行四边形条位置尺寸 | 左下血/盾条位置与长度 |
| HUD 头像 | `systems/ui/hud.js:119` | `(70, 1002)`，环半径 hex≈20.7/inner≈37.1/outer≈55.7 | 左下头像 | 头像位置与三层环大小（外环取武器色） |
| 武器轮盘半径 | `systems/ui/hud-art.js:53` | rOuter 220 / rInner 135，圆心 `(1920, 1064)` | 右下扇形轮盘 | 轮盘粗细与占屏；`gap` 2° 为扇间隙 |
| 武器图标底座 | `systems/ui/hud-art.js:99-102` | rOuter 214 / rInner 135，中心角 180°+30°，半角 22.5° | 当前武器底座扇形 | 图标扇区位置与大小 |
| 弹药锚点 | `systems/ui/hud.js:169-173` | `ax = 1920-50`, `ay = 1064-42` | 弹药数字/无限菱形位置 | 右下弹药显示；字号 45px（当前）/30px（上限） |
| 充能条 | `systems/ui/hud.js:134-143` | 起点 `y=960`，`x=24`, `w=180`, `h=12`，行距 -24 | yellow/green 充能条 | 左下充能条位置与尺寸 |
| 设置按钮 | `systems/ui/hud.js:148` | `(1920-88, 28, 64, 64)`，圆角 10，图标 40×40 | 右上设置入口 | 按钮位置与命中区（同步写入 `settingsButtonRect`） |
| 弹窗关闭按钮 | `systems/ui/ui-runtime.js:315` | `(1920-100, 40, 64, 48)`，圆角 6 | 全屏页右上 ✕ | 关闭按钮位置与命中区 |
| 设置蒙层卡片 | `systems/ui/ui-runtime.js:591-594` | `bw 230 / bh 260 / gap 80 / by 360`，蒙层 alpha 0.82 | 退出/再来一次/继续 三卡 | 设置面板布局与遮罩深浅 |
| 二次确认弹窗 | `systems/ui/ui-runtime.js:558` | `pw 640 / ph 340`，居中，按钮 200×60 gap 60 | 退出确认框 | 确认框尺寸 |
| 神像祝福卡 | `systems/ui/world-overlay.js:230-278` | 黑色蒙层条 `barH 336`(80% 黑)贴视窗底；白卡 `cardW 408 / cardH 216 / gap 96`，卡内图标 `r66`(圆心偏移 -24，读 `card.icon` 画板资产渲染，缺省/未加载退回黑圆)；hover 放大 `1+0.1*t`(t 每帧 ±0.14 插值)；滑入/离场均 `SLIDE_MS 450` 缓动 `1-(1-t)^3`（入场 `slide=(1-ease)*barH`，离场 `slide=ease*barH`，`closing` 结束调 `closeIdolOffer`）；文本 name 24px / desc 20px 黑字；张数按 `offer.cards.length` 自适应 | 三选一卡片 | 卡片布局 + 入场/离场滑出 + hover 缩放动画（设计稿 ui-shenxiang.json 按 1:6 放大） |
| `pressAnim` 时长 / 缩放 | `systems/ui/ui-runtime.js:650,661` | 120ms，`0.85 → 1.0` | 按钮按下缩放反馈 | 所有按钮点击手感 |
| `WEAPON_SLOT_LEVELS` | `systems/ui/ui-runtime.js:21` | `[12, 30]` | 出战槽解锁等级 | `uiState.slots`（1/2/3） |
| `PAGE_FADE_MS` | `systems/ui/ui-runtime.js:23` | `280` | 全屏菜单页/设置蒙层 蒙层淡入/淡出时长 | 页面开关的溶解快慢（选关页旧特例同为 280） |
| `WEAPON_BG_ASSET` | `systems/constants.js` | `asset-1788442424562` | 商店/工坊/HUD 武器卡的「武器图标背景」固定动态资产（`data/assets`，名称「武器图标背景」） | 卡片/头像下层背景渲染；上层叠武器 `appearance`/玩家本体 |
| `ICON_SETTINGS/EXIT/RETRY/CONTINUE` | `systems/ui/ui-runtime.js:16-19` | `/icons/设置.png`、`退出.png`、`再来一次.png`、`继续.png`（URL 编码） | 菜单图标路径 | 设置按钮与蒙层图标；走 `/icons/` HTTP 接口 |
| 武器图标 | `systems/ui/ui-runtime.js:130` | `图标/ninja_icon.svg`，贴图键 `weapon-yellow`，80×80 | yellow 武器图标 | 轮盘中心图标（仅 yellow 用图，其他用文字） |
| 贴图键 | `systems/constants.js:18-32` | `__barrel__` `__chest_closed__` `__chest_open__` `__vendor__` `__idol__` | 世界层精灵贴图键 | `textures.exists` 判定与 `setTexture`；动态键：`__level_bg__`、`__lvl_img_{id}__`、`__ui_img_{page}_{id}__`、`__menu_icon_{id}__` |
| 图标资源路径 | `systems/constants.js:17,30,32` + `game-scene.js:66-67` | `/barrel.png` `/vending.png` `/idol.png` `/chest-closed.png` `/chest-open.png` | 世界层贴图源 | 换美术改这里 |
| `CHEST_SIZE` / 修正 | `systems/constants.js:22-23` | 75 / `1005/852` | 宝箱显示宽 + 开启态补偿 | 宝箱视觉大小与开合同宽 |
| `CHEST_OPEN_FX_MS` / `CHEST_SPAWN_FX_MS` | `systems/constants.js:24-25` | 320 / 260 | 十字星特效时长 | 宝箱开启/出现闪光快慢 |
| `PORTAL_ALPHA` / `PORTAL_LABEL` / `PORTAL_COLOR` | `systems/constants.js:26-28` | 0.6 / `EVACUATION` / `0x00ffff` | 传送门表现 | 传送门透明度、标签、主体色 |
| `PLAYER_ART` / `PLAYER_ART_SCALE` | `systems/constants.js:38-53` | scale 0.5；hex 10、inner 12、outer 16、outer2 20、body 35、weaponRing 40 | 玩家六边形与 5 层环 | 玩家整体体型；`PLAYER_COLLISION_RADIUS` 由 weaponRing 推导，改了会连带改碰撞 |
| `PLAYER_LEAN` | `systems/constants.js:57` | `{hex:12,inner:9,middle:7,outer:5,speed:48,minHexRadius:8}` | 移动倾斜量 | 玩家移动时各层偏移手感 |
| `SHIELD` | `systems/constants.js:58` | `{color:'#00eeff',arcDeg:120,gap:10,fadeMs:500}` | 护盾弧外观 | `drawShieldArc` 表现 |
| `UI_COLORS` | `src/ui-layer.js:75-86` | panelBg `#0e2233`、panelStroke `#2f5a7a`、hpFill `#e84c5e`、expFill `#4fc3f7`、coin `#ffd54f`、text `#eaf4fb`… | 数据驱动 UI 默认配色 | 所有未显式指定 `fill/stroke/color` 的节点 |
| tips 面板 | `systems/ui/world-overlay.js:92-93` | `w 200 / h 44 / skew 18`，偏移玩家 `+20,-20`，字号 22px | 世界层交互提示条 | 4 种 tips 统一外观 |
| `GATE_SPAWN_MS` / 闸门配色 | `systems/constants.js:79-82` | 500 / `#FFE6BE` / `#FFCB85` / 0.14 | 闸门动画与色 | 闸门开合表现 |
| `ROTATE_HANDLE_OFFSET` | `systems/constants.js:78` | 28 | 编辑器旋转手柄距离 | 编辑器选中手柄（详见 engine-editor skill） |
| `SETTLE_SUCCESS_COLOR` / `SETTLE_FAIL_COLOR` | `systems/constants.js:14-15` | `#33ff33` / `#ff3b3b` | 结算页标题（成功绿/失败红）与过关球绿 | `drawSettlement` 顶左文案与进度球配色 |
| `SETTLE_BALL_R` | `systems/constants.js:16` | 42 | 结算页进度球半径（设计 7px×6） | 进度球大小 |

### depth 分层（必须遵守）

两条相机各自渲染一套对象，depth 在各自空间内排序：

| depth | 归属 | 对象 | 设置点 |
| --- | --- | --- | --- |
| 0 | 世界层 | `this.bgG`（底色 Graphics） | `game-scene.js:41` |
| 1 | 世界层 | 关卡背景图 `bgImage` | `world-render.js:55` |
| 2 | 世界层 | 关卡图片 `levelImageSprites` | `world-render.js:83` |
| 9 | 世界层 | 桶 / 售货机 / 神像 / 图标 / 宝箱 精灵 | `world-render.js:144,171,200,236,313` |
| 10 | 世界层 | `this.g`（主 Graphics：墙、敌人、玩家、子弹、特效、tips 底板）+ 传送门标签文本 | `game-scene.js:42`、`world-render.js:281` |
| 13 | 世界层 | 交互 tips 文本（portal/idol/icon/vendor）+ F 键帽 | `world-overlay.js:105,150,195,292` |
| 999 | UI 层 | 工坊卡片遮罩 `workshopCardMaskG`（GeometryMask 源，alpha 0 不可见） | `ui-runtime.js:30` |
| **1000** | UI 层 | `this.uiG`（所有 UI 图形：HUD、弹窗底板、蒙层、黑幕） | `ui-runtime.js:26` |
| **1001** | UI 层 | UI 文本与贴图：`uiTexts`/`uiImages` 节点、`settleTexts`、weaponLabels、ammo、hudIndicatorText、weaponIconImage、`vendorShopTexts`、`levelSelectTexts`、`idolOfferTexts` | `ui-runtime.js:47-158`、`screens.js:21,88,424`、`world-overlay.js:220` |
| **1002** | UI 层（弹窗最上层） | `settingsTexts`、`weaponShopTexts`、`menuIconSprites` | `ui-runtime.js:549`、`screens.js:148`、`world-render.js:20` |

规则：世界层用 0-13（要跟主相机跑，必须 `uiCam.ignore(...)`）；UI 层从 999 起（必须 `cameras.main.ignore(...)`）。图形一律画在 `uiG`(1000)，因此**任何要盖在 UI 图形之上的文本/图标至少 1001**；弹窗内需要压过同层文本的用 1002。新增层级不要插进 0-13 与 1000-1002 之间，会打乱两相机的语义分界。

## 6. 扩展指南

### A. 新增一个 HUD 元素（例：左下角显示「连杀数」）

1. 决定体系：纯数字文本 → 优先走 (a)；有动画/条件色 → 走 (b)。
2. 走 (a)：`src/ui-bindings.js` 加 `combo: s => \`连杀 ${s.combo ?? 0}\`` → `ui-runtime.js:196 syncUIState` 的返回对象里补 `combo` 字段 → `data/ui/battle.json` 的 `nodes` 追加 `{ "id":"comboText","type":"text","x":40,"y":110,"size":20,"color":"#eaf4fb","bind":{"text":"combo"} }` → `src/ui-config.js:4 BINDING_OPTIONS` 追加 `'combo'`。改完刷新页面即可（`buildUITexts` 载关时会建 Text）。
3. 走 (b)：在 `src/systems/ui/hud.js` 新增 `drawCombo(g)` 方法（纯几何可放 `hud-art.js` 作纯函数）→ 在 `hud.js:116 drawHud()` 尾部调用 → 需要文本则**必须**用 `ensure` 工厂模式（见第 7 章），并在 `hideHudOverlay()`（`hud.js:196`）里补 `setVisible(false)`，否则切页残留。
4. 用到常量抽到 `hud.js` 文件顶部（与 `HUD_RECT_*` 同区），不要散落魔法数。

### B. 新增一个全屏弹窗页（例：图鉴页 `codex`）

1. `src/systems/ui/screens.js` 新增 `drawCodex()`，首行 `const g = this.uiG;`，用 `this.codexTexts = this.codexTexts || new Map()` + `ensure(id, size, color)` 工厂（照抄 `screens.js:18-27`，depth 1001/1002，记得 `this.cameras.main.ignore(t)`）。
2. `ui-runtime.js:305-313` 的 `menuScreen` 分支链里加 `else if (this.menuScreen === 'codex') this.drawCodex();`。
3. `ui-runtime.js:243 drawUI()` 头部批量隐藏区（`:257-277` 那组）补一条 `if (this.menuScreen !== 'codex' && this.codexTexts) { for (const t of this.codexTexts.values()) t.setVisible(false); }`。
4. 打开入口：在业务处（如 `interactables.js:155` 的图标事件、`save-login.js:87 loginButtons`）调 `this.openMenuScreen('codex')`；关闭复用右上 ✕（`menuClose`，分支已自带）与 ESC（`game-scene.js:176` 已覆盖）。
5. 页内按钮：绘制时 `this.buttons.push({ id: 'codexTab_xx', x, y, w, h })`，再到 `ui-runtime.js:615 onUIPointer` 加 `else if (b.id.startsWith('codexTab_')) { this.pressAnim(b.id); ... this.drawUI(); }`（暂停态下需要立即重绘）。
6. 布局参数若希望策划可调，放 `data/ui/codex.json`，并把页面 key 加进 `setupUI`/`loadUIImages`/`buildUITexts` 的 `['battle','interface','login','weapon','workshop']` 数组（三处，`ui-runtime.js:35,36,94,148`）。
7. **开关动画已内置**：经 `openMenuScreen`/`closeMenuScreen` 开关的页面（含 `weapon`/`workshop`/`vendor`/`saveSelect`/`levelSelect`）自动获得蒙层淡入淡出（`PAGE_FADE_MS`），`drawUI` 会调 `drawPageFadeOverlay()` 叠黑幕，**无需在新页面里再写淡出**。关闭流程变为异步（先淡出到全黑再真正关页并恢复 `state`）。

### C. 在 data/ui 里加一个可点击按钮并接上逻辑（例：interface 页加「重开」）

1. `data/ui/interface.json` 的 `nodes` 追加 `{ "id":"restartBtn","type":"button","x":1460,"y":260,"w":160,"h":56,"fill":"#2f5a7a","label":"重开" }`。
2. `button` 节点只画底板，**不画文字**（`ui-layer.js:244` 仅 `drawButton` + `label==='✕'` 时画叉）。要文字就再加一个同位置 `text` 节点，或在 `drawButton` 后自行扩展。
3. `renderGraph` 会自动把该节点 push 进 `this.buttons`（id = 节点 id）。
4. `ui-runtime.js:615 onUIPointer` 加分支：`else if (b.id === 'restartBtn') { this.pressAnim(b.id); this.restart(); }`。
5. 需要禁用态：节点写 `"disabled": true` 会走灰底，但 `onUIPointer` 当前**不检查** `disabled`，需要在分支里自行 `if (b.disabled) return;`。
6. 编辑器里想可视化拖动该节点：确认 `ui-config.js:6 NEW_NODE` 已有 `button` 模板（有），改完在 UI 配置页保存会写回 JSON。

### D. 新增一种世界层悬浮提示（例：靠近箱子提示「开启」）

1. 交互检测与 `xxxNearest` / `xxxTipT`（淡入淡出计时）在 `src/systems/level/interactables.js` 维护（参考 `portalNearest`/`portalTipT`，`level-flow.js:130-142` 有初始化清单，新增字段要在那里重置）。
2. `src/systems/ui/world-overlay.js` 新增 `drawChestTip(g)`，照抄 `world-overlay.js:77 drawPortalUI` 结构：先 `alpha <= 0 || !nearest || this.editing || this.state !== 'playing'` 就隐藏文本并 return → 画交互半径圈 → 画平行四边形底板（`w200 h44 skew18`，偏移玩家 `+20,-20`）→ 懒建 `this.chestTipText`（`setDepth(13)` + **`uiCam.ignore`**）→ `setText/setPosition/setAlpha/setVisible` → `getFKeyBadge()`（`newbee-hub.js:79`）定位 F 键帽。
3. 在 `world-render.js:548-552` 那组调用里插一行 `this.drawChestTip(g);`（顺序决定遮挡，同为 `g` 时后画的盖前面）。
4. 世界层坐标用世界坐标（玩家 `p.x/p.y`），**不要**用 `uiPointer()` 的 UI 坐标。

### E. 改某个实体的美术表现（例：给 advanced2 敌人换形状）

1. 纯几何函数写在 `src/systems/ui/entity-art.js`（无 `this`，签名 `(g, ...)`），照 `entity-art.js:377 drawAdvanced2` 的写法。
2. 挂到分发点 `entity-art.js:395 drawEnemyShape(g, e, dynamic, target)`：按 `e.type` 分支；尺寸/行为参数取 `ENEMY_BEHAVIOR[type]`（`systems/constants.js:70`），不要在美术函数里硬编码体型。
3. 玩家外观改 `entity-art.js:523 drawHexRingPlayer` + `systems/constants.js:39 PLAYER_ART`；注意 `PLAYER_COLLISION_RADIUS`（`constants.js:54`）由 `weaponRingRadius + weaponRingThickness` 推导，改环半径会改碰撞体积。
4. 墙/木箱/传送门形状分别在 `entity-art.js:451 drawWallShape` / `:41 drawCrate` / `:68 drawPortalShape`。
5. 若改成贴图渲染：贴图键与路径进 `systems/constants.js`，在 `game-scene.js:53-69` 预载，参考 `world-render.js:131 syncBarrelSprites` 写一个 `syncXxxSprites`（含 `uiCam.ignore` 与 `seen` 清理），并在 `draw()` 里调用；同时把原 Graphics 绘制删掉，避免图形与精灵重影。

## 7. 坑与约束

1. **双相机 ignore 是硬约束**。`setupUI`（`ui-runtime.js:25-34`）建了 `uiCam`（全屏、scroll 0、zoom 1）与主相机并存。新建对象必须二选一：UI 对象 → `this.cameras.main.ignore(obj)`；世界对象 → `if (this.uiCam) this.uiCam.ignore(obj)`。**漏 ignore 的后果是同一对象被两台相机各画一次**（UI 对象会随主相机滚动/缩放出现一份错位残影，世界对象会在屏幕左上固定出现一份）。这是本模块最高频的 bug。
2. **`drawUI` 的「全隐再按需显示」模式**。`ui-runtime.js:246-280` 每帧先 `uiG.clear()`、`buttons = []`，再把 `uiTexts` / `uiImages` / `menuIconSprites` / `settingsTexts` 及各页 Map 全部 `setVisible(false)`，之后只有当帧真正绘制的分支才 `setVisible(true)`。因此：
   - 新增文本**必须**走该页的 `ensure(id, ...)` 工厂（工厂内 `setVisible(true)`），并把它的 Map 加进 `drawUI` 头部隐藏清单；否则切页/切状态后文本永久残留在屏幕上。
   - 直接 `this.add.text(...)` 一次性创建又不隐藏 = 必残留。
3. **Graphics 必须 clear**。`uiG`（`drawUI` 开头）、`g` 与 `bgG`（`world-render.js:344,350`）每帧 clear；新增 Graphics 对象要自己保证每帧 clear，否则填充/描边逐帧叠加，几帧后变成实心块并拖垮性能。
4. **depth 冲突**。UI 图形全在 `uiG`(1000) 一个对象里，靠调用顺序决定内部叠放；文本/图标是独立对象，靠 depth。想让文本压过 UI 图形至少 1001，弹窗内压过普通文本用 1002（第 5 章表）。同 depth 时 Phaser 按加入顺序，懒建对象的顺序不稳定，别依赖它。
5. **`hud.js` 单向 import `ui-runtime.js`**：`hud.js:12 import { ICON_SETTINGS } from './ui-runtime.js'`。不要反向从 `hud.js` 往 `ui-runtime.js` import（会形成循环依赖，ESM 下表现为常量 `undefined`）。`HUD_IDLE_MS` 由 `hud.js` 导出、`level-flow.js` 消费，方向也是单向的。
6. **`ui-runtime.js` 与 `hud.js` 有 7 个同名方法**：`drawHud` `drawChargeBars` `drawSettingsButton` `drawAmmo` `hideHudOverlay` `updateWeaponLabels`（+ `drawHud` 内容一致）。`game-scene.js:559` 的 `Object.assign(prototype, ..., HudMixin, UiRuntimeMixin, ...)` 里 **`UiRuntimeMixin` 在后 → 最终生效的是 `ui-runtime.js` 的版本**（`ui-runtime.js:374-488`）。改 HUD 行为时若只改了 `hud.js` 的副本会「改了没效果」，务必确认改的是生效副本，或直接删掉重复副本之一。装配顺序：EnemyAi, PlayerCombat, Destructibles, Pet, Spawning, Triggers, Interactables, LevelFlow, **Hud, UiRuntime, Screens**, SaveLogin, NewbeeHub, Workshop, Drops, Progression, EditorInput, EditorCamera, **WorldRender, WorldOverlay, Minimap**（共 21 个）。
7. **`const ctx = this.ctx;` 约定**：mixin 方法若要访问全局数据层（`ctx.state.level` / `ctx.state.ui` / `ctx.onOpenLevel` / `ctx.onSelectSave` / `ctx.redraw`），方法体首行写 `const ctx = this.ctx;`（见 `ui-runtime.js:92,134,166,244`）。不要在模块顶层闭包捕获 ctx，也别用 `this.ctx.xxx` 到处散写。
8. **暂停态下 update 不一定继续绘制**：`openSettingsOverlay` / `closeSettingsOverlay` / `settings_*` 分支都显式调 `this.drawUI()`（`ui-runtime.js:519,526,623,627`）。新增在暂停态改变 UI 的交互，必须自己触发一次重绘，否则点了没反应。
9. **`uiPointer()` 不是 `pointer.x/y`**：canvas 走 CSS `object-fit: contain`，必须用 `ui-runtime.js:226 uiPointer()` 换算到 1920×1080 空间。任何命中判定和 hover 判定都用它；世界层判定则用 `cameras.main.getWorldPoint`（`editor-input.js:56`）。
10. **`onUIPointer` 命中即 return**：`buttons` 数组顺序 = 绘制顺序，重叠区域先绘制的先命中。全屏页的右上 ✕ 在页面内容之后 push（`ui-runtime.js:328`），所以被内容盖住的位置会先命中内容。
11. **异步贴图**：`loadUIImages` / `loadWeaponIcon` / `iconSprite` 都是 `new Image()` + `onload` 异步建精灵，首帧可能返回 `null`（`world-render.js:27,38`）。绘制代码必须 `if (spr)` 判空，不能假设立即可用。`syncXxxSprites` 同理开头判 `textures.exists`。
12. **`buildUITexts` 会 destroy 重建全部 uiTexts/uiImages**（`ui-runtime.js:137-145`），每次载入关卡触发。不要在关卡生命周期外持有这些 Text 的引用。
13. **`data/ui/*.json` 里 `weapon`/`workshop` 的 `nodes` 是空数组**，页面完全由代码绘制，JSON 只提供参数。往这两个文件的 `nodes` 加节点不会被 `renderGraph` 渲染（这两页不走 `renderGraph`）。
14. **`hudIndicatorText` 特例**：它在 `drawUI` 头部单独隐藏（`ui-runtime.js:251`），且编辑态在 `draw()` 里也强制隐藏（`world-render.js:342`）。新增类似的「常驻单例文本」要记得两处都加。
15. **卡片滚动裁剪：卡片形状必须放进「持久 mask 的独立 Graphics」，不能靠 `g.setMask()`/`g.clearMask()` 包裹绘制**。Phaser 的 mask 在渲染阶段才应用；同一帧里 `setMask`→画→`clearMask`，等渲染时 `mask` 已是 `null`，**卡片形状不会被裁剪**（只有对象级持久 `text.setMask(mask)` 会裁剪）。改动 shop/workshop 时因此「卡片超框」。正确做法：懒建一个专用 Graphics（`screens.js:240` `shopCardContentG` / `workshop.js:190` `workshopCardContentG`，depth 1001，`cameras.main.ignore`，**`setMask(mask)` 一次性且不清除**），每帧对卡片形状 `contentG.clear()` + 重画；卡片文本各自 `.setMask(mask)`。同时 `shopCardMaskG` 每帧 `clear()+fillRect(gridX, areaY, gridW, areaH)` 刷新为带 `padV` 上下留白的网格区，让卡片与面板顶/底保持距离。离开该页时要在 `drawUI` 里 `contentG.clear()`（`ui-runtime.js:259-268`），否则残留上一帧卡片。
16. **关卡结算页是状态驱动，不是 menuScreen**：`state==='end'|'fail'` 走 `drawSettlement()`（`screens.js:416`），不经过 `openMenuScreen`，**没有右上 ✕**，只有「回到大厅」按钮（id `settleHome` → `exitToHome()`）。`end/fail` 态下 update 主循环只 `this.draw()` 返回（`game-scene.js:199`），点击命中靠 `onUIPointer`（`editor-input.js:45` 已把 `end/fail` 从 `restart()` 改为 `onUIPointer`）。改结算页别走 `openMenuScreen`/`closeMenuScreen` 流程；退出只经 `settleHome`（旧「点击重开」已移除，失败也无重试）。
17. **结算页进度球不亮 → 先查 `ctx.state.levelId` 是否被 `restart()` 改写**：`drawSettlement` 用 `state.levelId` 解析 `Level{N}-Scene{M}` 章节（`screens.js:448`），但 `level-flow.js:181` 的「未解锁回退」会用旧 `levels.unlocked`（扁平 `level-1`）覆盖它（`levels.unlocked` 从不含章节 id，因选关解锁在 `screens.js:176` 是 completed 驱动）。覆盖后 `settleVictory` 记成 `level-1`、结算页解析不出 `Level1-Scene1` → `pass()` 全 false → **一颗球都不亮**。已加 `!isSceneId` 守卫（`level-flow.js:184`）。若进度仍不亮，确认 `completed` 里存的确实是 `Level{N}-Scene{M}` 而非 `level-1`；再查 `this.saveSource()?.levels?.completed` 与 `settleVictory` 写入的是不是同一个 player（preview/trial/formal 三源，见 gameplay-systems）。
18. **`closeMenuScreen`/`closeSettingsOverlay` 现已异步（先蒙层淡出再真正关页）**：调用后 `menuScreen`/`settingsMode` 不会立即清空，而是等 `drawUI` 里 `drawPageFadeOverlay()` 的 'out' 走完（`PAGE_FADE_MS`）由 `finishCloseMenuScreen`/`finishCloseSettings` 收尾并恢复 `state`。因此：① 需要**立即**关页并跳过淡出的程序化路径要直接清 `settingsMode`/`settingsPrev`/`pageFade`（参考 `retryBattle`），别依赖 `closeSettingsOverlay()`；② 淡出期间 `onUIPointer` 被 `pageFade.phase==='out'` 拦截，不响应点击；③ `openMenuScreen` 已识别编辑态/已有页，淡出未完成前再次打开会被拒，符合预期。
19. **Phaser 4 没有 `Camera.getWorldBoundingRectangle()`**（运行期 `is not a function`，且 `vite build` 不报）。取相机可视区（世界坐标）统一用场景方法 `this.viewRect()`（`EnemyAiMixin`，`enemy-ai.js:31`，返回 `{x,y,w,h}`，装配后全场景 mixin 共享）与 `this.isInView(e)`。`updateGuideArrows` 首版误用该 API 导致进入游戏即崩（update 抛异常整帧卡死），已改。

## 8. 验证方式

```bash
npx vite build       # 构建，验证 ESM 导入/语法（无 lint，构建通过即基本安全）
node server.js       # 起本地服务（package.json 的 dev 脚本），浏览器打开进编辑器/试玩
node --test test/    # 基线 16 pass / 5 fail，5 个 fail 均为 fetch failed（需要 server 在跑），属正常
```

改动后按面貌选关卡自测（`data/levels/` 下 16 个关卡）：

| 关卡 | 看什么 |
| --- | --- |
| `login.json` | 登录页：Logo/标题/版本号（`data/ui/login.json`）、5 个登录按钮 hover 白色平行四边形扫过、存档选择页 |
| `knight-home.json` | Hub：**无战斗 HUD**（`isHubLevel()` 分支只隐 HUD）、图标交互 tips + F 键帽、武器商店 / 工坊 / 关卡选择三个入口页 |
| `Level1-Scene1.json` | 战斗 HUD：顶部状态条（进战变红 COMBAT、清场变绿 SECURE 后 1.5s 回白 EXPLORE、静置每 3s 闪黑脉冲）、血盾条、武器轮盘换枪动画、弹药、充能条、右上设置按钮 → 设置蒙层 → 退出二次确认 |
| `newbee.json` | 新手引导提示与操作限制（属 gameplay，UI 侧只验提示不残留） |
| 任意含宝箱/传送门/神像/售货机的关卡 | 世界层：宝箱十字星、传送门「撤离」tips、神像三选一祝福卡入场动画、售货机局内商店 |

自测重点（对应第 7 章坑）：切页面来回切 3 次以上看有无**文本残留**；缩放浏览器窗口（触发 contain 黑边）看点击是否还准；暂停态点按钮看是否立即响应；观察是否有对象出现两份（ignore 漏配）。

