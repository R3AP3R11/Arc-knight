---
name: ui-interaction
description: 改 HUD（含局内消耗品·药水槽·限时武器槽·状态图标）/ 全屏弹窗页（含局内售货机·老虎机抽奖页·休息火堆两层页）/ 世界层渲染与悬浮提示与特效 / 敌人美术（含重装机兵瞄准线与激光）/ 玩家被击败运镜期间的 HUD 隐藏（playerDeathFlow 分支）/ data/ui 节点图 / 点击命中与按钮回调时读这份；覆盖 src/systems/ui/**、src/ui-layer.js、src/ui-bindings.js、data/ui/*.json。触发词：售货机 / 局内商店 / 老虎机 / 抽奖 / 商品卡片 / 卡片翻面 / 摇奖动画 / 全屏弹窗页 / 局内消耗品 / 药水槽 / 药水选择轮盘 / 数字键4 / 数字键5 / 临时武器槽 / 状态图标 / 药水掉落 / 环链 / 内圈环链 / 出场动画 / 武器出场 / 六边形 / 运镜 / 过场运镜 / 死亡运镜 / 玩家被击败 / 运镜预览 / 休息火堆 / 火堆 / 生命回复 / 杰作升级 / 杰作升级图标 / 生命值回满图标 / 重装机兵 / 敌人激光 / 激光敌人 / 瞄准线 / 瞄准收敛 / 头部朝向。
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
| 局内消耗品槽 + 限时武器槽（左下药水槽/临时武器槽 + 队列小点 + 剩余时间条） | (b) | `hud.js:drawHud` 末尾调 `battle-items.js:drawBattleItems`（几何纯函数 `battle-items-art.js`） |
| 药水选择轮盘（长按数字键 4 呼出，全屏蒙层 + 4 扇区 + 死区叉号） | (b) | `battle-items.js:updateBattleItemsInput`（输入/状态）+ `battle-items-art.js:drawPotionWheel`（绘制） |
| 局内状态图标（限时加成白色小图标，玩家左下角 2 列×4 行） | (b) | `battle-items-art.js:drawBattleStatusIcons`（世界层 `world-render.js` 调用） |
| 右上设置按钮 | (b) | `hud.js:147 drawSettingsButton` |
| 设置蒙层（退出/再来一次/继续 + 二次确认） | (b) | `ui-runtime.js:541 drawSettingsOverlay` |
| 暂停界面（面板 + 统计 + ✕） | (a) `data/ui/interface.json` | `ui-runtime.js:337`（`state==='paused'` 或 `level.ui==='interface'`） |
| 商店页（页签式·黑白极简，顶部标题+双币、左侧4页签选中=白色矩形、右卡片5/排纵向滚动带顶/底留白；**武器页签列表=`weaponCatalog()` 已注册武器（不含基础 radial）；卡片中央渲染「固定图标背景资产 `assets/asset-1788442424562`（下层）+ 武器外观 `appearance`（上层）」两层叠加，用 `drawDesignCentered` 以设计原点居中；无 `appearance` 回退 `drawWeaponGlyph`；未达解锁等级显示锁+「到达xx级后解锁」；可达则购买按钮黑底+金币图标（画到 cardG）+价格+聚焦放大10%**） | (b) 参数取自 `data/ui/weapon.json`（含 `padV`） | `screens.js:131 drawWeaponShop` |
| 关卡选择（2 页：页1=模式选关 探险/守卫，页2=探险子关选关） | (b) | `screens.js:84 drawLevelSelect` |
| 局内售货机页（左老虎机抽奖 + 右 2×2 商品购买卡，设计稿 `docs/ui-designs/ui-ingame-shop.json` 等比放大 6 倍） | (b) | `screens.js:22 drawVendorShop`（图标解析 `vendor-shop-art.js`；数据/交互 `economy/inner-shop-runtime.js`） |
| 神像三选一祝福卡（底部黑条蒙层飞入 + 白卡悬停放大 10%，点空白反向滑出关闭） | (b) | `world-overlay.js:214 drawIdolOffer` |
| 存档选择页 | (b) | `save-login.js:32 drawSaveSelectUI` |
| 工坊页（拖拽/背包/加点） | (b) | `workshop.js:14 drawWorkshopUI`（**属 gameplay，详见 gameplay-systems skill**） |
| 世界层悬浮 tips（传送门「撤离」/神像/图标/售货机 + F 键帽） | (b) | `world-overlay.js:77/122/167/261` |
| 宝箱十字星、传送门特效 | (b) | `world-overlay.js:11/310/321` |
| 关卡结算全屏页（撤离成功/失败 + 进度球 + 击败/收获列表 + 回到大厅） | (b) | `screens.js:416 drawSettlement`（`state==='end'`/`'fail'`） |
| 转场黑幕 / 关卡入场淡入 / 虫洞开场 | (b) | `ui-runtime.js:383-391` |
| 全屏菜单页/设置蒙层开关 蒙层淡入淡出 | (b) | `ui-runtime.js:412 openMenuScreen` / `:422 closeMenuScreen` / `:434 pageFadeAlpha` / `:442 drawPageFadeOverlay` / `:455 openSettingsOverlay` / `:464 closeSettingsOverlay`；恒定 `PAGE_FADE_MS` |

**跨分类指路**：工坊页交互与背包 → gameplay-systems skill；编辑器画布手柄、UI 配置页、关卡 schema → engine-editor skill；伤害/价格/掉落数字 → economy-numbers skill（**局内消耗品/限时武器数据层 `RunItemsMixin`、`inner-shop.js` 也在此**）；子弹与武器行为 → combat 相关 skill。

## 2. 文件地图

| 文件 | 职责 | 关键导出 | 行数 |
| --- | --- | --- | --- |
| `src/systems/ui/ui-runtime.js` | UI 运行时核心：相机装配、文本/贴图工厂、屏幕状态判定、`drawUI` 主调度、点击派发、按下动画；**全屏页遮罩 alpha 独立**（`menuScreen==='vendor'` 时 0.85，其余页 1.0，`drawUI` `:332`）；**玩家被击败运镜期间隐藏 HUD**（`drawUI` `:374` `else if (this.playerDeathFlow) hideHudOverlay()`，放在 `state==='end'/'fail'` 结算分支**之前**，`activeGraph` 计算也排除它）；**休息火堆弹窗接线**：`:13 import { drawCampfireOffer }`（**模块导出函数**，`drawUI` 在 `idolOffer` 分支之后 `:328 if (this.campfireOffer) { this.hideHudOverlay(); drawCampfireOffer(this); return; }` 直接调用），`activeGraph` 把它与 `idolOffer/settingsMode/menuScreen` 一起归为「无 graph」（`:306`），`onUIPointer` 首行 `campfireOffer?.closing || campfireOffer?.switch` 守卫（`:597`，切层动画期间也不响应点击）、`campfireCard_0/1`+`campfireUpgrade_*` 按钮分发（`:622`）、末尾空白点击 `layer===2 → campfireBackToFirst()` / 否则 `closing=true`（`:650-653`） | `UiRuntimeMixin`（28 个方法）、`ICON_SETTINGS/EXIT/RETRY/CONTINUE`、`WEAPON_SLOT_LEVELS`、`PAGE_FADE_MS` | 671 |
| `src/systems/ui/hud.js` | 战斗 HUD 状态机（explore/combat/secure/black 脉冲）与 HUD 各元素绘制；`drawHud` 调 `_trackHudGhosts` 维护血/盾受伤残弧状态（hp/shield 下降记 from→to，约 1s 渐隐）；**HUD 整体入场动画**：`hudEnterAlpha()` 在关卡开场(`levelIntro`)后驱动战斗 HUD（battle 节点图+血盾/弹药/充能+顶部 EXPLORE 条+小地图）淡入 0.5s→停留 0.2s→闪烁(消失 0.3s→渐显 0.5s 出现)，渐显用 smoothstep(`hudEaseInOut`，开头慢/中段自然/结尾缓，避免前段跳涨观感像瞬现)；`setHudAlpha(a)` 把 alpha 统一应用到全部独立对象；`hudIntro/hudIntroDone` 由 `level-flow.js restart` 重置；**绘制末尾调 `this.drawBattleItems(g)`**（局内消耗品/临时武器槽），`hideHudOverlay` 额外调 `hidePotionWheelTexts?.()` 隐藏轮盘名文本（**`setHudAlpha` 已移除轮盘文本 alpha 处理**，原因见坑 42） | `HudMixin`（14 个方法）、`HUD_IDLE_MS` | 393 |
| `src/systems/ui/screens.js` | 全屏弹窗页绘制：局内售货机页（`drawVendorShop` 完整设计稿页面，左老虎机抽奖 + 右 2×2 商品购买卡）/ 关卡选择（2 页：页1 模式选关 探险/守卫 卡、页2 探险子关平行四边形+旋转圆环+可拖背景网格）/ 商店页 / **关卡结算全屏页**（页签式+纵向滚动+购买逻辑，黑白极简：黑面板+白卡+黑字+灰边；**武器页签接入武器系统数据：武器列表 = `weaponCatalog()` 已注册武器（**不含基础武器 radial**，新注册自动同步）；卡片中央用固定「武器图标背景」资产+武器 `appearance` 两层叠加渲染，外观/背景用 `drawDesignCentered`（**以设计原点为中心**而非 `renderAssetFit` 的包围盒几何中心——旋转动画元素致 bcx/bcy 偏移使 minigun 等外观偏离中心）；无 `appearance` 回退 `drawWeaponGlyph`；解锁等级读 `getWeaponDef(type).unlockLevel`，未达级显示锁+「到达xx级后解锁」无购买按钮；购买按钮黑底+金币图标（**黄菱形画到 `cardG`，不能复用 drawDiamond 的 `g`=uiG depth1000 会被按钮黑底 depth1001 盖住**）+价格数字+聚焦放大10%（`shopBuyHover`），价格取 `node.prices[type] ?? def.price`**；**老虎机 3 窗口内图标 `REEL_ICON_SIZE = 88`（窗口白卡 120×120，四周各留 16px 内边距）**） | `ScreensMixin`（13 个方法）、`drawVendorShop`、`drawWeaponShop`、`drawSettlement`、`drawBigLevelSelect`、`drawSmallLevelSelect`、`drawTechRing`、`handleShopPointerDown/Up`、`updateShopScrollDrag`、`buyPet` | 998 |
| `src/systems/ui/vendor-shop-art.js` | 售货机图标解析纯逻辑（无 Phaser 状态）：按「美术方案类型（图标）」（`动态资产`/`轮廓`/`像素`）定位 `api.js` 三库、按「美术方案名称（图标）」**精确匹配** → design；轮廓转 `shape:'stroke'` 元素、像素转 `shape:'pixel'` 元素、动态资产直用（三种 artType 统一经 `recenter` 把 `center` 设为负包围盒中心，见第 5 章口径）；**白卡/黑卡对比度变体**：`isNearWhite` 判纯白款、`blackVariant` 换黑款、`whiteVariant` 换白款（供局内 HUD 黑底槽用，非空颜色全→`#ffffff`）、`shopIconVariant(design,darkCard)` 白卡返回黑款/黑卡非白款反色；`designCache`/`listCache` 缓存，失败落 `null` 不抛 | `resolveArtRef`、`preloadArtRefs`、`getArtRef`、`invertDesign`、`drawShopIcon`、`isNearWhite`、`blackVariant`、`whiteVariant`、`shopIconVariant`（9 个） | 196 |
| `src/systems/ui/campfire-art.js` | 休息火堆**两层弹窗绘制**（**模块导出函数** `drawCampfireOffer(scene)`，由 `ui-runtime.drawUI` 直接调用，**不是 mixin 方法**；**仅有的 UI 侧新模块**）：全屏 `0x000000`/0.65 蒙层 + 底部黑条 `BAR_H=336`，黑条与卡片**自下而上飞入 / `closing` 时向下滑出**（`SLIDE_MS=450`、ease `1-(1-q)^3`，`q>=1` 调 `scene.closeCampfireOffer()`）；**两层切换（1↔2）两段式动画**（读 `offer.switch={from,startT}`，`el=now-startT`，ease `1-(1-q)^3`：阶段1 `el<LAYER_OUT_MS(220)` **只画旧层 `switch.from`**、`yShift=ease*LAYER_SHIFT` 向下移出；阶段2 `el<480` **只画当前层 `layer`**、`yShift=(1-ease)*LAYER_SHIFT` 自下方滑入；`el>=480` `delete offer.switch` 只画当前层；`LAYER_SHIFT=BAR_H-CARD_TOP_IN_BAR=282` 卡片顶正好滑到屏幕底、完全出屏不留残影；**核心不变量：同一帧只画一层**，不改 `hoverT`）；**第一层 2 张白卡**（`CARD_W=408/CARD_H=216/CARD_GAP=96/CARD_TOP_IN_BAR=54`，图标走 `vendor-shop-art` 的 `resolveArtRef`/`getArtRef`（像素「生命值回满图标」/ 动态资产「杰作升级图标」）+ `shopIconVariant(design,false)` + `drawShopIcon`，标题 `NAME_SIZE='24px'` **加粗** / 说明 `DESC_SIZE='17px'` 普通字重）；**第二层 3 个按钮**（图标 = `getDesign/ensureDesign(WEAPON_BG_ASSET)` 黑色武器底盘 + 叠加武器美术 `UP_ICON_BOX*WEAPON_ART_RATIO`，美术优先级 `player.arts[wt]` 设计稿 → `WEAPONS[wt].appearance`(elements 非空) → **局内环组兜底**（`drawHexRingPlayer` + `{hideWeaponRing:true}`，只留 `inner/outer/outer2/body` 4 个同心环；`drawWeaponGlyph` 兜底**已移除**）；**不再画武器名**，仅 `campfireUpgrade_{i}_desc` 显示 `entry.desc`（空回退 `entry.name`）、`UP_DESC_SIZE='15px'` 多行居中 + `setWordWrapWidth`）；文本池 `scene.campfireOfferTexts` + **帧内 `visibleIds` 集合（帧末对未绘制文本 `setVisible(false)`，修复旧层文本残留）**；按钮 id `campfireCard_0/1`、`campfireUpgrade_0..2` | `drawCampfireOffer` | 231 |
| `src/systems/ui/battle-items-art.js` | 局内消耗品/限时武器 HUD **纯绘制 + 轮盘几何**（无 `this`，签名 `(g, ...)`）：药水槽/临时武器槽/队列小点/剩余时间条、药水选择轮盘（蒙层 + 4 扇区 + 死区 + 悬停**线性径向渐变**高亮 + 呼出/消失动画）、状态图标；几何常量全在文件顶部（背景框 `836,588,320×180` = 1920×1080 的 1/6，一律 ×6；**药水槽黑底白框白图；武器槽武器图案恒为「原色」（不反白），**两态（含使用中）都叠加圆形黑底盘 `WEAPON_BG_ASSET`**，两态差异 = 底色（黑/白）+ 边框色（白/`ringColor`）+ 底盘可见性（黑底上不可见/白底上显为黑盘）+ 有无顶条**；轮盘每项名称文本几何 `wheelIconPos`（图标中心）/`wheelNamePos`（图标正下方）+ `WHEEL_NAME_FONT=24`/`WHEEL_NAME_GAP=12`） | `POTION_DOT_GAP`、`WHEEL_NAME_FONT`/`WHEEL_NAME_GAP`、`WHEEL_HOVER_FADE_MS/RINGS/ALPHA_IN/ALPHA_OUT`、`wheelHoverIndex`、`wheelIconPos`、`wheelNamePos`、`drawItemSlotFrame`、`drawPotionQueueDots`、`drawPotionSlot`、`drawTempWeaponSlot`、`drawPotionWheel`、`drawBattleStatusIcons`（10 个纯函数） | 228 |
| `src/systems/ui/battle-items.js` | `BattleItemsMixin`：局内消耗品 HUD **输入 + 绘制**（长按数字键 4 开轮盘/短按用前方药水、数字键 5 切临时武器）；`drawBattleItems` 画到 `uiG`，`drawBattleStatusIcons` 画到世界层；轮盘维护 `hoverT0` 渐显起点、武器槽透传 `tSec`（动态自转）、懒建**最多 4 个**轮盘药水名文本数组 `potionWheelTexts`（`WHEEL_NAME_FONT`=**24px**，每项位置 `wheelNamePos(i, scale)`、alpha 跟随轮盘动画）；新增 `hidePotionWheelTexts()` 批量隐藏 | `BattleItemsMixin`（4 方法）：`updateBattleItemsInput(dt)` / `drawBattleItems(g)` / `hidePotionWheelTexts()` / `drawBattleStatusIcons(g, player)` | 155 |
| `src/systems/economy/inner-shop-runtime.js` | 局内售货机运行时（**归属 economy-numbers，作 UI 页的数据/交互支撑**）：打开页面、刷新/购买商品、老虎机摇奖与结算；依赖 `economy/inner-shop.js` + `ui/vendor-shop-art.js` | `InnerShopMixin`（12 个方法）：`openVendorShop`/`ensureVendorStock`/`setupVendorStock`/`preloadVendorArt`/`getVendorStock`/`isVendorBought`/`addRunItem`/`addRunTimedWeapon`/`buyVendorItem`/`rollVendorSlot`/`updateVendorSlot`/`settleVendorRoll` | 163 |
| `src/systems/ui/world-render.js` | 世界层：背景图、6 类精灵 Map 同步、主渲染循环 `draw()`（含掉落物绘制分派 `:550`）；未知房间揭示 alpha（`roomRevealAlpha`）应用到敌人/木箱/传送门/掉落及各精灵 sync（`syncXxxSprite` `setAlpha`/`setVisible`）；**`drawShieldArc` 之后调 `drawItemShields(g, this.player)`（import 自 `entity-art.js` 的独立函数，非 `this.` 方法）+ `this.drawBattleStatusIcons(g, this.player)`**；掉落分派新增 `potion` 掉落物图标（尺寸 30，取不到图标退化白点并 `resolveArtRef` 补拉）；**`drawPlayer(g, this.player, t, { screenScale: this.cameras.main.zoom })` 把相机 zoom 透传给武器本体环链**；**休息火堆世界层 `drawCampfires(g)`**（`:252`，`getDesign(cf.art)` + `renderAssetFit(g, design, cf.x, cf.y, Math.min(cf.w,cf.h)*(cf.artScale||1), 0, t)` 等比铺满配置尺寸，未加载画白色圆环占位，`roomRevealAlpha<=0` 跳过；`requestArtDesigns` 已纳入 `campfire.art`，`:28-29`；编辑器态选中火堆画选中框 + 四角手柄 + `interactRadius` 半径圆，`:705-720`） | `WorldRenderMixin`（13 个方法） | 784 |
| `src/systems/ui/world-overlay.js` | 世界层悬浮 UI 与特效：5 种 tips（传送门/神像/图标/售货机/**休息火堆**）、宝箱十字星、神像祝福卡（底部黑条飞入+白卡悬停放大 20%；卡片图标读 `card.icon` 画板资产渲染，张数按 `offer.cards.length` 自适应）、屏外实体指引箭头（视窗边缘白箭头，实体表已含 `[this.campfires, '休息火堆']`）；**休息火堆 F 键提示 `drawCampfireUI`**（对照 `drawIdolUI`：交互半径圈 + 平行四边形底板 + 文本「休息火堆」+ F 键帽，随 `campfireTipT` 淡入） | `WorldOverlayMixin`（12 个方法） | 499 |
| `src/systems/ui/minimap.js` | **多箱庭小地图**（左上角**固定视窗** `MM_VIEW_W×MM_VIEW_H=480×270`，玩家白点恒居中、世界随玩家滚动）：等大箱庭正方形（`MM_CELL=80`，大小差异不体现）+ 每格标记（战斗/神像/宝箱/商人/BOSS）+ 灰色通道（`MM_CHANNEL 0x808080`，箱庭间距 `MM_GAP=45`）。仅 `roomLayout.mode==='multi'` 且非编辑态/非菜单/非结算时绘制；黑底白框直角（箱庭同款，`MM_BG 0x000000`/`MM_BORDER 0xffffff`，视窗白框 `MM_FRAME_W=20`）；**视窗裁剪用持久 `GeometryMask`**（`minimapMaskG`/`minimapContentG`/`minimapFrameG`，参照 `screens.js` shopCard 模式）；标记图标走画板动态资产（`getDesign`+`renderAsset`，空则中文文字占位）；**未知房间未揭示时以「未知」占位，揭示后显示真实标记**（`roomRevealAlpha` 判定）；**玩家在箱庭内用所属箱庭映射，在通道/间隙时用相邻两箱庭参考系线性融合（`refOf`+A→B 投影 `u`），保证穿越边界/切换锚点小地图位置连续不跳变**。在 `ui-runtime.js` 战斗态兜底分支调用 | `MinimapMixin`（`drawMinimap` / `hideMinimapOverlay`） | 211 |
| `src/systems/ui/entity-art.js` | 实体美术纯函数（无 `this`）：玩家本体环组（**不再画中心六边形**；`drawHexRingPlayer(graphics, player, scale=1, opts=null)`，`opts={screenScale, elapsedMs}` 走「内圈环链 + 出场渐显」局内路径、`opts=null` 的 HUD/工坊 UI 保持静态全显；链环用**显式 `chain:true` 标记**（不能用半径判断——武器球半径比内环还小）、**两趟绘制（原件先/链环后）**、厚度判据用固定 `chainRefScale()`、链环对象带 `revealIndex` 供出场计时；**`opts.hideWeaponRing`（默认 `false`）为 true 时跳过最外圈发射环（`PLAYER_ART.weaponRingRadius`）与其上武器球（`kind:'orb'`），只留 `inner/outer/outer2/body` 4 个同心环**（火堆第二层兜底美术用，见第 7 章坑 54；**缺省必须 `false`**，不能影响 `drawPlayer`/`hud-art`/工坊调用方）；`drawPlayer(graphics, player, t=0, opts=null)` 第 4 参，设计稿/武器外形分支与 **orbit（环绕机制）分支都走 `renderWeaponBody`**（禅灭等同样生成环链））、敌人形状（**含 `heavy-mech` 分支 → `drawHeavyMechBody`**）、墙体、木箱、虫洞、护盾弧、**局内道具护盾整圈 `drawItemShields`**、平行四边形、掉落货币四角菱形图标 | `color`、`drawPlayer`、`drawHexRingPlayer`、`updatePlayerMoveLean`、`drawEnemyShape`、`drawWallShape`、`drawWormhole`、`drawShieldArc`、`drawItemShields`、`drawParallelogram`、`strokeDiamond`、`drawDropDiamond` 等 30+ | 772 |
| `src/systems/ui/heavy-mech-art.js` | **重装机兵**渲染（模块导出函数，无 `this`）：`drawHeavyMechSight`（瞄准/停顿期的两条蓝线，**只按 `e.sightLines` 端点 `lineBetween`、不做任何几何计算**；端点由战斗侧每帧算，线**无限长、只被墙/关卡边界截断**，夹角 0 = 两条线重合成单线）、`drawHeavyMechBody`（设计稿整体相位偏转 `headAngle + π/2` → 顶部的尖指向 headAngle；设计稿未加载返回 `false`）、`drawHeavyMechBeams`（`scene.enemyLasers` 的静态光束，宽度为 0 不画） | `drawHeavyMechSight`、`drawHeavyMechBody`、`drawHeavyMechBeams` | 50 |
| `src/systems/ui/hud-art.js` | HUD 绘制纯函数：左下角「武器外观+图标背景」叠加头像（背景 144px/外观 96px；**普通武器局内本体 `drawHexRingPlayer` 用 `weaponAngle = t*2.5` 动态绕环转动**）、**270° 圆弧血条（外圈 r105）/护盾条（内圈 r84）**（中心 `(70,970)` 上移防遮挡、顶起顺时针、弧厚 7.5；受伤残弧 from→当前，红/深蓝随 `ghost.age` 渐隐）、武器轮盘、武器图标底座；**HUD 路径 `drawHexRingPlayer(..., 1.275)` 不传 `opts` → 静态全显，不受环链/出场动画影响（工坊卡片同理）** | `drawHudAvatar`、`drawHudBars`、`drawArcBar`、`drawWeaponWheel`、`drawWeaponIcon`、`wheelOrder`、`lerpColor` | 140 |
| `src/ui-layer.js` | 数据驱动渲染器 + 共享绘制件（**含 hover/press 状态感知 + 自定义多边形 poly**） | `renderGraph`、`drawPanel/Bar/Button/Shape/Poly`、`drawWeaponGlyph`、`drawLock`、`UI_COLORS` | 319 |
| `src/ui-bindings.js` | 节点 id → 运行时数据绑定表（9 条） | `BINDINGS` | 12 |
| `src/ui-config.js` | 编辑器 UI 配置页（节点属性表单、新增节点模板、绑定下拉、**可视化画布编辑器入口**、interact/hover 交互字段、poly 顶点编辑） | `NEW_NODE` 模板、表单渲染、`renderUIConfigPage`（**详见 engine-editor skill**） | 231 |
| `src/ui-editor.js` | UI 配置页可视化画布编辑器：点选/拖动/缩放节点、选中覆盖层、与表单实时同步、**hover 实时预览 + poly 点拖动编辑** | `UIEditor` `initUIEditor` `getUIEditor`（**详见 engine-editor skill**） | 391 |
| `src/ui-preview.js` | Canvas 2D 侧的节点图预览（编辑器用，非 Phaser，**支持 hover 渐变 + poly**） | `renderUIPreview` | 215 |
| `src/ui-interact.js` | **数据驱动 UI 交互状态纯函数引擎**：hover 渐变插值、事件/命中矩形、自定义多边形绘制参数混合（Phaser 运行时与 Canvas 编辑器预览共用） | `interactProgress` `blend` `lerpColor` `nodeRect` `lerp` | 57 |
| `src/ui.js` | DOM 辅助：取节点、状态条、关卡列表、预览面板（改件区按库存数量渲染 + 宠物区「拥有/装备」） | `getDom`、`setStatus`、`renderLevels`、`renderPreviewWeapons/Mods/Pets` | 137 |
| `src/ui-library.js` | 可复用 UI 组件库（注册表 + 组件定义）：`LoginButton`（登录按钮）/ `GiftCard`（赐福卡）/ `WeaponCard`（工坊武器卡，含可配置通用/专属改件槽数） | `registerComponent` `getLibrary` `registerBuiltinComponents` `LoginButton` `GiftCard` `WeaponCard` | 323 |
| `src/systems/constants.js` | UI 相关共享常量 | `VIEW_W/VIEW_H`、`FONT_TECH(_SC)`、`PLAYER_ART`、`SETTLE_*`、`WEAPON_BG_ASSET`、`WEAPON_RING_CHAIN`、各贴图键 | 113 |
| `src/game-scene.js` | 场景骨架：`create` 装 UI、`update` 驱动，末尾 `Object.assign` 装配 **25 个 mixin**（含 `InnerShopMixin`，其后**紧跟 `RunItemsMixin`、`BattleItemsMixin`**；`update` 里 `updateVendorInteract(dt)` → `updateVendorSlot()` → `updateRunItems(dt)` → `updateBattleItemsInput(dt)` → `updateIdolInteract(dt)` → **`updateCampfireInteract(dt)`**（`:842`，受 `inputLocked` 门控）；子弹与墙判定已并入 `campfireWalls()`（**火堆遮挡子弹**，`:555/:568`））；`addKeys` 含 `NUMPAD4/NUMPAD5/DIGIT4/DIGIT5` | `createGameScene` | 924 |
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
| 改玩家外观（环 / 环链 / 倾斜；**中心六边形已移除**） | `src/systems/constants.js:61 PLAYER_LEAN` + `:64 WEAPON_RING_CHAIN` + `src/systems/ui/entity-art.js:533 drawHexRingPlayer`（第 4 参 `opts={screenScale, elapsedMs}` 走环链+出场；链环显式 `chain:true` + 两趟绘制（原件先/链环后）+ `revealIndex` 供出场计时 + 厚度判据 `chainRefScale()`）/ `:650 drawPlayer`（第 4 参 `opts`；世界层传 `cameras.main.zoom`；**orbit 环绕分支也走 `renderWeaponBody`**）/ `src/systems/art/weapon-body.js:renderWeaponBody`（两趟绘制：原件先/链环后） |
| 改敌人形状 | `src/systems/ui/entity-art.js:395 drawEnemyShape`（按 `e.type` 分支）；**重装机兵**：分支在 `entity-art.js` 内调 `ui/heavy-mech-art.js:drawHeavyMechBody`（`getDesign(e.art \|\| HEAVY_MECH_ART)` → 旋转本体 + 瞄准线），瞄准线端点读战斗侧写好的 `e.sightLines`（**无限长、只被墙截断，渲染端不自算几何**），激光光束另在 `world-render.js` 的 `drawHeavyMechBeams(g, this.enemyLasers)` 绘制（在玩家 `lasers` 之前） |
| 改掉落物图标（金币黄菱形 / 钻石天蓝菱形 / 经验充能圆点） | `world-render.js:550` 按 `d.type` 分派 + `entity-art.js:423 drawDropDiamond`（颜色在分派处传参 `0xffd54f` / `0x00e5ff`） |
| 新增一个点击按钮回调 | 绘制处 `this.buttons.push({id,x,y,w,h})` → `src/systems/ui/ui-runtime.js:615 onUIPointer` 加 id 分支 |
| 调整每帧渲染顺序 | `src/systems/ui/world-render.js:336 draw()`（世界层）与 `ui-runtime.js:243 drawUI()`（UI 层） |
| 改/加小地图（多箱庭） | `src/systems/ui/minimap.js`（`MinimapMixin:drawMinimap`，战斗态兜底分支 `ui-runtime.js` 调 `this.drawMinimap(this.uiG)`）+ 格子/面板布局常量在文件顶部；标记数据契约见 level-design skill §3.8 `cells[].marker` |
| 改售货机页布局 / 商品卡坐标 / 动画时长 | `src/systems/ui/screens.js:22 drawVendorShop`（坐标与动画时长写死在函数内，取设计稿 `docs/ui-designs/ui-ingame-shop.json` ×6；见第 5 章「售货机页布局与动画」表） |
| 改售货机商品池 / 老虎机种类 / 抽奖价 | 改 `策划文档/server/{消耗品,武器,老虎机}.xlsx` → `node tools/export-tables.mjs` 重生成 `data/inner-shop.json`（纯逻辑 `economy/inner-shop.js`），**无需改代码**；详见 economy-numbers skill |
| 改售货机图标解析 / 反色规则 | `src/systems/ui/vendor-shop-art.js`（`resolveArtRef` 按名精确匹配三库、`invertDesign` 已购反色） |
| 改售货机 F 键交互 / 商品落袋 / 摇奖结算 | `src/systems/economy/inner-shop-runtime.js`（`InnerShopMixin` 12 方法）；关卡侧入口 `level/interactables.js:updateVendorInteract`（level-design skill） |
| 改局内药水槽 / 临时武器槽位置或外观 | `src/systems/ui/battle-items-art.js`（顶部常量 `ITEM_SLOT_SIZE`/`POTION_SLOT_POS`/`TEMP_SLOT_POS`/`TEMP_TIME_BAR_*`）+ `drawPotionSlot`/`drawTempWeaponSlot` |
| 改药水选择轮盘几何 / 动画 / 命中 | `src/systems/ui/battle-items-art.js`（`WHEEL_*` 常量 + `drawPotionWheel` + `wheelHoverIndex`）+ 输入 `battle-items.js:updateBattleItemsInput` |
| 改局内状态图标位置 / 排序 | `src/systems/ui/battle-items-art.js`（`STATUS_*` 常量，**世界坐标**；`drawBattleStatusIcons` 列优先填充） |
| 改局内消耗品 / 限时武器数据（队列 / 使用 / 时长） | `src/systems/economy/run-items-runtime.js`（`RunItemsMixin` 14 方法）→ **economy-numbers skill** |
| 改「护盾」消耗品的即时吸收逻辑 | `src/systems/combat/player-combat.js:damagePlayer`（扣血前消费 `player.itemShields`）→ **combat skill** |
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
| `id` | 分支键，约定前缀：`upgrade_` `buyWeapon_` `buyMod_` `buyPet_` `buyVendor_` `idolCard_` `workshopCard_` `workshopTab_` `workshopSlot_` `shopTab_` `selectSave_` `levelMode_` `levelSmall_`；固定 id：`menuClose` `close` `vendorRoll` `levelBack` `settings_exit/retry/continue/confirm/cancel` `saveSelectBack` `settleHome`（`buyBuff_`/`buyBuff` 随旧三条 buff 商店一并删除） |
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
| `this.playerDeathFlow`（场景态，非 UI 私有） | `null` / `{phase:'cinematic'\|'hold'}` | 玩家被击败演出进行中：`drawUI` 走 `else if (this.playerDeathFlow) hideHudOverlay()`（在 `end/fail` 结算分支**之前**）+ `activeGraph` 排除它；由 `level-flow.js:triggerPlayerDefeat` 置位/收尾清空（详见 level-design §4⑨）。**黑幕保持期 `cinematicInputLocked()` 已为 false，输入锁靠它自己承担**（见第 7 章坑 46） |
| `this.idolOffer` | `null` / `{idol, cards[3], startT, hoverT[3], closing, closeStart}` | `interactables.js:195` 触发神像；选卡或**点空白触发离场**后置 null，点空白**不消耗神像**可再交互。**优先级最高**，盖过 settings/menu；`startT` 驱动滑入、`hoverT` 插值 hover 放大、`closing=true` 时 `closeStart` 驱动反向滑出，结束调 `closeIdolOffer` |
| `this.campfireOffer` | `null` / `{cf, layer:1\|2, options?, hoverT[], startT, closeStart, closing, switch?:{from:1\|2, startT}}` | 休息火堆**两层弹窗**状态（`interactables.js:290 openCampfireOffer(cf)` 置 `{cf, layer:1}` + 预取两图标 + 置 `state='paused'`）。`layer===1` 画 2 张白卡（生命回复 / 杰作升级！），`layer===2` 画 3 个武器升级按钮（`options` 由 `rollCampfireUpgrades` 只生成一次，`campfireBackToFirst` 回退**不重抽**）。`startT`/`closeStart` 驱动飞入/滑出（`SLIDE_MS`），`closing` 动画结束调 `closeCampfireOffer`。**`switch` = 层切换动画状态** `{from, startT}`（**`from` = 切层前的旧层号（1|2）**，`startT` = 动画起点 ms），由 `campfireChooseUpgrade()`/`campfireBackToFirst()` 在改 `layer` **之前**写入；绘制端 `el = now - startT` **两段串行**消费：阶段1 `el < LAYER_OUT_MS`(220) 只画 `from` 层（`yShift = ease*LAYER_SHIFT` 向下移出）、阶段2 `el < LAYER_OUT_MS+LAYER_IN_MS`(480) 只画当前 `layer` 层（`yShift = (1-ease)*LAYER_SHIFT` 自下方滑入）、`el>=480` `delete`；**同一帧只画一层**；动画期间 `onUIPointer` 因首行守卫含 `this.campfireOffer?.switch` **不响应点击**，结束自动恢复。选卡后 `cf.used=true` 消耗火堆；**点空白 `layer===2 → campfireBackToFirst()`、`layer===1 → closing=true`（不消耗火堆，可再交互）**。优先级与 `idolOffer` 同级（都盖过 settings/menu） |
| `this.campfireNearest` / `this.campfireTipT` | 火堆实体 / `null` / number 0..1 | 最近可交互火堆 / F 键提示淡入进度（`interactables.js:256 updateCampfireInteract` 每帧维护，`level-flow.js:154 restart` 置 `campfireTipT=0`）；由 `world-overlay.js:drawCampfireUI` 消费 |
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
| `this.enemyLasers` | `[{ ownerId, x0, y0, x1, y1, t, width, maxWidth, color }]` | **重装机兵激光光束**（场景级，不挂敌人）：起止点在发射瞬间定死（起点 = 头顶尖前方 `muzzleOffset×artScale`，终点按墙 + 世界边界裁剪），`t`/`width` 由 `enemy-ai.js:updateEnemyLasers` 每帧推进（`growMs→holdMs→fadeMs` 后移除）；`level-flow.js:restart` 置 `[]`、`defeatEnemy` 清该 owner；渲染 `world-render.js:drawHeavyMechBeams`。**伤害不在这里结算**（发射瞬间单次结算，见 combat skill） |
| `this.vendorActive` | 对象 / `null` | 当前打开的售货机实体（`openVendorShop(vendor)` 记录）；该 `vendor` 是 `level-flow.restart` 生成的副本，随重开换引用 |
| `vendor.stock` | `[{kind,id,name,desc,cost,artType,artName,durationSec?}]` / `undefined` | 该实体随机抽取并**持久**的 4 个商品（`rollShopStock` 商品池 7 选 4 不重复）；未就绪时 `undefined`（页面显「加载中…」）。同一实体重复打开不变、不同实体互相独立 |
| `vendor.bought` | `Set<index>` | 已购下标（每商品限购 1 次）；购买后卡片翻面黑底白边「已购买」+图标**纯白（`whiteVariant`，非反色）**、不再响应点击 |
| `vendor.slot`（7 字段） | 对象 / `null` | 老虎机状态：`{icons:[k0,k1,k2], prize:{kind,item?/amount?}, rolling, rollAt, settleAt, prizeAt, granted}`；`settleAt = rollAt + LOTTERY_ROLL_MS(2500)`，`prizeAt` 为中奖卡滑入起点 |
| `this.vendorView` | 对象 | 售货机页**自持**动画/装饰态（非实体字段）：`{vendor, t0, hover{}, flip{}, bought{}, deco[3], whiteCache, variantCache}`；`vendor` 换实体时整体重置→触发入场翻牌重播。未摇奖时窗口滚动图标层用的是**页面自持的 `deco`**（不叫 `slotPrefill`，该名全仓不存在）。`whiteCache`（`design → whiteVariant(design)` 纯白变体）供已购黑卡图标用（旧 `invCache`（反色）已删、`inv()`→`wh()`）；`variantCache` 为页面自持对比度缓存 `Map(design → Map(darkCard → design))`（白卡/黑卡两套变体不可混用），消耗品图标统一走 `screens.js` 内局部 `shopIcon(d, darkCard)` 取它 |
| `this.vendorCardContentG` / `this.vendorCardMaskG` / `this.vendorCardMask` | Graphics ×2 / GeometryMask | 售货机页私有「窗口滚动图标」裁剪层（懒建，content depth 1001、mask 源 depth 999）；`drawUI` 不清理它，靠 `this.events.on('preupdate')` 在非 vendor 页 `clear()` 兜底（见第 7 章坑 21） |
| `this.runItems` / `this.runTimedWeapons` | `[{id,count}]` / `[{id,name,ringColor?,durationSec,remainSec}]` | 局内消耗品（药水队列 **≤4**）/ 限时武器（**≤1**）仓库（**挂 scene 不挂 `state.player`**，随 `level-flow.restart` 清零）；`buyVendorItem`/`settleVendorRoll` 经 `addRunItem`/`addRunTimedWeapon` 写入（数据层 `RunItemsMixin`，见第 7 章坑 22） |
| `this.runEffects` / `this.tempWeaponActive` / `this.tempWeaponSaved` | `[{id,name,sec,...}]` / bool / 对象\|`null` | 限时生效中加成（**仅 `sec>0` 进此队列**，驱动状态图标）/ 临时武器使用中标志 / 使用临时武器时暂存的 `player.weaponType`（取消时还原）。**均挂 scene、随 `restart` 清零** |
| `this.potionWheel` / `this.potionKeyHold` / `this.potionWheelTexts` | `null`/`{phase:'in'\|'open'\|'out',t0,hover}` / number(ms) / Phaser `Text[]`（**最多 4 个**，懒建复用） | 药水轮盘状态机、数字键 4 长按计时、轮盘**每项各一份**药水名文本（第 i 项在**自己图标正下方**，字号 `WHEEL_NAME_FONT`=24）。**独立 `Text` 数组，`uiG.clear()` 清不掉**，须经 `hidePotionWheelTexts()` 在「屏蔽分支 / `hideHudOverlay` / `level-flow.js:restart`」三处隐藏；alpha 由 `drawBattleItems` 每帧跟随轮盘动画设置，**不进 `setHudAlpha`**（见第 7 章坑 28/42） |
| `player.itemShields` | 列表（含 `sec` 等） | 玩家身上**待吸收**的即时护盾列表（护盾消耗品生成）；`player-combat.js:damagePlayer` 扣血前消费、盾碎移除并记 `hitEffects`+抖屏（见第 7 章 + combat skill） |

文本 / 贴图 Map 组织：

| 容器 | 结构 | 建立时机 | 生命周期 |
| --- | --- | --- | --- |
| `this.uiTexts` | `{battle,interface,login,weapon,workshop: Map<nodeId, Text>}` | `buildUITexts()`（每次载入关卡） | 载入时全 destroy 重建 |
| `this.uiImages` | 同上，`Map<nodeId, Image>` | `loadUIImages()` 异步 `Image.onload` | 同上；贴图键 `__ui_img_{page}_{id}__` |
| `this.settingsTexts` | `Map<id, Text>` | `drawSettingsOverlay` 内 `ensure()` 懒建 | 常驻，靠 `setVisible` 开关 |
| `this.weaponShopTexts` / `vendorShopTexts` / `levelSelectTexts` / `idolOfferTexts` / **`campfireOfferTexts`** / `saveSelectTexts` / `workshopTexts` | `Map<id, Text>` | 各 `drawXxx` 内 `ensure()` 懒建（`campfireOfferTexts` 由 `campfire-art.js:60` 的 `ensureText(id,size,color,bold)` 建，depth 1001 + `cameras.main.ignore`；第 4 参 `bold` 用 `setStyle({fontStyle})` 切换粗细） | 常驻，`drawUI` 开头批量隐藏（`campfireOfferTexts` 按 `!this.campfireOffer`、`idolOfferTexts` 按 `!this.idolOffer`，其余按 `menuScreen`）；此外 `drawCampfireOffer` 末尾用**帧内 `visibleIds` 集合**对未绘制文本 `setVisible(false)`（切层后旧层文本不再残留，见第 7 章坑 51） |
| `this.menuIconSprites` | `Map<id, Image>` | `world-render.js:14 iconSprite(id, src)` 懒加载 | 常驻，贴图键 `__menu_icon_{id}__` |
| `this.loginLabels` | `Map<id, Text>` | `drawLoginButtons` | 常驻 |
| 世界层精灵 | `barrelSprites` `chestSprites` `vendorSprites` `idolSprites` `iconSprites` `portalTexts` `levelImageSprites` `gateTexts`（均 Map，`game-scene.js:43-52` 初始化） | 各 `syncXxxSprites` 按需建/删 | 数据里消失时 destroy |

> **火堆弹窗两套美术解析途径**（加图标前先分清走哪条）：
> - **第一层白卡图标 = vendor-shop-art「三库解析」**：按 `artType`（`像素` / `轮廓` / `动态资产`）在 `data/pixels` / `data/outlines` / `data/assets` 三库按 `artName` **精确匹配**（`resolveArtRef` / `getArtRef`），口径与售货机商品卡一致（含 `recenter` 归位 + `shopIconVariant(design,false)` 白卡转黑款，见第 7 章坑 48）。当前两卡：像素「生命值回满图标」、动态资产「杰作升级图标」。
> - **第二层武器升级图标 = design-store「单库」+ 黑色武器底盘叠加**：先用 `getDesign(WEAPON_BG_ASSET)`（未加载则 `ensureDesign`）以 `drawDesignCentered(g, bgD, cx, iconY, UP_ICON_BOX*s, t)` 画**黑色武器底盘**，再叠加武器美术 `drawDesignCentered(..., UP_ICON_BOX*WEAPON_ART_RATIO*s, t)`（`WEAPON_ART_RATIO=0.72`）；美术优先级 `scene.player.arts[wt]` 设计稿（`getDesign(artId)`，缺失时 `ensureDesign` 补拉）→ `WEAPONS[wt].appearance`（`elements` 非空才用）→ **局内环组兜底**（`drawHexRingPlayer(g, fakePlayer, ringScale, { hideWeaponRing:true })`，`ringScale = UP_ICON_BOX*WEAPON_ART_RATIO*s/(2*PLAYER_ART.bodyRingRadius)` ≈0.95*s；假 player `{ x, y, weapon:{ringColor: WEAPONS[wt]?.ringColor||'#ffa914'}, weaponAngle:0, artScale:1, moveLeanX:0, moveLeanY:0, scheme:'hex-ring' }`，只留 4 个同心环、去掉发射环与其上武器球；`drawWeaponGlyph` 兜底**已移除**；UI 路径判定是 `!Number.isFinite(Number(opts.screenScale))`，传 `{hideWeaponRing:true}` 仍走 UI 路径—— alpha 全 1、无环链；黑色底盘 `WEAPON_BG_ASSET` 仍先画、环组叠其上）；口径参考 `workshop.js`(257-272) 与 `battle-items-art.js`(113-135)，`t` 驱动动态元素。**第二层不再显示武器名**（已删 `campfireUpgrade_{i}_name` 文本，只留 `campfireUpgrade_{i}_desc`）。

## 4. 关键流程

**① 场景启动 → 首帧 UI**
`game-scene.js:40 create()` → 建 `bgG`(depth 0) / `g`(depth 10) 与 8 个精灵 Map → 预载桶/宝箱/售货机/神像贴图 → `:70 if (!this.editing) setupUI()`
→ `ui-runtime.js:24 setupUI()`：`cameras.add` 建 `uiCam` → 建 `uiG`(depth 1000) → **互相 ignore**（`cameras.main.ignore(uiG)`、`uiCam.ignore(g/bgG)`）→ 建工坊遮罩 → 初始化 `uiTexts/uiImages/buttons` 等容器 → 建常驻文本（failTitle/failHint/weaponLabels×3/ammoCurrent/ammoMax/hudIndicatorText，全部 depth 1001 且 `cameras.main.ignore`）→ `loadWeaponIcon()` → `:91 loadUIImages()`（遍历 5 个页面的 `image` 节点，`new Image()` 异步 → `textures.addImage` → `add.image` → 默认 `setVisible(false)`）
→ `create():99 restart()` → `level-flow.js:250 buildUITexts()`（先 destroy 旧文本/贴图 → 再 `loadUIImages()` → 为所有 `text` 节点建 Text）→ `:251 syncUIState()` → `:255 draw()` → `world-render.js:579 drawUI()`。

**② 每帧渲染顺序**
`game-scene.js:139 update(_, dt)` → （编辑态直接 `draw()` 返回）→ 工坊长按/滚动 → 闸门动画 → `updateLoginHover()` → intro/ESC/transition/非 playing 各分支都以 `this.draw()` 收尾 → 正常帧跑玩家移动、战斗、`:480 updateHud(dt)`、`:493 syncUIState()` → `:494 draw()`
→ `world-render.js:336 draw()`（世界层，画到 `bgG`/`g`）：`bgG.clear()` + 底色 → `applyBackground()` → `syncLevelImages()` → `g.clear()` → 虫洞 fx → 网格 → 墙 → 木箱 → `syncBarrelSprites` → `syncChestSprites` / `syncVendorSprites` / `syncIdolSprites` / `syncIconSprites` → `drawIcons` → `syncPortalSprites` → `drawChestEffects` → 传送门形状 + `drawPortalEffects` → `drawGates` → 触发器 / 生成区（编辑态）→ 敌人 + 命中特效 + 掉落 → `drawPlayer` + `drawShieldArc` → 新手提示 → `drawHubUI` / `drawVendorUI` / `drawIdolUI` / `drawIconUI` / `drawPortalUI` / `drawGuideArrows`（`:565-571`）→ **`drawHeavyMechBeams(g, this.enemyLasers)`**（重装机兵激光，排在玩家 `lasers` 之前）→ 子弹与拖尾 + `drawHitFlash` → **`:579 drawUI()`**
> 敌人本体与瞄准线在更早的「敌人」段绘制（`world-render.js:588` 的 `drawEnemyShape` → `drawHeavyMechBody`），因此激光光束盖在本体之上、玩家之下。
→ `ui-runtime.js:243 drawUI()`（UI 层，画到 `uiG`）：`uiG.clear()` → `buttons = []` → **所有 uiTexts / uiImages / menuIconSprites / settingsTexts 及各页 Map `setVisible(false)`** → fail 分支（黑幕 + 返回）→ 按优先级分支：`idolOffer` > `settingsMode` > `menuScreen`（黑底 + 对应页 + 右上关闭按钮）> `isMenuLevel()`（login 节点图 + 登录按钮，intro 期全隐）> `playerDeathFlow`（`hideHudOverlay()`，纯黑遮罩，**在结算分支之前**）> `end/fail`（`drawSettlement` 结算全屏页）> `paused/interface`（interface 节点图）> `isHubLevel()`（只隐 HUD）> 兜底战斗（battle 节点图 + `drawHud()` + `drawHudIndicator()`）→ 最后叠 `transition` 黑幕与 `levelIntro` 淡入。

**③ 点击链路**
`create():72 input.on('pointerdown')` → `editor-input.js:12 pointerDown(p)` → 非编辑态：`menuScreen` 存在时（工坊先吃 `handleWorkshopPointerDown`）→ `onUIPointer(p)`；`isMenuLevel()` 时遍历 `loginButtonRects` → `pressAnim(id)` + `onLoginButtonClick(id)`；`playing` 且命中 `settingsButtonRect` → `openSettingsOverlay()`；`paused` → `onUIPointer(p)`；`end/fail` → `onUIPointer(p)`（命中 `settleHome` → `pressAnim` + `exitToHome()` 回骑士之家，旧 `restart()` 已移除，无重试）
→ `ui-runtime.js:226 uiPointer()` 换算：读 `canvas.getBoundingClientRect()`，按 `scale = min(rect.w/1920, rect.h/1080)` 还原 CSS `object-fit: contain` 的黑边偏移，输出 1920×1080 空间坐标
→ `ui-runtime.js:507 onUIPointer(p)`：`idolOffer.closing` 时直接 `return`；否则遍历 `this.buttons` 做 AABB 命中 → 按 id / id 前缀派发到业务回调（`applyUpgrade` / `buyWeapon` / `buyMod` / `buyPet` / `buyVendorItem` / `rollVendorSlot` / `chooseIdolBuff` / `toggleWorkshopWeapon` / `clickWorkshopSlot` / `ctx.onSelectSave` / `ctx.onOpenLevel` …）→ 命中即 `return`（一次只触发一个按钮）；**若 `idolOffer` 存在且未命中任何卡 → 置 `closing=true` 触发离场滑出（不消耗神像），动画完成后 `closeIdolOffer()`**。
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
**宝箱尺寸**：`syncChestSprites` 的缩放 = `Math.max(c.w || 0, c.h || 0, 1) / 贴图帧宽 × (开启态补偿)`——按 `max(w,h)` **等比**（`w≠h` 也不拉伸），`w`/`h` 由宝箱属性面板或拖角手柄改（契约见 level-design §3.6）。
**宝箱上锁红环**：`draw()` 里宝箱分两支——编辑态画选中盒（虚线圆 `openRadius` + `w/h` 包围盒 + 四角手柄，供拖动缩放）；**运行态对每个宝箱取 `alpha = lockAlpha × roomRevealAlpha`，`alpha<=0` 直接 `return` 不画，否则 `lineStyle(CHEST_LOCK_RING_THICKNESS, CHEST_LOCK_RING_COLOR, alpha)` + `strokeCircle(c.x, c.y, chestLockRadius(c))`**（半径随 `w`/`h` 联动；未知房间未揭示时 `roomRevealAlpha`=0 一并隐藏）。**渐显/渐隐走 `chest.lockAlpha`（上锁 0→1 / 解锁 1→0），由 `interactables.js:updateChests(dt)` 每帧推进——渲染端只读、不做计时**；`lockAlpha` 缺失时回落 `locked ? 1 : 0`。红环的碰撞体由 `interactables.js:chestLockWalls` 提供（**碰撞随 `locked` 即时生效/失效，与渐隐动画无关**），五个消费点见 level-design §3.14。
Map 缓存的原因：Phaser 精灵创建/销毁成本高且贴图是异步的，60fps 下不能每帧重建；用 id 作键可让「数据数组顺序变化 / 元素增删」都稳定复用，同时保证被删数据对应的精灵一定被销毁不残留。

**⑦ 售货机页链路（F 键 → 商品购买 / 老虎机抽奖）**
`interactables.js:225 updateVendorInteract`（靠近显 tips、按 F）→ `inner-shop-runtime.js:15 openVendorShop(nearest)`：记 `this.vendorActive=vendor`、`this.vendorView=null`（触发入场翻牌重播）、`ensureVendorStock(vendor)` → `setupVendorStock`：`rollShopStock(data)` 写 `vendor.stock`（商品池 7 选 4 不重复）+ `vendor.bought=new Set()` + `preloadVendorArt`（预取商品与老虎机种类画板资产）→ `openMenuScreen('vendor')`（暂停态）。
每帧 `drawUI` 走 `menuScreen==='vendor'` 分支（`ui-runtime.js:332` 黑幕 alpha **0.85**、`:336` 调 `screens.js:22 drawVendorShop`）→ 页面绘左老虎机 + 右 2×2 商品卡 + 金币栏。
点击派发（`ui-runtime.js:606-607`）：`buyVendor_<i>` → `buyVendorItem(i)`（扣 `player.gold`、`vendor.bought.add(i)`、消耗品 `addRunItem`/武器 `addRunTimedWeapon`）；`vendorRoll` → `rollVendorSlot()`（扣 `lottery.drawCost`、`rollLottery` 出 `{icons,prize}`、置 `vendor.slot{rolling:true,rollAt,settleAt}`）。
到点结算：`game-scene.js:819 updateVendorSlot()` 每帧检查 `time.now >= slot.settleAt` → `settleVendorRoll()`（`rolling=false`、`granted=true`、`prizeAt=now`、发奖）；`drawVendorShop` 在 `now>=settleAt` 时也会调一次（页面可见时即时定格），两条路径都走**幂等** `settleVendorRoll`。发奖：武器→随机 1 把入 `runTimedWeapons`；护盾→`inLottery` 消耗品随机 1 个入 `runItems`；金币→`player.gold += lottery.goldPrize`；垃圾/未中奖→不发。
页面 **7 类动画**（全在 `drawVendorShop` 内按 `time.now - vv.t0` 插值）：① 入场翻牌 `flipAt(delay)=Clamp((now-t0-delay)/200,0,1)` 横向缩放，各级 delay `0/30/180/60+i*30`ms（旧 `/400` + `0/60/360/120+i*60` 全部减半）；② 摇奖滚动——`slot.rolling` 时 3 窗图标纵向循环（pitch 130 / speed 1.2 / 每窗相位 +37），无 `slot` 预览态 speed 0.35 用 `deco`；③ 依次定格——`now >= slot.settleAt + i*140` 第 i 窗切 `slot.icons[i]`（错开 140ms）；④ 中奖卡滑入——`!rolling && prizeAt>0` 自下 40px 滑入 `(now-prizeAt)/300`，展示 1800ms 后收起；⑤ 购买翻面——`vv.flip[i].t0` 起 `(now-t0)/300` 做 `|1-2fp|` 翻转、过半换「已购买」+ 图标纯白（`whiteVariant`，旧为反色）；⑥ 悬停放大 10%——`hoverOf` 每帧 ±0.18 插值 → `1+0.1*t`（滚动中禁用）；⑦ 按下缩放——`pressScale`（120ms `0.85→1`）叠乘。

**⑧ 局内消耗品 / 临时武器 HUD 链路（药水槽 → 轮盘 → 状态图标）**

数据层 `RunItemsMixin`（`run-items-runtime.js`，14 方法，**详见 economy-numbers**）持有 `runItems`/`runTimedWeapons`/`runEffects`/`tempWeaponActive`；UI 层 `BattleItemsMixin` 只读它并画 HUD。每帧 `game-scene.js` `update` 里 `updateVendorSlot()` → `updateRunItems(dt)`（推进限时武器/生效倒计时）→ `updateBattleItemsInput(dt)`。

- **药水槽**：`hud.js:drawHud` 末尾调 `battle-items.js:drawBattleItems(g)` → 读 `getFrontPotion()` 画左下药水槽（**有药水 = 黑底 + 白框 + 纯白图标 `whiteVariant`**（与设计稿「白底黑图」相反，与局内黑底 HUD 统一），取「最先获得且未被使用」那瓶；空槽 = 黑底 `#CFCFCF` 边）+ 槽下 4 个队列小点（前 N 个实心白，间距 `POTION_DOT_GAP`=8）。右侧临时武器槽取 `getTempWeapon()`，**三态**：空（无武器/外观未加载）= 黑底 `0x000000` + 灰边 `#CFCFCF`、无时间条（无武器不画底盘）；**有武器未使用 = `0x000000` 黑底 + `0xffffff` 白框 + **原色**武器图案 + **圆形黑底盘（`WEAPON_BG_ASSET`，黑底上不可见）****（图案 `drawDesignCentered(g, design, x, y, size*0.62, t)`，**不反白**）；**使用中 = `0xffffff` 白底 + 武器 `ringColor` 亮框 + **原色**武器图案 + **同款圆形黑底盘（白底上显出黑盘）** + 槽上 12px 剩余时间条**（宽 = `90×remainSec/durationSec`、色 = `ringColor`）。`color` 由 `battle-items.js` 传 `WEAPONS[id]?.ringColor || getWeaponDef(id)?.medium?.ringColor || '#ffffff'`。**武器槽两态（含使用中）都叠加圆形黑底盘 —— `WEAPON_BG_ASSET`（`systems/constants.js`）与 `getDesign`（`systems/art/design-store.js`）的 import 已恢复，该文件依赖回到 4 个（constants / asset-render / design-store / vendor-shop-art）；武器图案两态恒为原色，两态视觉区别回到 4 处（底色 + 边框色 + 底盘可见性 + 有无顶条）；图案透传 `t` 保持自转。**
- **轮盘**：`updateBattleItemsInput` 记 `potionKeyHold`，**长按数字键 4 ≥ `POTION_HOLD_MS`(160ms) 且队列非空** 才置 `potionWheel={phase:'in',t0,hover:-1,hoverT0}`；`potionWheel.phase` 走 `'in'→'open'→'out'→null`，**300ms**(`WHEEL_ANIM_MS`) 内 alpha 0↔1 且**以圆心为缩放中心**缩放 0.8↔1。打开时每帧用 `uiPointer()`（UI 坐标）算 `wheelHoverIndex` 定位悬停扇区（**切换扇区 / 进出死区都重置 `hoverT0`**）；**淡出相位冻结 hover 更新**（否则高亮跳扇区、渐显重亮）；悬停蒙层按 `hoverT0` 独立渐显 `hoverFade`（`WHEEL_HOVER_FADE_MS`=160ms，线性径向渐变见第 5 章）；**死区内悬停 = 不选中（-1）**。**轮盘名称文本改为「每项图标下各一份」（共 ≤4 个）**：`battle-items.js:drawBattleItems` 懒建 `this.potionWheelTexts` 数组 → 每帧 `setPosition(wheelNamePos(i, scale))` + `setText(entries[i].name)` + `setAlpha(alpha).setVisible(!!name)`，多出 `entries.length` 的隐藏；字号固定 `WHEEL_NAME_FONT`=**24px**（**不随 `scale` 变**，避免每帧重排文字纹理），只按 `scale` 挪位置；文本 alpha 跟随轮盘自身呼出/消失动画 alpha（**与轮盘同进同出**）。显示的是**药水名称 `entries[i].name`（消耗品 `name`，非 `desc`）**——依据设计稿 `docs/ui-designs/ui-useRoundInGame.json` 该文本元素 note「显示对应的药水名称（如有）」。**候选药水图标为黑底实心圆 + 白色图标、无任何边框**（圆心死区的圆仍有白边 + 白叉号）。**轮盘打开期间绝不改 `this.state`、游戏不暂停**（照常移动/开火）。
- **按键语义**：短按 4 → `useFrontPotion()`（用前方药水）；长按松手 → `usePotionAt(hoverIndex)`（hover = -1 不用）；数字键 5 → `toggleTempWeapon()`（使用/取消临时武器）。
- **状态图标**：游玩态 `world-render.js` 在 `drawShieldArc` 后调 `this.drawBattleStatusIcons(g, this.player)` → `battle-items-art.js:drawBattleStatusIcons` 按 `runEffects` 在玩家左下角画 18×18 **白色**图标（`whiteVariant`），**列优先**（先第一列自上而下、再第二列），最多 8 个，画在**世界层**随相机缩放。
- **屏蔽条件**：`this.editing` / `menuScreen` / `settingsMode` / `state !== 'playing'` / 菜单关 / Hub 关 → 每帧清空 `potionKeyHold`/`potionWheel`、调 `hidePotionWheelTexts()` 隐藏轮盘名文本并提前 return（否则离态后轮盘/文字残留 / 误吃按键）。

**⑨ 休息火堆两层弹窗链路（F 键 → 回血 / 升级二选一）**
`interactables.js:256 updateCampfireInteract(dt)`（`game-scene.js:842` 每帧、受 `inputLocked` 门控）：编辑态/非 `playing` 清 `campfireNearest`+`campfireTipT`；否则遍历 `this.campfires` 找最近（未 `used`、`visible!==false`、`reach = max(interactRadius||150, 半对角线 + p.r + 40)`），写 `campfireNearest` 并按 `dt/180` 淡入 `campfireTipT`；命中且按 **F**（`JustDown`）→ `openCampfireOffer(nearest)`。
`openCampfireOffer(cf)`（`interactables.js:290`）：置 `campfireOffer={cf, layer:1}`、`preloadArtRefs` 预取两图标、`state: playing→paused`、`syncUIState()`；下一帧 `drawUI` 走 `if (this.campfireOffer)` 分支（**在 `idolOffer` 分支之后、`settingsMode` 之前**）：`hideHudOverlay()` + `drawCampfireOffer(this)`（模块导出函数）+ `return`。
绘制（`campfire-art.js`）：黑条+卡片飞入 `slide=(1-ease)*BAR_H`（`SLIDE_MS=450` / ease `1-(1-q)^3`）；`layer===1` 画 2 张白卡（id `campfireCard_0/1`，hover 放大 `1+0.1*hoverT` × `pressScale`，标题 `NAME_SIZE='24px'` 加粗 / 说明 `DESC_SIZE='17px'`）；`layer===2` 画 3 个升级按钮（id `campfireUpgrade_0..2`；图标 = 黑色武器底盘 `WEAPON_BG_ASSET` + 武器美术 `WEAPON_ART_RATIO=0.72` 叠加（设计稿/`appearance` 都缺时第三级兜底 = 局内环组 `drawHexRingPlayer({hideWeaponRing:true})`，见第 3 章）；**不画武器名**，只显示词条 `campfireUpgrade_{i}_desc`，按 `UP_DESC_WRAP` 自动换行、`UP_DESC_SIZE='15px'`）。
**层切换动画（两段式状态机）**（1↔2）：`campfireChooseUpgrade()`/`campfireBackToFirst()` 在改 `offer.layer` **之前**写 `offer.switch={from: 旧层号, startT: now}`；绘制端每帧 `const el = now - offer.switch.startT`，按下述**严格串行**分支绘制（ease 一律 `1-(1-q)^3`）：

- **阶段1 `el < LAYER_OUT_MS`(220)**：**只画旧层 `offer.switch.from`**，`yShift = ease(el/LAYER_OUT_MS) * LAYER_SHIFT`（向下移出）。
- **阶段2 `LAYER_OUT_MS <= el < LAYER_OUT_MS+LAYER_IN_MS`(480)**：**只画当前层 `offer.layer`**，`yShift = (1 - ease((el-LAYER_OUT_MS)/LAYER_IN_MS)) * LAYER_SHIFT`（从下方滑入）。
- **`el >= 480`**：`delete offer.switch`，此后只画当前层（`yShift = 0`）。

**核心不变量：同一帧只画一层**（消除旧「同帧两层交错滑动」的视觉残留，见第 7 章坑 53）；`LAYER_SHIFT = BAR_H - CARD_TOP_IN_BAR = 282`，卡片顶正好滑到屏幕底部、完全出屏不留残影。卡片按钮 `scene.buttons.push` **只随被绘制的那层**执行、`offer.hoverT` **不重置**；帧末 `visibleIds` 统一隐藏未绘制文本（阶段1 只画旧层 → 新层文本被隐藏；阶段2 首帧起旧层文本被隐藏）。动画期间 `onUIPointer` 首行守卫含 `|| this.campfireOffer?.switch` → **不响应点击**，结束自动恢复。
点击（`onUIPointer`）：`campfireCard_0 → campfireChooseHeal()`（`campfireHeal(this)` 回满血 + `cf.used=true` + `closing=true`）；`campfireCard_1 → campfireChooseUpgrade()`（`layer=2` + `rollCampfireUpgrades` 生成 `options`，只生成一次）；`campfireUpgrade_i → campfirePickUpgrade(i)`（`entries` 空则不可选；生效后 `applyCampfireOption` + `cf.used=true` + `closing=true`）。
**空白点击语义**（`onUIPointer` 末尾 `:650-653`，改前先过 `:597` 的 `closing`/`switch` 守卫）：`layer===2` → `campfireBackToFirst()`（回第一层，**带两段式层切换动画**，`options` 保留不重抽）；`layer===1` → `closing=true`（触发离场滑出，**不消耗火堆**，可再次按 F 交互）。`closing` 动画跑到 `q>=1` 调 `closeCampfireOffer()`（置 null + `state` 恢复 `playing`）。

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
| `PAGE_FADE_MS` | `systems/ui/ui-runtime.js:23` | `140` | 全屏菜单页/设置蒙层 蒙层淡入/淡出时长 | 页面开关的溶解快慢（**所有全屏页共用**：售货机/武器商店/工坊/选关/存档选择…；选关页旧特例同为 140） |
| `WEAPON_BG_ASSET` | `systems/constants.js` | `asset-1788442424562` | 商店/工坊/头像的「武器图标背景」固定动态资产（`data/assets`，名称「武器图标背景」；**运行期是黑盘 —— 3 个元素色全 `#000000`（实心 24 边形 + 两条旋转黑弧），其 `bgColor:"#ffffff"` 运行期不渲染（见坑 38）**） | 商店卡片/头像下层背景渲染；上层叠武器 `appearance`/玩家本体。**局内武器槽两态（含使用中）都渲染它**（`battle-items-art.js` 已恢复该 import + `getDesign`，见坑 38） |
| `ICON_SETTINGS/EXIT/RETRY/CONTINUE` | `systems/ui/ui-runtime.js:16-19` | `/icons/设置.png`、`退出.png`、`再来一次.png`、`继续.png`（URL 编码） | 菜单图标路径 | 设置按钮与蒙层图标；走 `/icons/` HTTP 接口 |
| 武器图标 | `systems/ui/ui-runtime.js:130` | `图标/ninja_icon.svg`，贴图键 `weapon-yellow`，80×80 | yellow 武器图标 | 轮盘中心图标（仅 yellow 用图，其他用文字） |
| 贴图键 | `systems/constants.js:18-32` | `__barrel__` `__chest_closed__` `__chest_open__` `__vendor__` `__idol__` | 世界层精灵贴图键 | `textures.exists` 判定与 `setTexture`；动态键：`__level_bg__`、`__lvl_img_{id}__`、`__ui_img_{page}_{id}__`、`__menu_icon_{id}__` |
| 图标资源路径 | `systems/constants.js:17,30,32` + `game-scene.js:66-67` | `/barrel.png` `/vending.png` `/idol.png` `/chest-closed.png` `/chest-open.png` | 世界层贴图源 | 换美术改这里 |
| `CHEST_SIZE` / 修正 | `systems/constants.js:26-27` | 75 / `1005/852` | 宝箱**默认**尺寸（`normalizeChest` 的 `w`/`h` 缺省值）+ 开启态补偿 | 新放置宝箱的视觉大小与开合同宽；已有宝箱以关卡 JSON 的 `w`/`h`（编辑器可改）为准 |
| `CHEST_OPEN_FX_MS` / `CHEST_SPAWN_FX_MS` | `systems/constants.js:28-29` | 320 / 260 | 十字星特效时长 | 宝箱开启/出现闪光快慢 |
| `CHEST_LOCK_RING_COLOR` / `CHEST_LOCK_RING_THICKNESS` / `CHEST_LOCK_FADE_MS` | `systems/constants.js:32-33/35` | `0xff3b3b` / `8` / 260 | 宝箱上锁红环颜色 / 厚度(px) / 渐显渐隐时长(ms) | 红环外观与碰撞厚度（半径 `state.js:chestLockRadius` 含 `thickness/2`）；渐显渐隐只影响显示 |
| `PORTAL_ALPHA` / `PORTAL_LABEL` / `PORTAL_COLOR` | `systems/constants.js:26-28` | 0.6 / `EVACUATION` / `0x00ffff` | 传送门表现 | 传送门透明度、标签、主体色 |
| `PLAYER_ART` / `PLAYER_ART_SCALE` | `systems/constants.js:38-53` | scale 0.5；hex 10、inner 12、outer 16、outer2 20、body 35、weaponRing 40 | 玩家六边形与 5 层环 | 玩家整体体型；`PLAYER_COLLISION_RADIUS` 由 weaponRing 推导，改了会连带改碰撞 |
| `PLAYER_LEAN` | `systems/constants.js:61` | `{hex:12,inner:9,middle:7,outer:5,speed:48}`（本轮删 `minHexRadius`） | 移动倾斜量 | 玩家移动时各层偏移手感 |
| `WEAPON_RING_CHAIN` | `systems/constants.js:64` | `{count:120, ratio:0.75, minPx:1, minZoom:1.8, refZoom:3.5, stepMs:100, fadeMs:100}` | 武器内圈环链 / 出场动画 | 链环数 / 半径厚度比 / 屏幕最小厚度(px) / 最小相机 zoom / **厚度判据的参考相机缩放(固定值)** / 每元素出场间隔(ms) / 单元素渐显(ms)；**zoom<minZoom 时不生成环链，仅放大（运镜/缩放）时可见**；厚度剔除用 `chainRefScale(refZoom)` 固定值（不用当帧 zoom），可见集合稳定 |
| `SHIELD` | `systems/constants.js:58` | `{color:'#00eeff',arcDeg:120,gap:10,fadeMs:500}` | 护盾弧外观 | `drawShieldArc` 表现 |
| `UI_COLORS` | `src/ui-layer.js:75-86` | panelBg `#0e2233`、panelStroke `#2f5a7a`、hpFill `#e84c5e`、expFill `#4fc3f7`、coin `#ffd54f`、text `#eaf4fb`… | 数据驱动 UI 默认配色 | 所有未显式指定 `fill/stroke/color` 的节点 |
| tips 面板 | `systems/ui/world-overlay.js:92-93` | `w 200 / h 44 / skew 18`，偏移玩家 `+20,-20`，字号 22px | 世界层交互提示条 | 4 种 tips 统一外观 |
| `GATE_SPAWN_MS` / 闸门配色 | `systems/constants.js:79-82` | 500 / `#FFE6BE` / `#FFCB85` / 0.14 | 闸门动画与色 | 闸门开合表现 |
| `ROTATE_HANDLE_OFFSET` | `systems/constants.js:78` | 28 | 编辑器旋转手柄距离 | 编辑器选中手柄（详见 engine-editor skill） |
| `SETTLE_SUCCESS_COLOR` / `SETTLE_FAIL_COLOR` | `systems/constants.js:14-15` | `#33ff33` / `#ff3b3b` | 结算页标题（成功绿/失败红）与过关球绿 | `drawSettlement` 顶左文案与进度球配色 |
| `SETTLE_BALL_R` | `systems/constants.js:16` | 42 | 结算页进度球半径（设计 7px×6） | 进度球大小 |

### 局内消耗品 / 轮盘 / 状态图标几何（`battle-items-art.js`）

设计稿背景框 `836,588,320×180` = 1920×1080 的 1/6，**一律 ×6**（坐标一律为**中心点**语义；槽底对齐基准线 = `VIEW_H-16` = 1064）：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `ITEM_SLOT_SIZE` / `SLOT_CORNER` | 90 / 12 | 槽位边长 / 圆角 |
| `POTION_SLOT_POS` | (1220, 1019) | 药水槽中心（槽底 = y+45 = 1064，与底角 HUD 基准线平齐） |
| `TEMP_SLOT_POS` | (1329.5, 1019) | 临时武器槽中心（与药水槽同步右移 50px、下移 53px，两槽一起挪） |
| `POTION_DOT_GAP` | 8 | 槽底与队列小点中心间距（旧硬编码 12；下移后收 8，点范围 1068~1076 不越 1080 底边） |
| `TEMP_TIME_BAR_GAP` / `TEMP_TIME_BAR_H` | 12 / 6 | 武器剩余时间条（槽上方 12px、高 6、宽 = 90×剩余比例、色 = 武器 `ringColor`；按中心点算，槽位移动自动跟随） |
| `WHEEL_CX` / `WHEEL_CY` | 967.5 / 512.25 | 轮盘圆心 |
| `WHEEL_RADIUS` / `WHEEL_ICON_SIZE` | 224 / 114 | 图标所在半径 / 图标直径 |
| `WHEEL_DEAD_ZONE` / `WHEEL_LINE_LEN` / `WHEEL_LINE_W` / `WHEEL_RING_R` | 48 / 212 / 3 / 284 | 中心死区半径 / 45° 分隔线长 / 线宽 / 扇区外半径 |
| `WHEEL_ANIM_MS` | 300 | 轮盘呼出·消失动画时长（渐显渐隐 + 缩放 0.8↔1，旧值 600） |
| `WHEEL_NAME_FONT` / `WHEEL_NAME_GAP` | 24 / 12 | 轮盘**每项**药水名文本字号 / 描述文本与图标**下边缘**的间距（`wheelNamePos(i,scale)` 使用；旧版「单点定位 + 更大字号」方案已作废） |
| `WHEEL_HOVER_FADE_MS` / `WHEEL_HOVER_RINGS` | 160 / 24 | 悬停蒙层自身渐显时长 / 径向渐变分层数 |
| `WHEEL_HOVER_ALPHA_IN` / `WHEEL_HOVER_ALPHA_OUT` | 0.5 / 0.1 | 最内侧 / 最外侧透明度（沿半径**线性**插值） |
| `STATUS_ICON` / `STATUS_PITCH` / `STATUS_COLS` / `STATUS_ROWS` / `STATUS_ORIGIN` | 18 / 24 / 2 / 4 / (-105, -31.5) | 状态图标尺寸 / 间距 / 列 / 行 / **相对玩家中心左上角（世界坐标）** |
| `POTION_HOLD_MS`（`battle-items.js`） | 160 | 数字键 4 长按阈值（ms） |

**武器槽三态配色**（`drawTempWeaponSlot`，与药水槽口径不同；药水槽仍恒为「有药水 = 黑底白框纯白图」）：

| 状态 | 槽位底色 | 边框 | 武器图案 | 背景盘（`WEAPON_BG_ASSET`） | 时间条 |
| --- | --- | --- | --- | --- | --- |
| 空槽位（无武器 / 外观未加载） | `0x000000` | `#CFCFCF` | — | 不画 | 无 |
| 有武器**未使用** | `0x000000` 黑底 | `0xffffff` 白框 | **原色**（`drawDesignCentered`，不反白） | **画**（`size*0.82`，黑底上不可见） | 无 |
| **使用中** | `0xffffff` 白底 | 武器 `ringColor` 亮框（`hexToInt(color)`） | **原色**（不反白） | **画**（同款黑盘，白底上显出） | 有（槽上方 `TEMP_TIME_BAR_GAP`=12px，宽 = 槽宽 × `remainSec/durationSec`、色 = `ringColor`） |

> 两态视觉区别有**四处**：槽位底色（黑/白）+ 边框色（白 / `ringColor`）+ **底盘可见性**（黑底上不可见 / 白底上显出黑盘）+ 有无时间条 —— 不是「只差时间条」。**武器图案两态恒为原色**（用户明确要求），**两态（含使用中）都渲染圆形黑底盘**（用户原话：「临时武器槽位的圆形黑色底盘背景即使在已使用状态，也需要渲染」）；`color` 由 `battle-items.js:drawBattleItems` 传 `WEAPONS[id]?.ringColor || getWeaponDef(id)?.medium?.ringColor || '#ffffff'`；`t`（秒）驱动**武器图案与背景盘的旋转元素**自转（`tSec = time.now / 1000`）。

轮盘 4 扇区（上/右/下/左，index 0..3，**顺时针、正上方为 0**）扇区中心角 = `-90° + i×90°`；**该角度公式只在 `wheelIconPos(i, scale)` 内实现一份**（`drawPotionWheel` 的图标坐标与 `wheelNamePos` 都调用它，勿在别处内联）；每瓶为黑底实心圆 + **白色图标**（`whiteVariant`）、**无任何边框**；**每项名称文本位于该项图标正下方**（`wheelNamePos(i, scale)` = 图标中心 + `(WHEEL_ICON_SIZE/2 + WHEEL_NAME_GAP) * scale`）；悬停扇区用灰 `#CFCFCF` **`WHEEL_HOVER_RINGS`(=24) 层细密同心扇环做线性径向渐变**（每层取环中点半径比例插值 `alpha = ALPHA_IN + (ALPHA_OUT-ALPHA_IN)×(环中点半径/R)`，最内 0.5 → 最外 0.1），每层再乘 `hoverFade`（由 `battle-items.js` 按 `hoverT0` 独立渐显）与轮盘整体 alpha；圆心黑底白边圆 + 白色叉号。

### 售货机页布局与动画（设计稿 `docs/ui-designs/ui-ingame-shop.json`，背景 320×180 @(485,797) ×6 放大到 1920×1080）

换算：`sx=(dx-485)*6, sy=(dy-797)*6, sw=dw*6`。关键坐标（屏幕 px，**写死在** `screens.js:22 drawVendorShop`）：

| 元素 | 坐标 (x,y,w,h) | 备注 |
| --- | --- | --- |
| 老虎机白卡 | `(204,228,594,330)` | 中心 `WC_CX=501` |
| 老虎机底板 | `(216,540,570,390)` | 黑底 + 白边 24；`PANEL_CX=501`（路径 `216..786`、白色外沿 `204..798` 与上半白卡 `204..798` 对齐；宽仍 570、线宽仍 24） |
| 3 个窗口框 | x=`258/429/603`，`(_,318,144,144)` | 窗口中心 `wCx=[330,501,675.18]` |
| 窗口图标卡 | x=`270/441/615.18`，`(_,330,120,120)` | 滚动图标裁剪到本矩形 |
| 抽奖按钮 | `(344.7,564,315,90)` | id `vendorRoll`，价签 = `lottery.drawCost` |
| 中奖弹出卡 | `(365.4,703.5,271.2,153)` | 从下 40px 滑入 |
| 右 2×2 商品卡 | x=`1050/1410`，y=`228/618`，`(_,_,285,324)` | 4 张 |
| 金币栏 | `(1326,30,324,72)` | 显示 `player.gold` |
| 卡内图标中心 | `(x0+141, y0+129)` | 商品卡图标中心 |
| 购买按钮 | `(x0+30, y0+252, 222, 60)` | id `buyVendor_<i>` |

| 常量 / 数值 | 当前值 | 含义 |
| --- | --- | --- |
| 遮罩 alpha | `0.85`（仅 vendor 页；其余页 1.0） | `ui-runtime.js:332` |
| 图标统一 boxSize | 商品卡 150 / 老虎机窗口内图标 88 / 中奖卡 88 | `drawShopIcon` / `drawDesignCentered` 的 box；各类图标取 box 的系数见下方「售货机图标口径」 |
| `LOTTERY_ROLL_MS` | 2500 | 摇奖滚动时长（`economy/inner-shop.js:13`）= `settleAt - rollAt` |
| 定格错开 | 140 ms | 第 i 窗定格延迟（`settleAt + i*140`） |
| 中奖卡展示 | 1800 ms | `prizeAt` 起计时，到点 `prizeAt=0` 收起 |
| 入场翻牌时长 / 错开 | 200 ms / 30 ms | `flipAt` 区间与各级 delay（旧 400/60 全部减半）：`0/30/180/60+i*30` |
| 购买翻面时长 | 300 ms | `vv.flip[i]` |
| 中奖卡滑入时长 | 300 ms（位移 40px） | `(now-prizeAt)/300` |
| `SHOP_ITEM_COUNT` | 4 | 商店商品数（`economy/inner-shop.js:11`）；池 = 消耗品全量 + 武器「是否加入局内临时=1」 |
| `lottery.drawCost` / `lottery.goldPrize` | 15 / 15 | 抽奖价 / 金币奖（`data/inner-shop.json`；导表常量 `DEFAULT_DRAW_COST`/`DEFAULT_GOLD_PRIZE`） |
| 老虎机种类权重 | 武器 5 / 护盾 10 / 金币 15 / 垃圾 15 | 「直接出货权重」（`data/inner-shop.json`）：先按权重判直接出货（命中则三窗同款并发放），未命中则 3 窗各自等概率 4 选 1，三窗同款才发奖 |

**售货机图标口径（尺寸 / 居中 / 对比度 / 底板对齐）**

| 项 | 口径 | 说明 |
| --- | --- | --- |
| 商品卡图标 | 武器外观 `box*0.5`、武器背景盘 `box*0.72`、消耗品图标 `box*0.5`（`box = 150*s`） | `screens.js:drawVendorShop` 商品卡分支；消耗品原为 `box*1.0`，现统一到武器卡尺寸；缺图兜底白圆半径 `box*0.25` |
| 老虎机 3 窗图标 | `REEL_ICON_SIZE` = **88**（固定，不随卡片缩放；窗口白卡 120×120 → 四周各留 16px 内边距） | `screens.js:drawVendorShop` 局部常量；`drawShopIcon(..., REEL_ICON_SIZE, tSec)`（原硬编码 `120` 顶格）；图标未就绪白圆占位半径 `REEL_ICON_SIZE * 0.34`（≈30） |
| 中奖卡图标 | 消耗品 `88*0.5`、武器背景盘 `88*0.72` / 外观 `88*0.5` | `screens.js:drawVendorShop` 中奖弹出卡分支 |
| 居中（`recenter`） | 把 `design.center` 设为**负的包围盒中心** `-(minX+maxX)/2, -(minY+maxY)/2`（用 `designBounds(d,0)`） | `drawDesignCentered` 位置锚点是 **design 原点**、缩放按**包围盒**；归位后包围盒中心落在给定 `(cx,cy)`，不再偏出框外。三种 artType 统一走它 |
| 对比度 | 白卡（未购买）：`shopIcon(d, false)` = `shopIconVariant(d, false)` → `isNearWhite(d) ? blackVariant(d) : d`；**已购黑卡：`wh(d)` = `whiteVariant(d)` 纯白**（旧为 `shopIconVariant(d, true)`/`invertDesign`，本轮改）；背景盘（`WEAPON_BG_ASSET`）一律**保持原色** | 不是「按背景自动反色」：白卡只把近白款改黑款；已购黑卡要「统一白」**必须用 `whiteVariant`**（`invertDesign` 逐通道取反会把黄变蓝紫）。`isNearWhite` 要求所有可见颜色每通道 ≥ 0.85；`shopIconVariant` 的黑卡分支（`invertDesign`）保留导出但卡片不再调用 |
| 底板对齐 | `PANEL_CX = 501` | 底板路径 `216..786`、白色外沿 `204..798`，与上半白卡完全对齐；`PL_CX = 502.2` 继续用于抽奖按钮/金币菱形/抽奖价格文本/中奖弹出卡 |

### 休息火堆两层弹窗常量（`campfire-art.js`，逐字）

全部为文件顶部模块常量，改一层/二层观感先动这里：

| 常量 | 当前值 | 含义 |
| --- | --- | --- |
| `SLIDE_MS` | `450` | 黑条+卡片整体飞入 / `closing` 向下滑出时长 |
| `BAR_H` | `336` | 底部黑条高度（同神像弹窗） |
| `CARD_W` / `CARD_H` / `CARD_GAP` / `CARD_TOP_IN_BAR` | `408` / `216` / `96` / `54` | 卡片宽 / 高 / 间距 / 卡片顶相对黑条顶偏移 |
| `ICON_ZOOM` | `1.1` | **卡片图标统一放大系数**（两层共用，保留可调） |
| `DESC_SIZE_RATIO` | `0.85` | **说明字号相对基准字号的比率**（标题与说明字号拉开层级） |
| `ICON_OFFSET_Y` / `ICON_BOX` | `-24` / `66 * ICON_ZOOM`（→**72.6**） | 第一层图标圆心偏移 / 图标绘制框尺寸 |
| `NAME_OFFSET_Y` / `DESC_OFFSET_Y` | `62` / `90` | 第一层标题 / 说明相对卡中心偏移 |
| `NAME_SIZE` | `'24px'` | 第一层标题字号（**加粗** `bold`） |
| `DESC_SIZE` | `` `${20 * DESC_SIZE_RATIO}px` ``（→**17px**） | 第一层说明字号（**普通字重**，20×0.85） |
| `UP_ICON_OFFSET_Y` / `UP_ICON_BOX` | `-44` / `84 * ICON_ZOOM`（→**92.4**） | 第二层图标圆心偏移 / 图标绘制框尺寸 |
| `UP_ENTRY_OFFSET_Y` | `56` | 第二层词条文本中心（原武器名位置附近，视觉居中于卡片下半） |
| `UP_DESC_SIZE` | `` `${Math.round(18 * DESC_SIZE_RATIO)}px` ``（→**15px**） | 第二层词条字号（普通字重，18×0.85 取整） |
| `UP_DESC_WRAP` | `CARD_W - 56`（→**352**） | 词条自动换行宽度 |
| `WEAPON_ART_RATIO` | `0.72` | 第二层**武器美术直径 / 底盘直径**（工坊口径 0.52 / 0.72） |
| `LAYER_OUT_MS` | `220` | **切层阶段1：旧层向下消失时长**（`el<LAYER_OUT_MS` 只画旧层 `switch.from`） |
| `LAYER_IN_MS` | `260` | **切层阶段2：新层自下方进场时长**（总时长 480ms；`el>=480` `delete offer.switch`） |
| `LAYER_SHIFT` | `282`（= `BAR_H - CARD_TOP_IN_BAR`） | **出/入场位移**：卡片顶正好滑到屏幕底部（**完全出屏、不留残影**）；阶段1 旧层 `+ease*LAYER_SHIFT` 下移、阶段2 新层 `+(1-ease)*LAYER_SHIFT` 上移 |

> 本轮**删除** `UP_NAME_OFFSET_Y` / `UP_DESC_OFFSET_Y`（第二层不再显示武器名，词条用 `UP_ENTRY_OFFSET_Y` 单一定位）。

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
| 999 | UI 层 | 卡片裁剪遮罩源：工坊 `workshopCardMaskG`（`ui-runtime.js:30`）/ 售货机 `vendorCardMaskG`（`screens.js:104`）（GeometryMask 源，alpha 0 不可见） | — |
| **1000** | UI 层 | `this.uiG`（所有 UI 图形：HUD、弹窗底板、蒙层、黑幕） | `ui-runtime.js:26` |
| **1001** | UI 层 | UI 文本与贴图：`uiTexts`/`uiImages` 节点、`settleTexts`、weaponLabels、ammo、hudIndicatorText、weaponIconImage、`vendorShopTexts`、`levelSelectTexts`、`idolOfferTexts`（另有售货机页私有 Graphics `vendorCardContentG` 也在 depth 1001） | `ui-runtime.js:47-158`、`screens.js:21,88,424`、`world-overlay.js:220` |
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
3. 玩家外观改 `entity-art.js:533 drawHexRingPlayer`（中心六边形已移除；第 4 参 `opts` 走环链+出场，链环 `chain:true` + 两趟绘制 + `chainRefScale()`）/ `:650 drawPlayer`（orbit 环绕分支也走 `renderWeaponBody`）+ `systems/constants.js:61 PLAYER_LEAN` / `:64 WEAPON_RING_CHAIN`（含 `refZoom`）；注意 `PLAYER_COLLISION_RADIUS`（`constants.js:58`）由 `weaponRingRadius + weaponRingThickness` 推导，改环半径会改碰撞体积。
4. 墙/木箱/传送门形状分别在 `entity-art.js:451 drawWallShape` / `:41 drawCrate` / `:68 drawPortalShape`。
5. 若改成贴图渲染：贴图键与路径进 `systems/constants.js`，在 `game-scene.js:53-69` 预载，参考 `world-render.js:131 syncBarrelSprites` 写一个 `syncXxxSprites`（含 `uiCam.ignore` 与 `seen` 清理），并在 `draw()` 里调用；同时把原 Graphics 绘制删掉，避免图形与精灵重影。
6. **画板设计稿驱动的敌人**（母舰 / 原型机-2-5T5 / 重装机兵范式）：新建 `ui/<xxx>-art.js`（自成一个模块，但**不要 import `entity-art.js`**，颜色用 `asset-render.js:hexToInt`，避免循环 import）；`entity-art.js:drawEnemyShape` 里加 `if (e.type === 'xxx') { const d = getDesign(e.art || XXX_ART); if (drawXxxBody(g, e, d, target, t, alpha)) return; }`（**用 `|| XXX_ART` 兜底**：关卡条目里 art 常为空串，靠类型默认美术出图；未加载则返回 `false` 回落默认形状）。同时确认 `world-render.js:requestArtDesigns` 能取到该 id（已按 `e.art || ENEMY_TYPES[e.type]?.art` 兜底）。需要「随朝向旋转设计稿」时用母舰/重装机兵同一招：给每个元素加 `phase: (el.phase||0) + facing`。**需要墙体几何的辅助线（如瞄准线）不要在 UI 侧算**：UI 拿不到墙/关卡边界，只能画固定长度（会穿墙、会半空断掉）；正确做法是战斗侧每帧把端点写进实体字段（重装机兵 `e.sightLines`，用 `enemy-ai.js` 的 `aimRay`），UI 只 `lineBetween`（见 combat skill 坑 56）。

### F. 新增一个售货机商品 / 老虎机种类（改表 → 导表 → 放美术，**无需改代码**）

1. **加/改商品**：编辑 `策划文档/server/消耗品.xlsx`（页签 `innerItemInfo`：编号/备注/描述/购买花费/美术方案类型（图标）/美术方案名称（图标）/是否即时生效/是否进老虎机/局内栏位）或 `武器.xlsx`（页签 `weapon`，行需「是否加入局内临时=1」才进售货机，读「临时价格」「临时时长」）。
2. **加/改老虎机种类**：编辑 `策划文档/server/老虎机.xlsx`（页签 `main`，`描述` 列经 `LOTTERY_KEY_MAP` 映射为 key：武器/护盾/金币/垃圾；`直接出货权重` 为数值才算数据行）。
3. 运行 `node tools/export-tables.mjs`（可 `TABLES_DIR=<dir>` 指定表格目录）→ 重写 `data/inner-shop.json`。
4. 把图标资产放进对应美术库（`动态资产`→`data/assets`、`轮廓`→`data/outlines`、`像素`→`data/pixels`），名称与表里「美术方案名称（图标）」**完全一致**（`vendor-shop-art.js:matchId` 精确匹配）。武器卡不用放图标：复用局外商城做法（`WEAPON_BG_ASSET` 背景 + `getWeaponDef(id).appearance`）。
5. **新增美术资源后**：确认「美术方案类型（图标）」+「美术方案名称（图标）」在目标库中能**精确匹配**（type 选错库、名字差一字符都会让 `matchId` 落空 → 图标位空）；纯白款（所有可见颜色每通道 ≥ 0.85）在白卡上会被 `shopIconVariant` **自动改用黑色款**，无需额外处理。
6. 商品数固定 4（`SHOP_ITEM_COUNT`），从池里**不重复**随机 4 个；老虎机每实体独立、不限次数。**以上全部无需改代码**。

> 流水线文件（详见 economy-numbers skill）：导表 `tools/export-tables.mjs`（265 行，导出 `parseConsumables`/`parseWeapons`/`parseLottery`/`loadWeaponNameIndex`/`buildInnerShop`）、生成物 `data/inner-shop.json`（109 行，`consumables[4]` / `weapons[3]`（带 `weaponId`）/ `lottery{drawCost:15,goldPrize:15,kinds[4]}`）、纯逻辑 `src/systems/economy/inner-shop.js`（153 行）。`server.js` 的 `GET /api/inner-shop` **动态** `import('./tools/export-tables.mjs')` 现解析，失败回退 `data/inner-shop.json`（打包态无 `策划文档` 目录时只读 JSON，见第 7 章坑 23）。

### G. 新增一页全屏弹窗页
沿用 A 节 / 既有 **B 节** 套路（`drawXxx` + `menuScreen` 分支 + `drawUI` 隐藏清单 + 入口 + `buttons.push` + `onUIPointer` 分支）；蒙层淡入淡出经 `openMenuScreen` 自动内置，无需另写。

### H. 新增一个局内消耗品 HUD 元素（例：药水槽旁再加一个「时效小角标」）

1. 纯几何写进 `src/systems/ui/battle-items-art.js`（无 `this`，几何常量放文件顶部、按 `×6` 换算），照 `drawPotionQueueDots`/`drawBattleStatusIcons` 写法。
2. 挂到调用点：UI 层元素放 `battle-items.js:drawBattleItems(g)`（画到 `uiG`）；**世界层**元素放 `drawBattleStatusIcons(g, player)`（`world-render.js` 在 `drawShieldArc` 后调用，随相机缩放）。
3. 数据一律从 `RunItemsMixin`（`getRunPotions`/`getFrontPotion`/`getTempWeapon`/`getRunEffects`）**只读**，不要在 UI 层改写 `runItems`/`runEffects`（数据层职责，见 economy-numbers）。
4. 若引入独立 Phaser `Text`（如轮盘药水名 `potionWheelTexts`），其显隐必须纳入「屏蔽分支 / `hideHudOverlay`（经 `hidePotionWheelTexts()`）/ `level-flow.js:restart`」三处，否则离态残留；**alpha 需要跟随自身动画的文本不要放进 `setHudAlpha`**（它跑在 `drawHud` 之后，会把动画 alpha 冲成 `hudAlpha`，见第 7 章坑 28/42）。改用 `drawXxx` 每帧自带 alpha。
5. 配色统一「黑底 + 纯白图标」用 `whiteVariant`（**不要 `invertDesign`**）；背景盘（`WEAPON_BG_ASSET`）若要用则保持原色、单独画（**局内武器槽两态（含使用中）都画它，见坑 38**）。想让设计稿元素动起来，绘制调用传 `t`（秒）作第 6 参驱动 `rotSpeed`（传 0 = 静止，见坑 37/38/39）。

### I. 新增两层弹窗页（照火堆范式）

例：再来一个「两层选择的弹窗」——第一层选入口、第二层选具体项。**范式 = 新建 art 模块（模块导出函数）+ ui-runtime 四处接线 + 空白点击语义 + 文本池隐藏 + activeGraph 排除**。

1. **新建绘制模块** `src/systems/ui/xxx-art.js`：导出**模块导出函数** `drawXxxOffer(scene)`（**不要写成 `this.xxx` 的 mixin 方法**，构建抓不到未定义调用，见坑 49）。内部：`scene.xxxOfferTexts = scene.xxxOfferTexts || new Map()` + 局部 `ensureText(id,size,color)` 工厂（`add.text` + `depth 1001` + `cameras.main.ignore`）；按 `offer.layer` 分层画（`layer 1` 白卡横排 / `layer 2` 多按钮）；飞入/滑出用 `SLIDE_MS` + `1-(1-q)^3`，`closing && q>=1` 调 `scene.closeXxxOffer()`；按钮 `scene.buttons.push({ id, x, y, w, h })`；图标按来源选「三库解析」或「design-store 单库」（见第 3 章两套途径）。
2. **ui-runtime 四处接线**（缺一处就白改，见坑 50）：
   - **① 隐藏段**：`drawUI` 头部批量隐藏区加 `if (!this.xxxOffer && this.xxxOfferTexts) { for (const t of this.xxxOfferTexts.values()) t.setVisible(false); }`。
   - **② activeGraph 排除**：`:306` 的 `activeGraph = this.idolOffer || this.campfireOffer || this.xxxOffer || this.settingsMode || this.menuScreen ? null : ...` 补上 `this.xxxOffer`。
   - **③ drawUI 分支**：在 `if (this.idolOffer)` / `if (this.campfireOffer)` 之后加 `if (this.xxxOffer) { this.hideHudOverlay(); drawXxxOffer(this); return; }`（顶部补 `import { drawXxxOffer } from './xxx-art.js';`）。
   - **④ onUIPointer**：首行 `closing` 守卫加 `this.xxxOffer?.closing`；按钮分发加 `xxxCard_i` / `xxxPick_i` 分支（`pressAnim(b.id)` + 业务回调）；末尾空白点击按层回退/关闭。
3. **空白点击语义**：多层弹窗必须定义「点空白」行为——回退上一层（保留中间态）还是整体关闭（`closing=true`）。火堆范式：`layer>1` 回上一层、`layer===1` 关闭（且**不消耗**触发物，可再交互）。业务回写（消耗/发奖）放 `interactables.js`，UI 只负责置 `closing` 或调 `scene.xxxBackToPrev()`。
4. **状态挂 scene 不挂 `state.player`**（`state.player` 就是存档源，见坑 22）；`openXxxOffer` 里 `state: playing→paused` 并 `syncUIState()`，`closeXxxOffer` 恢复。
5. **文本池**：非 `menuScreen` 驱动的弹窗走 `xxxOfferTexts` Map + `ensureText` + `!this.xxxOffer` 隐藏，别用会在 `uiG.clear()` 后残留的裸 `this.add.text`（见坑 2/28）。
6. **切层动画两段式**（照火堆范式）：切层前先在业务侧（`interactables.js`）写 `offer.switch = { from: offer.layer, startT: this.time.now }`**再**改 `offer.layer`；绘制端每帧 `el = now - switch.startT`、ease `1-(1-q)^3`，**严格串行、同一帧只画一层**：阶段1 `el<LAYER_OUT_MS(220)` 只画旧层 `switch.from`（`yShift=ease*LAYER_SHIFT` 向下移出）、阶段2 `el<LAYER_OUT_MS+LAYER_IN_MS(480)` 只画当前层 `offer.layer`（`yShift=(1-ease)*LAYER_SHIFT` 自下方滑入）、`el>=480` `delete offer.switch`；**不改 `hoverT`**，`scene.buttons.push` **只随被绘制层**执行。位移 `LAYER_SHIFT` 取 `BAR_H - CARD_TOP_IN_BAR`（火堆 = 282）→ 卡片顶正好滑到屏幕底、**完全出屏不留残影**（**勿退回「同帧交错画两层」**，会残留，见第 7 章坑 53）。`onUIPointer` 首行守卫补 `|| this.xxxOffer?.switch`，动画期间不响应点击（结束自动恢复）。
7. **文本可见性集合**（照火堆范式，防切层残留）：`drawXxxOffer` 内每帧建 `const visibleIds = new Set()`，`ensureText` 里 `visibleIds.add(id)`，**帧末**遍历 `scene.xxxOfferTexts`，不在集合里的 `setVisible(false)`。只靠 `drawUI` 头部「无 offer 才批量隐藏」不够——切层时 offer 仍在、旧层文本不会被隐（见坑 51）。

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
20. **摇奖结算不能只挂在渲染里**（真实踩过）。现象：抽奖页关闭后 `vendor.slot.rolling` 永久卡住——抽奖价已扣、奖励未发、后再也无法抽。根因：`drawVendorShop` 内的定格结算属**页面私有**时机，页面关闭后不再被 `drawUI` 调用。正确做法：`game-scene.js:819` 每帧 `updateVendorSlot()` 独立推进；且 `rollVendorSlot()` 对「已过 `settleAt` 的 rolling」先自愈结算；`settleVendorRoll()` **幂等**（`rolling` 已 false 直接 return）。三条路径任一先到都安全。
21. **vendor 页私有 Graphics 不会被 `ui-runtime.drawUI` 清理**。现象：关页后老虎机窗口滚动图标残留。根因：`vendorCardContentG` 属售货机页私有，`drawUI` 头部隐藏清单不含它（`drawUI` 只清 `shopCardContentG`/`workshopCardContentG`）。正确做法：懒建时挂一次性 `this.events.on('preupdate', () => { if (this.menuScreen !== 'vendor' && this.vendorCardContentG) this.vendorCardContentG.clear(); })` 兜底（`screens.js:111`）。新增「页面私有持久 Graphics」都照此兜底。
22. **局内字段必须挂 scene，不能挂 `state.player`**。`state.player` 就是存档源（`progression.js:47 persistSave` → `ctx.onPlayerSave`），直接加字段会被写进存档文件。故 `runItems`/`runTimedWeapons`/`vendorActive` 挂 scene，随 `level-flow.restart`（`level-flow.js:147-149`）清零（`vendorBought` 旧字段已删）。
23. **打包态没有 `策划文档` 目录且 `exceljs` 是 devDependency**。`server.js` 必须用**动态** `import('./tools/export-tables.mjs')`（`server.js:179`）并回退 `data/inner-shop.json`，否则打包后启动崩。另：`~$武器.xlsx` 是 Excel 临时锁文件，导表按文件名精确读取（不扫目录）故天然忽略，若改为目录扫描须显式跳过 `~$` 前缀。
24. **表格武器「编号」≠ 项目武器 id，UI 侧一律读 `item.weaponId || item.id`**。武器表「编号」是 `101/102/103`，项目武器 id 是 `yellow`/`green`/`weapon-1788012926999`；直接 `getWeaponDef('101')` 必为 `undefined`，商品卡只剩背景盘、没有武器本体。**正确路径**：导表 `loadWeaponNameIndex()` 读 `data/weapons/*.json` 按 `name` 建「名 → id」，`buildInnerShop` 给每条 `weapons[]` 补 `weaponId`（命中按名字、未命中 `""`）；运行期 `inner-shop.js` 的 `resolveWeaponId`（显式 `weaponId` 优先，否则 `weaponCatalog()` + `getWeaponDef(id).name === name` 反查）只是**兜底**；UI 取外观统一 `getWeaponDef(item.weaponId || item.id)?.appearance`，`addRunTimedWeapon` 入列 `id = String(item.weaponId || item.id)`。
25. **三库资源的坐标原点不保证是视觉中心**。`drawDesignCentered` 的**位置锚点是 design 原点**（`renderAsset` 里 `cx0 = x + design.center.x * scale`），而缩放按**包围盒**——原点不在包围盒中心时图标会偏出框外。**正确做法**：`vendor-shop-art.js:recenter(d)` 把 `d.center` 设为**负的包围盒中心**（`-(minX+maxX)/2, -(minY+maxY)/2`，用 `designBounds(d,0)`），三种 artType（动态资产/轮廓/像素）统一走它。遗留：归位是 t=0 静态定值，`rotSpeed≠0` 的元素运行期包围盒中心会随 t 轻微漂移（缩放仍按实时包围盒，不会超框）。
26. **纯白美术在白卡上不可见 → 用 `shopIconVariant`**。有的图标（如「速度加成图标」）`color`/`fill` 都是 `#ffffff`，在白商品卡上完全看不见。**正确做法**：白卡（未购买）统一经 `screens.js` 内局部 `shopIcon(d, false)` = `shopIconVariant(d, false)` → `isNearWhite(d) ? blackVariant(d) : d`（缓存 `vv.variantCache`）。**已购黑卡已不走向量反色**：改用 `vv.whiteCache` 缓存 `whiteVariant`（`wh(d)`）把图标统一成纯白（`shopIconVariant` 的黑卡 `invertDesign` 分支保留导出但不再被卡片调用）。**语义注意**：这不是「所有图标按背景自动反色」，只有纯白款改黑款。详见坑 37。

27. **`this.drawItemShields(...)` 有调用无定义（会运行期崩，`vite build` 抓不到）**。现象：进战即 `this.drawItemShields is not a function` 抛异常、整帧卡死。根因：`drawItemShields` 是 `entity-art.js` 的**独立导出函数**、不是 mixin 方法（照 `drawShieldArc` 风格）。正确做法：`world-render.js` 顶部 `import { drawItemShields } from './entity-art.js'` 后**直接调用** `drawItemShields(g, this.player)`。本项目已因这类「有调用无定义」崩过多次，构建不报。
28. **`potionWheelTexts`（数组，最多 4 个）是独立 Phaser `Text`，`uiG.clear()` 清不掉**。现象：离开战斗态 / 重开关卡后轮盘药水名残留在屏幕上。根因：它们不属 `uiG` 图形。正确做法：用 mixin 方法 `hidePotionWheelTexts()`（遍历全部 `setVisible(false)`），在**三处**调用 —— ① `battle-items.js:updateBattleItemsInput` 的屏蔽分支；② `hud.js:hideHudOverlay()`（`this.hidePotionWheelTexts?.()`）；③ `level-flow.js:restart`（`this.hidePotionWheelTexts?.()`）。**不要**把它们放进 `setHudAlpha`（见坑 42）。旧版那个「单个文本字段 + 手动 `setVisible`」的写法已废弃（现改成数组 + `hidePotionWheelTexts()`）。
29. **`drawDesignCentered(g, design, cx, cy, boxSize, t)` 没有 alpha 参数**（alpha 只在 `renderAsset(g,design,x,y,t,scale,motion,alpha)`）。现象：轮盘 300ms 淡化期间，蒙层/圆底/分隔线随 alpha 淡化，但**矢量图标本身不淡化**（略提前「实显」）；药水掉落物同理不随房间渐显淡化。根因：`drawDesignCentered` 未透传 alpha。需要严格同步时改调 `renderAsset`。
30. **临时武器使用中会改 `player.weaponType` 但不改 `player.weapons`/`weaponIndex`**。现象：右下角武器轮盘 `hud-art.js:drawWeaponWheel` 按 `weaponType` 定位扇区，高亮可能偏差（**已知观感问题，不崩**）。已由 `editor-camera.js:onWheel` 里切武器前加守卫 `if (this.isTempWeaponActive?.()) return;` 拦住滚轮切武器。
31. **药水满 4 瓶后从售货机购买仍扣金币但拿不到**。根因：`addRunItem` 对满队列走用户确认的「丢弃新获得的」规则，扣费在购买侧、入队被拒。属既定行为，非 bug。
32. **`whiteVariant`/`blackVariant` 每帧 `structuredClone` 变体**。现象：HUD 侧（药水槽/轮盘/状态图标；**武器槽已改用原色、不再走变体**）每帧各图标克隆一次，成本可接受、**未做缓存**；售货机商品卡的 `whiteVariant` 已按 design 缓存在 `vv.whiteCache`（`wh()`）。若要进一步优化可在 data 层缓存（`vendor-shop-art.js` 的 `designCache` 同思路）。
33. **已修**：`entity-art.js:170` 的 `INTRO_RING_COUNT = 12` 已在 `INTRO_RING_*` 常量组正式定义（与 `state.js` 归一化默认值一致），未定义引用已消除。`??` 左侧 `fx.introRingCount` 被 `state.js` 归一化为恒有限数字，故右侧兜底平时不生效。
34. **改槽位 y 必须连带重算队列小点间距**。槽底对齐 `VIEW_H-16`(1064) 后，小点若仍留 12px 间距会落到屏幕最底边（1076+4=1080）被裁掉 → `POTION_DOT_GAP` 收到 8（点范围 1068~1076）。时间条在槽顶上方 `TEMP_TIME_BAR_GAP+TEMP_TIME_BAR_H`、**按中心点算**，槽位移动会自动跟随；但小点间距是独立常量，必须手动改。
35. **槽位/轮盘坐标一律「×6 换算 + 中心点语义」**：设计稿背景框 `836,588,320×180` 对应 1920×1080；槽底对齐基准线 = `VIEW_H-16 = 1064`（`POTION_SLOT_POS/TEMP_SLOT_POS` 中心 y = 1019 = 1064−45）。加/挪槽位时先算槽底再回推中心点。
36. **径向渐变不能用少量分段**：3 段同心扇环会有肉眼可见的分层跳变；必须用足够多的层（当前 `WHEEL_HOVER_RINGS`=24）+ 环中点半径做线性插值。且「出现」要有**独立渐显系数**（`hoverFade`），不能只跟随轮盘整体 alpha——轮盘 alpha 在 `'in'` 相位 300ms 就已完成，蒙层若只跟它会在进入扇区时瞬亮。
37. **`invertDesign` ≠ `whiteVariant`**：前者逐通道取反（彩色 → 补色，如黄 → 蓝紫），后者把所有非空颜色直接置 `#ffffff`。要「黑底上图标统一白色」**必须用 `whiteVariant`**；改配色前先想清楚要的是「反色」还是「统一白」。
38. **武器槽两态（含使用中）都渲染圆形黑底盘（`WEAPON_BG_ASSET`）** —— 此前「槽内不绘制底盘」的旧结论**已作废**。`drawTempWeaponSlot` 重新叠加：`const bg = getDesign(WEAPON_BG_ASSET); if (bg) drawDesignCentered(g, bg, x, y, size * 0.82, t);`，**两态（含使用中）都渲染**（用户原话：「临时武器槽位的圆形黑色底盘背景即使在已使用状态，也需要渲染」）；`WEAPON_BG_ASSET`（`systems/constants.js`）与 `getDesign`（`systems/art/design-store.js`）的 import **已恢复**，该文件依赖回到 4 个。事实保留：
   - **`WEAPON_BG_ASSET` 的 `bgColor: "#ffffff"` 是纯装饰性字段、运行期完全不渲染** —— 全仓 `bgColor` 只被三处画板编辑器当画布底色（`editor/artboard.js` / `editor/draw-board.js` / `editor/pixel-board.js`）与 `ui-library.js` 卡片底色用；`art/asset-render.js:110` 只在 `normalizeDesign` 里把它存下来，`renderAsset`/`drawDesignCentered` **不读它**。所以**别指望改 `bgColor` 能把盘改白**；想改盘的颜色只能改它 3 个元素的 `color`/`fill`（或对它用 `whiteVariant`/`invertDesign`）。它的 3 个元素颜色全是 `#000000`（一个 `closed:true` + `fill:'#000000'` 的实心 24 边形（半径 100，即**黑盘**）+ 两条 `radius:125 / lineWidth:12 / rotSpeed:0.5` 的**黑色弧**）→ **实际盘 = 黑盘 + 两条旋转黑弧**：画在**黑底槽位上完全不可见**、画在**白底槽位上显为黑盘**。
   - **正是这个「黑底上不可见 / 白底上可见」的特性，让「使用中 = 白底 + 黑底盘」形成视觉对比**，两态都画、无需分态。
   - **通用规则仍成立**：槽位底色在黑/白之间切换时图标颜色要跟着选（黑底 → `whiteVariant`，白底 → `blackVariant`）；**武器槽是特例 —— 两态都用原色**（用户明确要求，不再用 `whiteVariant`）。
39. **设计稿美术的「动态」靠 `t` 参数**：`drawDesignCentered(g, design, cx, cy, boxSize, t = 0)` 的第 6 参驱动元素 `rotSpeed`；HUD 侧最初传 0 导致武器图标静止，**传 0 就是静止**。售货机页一直传 `tSec`，可作对照。（`battle-items.js:drawBattleItems` 里 `t` 已被 `getTempWeapon()` 返回值占用，时间用 `tSec`；药水槽/轮盘/状态图标仍传 0=静态，未要求改。）
40. **`PAGE_FADE_MS` 是全屏菜单页共用常量**（`ui-runtime.js`），改它同时影响售货机、武器商店、工坊、选关、存档选择等**所有**页面；只想改售货机的入场展开动画要动 `screens.js:drawVendorShop` 的 `flipAt(delay)`（`/200` + delay `0/30/180/60+i*30`）。
41. **轮盘 `drawPotionWheel` 的 `hoverFade` 默认值 1**：纯绘制函数不持有时间，渐显系数必须由 `battle-items.js` 按 `hoverT0` 算好传进来（保持 `battle-items-art.js`「无 this、无时间」的纯函数约定）。
42. **`setHudAlpha` 在 `drawHud()` 之后执行**（`ui-runtime.js:394` 调 `drawHud`，`:399` 才调 `setHudAlpha`）→ **任何「alpha 需要跟随自身动画」的独立文本/对象都不能放进 `setHudAlpha`**，否则动画 alpha 会被冲成 `hudAlpha`（表现为轮盘渐隐期间文字亮度不变、和圆盘脱节）。药水轮盘名称文本正是因此从 `setHudAlpha` 里**移除**（`hud.js:361` 留注释），改由 `drawBattleItems` 每帧 `setAlpha(alpha)` 设置。安全前提：轮盘只可能在 `state === 'playing'`（即 `hudAlpha ≡ 1`）时可见，所以不需要参与 HUD 入场淡入。
43. **轮盘图标位置只有一份实现**：`wheelIconPos(i, scale)`（`battle-items-art.js`，在 `wheelHoverIndex` 之后）。`drawPotionWheel` 的 4 个图标坐标与 `wheelNamePos` 都调用它，**不要再在别处内联 `-90 + i*90` 的角度公式**，否则改半径/起始角会漏改（名称文本会与图标错位）。
44. **老虎机窗口图标尺寸**：窗口白卡是 `120×120`，图标尺寸必须小于它（当前 `screens.js:drawVendorShop` 局部常量 `REEL_ICON_SIZE = 88`，四周各留 16px）；原来直接写 `120` 会顶格（零内边距）。改窗口白卡尺寸时要连带改这个常量，未就绪白圆占位半径用 `REEL_ICON_SIZE * 0.34`。
45. **Phaser Text 不要每帧改字号**：`setFontSize` 会重排整张文字纹理。轮盘缩放动画期间只按 `scale` 挪位置、字号固定 `WHEEL_NAME_FONT`（24px），**不要**让字号随 `scale` 变。
46. **死亡运镜期间必须 gate 输入 + 隐藏 HUD，且 `menuScreen` 分支优先于结算分支（`playerDeathFlow`）**。`stopCutscene` 会**先置 `cinematicActive=false` 再回调 `onComplete`**，`phase:'hold'`（黑幕保持 `blackHoldMs`、`state` 仍 `playing`）期间 `cinematicInputLocked()` 与 `deathSim` 均为 false → **若不把 `playerDeathFlow` 单独纳入输入锁，玩家在黑幕里按 F/4/5/ESC 会打开菜单页、把结算页顶掉**（`drawUI` 的 `menuScreen` 分支优先于 `end/fail` 结算分支）。正确做法（`game-scene.js:171`）：`inputLocked = deathSim || !!this.playerDeathFlow || (this.cinematicInputLocked?.() ?? false)`，并 gate 掉开火/护盾/各 `updateXxxInteract`/`checkAsyncTriggerEvents`；`drawUI` 侧 `ui-runtime.js:374` 加 `else if (this.playerDeathFlow) hideHudOverlay();`（**放在结算分支之前**），`activeGraph` 计算也排除它。详见 level-design §4⑨ 与 engine-editor 坑 49-50。

47. **玩家武器环链三坑（z 序 / 样板 / 厚度判据）**（本轮）：① **z 序** —— `drawHexRingPlayer` 与 `weapon-body.js:renderWeaponBody` 都改成「原有元素先、链环后」两趟绘制，否则链环（外径最小）被不透明的同形状父元素（散射中心黑三角 / 激光实心 20 边形）整块盖住；出场计时仍按外径升序的 `index`（`drawHexRingPlayer` 里为 `item.revealIndex`），只改 z 序。② **样板** —— `innermostElement` 优先取「描边型（`fill` 为空）」元素（`asset-render.js:normalizeElement` 把 `lineWidth:0` 强改成 4，会让「最内侧元素」落到黑色实心三角/实心 20 边形）。③ **链环标记** —— `drawHexRingPlayer` 的链环必须用**显式 `chain:true`**，不能用半径判断（武器球半径比内环还小）。④ **厚度判据**用固定 `chainRefScale()`（= `WEAPON_RING_CHAIN.refZoom`）而非当帧 zoom，否则放大途中环逐个冒出来。详见 engine-editor §7 坑 53-56。

48. **火堆白卡上的纯白图标必须走 `shopIconVariant(design, false)`，否则不可见**。第一层两张白卡是 `0xffffff` 实心矩形，若直接把 `getArtRef(...)` 拿到的 design 交给 `drawShopIcon`，纯白款（如某些像素图标全 `#ffffff`）画在白卡上完全看不见。**正确做法**：照售货机白卡口径 `drawShopIcon(g, shopIconVariant(design, false), cx, cy, box)` —— `isNearWhite(design)` 时换 `blackVariant`（**不是 `invertDesign` 反色**，见坑 26/37）；未加载时画黑圆占位并 `resolveArtRef` 触发拉取。任何「白底/白卡上放图标」的场景都要先 `shopIconVariant(d, false)`。
49. **`drawCampfireOffer` 是模块导出函数，不能写成 `this.drawCampfireOffer(...)`**（同类「有调用无定义」已多次踩过）。`campfire-art.js` 的 `drawCampfireOffer(scene)` **不在任何 mixin 上**，只能 `import { drawCampfireOffer } from './campfire-art.js'` 后**直接调用**（`ui-runtime.js:13,330`）；写成 `this.drawCampfireOffer(...)` 运行期 `is not a function` 抛异常、整帧卡死，`vite build` 不报。规则：先确认目标是「mixin 方法」还是「模块导出函数」（同坑 27 的 `drawItemShields`）。
50. **「新增一页全屏弹窗」必须同时改 4 处，漏一处必残留/失效**。以火堆为例：① `drawUI` 头部隐藏段（`!this.campfireOffer` 时批量隐 `campfireOfferTexts`，`:282-284`）；② `activeGraph` 排除（`:306` 把它归为「无 graph」，否则 hover 命中会打到旧页面节点）；③ `drawUI` 分支（`:328` 的 `if (this.campfireOffer) { hideHudOverlay(); drawCampfireOffer(this); return; }`）；④ `onUIPointer`（`:597` 的 `closing`/`switch` 守卫 + `:622` 按钮分发 + `:650-653` 空白点击）。只加 ③ 会：切页后文本残留、hover 错位、点击无响应。
51. **同层多面板切换：`drawUI` 头部「无 offer 才隐藏」不足以清掉旧层文本 → 必须帧内 `visibleIds` 统一隐藏**（本轮修复的既有 bug）。现象：火堆从第一层切到第二层后，第一层文本（`campfireCard_0/1_name/_desc`）仍显示在屏幕上（`campfireOffer` 还在，`!this.campfireOffer` 隐藏条件不成立，旧层文本没人改 `setVisible`）。根因：`campfireOfferTexts` 是常驻 Map，`ensureText` 只在被调用的帧 `setVisible(true)`，切层后旧 id 不再被绘制却仍保持上一帧的可见态。正确做法：`drawCampfireOffer` 每帧建 `const visibleIds = new Set()`，`ensureText` 内 `visibleIds.add(id)`，**帧末**遍历 `campfireOfferTexts` 把不在集合的 `setVisible(false)`（`campfire-art.js:59/72/215-217`）。**切层动画（两段式）期间同一帧只画一层**，`visibleIds` 每帧自然只含该层 id → 另一层文本被自动 `setVisible(false)`（阶段1 隐新层、阶段2 起隐旧层）；不再有「两层同时可见」的情形（那是旧的同帧实现才有，见坑 53）。任何「同一弹窗内按层/页切换的文本池」照此办理。
52. **Phaser `Text.setStyle()` 返回 `TextStyle`，不能链式接 `Text` 方法**。`ensureText` 里为切换标题/说明粗细写了 `t.setStyle({ fontStyle: bold ? 'bold' : 'normal' })`——它**返回内部 `TextStyle` 实例**（不是 `Text`），若写成 `t.setStyle({...}).setPosition(...)` 会在运行期对 `TextStyle` 调 `setPosition` 抛 `is not a function`（`vite build` 不报）。**正确做法**：`setStyle(...)` 单独一行不接链，或改用返回 `this` 的 `setFontSize/setColor/setText` 等（`campfire-art.js:69-70`：`setFontSize().setColor()` 可链，`setStyle()` 必须断开）。同类「返回自身 vs 返回内部对象」的 Phaser API 都要先确认返回值再链式调用。

53. **切层动画必须「严格串行、同一帧只画一层」，否则有视觉残留**（本轮修复）。旧实现（同帧同时画旧层上滑出 + 新层下滑入、两层交错）在卡片重叠区出现双影/半透残留——两层都在动、`visibleIds` 也同时含两层文本，观感脏。**正确做法**：拆成两段串行状态机（`campfire-art.js:204-225`）：阶段1 `el < LAYER_OUT_MS`(220) **只画旧层** `switch.from`（`yShift = ease*LAYER_SHIFT` 向下移出），阶段2 `LAYER_OUT_MS <= el < 480` **只画当前层** `layer`（`yShift = (1-ease)*LAYER_SHIFT` 从下方滑入），`el>=480` `delete offer.switch`。位移 `LAYER_SHIFT = BAR_H - CARD_TOP_IN_BAR = 282` 让卡片顶正好滑到屏幕底（旧值 48 配「上滑出」是同帧双向时代的约束；改单向向下后必须用满黑条高度才完全出屏）。**别退回同帧交错画两层**。

54. **`drawHexRingPlayer` 的 `opts.hideWeaponRing` 缺省必须 `false`，只在火堆兜底传 `true`**。`drawHexRingPlayer` 被 `drawPlayer`（局内玩家本体）/ `hud-art.js`（HUD 头像）/ 工坊卡片共用；`hideWeaponRing` 是为**火堆第二层卡片兜底美术**新增的开关（去掉最外圈发射环 `PLAYER_ART.weaponRingRadius` 与其上武器球 `kind:'orb'`，只留 `inner/outer/outer2/body` 4 个同心环），默认 `false` → 既有调用方（不传 `opts` 或只传 `{screenScale}`）观感**零变化**，不能因它改动局内/HUD。火堆兜底调用见 `campfire-art.js:180-184`（`ringScale = UP_ICON_BOX*WEAPON_ART_RATIO*s/(2*PLAYER_ART.bodyRingRadius)` ≈0.95*s，构造假 player `{weapon:{ringColor}, weaponAngle:0, artScale:1, moveLeanX/Y:0, scheme:'hex-ring'}`）。UI 路径判定是 `!Number.isFinite(Number(opts.screenScale))`，只传 `{hideWeaponRing:true}`（无 `screenScale`）仍走 UI 路径、alpha 全 1、无环链——正合卡片静态缩略图诉求。

55. **火堆第二层「环组兜底」在缩略图尺度下观感偏密（已知限制，不修）**。底盘 `UP_ICON_BOX` ≈ 92.4px（×s）时，`ringScale ≈ 0.95×s` 下 4 个同心环半径约 **11.4 / 15.2 / 19.0 / 33.3px**（`inner/outer/outer2/body`），内两环间距仅 ≈3.8px、线宽仅 0.75~2px，缩略图尺度看起来偏密；且白色 `bodyRing` 画在白卡上本不可见——**靠先画的黑色底盘 `WEAPON_BG_ASSET` 承托**（底盘仍在环组之下，`campfire-art.js:163-165`）。想让缩略图更清晰只能调 `UP_ICON_BOX` / `WEAPON_ART_RATIO`，或为这些武器补设计稿/`appearance` 走前面两级路径——属美术取舍，非 bug。

> **其余 5 条坑见其他分类 skill**：老虎机 Excel 表头行「描述」列值为 `Desc`（须用「直接出货权重是否为数值」跳表头）、消耗品「描述」列可能为空（回退「逻辑语言描述（程序不读该字段）」列）、`state.player` 三套来源（player/trialPlayer/previewPlayer）→ **economy-numbers skill**；vendor 实体是每次 `restart` 生成的副本、勿把状态写回 `ctx.state.level.vendors` → **level-design skill**；编辑器属性面板 vendors 分支字段 → **engine-editor skill**。

56. **关卡条目的 `art` 常为空串 → 编辑器里「画板驱动的敌人」会画成默认形状，靠两处兜底修**。现象：`data/levels/*.json` 里母舰/原型机-2-5T5 的 `"art": ""`（默认美术写在 `ENEMY_TYPES[type].art`，运行时由 `initEnemy` 的 `def.art ?? e.art` 补上）。所以在**编辑器**（直接用归一化后的关卡实体绘制）里 `e.art` 为空 → `getDesign('')` 为空 → 落到默认形状（母舰画成了大菱形）。**正确做法**（重装机兵已按此实现，母舰/BOSS 若也要修同样改两处）：① 分支取稿用 `getDesign(e.art || XXX_ART)`（`boss25t5-art.js` / `heavy-mech-art.js` 都这么写）；② 预载用 `const id = e?.art || ENEMY_TYPES[e?.type]?.art;`（`world-render.js:requestArtDesigns`，已改为按类型默认美术兜底）。只做 ① 而漏 ② → 运行时/编辑器都可能取不到设计稿（`getDesign` 未加载 → 返回 `null` → 回落默认形状）。

## 8. 验证方式

```bash
npx vite build       # 构建，验证 ESM 导入/语法（无 lint，构建通过即基本安全）；基线 97 modules
node server.js       # 起本地服务（package.json 的 dev 脚本），浏览器打开进编辑器/试玩
node --test test/    # 基线 20 tests / 19 pass / 1 fail（唯一 fail 为 test/player-api.test.js 旧 schema mods 字段被 normalize 丢弃，属既有不一致）
```
**本次基线**：构建 **97 modules**（+2 = `ui/heavy-mech-art.js` 与 `combat/heavy-mech.js`）；`node --test test/` 仍 **20 tests / 19 pass / 1 fail**；mixin 同名自检 **方法数 300 / 真实冲突 0**（本次 +4 全在 `EnemyAiMixin`：`stepHeavyMech`/`heavyMechUpdateSight`/`heavyMechFireLaser`/`updateEnemyLasers`，**未新增 mixin**，装配仍 **25 个**；UI 侧新增的是模块导出函数而非 mixin 方法）。其它变动：`world-render.js` 加 `drawHeavyMechBeams` 调用 + `requestArtDesigns` 的敌人默认美术兜底（见坑 56）；`entity-art.js:drawEnemyShape` 加 `heavy-mech` 分支；`drawHeavyMechSight` 只消费战斗侧算好的 `e.sightLines`（无限长瞄准线，UI 不做几何）。

改动后按面貌选关卡自测（`data/levels/` 下 16 个关卡）：

| 关卡 | 看什么 |
| --- | --- |
| `login.json` | 登录页：Logo/标题/版本号（`data/ui/login.json`）、5 个登录按钮 hover 白色平行四边形扫过、存档选择页 |
| `knight-home.json` | Hub：**无战斗 HUD**（`isHubLevel()` 分支只隐 HUD）、图标交互 tips + F 键帽、武器商店 / 工坊 / 关卡选择三个入口页 |
| `Level1-Scene1.json` | 战斗 HUD：顶部状态条（进战变红 COMBAT、清场变绿 SECURE 后 1.5s 回白 EXPLORE、静置每 3s 闪黑脉冲）、血盾条、武器轮盘换枪动画、弹药、充能条、右上设置按钮 → 设置蒙层 → 退出二次确认 |
| `newbee.json` | 新手引导提示与操作限制（属 gameplay，UI 侧只验提示不残留） |
| 任意含宝箱/传送门/神像/售货机的关卡 | 世界层：宝箱十字星、传送门「撤离」tips、神像三选一祝福卡入场动画、售货机局内商店 |

自测重点（对应第 7 章坑）：切页面来回切 3 次以上看有无**文本残留**；缩放浏览器窗口（触发 contain 黑边）看点击是否还准；暂停态点按钮看是否立即响应；观察是否有对象出现两份（ignore 漏配）。

**售货机页冒烟清单**（对应第 7 章坑 20-26）：

1. 关内放一台售货机 → 走近按 **F** → 打开弹窗页（黑幕 alpha 0.85），确认右 2×2 四张商品卡 + 左上金币数正确。
2. 点某商品卡购买按钮 → 卡片**翻面**成黑底白边「已购买」+ 图标**纯白**（`whiteVariant`，背景盘保持原色）、金币扣除、该卡不再响应点击；**再点无效**（限购 1 次）。同一售货机关页再打开，**商品与已购态不变**；换另一台售货机打开，商品互相独立。
3. 点抽奖按钮 → 金币扣 `drawCost` → 3 窗口滚动 **2.5s** → 依次定格（错开 140ms）→ 三窗同款才出中奖卡（滑入 300ms、展示 1800ms）；对照权重 武器 5% / 护盾 10% / 金币 15% / 垃圾 15%。
4. 金币不足时点抽奖 / 购买应无反应（不扣钱）。
5. **抽奖过程中按 ESC 关页 → 等 2.5s → 重新打开**：摇奖应已结算（金币奖已到账 / 奖励已入 `runItems`/`runTimedWeapons`），且能再次抽（验证坑 20 自愈结算）。
6. **关页后确认无残留图形**：老虎机窗口滚动图标不应残留（验证坑 21 `preupdate` 兜底）。
7. 退出关卡重进 → `runItems`/`runTimedWeapons` 与各 vendor 的 `stock`/`bought`/`slot` 全部清零（验证坑 22）。
8. 武器商品卡显示**武器本体外观**（背景盘之上叠 `getWeaponDef(item.weaponId || item.id).appearance`），不只是背景盘——编号 `101/102/103` 的商品应显示 `yellow`/`green`/`weapon-1788012926999` 的真身外观（验证坑 24）。
9. 护盾 / 速度 / 攻击力 等消耗品图标位于方框**正中**（包围盒中心落在图标中心，验证坑 25 `recenter`）。
10. 「速度药水」图标在白卡上**可见**（纯白款自动改黑色款，验证坑 26）。
11. 老虎机**上下两块面板左右外沿对齐**（白卡 `204..798` 与底板白色外沿 `204..798`，验证 `PANEL_CX=501`）。

**局内消耗品 / 限时武器冒烟清单**（对应第 7 章坑 27-31）：

1. `node server.js` → 进 `Level1-Scene1.json`，在关卡里放一台售货机 + 一个带 `potion` 掉落规则的敌人。
2. 靠近售货机按 **F** 购买药水 → HUD 左下药水槽出现**黑底白框 + 纯白图标**（`whiteVariant`）+ 槽下队列小点（间距 8、不越屏幕底边）→ **短按数字键 4** 用掉（队列点从后往前减）。
3. **长按数字键 4 ≥ 160ms** → 出轮盘（全屏蒙层 + 4 扇区，300ms 渐显）：鼠标**悬停扇区平滑高亮**（灰蒙层由内到外**连续变淡**、无分层跳变）、悬停圆心死区显示叉号且**不选中**、松开即用该扇区；打开期间**游戏不暂停**（能移动/开火）。**候选药水图标为黑底实心圆 + 白色图标、无任何边框**（中心死区圆仍有白边+白叉）；**4 项药水名各自显示在自己图标的正下方**（`wheelNamePos`），字号 **24px**（`WHEEL_NAME_FONT`，比旧值再小 4px），文本与轮盘**同进同出**（alpha 跟随动画）。
4. 用药后玩家左下角出现**白色状态图标**（列优先 2 列×4 行，最多 8 个），到期自动消失；`heal`（立刻回血）/`shield`（生成护盾）/`sec===0`（本局永久）三者**不显示**状态图标。
5. 购买临时武器 → HUD 右侧临时武器槽出现**黑底 + 白框 + 原色武器图案 + 圆形黑底盘**（`WEAPON_BG_ASSET`，黑底上不可见）→ **按数字键 5** 使用 → 槽位变**白底 + 武器色（`ringColor`）亮框 + 同款圆形黑底盘（白底上显出）** + 顶部同色时间条随剩余比例缩短 + 武器图案（保持**原色**）**持续自转** → **再按 5** 取消 → 回到**黑底白框**（同样**原色**图案 + 黑底盘）、时间条消失，并还原 `player.weaponType`。
6. 击杀带 `potion` 掉落的敌人 → 掉落物显示**药水图标**（尺寸 30；图标未加载时先白点、随后补拉）；走近拾取入队。
7. 离开战斗态 / 重开关卡 → 轮盘药水名**不残留**（验证坑 28）；轮盘打开期间**滚轮不能切武器**（验证坑 30）。
8. **第二轮手感新增冒烟①**：长按 4 呼出轮盘，鼠标在扇区间移动 → 灰色蒙层应**平滑渐显**且由内到外**连续变淡**（无分层跳变）；**松开后高亮随轮盘一起渐隐（不再跳扇区）**（验证坑 36 / 41）。**候选图标无边框**（仅黑底圆 + 白图标）；**4 项名称文本各自在自己图标正下方**、字号 **24px**（比上一轮再小 4px）（验证坑 43 / 45）。
9. **第二轮手感新增冒烟②**：按 5 使用临时武器 → 槽位应为**白底 + 武器色亮框 + 原色武器图案 + 圆形黑底盘（白底上显出）+ 顶部时间条**，且武器图案**持续自转（动态）**；再按 5 取消 → 回到**黑底白框**（同样**原色**图案 + 黑底盘，黑底上不可见）、时间条消失（验证坑 38 / 39）。
10. **第三轮手感新增冒烟③**：① 临时武器槽**使用中**应能看到**圆形黑底盘**（白底上显出黑盘）——验证「两态都渲染底盘」（坑 38）；② 轮盘 4 项名称分别显示在**自己图标正下方**、字号更小（24px，坑 43/45）；③ 老虎机 3 个窗口内图标四周有**明显内边距**（白卡 120×120 / 图标 88、四周各 16px，坑 44）。

