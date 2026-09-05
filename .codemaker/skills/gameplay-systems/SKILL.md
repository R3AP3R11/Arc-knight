---
name: gameplay-systems
description: 改工坊背包与装备槽 / 加点 / 新手引导阶段机 / 骑士之家 F 键交互 / 登录页按钮与存档选择流程时读这份；覆盖 src/systems/gameplay/**、src/editor/save-flow.js、src/player-data.js。
---

# 系统玩法 开发指南

## 1. 这块负责什么

「元游戏与流程」层：玩家在**战斗之外**做的事——从登录页进入游戏、选存档、走新手教学、回骑士之家（Hub）、进工坊搭配装备与加点，再出发打关卡。核心是三个 mixin（`WorkshopMixin` 28 方法 / `NewbeeHubMixin` 12 方法 / `SaveLoginMixin` 9 方法）加编辑器侧的存档流程 `src/editor/save-flow.js`。

玩家可见功能点：

- 登录页 5 个按钮（新游戏 / 继续游戏 / 武器 / 工坊 / 设置），悬停白色平行四边形滑入
- 虫洞入场动画（`startIntro` / `updateIntro`，当前登录页「新游戏」暂时跳过，代码保留）
- 存档选择页：3 张卡（save-1/2/3），显示名称 / 等级 / 更新时间，空槽不可点
- 新手教学关 `newbee`：6 阶段引导（射击 → 移动 → 打杂兵 → 举盾 → 收尾击杀 → 离开/练习），玩家头顶提示文字 + 键位图标，血量下限永不失败
- 骑士之家 `knight-home`：3 个可交互点（工坊 / 商店 / 选择关卡），靠近显示 F 键提示，按 F 打开对应全屏页
- 工坊页：左侧等级经验 + 4 属性加点 + 圣物/宠物槽，右上武器卡横向滚动列表（含通用/专属改件槽），右下仓库三页签（改件/圣物/宠物），长按拾起 → 拖拽 → 落槽装备

**不含**：
- 战斗实时逻辑（开火、护盾、受伤、敌人 AI）→ 详见 **combat** skill
- 关卡内触发器 / 生成器 / 传送门 / 售货机 / 神像 → 详见 **level-design** skill
- 数值口径（加点每点收益、掉落、价格、伤害公式、`normalizePlayer` 的字段合法性）→ 详见 **economy-numbers** skill
- HUD / 弹窗页绘制体系、`data/ui` 节点图渲染、点击命中派发主循环 → 详见 **ui-interaction** skill
- 武器设计稿 / 运行时武器目录（`weaponCatalog`/`weaponRingColor`/`registerBuiltinWeapons`）→ 详见 **engine-editor** skill（`src/systems/art/weapon-registry.js`/`weapon-store.js`/`default-weapons.js`）；工坊的武器卡与快照只做展示，**不定义武器本体**

本分类和上面四类的接缝很多（工坊页既是 UI 又是玩法、加点既是流程又是数值），判断标准：**「玩家在做流程决策」的代码归这里，「数字与渲染实现」归对应 skill。**

## 2. 文件地图

| 文件 | 职责 | 关键导出 | 行数 |
| --- | --- | --- | --- |
| `src/systems/gameplay/workshop.js` | 工坊页全部逻辑：绘制、仓库过滤、拖拽长按、落点校验、装备写回、武器出战槽切换、悬停改件 tip（白底黑字名称/效果，已安装则「卸下」；右键可固定 tip、点空白消失）；**仓库格带纵向滚动条（`workshopInvScroll`，内容画进持久 mask 的 `workshopInvContentG`，滚轮+滑块+空白拖动）**；武器卡列表只渲染玩家已拥有（unlocked）武器（`weaponCatalog()` 过滤 `weaponsState[t]?.unlocked`，不用占位补齐）；**武器卡上半区(白底 + 固定「武器图标背景」资产 `WEAPON_BG_ASSET` + 武器外观/玩家本体叠加；设计武器用 `appearance`，普通武器用玩家 art 资产或六边形本体 `drawHexRingPlayer`，叠加用 `drawDesignCentered` 以设计原点居中)与下半区(改件装配) 1:1，黑色分割线，改件槽左对齐两行显示，槽位数按武器 `getModCaps(type)` 配置**；改件图标在右下仓库 89×89、图标 3px 内缩、带 `icon` 的改件用 `renderAssetFit`（`designBounds` 居中+等比，含描边不超框）渲染画板动态资产（三发/多轨）；左上快照 `drawWorkshopSnapshot` 复用武器编辑器预览 | `WorkshopMixin`（28 方法）；`weaponName` `weaponRingColor` `drawWorkshopSnapshot` `fireWorkshopSnapshot` `drawModRow` `updateWorkshopInvScrollDrag` `drawWorkshopTip` `findItemEquip` `workshopUnequip` | 1060 |
| `src/systems/gameplay/newbee-hub.js` | 新手教程 6 阶段状态机 + Hub 三点 F 键交互 + 提示绘制 | `NewbeeHubMixin`（12 方法）；模块私有 `HUB_INTERACTABLES` / `HUB_INTERACT_RADIUS` / `NEWBEE_HINT_*` / `NEWBEE_ICONS` | 461 |
| `src/systems/gameplay/save-login.js` | 登录页按钮定义与点击派发、虫洞入场动画、存档选择页 | `SaveLoginMixin`（9 方法） | 221 |
| `src/editor/save-flow.js` | 存档源切换（正式/测试）、新游戏、选存档进入、编辑器试玩启动 | `isTrialSaveStore` `listStoreSaves` `saveStorePlayer` `loadStorePlayer` `startNewGame` `selectSave` `startTrial` | 102 |
| `src/systems/economy/progression.js` | `saveSource()` / `persistSave()` / `applyUpgrade()`，工坊加点落点 | `ProgressionMixin`（4 方法）、`UPGRADE_STATS` | 66 |
| `src/player-data.js` | 存档数据模型与归一化（`weaponMods[w]` 为 `{generic:[],dedicated:[]}`，均数组） | `normalizePlayer` `DEFAULT_PLAYER` `SLOT_UNLOCK_LEVELS` `grantLevelUp` `PLAYER_WEAPONS` `PLAYER_VERSION` | 323 |
| `src/state.js` | 物品与武器定义（工坊只读这几个） | `ITEM_DEFS`(25-43) `MOD_DEFS`(46) `WEAPON_TYPES`(17) `WEAPON_LABELS`(18) | 504 |
| `src/systems/ui/ui-runtime.js` | 关联：`openMenuScreen/closeMenuScreen`(383/390)、`drawUI` 分发(302-325)、按钮回调派发 `onUIPointer`(498-530)、`isNewbeeLevel/isHubLevel/isPreviewMode`(167-186)、工坊武器卡遮罩(29-33)、仓库格遮罩(34-40)、拖拽高层 Graphics(41-42)创建 | `UiRuntimeMixin`、`WEAPON_SLOT_LEVELS` | 594 |
| `src/game-scene.js` | update 调用时机：工坊长按/滚动(144-147)、`updateNewbee`(483)、`updateHubInteract`(485)、新手 fired/moved 标记(236-239)、pointerup 兜底(73)、mixin 装配(558) | `createGameScene` | 568 |
| `src/systems/editor/editor-input.js` | 工坊 pointerdown 优先拦截(16)、登录页按钮命中(20-31)、pointermove 转发工坊(195-198) | `EditorInputMixin` | — |
| `src/systems/editor/editor-camera.js` | `onWheel` 里工坊滚轮滚动(125-137) | `EditorCameraMixin` | — |
| `src/systems/level/level-flow.js` | `restart()` 里 `initNewbee/initHub`(113-114)、标记 `playedNewbee`(169-171)、`this.player` 从存档构建(154-245)、`commitPlayer/settleVictory` 回写(258-281) | `LevelFlowMixin` | — |
| `src/systems/level/spawning.js` | 新手关生成：`spawnNewbeeEnemies`(135) `spawnAdvanced2AtTopRight`(149)，`NEWBEE_TRIANGLE_RADIUS=500`(27) | `SpawningMixin` | — |
| `src/systems/combat/player-combat.js` | `NEWBEE_MIN_HP=5`(24) 血量下限、护盾成功抵挡置 `newbee.shieldBlocked`(55) | `PlayerCombatMixin` | 112 |
| `src/editor/level-flow.js` | 场景 ctx 回调注册：`onStartNew`(95) `onListSaves`(96) `onSelectSave`(97) `onOpenLevel`(98) `onSettings`(104) `onPlayerSave`(105) | — | — |
| `data/ui/workshop.json` | 工坊页布局参数（当前仅技能树占位字段，页面主体是代码绘制） | — | 12 |
| `data/ui/login.json` | 登录页数据驱动节点（logo / 标题 / 版本号），按钮不在此 | — | 8 |
| `data/levels/newbee.json` | 新手关：`ui:battle`，world 1600×1600，spawn (796,897)，`enemies:[]`（全靠阶段机生成） | — | — |
| `data/levels/knight-home.json` | Hub 关：`ui:battle`，world 1920×1920，spawn (1320,990)，`enemies:[]` | — | — |
| `data/players/index.json` | 正式存档槽 id 数组，当前 `["save-1"]` | — | 3 |
| `data/players/save-1.json` | 单个存档文件（`normalizePlayer` 的序列化形态） | — | — |
| `server.js` | 存档 REST：`GET /api/players` 返回 `{slots, metas}`(207-212)、`POST /api/players/:id` 写入并补 index(216-220) | — | — |

### 改 X 该动哪个文件

| 想改的东西 | 动这里 |
| --- | --- |
| 工坊页布局 / 面板位置 / 卡片尺寸 | `workshop.js:drawWorkshopUI`（21-304，坐标全部硬编码在方法体内） |
| 武器卡列表来源 / 卡数量 | `workshop.js:186-190` 读 `weaponCatalog()` 得 `cardTypes`，不足 5 张用 `placeholder` 补齐（`workshopCardCount` 由目录长度决定，非写死 5） |
| 左上武器快照预览（外形/媒介/自转/开火） | `workshop.js:drawWorkshopSnapshot`（314-413）+ `fireWorkshopSnapshot`（416-419）+ pointer 里 `handleWorkshopPointerDown:641` 的命中区首判 |
| 武器名 / 环颜色显示 | `workshop.js:weaponName`（306-308）、`workshop.js:weaponRingColor`（309-311）——分别读 `getWeaponDef(type)?.name`、`getWeaponDef(type)?.medium?.ringColor` |
| 工坊新增装备槽种类 | `workshop.js` 的 `drawWorkshopUI` 推 `workshopDropZones` + `isValidWorkshopDrop`/`workshopSlotContains`/`workshopReplaceSlot` 四处 + `player-data.js:normalizePlayer` 的 `equipment` |
| 仓库页签与过滤规则 | `workshop.js:workshopInventoryItems`（463）+ `drawWorkshopUI:255` 的 `tabs` 数组 |
| 长按拾起阈值 / 拖拽取消距离 | `workshop.js:updateWorkshopLongPress`（674） |
| 武器卡滚动范围 | `workshop.js:drawWorkshopUI:184-191` + `updateWorkshopScrollDrag:692-698` + `editor-camera.js:131`（三处 `contentW` 要同步；前两处已用 `workshopCardCount`，editor-camera 仍是写死 `5*(280+24)`） |
| 加点属性项 / 每点收益 / 上限 | `progression.js:UPGRADE_STATS`（10-15，工坊自动按 key 渲染行）→ 数值口径详见 economy-numbers skill |
| 新手教程阶段与文案 | `newbee-hub.js:advanceNewbee`（152-276）+ `initNewbee`（28-64）的初始字段 |
| 新手提示时长 / 位置 / 图标 | `newbee-hub.js:16-26` 的 4 个 `NEWBEE_HINT_*` 与 `NEWBEE_ICONS` |
| Hub 可交互点位置 / 增删 | `newbee-hub.js:11-15` `HUB_INTERACTABLES` + `drawHubUI:403` 的 emoji 映射 |
| Hub 触发距离 / 提示渐显速度 | `newbee-hub.js:10` `HUB_INTERACT_RADIUS`、`updateHubInteract:119` 的 `dt/180` |
| 登录页按钮增删与顺序 | `save-login.js:loginButtons`（136-156）+ `onLoginButtonClick`（12-26） |
| 登录页 Logo / 标题 / 版本号 | `data/ui/login.json`（数据驱动，可用编辑器 UI 配置页改） |
| 存档卡外观 / 显示字段 | `save-login.js:drawSaveSelectUI`（81-134），字段来源是 `server.js:211` 的 metas |
| 存档槽数量 | `save-login.js:83` 的 `slots` 数组（前端写死 3 槽）+ 后端 index.json 自动增长 |
| 出战槽解锁等级 | `player-data.js:17 SLOT_UNLOCK_LEVELS` 与 `ui-runtime.js:18 WEAPON_SLOT_LEVELS`（两份重复值，都要改） |
| 新游戏进哪个关 / 选存档进哪个关 | `save-flow.js:startNewGame`（38-40 固定 `newbee`）、`selectSave`（61-66 固定 `knight-home`） |
| 试玩用测试存档还是正式存档 | `save-flow.js:isTrialSaveStore`（19-21）读 `state.saveStore` |

## 3. 核心数据结构

### 3.1 工坊运行时状态（全部挂在场景实例 `this` 上）

| 字段 | 结构 | 含义 | 生命周期 |
| --- | --- | --- | --- |
| `this.workshopDropZones` | `[{x,y,w,h,slotType,index?,weapon?}]` | 所有可落点装备槽命中区 | **每帧重建**（`drawWorkshopUI:56` 清空，绘制过程 push） |
| `this.workshopItemRects` | `[{id,def,stackable,category,count,x,y,w,h}]` | 仓库格子命中区 | **每帧重建**（`:57-58`） |
| `this.workshopCardRects` | `[{type,x,y,w,h}]` | 武器卡命中区，用于判断「点在卡上还是空白（可拖动滚动）」 | **每帧重建**（`:57-58`） |
| `this.workshopScrollArea` | `{x:544,y:120,w:1312,h:440}` | 武器卡滚动视口，滚轮与横向拖拽判定区 | **每帧重写**（`:59`），`onWheel` 有同值兜底 |
| `this.workshopScroll` | number 0..maxScroll | 武器卡横向滚动偏移 | **持久**（切页不清，`:193-194` 每帧 clamp） |
| `this.workshopCardCount` | number | 武器卡总数（`weaponCatalog()` 长度，不足 5 补占位） | 每帧由 `cardTypes.length` 重算（`:190`） |
| `this.workshopSnapArea` | `{x:76,y:56,w:300,h:168}` | 左上快照预览框命中区 | `drawWorkshopSnapshot` 每次写（`:316`），pointer 首判 |
| `this.workshopSnapType` / `this.workshopSnapEntry` | string \| runtime-entry | 当前快照武器类型 / 该武器运行时开火条目（设计稿 `buildWeaponRuntimeEntry`，无设计稿退化用 `WEAPONS[type].fire`） | 切武器时重建（`:327-343`） |
| `this.workshopSnapBullets` / `this.workshopSnapBeam` | array \| {…} | 快照模拟发射出的子弹 / 光束 | 每帧推进并裁剪（`:405-411`） |
| `this.workshopSnapDir` / `this.workshopSnapAngle` | 1\|-1 \| rad | 自转方向 / 当前角度，复刻 game-scene 的 weaponAngle 自转 | 松开开火翻转 `Dir`（`:704`） |
| `this.workshopSnapFireDown` / `this.workshopSnapFireClock` | bool \| number | 是否按住开火 / 开火节拍 | 点按置 true（`:417`），松开置 false（`:703`） |
| `this.workshopSnapSimT` | number | 快照模拟时间（每帧 +0.016） | `drawWorkshopSnapshot` 自增（`:344`） |
| `this.workshopPress` | `{itemId,category,stackable,t0,x,y}` | 长按候选：按下仓库格子时记录 | 持久到升级成 drag / 移动超 24px / pointerup |
| `this.workshopDrag` | `{itemId,category,stackable}` | 正在拖拽的物品 | 长按 ≥100ms 生成，pointerup 结算后置 null |
| `this.workshopScrollDrag` | `{startX,scroll}` | 横向拖拽滚动的起点快照 | pointerup 置 null |
| `this.workshopTab` | `'mod'\|'relic'\|'pet'` | 仓库当前页签 | **持久**（默认 `'mod'`，`:254`） |
| `this.workshopTip` | `{text,until}` | 顶部黄字提示（2s） | `showWorkshopTip` 写入，按 `time.now` 过期 |
| `this.workshopTexts` | `Map<id, Phaser.Text>` | 文本对象池，每帧先全 `setVisible(false)` 再按需复用 | 持久（`setupUI:34` 建，切出工坊时统一隐藏 `ui-runtime.js:254`） |
| `this.statBars` | `{[key]:{cur,target}}` | 加点进度条的插值动画状态 | 持久；`statBarLast` 存上一帧时间戳 |
| `this.workshopCardMask` | `GeometryMask` | 武器卡视口裁剪（544,120,1312,440） | 场景级，`ui-runtime.js:27-31` 创建一次 |
| `this.workshopInvContentG` / `workshopInvMask` | Graphics / `GeometryMask` | 仓库格绘制 Graphics（`setMask(workshopInvMask)`，depth 1001）+ 视口裁剪（544,795,1280,245） | 场景级，`ui-runtime.js:34-40` 创建一次 |
| `this.workshopInvScrollArea` | `{x:544,y:795,w:1280,h:245}` | 仓库纵向滚动视口（滚轮/滑块/空白拖动判定区） | 每帧重写（`:298`），`onWheel` 有同值兜底 |
| `this.workshopInvScroll` / `workshopInvMaxScroll` | number 0..max \| number | 仓库纵向滚动偏移 / 上限（`invContentH - 245`） | 持久；`:304-305` 每帧 clamp，`maxScroll` 每帧重算 |
| `this.workshopInvThumb` | `{x,y,w,h}` \| null | 纵向滚动条滑块命中区（仅 `maxScroll>0` 时存在） | 每帧重算（`:337-339`），`pointerDown` 首判拖动 |
| `this.workshopInvScrollDrag` | `{startY,scroll}` | 正在拖拽的仓库纵向滚动 | `pointerUp` 置 null |
| `this.workshopHover` | `{itemId,def,,tipRect,unequipRect}` \| null | 悬停改件/圣物/宠物的 tip 数据：`equipped`=是否已安装（则显示「卸下」），`tipRect`/`unequipRect`=tip 面板/卸下按钮命中区 | 每帧重算（`:348-...` 悬停检测）；`workshopDrag` 时强制 null；`drawWorkshopTip` 写入 rect |
| `this.workshopPinnedTip` | `{itemId,def,equipped,x,y,tipRect,unequipRect}` \| null | 右键固定的改件 tip（不随光标移动，避免点不到「卸下」）；`x/y`=固定位置 | `handleWorkshopPointerDown` 右键命已安装改件时写入；点「卸下」或点空白(非 tip/cell/dropZone/button)置 null |
| `this.workshopDragG` | `Graphics` | 高层 Graphics（depth 1002）：拖拽中的改件图标与悬停 tip 面板都画在这（须盖过卡片内容 1001） | 场景级，`ui-runtime.js:41-42` 建一次，`drawUI` 帧首 clear |

### 3.2 装备槽 zone 标识与存档 `equipment` 映射

| zone.slotType | zone 附带字段 | 槽数 | 接受的物品 | 写入存档路径 |
| --- | --- | --- | --- | --- |
| `weaponGeneric` | `weapon`、`index` | 每武器 `getModCaps(weapon).generic`（默认 3） | `category==='mod' && weapon===''` | `equipment.weaponMods[weapon].generic[index] = itemId`（数组） |
| `weaponDedicated` | `weapon`、`index` | 每武器 `getModCaps(weapon).dedicated`（默认 1） | `category==='mod' && weapon===zone.weapon` | `equipment.weaponMods[weapon].dedicated[index] = itemId`（数组） |
| `relic` | `index: 0..2` | 3 | `category==='relic'` | `equipment.relics[index]` |
| `pet` | `index: 0..1` | 2 | `category==='pet'` | `equipment.pets[index]` |

共 **4 种槽位类型**（武器通用改件 / 武器专属改件 / 圣物 / 宠物）；此外还有 3 个**武器出战槽**（`workshopSlot_1/2`，按钮 id 而非 dropZone，槽 0 恒为 radial，只走点击不走拖拽）。校验入口统一在 `isValidWorkshopDrop`（365-372），互斥去重在 `workshopSlotContains`（374-388），替换与旧物回仓在 `workshopReplaceSlot`（422-453）。`normalizePlayer` 侧上限硬编码：relics 3、pets 2（`player-data.js:281-282`）。**战斗可用武器严格取自出战槽 `loadout`**：`level-flow.js:restart` 里正式/试玩（mode≠play）用 `normalizeWeapons(loadoutUnlocked)`（出战槽中已解锁武器，空则回退 radial），**不再回退到「全部已解锁武器」`fallbackWeapons`**；仅编辑器「游戏预览」(mode='play') 用全部已解锁便于测试——即武器「解锁」不等于能用，必须放进工坊出战槽。

### 3.3 新手教程状态 `this.newbee`（`initNewbee` 28-64 建，非 newbee 关为 `null`）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `phase` | 1..6 | 当前阶段号，共 **6 个阶段** |
| `allowFire` / `allowMove` / `allowShield` | bool | 输入权限门（`game-scene.js:204/224/227` 读） |
| `hint` | `{text,icon,fadeAt,pre,showT}` | 当前提示：`pre` 出现前延迟倒计时、`showT` 淡入累计、`fadeAt` 淡出倒计时（null=不淡出） |
| `fired` / `moved` | bool | 是否已开火 / 已移动，由 `game-scene.js:237-238` 置位 |
| `subHintShown` | bool | 阶段 1 的「准心校准」二段提示是否已展示 |
| `enemies` | array | 阶段 3 生成敌人快照（实际判定直接遍历 `this.enemies`） |
| `phase3Fire` | bool | 阶段 3 内是否开过火（用于让提示淡出） |
| `advanced` | enemy\|null | 阶段 4 生成的 `advanced2` 引用 |
| `shieldBlocked` | bool | 是否用护盾成功挡过一次（`player-combat.js:55` 置位） |
| `phase6Shown` / `leaving` | bool | 阶段 6 已展示 / 已触发离开（防重入） |
| `exitRect` / `practiceRect` | `{x,y,w,h}` 中心+尺寸 | 阶段 6 两个世界矩形触发区（797,139,160²）/（432,674,160²） |

计时字段全在**另一个对象** `this.newbeeDelay`（简称 `d`），`updateNewbee:145-147` 每帧对所有数值键统一 `-dt` 并夹到 0，`advanceNewbee` 用 `d.xxx === undefined` 判断「还没开始计时」、`d.xxx <= 0` 判断「计时到」：

| 键 | 初值 | 作用 |
| --- | --- | --- |
| `p1fade` | 1000 | 首次开火后射击提示淡出 |
| `p1gap` | 500+2000 | 淡出后到校准提示之间的空档 |
| `p1after` | 1500+2000 | 校准提示播放时长，到点进阶段 2 |
| `p2fade` | 1000 | 移动提示淡出 |
| `p2wait` | 5000+2000 | 移动完成后等待，到点进阶段 3 并生成敌人 |
| `p3fade` | 1000 | 「敌人出现了」提示淡出 |
| `p3after` | 4000+2000 | 杂兵清空后等待，到点进阶段 4 |
| `p5pause` | 3000 | 击杀 advanced2 后停顿，到点进阶段 6 |
| `practiceCooldown` | 1200 | 阶段 6 练习区重复刷怪冷却（到点 `delete` 掉，实现可重复触发） |

提示图标枚举 `NEWBEE_ICONS`（`newbee-hub.js:21-26`）：`mouse:/mouse.png`、`wasd:/wasd.png`、`space:/space.png`、`f:/f.png`（文件在 `public/`）。图标按需懒加载，`newbeeHintIcons[icon]` 三态：`undefined` 未加载 / `'loading'` / `Phaser.Image` 或 `null`（加载失败，`naturalWidth===0` 判 404）。

### 3.4 Hub 交互

| id | x | y | label | 按 F 打开 |
| --- | --- | --- | --- | --- |
| `workshop` | 1320 | 680 | 工坊 | `openMenuScreen('workshop')` → `drawWorkshopUI` |
| `weapon` | 540 | 300 | 商店 | `openMenuScreen('weapon')` → `drawWeaponShop`（ui-interaction skill） |
| `levelSelect` | 940 | 300 | 选择关卡 | `openMenuScreen('levelSelect')` → `drawLevelSelect`（ui-interaction skill） |

共 **3 个可交互点**。`HUB_INTERACT_RADIUS = 80`（世界像素，圆形，取最近者）。运行时字段：`this.hubNearest`（当前最近可交互点或 null）、`this.hubTipT`（0→1 渐显进度，`dt/180` 累加，离开即归 0）、`this.hubIcons`（`{id: Phaser.Text}` emoji 占位，主相机专属）、`this.hubTipText` / `this.hubTipKeyText` / `this.fKeyBadge`（F 键帽图片，与售货机 tips 共用）。

### 3.5 存档槽结构

`GET /api/players` 返回（`server.js:207-212`）：

```
{ slots: ["save-1"], metas: { "save-1": { name, updatedAt, level } } }
```

`data/players/index.json` 只存 slots 数组；每槽一个 `data/players/<id>.json`，内容即 `normalizePlayer` 结果（`version/meta/progress/currency/weapons/loadout/playedNewbee/combat/points/items/equipment/levels`）。测试存档同结构在 `data/test-players/`（目录当前不存在，首次写入时由 `server.js:91` 自动创建）。

场景侧字段（`save-login.js:openSaveSelect` 59-79）：

| 字段 | 含义 |
| --- | --- |
| `this.saveSlots` | `{slots, metas}` 或 null（未加载） |
| `this.saveSlotsLoading` | true 时卡片显示「读取中…」 |
| `this.saveSlotsError` | true 时标题下显示红字「读取存档列表失败」，同时 slots 置空对象 |
| `this.saveSelectTexts` | 存档页文本对象池 |

`drawSaveSelectUI:83` 前端固定枚举 `['save-1','save-2','save-3']`，metas 里没有的槽画成「存档 N · 空」且不 push 按钮。

## 4. 关键流程

### 4.1 登录页点击派发

```
editor-input.js:pointerDown(20-31)  命中 this.loginButtonRects
  → pressAnim(id)
  → save-login.js:onLoginButtonClick(12-26)
      'new'      → ctx.onStartNew()      → editor/level-flow.js:95 → save-flow.js:startNewGame(33-50)
      'continue' → this.openSaveSelect()
      'weapon'   → openMenuScreen('weapon')
      'workshop' → openMenuScreen('workshop')
      'settings' → ctx.onSettings()      → editor/level-flow.js:104（当前空实现）
```

`loginButtonRects` 由 `drawLoginButtons`（162-216）每帧重写；`continue` 按钮的显隐取决于 `ctx.state.hasAnySave`（`loginButtons:139`），该标志由 `main.js:63-66`（编辑器启动列正式存档）/ `save-flow.js:88`（试玩列测试存档）/ `packaged.js:46`（打包端）设置。注意 `startNewGame` 目前**直接**调 `ctx.onStartNew`，虫洞动画被跳过（`save-login.js:15` 注释说明）。

### 4.2 虫洞入场动画（保留未启用）

```
startIntro(28-31)  → this.intro = {t:0, phase:'fly'}
game-scene.js:162  → updateIntro(dt)(33-56)
  phase 'fly'   : 按 ctx.state.level.background 的 radius/rings 计算最内环半径
                  * introGrowScale(t, fx)（entity-art.js:170）
                  > hypot(1920,1080) → 切 'black'
  phase 'black' : blackT 累加到 fx.introPause ?? INTRO_BLACK_PAUSE(1.5s)
                  → this.intro = null → ctx.onStartNew()
```

绘制侧：`ui-runtime.js:328-343` 在 intro 期间隐藏全部 UI 文本/图片，`phase==='black'` 时铺满黑幕。

### 4.3 继续游戏 → 存档选择 → 进入

```
onLoginButtonClick('continue')
  → openSaveSelect(59-79)
      saveSlots=null / saveSlotsLoading=true / saveSlotsError=false
      openMenuScreen('saveSelect')   ← 此时 state 从 playing 转 paused（ui-runtime.js:386）
      ctx.onListSaves()  → editor/level-flow.js:96 → save-flow.js:listStoreSaves(22-24)
                            → api.js:listPlayers / listTestPlayers（按 state.saveStore）
      .then  → saveSlots=res, loading=false, drawUI()
      .catch → saveSlots={slots:[],metas:{}}, error=true, drawUI()
      （两个分支都先判 this.scene.isActive() 防场景已销毁）
  → drawUI → ui-runtime.js:309 → drawSaveSelectUI(81-134)
      对有 meta 的槽 push 按钮 {id:`selectSave_${id}`}
  → 点击 → ui-runtime.js:onUIPointer:519 → ctx.onSelectSave(id)
      → editor/level-flow.js:97 → save-flow.js:selectSave(54-71)
          normalizePlayer(loadStorePlayer(id)) → state.player / state.playerId
          state.trialPlayer = clone(player)
          目标关：knight-home 优先，否则 player.levels.current
          fadeAndSwitch(selectLevel(target) → setMode('trial'))
```

「返回登录界面」按钮 id `saveSelectBack` → `closeMenuScreen()`（`ui-runtime.js:526`）。

### 4.4 新手教程完整阶段链

`level-flow.js:restart():113` → `initNewbee()`（仅 `isNewbeeLevel()`，即 `state.levelId==='newbee'`）；每帧 `game-scene.js:483 updateNewbee(dt)` → 倒计时推进 → `advanceNewbee()`（152-276）。

| 阶段 | 权限 | 提示 | 推进条件 |
| --- | --- | --- | --- |
| 1 | fire ✓ move ✗ shield ✗ | 「按『鼠标左键』射击」（mouse） | 开火 → 提示淡出 1s → 空档 2.5s → 二段提示「准心一直移动，用射击来校准」播 3.5s → 阶段 2 |
| 2 | +move ✓ | 「按 WASD 移动」（wasd） | 有位移 → 淡出 1s → 等 7s → 阶段 3，同时 `spawnNewbeeEnemies(3,'basic1')` |
| 3 | 同上 | 「敌人出现了！击败他们」（每帧强制保持，直到开火） | 开火后提示淡出 1s；`basic1` 全部死亡 → 等 6s → 阶段 4，`allowFire=false`、`allowShield=true`、`spawnAdvanced2AtTopRight()` |
| 4 | fire ✗ shield ✓ | 「按『空格』进行防御」（space，每帧强制保持） | `shieldBlocked`（护盾成功挡弹，`player-combat.js:55`）→ 阶段 5，`allowFire=true` |
| 5 | fire ✓ shield ✓ | 「干得好！解决掉面前的敌人」 | `advanced2` 死亡 → 停顿 3s → 阶段 6 |
| 6 | 同上 | 「新手教程结束，可继续练习或离开」 | 站进 `exitRect` → `beginSwitch({target:'login'})`（`leaving` 防重入）；站进 `practiceRect` 且场上无敌人 → 刷 3 只 `basic1`，冷却 1.2s |

`advanceNewbee` 的作用：**纯状态推进器**，每帧从 `nb.phase` 分支进入，只做「条件判断 → 改 phase / 改权限 / 设提示 / 起计时 / 触发生成」，不负责绘制也不自己减时间（减时间在 `updateNewbee`）。绘制在 `world-render.js:547-548` 调 `drawNewbeeHint`（跟随玩家头顶 160px）与 `drawNewbeeRects`（仅阶段 6 画两个矩形 + 世界标签）。

### 4.5 Hub 靠近交互 → 打开页面

```
game-scene.js:485 → updateHubInteract(dt)(104-124)
  仅 isHubLevel() && state==='playing'
  遍历 HUB_INTERACTABLES 取距离 < 80 的最近点 → this.hubNearest
  hubTipT = nearest ? min(1, hubTipT + dt/180) : 0
  nearest && JustDown(keys.F) → openMenuScreen(nearest.id)
world-render.js:549 → drawHubUI(g)(385-459)
  画 3 个 emoji 占位图标；最近点额外描 80px 黄圈
  hubTipT>0 → 玩家右上画平行四边形白底 + label + F 键帽（整体 alpha=hubTipT）
```

Hub 关不显示战斗 HUD（`ui-runtime.js:351-353`），且 `isHubLevel()` 直接禁掉开火与护盾（`game-scene.js:224/227`）。

### 4.6 工坊装备链路（长按拖拽）

```
pointerdown → editor-input.js:16（menuScreen==='workshop' 时优先拦截）
  → handleWorkshopPointerDown(641-672)
      命中 workshopSnapArea（左上快照预览框）→ fireWorkshopSnapshot()，返回 true（按住即持续开火，复刻 game-scene 开火逻辑）
      命中 workshopItemRects → 记 workshopPress{itemId,t0,x,y}，返回 true（吞掉事件，不走 onUIPointer）
      否则命中 workshopScrollArea 且不在卡片上 → workshopScrollDrag，返回 true
      都没命中 → false → 继续走 onUIPointer（加点 + / 页签 / 武器卡 / 关闭）
每帧 game-scene.js:145 / pointermove editor-input.js:196
  → updateWorkshopLongPress(674)：移动 >24px 取消；按住 ≥100ms → workshopDrag（drawUI 开始画跟手图标）
  → updateWorkshopScrollDrag(692-698)：横向拖动改 workshopScroll
pointerup → game-scene.js:73 → handleWorkshopPointerUp(700-721)
  若 workshopSnapFireDown → 停止开火 + workshopSnapDir *= -1（翻转自转方向，复刻 game-scene）
  遍历 workshopDropZones 找命中 zone
  → workshopEquipItem(drag, zone)(580-595)
      source = saveSource()
      isValidWorkshopDrop(def, zone)      失败即静默返回
      workshopSlotContains(...)           已在该槽则返回（防自我覆盖）
      workshopRemoveFromInventory(...)    可堆叠减 1 / uniques splice；扣不动则中止
      workshopReplaceSlot(...) → 返回被顶下来的旧物 id 列表
      旧物逐个 workshopAddToInventory 回仓
      同步 this.player.items / this.player.equipment（局内即时生效）
      persistSave(source) → ctx.onPlayerSave → saveStorePlayer(state.playerId, source)
      drawUI()
  最后清空 workshopDrag / workshopPress / workshopScrollDrag
```

滚轮滚动是另一条路：`editor-camera.js:onWheel:125-137`，指针在 `workshopScrollArea` 内每格 ±40。

### 4.7 工坊加点链路

```
点击 + → onUIPointer(ui-runtime.js:511) → applyUpgrade(key)(progression.js:29-52)
  cfg = UPGRADE_STATS[key]；无 menuScreen 直接返回
  校验 this.player.spendablePoints > 0 且 points[key] < cfg.cap(10)
  写 this.player.points[key]+1 / spendablePoints-1 / combat[key]+=cfg.per
  maxHp / maxShield 额外同步到 this.player.maxHp / maxShield（战斗即时生效，详见 combat skill）
  写回 source.combat / source.points / source.progress.points → persistSave(source)
  syncUIState() + drawUI()
```

工坊显示的数值来自 `saveSource()`（存档），加点后靠回写保持一致；`this.player.*` 是局内运行时副本，由 `level-flow.js:154-245` 在 `restart()` 时从存档构建。

### 4.8 三套玩家数据

| 数据 | 何时使用 | `saveSource()` 返回 | 是否写盘 |
| --- | --- | --- | --- |
| `state.player` | 正式游戏 + 试玩（mode `trial`） | ✅（`progression.js:57`） | ✅ `persistSave` → `onPlayerSave` → `saveStorePlayer(state.playerId, ...)`；试玩时因 `state.saveStore==='test'` 落到 `data/test-players/`，正式存档不受影响 |
| `state.previewPlayer` | 编辑器「游戏预览」（mode `play`，`isPreviewMode()`=`!editing && mode==='play'`） | ✅（`progression.js:56`） | ❌ `persistSave` 首行即 return（`progression.js:62`） |
| `state.trialPlayer` | 只在 `save-flow.js:61` / `main.js:28` 赋值，作为「试玩前的存档快照」备份；**运行时没有任何读取方** | ❌ | ❌ |

`saveSource()` 语义：「当前应当读写的存档对象」。判定只有一条 —— 预览模式给 `previewPlayer`，其它一切（编辑器内实机试玩、打包端正式游戏）给 `state.player`。它**不区分**正式/测试存储；正式与测试的隔离发生在更外层的 `state.saveStore`（`save-flow.js:19-30`）。因此工坊/加点/装备代码只需要 `saveSource()` + `persistSave()`，不必关心自己处在哪种模式。

`editing`（编辑器画布编辑态）下三者都不写盘（`persistSave:62`），`level-flow.js` 构建 `this.player` 时也走关卡 spawn 而非存档（`:179-182`）。

## 5. 关键常量与数值

| 常量 / 值 | 位置 | 当前值 | 含义 | 调它影响什么 |
| --- | --- | --- | --- | --- |
| `HUB_INTERACT_RADIUS` | `newbee-hub.js:10` | 80 | Hub 交互触发半径（世界 px） | 变大更容易触发、也更容易在两点间抢焦点；同时是黄圈半径（`:413`） |
| `HUB_INTERACTABLES` | `newbee-hub.js:11-15` | 3 项 | Hub 三个交互点坐标与标签 | 增删即增删 Hub 功能入口；id 必须是 `openMenuScreen` 支持的页名 |
| `NEWBEE_HINT_FADE_MS` | `newbee-hub.js:16` | 1000 | 提示淡入/淡出时长，也被复用为多个 `fadeAt` 初值 | 变大提示更"温柔"，同时拉长 p1fade/p2fade 阶段 |
| `NEWBEE_HINT_PRE_MS` | `newbee-hub.js:17` | 2000 | 每条提示出现前的静默延迟（`setNewbeeHint` 里赋给 `hint.pre`） | 每次换提示都加这段延迟，改大会明显拖慢整段引导 |
| `NEWBEE_HINT_POST_MS` | `newbee-hub.js:18` | 2000 | 阶段间额外等待（加在 p1gap/p1after/p2wait/p3after 上） | 阶段节奏总时长 |
| `NEWBEE_HINT_Y_OFFSET` | `newbee-hub.js:19` | 160 | 提示相对玩家头顶高度 | 提示与角色的距离；图标再上浮 `t.height+14` |
| `NEWBEE_MIN_HP` | `player-combat.js:24` | 5 | 新手关血量下限 | 新手关永不失败；改成 0 等于允许教学中死亡 |
| `NEWBEE_TRIANGLE_RADIUS` | `spawning.js:27` | 500 | 阶段 3/6 三角阵生成半径 | 杂兵离玩家多远出现 |
| 工坊滚动视口 | `workshop.js:59` + `ui-runtime.js:29` | `544,120,1312,440` | 武器卡视口与遮罩矩形 | **两处必须同值**，否则裁剪与命中错位 |
| 武器卡尺寸/间距 | `workshop.js:199` | `cardW=280, cardH=440, cardGap=24`；**上半区(武器快照) `headH=cardH/2` 与下半区(改件装配) 1:1**，上区画「武器图标背景 + 武器外观/玩家本体」叠加（未解锁叠锁） | 卡片尺寸（两行改件槽） | 改了要同步 3 处 `contentW`：`drawWorkshopUI:206`（`cardTypes.length*(280+24)`）、`updateWorkshopScrollDrag:772`（`workshopCardCount*(280+24)`）、`editor-camera.js:131`（写死 `5*(280+24)`）；`cardH` 改则同步 `workshopScrollArea`/`workshopCardMask` 高度（440）|
| 武器卡改件槽数 | `workshop.js:264` | `getModCaps(type)`（`weapon-store`）；基础武器 `{generic:3,dedicated:1}` | 卡片两行槽位数（通用/专属各自一行） | 由武器设计稿 `maxGenericMods`/`maxDedicatedMods` 决定；改件槽可拖拽装备，`workshopReplaceSlot` 按 `index` 写入数组并回仓旧物 |
| 卡片数量 | `workshop.js:202-204` | `weaponCatalog()` 长度，不足 5 补 `placeholder`（默认 3 把 + 2 占位） | 武器列表长度 | 由运行时武器目录决定；`workshopCardCount` 驱动 `contentW` 与最大滚动量；新增设计武器会自动多一张卡（含占位补齐逻辑） |
| 快照预览区 | `workshop.js:315-316` | `{x:76,y:56,w:300,h:168}` | 左上快照预览框（`this.workshopSnapArea`） | 命中区与绘制框共用；改坐标要同步 `handleWorkshopPointerDown:645` 里的 `shopSnapArea` 判断 |
| 快照机体缩放 | `workshop.js:347` | `bodyScl = 1.5 * 0.75 = 1.125` | 快照里玩家本体缩小比例 | 预览框是武器编辑器占 25% 的缩小版；影响所有 `renderAsset`/`drawHexRingPlayer` 的缩放 |
| 快照自转角速度 | `workshop.js:383` | idle= `med.orbitSpeed ?? 180`；fire= `med.fireSpeed ?? 20`（deg/s） | 快照里 weaponAngle 自转速度 | 按住开火时用 fire 转速、松开用 idle 转速；复刻 game-scene 的 `weaponAngle` 自转 |
| 武器名 / 环色 | `workshop.js:306-311` | `weaponName`→`getWeaponDef(type)?.name \|\| WEAPON_LABELS[type] \|\| type`；`weaponRingColor`→`getWeaponDef(type)?.medium?.ringColor \|\| WEAPONS[type]?.ringColor \|\| '#ffffff'` | 卡上武器名与描边/槽底色 | 新设计武器要能看到名字与配色，得在 `default-weapons.js` 设计稿里给 `name` / `medium.ringColor` |
| 长按阈值 | `workshop.js:681` | 100 ms | 判定为拖拽的按住时长 | 太小会把点击误判成拖拽 |
| 拖拽取消距离 | `workshop.js:677` | 24 px | 长按期间允许的抖动 | 太小容易取消拾取 |
| 仓库网格 | `workshop.js:297-326` | 每行 13 列、格距 94、起点 (544,795)、格 89×89（图标 3px 内缩=83，数量徽标黑底白字右下角 3px 内缩）；**可纵向滚动**：内容画进 `workshopInvContentG`（mask 视口 544,795,1280,245），`workshopInvScroll` 偏移 | 仓库布局 | 超 13 个换行；下面板 327 高默认可见 ~2.6 行，超出的行靠滚动条（`workshopInvMaxScroll` 非 0 时显示）|
| 圣物槽 | `workshop.js:158-167` | 3 槽，50×50，右对齐 x=444，间距 10，y=652 | 圣物槽位 | 与 `normalizePlayer` 的 relic 上限 3 对齐（`player-data.js:281`） |
| 宠物槽 | `workshop.js:169-177` | 2 槽，50×50，右对齐 x=444，间距 10，y=726 | 宠物槽位 | 与 pet 上限 2 对齐（`player-data.js:282`） |
| 工坊提示时长 | `workshop.js:637-639` | 2000 ms | `showWorkshopTip` 显示时间 | 「出战槽已满」「N 级解锁」提示 |
| `UPGRADE_STATS` | `progression.js:10-15` | 4 项，`cap:10`；per 20/10/0.1/0.08 | 加点属性表 | 工坊左侧属性行**按 key 自动渲染**，加一项即多一行；数值口径见 economy-numbers skill |
| `SLOT_UNLOCK_LEVELS` | `player-data.js:17` | `[12,30]` | 出战槽 2/3 解锁等级 | 与 `WEAPON_SLOT_LEVELS`（`ui-runtime.js:18`，同值）**重复定义**，工坊读的是后者 |
| 存档槽枚举 | `save-login.js:83` | `['save-1','save-2','save-3']` | 存档选择页固定 3 槽 | 前端上限；后端 index.json 无限制 |
| 存档卡尺寸 | `save-login.js:103,107` | `cardW=420, cardH=240, gap=50, cardY=320` | 存档卡布局 | 槽数变了要重算 `totalW` 居中 |
| 登录按钮布局 | `save-login.js:148` | `startY=700, h=66, gap=22, w=420, x=120` | 按钮列位置 | 按钮增多会向下溢出 1080 高 |
| `INTRO_BLACK_PAUSE` | `entity-art.js:167` | 1.5 (秒) | 虫洞全黑停顿默认值 | 可被关卡 `background.introPause` 覆盖 |
| `PLAYER_VERSION` | `player-data.js:5` | 1 | 存档版本号 | 存档结构不兼容变更时应递增并写迁移 |

## 6. 扩展指南

### 6.1 新增一个工坊装备槽位（例：新增「徽章」badge 槽 ×2）

1. `src/state.js:ITEM_DEFS` 加 `category:'badge'` 的物品定义（含 `stackable` / `color`）。
2. `src/player-data.js`：`DEFAULT_PLAYER.equipment` 加 `badges: []`；`normalizePlayer` 的 `equipment` 里加 `badges: normalizeItemList(data.equipment?.badges, 'badge', 2)`。**必须做**，否则加载存档时字段被丢弃。
3. `workshop.js:drawWorkshopUI`：仿圣物段（164-168）画 2 个槽，`this.drawItemSlot(...)` + `this.workshopDropZones.push({x,y,w,h,slotType:'badge',index:i})`。
4. `isValidWorkshopDrop` 加 `if (zone.slotType==='badge') return def.category==='badge';`
5. `workshopSlotContains` 加 badge 分支（读 `source.equipment.badges[zone.index]`）。
6. `workshopReplaceSlot` 加 badge 分支（写数组、返回旧 id）。
7. 若要在仓库里能看到它：`drawWorkshopUI:245` 的 `tabs` 加 `['badge','徽章']`，并在 `workshopInventoryItems` 加对应过滤分支。
8. 若该槽影响战斗：改 `src/systems/combat/*` 的取值处（详见 combat skill）；数值走 economy-numbers skill。
9. 不需要改 `data/ui/workshop.json`（工坊页主体是代码绘制）。

### 6.2 新增一个新手教程阶段（例：在阶段 5 后插入「学会 F 交互」）

1. `initNewbee`（28-64）：加该阶段需要的子状态字段（如 `interacted:false`）与权限位。
2. `advanceNewbee`：把原「阶段 5 → 6」的跳转改成「→ 新阶段号」，然后新增一段 `if (nb.phase === N) { ... }`，末尾 `return;`（**每个分支都要 return，避免同帧连跳**）。
3. 新计时用 `d.xxxx`（`this.newbeeDelay`），只 push 到 `d` 上即自动被 `updateNewbee:147` 每帧扣减；用 `=== undefined` 起表、`<= 0` 判到点。
4. 触发条件若来自玩家输入，在 `game-scene.js:236-239` 附近置位（那里已有 `nb.moved` / `nb.fired` 范例）；若来自战斗事件，在对应 combat mixin 里置位（范例 `player-combat.js:55`）。
5. 提示统一走 `setNewbeeHint(text, icon, fadeAt)`；新图标先把图片放 `public/`，再在 `NEWBEE_ICONS` 加键。
6. 阶段号顺延后，`drawNewbeeRects:356` 里 `nb.phase !== 6` 的硬编码要跟着改成新的收尾阶段号。
7. 关卡数据 `data/levels/newbee.json` 一般不用改（敌人由阶段机生成，`enemies` 为空）；只有需要新场景物件（墙/箱子）时才改。

### 6.3 在 Hub 新增一个可交互点（例：「排行榜」）

1. `newbee-hub.js:11-15` `HUB_INTERACTABLES` 加 `{ id:'leaderboard', x, y, label:'排行榜' }`。坐标须在 `knight-home.json` 的 world（1920×1920）内且玩家可走到。
2. `drawHubUI:403` 的 emoji 映射对象加 `leaderboard: '🏆'`（否则落到默认 `'🛒'`）。
3. 新增页面：在 `ui-runtime.js:306-310` 的 `drawUI` 分发加 `else if (this.menuScreen==='leaderboard') this.drawLeaderboard();`，页面绘制方法放到合适的 mixin（纯展示页归 ui-interaction，流程页归本分类），并在 `:254-274` 的文本池清理链加一条。
4. 若页面有按钮，在 `onUIPointer`（498-530）加 id 前缀分支。
5. 若只是打开已有页面（如 `weapon`），第 3、4 步不需要。
6. 可选：在 `knight-home.json` 的 `images`/`walls` 加对应场景美术，让交互点有视觉实体。

### 6.4 新增存档槽 / 改存档数量

1. 前端：`save-login.js:drawSaveSelectUI:83` 的 `slots` 数组加 `'save-4'`；同时检查 `cardW/gap`（103）与 `startX` 居中计算，4 张 420 宽卡 + 50 间距 = 1830，接近 1920 上限，超了要缩卡宽或改成两行。
2. 后端不需要改：`POST /api/players/:id` 会自动把新 id 追加进 `data/players/index.json`（`server.js:216-220`），`GET` 时随 metas 一起返回。
3. `data/players/index.json` 不用手改（除非要预置空档）。
4. 试玩侧同理走 `data/test-players/`，目录不存在会自动建（`server.js:91`）。
5. 若要支持删档：后端 DELETE 已实现（`server.js:222-226`），前端需新增按钮 + `onUIPointer` 分支 + `api.js` 调用。
6. `state.playerId` 默认 `'save-1'`（`main.js:16`、`save-flow.js:84`），新增槽不影响，但「新游戏」当前会**覆盖 `state.playerId` 指向的槽**（`startNewGame:36`）——如果要「新游戏必须选空槽」，改的是 `startNewGame`。

### 6.5 新增一个登录页按钮（例：「排行榜」）

1. `save-login.js:loginButtons`（136-156）的 `defs` 数组加 `{ id:'leaderboard', label:'排行榜' }`；需要条件显隐就加 `hidden: !xxx`（参考 `continue` 用 `ctx.state.hasAnySave`）。
2. `onLoginButtonClick`（12-26）加 `else if (id==='leaderboard') { ... }` 分支。若要交给外层处理，则在 `editor/level-flow.js:84-105` 的 ctx 回调里注册新的 `onXxx`，并在方法首行确保有 `const ctx = this.ctx;`（该方法已有）。
3. 布局自动：`y = 700 + i*(66+22)`，第 6 个按钮 y=1140 会超出 1080 —— 需要调 `startY`/`gap`（148）。
4. `data/ui/login.json` **不用改**（按钮是代码绘制，JSON 里只有 logo/标题/版本号）。
5. 文本对象池由 `drawLoginButtons:212-215` 按 id 自动回收，无需手动清理。

## 7. 坑与约束

1. **mixin 同名方法覆盖**：`game-scene.js:558` 的 `Object.assign` 按顺序装配 19 个 mixin，靠后的覆盖靠前的同名方法。本分类三个 mixin 的相对顺序是 `... SaveLoginMixin, NewbeeHubMixin, WorkshopMixin, DropsMixin, ProgressionMixin ...`，即**工坊会覆盖 save-login/newbee-hub 的同名方法，而 progression 会覆盖工坊的**。新增方法前先确认名字全局唯一（`ui-runtime.js:371` 有一条历史注释就是踩过重复副本的坑）。
2. **`const ctx = this.ctx;` 约定**：任何访问 `ctx`（`ctx.state`、`ctx.onXxx`、`ctx.redraw` 等）的 mixin 方法，**首行必须显式取一次**。漏写在运行时才 `ReferenceError`，`vite build` 检测不到。本分类现有范例：`save-login.js:13/34/60/137`、`progression.js:55/61`。`newbee-hub.js` 与 `workshop.js` 现在完全不碰 `ctx`（走 `this.player` / `saveSource()`），新增用到 `ctx` 的方法记得补。
3. **工坊命中区每帧重建**：`drawWorkshopUI:51-54` 把 `workshopDropZones` / `workshopItemRects` / `workshopCardRects` 全部重置、`workshopScrollArea` 重写。所有点击/落点逻辑**只能依赖当帧数据**，不要缓存 zone 引用；反过来，如果某帧没画（如卡片被裁剪 `:196 continue`）就不会有命中区。
4. **文本对象池必须每帧先隐藏再复用**：`drawWorkshopUI:33` 先把 `workshopTexts` 全 `setVisible(false)`，`ensure()` 再按需显示。新增文本一定走 `ensure(id,...)`，不要 `this.add.text` 直接建，否则切页残留。同理 `saveSelectTexts` / `loginLabels`。
5. **三套玩家数据不可混用**：`state.player`（正式+试玩）/ `state.previewPlayer`（编辑器预览）/ `state.trialPlayer`（快照，无运行时读取方）。读写一律通过 `saveSource()`，不要直接写 `ctx.state.player`。预览模式 `persistSave` 直接 return —— 预览里的加点和装备**不落盘**，测试时别以为丢数据是 bug。
6. **`saveSource()` 只区分预览与非预览**，不区分正式/测试存储；正式 vs 测试由 `state.saveStore`（`save-flow.js:19`）决定，试玩时 `startTrial` 会把它设成 `'test'` 并塞一个空测试玩家，退出试玩由 `editor/level-flow.js:169` 的快照恢复。
7. **新手关永不失败**：`player-combat.js:24 NEWBEE_MIN_HP=5` + `:30` 的 `floor`。所以在 newbee 关调试「死亡流程」永远不会触发，要测 `state='fail'` 得换关卡。
8. **跨分类 import 要留意**：`workshop.js` 依赖 `ui-runtime.js` 的 `WEAPON_SLOT_LEVELS`（`:10`）和 `progression.js` 的 `UPGRADE_STATS`（`:11`），还有 `combat/weapons.js` 的 `WEAPONS`、`ui/entity-art.js`、`ui-layer.js`、`state.js`。改这些导出会连带影响工坊页；`SLOT_UNLOCK_LEVELS`（player-data.js）与 `WEAPON_SLOT_LEVELS`（ui-runtime.js）是**两份同值副本**，改解锁等级要一起改。
9. **存档写入是异步且无节流**：`persistSave` → `onPlayerSave` → `saveStorePlayer(...).catch(()=>{})`（`editor/level-flow.js:105`）是 fire-and-forget。拖拽装备、连点加点会连发多个 POST，后到的响应可能对应先发的请求。新增高频写入路径（如拖动滑条实时保存）**必须自己做防抖/防重入**，并注意 `startNewGame:36` 同样不等待写完就切关。
10. **`openMenuScreen` 单页互斥**：`ui-runtime.js:384` 有 `if (this.editing || this.menuScreen) return;` —— 已经开着一个页时打不开第二个，且会把 `state` 从 `playing` 压成 `paused`（`:386`），关闭时恢复。因此工坊页里 `this.state !== 'playing'`，凡是写在 `state==='playing'` 分支里的 update 逻辑在工坊页**不执行**（这也是工坊长按/滚动要单独提到 `game-scene.js:144-147` 前置的原因）。
11. **工坊 pointerdown 会吞事件**：`editor-input.js:16` 里 `handleWorkshopPointerDown()` 返回 true 就直接 return，不再走 `onUIPointer`。新增工坊按钮时要确保它不落在 `workshopItemRects` / `workshopScrollArea`（且不在卡片上）区域内，否则永远点不到。
12. **`workshopScroll` 与 `workshopTab` 不随关页重置**，切出再进工坊仍保留上次滚动位置和页签；`workshopScroll` 的 `contentW` 硬编码在 3 处（`workshop.js:185`、`workshop.js:564`、`editor-camera.js:131`），改卡片尺寸必须同步。
13. **`data/players/save-1.json` 是旧结构**（含 `mods`/`modInventory`，缺 `equipment`/`loadout`）。`normalizePlayer` 会补默认值，所以不会崩，但别把它当作字段完整的样例，看 `DEFAULT_PLAYER`（`player-data.js:38-102`）。
14. **`data/test-players/` 目录当前不存在**，首次试玩存档写入才会创建；`listTestPlayers` 在目录缺失时返回空，`hasAnySave=false`，试玩登录页看不到「继续游戏」是正常现象。

## 8. 验证方式

```
npx vite build          # 基线：成功，约 65 modules transformed
node --test test/       # 基线：16 pass / 5 fail（5 个 fetch failed 需先起 server，属既有情况）
node server.js          # 起本地服务后再跑上面的 test，或用浏览器手测
```

改完本分类代码，按下面三条关卡链路手测（浏览器打开 dev server，编辑器里选关卡 → 试玩）：

| 关卡 | 验什么 | 必看现象 |
| --- | --- | --- |
| `data/levels/login.json` | 登录页 + 存档选择 | 5 个按钮悬停时白色平行四边形从左滑入、文字转黑；有存档时「继续游戏」出现；点「继续游戏」进存档页，卡片先显示「读取中…」再变成名称/等级/更新时间；空槽显示「存档 N · 空」且点不动；「返回登录界面」能回去；点有档的卡进 `knight-home` |
| `data/levels/knight-home.json` | Hub 交互 + 工坊页 | 三个 emoji 图标常显；走近 80px 内出现黄圈 + 玩家右侧平行四边形提示（F 键帽 + 标签）渐显，走开即消失；按 F 打开对应页；Hub 内无战斗 HUD、开火与举盾无效；工坊页：长按仓库物品 ~0.1s 出现跟手图标 + 来源格白框，拖到合法槽松手完成装备（旧物回仓、数量正确），拖到非法槽无变化；点 + 加点后属性条平滑增长、可用点数减 1；武器卡区域滚轮/横向拖拽可滚动且被 544..1856 裁剪（卡列表读 `weaponCatalog()`，未解锁卡上画锁、卡名/描边色来自设计稿）；**左上快照预览框**按住左键时当前主力武器自转 + 持续开火（子弹/光束模拟，中球绕环），松开停止并翻转自转方向；点未解锁出战槽弹「该槽位将在 12/30 级解锁」；关页再进工坊，滚动位置与页签保留 |
| `data/levels/newbee.json` | 新手引导全链 | 阶段 1：只有左键可用，2s 后出现「按『鼠标左键』射击」+ 鼠标图标；开火后提示淡出、隔约 2.5s 出「准心校准」提示；阶段 2：WASD 解禁，移动后约 7s 生成 3 只三角阵杂兵；阶段 3：清空后约 6s 右上出现 advanced2，开火被禁、提示改「按『空格』进行防御」；成功挡弹后开火解禁；击杀后停 3s 出结束提示与两个矩形（蓝「离开」/绿「练习」）；站进绿框刷 3 只怪（有 1.2s 冷却），站进蓝框淡出回 login；全程血量不低于 5、永不进失败态 |

存档落盘验证：工坊装备/加点后检查 `data/players/save-1.json`（正式流程）或 `data/test-players/save-1.json`（编辑器试玩）的 `equipment` / `points` / `combat` / `progress.points` 是否更新；编辑器「游戏预览」模式下这两个文件都**不应**变化。
