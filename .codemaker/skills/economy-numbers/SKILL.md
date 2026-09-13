---
name: economy-numbers
description: 改伤害公式 / 掉落规则 / 商店价格 / 加点成长 / 玩家存档字段 / 物品与改件数值 / 局内消耗品 / 药水 / 药水效果 / 药水掉落 / 限时武器 / 临时武器 / 即时护盾 / 局内商店 / 老虎机 / 老虎机权重 / 抽奖价格 / 商品价格 / 导表时读这份；覆盖 src/systems/economy/**（含 inner-shop / inner-shop-runtime / run-items / run-items-runtime / drops）、src/systems/ui/vendor-shop-art.js、src/player-data.js、state.js 的 ITEM_DEFS 与 MOD_DEFS。
---

# 数值_经济 开发指南

## 1. 这块负责什么

管「玩家变强 / 变弱的所有数字」以及数字的持久化。

功能边界：

| 属于本分类 | 不属于（去别的 skill） |
| --- | --- |
| 玩家伤害结算、免伤、闪避、暴击 | 子弹轨迹 / 发射节奏 / 激光判定 → combat skill |
| 改件（mod）生效集合计算 `activeMods` | 改件的视觉与弹道效果实现 → combat skill |
| 敌人掉落生成、拾取、武器补给 | 敌人 AI、寻路、生成波次 → combat / gameplay-systems skill |
| 局内商店（售货机）与神像祝福数值 | 售货机 / 神像的互动交互与 UI 绘制 → gameplay-systems / ui skill |
| 局内消耗品（药水）效果数值、药水队列容量 | 药水 / 限时武器的 HUD 状态图标、数字键 5 与滚轮守卫 → ui-interaction skill |
| 限时武器（临时武器）时长与替换规则、即时护盾数值 | 临时武器替换后的开火链路与护盾吸收判定 → combat skill |
| 武器商店 / 改件商店的价格与扣费 | 商店页面布局绘制 → ui skill |
| 工坊加点收益与上限 | 工坊拖拽交互、背包渲染 → gameplay-systems skill |
| 玩家存档 schema 与归一化 | 关卡 JSON schema（`normalizeLevel`）→ editor skill |

策划可调项（改这些不用碰逻辑）：

- `UPGRADE_STATS`（加点每点收益 `per` + 上限 `cap`）—— `src/systems/economy/progression.js:8`
- `IDOL_BUFFS` 神像祝福池 6 条 —— `src/systems/economy/buffs.js:13`
- 局内商店商品 / 价格 / 老虎机权重 —— **策划表格** `策划文档/server/{消耗品,武器,老虎机}.xlsx` → `node tools/export-tables.mjs` → `data/inner-shop.json`（不在代码里；旧的 `VENDOR_BUFFS` 已删除）
- 局内消耗品（药水）的效果类型 / 数值 / 时长、图标美术方案、「局内栏位」/「是否即时生效」—— **策划表格** `策划文档/server/消耗品.xlsx`（页签 `innerItemInfo`，效果三列在第 16~18 列）→ 重导（不在代码里）
- 药水队列容量 `POTION_CAP`、属性乘子换算 `statMul` —— `src/systems/economy/run-items.js:5` / `:11`
- `PICKUP_RADIUS` 金币/钻石拾取半径、`MAGNET_RADIUS` 吸附触发半径 —— `src/systems/economy/drops.js:10` / `:12`
- `SLOT_UNLOCK_LEVELS` 出战槽解锁等级 —— `src/player-data.js:17`
- `ITEM_DEFS` 物品表 12 条（改件 7 / 圣物 3 / 宠物 2）—— `src/state.js:27`
- `ENEMY_TYPES` 血量与伤害、`DEFAULT_DROPS` —— `src/state.js:7` / `src/state.js:14`
- 关卡掉落规则 `level.dropRules`（编辑器面板可视化编辑，落 `data/levels/*.json`）
- 商店价格 `prices` / `modPrices` —— **数据文件** `data/ui/weapon.json`，不在代码里
- 武器基础伤害 `baseDamage` —— `src/systems/combat/weapons.js`（详见 combat skill）

## 2. 文件地图

| 文件 | 职责 | 关键导出 | 行数 |
| --- | --- | --- | --- |
| `src/systems/economy/damage.js` | 玩家出手伤害 / 受伤减免 / 改件生效集合 | `playerDamage`、`playerIncomingDamage`、`activeMods` | 50 |
| `src/systems/economy/buffs.js` | 神像祝福池（仅当局，直改 `player.combat`）。`IDOL_BUFFS`/`IDOL_OFFER_COUNT` 为 live binding，由 `setIdolBuffs` 从 **`data/ui/idol-buffs.json`** 注入；每条为声明式 `stats`（`apply` 经 `makeApply` 生成，改 `maxHp` 自动同步 `player.maxHp`）。**旧的 `VENDOR_BUFFS` 已删除** | `IDOL_BUFFS`、`IDOL_OFFER_COUNT`、`setIdolBuffs` | 53 |
| `src/systems/economy/drops.js` | 掉落生成 / 飘散 / 吸附 / 拾取 / 武器补给；新增**药水掉落**（`item==='potion'` 分支 + `resolveDropPotionId`） | `DropsMixin`(6 方法)、`PICKUP_RADIUS`、`MAGNET_RADIUS` | 143 |
| `src/systems/economy/run-items.js` | 局内消耗品 / 限时加成**纯逻辑**（**无 Phaser**，可在 node 直跑）：队列容量、属性乘子换算、效果归一化、限时加成互逆乘算回退 | `POTION_CAP`(4)、`statMul`、`normalizeEffect`、`potionQueueAdd`、`potionQueueTakeFront`、`applyStatEffect`（6 个） | 63 |
| `src/systems/economy/run-items-runtime.js` | 局内消耗品 / 限时武器 / 即时护盾**运行时**（药水队列、使用、限时加成倒计时、临时武器替换与还原、美术预载） | `RunItemsMixin`(14 方法) | 210 |
| `src/systems/economy/progression.js` | 工坊加点 / 存档源与落盘（**`buyBuff` 与 `VENDOR_BUFFS` import 已删除**） | `ProgressionMixin`(3 方法：`applyUpgrade`/`saveSource`/`persistSave`)、`UPGRADE_STATS` | 53 |
| `src/systems/economy/inner-shop.js` | 局内商店 / 老虎机**纯逻辑**：取数与缓存、洗牌抽 4 件、按权重摇奖、**按名反查项目武器 id**（`reverseWeaponId`/`resolveWeaponId` 为模块内部函数，**未导出**）；新增**消耗品判定与效果/美术取值**（`isInstantItem`/`isPotionItem`/`getPotionList`/`findConsumable`/`getItemEffect`/`getItemArt`） | `SHOP_ITEM_COUNT`(4)、`LOTTERY_ROLL_MS`(2500)、`loadInnerShop`、`getInnerShopData`、`setInnerShopData`、`rollShopStock`、`rollLottery`、`isInstantItem`、`isPotionItem`、`getPotionList`、`findConsumable`、`getItemEffect`、`getItemArt`（导出 13 个） | 200 |
| `src/systems/economy/inner-shop-runtime.js` | 售货机运行时：开页 / 刷新商品 / 购买 / 摇奖与结算（**`addRunItem`/`addRunTimedWeapon` 已迁出到 `RunItemsMixin`**；入列武器 `id = String(item.weaponId || item.id)`） | `InnerShopMixin`(10 方法) | 143 |
| `src/systems/ui/vendor-shop-art.js` | 售货机图标解析：`(美术方案类型, 名称)` → 画板 design（三库：动态资产 / 轮廓 / 像素）+ 白/黑卡对比度变体 | `resolveArtRef`、`getArtRef`、`preloadArtRefs`、`invertDesign`、`drawShopIcon`、`isNearWhite`、`blackVariant`、`shopIconVariant`（8 个） | 182 |
| `data/inner-shop.json` | 导表生成物：`consumables[4]`（带 `effectType/effectValue/effectSec/artTypeInRun/artNameInRun`）/ `weapons[3]`（带 `weaponId`）/ `lottery{drawCost,goldPrize,kinds[4]}`；打包态的回退源 | — | 129 |
| `src/player-data.js` | 存档 schema + 归一化兼容层 | `normalizePlayer`、`DEFAULT_PLAYER`、`pointsEarnedForLevel`、`grantLevelUp`、`SLOT_UNLOCK_LEVELS`、`PLAYER_WEAPONS`、`PLAYER_VERSION` | 291 |
| `src/state.js` | 物品 / 改件 / 掉落物定义 + 掉落规则归一化；`DROP_ITEMS` 新增 `potion`、`normalizeDropRules`/`normalizeRewardList` 新增 `potionId` | `ITEM_DEFS`、`MOD_DEFS`、`DROP_ITEMS`、`DEFAULT_DROPS`、`ENEMY_TYPES`、`SCHEME_WEAPONS`、`WEAPON_LABELS`、`normalizeDropRules` | 608 |
| `src/systems/ui/screens.js` | 售货机页 / 武器商店 / 改件商店绘制与扣费 | `ScreensMixin`：`drawVendorShop`(22)、`buyWeapon`(747)、`buyMod`(769) | 995 |
| `src/systems/gameplay/workshop.js` | 工坊页：加点行渲染、装备装卸写存档 | `WorkshopMixin`：`workshopEquipItem`(453)、`workshopReplaceSlot`(420) | 585 |
| `src/systems/level/level-flow.js` | 存档 → 局内 `this.player` 组装、结算写回；`restart` 清零局内态（`runItems`/`runTimedWeapons`/`runEffects`/`tempWeaponActive`/`tempWeaponSaved`/`potionWheel`/`potionKeyHold`/`vendorActive`），`player.itemShields = []`，末尾 `preloadRunItemArt()` | `LevelFlowMixin`：`restart`(91)、`commitPlayer`(320)、`settleVictory`(331) | 387 |
| `src/editor/drop-rules-panel.js` | 编辑器掉落规则面板（种类/数量/概率） | `renderDropRules`、`bindDropRules` | 89 |
| `src/editor/player-panels.js` | 预览 / 试玩玩家属性表单；**改件区按「库存数量」配置**（通用改件→`items.stacks` 无上限，专属改件→`items.uniques` 每种最多 1），不再控制已装备槽 | `renderPreviewPlayer`、`renderTrialPlayer`、`bindPlayerPanels` | 172 |
| `src/editor/save-flow.js` | 正式档 / 测试档存储源切换 | `isTrialSaveStore`、`saveStorePlayer`、`loadStorePlayer` | 102 |
| `data/players/save-1.json` | 正式存档实体（`index.json` 记槽位列表） | — | 77 |
| `data/ui/weapon.json` | 武器商店价格表 `prices` / `modPrices` | — | JSON |
| `test/player-data.test.js` | 存档数值契约权威来源（16 用例） | — | 207 |

### 「改 X 该动哪个文件」速查

| 需求 | 动这里 |
| --- | --- |
| 改玩家打出的伤害公式（暴击倍率 / 攻击力如何叠乘） | `economy/damage.js:playerDamage`（14-21） |
| 改减伤 / 闪避结算顺序 | `economy/damage.js:playerIncomingDamage`（25-30） |
| 改加点每点给多少、点数上限 | `economy/progression.js:UPGRADE_STATS`（10-15） |
| 改神像祝福条目 / 数值 | **`data/ui/idol-buffs.json`**（`offerCount` = 每次出现几张；每条 `name/desc/icon/stats`，`icon` 为画板资产 id）；`buffs.js` 只做归一化注入 |
| 改局内商店商品 / 价格 / 老虎机权重 | **策划表格** `策划文档/server/{消耗品,武器,老虎机}.xlsx` → `node tools/export-tables.mjs`（开发期 server 按 mtime 实时解析，免重启；详见 §6.3） |
| 改售货机开页 / 刷新 / 购买 / 摇奖流程 | `economy/inner-shop-runtime.js:InnerShopMixin`（10 方法，见下） |
| 改局内消耗品 / 限时武器 / 即时护盾的**获得与生效**（药水队列 / 使用 / 限时加成倒计时 / 临时武器替换还原 / 护盾叠加） | `economy/run-items-runtime.js:RunItemsMixin`（14 方法，见下） |
| 改药水队列容量 / 属性乘子 / 效果归一化 / 限时加成回退 | `economy/run-items.js`（`POTION_CAP`/`statMul`/`normalizeEffect`/`potionQueueAdd`/`potionQueueTakeFront`/`applyStatEffect`） |
| 改商品抽取算法 / 老虎机出货判定 | `economy/inner-shop.js:rollShopStock`(72)、`rollLottery`(116) |
| 改消耗品判定 / 取效果与图标（即时类 / 药水 / 局内表现美术） | `economy/inner-shop.js:isInstantItem`、`isPotionItem`、`getPotionList`、`findConsumable`、`getItemEffect`、`getItemArt` |
| 改售货机图标解析（美术方案 → design） | `ui/vendor-shop-art.js:resolveArtRef`(59)、`drawShopIcon`(102) |
| 改售货机页面绘制（卡片 / 翻牌 / 老虎机） | `ui/screens.js:drawVendorShop`(22)（详见 ui-interaction skill） |
| 改武器 / 改件商店价格 | `data/ui/weapon.json` 的 `prices` / `modPrices`（**不改代码**） |
| 改敌人掉什么、掉几个、爆率 | 关卡 `dropRules`（编辑器面板，掉落种类含 金币/经验/充能球/钻石/**药水**）→ 逻辑在 `economy/drops.js:spawnDrops`（15-39） |
| 改药水掉落指定 id / 随机兜底 | `economy/drops.js:resolveDropPotionId`（配了 `potionId` 且仍在 `getPotionList()` 内才用，否则随机）；`collectDrop` 的 `d.type==='potion'` 分支 |
| 改金币/钻石/药水吸附 / 拾取半径与飘散 | `economy/drops.js:PICKUP_RADIUS`(10)、`MAGNET_RADIUS`(12)、`spawnDropItems`(41)、`updateDrops`(89) |
| 新增 / 修改物品、改件、圣物、宠物 | `state.js:ITEM_DEFS`（25-43），`MOD_DEFS` 自动派生 |
| 新增存档字段 | `player-data.js:DEFAULT_PLAYER` + `normalizePlayer` + `test/player-data.test.js` |
| 改出战槽解锁等级 | `player-data.js:SLOT_UNLOCK_LEVELS`(17) **和** `systems/ui/ui-runtime.js:WEAPON_SLOT_LEVELS`(21)（两份重复常量！） |
| 改武器基础伤害 / 弹量 | `systems/combat/weapons.js` 的 `baseDamage` / `maxAmmo`（详见 combat skill） |

> `InnerShopMixin`（`economy/inner-shop-runtime.js`，**10 方法**，`addRunItem`/`addRunTimedWeapon` 已迁出）：`openVendorShop` / `ensureVendorStock` / `setupVendorStock` / `preloadVendorArt` / `getVendorStock` / `isVendorBought` / `buyVendorItem` / `rollVendorSlot` / `updateVendorSlot` / `settleVendorRoll`。（`buyVendorItem`/`settleVendorRoll` 里的 `this.addRunItem(...)`/`this.addRunTimedWeapon(...)` 调用语句**未改**，靠原型解析到 `RunItemsMixin`。）
> `RunItemsMixin`（`economy/run-items-runtime.js`，**14 方法**，方法名冻结）：`addRunItem` / `addRunTimedWeapon` / `getRunPotions` / `getFrontPotion` / `getTempWeapon` / `getRunEffects` / `usePotionAt` / `useFrontPotion` / `toggleTempWeapon` / `isTempWeaponActive` / `useTempWeapon` / `cancelTempWeapon` / `updateRunItems` / `preloadRunItemArt`。
> `inner-shop.js` 导出（**13 个**）：`SHOP_ITEM_COUNT`(=4) / `LOTTERY_ROLL_MS`(=2500) / `loadInnerShop` / `getInnerShopData` / `setInnerShopData` / `rollShopStock` / `rollLottery` / `isInstantItem` / `isPotionItem` / `getPotionList` / `findConsumable` / `getItemEffect` / `getItemArt`。`reverseWeaponId` / `resolveWeaponId` 为**模块内部函数（未导出）**，仅在本文件内给武器卡片补 `weaponId`（显式 `weaponId` 优先，否则按 `name` 反查 `weaponCatalog()`）。

## 3. 核心数据结构

### 3.1 玩家存档 schema（`data/players/save-*.json`）

顶层由 `normalizePlayer`（`player-data.js:230-290`）逐字段重建，**输出结构固定 12 个键**：
`version / meta / progress / currency / weapons / loadout / playedNewbee / combat / points / items / equipment / levels`。
输入里的任何未知键（例如老档里的 `mods`、`modInventory`、`currency.charge`）都会被**静默丢弃**。

| 字段 | 类型 | 取值范围 | 默认 | 归一化规则（`player-data.js` 行） |
| --- | --- | --- | --- | --- |
| `version` | number | 恒等于 `PLAYER_VERSION` | `1` | 238，无条件覆写为 1 |
| `meta.name` | string | 任意非空 | `'新存档'` | 240，空值回退 |
| `meta.createdAt` / `updatedAt` | number(ms) | ≥0 | `0` | 241-242，`Number()||0` |
| `meta.playTimeSec` | int | ≥0 | `0` | 242，`max(0, floor)` |
| `progress.level` | int | **≥1** | `1` | 245，`max(1, floor)` |
| `progress.exp` | int | ≥0 | `0` | 246 |
| `progress.expToNext` | int | **≥1** | `100` | 247，非有限数回退 100，再 `max(1)` |
| `progress.points` | int | ≥0（可分配升级点） | `0` | 248 |
| `currency.gold` | int | ≥0 | `0` | 251，`max(0, floor)` |
| `currency.gems` | int | ≥0 | `0` | 289，`max(0, floor)`；钻石货币：局内拾取钻石累加 `player.gems`，通关 `settleVictory` 写回；商店页展示，**暂无消费** |
| `weapons[w].unlocked` | bool | — | `radial:true`，其余 `false` | 256-258，缺省时查 `DEFAULT_UNLOCKED_WEAPONS` |
| `weapons[w].enhance` | int[3] | 每项 0/1 | `[0,0,0]` | 259 → `normalizeEnhance`(198)，兼容数组与 `{0:1}` 对象 |
| `loadout` | string[3] | 槽0 恒 `'radial'`，槽1/2 为武器 id 或 `''` | `['radial','','']` | 262 → `normalizeLoadout`(133)，去重、越界截断、非法回退空串 |
| `playedNewbee` | bool | — | `false` | 263 |
| `combat.moveSpeed` | number | **≥0.1**（倍率，1=100%） | `1` | 265 |
| `combat.attackPower` | number | ≥0（倍率） | `1` | 266 |
| `combat.critRate` | number | **0~1**（暴击伤害 ×2） | `0` | 267 → `clampPercent`(212) |
| `combat.attackSpeed` | number | **≥0.1**（倍率） | `1` | 268 |
| `combat.maxHp` | int | **≥1** | `100` | 269 |
| `combat.maxShield` | int | ≥0 | `50` | 270 |
| `combat.damageReduction` | number | **0~1**（乘算，1=不减伤） | `1` | 271 → `clampPercent` |
| `combat.dodgeRate` | number | 0~1 | `0` | 272 |
| `points.{maxHp,maxShield,attackPower,attackSpeed}` | int | ≥0，**恰好 4 键** | 全 `0` | 274 → `normalizePoints`(187)，其余键丢弃 |
| `items.stacks` | `{itemId:int}` | 数量 >0；id 必须在 `ITEM_DEFS` | `{}` | 276 → `normalizeStacks`(104)，未知 id / ≤0 丢弃 |
| `items.uniques` | `[{uid,itemId}]` | 仅 `stackable===false` 的物品，**同 id 最多 1 个** | `[]` | 277 → `normalizeUniques`(115)，缺 `uid` 自动生成 `u-<id>-<ts>-<i>` |
| `equipment.weaponMods[w].generic` | string[] | 只收 `category==='mod' && weapon===''`，去重 | `[]` | 280 → `normalizeWeaponMods`(147) |
| `equipment.weaponMods[w].dedicated` | string[] | 只收 `category==='mod' && weapon===w`，去重，上限 `getWeaponCaps(w).dedicated`；兼容旧单值 `dedicated:'id'`（归一化为 `['id']`） | `[]` | 176-184 → `normalizeWeaponMods` |
| `equipment.relics` | string[] | `category==='relic'`，去重，**上限 3** | `[]` | 281 → `normalizeItemList`(172) |
| `equipment.pets` | string[] | `category==='pet'`，去重，**上限 2** | `[]` | 282 |
| `levels.unlocked` / `completed` | string[] | 关卡 id，去重 | `['level-1']` / `[]` | 285-286 → `uniqueStrings`(224) |
| `levels.current` | string | 关卡 id | `'level-1'` | 287 |

局内运行时对象 `this.player`（`level-flow.js:200-249`）**不是存档结构**，是存档 + 关卡 `spawn` 的合体，额外有：
`hp/shield/ammo/weaponCharge/weaponType/weaponAngle/gold/gems/spendablePoints/exp/level` 等扁平字段。
映射关系：`progress.level→player.level`、`progress.exp→player.exp`、`progress.points→player.spendablePoints`、
`currency.gold→player.gold`、`currency.gems→player.gems`、`combat→player.combat`（同一引用，局内 buff 会改它）。

### 3.2 ITEM_DEFS 与派生关系（`state.js:25-50`）

`ITEM_DEFS` 共 **12 条**，字段：`name` / `category`（mod|relic|pet）/ `stackable` / `weapon`（改件专属武器，`''`=通用）/ `color` / `icon`（可选，画板资产 id，有则工坊用 `renderAsset` 渲染动态图标，如三发/多轨改件）/ `effect`（悬停 tip 的效果文案，如「一次射出 3 发扇形弹道」）。

| id | 名称 | category | stackable | weapon | 进哪个存档字段 |
| --- | --- | --- | --- | --- | --- |
| `multi-track` | 多轨改件 | mod | true | `''` | `items.stacks` → 任意武器 `generic` |
| `spin` | 转速改件 | mod | true | `''` | 同上 |
| `triple` | 三发改件 | mod | true | `''` | 同上 |
| `ricochet` | 反弹改件 | mod | false | `yellow` | `items.uniques` → `weaponMods.yellow.dedicated` |
| `split` | 分裂改件 | mod | false | `yellow` | 同上 |
| `capacity` | 容量改件 | mod | false | `green` | `weaponMods.green.dedicated` |
| `pierce` | 穿透改件 | mod | false | `green` | 同上 |
| `relic-vitality` | 生命圣物 | relic | true | `''` | `items.stacks` → `equipment.relics`（≤3） |
| `relic-power` | 力量圣物 | relic | true | `''` | 同上 |
| `relic-haste` | 迅捷圣物 | relic | true | `''` | 同上 |
| `pet-ember` | 焰尾 | pet | false | `''` | `items.uniques` → `equipment.pets`（≤2） |
| `pet-moss` | 苔团 | pet | false | `''` | 同上 |

派生表：

| 派生物 | 来源 | 结果 |
| --- | --- | --- |
| `MOD_DEFS`（`state.js:46`） | `ITEM_DEFS` 过滤 `category==='mod'` | 7 条 `{id:{name,weapon}}`，保留旧字段形态 |
| `DROP_ITEMS`（`state.js:16`） | 手写 | `{gold:'金币', exp:'经验', charge:'充能球', diamond:'钻石'}`，掉落规则/宝箱奖励下拉框数据源 |
| `SCHEME_WEAPONS`（`state.js:316`） | 手写 | 美术方案 → 武器类型：`default→basic`、`hex-ring→radial`、`yellow→yellow`、`green→green` |
| `WEAPON_LABELS`（`state.js:18`） | 手写 | `radial:'基础'`、`yellow:'散射'`、`green:'激光'`，商店里显示「专属·散射」用 |

掉落规则条目结构（`state.js:normalizeDropRules` 83-97），按敌人类型分组：

| 字段 | 类型 | 归一化 |
| --- | --- | --- |
| `item` | `'gold'\|'exp'\|'charge'\|'diamond'` | 不在 `DROP_ITEMS` 里则回退 `'gold'` |
| `count` | int ≥0 | `max(0, floor)` |
| `chance` | 0~100（百分数） | `min(100, max(0, n))` |
| `weapon` | string | 仅 `item==='charge'` 且是合法武器时保留，否则 `''`（=为所有可充能武器各掉一份） |

### 3.3 局内商店 / 老虎机数据

`data/inner-shop.json`（`tools/export-tables.mjs` 生成；顶层 `generatedAt` + 三块）：

| 块 | 结构 |
| --- | --- |
| `consumables[]` | `{ id, name, desc, cost, artType, artName, instant, inLottery, slot, effectType, effectValue, effectSec, artTypeInRun, artNameInRun }` —— 4 条（见 §5）。后 5 字段由 `parseConsumables` 从表列 `效果类型/效果数值/效果时长` + `美术方案类型（局内表现）`/`美术方案名称（局内表现）` 读入（**当前 4 行「局内表现」两列全为空**） |
| `weapons[]` | `{ id, weaponId, name, cost, durationSec, inLottery }` —— 只含「是否加入局内临时=1」的行：`101 散射` / `102 激光` / `103 地狱火霰弹枪`。**`weaponId` 为项目武器 id**（导表 `loadWeaponNameIndex` 读 `data/weapons/*.json` 按 `name` 交叉引用：`101→yellow` / `102→green` / `103→weapon-1788012926999`）；`""` 表示该武器名未在项目中匹配到武器设计（商店只显示背景盘） |
| `lottery` | `{ drawCost:15, goldPrize:15, kinds[]:{ key, name, weight, artType, artName } }` —— 4 类，权重 `武器5 / 护盾10 / 金币15 / 垃圾15`（单位 %，合计 45，剩余 55% 走完全随机） |

`inner-shop.js` 内部会把消耗品 / 武器统一转成商店卡片：消耗品 `{ kind:'consumable', id, weaponId:'', name, desc, cost, artType, artName }`，武器 `{ kind:'weapon', id, weaponId, name, desc:'', cost, artType:'', artName:'', durationSec }`（武器的 `weaponId` 由 `resolveWeaponId` 反查获得；美术复用商城武器卡，故美术字段留空）。

局内运行时字段（**挂在 scene / 售货机实体上，不落存档**）：

| 字段 | 结构 | 说明 |
| --- | --- | --- |
| `scene.runItems` | `[{ id, count }]` | **局内药水队列**，≤ `POTION_CAP`(4)，同 id 叠加 `count`；随 `level-flow.restart` 清零。满 4 且新 id → `potionQueueAdd` 返回 false（丢弃新获得的） |
| `scene.runTimedWeapons` | `[{ id, name, durationSec, remainSec }]` | 局内限时武器，**≤ 1 把**（新的直接替换旧的）；**仅「使用中」才扣 `remainSec`**；随 `restart` 清零。**`id` = 项目武器 id**（如 `yellow`，由 `addRunTimedWeapon` 写入 `String(item.weaponId || item.id)`），**非表格编号** |
| `scene.runEffects` | `[{ id, name, artType, artName, effect:{type,value,sec}, remainSec, totalSec }]` | 限时加成条目（HUD 状态图标来源），到期 `applyStatEffect(...,-1)` 精确回退并移除；随 `restart` 清零 |
| `scene.tempWeaponActive` | bool | 临时武器是否「使用中」（数字键 5 切换）；随 `restart` 置 false |
| `scene.tempWeaponSaved` | `{ weaponType, weapon, weaponArt, scheme, weaponIndex, charge } \| null` | 使用临时武器时保存的主武器态，取消/到期时写回 `player`；随 `restart` 置 null |
| `scene.vendorActive` | 实体引用 \| null | 当前打开页面对应的售货机；`openVendorShop` 写入，`restart` 置 null |
| `vendor.stock` | `ShopCard[]` | per 实体，只抽一次、本关内持久（换实体各自独立） |
| `vendor.bought` | `Set<number>` | 已购下标，限购 1 次 |
| `vendor.slot` | `{ icons[3], prize, rolling, rollAt, settleAt, prizeAt, granted }` | 老虎机三窗与结算状态 |

> **不落存档**：`state.player` 本身就是存档源（`progression.js:persistSave` → `ctx.onPlayerSave`），往上加字段会被写进存档；故这些局内字段一律挂 scene / 实体，随 `level-flow.restart` 清零。

老虎机判定（`inner-shop.js:rollLottery`）：先按权重累加区间判「直接出货」（命中则三个窗口同款）；未命中则 3 窗各自等概率 4 选 1；三窗同款才发奖；`settleAt = rollAt + LOTTERY_ROLL_MS(2500)`；中奖卡展示 1800ms（`screens.js` 侧）。

### 3.4 局内消耗品（药水）/ 限时加成 / 即时护盾

**判定（`inner-shop.js`）**：`isPotionItem(c)` = `!instant && slot === 1`（进药水队列）；`isInstantItem(c)` = `instant === true`（获得即生效、**不进**药水槽位）；`getItemEffect(c)` → `{ type, value, sec }`（`normalizeEffect` 兜底）；`getPotionList()` 数据未就绪时返回 `[]`。

**效果语义（`run-items.js:applyStatEffect(combat, type, mul, dir)`，`mul = statMul(value) = 1 + value/100`）**：

| `type` | 语义 | 是否进 `runEffects`（限时） | 回退 |
| --- | --- | --- | --- |
| `heal` | 立刻 `hp = min(maxHp, hp + value)`（封顶 `player.maxHp`） | 否（无图标） | 无 |
| `shield` | 立刻 `player.itemShields.push({ hp: value, maxHp: value })` | 否 | 无 |
| 空（`''`） | `applyStatEffect` 直接跳过 | — | — |
| **其余任意非空 type** | **视为 `player.combat` 上的字段名**（如 `attackPower`/`moveSpeed`），`dir=1` 乘 `mul`、`dir=-1` 乘 `1/mul` | `sec > 0` → 进 `runEffects`（HUD 图标）；`sec === 0` → 本局永久，生效但**不入 `runEffects`** | `sec > 0` 到期 `applyStatEffect(..., -1)` 精确回退；`sec === 0` 无回退 |

> **`heal` / `shield` / 空 type 一律跳过 `applyStatEffect`**（不走乘算），由 `run-items-runtime.js` 的 `addRunItem` / `usePotionAt` 直接处理。

**消耗品表当前 4 行**（表格驱动，改表即可生效；见 §5）：

| 编号 | 名称 | 图标（类型 / 名称） | 局内栏位 | 是否即时生效 | 效果类型 | 效果数值 | 效果时长 | 进 `runEffects` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1000001 | 恢复药水 | 像素 / 恢复图标 | 1 | — | `heal` | 25 | 0 | 否 |
| 1000002 | 力量药水 | 动态资产 / 攻击力加成图标 | 1 | — | `attackPower` | 25 | 60 | 是 |
| 1000003 | 即时护盾 | 轮廓 / 即时护盾图标 | — | 1 | `shield` | 50 | 0 | 否 |
| 1000004 | 速度药水 | 动态资产 / 速度加成图标黑色 | 1 | — | `moveSpeed` | 25 | 30 | 是 |

> **占位待策划确认**：速度药水 `30s`（描述未写时长）、即时护盾护盾量 `50`（对齐 `SHIELD_MAX`）。
> HUD 侧另有 `scene.potionWheel` / `scene.potionKeyHold` / `scene.potionWheelText`（药水轮盘与按键长按），**详见 `ui-interaction`**。

## 4. 关键流程

### 4.1 玩家出手 → 敌人扣血

```
game-scene.js:246  activeMods(this, player.weaponType)      // 转速改件影响炮口转速
combat/weapons.js:207  activeMods(scene, weaponType).has('pierce')  // 穿透改件影响激光
game-scene.js:369  e.hp -= playerDamage(this, b.weaponType)
  └─ economy/damage.js:14 playerDamage
       base = WEAPONS[weaponType].baseDamage ?? BULLET_DAMAGE(10)
       dmg  = base * (combat.attackPower ?? 1)
       if (random < combat.critRate) dmg *= 2      // 暴击固定 2 倍
     → 无 combat 时直接返回 BULLET_DAMAGE(10)
game-scene.js:371  e.hp <= 0 → defeatEnemy → 掉落（见 4.3）
```

注意：`attackSpeed` **不在 damage.js 里生效**，它作用于武器射速（`fireInterval`），详见 combat skill。

### 4.2 玩家受伤链路

```
combat/player-combat.js:31 damagePlayer(dmg)
  └─ economy/damage.js:25 playerIncomingDamage
       if (random < combat.dodgeRate) return 0        // 闪避先判，命中即完全免伤
       return dmg * (combat.damageReduction ?? 1)     // 乘算，0.9 = 少受 10%
  └─ 即时护盾吸收（在 playerIncomingDamage 之后、扣 HP 之前）：
       remaining = actual；按 player.itemShields 数组顺序 absorbed = min(sh.hp, remaining)
       sh.hp<=0 → splice 移除 + hitEffects.push({color:SHIELD_HIT_COLOR}) + cameras.main.shake(SHIELD_SHAKE_MS, SHIELD_SHAKE_INTENSITY)
       remaining<=0 → 不扣 HP、不置 hitFlash，直接 return（playerIncomingDamage **只调用一次**）
  actual <= 0 → 直接 return（闪避不触发受击闪屏）
  player.hp = max(floor, hp - actual)，floor = 新手关 5 / 其他 0
  hp <= 0 → state='fail'
combat/player-combat.js:51 blockWithShield 也走同一函数，扣 shield 而非 hp
  兜底：`playerIncomingDamage(...) || damage || 0`，闪避时护盾仍按原始值扣
```

> 即时护盾（`player.itemShields`）吸收在 `playerIncomingDamage` 之后、扣 HP 之前；`damagePlayer` 是玩家受伤的**唯一入口**，故护盾在此一处即覆盖全部来源，但**不参与**闪避/免伤（详见 combat skill §7）。

### 4.3 敌人死亡 → 掉落 → 拾取

```
combat/enemy-ai.js:269  this.spawnDrops(e)
  └─ economy/drops.js:15 spawnDrops
       优先 ctx.state.level.dropRules[e.type]（关卡级规则）
         每条：random*100 >= rule.chance → 跳过
         item==='charge' 且未指定 weapon → 对 player.weaponCharge 每把武器各判 have<need
         item==='potion' → resolveDropPotionId(rule.potionId) 定 id（配了就配、且在 getPotionList() 内；否则随机；列表空 → 空串）
       无规则时回退敌人个体 e.drops = {gold, exp, diamond(默认0)}（**个体掉落不支持药水**）
  └─ drops.js:41 spawnDropItems(e,type,count,weapon,potionId)：±15px 随机散点 + 飘散速度（gold/diamond 10/1000ms，其他 20/600ms）
economy/drops.js:89 updateDrops(dt)  每帧
  drift.ttl > 0 → 只飘散不吸附
  gold / diamond / potion：距离 < PICKUP_RADIUS(26) 拾取；≤ MAGNET_RADIUS(90) 时以 800 px/s 吸向玩家
  exp / charge：以 800 px/s 吸附向玩家，距离 < step 即拾取
economy/drops.js:58 collectDrop
  exp    → player.exp += 1，随后 commitPlayer() 立即写回存档
  charge → weaponCharge[w].have++ → tryRefillWeapon(76)：ammo<=0 且 have>=need 时 have=0、ammo=WEAPONS[w].maxAmmo
  gold   → player.gold += 1（**局内累加，不落盘**）
  diamond→ player.gems += 1（**局内累加，不落盘**）
  potion → this.addRunItem(d.potionId, 1)（**进药水队列 / 即时类立刻生效**，见 §4.7）
level-flow.js:287 settleVictory：通关时 p.currency.gold/gems = player.gold/gems，再 persistSave
```

### 4.4 升级 → 点数 → 工坊加点 → 属性生效

```
player-data.js:25 grantLevelUp(player)      progress.level+1、progress.points+1
player-data.js:20 pointsEarnedForLevel(lv) = max(0, floor(lv) - 1)   // 校验/补偿用
level-flow.js:244  spendablePoints = savedProgress.points     // 存档 → 局内
workshop.js:119    keys = Object.keys(UPGRADE_STATS)          // 渲染 4 行属性 + 进度条(spent/cap)
ui-runtime.js:  点 + 按钮 → applyUpgrade(key)
  └─ economy/progression.js:29 applyUpgrade
       守卫：spendable<=0 或 points[key] >= cfg.cap → return
       player.points[key]+1；player.spendablePoints-1
       player.combat[key] += cfg.per
       maxHp/maxShield 额外同步 player.maxHp / player.maxShield（HUD 血条读扁平字段）
       写回 source：combat / points / progress.points → persistSave(source)
下局开局 level-flow.js:181  maxHp = combat.maxHp，属性生效
```

`UPGRADE_STATS` 是 `progression.js` 的**模块私有 const，未导出**，但 `workshop.js:119/121` 直接引用了同名标识——说明该常量靠 mixin 合并后的作用域拿不到，实际是 `workshop.js` 未 import 的**隐式全局引用**（运行时若 workshop 页渲染报 `UPGRADE_STATS is not defined`，改动加点表时优先检查这里；同理 `WEAPON_SLOT_LEVELS`、`PLAYER_ART`、`drawHexRingPlayer` 在 `workshop.js` 也无 import）。

### 4.5 金币获取 → 购买 → 扣费写回

四个购买 / 抽奖入口，扣的钱不是同一份：

| 入口 | 函数 | 钱从哪扣 | 价格来源 | 落盘 |
| --- | --- | --- | --- | --- |
| 局内商店（售货机买商品） | `inner-shop-runtime.js:95 buyVendorItem` | `this.player.gold`（局内） | `data/inner-shop.json` 的 `consumables/weapons[].cost` | **不落盘**，`vendor.bought` Set 限购 1 次 |
| 老虎机摇奖 | `inner-shop-runtime.js:111 rollVendorSlot` | `this.player.gold`（局内） | `lottery.drawCost`（15） | **不落盘**，`vendor.slot` 记三窗与结算 |
| 武器商店 | `screens.js:747 buyWeapon` | `source.currency.gold`（存档） | `data/ui/weapon.json:prices` | `persistSave(source)` |
| 改件商店 | `screens.js:769 buyMod` | `source.currency.gold` | `data/ui/weapon.json:modPrices` | `persistSave(source)` |

```
interactables.js:247 售货机 F 键 → this.openVendorShop(nearest)
  openVendorShop(v)     vendorActive=v; vendorView=null（重播入场翻牌）; ensureVendorStock(v); openMenuScreen('vendor')
  ensureVendorStock(v)  已刷过则跳过；数据未就绪 → loadInnerShop() 异步补刷（页面持续显示「加载中…」）
    └ setupVendorStock(v,data)  v.stock = rollShopStock(data)（消耗品4+武器3 = 7 选 4 不重复，每实体只 roll 一次）
                                v.bought = new Set() ; preloadVendorArt(stock, data)
  buyVendorItem(i)      已购 / 钱不够 → false；player.gold -= cost → v.bought.add(i)
                        → kind==='weapon' ? addRunTimedWeapon : addRunItem(item.id,1) → syncUIState
  rollVendorSlot()      自愈过期 rolling → 扣 drawCost → v.slot={icons,prize,rolling:true,rollAt:now,settleAt:rollAt+2500,prizeAt:0,granted:false}
  updateVendorSlot()    每帧（game-scene.js:819）；now>=settleAt → settleVendorRoll()
  settleVendorRoll()    幂等：rolling=false / prizeAt=now / granted=true → 发奖
                        （weapon→addRunTimedWeapon；consumable→addRunItem；gold→player.gold += goldPrize；trash|none 不发）
buyWeapon(t)  source.currency.gold -= price → source.weapons[t].unlocked = true
              同步 player.gold / player.weapons.push / player.ammo[t] = WEAPONS[t].maxAmmo
buyMod(id)    stackable → source.items.stacks[id]++；否则 uniques.push({uid:`u-${id}`, itemId})
              已有 unique 则 return（不扣钱）→ 扣钱 → 同步 player.items → persistSave
神像祝福      interactables.js:191 openIdolOffer 洗牌 IDOL_BUFFS 按 IDOL_OFFER_COUNT 取前 n 张
              interactables.js:212 chooseIdolBuff → buff.apply(this)（免费，idol.used=true，仅当局）
```

**`player.gold` 是局内金币**，通关由 `level-flow.js:331 settleVictory` 写回存档 `currency.gold`；中途退出这局花掉 / 抽掉的钱不落盘。

### 4.6 存档读写链路（三套玩家数据）

```
saveSource()   progression.js:54   isPreviewMode() ? ctx.state.previewPlayer : ctx.state.player
persistSave(s) progression.js:60   editing || isPreviewMode() || !s → 直接丢弃
                                   否则 ctx.onPlayerSave?.(s)
onPlayerSave   editor/level-flow.js:105 → hooks.saveStorePlayer(state.playerId, player)
saveStorePlayer editor/save-flow.js:25   saveStore==='test' ? saveTestPlayer : savePlayer
                                        → data/test-players/*.json 或 data/players/*.json
commitPlayer   level-flow.js:258   只写 progress.level / exp / expToNext（拾 exp 时调用）
settleVictory  level-flow.js:287   写 currency.gold/gems + levels.completed/current（通关时调用）
```

| 数据 | 变量 | 何时用 | 写回 |
| --- | --- | --- | --- |
| 正式档 | `state.player` | `mode==='trial'` 实机流程（`saveStore==='formal'`） | 写 `data/players/` |
| 试玩档 | `state.player` + `saveStore==='test'` | 编辑器「试玩」（`save-flow.js:76 startTrial`） | 写 `data/test-players/`，**不碰正式档** |
| 试玩快照 | `state.trialPlayer` | `save-flow.js:61` 选档时克隆留底、`main.js:28` 初始化 | 不写回 |
| 预览档 | `state.previewPlayer` | `mode==='play'` 游戏预览（`main.js:21-26`，预置 5 点 + 若干物品） | **永不写回**（`persistSave` 早退） |

### 4.7 获得 / 使用局内消耗品与限时武器

```
inner-shop-runtime.js:buyVendorItem / settleVendorRoll
  kind==='weapon'     → this.addRunTimedWeapon(item)   // 调用语句未改，靠原型解析到 RunItemsMixin
  kind==='consumable' → this.addRunItem(item.id, 1)     // 同上
economy/run-items-runtime.js:addRunItem(id, count=1)
  isInstantItem → 立刻生效：heal → 回血封顶 player.maxHp；shield → player.itemShields.push({hp:value,maxHp:value})；其余 type → applyStatEffect(combat,type,mul,1)
  非即时且是药水 → potionQueueAdd(runItems,id,count)（满 4 且新 id → false）
  非药水且非即时 → false
usePotionAt(index) / useFrontPotion()
  heal/shield → 立刻；type+sec>0 → applyStatEffect 生效 + push runEffects；type+sec===0 → 生效不入 runEffects；随后从队列移除
toggleTempWeapon()（数字键 5）
  未使用 → useTempWeapon()：保存主武器态到 tempWeaponSaved，换 player.weapon/weaponType/weaponArt/scheme = WEAPONS[id]，ammo[id] 缺省补 `maxAmmo ?? Infinity`，player.charge 归零
  使用中 → cancelTempWeapon()：把 tempWeaponSaved 写回 player
updateRunItems(dt)（game-scene.js:update 内，战斗处理之后）
  runEffects 倒计时到期 → applyStatEffect(...,-1) 回退并移除
  临时武器**仅「使用中」**扣 remainSec，归零自动 cancelTempWeapon() 且清空 runTimedWeapons
preloadRunItemArt()  loadInnerShop().then(→ preloadArtRefs(药水的 getItemArt()))
```

> `addRunTimedWeapon(item)` 只保留 1 把（直接替换旧的）；替换时若正「使用中」先 `cancelTempWeapon()`。`useTempWeapon` 若 `WEAPONS[id]` 尚未注册会 `ensureWeaponDef(id)` 异步补拉后自动重试一次（临时武器开火链路详见 combat skill）。

## 5. 关键常量与数值

| 常量 / 配置项 | 位置 | 当前值 | 含义 | 调它影响什么 |
| --- | --- | --- | --- | --- |
| `UPGRADE_STATS.maxHp` | `economy/progression.js:11` | `per:20, cap:10, label:'生命'` | 每点 +20 生命，最多 10 点 | 满加点 +200 HP；同步改 `player.maxHp` |
| `UPGRADE_STATS.maxShield` | `progression.js:12` | `per:10, cap:10` | 每点 +10 护盾 | 满加点 +100 护盾 |
| `UPGRADE_STATS.attackPower` | `progression.js:13` | `per:0.1, cap:10` | 每点 +0.1 倍率，显示 `(v-1)*100%` | 满加点 = 攻击 ×2 |
| `UPGRADE_STATS.attackSpeed` | `progression.js:14` | `per:0.08, cap:10` | 每点 +0.08 倍率 | 满加点 +80% 射速（作用于 `fireInterval`） |
| `IDOL_BUFFS[0]` atk | `economy/buffs.js:11` | `attackPower *= 1.15` | 力量祝福 攻击 +15% | 乘算，可与加点叠乘 |
| `IDOL_BUFFS[1]` crit | `buffs.js:12` | `critRate += 0.1` | 致命祝福 暴击 +10% | 加算；暴击伤害恒 ×2 |
| `IDOL_BUFFS[2]` dodge | `buffs.js:13` | `dodgeRate += 0.08` | 迅捷祝福 闪避 +8% | 加算，闪避完全免伤 |
| `IDOL_BUFFS[3]` speed | `buffs.js:14` | `moveSpeed *= 1.12` | 疾风祝福 移速 +12% | 乘算 |
| `IDOL_BUFFS[4]` hp | `buffs.js:15` | `maxHp += 25`（同步 `player.maxHp`） | 生命祝福 上限 +25 | **只加上限不回血** |
| `IDOL_BUFFS[5]` reduction | `buffs.js:16` | `damageReduction *= 0.9` | 守护祝福 受伤 -10% | 乘算，多层可叠 |
| 神像三选一池大小 | `level/interactables.js:190-196` | 洗牌后 `slice(0, IDOL_OFFER_COUNT)` | 池 = `buffs` 条数，张数 = `offerCount`（默认 3） | 加祝福 / 改张数就自动进池 |
| 消耗品售价 | `data/inner-shop.json` `consumables[].cost` | 4 条各 `25` | 局内金币 | 改表格 `消耗品.xlsx` 的「购买花费」后重导 |
| 消耗品效果（类型 / 数值 / 时长） | `data/inner-shop.json` `consumables[].effectType/effectValue/effectSec` | 见 §3.4 表（恢复 `heal 25/0`、力量 `attackPower 25/60`、护盾 `shield 50/0`、速度 `moveSpeed 25/30`） | 药水与即时类效果 | 改 `消耗品.xlsx`（`innerItemInfo` 页签第 16~18 列）后重导 |
| 消耗品「局内表现」美术 | `consumables[].artTypeInRun/artNameInRun` | **当前 4 行两列全为空** → `getItemArt` 回退「图标」两列（`artType/artName`） | 药水图标 | 策划填入后自动切到「局内表现」（无需改代码） |
| `POTION_CAP` | `economy/run-items.js` | `4` | 药水队列容量 | 满 4 且新 id → `potionQueueAdd` 返回 false（丢弃新获得的，**金币已扣**） |
| `statMul(value)` | `economy/run-items.js` | `1 + value/100` | 效果数值 → 属性乘子 | `25 → ×1.25`；限时到期回退乘 `1/mul`（见 §3.4） |
| 武器临时售价 / 时长 | `data/inner-shop.json` `weapons[]` | `cost:25` / `durationSec:15`（101/102/103 三条） | 局内限时武器 | 改 `武器.xlsx` 的「临时价格 / 临时时长」 |
| 武器 id 映射（表格编号 ↔ 项目 id） | `data/inner-shop.json` `weapons[].weaponId` | `101→yellow` / `102→green` / `103→weapon-1788012926999` | 表格「编号」与项目武器 id **不同源**；导表按 `name` 交叉引用 `data/weapons/*.json` 补 `weaponId` | UI 取武器外观读 `item.weaponId || item.id`；未匹配到 → `""`（商店只显示背景盘） |
| `SHOP_ITEM_COUNT` | `economy/inner-shop.js:11` | `4` | 商店一次刷出的商品数 | 改这里 **和** `screens.js:drawVendorShop` 布局 |
| `LOTTERY_ROLL_MS` | `economy/inner-shop.js:13` | `2500` | 摇奖滚动动画时长 | 中奖卡另展示 1800ms（`screens.js`） |
| `lottery.drawCost` | `data/inner-shop.json`（常量 `DEFAULT_DRAW_COST`：`tools/export-tables.mjs:10`） | `15` | 单次摇奖花费 | 改脚本常量后重导 |
| `lottery.goldPrize` | 同上（`DEFAULT_GOLD_PRIZE`：`tools/export-tables.mjs:11`） | `15` | 命中「金币」类的奖励 | 同上 |
| 老虎机权重 | `老虎机.xlsx`「直接出货权重」→ `export-tables.mjs:parseLottery` | 武器 `5` / 护盾 `10` / 金币 `15` / 垃圾 `15`（%，合计 45，其余 55% 三窗各自等概率 4 选 1） | 各品类出货概率 | 改表格后重导 |
| 商品限购次数 | `inner-shop-runtime.js:95 buyVendorItem`（`vendor.bought` Set） | `1` | 每件商品限购 1 次 | 改判定逻辑 |
| `PICKUP_RADIUS` | `economy/drops.js:10` | `26` | 拾取判定半径 | gold/diamond 距离判定 & exp/charge 吸附拾取共用 |
| `MAGNET_RADIUS` | `economy/drops.js:12` | `90` | 金币/钻石吸附触发半径 | 玩家进入 90px 内以 800px/s 吸向玩家；范围外停留原地 |
| 掉落飘散参数 | `drops.js:45-46` | gold/diamond `10px/s,1000ms`；其他 `20px/s,600ms` | 落地散开时长 | 飘散期内不吸附/不可拾 |
| exp/charge 吸附速度 | `drops.js:114` | `800 * sec` | 每秒 800px 追玩家 | 拾取快慢 |
| exp 单个价值 | `drops.js:59` | `+1` | 一个经验球 = 1 exp | 升级速度 |
| gold 单个价值 | `drops.js:68` | `+1` | 一个金币 = 1 gold | 购买力 |
| diamond 单个价值 | `drops.js:72` | `+1`（→ `player.gems`） | 一颗钻石 = 1 gems | 钻石货币获取 |
| `SLOT_UNLOCK_LEVELS` | `player-data.js:17` | `[12, 30]` | 出战槽 2/3 解锁等级 | 有测试守护；**另一份** `ui-runtime.js:21 WEAPON_SLOT_LEVELS = [12,30]` 必须同步 |
| `pointsEarnedForLevel(lv)` | `player-data.js:20` | `max(0, floor(lv)-1)` | 等级 → 累计应得点数（1 级 0 点） | 改成长曲线 |
| `grantLevelUp` | `player-data.js:25` | `level+1, points+1` | 每级 1 点 | 与上式保持一致 |
| `PLAYER_VERSION` | `player-data.js:5` | `1` | 存档版本号 | 加迁移逻辑时递增 |
| `WEAPON_ENHANCE_DIRECTIONS` | `player-data.js:8` | `3` | 每把武器强化方向数 | `enhance` 数组长度 |
| `PLAYER_WEAPONS` | `player-data.js:11` | `['radial','yellow','green']` | 武器列表 = 展示顺序 | 加武器需同步 `emptyWeaponMods`(32) |
| `DEFAULT_UNLOCKED_WEAPONS` | `player-data.js:14` | `['radial']` | 初始解锁 | 有测试守护 |
| `DEFAULT_PLAYER.combat` | `player-data.js:68-77` | `moveSpeed/attackPower/attackSpeed=1, critRate/dodgeRate=0, maxHp=100, maxShield=50, damageReduction=1` | 新档基础属性 | 全局强度基线 |
| `DEFAULT_PLAYER.progress.expToNext` | `player-data.js:50` | `100` | 升级所需经验 | 目前是固定值，无成长曲线 |
| relics / pets 上限 | `player-data.js:281-282` | `3` / `2` | 圣物 3 宠物 2 | 有测试守护 |
| `ITEM_DEFS` 条目数 | `state.js:25-43` | **12**（mod 7 / relic 3 / pet 2） | 全物品表 | 新增即自动进商店与背包 |
| `MOD_DEFS` 条目数 | `state.js:46` | **7** 派生 | 改件表 | 测试硬断言 7 个 id |
| `ENEMY_TYPES` | `state.js:6-11` | basic1 `hp30/dmg10`、basic2 `50/15`、advanced1 `80/20`、advanced2 `100/15` | 敌人血/伤 | 战斗难度（详见 combat skill） |
| `DEFAULT_DROPS` | `state.js:14` | `{gold:1, exp:1, diamond:0}` | 未配 dropRules 时的个体掉落 | 兜底收益 |
| `DROP_ITEMS` | `state.js:16` | `gold / exp / charge / diamond` | 掉落物种类白名单 | 加类型必须在此注册（编辑器掉落规则与宝箱奖励下拉自动同步） |
| dropRules `chance` | `state.js:92` | 0~100 clamp，面板默认 `100` | 爆率百分数 | `random*100 >= chance` 判定 |
| dropRules 新建默认 | `editor/drop-rules-panel.js:77` | `{item:'gold', count:1, chance:100}` | 面板「添加」初值 | 策划体验 |
| `BULLET_DAMAGE` | `systems/constants.js:65` | `10` | 无 combat / 无武器定义时的伤害兜底 | 编辑器预览伤害 |
| `SHIELD_MAX` | `systems/constants.js:59` | `50` | 编辑模式护盾上限 & HUD 兜底 | 与 `combat.maxShield` 默认一致 |
| `LEVEL_HP_BONUS` | `level/level-flow.js:23` | `10` | **仅编辑模式**：每级 +10 HP | 正式流程读 `combat.maxHp`，不走这条 |
| 暴击倍率 | `economy/damage.js:19` | `dmg *= 2` | 硬编码 2 倍 | 想做暴伤属性需在此加字段 + 存档字段 |
| `WEAPONS.radial.baseDamage` | `combat/weapons.js:19` | `10`（`maxAmmo: Infinity`） | 基础武器 | 详见 combat skill |
| `WEAPONS.yellow.baseDamage` | `combat/weapons.js:85-87` | `8`，`maxAmmo:45`，`chargeRequired:5` | 散射 | 充能球补弹需 5 个 |
| `WEAPONS.green.baseDamage` | `combat/weapons.js:178-180` | `16`，`maxAmmo:30`，`chargeRequired:8` | 激光 | 容量改件使 maxAmmo ×2（`level-flow.js:190`） |
| 武器售价 `prices` | `data/ui/weapon.json` | `yellow:100`、`green:200` | 武器商店价 | 纯数据，改完刷新即可 |
| 改件售价 `modPrices` | `data/ui/weapon.json` | 通用 3 件各 `50`；`ricochet/split` 各 `120`；`capacity/pierce` 各 `150` | 改件商店价 | 未列价的改件在商店不显示购买按钮 |
| 预览档预置点数 | `main.js:30` | `progress.points = 5` | 预览模式便于试加点 | 只影响预览 |
| 预览档预置物品 | —— | **已移除 mock 预置** | 预览改件/圣物/宠物库存改由编辑器「预览玩家数据」面板配置（`player-panels.js`），工坊右下库存读它 | 只影响预览 |

## 6. 扩展指南

### 6.1 新增一件道具（圣物 / 宠物 / 可堆叠物）

1. `src/state.js:25` 的 `ITEM_DEFS` 加一条：`{ name, category:'relic'|'pet'|'mod', stackable, weapon:'', color }`。
2. 无需改 `MOD_DEFS`（自动派生）；`category!=='mod'` 也不会进改件商店。
3. `normalizePlayer` **不用改**——`normalizeStacks` / `normalizeUniques` / `normalizeItemList` 都是查表校验。
4. 想让它能买：在 `data/ui/weapon.json` 的 `modPrices` 加价（**注意**：`screens.js:189` 只遍历 `MOD_DEFS`，圣物/宠物目前没有商店入口，要卖需扩 `drawWeaponShop`）。
5. 生效逻辑：圣物/宠物当前**没有属性结算实现**，需自己在 `damage.js` 或开局 `level-flow.js:176` 处叠加。
6. 测试：`test/player-data.test.js:149` 的 `ITEM_DEFS 分类正确` 用例只断言已有 id，新增不会红；若新增改件必须更新 `:161` 的 `MOD_DEFS` id 全量数组。

### 6.2 新增一种改件

1. `ITEM_DEFS` 加条目，`category:'mod'`，`weapon:''`（通用，可堆叠）或 `'yellow'|'green'`（专属，一般 `stackable:false`）。
2. **必须**更新 `test/player-data.test.js:161` 的 `Object.keys(MOD_DEFS).sort()` 期望数组，否则测试红。
3. 加价：`data/ui/weapon.json:modPrices[id]`。
4. 生效：`activeMods()` 会自动把它算进集合（前提 `weapon` 匹配），但**效果要自己写**——参考 `game-scene.js:248 spin`、`weapons.js:207 pierce`、`level-flow.js:184 capacity`、`game-scene.js:373 split`（详见 combat skill）。
5. 专属改件走 `dedicated` 槽（每武器 1 个），通用走 `generic`（`workshopReplaceSlot:428` **当前实现是覆盖成单元素数组**，即通用槽实际只有 1 格）。
6. 不需改 `normalizePlayer`（按 `category`/`weapon` 动态校验）。

> **武器系统接入（改件数量上限 + 动态武器）**：`weaponMods` 键不再是写死 `radial/yellow/green`，而是读 `player-data.weaponCatalog()`（含设计武器）。每武器通用/专属改件数量上限由 `src/systems/art/weapon-caps.js` 的 `getWeaponCaps(id)`（**无 Phaser 数据模块**）提供，`weapon-store.registerWeapon` 写入（默认 3/1）；`normalizeWeaponMods`（`player-data.js`）与 `activeMods`（`damage.js`）都会按上限截断。**改 `weaponMods` 相关逻辑时留意**：不要写死 3 种武器，用 `weaponCatalog()`；上限经 `weapon-caps` 而非直读 `WEAPONS`（后者会拖入 Phaser 破坏 node 单测）。

### 6.3 新增一条神像祝福 / 改局内商店（表格驱动）

**A. 神像祝福（配置驱动）**

1. 往 `data/ui/idol-buffs.json` 的 `buffs` push `{ id, name, desc, icon(画板资产 id), stats }`；`stats` 为声明式 `{ 属性:{ op:'add'|'mul'|'set', value } }`（`apply` 由 `buffs.js:41 makeApply` 生成，只改 `scene.player.combat`，改 `maxHp` 自动同步 `scene.player.maxHp`）。「每次出现几张」改顶层 `offerCount`（→ `IDOL_OFFER_COUNT`）。
2. 仅当局，不写存档，`normalizePlayer` / 测试都不用动。

**B. 局内商店 / 老虎机（改表 + 重导，不改代码）**

| 想改什么 | 怎么做 |
| --- | --- |
| 商品价格 / 名称 / 描述 / 图标 | 改 `策划文档/server/消耗品.xlsx`（页签 `innerItemInfo`）或 `武器.xlsx`（页签 `weapon`）对应列 |
| 改消耗品效果（类型 / 数值 / 时长）或「局内表现」美术 | 改 `消耗品.xlsx`（`innerItemInfo` 页签第 16~18 列效果 + 「美术方案类型/名称（局内表现）」两列）→ 重导；`getItemEffect`/`getItemArt` 读取（当前「局内表现」两列全空 → 回退「图标」列） |
| 新增一种药水效果类型 | 目前**任意非空 `效果类型`** 都被当作 `player.combat` 字段名（`mul = 1 + 值/100`）；`heal`/`shield` 走专用分支、`''` 跳过（见 §3.4）；新增特殊语义需改 `run-items.js:applyStatEffect` |
| 加减商品 | 在对应表增删一行；消耗品行按「编号列是数字」识别，武器行仅当「是否加入局内临时=1」才进商店 |
| 调老虎机权重 | 改 `老虎机.xlsx`（页签 `main`）的「直接出货权重」列（数值 = 百分数） |
| 加一个老虎机种类 | 在 `老虎机.xlsx` 加一行：`描述`（key 由 `LOTTERY_KEY_MAP` 映射，未识别用原文）+ 权重 + 美术方案类型 / 名称 |
| 让某消耗品 / 武器能被老虎机抽出 | 该行「是否进老虎机=1」 |
| 新增局内临时武器商品 | 除改 `武器.xlsx`（「是否加入局内临时=1」）外，武器「名称」必须能在 `data/weapons/*.json` 里按 `name` 精确匹配到，否则 `weaponId` 为空 → 商店只显示背景盘；改完**必跑** `node tools/export-tables.mjs` |

改完重导（开发期 `server.js` 按三份表 `mtime` 实时解析，通常**免重启**；打包 / 离线必须重导）：

```bash
node tools/export-tables.mjs   # 重新生成 data/inner-shop.json，打印「消耗品 N 条 / 武器 N 条 / 老虎机 N 类」
```

生效链路：`xlsx` → `tools/export-tables.mjs` 的 `parseConsumables`/`parseWeapons`/`parseLottery` →（开发期）`server.js` `GET /api/inner-shop` 实时解析 /（打包态）`data/inner-shop.json` → `src/api.js:getInnerShop` → `economy/inner-shop.js:loadInnerShop` → `InnerShopMixin` → `screens.js:drawVendorShop`。

> `drawCost` / `goldPrize` 在表格里**没有对应列**，固定 15，由 `export-tables.mjs` 的 `DEFAULT_DRAW_COST` / `DEFAULT_GOLD_PRIZE` 集中定义；要改值（或从表里读）需改脚本。
> 商品 / 老虎机的**交互与页面绘制**不在本分类 —— 见 `ui-interaction` skill（`screens.js` / `ui-runtime.js`）；售货机 F 键入口与关卡内清零见 `level-design` skill。

### 6.4 改加点上限与收益

1. 只改 `progression.js:10 UPGRADE_STATS` 的 `per` / `cap` / `fmt`。
2. 加新的加点属性（例如 `critRate`）需要四步：① `UPGRADE_STATS` 加键；② `player-data.js:79 DEFAULT_PLAYER.points` 加键；③ `player-data.js:187 normalizePoints` 加一行 clamp；④ `test/player-data.test.js:143` 的 `points 归一化为 4 键` 用例改成 5 键并更新 `Object.keys` 断言。
3. `workshop.js:119` 用 `Object.keys(UPGRADE_STATS)` 渲染，行高 72px、起始 y=346，加到第 5 项要检查左面板（高 1000px）是否够放。
4. `cap` 与 `pointsEarnedForLevel` 的总量要对齐：当前 4 项 × cap 10 = 40 点，对应 41 级才能点满。

### 6.5 新增一种货币 / 掉落类型

1. `state.js:16 DROP_ITEMS` 注册 id 与中文名（掉落规则/宝箱奖励下拉框、`normalizeDropRules` 白名单都读它）。
2. `drops.js:41 spawnDropItems` 加飘散参数分支（可选）；`drops.js:89 updateDrops` 决定是否吸附（gold/diamond 是「90px 内吸附 + 26px 拾取」，exp/charge 是「恒吸附」）。
3. `drops.js:58 collectDrop` 加 `else if (d.type === 'xxx')` 分支，写入 `this.player.<字段>`。
4. 渲染：掉落物图标绘制在 `world-render.js:550`（gold/diamond 用四角菱形 `entity-art.js:drawDropDiamond`，其余圆形白点；详见 ui-interaction skill）。
5. 若要持久化成货币：① `DEFAULT_PLAYER.currency` 加键；② `normalizePlayer:250-252` 加 clamp（照抄 gold 的 `max(0, floor)`）；③ `level-flow.js:232-233` 把它读进 `this.player`；④ `level-flow.js:287 settleVictory` 写回；⑤ `test/player-data.test.js:16` 的字段存在性用例 + `:73` 边界用例补断言。
6. 老档里 `data/players/save-1.json:17` 有个残留 `currency.charge: 0`，它当前被 `normalizePlayer` **丢弃**——新增货币时别以为已经支持了。
   > 现状：`currency.gems`（钻石）获取链路已通——`DROP_ITEMS.diamond` 掉落 → 局内 `player.gems` 累加（`collectDrop`）→ `settleVictory` 通关写回；商店页顶部 `screens.js:drawWeaponShop` 展示，**暂无消费链路**。个体掉落默认 0（`DEFAULT_DROPS.diamond`），需策划在编辑器「掉落规则」面板按敌人类型配置，宝箱奖励也可选钻石。

## 7. 坑与约束

1. **`normalizePlayer` 是唯一的存档兼容层**。它是「白名单重建」而非「合并」：任何不在 `normalizePlayer` 返回对象里的字段，读档时会**直接消失**（`save-1.json` 里的 `mods` / `modInventory` / `currency.charge` 就是这样的死字段）。改/加存档字段必须同时改 `DEFAULT_PLAYER` + `normalizePlayer` + `test/player-data.test.js`，否则「往返幂等」用例（`:38`）和「字段存在性」用例（`:16`）会红。
2. **三套玩家数据不可混用**：正式/试玩共用变量 `state.player`（靠 `state.saveStore` 区分写到 `data/players/` 还是 `data/test-players/`），预览用 `state.previewPlayer`，另有 `state.trialPlayer` 是选档时的克隆快照。试玩通过「改存储源」实现隔离，不是靠换变量——所以**别把 `state.player` 当成一定是正式档**。
3. **`saveSource()` 决定读写哪一套**（`progression.js:54`）。所有写存档的代码（`applyUpgrade` / `buyWeapon` / `buyMod` / `workshopEquipItem`）都必须先 `saveSource()` 再 `persistSave(source)`，不要直接摸 `ctx.state.player`。`persistSave` 在 `editing || isPreviewMode()` 时**静默丢弃**——预览模式下改数值不落盘是设计而非 bug。
4. **`weapons.js ↔ damage.js` 循环 import**：`damage.js:9` import `WEAPONS`，`weapons.js:11` import `activeMods`。ESM 提升函数声明，两侧都只在**函数体内**使用对方，所以运行期安全。**绝对不要**在这两个文件的顶层做求值（例如 `const X = Object.keys(WEAPONS)` 或模块级 `WEAPONS.radial.baseDamage`），会拿到 undefined / TDZ 报错。同理 `screens.js`、`workshop.js` 也 import `WEAPONS`，新增依赖时注意方向。
5. **`DEFAULT_PLAYER` 不可被 mutate**。`test/player-data.test.js:202` 用 JSON 快照守护。`normalizePlayer` 里引用 `d.levels.unlocked` 时是通过 `uniqueStrings(..., fallback)` 展开拷贝（`:224-228`）的；`emptyWeaponMods()` 也是每次新建工厂。写新字段时若直接返回 `d.xxx` 引用，调用方一改就污染默认值，测试会红。
6. **金币/钻石各有两个字段名**：存档里是 `currency.gold` / `currency.gems`（`normalizePlayer` clamp 非负整数，落盘），局内运行时是 `player.gold` / `player.gems`（扁平、可能为浮点/负值、不落盘）。转换点：`level-flow.js:210 savedCurrency`（存档 → 局内）、`level-flow.js:331 settleVictory` 的 `:337-338`（局内 → 存档，仅通关时）、`screens.js:755/787/809`（买完把 `source.currency.gold` 回写 `player.gold` 保持 HUD 一致）。**售货机购买 / 摇奖只扣 `player.gold`，中途退出关卡这笔钱不消失也不生效**。别在 UI 里混用两者：`screens.js` 买商品读 `player.gold`（`inner-shop-runtime.js:buyVendorItem`），武器/改件商店读 `source.currency.gold`，是有意区分的。
7. **`SLOT_UNLOCK_LEVELS` 重复定义两份**：`player-data.js:17` 与 `systems/ui/ui-runtime.js:21 WEAPON_SLOT_LEVELS`，值都是 `[12,30]`。改一处不改另一处 → 工坊显示解锁但实际不给槽（或反之）。前者有测试守护（`:174`），后者没有。
8. **`UPGRADE_STATS` 未导出**却被 `workshop.js:119/121` 引用；`workshop.js` 同样缺 `WEAPON_SLOT_LEVELS` / `PLAYER_ART` / `drawHexRingPlayer` 的 import。改这些标识名时要顺手确认工坊页仍能渲染（浏览器控制台看 `is not defined`）。
9. **`items.uniques` 同一 `itemId` 最多 1 个**（`normalizeUniques:123` 的 `seen` 去重）。`buyMod` 也做了同样判断（`screens.js:258`）。想做「两把同名专属改件」必须先改归一化规则和测试（`:106`）。编辑器玩家面板的改件区（`player-panels.js`）现按**库存数量**配置：通用改件写 `items.stacks`（无上限）、专属改件写 `items.uniques`（每种最多 1）；工坊右下「改件」库存读 `source.items` 自动反映。原「已装备勾选」的 `setModEquipped` 已移除（装备改由工坊拖拽完成）。
10. **`loadout[0]` 恒为 `'radial'`**（`normalizeLoadout:140`），空槽是 `''` 而不是 `null`。测试 `:90` 逐例守护 6 种输入。
11. **`combat.damageReduction` 是乘算系数**，1 = 不减伤，0 = 完全免伤，且被 `clampPercent` 夹在 0~1。写「+X% 减伤」的 buff 要写成 `*= (1-X)`，不能写成 `+=`。
12. **掉落规则的 `chance` 是「百分数」**（0~100），判定式是 `Math.random()*100 >= rule.chance` → **`chance:0` 也有极小概率触发**（`random()` 可能返回 0）。而 `dropRules` 一旦为某敌人类型配了非空数组，该敌人的个体 `drops.gold/exp/diamond` 就**完全失效**（`drops.js:38` 直接 return）。
13. **`charge` 掉落只在「弹药未满」时生成**（`drops.js:25` 判 `have >= need` 跳过），且 `tryRefillWeapon` 仅在 `ammo <= 0` 时才消耗充能补弹——所以充能球看起来「不掉」通常是弹药还没打完。
14. `exp` 拾取会调 `commitPlayer()` **每颗都写一次盘**（`drops.js:61`）。大量经验球同帧拾取会触发多次 `onPlayerSave`；加新掉落物时别照抄这个模式（gold/diamond 就是只累加不落盘，结算才写）。

15. **局内字段不能挂 `state.player`**（会污染存档）。`state.player` 本身就是存档源（`progression.js:persistSave` → `ctx.onPlayerSave`），直接加字段就被写进 `data/players/*.json`。**正确做法**：`runItems` / `runTimedWeapons` / `vendorActive` 一律挂 **scene**，`vendor.stock` / `vendor.bought` / `vendor.slot` 挂**售货机实体**，由 `level-flow.js:91 restart` 的 `this.runItems=[]; this.runTimedWeapons=[]; this.vendorActive=null` 清零。现象：改完发现存档 JSON 里多出一堆局内临时字段。
16. **摇奖结算不能只靠渲染时机**。页面一关闭 `screens.js:drawVendorShop` 就不再被调用，`vendor.slot.rolling` 会**永久卡死**——钱已扣、奖未发、也无法再抽（下次点摇奖仍被判 `rolling` 挡住）。**正确做法**：`game-scene.js:819` 每帧 `updateVendorSlot()` + `rollVendorSlot()` 对过期 rolling 自愈 + `settleVendorRoll` 幂等（`rolling=false` / `granted`）。判据：凡「有倒计时 / 需结算」的页面态，结算必须由每帧驱动、页面组件只是可选触发者。
17. **旧的三条 buff 商店已整体删除**（`VENDOR_BUFFS` / `buyBuff` / `vendorBought`）。售货机页现由**策划表格驱动**（`data/inner-shop.json`），不要再按「数组里 3 件带 `price` 的 buff」描述或扩展；数值参照 §5，交互与绘制见 `ui-interaction` skill，导表 / server 见 `engine-editor` skill。
18. **`lottery.drawCost` / `goldPrize` 表格里没有对应列**，固定为 15，由导表脚本常量 `DEFAULT_DRAW_COST` / `DEFAULT_GOLD_PRIZE` 集中定义（`tools/export-tables.mjs:10-11`）。策划要求改这两个值（或想从表里读）时，改脚本后必须 `node tools/export-tables.mjs` 重导才生效；别直接改 `data/inner-shop.json`（下次导表会被覆盖）。
19. **表格武器「编号」≠ 项目武器 id，按 `name` 交叉引用；运行期 `resolveWeaponId` 是兜底而非首选**。武器表「编号」是 `101/102/103`，项目武器 id 是 `yellow`/`green`/`weapon-1788012926999`；`getWeaponDef('101')` 必为 `undefined`（商品卡只剩背景盘）。**首选**：导表阶段 `loadWeaponNameIndex()` 读 `data/weapons/*.json` 的 `name` 交叉引用、把 `weaponId` 落进 `data/inner-shop.json`；`inner-shop.js:resolveWeaponId`（显式 `weaponId` 优先，否则 `weaponCatalog()` + `getWeaponDef(id).name === name` 反查）只在读旧数据 / 无 `weaponId` 时兜底。凡 UI / 战斗取武器外观或定义，一律用 `item.weaponId || item.id`。

20. **`addRunItem`/`addRunTimedWeapon` 已从 `InnerShopMixin` 迁到 `RunItemsMixin`**：装配顺序必须让 `RunItemsMixin` 在 `InnerShopMixin` **之后**（`game-scene.js:892`）；`buyVendorItem`/`settleVendorRoll` 的调用语句**不用改**（同原型解析）。改动这两个方法的归属时别复制成两份（会形成静默的 mixin 同名覆盖）。
21. **药水满 4 瓶后仍能在售货机买（金币照扣但拿不到）** —— 「丢弃新获得的」规则的副作用：`addRunItem` 返回 false 但 `buyVendorItem` 已扣钱。如需改成「满则不扣钱」要在 `buyVendorItem` 里**先判容量**。
22. **`getItemArt` 优先「局内表现」美术两列、回退「图标」两列**：表里「局内表现」当前全为空 → 现在实际都用「图标」列；策划填了就会自动切过去（**无需改代码**）。
23. **`src/systems/economy/inner-shop.js` 头注写「无 Phaser 依赖，可在 node 中直接跑」严格不成立**：传递依赖 `inner-shop.js → art/weapon-store.js → combat/weapons.js` 顶层 `import Phaser from 'phaser'`，node 直跑会报 CJS/ESM 错误（`combat/boss25t5.js` 已记载同现象）。纯 node 单测只能覆盖 `run-items.js` 这类无传递依赖的模块。
24. **表格驱动内容不要硬编码**：药水的效果/数值/时长、图标美术方案、`局内栏位`/`是否即时生效` 全部走表 → `node tools/export-tables.mjs` → `data/inner-shop.json`（开发期 `server.js` 按 mtime 实时解析；打包态读 JSON）。算法常量（`POTION_CAP`、老虎机 `drawCost/goldPrize` 默认值）才留在代码里。
25. **敌人个体 `e.drops = {gold, exp, diamond}` 不支持药水**：药水只支持「关卡级 `state.level.dropRules[敌人类型]`」与「宝箱 `rewards`」两个面板；`potionId` 留空 = 随机药水。
26. **`resolveDropPotionId` 在配表未就绪时返回空串**（顺手触发一次 `loadInnerShop()`）→ 该次击杀不掉药水，属预期降级。

## 8. 验证方式

```bash
node --test test/               # 必跑：本分类改动直接命中 test/player-data.test.js
npx vite build                  # 构建校验（ESM 循环依赖 / 未定义标识常在此暴露）；基线 90 modules
node tools/export-tables.mjs    # 改了策划表格 / 导表脚本后必跑（可重复执行；除 generatedAt 外幂等）
```

- **测试基线：`# tests 20 / # pass 19 / # fail 1`**。唯一 fail 来自 `test/player-api.test.js` 的 round-trip 用例断言旧 schema `mods` 字段（已被 `normalizePlayer` 有意丢弃，既有问题，非本分类引入）。`test/player-data.test.js` 的 **16 个用例必须全绿**——它是存档数值契约的权威来源。
- **可用 `node -e` 直接跑的单测**（无 Phaser 传递依赖）：`run-items.js`（队列 `potionQueueAdd`/`potionQueueTakeFront`、`statMul` 乘子、`applyStatEffect` 互逆回退）；`state.js` 的 `normalizeDropRules`/`normalizeRewardList`（`potionId` 保留与置空）。**注意**：`inner-shop.js` 有 `→ weapon-store → weapons.js` 的 Phaser 传递依赖，node 直跑会报 CJS/ESM 错（见 §7 坑 23），别把它当纯 node 单测入口。
- **局内商店**：`GET /api/inner-shop` 应返回 `consumables 4 条 / weapons 3 条 / lottery.kinds 4 类`（开发期实时解析 xlsx，解析失败回退 `data/inner-shop.json`，两者都不可用返回空骨架，**永不 500**）。
- **导表产物交叉引用**：`node tools/export-tables.mjs` 后检查 `data/inner-shop.json` 的 `weapons[].weaponId` **全部非空**（空缺 = 武器名没在 `data/weapons/*.json` 里按 `name` 匹配到 → 商店只显示背景盘）。
- 改了 `ITEM_DEFS` / `MOD_DEFS` / `points` 键 / `SLOT_UNLOCK_LEVELS` / `DEFAULT_PLAYER` 后，重点看这几个用例：`:16` 字段完整、`:38` 往返幂等、`:143` points 4 键、`:149` MOD_DEFS 派生、`:174` 槽位等级、`:202` 默认值不污染。
- 手动验（`npm run dev` 后）：
  - 加点表 / 属性成长 → 进工坊页，看 4 行属性的数值、进度条与「可用升级点数」是否随点击变化，退出重进确认已落盘。
  - 商店价格 → 武器商店看 `购买 100/200` 与改件行的 `xx金`；局内找售货机按 F 打开表格驱动的商店页（4 件商品 + 老虎机；改表后刷新即变，见 §6.3）。
  - 伤害 / 减伤 → 用编辑器「游戏预览」面板（`src/editor/player-panels.js`）直接改 `attackPower` / `critRate` / `damageReduction` / `dodgeRate`，进关打怪观察（预览档不落盘，可随便调）。
  - 掉落 → 编辑器右侧「掉落规则」面板按敌人类型配 `item/count/chance`（item 可选 金币/经验/充能球/钻石/**药水**），试玩打死该类型敌人验证；金币/钻石/药水 90px 内自动吸附、26px 拾取，钻石进 `currency.gems`（通关结算）。
  - 局内消耗品 / 限时武器 → 售货机买药水与限时武器，看药水轮盘、数字键 5 切换临时武器（使用中才倒计时）、限时加成 HUD 状态图标到期消失；即时护盾在 `player.itemShields` 叠加、吸收后盾碎抖屏。
- 跨分类：武器 `baseDamage` / `fireInterval` / `maxAmmo` 与改件实际效果实现见 **combat skill**；工坊拖拽交互、神像互动与掉落物渲染见 **gameplay-systems skill**；售货机页绘制 / 老虎机三窗动画 / 按钮派发见 **ui-interaction skill**；售货机 F 键入口（`level/interactables.js:updateVendorInteract`）与关卡内局内态清零见 **level-design skill**；导表脚本 / `/api/inner-shop` / 打包分发见 **engine-editor skill**；关卡 JSON schema 与编辑器面板骨架见 **editor skill**。
