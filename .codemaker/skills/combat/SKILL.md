---
name: combat
description: 改武器手感与弹道、敌人 AI 行为、伤害与命中判定、护盾格挡、限时加成、临时武器开火、即时护盾吸收（itemShields）、寻路、可破坏物（木箱/油桶）、玩家被击败（三个失败入口 damagePlayer / boss25t5KillPlayer / 母舰贴身秒杀）时读这份。覆盖 src/systems/combat/** 与 src/systems/economy/damage.js。触发词：武器 / 武器出场 / 弹道 / 子弹 / 敌人 / AI / 护盾 / 木箱 / 油桶 / 运镜 / 过场运镜 / 死亡运镜 / 玩家被击败 / 运镜预览 / 休息火堆 / 火堆 / 武器祝福 / 火堆阻挡子弹 / 重装机兵 / 激光敌人 / 敌人激光 / 瞄准线 / 瞄准收敛 / 头部朝向。
---

# 战斗相关 开发指南

> 面向首次接触本项目的 agent。读完这份应能独立完成武器/敌人/碰撞层面的需求。
> 关联 skill：数值口径见 `economy-numbers`，渲染表现见 `ui-interaction`，刷怪点与触发器见 `level-design`。

## 1. 这块负责什么

从「玩家扣下扳机」到「敌人掉落物落地」之间的全部实时逻辑：弹道生成与推进、命中与穿墙判定、敌人行为决策与寻路、玩家受伤与护盾格挡（含**即时护盾吸收**）、可破坏物的破坏与连锁伤害、**限时加成与临时武器**的生效。

玩家可见功能点：
- 3 种可用武器（基础环射 `radial` / 散射 `yellow` / 激光 `green`）+ 1 个内部保留武器（`basic`），滚轮或按键切换
- 改件（Mods）改变弹道：多轨、三发、转速、反弹、分裂、穿透、扩容
- 4 种敌人（basic1/basic2/advanced1/advanced2），各有接近—交战—环绕—冲锋/点射的行为机
- **重装机兵（heavy-mech）**：远程激光单位——头（画板顶部的尖）追踪玩家、朝玩家缓慢逼近，每隔若干秒「两条蓝线收拢 → 单线锁定 → 停顿 → 激光（变粗→保持→变细）」
- 敌人被墙阻挡时会 A* 绕路
- 玩家护盾（扇形，有角度与距离判定，可被破盾）
- **局内限时加成**（药水改 `player.combat`）与**即时护盾**（`player.itemShields`，先到先吸收、盾碎抖屏）
- **临时武器**（数字键 5 使用/取消，替换 `player.weapon`，仅「使用中」倒计时，复用现有开火链路）
- 木箱可打碎产生碎片，油桶爆炸有范围伤害
- 命中特效、受击红闪、击杀计数

**不负责**：掉落内容与概率、药水 / 限时武器的获得队列与效果数值（`economy-numbers`）、敌人从哪刷出来（`level-design`）、子弹长什么样以外的世界渲染（`ui-interaction` 的 `world-render.js` 负责实际绘制调度）、药水轮盘 / 限时状态图标的 HUD 绘制（`ui-interaction`）。

## 2. 文件地图

| 文件 | 职责 | 关键导出 | 行数 |
|---|---|---|---|
| `src/systems/combat/geometry.js` | 纯几何：网格吸附、墙体命中、圆体推出、射线求交、子弹反射 | `snap` `toCell` `wallRotationRad` `wallCorners` `pointInWall` `hitWall` `resolveCircleAgainstWalls` `hitTrigger` `rayRectIntersect` `rayRotatedRectDistance` `rayWallDistance` `rayCircleDistance` `rayToBounds` `reflectBulletAgainstWall` `pointSegmentDistance` | 288 |
| `src/systems/combat/weapons.js` | 武器定义表 + 激光生成 + 被拦截弹（`b.blockedBoss`）强制红 + BOSS 施力弹（`b.forceTrail`）白弹体 + 彩色拖尾（内部 `drawForceTrailBullet`；颜色由 `forceTrail.color` 决定 —— 技能1 蓝 / 技能2 红 / 技能5 蓝） | `WEAPONS` `spawnLaser` | 160 |
| `src/systems/combat/enemy-ai.js` | 敌人行为机、寻路、开火、死亡结算（含母舰/原型机-2-5T5 运镜与拦截弹/漩涡清理、**重装机兵激光与瞄准线状态机**、**卡墙自毁 `updateEnemyStuck`**）；**`initEnemy` 是敌人数值的唯一入口：读 `e.wave` 经 `resolveEnemyStats` 做三层回落（波次 > 关卡 `level.enemyDefaults[type]` > 全局），并把尺寸倍率同时作用到 `r` 与 `artScale`（见 §3.2 / §7 坑 60）** | `EnemyAiMixin` | 707 |
| `src/systems/combat/heavy-mech.js` | **重装机兵**专属数据契约：默认值 / 归一化（纯数据，**不 import Phaser / geometry.js** → 可被 `state.js` 安全引用）+ 激光与瞄准线表现常量（`spreadDeg`/`width`/`grow·hold·fadeMs`/`muzzleOffset`/`sightStart`/`color`）+ **瞄准线运行时契约**（`e.sightLines` 端点由战斗侧每帧算，渲染端只画） | `HEAVY_MECH_ART` `HEAVY_MECH_DEFAULTS` `HEAVY_MECH_LASER` `normalizeHeavyMechConfig` | 57 |
| `src/systems/combat/boss25t5.js` | 原型机-2-5T5 专属：数据契约（默认值/归一化）+ 行为状态机 + 技能区域生命周期（**扇形方向释放时固定、可被走出躲避** + 命中像素级容差）+ 阻挡护盾拦截 + 技能5 场景级漩涡（捕获环绕 / 释放停驻）+ 已转化子弹对区域施力（**一次性固定速度+固定距离**；**不 import Phaser，可被 state.js 安全引用**） | `BOSS25T5_ART` `BOSS25T5_DESIGN` `BOSS25T5_DEFAULTS` `boss25t5Defaults` `normalizeBoss25T5Config` `Boss25T5Mixin`（**27 方法（实测）**：`stepBoss25T5` + 26 个 `boss25t5*`；本轮重写 `boss25t5ZoneBulletForce`（改为一次性固定速度+固定距离）；`boss25t5ZonesTick` 的扇形方向改为释放瞬间写死、**不再跟随玩家**，仅保留像素级命中容差） | 1383 |
| `src/systems/combat/player-combat.js` | 玩家受伤（含**即时护盾吸收** `player.itemShields`）、护盾格挡、武器切换、受击闪屏 | `PlayerCombatMixin`（7 方法）：`switchWeapon`（**只算目标槽位 + 委托**）、`equipWeaponByType`（**唯一执行体**：全部守卫 + `leave`/`enter` 成对 + 出场动画 + 轮盘动画） | 148 |
| `src/systems/combat/destructibles.js` | 木箱碎片、油桶爆炸 | `DestructiblesMixin`（2 方法） | 77 |
| `src/systems/combat/pet-runtime.js` | 玩家宠物：环绕玩家、索敌开火、受击结算 | `PetMixin`（5 方法）+ 依赖 `pet-store.getPetDef` | 144 |
| `src/systems/economy/damage.js` | 伤害公式与改件生效集合（归数值_经济，但战斗必经） | `playerDamage` `playerIncomingDamage` `activeMods` | 56 |
| `src/systems/economy/run-items.js` | 限时加成**纯逻辑**（**无 Phaser**）：`statMul` 乘子、`normalizeEffect`、`applyStatEffect`（互逆乘算回退） | `POTION_CAP` `statMul` `normalizeEffect` `potionQueueAdd` `potionQueueTakeFront` `applyStatEffect` | 63 |
| `src/systems/economy/run-items-runtime.js` | **限时加成 / 临时武器 / 即时护盾**运行时（倒计时、替换还原、护盾入列）；归 `economy-numbers` 但战斗必经 | `RunItemsMixin`（14 方法：`addRunItem` / `addRunTimedWeapon` / `usePotionAt` / `toggleTempWeapon` / `useTempWeapon` / `cancelTempWeapon` / `updateRunItems` …） | 210 |
| `src/systems/constants.js` | 战斗相关常量（护盾、命中特效、敌人行为参数、`ENEMY_BEHAVIOR['boss-2-5t5']`、`WEAPON_RING_CHAIN` 武器内圈环链/出场动画） | `SHIELD` `SHIELD_MAX` `HIT_FX_TTL` `HIT_FX_RADIUS` `BULLET_DAMAGE` `ENEMY_BEHAVIOR` `BARREL_DAMAGE` `WEAPON_RING_CHAIN` 等 | 112 |
| `src/pathfinding.js` | 网格构建与 A* | `buildGrid` `findPath` `nearestWalkable` | 105 |
| `src/game-scene.js` | `update` 主循环：开火节流、子弹推进、命中判定、敌人更新与 `boss25t5ZonesTick`/`boss25t5VorticesTick` 的调度点、`updateRunItems`/`updateBattleItemsInput` 调度、装配 `RunItemsMixin`/`BattleItemsMixin`；构造函数注入 `this.playerDamage`；**玩家被击败失败流程**：`create()` 初始化 `this.playerDeathFlow`，`update()` 里 `deathSim`/`inputLocked`（见 §4.3 / level-design §4⑨）；子弹 filter 的新顺序见 §6.2；`update()` 与 `updateIdolInteract` 同级调 `updateCampfireInteract(dt)`（`if (!inputLocked)` 守卫，`campfireWalls()` 提供火堆矩形碰撞体）；**子弹 filter 的障碍集含 `chestLockWalls()`（宝箱上锁红环，玩家弹与敌弹两处 + ricochet 查找链）** | `createGameScene` | 933 |

### 改 X 该动哪里

| 需求 | 落点 |
|---|---|
| 改某武器伤害/射速/弹夹 | `weapons.js` 对应武器的 `baseDamage` / `fireInterval` / `maxAmmo` |
| 改弹道形状（散射角度、蛇形幅度） | `weapons.js` 该武器的 `fire()` / `stepBullet()` |
| 改子弹外观（拖尾、弹头） | `weapons.js` 该武器的 `drawBullet()` |
| 改子弹反弹行为 | `geometry.js:reflectBulletAgainstWall` + `game-scene.js:update` 的 `b.ricochet` 分支 |
| 改激光穿墙/射程 | `weapons.js:spawnLaser`（`pierce` 改件走 `rayToBounds`，否则 `rayWallDistance`） |
| 改敌人速度/攻击距离/环绕参数 | `constants.js:ENEMY_BEHAVIOR` 对应条目 |
| 改敌人血量/伤害基数 | `src/state.js:ENEMY_TYPES` |
| 改敌人行为逻辑（何时冲锋、何时点射） | `enemy-ai.js:stepEnemy` / `stepAdvanced2` |
| 改**重装机兵**（激光节拍 / 头部追踪 / 瞄准线夹角 / 激光粗细） | 数值与表现常量全部在 `combat/heavy-mech.js`（`HEAVY_MECH_DEFAULTS` 编辑器可配 / `HEAVY_MECH_LASER` 代码常量）；状态机 `enemy-ai.js:stepHeavyMech` + `heavyMechFireLaser` + `updateEnemyLasers`；渲染 `ui/heavy-mech-art.js` + `ui/entity-art.js:drawEnemyShape` 分支 + `world-render.js` 的 `drawHeavyMechBeams`（详见 §6.2） |
| 改敌人绕路策略 | `enemy-ai.js:stepToward` / `findEnemyPath` + `pathfinding.js` |
| 改护盾角度/耐久/破盾 | `constants.js:SHIELD` / `SHIELD_MAX` + `player-combat.js:blockWithShield` |
| 改**即时护盾**（药水护盾）吸收顺序 / 吸收量 | `player-combat.js:damagePlayer` 的 `player.itemShields` 循环（先到先吸）+ `run-items-runtime.js:addRunItem` 的 `shield` 入列 |
| 改**限时加成**（药水改 `player.combat`）生效 / 到期回退 | `economy/run-items.js:applyStatEffect` + `run-items-runtime.js:updateRunItems`（数值/时长见 `economy-numbers`） |
| 改**临时武器**使用 / 取消 / 倒计时 | `run-items-runtime.js:useTempWeapon` / `cancelTempWeapon` / `updateRunItems`；开火仍复用 `WEAPONS[id].fire`（详见 `economy-numbers`）。**`useTempWeapon`/`cancelTempWeapon` 与 `player-combat.js:equipWeaponByType`、`level-flow.js:restart` 都会写 `player.weaponIntroAt = this.time?.now || 0`** 以重播武器本体出场动画（局内态、不落存档） |
| 改**滚轮/按键切武器**（武器轮） | `player-combat.js:switchWeapon`（**只算槽位 + 委托**：`const to = (weaponIndex + dir + n) % n; this.equipWeaponByType(weapons[to])`；保留 `n <= 1` 早退） |
| 改**按武器类型直接切换**（火堆选卡等，非滚轮） | `player-combat.js:equipWeaponByType` —— **武器轮切换的唯一执行体 + 全部守卫**（`leave`/`enter` 成对 + 出场动画 + 轮盘动画 + `syncUIState`）；调用方 `interactables.js:campfirePickUpgrade`（详见 §6.8） |
| 改免伤/闪避/暴击公式 | `economy/damage.js`（同时看 `economy-numbers` skill） |
| 改墙体形状支持（矩形/圆/弧） | `geometry.js:pointInWall` + `resolveCircleAgainstWalls` |
| 改**休息火堆**矩形碰撞体 / 靠近提示 / 阻挡子弹 | `interactables.js:campfireWalls()`（`visible!==false` 映射成 `{x,y,w,h,shape:'rect',rotation:0}`）+ `updateCampfireInteract(dt)`（F 键，`game-scene.js:update` 与 `updateIdolInteract` 同级调度）；子弹侧接入见 §6.7 |
| 改**宝箱上锁红环**的碰撞体 / 阻挡范围 | `interactables.js:chestLockWalls()`（圆形墙 `{x,y,w:r*2,thickness:8,shape:'circle'}`，`r = state.js:chestLockRadius`）+ `resolveMovementCollision` + 子弹四消费点见 §6.7 ②b；上锁/解锁由触发器事件驱动，契约见 level-design §3.14 |
| 改油桶爆炸范围/伤害 | `constants.js:BARREL_DAMAGE` + `destructibles.js:explodeBarrel` |
| 改宠物行为/数值（环绕半径/角速度/开火频率/伤害/生命） | 数值在 `data/pets/*.json`（`pet-design.js:normalizePetDesign` 归一化 + `pet-store.js` 存取 + `pet-board.js` 编辑器）；行为在 `pet-runtime.js`；受击判定在 `game-scene.js:update` 敌弹循环 |

## 3. 核心数据结构

### 3.1 `this.player`（运行时玩家，非存档）

| 字段 | 含义 | 取值 | 来源 |
|---|---|---|---|
| `x` `y` | 世界坐标 | number | 出生点 `level.spawn` |
| `hp` / `maxHp` | 当前/上限血量 | 0..maxHp | `maxHp` 来自存档 `combat.maxHp` + 等级加成 `LEVEL_HP_BONUS` |
| `shield` / `maxShield` | 护盾值 | 0..`SHIELD_MAX`(50) | 存档 `combat.maxShield` |
| `shieldActive` | 护盾是否张开 | boolean | 按键控制 |
| `shieldBroken` | 是否已破盾 | boolean | `hitShield` 置位 |
| `shieldAngle` | 护盾朝向（弧度） | -π..π | 跟随鼠标 |
| `shieldTimer` | 护盾淡入淡出进度 | 0..1 | `SHIELD.fadeMs` |
| `weaponAngle` | 枪口朝向（弧度） | -π..π | 跟随鼠标 |
| `weaponType` | 当前武器 id | `radial`/`yellow`/`green`/`basic` | 武器轮当前槽 |
| `weapon` | 当前武器定义对象引用 | `WEAPONS[type]` | — |
| `weapons` | 已装备武器轮数组 | string[] | 存档 `loadout` |
| `ammo` | 各武器当前弹药 | `{ [type]: number \| Infinity }` | `maxAmmo` |
| `combat` | 战斗属性集合 | 见下 | 存档 `combat` |
| `hitFlash` | 受击闪屏状态 | `{ alpha, total, t }` \| null | `damagePlayer` 写入 |
| `gold` | 局内金币（不落盘） | number | 拾取掉落 |
| `itemShields` | **即时护盾数组**（先到先吸收、盾碎抖屏） | `[{ hp, maxHp }]` | `addRunItem` 的 `shield` 分支 push；`level-flow.restart` 置 `[]` |
| `weapon` / `weaponType` / `weaponArt` / `scheme` / `charge` | **临时武器「使用中」会被替换** | 武器定义引用 / id / 方案 / 蓄力 | `useTempWeapon` 换、`cancelTempWeapon` 由 `scene.tempWeaponSaved` 还原 |
| `weaponIntroAt` | 武器本体出场动画计时起点（ms，与 `this.time.now` 同基） | number | `player-combat.js:equipWeaponByType` / `run-items-runtime.js:useTempWeapon`·`cancelTempWeapon` / `level-flow.js:restart` 写入（即「出武器」重播本体出场动画，渲染侧 `entity-art.js:drawPlayer` 用 `t*1000 - weaponIntroAt` 算渐显进度）；**局内运行时字段、不落存档** |
| `weaponBuffs` | **火堆武器祝福累积**（仅当局，不落存档） | `{ [weaponType]: [{ stat, op:'mul'\|'add'\|'set', value }] }` | `economy/weapon-buffs.js:addWeaponBuffs` 展开条目写入；`level-flow.js:restart` 置 `{}` |
| `buffedWeapon` | **当前已生效祝福的武器 id**（仅当局） | string \| null | `weapon-buffs.js:enterWeapon` 置为武器 id、`leaveWeapon` 清 null；是「同一武器不重复叠加」的判据 |

`player.combat` 字段（**全部来自存档，改动请同步 `economy-numbers`**）：`maxHp` `maxShield` `attackPower`(倍率,默认1) `attackSpeed`(倍率) `critRate`(0..1) `dodgeRate`(0..1) `moveSpeed`(倍率) `damageReduction`(倍率,越小越抗)。

**限时加成**（药水，仅当局）通过 `applyStatEffect(player.combat, type, mul, 1)` **直接乘算改 `player.combat` 上的字段**（`type` 即字段名，`mul = 1 + value/100`）；到期 `mul` 换 `1/mul` 精确回退，条目存 `scene.runEffects`。**临时武器**态存 `scene.tempWeaponActive` / `scene.tempWeaponSaved`（见 `economy-numbers` §3.4）。

### 3.2 `enemy`（由 `enemy-ai.js:initEnemy` 产出）

| 字段 | 含义 | 说明 |
|---|---|---|
| `type` | 敌人类型 | `basic1`/`basic2`/`advanced1`/`advanced2`/`mothership`/`boss-2-5t5`/`heavy-mech` |
| `r` | 碰撞半径 | **`(ENEMY_BEHAVIOR[type].size / 2) × scale`**（`scale` = 尺寸倍率，来自波次 > 关卡 `enemyDefaults[type]` > 1；预置敌人恒 1）。**在 `initEnemy` 里一次性算好，运行期不再变** |
| `hp` / `maxHp` | 血量 | `stats.hp ?? e.hp ?? ENEMY_TYPES[type].hp`（三层回落，见 §7 坑 60；预置敌人走 `normalizeEnemy` 落定的 `e.hp`） |
| `damage` | 撞击/子弹伤害 | `stats.damage ?? e.damage ?? ENEMY_TYPES[type].damage`（同上；`damage: 0` 是合法的显式覆盖） |
| `alive` | 存活标记 | `defeatEnemy` 置 false，不立即移出数组 |
| `artScale` | 美术缩放 | `(def.artScale ?? e.artScale ?? 1) × scale`（渲染端只读它 → 尺寸倍率同时改美术与 `r`；见 §7 坑 60） |
| `attackRange` | 开火距离 | advanced2 用（500） |
| `phase` | 行为阶段 | `approach` / 环绕 / 冲锋等 |
| `phaseTimer` | 阶段计时 | 秒 |
| `engaged` / `engageDelay` | 是否进入交战 | `ENEMY_BEHAVIOR.engageDelay` 延迟 |
| `enteredView` / `viewTimer` | 是否进过视野 | 决定是否开始行动 |
| `orbitAngle` / `orbitRadius` / `orbitDir` / `orbitTimer` | 环绕状态 | `ENEMY_BEHAVIOR.orbit` |
| `path` / `pathIndex` / `pathDirty` / `pathTargetX,Y` | A* 路径与路点游标 | 无视线时启用 |
| `fireClock` / `burstTimer` / `burstShots` | 点射节流 | advanced2 |
| `red` | 是否进入红色警戒外观 | `colorRange` 内变红 |
| `chargeTriggered` | 冲锋是否已触发 | advanced1 |
| `spin1` / `spin2` | 外观自旋角 | 渲染用 |
| `wanderDir` / `wanderT` | 游荡方向 | 未交战时 |

### 3.3 `bullet` / `enemyBullet` / `laser`

| 字段 | 玩家子弹 | 敌人子弹 | 激光 |
|---|---|---|---|
| `x` `y` | ✓ | ✓ | `x0,y0,x1,y1` |
| `vx` `vy` | ✓ (通常 500 px/s) | ✓ (`ENEMY_BULLET_SPEED`=400) | — |
| `dist` | 已飞行距离（拖尾长度用） | ✓ | — |
| `weaponType` | 用于查 `stepBullet`/`drawBullet` | — | ✓ |
| `level` | 发射时玩家等级 | — | — |
| `trailColor` | 拖尾颜色 | — | `color` |
| `damage` | 由 `playerDamage()` 结算 | 固定 `e.damage` | 即时判定 |
| `ricochet` / `split` | 改件标记 | — | — |
| `baseAngle` / `zigzag` / `scale` / `history` | yellow 专用（蛇形轨迹） | — | — |
| `trailLen` | — | 75 | — |
| `width` | — | — | 束宽 |
| `ttl` | — | — | 120ms |

其他战斗数组：`this.enemies` `this.bullets` `this.enemyBullets` `this.lasers` `this.hitEffects`（`{x,y,ttl}`，`ttl` 初值 `HIT_FX_TTL`）`this.crateDebris` `this.kills`。

### 3.4 墙体 `wall`（判定用）

`{ x, y, w, h, shape, thickness, rotation, visible, color }`。`shape` 支持 `rect`（默认）/ `circle`（用 `w/2` 当半径）/ `arc`（环带，附 `startAngle`/`endAngle`，判定落在 `w/2 ± thickness/2` 环带内且角度在跨度内）。完整 schema 见 `level-design` skill。

### 3.5 宠物 `pet`（由 pet-runtime.js:initPets 产出）

| 字段 | 含义 | 取值/来源 |
|---|---|---|
| `id` | 宠物物品 id | `pet-basic1` 等，来自 `equipment.pets` |
| `art` | 画板外形 id | `getPetDef(id).art`（renderAsset 绘制） |
| `radius` | 环绕玩家半径 | `getPetDef(id).radius` |
| `angularSpeed` | 环绕角速度（°/s） | `getPetDef(id).angularSpeed` |
| `size` | 宠物缩放 | `getPetDef(id).size` |
| `weapon` | 子弹弹道复用的武器 id | `getPetDef(id).weapon` |
| `damage` | 子弹伤害（命中用 `b.petDamage`） | `getPetDef(id).damage` |
| `fireInterval` | 开火频率（ms） | `getPetDef(id).fireInterval` |
| `maxHp` | 生命上限（0=无敌） | `getPetDef(id).maxHp` |
| `invincible` | 是否可被敌弹命中 | `!(hitActive && maxHp>0)` |
| `hp` | 当前生命 | 初始 = maxHp |
| `orbitAngle` / `aimAngle` / `fireClock` | 环绕相位 / 瞄准角 / 开火节流 | 运行时 |

`this.pets` 在 `game-scene.js:update` 的 `updatePets` 推进，`world-render.js:draw` 的 `drawPets` 绘制；敌弹命中判定在 `game-scene.js:update` 敌弹 filter 循环内。

**宠物定义 & 获取**：数值存 `data/pets/*.json`（含 `price` 金币与 `unlockLevel` 购买资格等级），`pet-design.js:normalizePetDesign` 归一化、`pet-store.js`(`getPetDef/listPetDefs/ensurePetDef/registerBuiltinPets`) 懒加载（启动 `registerBuiltinPets` 兜底内置，`loadPetDefs` 拉盘覆盖），`pet-board.js` 是可视化编辑器。商店 `pet` 页签由 `screens.js` 遍历 `listPetDefs()` 出卡，`buyPet` 扣款写入 `source.items.uniques`（不可堆叠），再从背包拖入装备槽（`equipment.pets`，上限 2）。玩家数据面板「宠物」区可勾「拥有/装备」用于测试（`ui.js:renderPreviewPets` + `player-panels.js:bindPetPanel`）。

### 3.6 `boss-2-5t5`（原型机-2-5T5）运行时字段与 `e.zones`

由 `enemy-ai.js:initEnemy` 的 `e.type === 'boss-2-5t5'` 分支初始化，配置来自 `e.bossCfg = normalizeBoss25T5Config(e.boss)`（82 键补全）。字段定义与全部 `??=` 兜底在 `combat/boss25t5.js`。

> **子弹侧标记**（`b.blockedBy` / `b.thawed` / `b.forceTrail` / `b.force` / `b.forceSrc` / `b.forceStepT` / `b.captured` / `b.captureAngle`）见 §3.7 —— 它们是「已转化子弹」的契约，与 BOSS 运行时字段成对出现。

| 字段 | 含义 |
|---|---|
| `bossActive` | 待机/激活。关卡的 `bossBattle` 触发器置 true（`triggers.js:startBossBattle`）；false 时无敌、不动、不放技能、无血条（`stepBoss25T5` 顶部早退） |
| `bossCfg` | 82 键配置对象（`BOSS25T5_DEFAULTS` 的补全结果，见 §5） |
| `shieldAlpha` / `shieldDown` / `shieldDownT` | 护盾透明度（渐显渐隐） / 是否消失中 / 消失计时 |
| `state` | 主状态机：`'move'｜'moveEnd'｜'skill'` |
| `moveKind` / `moveT` / `moveDur` / `moveDir` | 移动方式（①接近②快环绕③慢环绕④远离，4 选 1）与计时/方向 |
| `arc4Phase` / `arc5Phase` | 圆弧4/5 各自自转角（rad）。等待期（`moveWait>0`）以 `arcAlignDeg` 转向本次技能目标角；其余时间按 `arc4SpinDeg` / `arc5SpinDeg` 自由自转（`stepBoss25T5` 用 `rotateToward`） |
| `arc4OffsetDeg` / `arc5OffsetDeg` | 本次预选技能对应的两弧目标夹角（deg，带符号；`arcTargetsFor(cfg, pick)` 产出：参战弧 0、非参战弧停靠 `parkMinDeg..180°`，技能3 两弧皆 0） |
| `skillPick` | `boss25t5BeginMove` 按权重 `pickWeighted` 预选的技能 1/2/3 |
| `moveWait` / `moveDone` | 移动前/后等待期剩余 ms（>0 时不位移、护盾保持存在） / 位移是否走完 |
| `skillKind` / `skillPhase` / `skillT` / `skill4Cooldown` | 技能种类 / 相位 / 计时 / 技能4 触发冷却 |
| `zones` / `activeZoneId` | 技能区域数组 / 当前主导区域 id |
| `skill4Fx` | 技能4 灰色弧特效（一次性） |
| `hitFlashT` | 受击闪白剩余毫秒（`stepBoss25T5` 顶部递减） |

`e.zones[]` 元素契约（渲染端 `ui/boss25t5-art.js` 消费）：
`{ id, kind:'s1'|'s2'|'s3', x, y, a0, a1, rMin, rMax, phase:'extend'|'pause'|'anim'|'keep'|'fade', t, arcR, prevArcR, alpha, purpleAlpha, visMin, visMax, purplePolys }`
- `x/y` = **释放那一刻的 BOSS 世界坐标（世界锚定）**，之后所有几何判定与渲染都以它作扇形顶点，不再用实时 `e.x/e.y`（见 §7 坑）。
- `a0/a1` = 扇形起/止方位角（rad，可能跨 ±π，`a1-a0` 取最短正张角）—— **释放瞬间写死、全程不变（不跟随玩家 → 玩家可横向走出扇区躲避）**。角度命中容差改按像素级 `zoneHitPadPx`（默认 30px，仅 s1/s2，见 §6.2）。
- `phase` 生命周期：`extend`（延长线）→`pause`→`anim`（收紧/扩张弧）→`keep`→`fade`（保留 10s 后变淡消失）。
- `purplePolys`：`null`（s3 整区紫）｜`[]`（当前无重叠）｜`Array<Array<{x,y}>>`（s2 与各存活 s1 蓝区的楔形交集多边形，≥3 点）。
- `visMin` / `visMax`：渲染端实际绘制的径向范围（世界单位）。`anim`/`keep` 恒 `rMin..rMax`；`fade` 阶段**方向性收缩**——s1 的 `visMax` 由 `rMax` 收到 `rMin`（**从外向内**消失）、s2/s3 的 `visMin` 由 `rMin` 收到 `rMax`（**从内向外**消失）；`z.alpha` 恒为 1（**不再整体淡出**）。两侧延长线、s1/s2/s3 同心弧、s3 扇环填充/描边、黑遮罩都按它裁剪（渲染端 `boss25t5-art.js:drawZone`）。
- `purpleAlpha`：紫色**多边形**（`purplePolys`，技能2 的重叠区）无法径向裁剪 → 用它在 fade 阶段淡出；技能3 的整区扇环则同时享受方向性裁剪 + `purpleAlpha`。

### 3.7 `boss-2-5t5` 技能5「蓝色漩涡」（场景级实体，不挂在 BOSS 上）

| 结构 | 契约 | 说明 |
|---|---|---|
| `scene.boss25t5Vortices` | `Array<{ id, x, y, r, hp, maxHp, t, hitT }>` | `game-scene.js:58` 初始化。`r`=`s5Radius`、`hp/maxHp` 初值 `s5Hp`、`t`=存活毫秒（渲染相位）、`hitT`=玩家下次受伤倒计时。**只有玩家子弹能扣 HP**（`b.petDamage` 优先，否则 `this.playerDamage`）；已转化子弹（`b.blockedBy != null`）落进来只消灭该弹、**不扣 `v.hp`**、不计分 |
| 生命周期 | **不自动消散** | ① `hp<=0` 被击杀（`boss25t5VortexAbsorb` 里即时 `splice`，**无** `dying` 过渡字段，渲染端靠模块内自维护的 250ms 淡出环）→ 同时调 `boss25t5ReleaseCaptured(v.id)` 释放它捕获的全部弹；② `boss25t5ClearVortices()`（BOSS 死亡由 `enemy-ai.js:defeatEnemy` 调）；技能结束后仍留场 |
| `player.boss25t5Pull` | `{ vx, vy }`（px/s） | `boss25t5VorticesTick` 每帧先清零再按存活漩涡写入，吸力 `a = s5PullMin + (s5PullMax - s5PullMin) × clamp(1 - d/s5PullRadius, 0, 1)`（**进入吸力半径即受 `s5PullMin`**、越靠近涡心越强、涡心处 `s5PullMax`，半径外 0）；多漩涡向量累加后按 `Math.max(1, s5PullMax)` 钳速度上限；`game-scene.js:236-237` 在玩家移动处按与 `boss25t5Slow` 同写法叠加（**1 帧延迟**，可接受）；无漩涡时恒 `{0,0}` |
| `b.blockedBy` | 玩家子弹上的标记（BOSS id） | `boss25t5TryBlock` 拦截时写 `e.id`。**解冻 / 捕获 / 释放后一律保留** —— 它同时是「已转化子弹」的判定标记（`b.blockedBy != null`）：`boss25t5CfgFromBullet` 靠它找 BOSS、`enemy-ai.js:defeatEnemy` 靠它清残留弹（`x.blockedBy === e.id`）、`game-scene` 靠它跳过敌人伤害。清掉 → 三处同时失效（见 §7 坑 36） |
| `b.thawed` | 已解冻 | `boss25t5VortexPull` / `boss25t5ZoneBulletForce` 解冻时置 true；`boss25t5TryBlock` 首行 `if (b.thawed) return false;` → 不再被护盾反复拦（解冻弹起点正落在护盾面上，否则会在「冻结↔解冻」间横跳，见 §7 坑 32） |
| `b.forceTrail` | `{ width, length, color }` | 施力弹渲染契约（白色弹体 + 彩色拖尾）。颜色由写入方决定：技能1 `s1BulletTrail*`（蓝 #4fc3f7）/ 技能2 `s2BulletTrail*`（红 #ff3b3b）/ 技能5 `s5BulletTrail*`（蓝 #4fc3f7）。渲染端 `weapons.js:drawForceTrailBullet` 与 `weapon-runtime.js:drawForceTrailBullet` |
| `b.force` | `{ mode:'drag'|'push', ownerId, speed, remain } \| null` | 技能1/2 对已转化子弹施力的**一次性任务**（`remain` = 剩余距离 px）。`drag` 朝 owner（技能1）、`push` 背离 owner（技能2）；每帧按 `speed` 沿方向写 `vx/vy` 并 `remain -= speed*sec`，**不再无限加速**。停下条件：owner 不存在 / `remain<=stepLen`（距离用完）/ `drag` 且到 owner 距离 ≤ `innerRadius×artScale`（拖到圆弧1 内缘）→ `vx=vy=0; force=null`。参数：**速度复用玩家拖拽值**（s1 `s1DragSpeed`、s2 `s2PushSpeed`），**距离 = 玩家距离 × 2**（模块常量 `BULLET_FORCE_DIST_MULT`，即 s1 `s1DragDist`×2、s2 `s2PushDist`×2）。见 `boss25t5.js:1233 boss25t5ZoneBulletForce` |
| `b.forceSrc` | 区域 id | 已对该弹授予过施力的**区域 id**（写 `zone.id`）。同一区域只授予一次 —— 防止子弹停下后（`remain` 用尽）又被反复重新施加。见 `boss25t5.js:1288` |
| `b.forceStepT` | 帧令牌（`this.time.now`） | 本帧是否已推进过 `b.force` 的距离预算（同一帧多个调用点只扣一次 `remain`；`undefined` 时不去重）。见 `boss25t5.js:1240-1241` |
| `b.captured` / `b.captureAngle` | 被哪个漩涡捕获（漩涡 id）/ 环上角度（rad） | `boss25t5VortexCapture` 写 `captured=v.id` + 黄金角散布的 `captureAngle`，并清 `b.force=null`（丢弃未用完的施力任务）。捕获后该弹**不前进、不碰撞、不施力**，位置每帧由 `boss25t5VorticesTick` 驱动（贴在 `v.r * s5CaptureOrbitRatio`（默认 0.25）内层环，按 `s5CaptureSpinDeg`（默认 90°/s）公转，写 `x/y`、切线 `dirX/dirY`、`vx=vy=0`）。捕获数 ≥ `s5CaptureMax`（默认 16）→ 不再捕获，留给 `boss25t5VortexAbsorb` 直接消灭。消散（被击杀 / BOSS 死亡）→ `boss25t5ReleaseCaptured` / `boss25t5ClearVortices` 置 `captured=null` + 速度归零 + **清 `b.force`** = **静止停驻原处**（不带着剩余距离继续跑；仍是威胁、仍可被护盾消除） |

- 渲染：`ui/boss25t5-art.js:drawBoss25T5Vortices`（6 槽位蓝色同心弧「旋转 + 向心收缩 + 末段渐隐 + 原位重生」+ 中心白色刻度星环 + 上方细血条 + 击杀淡出环）；`world-render.js:582` 调它，`world-render.js:585` 调 `drawBoss25T5Zones` → 图层「漩涡 < 技能区域/黑遮罩 < 玩家」。
- 施力弹拖尾：`weapons.js:drawForceTrailBullet`（`radial.drawBullet` / `basic.drawBullet` 在 `b.blockedBoss` 分支**之后**接）与 `weapon-runtime.js:drawForceTrailBullet`（`drawBullet` 里 `b.forceTrail` 优先，跳过普通拖尾避免叠白线）——沿航向反向画彩色拖尾，长度/宽度只取 `b.forceTrail`、**不看 `b.dist`**；速度退化时沿用 `b.dirX/dirY`，仍无方向则只画白点。

### 3.8 休息火堆（矩形碰撞体 + 武器祝福）

| 结构 | 契约 | 说明 |
|---|---|---|
| `this.campfires` / `l.campfires` | 火堆数组（运行态 `this.campfires`，编辑态 `l.campfires`） | 元素 `{ x, y, w, h, visible, used, interactRadius }` |
| `campfireWalls()` | `Array<{ x, y, w, h, shape:'rect', rotation:0 }>` | `interactables.js`。`visible !== false` 才计入，**矩形口径与 vendor 一致（不用圆形）**；供子弹命中（`game-scene.js` 的 `wallAll` / ricochet `hitW`）与玩家·敌人移动碰撞（`enemy-ai.js:resolveMovementCollision`）共用 |
| `chestLockWalls()` | `Array<{ x, y, w:r*2, thickness:8, shape:'circle', rotation:0 }>` | `interactables.js`。**上锁宝箱的红色圆环**（`c.locked && c.spawned` 才计入；`r = state.js:chestLockRadius(c) = hypot(w,h)/2 + 4`）。圆形墙语义 = 实体永远被推到圆外，故玩家/敌人进不了环内。**碰撞只看 `locked` 布尔：事件一到即生效/失效；红环的渐显/渐隐（`chest.lockFx`/`lockAlpha`，`CHEST_LOCK_FADE_MS`）纯粹是显示，不参与碰撞**。五个消费点（移动 / `wallAll` / ricochet / 敌弹 / 激光）见 level-design §3.14 |
| `updateCampfireInteract(dt)` | — | 靠近最近火堆显示提示，按 F → `openCampfireOffer`（回血 / 杰作升级二选一）；`editing` 或 `state!=='playing'` 早退 |
| 武器祝福 `addWeaponBuffs` / `enterWeapon(scene, wt)` / `leaveWeapon(scene)` | `economy/weapon-buffs.js`（纯逻辑、**无 Phaser**，挂 `player` 不写存档） | 祝福按武器存 `player.weaponBuffs[wt]`；`enter` 生效、`leave` 用 `mul` 除 / `add` 减回退（与 §7 坑 44 同类互逆口径）；`op:'set'` 跳过；`stat==='maxHp'` 同步 `player.maxHp` 并夹紧 hp。**所有武器切换入口必须成对调用**，见 §7 坑 51 |

### 3.9 重装机兵（`heavy-mech`）运行时字段与激光

由 `enemy-ai.js:initEnemy` 的 `e.type === 'heavy-mech'` 分支初始化，数值来自 `e.mechCfg = normalizeHeavyMechConfig(e.mech)`（5 键补全）。

| 字段 | 含义 | 取值/来源 |
|---|---|---|
| `e.mechCfg` | 配置对象（`{ moveSpeed, rotateSpeed, aimSpeed, fireDelay, fireInterval }`） | `combat/heavy-mech.js:HEAVY_MECH_DEFAULTS` 补全 `e.mech` |
| `e.headAngle` | **头部朝向（rad）**：朝向玩家 / 停顿期保持锁定角。设计稿顶部的尖 = 头（默认朝上 `-π/2`） | `initEnemy` 置 `null` → 首帧按「玩家方向」初始化（= 生成时头朝玩家） |
| `e.firePhase` | 射击状态机：`'wait'`（冷却，移动）→ `'aim'`（瞄准线收拢，**原地不动**）→ `'align'`（方向已锁定 + 停顿，**原地不动**） | `initEnemy` 置 `'wait'` |
| `e.fireTimer` | 当前相位剩余毫秒：`wait` 用 `fireInterval`、`align` 用 `fireDelay` | `initEnemy` 置 `null` → 首帧取 `cfg.fireInterval` |
| `e.aimSpreadDeg` | 两条瞄准线的夹角（deg）：进入 `aim` 时 = `HEAVY_MECH_LASER.spreadDeg`(25)，以 `aimSpeed` °/s 收到 0 | — |
| `e.sightLines` | **两条瞄准线的端点**：`[{ x0, y0, x1, y1 }, { ... }]`（起点 = 蓝色多边形边缘 `sightStart×artScale`，逐条沿 `head ± spread/2` 算）。**线无限长：只被 `walls + bulletGateWalls()` 与关卡世界边界截断，没有长度上限** | `initEnemy` 置 `null`；`heavyMechUpdateSight(e)` 在 `aim`/`align` 相位每帧重算（`wait` 相位不重算，渲染端按 `firePhase` 门控不画）；渲染端零几何计算，只 `lineBetween` |
| `e.aimAngle` | **锁定后的激光方向（rad）**：夹角收到 0 的瞬间写 `e.headAngle`，`align` 期与激光发射都用它 | — |
| `scene.enemyLasers` | 激光光束数组（场景级，**不挂敌人**）：`{ ownerId, x0, y0, x1, y1, t, width, maxWidth, color }`。起止点在发射瞬间定死（起点 = 头顶尖前方 `muzzleOffset×artScale`，终点按墙 + 世界边界裁剪） | `heavyMechFireLaser` push；`updateEnemyLasers` 推进宽度与存活；`level-flow.js:restart` 置 `[]`；`defeatEnemy` 清该 owner 的光束 |

**相位时序（实测，默认值）**：`wait` 4000ms →（**进视野才计时**）→ `aim` 1000ms（夹角 25° 以 `aimSpeed`=25°/s 收拢）→ `align` 600ms → 发射（光束 180+300+320=800ms 后消失）→ 回到 `wait`。

## 4. 关键流程

### 4.1 玩家开火 → 命中
```
game-scene.js:update
  ├ 节流：this.fireClock <= 0 且鼠标按下
  ├ activeMods(scene, weaponType)                    economy/damage.js:38
  ├ WEAPONS[type].fire(player, level, scene)         weapons.js（返回 bullet[] 或 beam 元数据）
  │   └ green 返回 { beam:true } → spawnLaser()      weapons.js:199（即时判定+即时伤害）
  ├ 改件后处理：multi-track/triple 复制弹、spin 缩短间隔、ricochet/split 打标记
  ├ 扣弹药 this.player.ammo[wt]-- → tryRefillWeapon()  economy/drops.js
  └ this.fireClock = fireInterval / attackSpeed（spin 改件再 ×2/3）

每帧推进：this.bullets.filter(...)                    game-scene.js:472
  ├ ① b.captured 早退（捕获环绕：位置由 boss25t5VorticesTick 驱动）        :474
  ├ ② b.blockedBoss 早退（靠 boss25t5VortexPull/ZoneBulletForce 够得着则解冻）  :479
  ├ ③ b.wallFade 早退（停驻原地按 fadeDuration 渐隐）                     :484
  ├ ④ 位移 + b.dist 累加                                                :488
  ├ ⑤ 技能5 漩涡吸力 / 技能1·2 区域施力 → 捕获环绕 / 扣漩涡 HP          :497-500
  ├ ⑥ boss25t5TryBlock 护盾拦截（停驻变红 + blockedBoss/blockedBy）      :504
  ├ WEAPONS[type].stepBullet?.(b, dt, this)          yellow 蛇形在此
  ├ 蓄力武器表盘红弧穿环（航向角 + 「上帧→本帧」跨越弧圆）              :513
  ├ ricochet 分支：hitWall 命中 → reflectBulletAgainstWall  geometry.js（仍为单点判定；`hitW` 查找四来源 `l.walls || bulletGateWalls() || campfireWalls() || chestLockWalls()`，见 §7 坑 52）
  ├ 墙体命中：`const wallAll = [...l.walls, ...this.bulletGateWalls(), ...this.campfireWalls(), ...this.chestLockWalls()]` 用「上一帧→当前帧」线段 rayWallDistance 连续碰撞判定（**火堆矩形 / 上锁红环沿用 gate 同一份 wallAll、无新分支**，排在 gate 之后；防高速子弹隧穿；命中时子弹回退到墙面）
  ├ crate/barrel：crate 用 rayWallDistance 线段、barrel 用 pointSegmentDistance 点到线段判定
  └ 敌人命中：循环前 `const converted = b.blockedBy != null;` + `if (converted) break;`（已转化弹不伤敌人）→ pointSegmentDistance(e, 线段) < e.r → playerDamage() 扣血 → hitEffects.push → defeatEnemy

filter 之后（同一帧）：boss25t5UpdateBlocked(dt)  :676 → boss25t5VorticesTick(dt)  :680 → 敌人循环（stepEnemy + boss25t5ZonesTick  :687）；每帧交互调度（同帧、`if (!inputLocked)`）：`updateIdolInteract(dt)` :841 → `updateCampfireInteract(dt)` :842（火堆靠近/F 键）
```

### 4.2 敌人决策 → 位移
```
game-scene.js:update → 遍历 this.enemies
  ├ isInView(e)                        enemy-ai.js（相机可视矩形 viewRect）
  ├ stepEnemy(e, dt) / stepAdvanced2    enemy-ai.js（行为机主体；顶部按 type 派发
  │                                     mothership / boss-2-5t5 / heavy-mech）
  │   ├ hasLOS(x0,y0,x1,y1)            enemy-ai.js → geometry.js:rayWallDistance
  │   ├ 有视线 → moveToward（直线逼近，e.path 清空）
  │   └ 无视线 → stepToward（速度×2）→ findEnemyPath → pathfinding.js:findPath
  │        路点跟随：PATH_WAYPOINT_RADIUS = CELL*0.4，重算节流 PATH_REPATH_INTERVAL=0.25s
  ├ resolveEnemyCollision / resolveMovementCollision  enemy-ai.js
  │   └ geometry.js:resolveCircleAgainstWalls（圆体推出，含 circle/arc 特殊处理）
  │   └ 末尾写 entity.pushBack = 本帧被推回的距离（>0 = 顶住障碍，供卡墙判定）
  ├ updateEnemyStuck(e, dt)             enemy-ai.js（**卡墙自毁**：连续顶住障碍且窗口内净位移
  │                                     < ENEMY_STUCK_WINDOW_MOVE_PX 满 ENEMY_STUCK_KILL_MS → defeatEnemy）
  └ 环绕/冲锋分支由 ENEMY_BEHAVIOR[type] 的 orbit / charge 驱动

game-scene.js:update → stepEnemy → stepHeavyMech（重装机兵，不走通用行为机）
  ├ headAngle 按 rotateSpeed(°/s) 追踪玩家方向（align 期锁定不动）
  ├ wait：stepToward(cfg.moveSpeed) 逼近 + fireTimer 递减（不在视野内不递减）
  ├ aim ：原地不动，aimSpreadDeg 以 aimSpeed °/s 收 → 0 时写 aimAngle = headAngle（锁定）
  ├ align：原地不动，fireTimer = fireDelay → 到点 heavyMechFireLaser(e)
  └ updateEnemyLasers(dt)（game-scene.js:486 附近每帧，与玩家 lasers 的 filter 同级）
       └ 光束宽度：grow(180ms) → hold(300ms) → fade(320ms) → 移除（伤害已在发射瞬间单次结算）
```

### 4.3 敌人开火 → 玩家受伤
```
enemy-ai.js:fireEnemyBullet(e, b)        从 e 的环绕点位发射，速度 ENEMY_BULLET_SPEED
  └ this.enemyBullets.push({...damage: e.damage})

game-scene.js:update 敌弹推进
  ├ 先判护盾：player-combat.js:blockWithShield(x, y, damage, extraRadius)
  │    角度差 ≤ SHIELD.arcDeg/2 且距离 < weaponRingRadius + SHIELD.gap + extra → 扣盾 + 抖屏
  ├ 未被挡 → player-combat.js:damagePlayer(dmg)
  │    └ economy/damage.js:playerIncomingDamage（先闪避判定，再乘 damageReduction）
  │    └ 即时护盾吸收（在 playerIncomingDamage 之后、扣 HP 之前）：
  │         remaining = actual；按 player.itemShields 顺序 absorb = min(sh.hp, remaining)
  │         sh.hp<=0 → splice 移除 + hitEffects.push({color:SHIELD_HIT_COLOR}) + cameras.main.shake(SHIELD_SHAKE_MS, SHIELD_SHAKE_INTENSITY)
  │         remaining<=0 → 不扣 HP、不置 hitFlash，直接 return（playerIncomingDamage **只调用一次**）
  │    └ 新手关血量下限 NEWBEE_MIN_HP=5（永不失败）
  │    └ hp<=0 → this.triggerPlayerDefeat()（**玩家被击败失败流程**，幂等；带死亡运镜/黑幕，见 level-design §4⑨）
  └ 近身撞击走 player-combat.js:hitShield（先结算击杀，再走格挡）
```

> **三个失败入口统一走 `triggerPlayerDefeat()`**：`player-combat.js:damagePlayer`（血量归零）、`boss25t5.js:boss25t5KillPlayer`（守卫已改为 `if (this.state==='fail' || this.playerDeathFlow) return;`）、`game-scene.js` 母舰贴身秒杀分支（`mothershipSelfDestruct(e)` 仍在后）。流程（死亡运镜 → 黑幕保持 → 结算页）详见 level-design §4⑨。

### 4.4 敌人死亡 → 掉落
```
enemy-ai.js:defeatEnemy(e)
  ├ e.alive = false; this.kills++
  ├ BOSS 击破运镜：mothership / boss-2-5t5 且 cutsceneId → **`if (!this.playerDeathFlow)`** 才 `this.playCutscene(clip, {focusTarget:'boss', x:e.x, y:e.y})`（抑制：否则同帧顶掉死亡运镜 → `playerDeathFlow` 卡在 cinematic → 结算页永不出现，见 §7 坑 50）
  └ this.spawnDrops(e)   → economy/drops.js（掉落内容与概率详见 economy-numbers skill）
```

### 4.5 可破坏物
```
木箱：子弹命中 crate → destructibles.js:spawnCrateDebris(c)
     生成碎片，TTL = CRATE_DEBRIS_TTL(450ms)，由 world-render 绘制

油桶：子弹命中 barrel → destructibles.js:explodeBarrel(b)
     ├ 爆炸动画 BARREL_EXPLOSION_MS(100ms)
     ├ 范围内敌人受 BARREL_DAMAGE(30) → defeatEnemy
     └ 可连锁引爆相邻油桶
```

### 4.6 限时加成 / 临时武器 每帧推进

```
game-scene.js:update
  ├ 战斗处理（子弹 / 敌人 / 掉落）
  ├ this.updateRunItems(dt)          // 药水限时加成到期回退 + 临时武器倒计时
  │    runEffects 到期 → applyStatEffect(combat, type, statMul(value), -1) 回退并移除
  │    临时武器**仅「使用中」**扣 remainSec，归零 → cancelTempWeapon() + 清空 runTimedWeapons
  └ this.updateBattleItemsInput(dt)  // 数字键 5 切换临时武器 → toggleTempWeapon()
```

> `updateRunItems` 排在战斗处理**之后** → 本帧到期的加成晚一帧回退，可忽略。开火链路：临时武器「使用中」时 `player.weapon` 已是设计稿武器运行时条目，`WEAPONS[player.weaponType].fire/stepBullet/drawBullet` 照常走（`useTempWeapon` 会把主武器态存进 `scene.tempWeaponSaved`）。

### 4.7 武器切换（滚轮 / 按键 / 火堆选卡）

```
滚轮/按键：editor-camera.js:onWheel（deltaY 符号）→ switchWeapon(dir)   player-combat.js:91
火堆选卡：interactables.js:campfirePickUpgrade → equipWeaponByType(option.weaponType)   player-combat.js:103

switchWeapon(dir)                        // 只算槽位 + 委托（不含任何守卫/状态写入）
  ├ const n = player.weapons.length; if (n <= 1) return;
  └ const to = (player.weaponIndex + dir + n) % n; this.equipWeaponByType(player.weapons[to]);

equipWeaponByType(weaponType)            // 唯一执行体：全部守卫 + leave/enter + 动画
  ├ 守卫（任一命中 → return false 且**不改任何状态**）：
  │    !weaponType / weapons.indexOf(weaponType) < 0 / weaponType === player.weaponType / WEAPONS[weaponType] 缺定义
  ├ leaveWeapon(this)                    → 回退旧武器火堆祝福（economy/weapon-buffs.js）
  ├ 写 weaponIndex / weaponType / weapon / scheme / weaponArt
  ├ enterWeapon(this, weaponType)        → 应用新武器火堆祝福
  ├ weaponIntroAt = this.time?.now || 0  → 重播本体出场动画
  ├ wheelAnim = { from, to, t:0, dur:500 }  → 轮盘动画
  └ syncUIState() → 返回 true
```

> **唯一执行体**：武器轮内的类型切换（滚轮/按键/火堆）全部汇聚到 `equipWeaponByType`；`switchWeapon` 只剩「算槽位 + 委托」。临时武器入口（`useTempWeapon`/`cancelTempWeapon`）仍各自 `leave`/`enter`（见 §7 坑 51 / 54）。

## 5. 关键常量与数值

| 常量 | 位置 | 当前值 | 含义 | 调它影响 |
|---|---|---|---|---|
| `BULLET_DAMAGE` | `constants.js:65` | 10 | 无武器定义时的兜底伤害 | 极少走到 |
| `HIT_FX_TTL` | `constants.js:66` | 100 | 命中特效存活 ms | 特效闪现时长 |
| `HIT_FX_RADIUS` | `constants.js:67` | 40 | 命中特效绘制半径 | 特效大小 |
| `SHIELD` | `constants.js:58` | `{color:'#00eeff', arcDeg:120, gap:10, fadeMs:500}` | 护盾扇形角度/间距/淡入 | 格挡覆盖面 |
| `SHIELD_MAX` | `constants.js:59` | 50 | 护盾上限硬顶 | 存档 maxShield 天花板 |
| `SHIELD_SHAKE_MS` / `_INTENSITY` | `constants.js:60-61` | 150 / 0.004 | 挡弹 / **盾碎**抖屏 | 打击感 |
| 即时护盾 `itemShields` | `player-combat.js:damagePlayer` | `[{ hp, maxHp }]`（来源药水 `shield` 效果值，默认 50，对齐 `SHIELD_MAX`） | 药水护盾，先到先吸收 | 见 `economy-numbers` §3.4 |
| 限时加成 `applyStatEffect(combat,type,mul,dir)` | `economy/run-items.js` | `dir=1` 乘 `mul` / `dir=-1` 乘 `1/mul`（`mul = statMul(value) = 1 + value/100`） | 药水改 `player.combat` 字段 | **互逆乘算**，多层同类非严格可逆（见 §7） |
| 临时武器倒计时 | `run-items-runtime.js:updateRunItems` | 仅「使用中」扣 `remainSec`（时长来自表 `durationSec`，默认 15s） | 临时武器 | 归零自动 `cancelTempWeapon()` |
| 即时护盾外圈绘制 | `entity-art.js:drawItemShields` | 半径 `PLAYER_ART.weaponRingRadius + SHIELD.gap`、线宽 `weaponRingThickness*1.25`、`alpha = 0.35 + 0.6*clamp(hp/maxHp)`（多盾按 `i*6` 外扩） | 护盾视觉（360° 弧） | 详见 `ui-interaction` |
| `NEWBEE_MIN_HP` | `player-combat.js:23` | 5 | 新手关血量下限 | 新手关不会死 |
| `HIT_FLASH_RADIUS` | `player-combat.js:24` | 70 | 受击闪屏挖空半径 | 视野遮挡程度 |
| `radial.fireInterval` / `baseDamage` | `weapons.js:18-19` | 120ms / 10 | 基础武器 | 无限弹药主武器 DPS |
| `yellow.fireInterval` / `baseDamage` / `maxAmmo` / `chargeRequired` | `weapons.js:84-87` | 150ms / 8 / 45 / 5 | 散射：中心蛇形弹+左右15°侧弹 | 近距爆发 |
| `green.fireInterval` / `baseDamage` / `maxAmmo` / `chargeRequired` | `weapons.js:177-180` | 150ms / 16 / 30 / 8 | 激光：即时命中 | 单发最高 |
| 子弹速度 | `weapons.js` 各 `fire()` | 500 px/s | 玩家弹速 | 命中提前量 |
| yellow 蛇形幅度/周期 | `weapons.js:128-129` | 15° / 每 40px 换向 | 蛇形轨迹 | 弹道宽度 |
| `ENEMY_BULLET_SPEED` | `enemy-ai.js:26` | 400 px/s | 敌弹速度 | 躲避难度 |
| `PATH_REPATH_INTERVAL` | `enemy-ai.js:24` | 0.25s | A* 重算节流 | CPU vs 跟随精度 |
| `PATH_WAYPOINT_RADIUS` | `enemy-ai.js:25` | `CELL*0.4`=12 | 路点到达阈值 | 绕路平滑度 |
| `ENEMY_TYPES.basic1` | `state.js:7` | hp30 / dmg10 | 基础敌人1 | 前期难度 |
| `ENEMY_TYPES.basic2` | `state.js:8` | hp50 / dmg15 | 基础敌人2（会环绕） | — |
| `ENEMY_TYPES.advanced1` | `state.js:9` | hp80 / dmg20 | 进阶1（会冲锋） | — |
| `ENEMY_TYPES.advanced2` | `state.js:10` | hp100 / dmg15 | 进阶2（远程点射） | — |
| `ENEMY_TYPES.mothership` | `state.js:24` | hp1500 / dmg0 / art `asset-1788764178616` / artScale2 | 母舰（远距压迫，接触自爆） | 卡关级威胁 |
| `ENEMY_BEHAVIOR.basic1` | `constants.js:72` | size30 approach200 engage50 engageDelay0.4 colorRange300 | 接近距离/交战距离/变红距离 | 压迫感 |
| `ENEMY_BEHAVIOR.basic2` | `constants.js:73` | orbit `{period:2,duration:1,degPerSec:30}` spin4 | 环绕节奏 | — |
| `ENEMY_BEHAVIOR.advanced1` | `constants.js:74` | engage160 charge `{pause:0.6,speed:200}` | 冲锋前摇与速度 | 最危险近战 |
| `ENEMY_BEHAVIOR.advanced2` | `constants.js:75` | attackRange500 fireInterval400 burstInterval3000 burstCount3 speed30 | 三连点射节奏 | 远程压制 |
| `ENEMY_BEHAVIOR.mothership` | `constants.js:94` | size260 speed30 spawnInterval5000 spawnRadius220 | 母舰慢速逼近+每5s投放 | 压迫感/投放节奏 |
| `ENEMY_TYPES['heavy-mech']` | `state.js:34` | name 重装机兵 / **hp200** / **damage20**（= 激光单次伤害） / art `asset-1789394201289`（画板「重装机兵」） | 远程激光单位 | 血量与激光伤害 |
| `ENEMY_BEHAVIOR['heavy-mech']` | `constants.js:99` | **size100**（→ `e.r`=50）/ orbit·charge=null | 命中·碰撞半径；行为不走通用行为机（见 §6.2） | 命中判定范围 / 生成留白 |
| `HEAVY_MECH_DEFAULTS` | `combat/heavy-mech.js` | **moveSpeed40**（px/s）/ **rotateSpeed120**（°/s 头部追踪）/ **aimSpeed25**（°/s 夹角收拢）/ **fireDelay600**（ms 停顿）/ **fireInterval4000**（ms 冷却） | 编辑器 `mech.*` 面板五项（**血量走顶层 `e.hp`**） | 整套激光节拍 |
| `HEAVY_MECH_LASER` | `combat/heavy-mech.js` | **spreadDeg25** / **width26**（px，×artScale）/ **growMs180** / **holdMs300** / **fadeMs320** / **muzzleOffset60**（×artScale）/ **sightStart20** / **color`#5cf4ff`** | 瞄准线与激光表现（代码常量，不进面板）。**瞄准线无长度常量**——无限长、只被墙/关卡边界截断（端点见 `e.sightLines`） | 瞄准线宽窄与激光粗细/时长 |
| `MOTHERSHIP_SPAWN_TABLE` | `constants.js:87` | basic1×5 / basic2×6 / advanced1×2 / advanced2×1 | 母舰投放表（每5s等概率随机一组） | 投放组成 |
| `ENEMY_STUCK_KILL_MS` | `constants.js:110` | **5000**（ms） | 卡墙自毁：累计「顶住障碍且窗口内几乎没净位移」达到此值 → `defeatEnemy` | 残留怪阻塞波次的最长时长 |
| `ENEMY_STUCK_WINDOW_MS` | `constants.js:111` | **1000**（ms） | 评估窗口（逐窗口看净位移，避开被顶住时的逐帧抖动） | 判定粒度 |
| `ENEMY_STUCK_WINDOW_MOVE_PX` | `constants.js:112` | **15**（px / 窗口） | 窗口内净位移 < 此值算「没挪动」（= 平均 < 15px/s；正常敌人 ≥ 30px/s 一定重置） | 误杀阈值 |
| `ENEMY_STUCK_PUSH_EPS` | `constants.js:113` | **0.1**（px） | 窗口内 `pushBack` 超过此值才算「顶住障碍」（排除原地待机怪） | 误杀阈值 |
| `ENEMY_TYPES['boss-2-5t5']` | `state.js:31` | name 原型机-2-5T5 / hp1500 / dmg0 / art `asset-1788964413981` | 第二类特殊 BOSS（**血量看敌人顶层 `e.hp`**，`boss.hp` 仅占位） | 卡关级威胁 |
| `ENEMY_BEHAVIOR['boss-2-5t5']` | `constants.js:85` | size160（→ `e.r`=80）/ orbit·charge=null | 命中·碰撞半径；行为不走通用行为机（见 §6.2） | 命中判定范围 |
| `BOSS25T5_DEFAULTS` | `combat/boss25t5.js:185` | **82 键（实测）（删 2 加 2）**：name / hp1500 / moveSpeed30 / moveWaitPreMs·PostMs2000 / approachMin·MaxMs2000·4000 / spinFastDeg180·spinFastMs800 / spinSlowDeg10·spinSlowMs3000 / fleeMin·MaxMs2000·4000 / shieldRadius220 / shieldFadeMs400 / shieldRestoreDelayMs600 / arcRadius185 / arcSpanDeg45 / arc4SpinDeg30 / arc5SpinDeg57.3 / arcAlignDeg180 / innerRadius80 / arc2Radius65 / s1=s2=s3Range1500 / s1DragSpeed2000·s1DragDist500 / s2PushSpeed2000·s2PushDist500 / s4PushSpeed2000·s4PushDist800·s4Damage20 / mergeOverlapPct20 / parkMinDeg108 / skillWeightS1·S2·S3=40·40·20 / skillWeightS5=20 / s2Damage20 / blockedBulletDamage10 / shieldClearCost10 / s1·s2·s5BulletTrailWidth6·Length40·Color（s1 `#4fc3f7` 蓝 / s2 `#ff3b3b` 红 / s5 `#4fc3f7` 蓝）/ s5HpPct50 / s5CastMs3000 / s5SpawnDist600 / s5Radius150 / s5Hp500 / s5PullRadius900 / s5PullMin40 / s5PullMax160 / s5BulletPull900 / s5HitIntervalMs500 / s5HitDamage15 / s5CaptureMax16 / s5CaptureOrbitRatio0.25 / s5CaptureSpinDeg90 / cutsceneId'' + **本轮改动**：删 `zoneAimTrackDeg`（旧口径「成型期扇形跟随玩家瞄准 °/s」——**已废弃**：跟随会让扇形一直罩住玩家、玩家无法走出躲避）+ 删 `s5PullAccel`（旧口径：单一吸力加速度，**已废弃**）→ 加 `s5PullMin40`（**吸力半径边缘处**的吸力 px/s）+ `s5PullMax160`（**涡心处**的吸力 / 向量累加后的速度上限 px/s；**必须 < 玩家移速 180**），`s5PullRadius900` **保留**（吸力生效半径），净值仍 82 键；**上一轮新增 1 键**：`zoneHitPadPx30`（技能1/2 命中**像素级**容差 —— 判定区最多只超出绘制扇形斜线 30px，不再随距离放大；s3 不参与）；**上一轮删除 3 键**：`zoneHitPadDeg`（固定角度容差，已被 `zoneHitPadPx` 取代）、`s1BulletForce` / `s2BulletForce`（每帧加速度 → 技能1/2 施力改为**一次性固定速度+固定距离**：速度复用玩家的 `s1DragSpeed`/`s2PushSpeed`，距离 = 玩家的 `s1DragDist`/`s2PushDist` × 2）；**上一轮改名**：技能5 拖尾宽/长两个旧键（`…RedTrailWidth` / `…RedTrailLength` 形态）→ 统一为 `s5BulletTrailWidth` / `s5BulletTrailLength`（`normalizeBoss25T5Config` 只按 `BOSS25T5_DEFAULTS` 的键产出一份新对象，旧键被丢弃；`data/levels/Boss2-Test.json` 里的 4 / 250 已随改名保留） | BOSS 全部可配数值入口（编辑器 `boss.*` 面板写入 `e.boss`） | 技能节奏/范围/伤害/占比 |
| `BARREL_DAMAGE` | `constants.js:35` | 30 | 油桶爆炸伤害 | 环境击杀强度 |
| `BARREL_EXPLOSION_MS` | `constants.js:36` | 100 | 爆炸动画时长 | — |
| `CRATE_DEBRIS_TTL` | `constants.js:37` | 450 | 木箱碎片存活 ms | — |
| `PLAYER_COLLISION_RADIUS` | `constants.js` | — | 玩家碰撞半径 | 卡墙手感 |
| `CELL` | `constants.js:9` | 30 | 寻路网格与吸附单位 | 全局 |
| `PATH_INFLATE` | `level/level-flow.js` | 24 | 寻路网格障碍膨胀 | 敌人贴墙程度 |

> **技能5 吸力调参（判据，见 §7 坑34）**：吸力公式 `a = s5PullMin + (s5PullMax - s5PullMin) × clamp(1 - d/s5PullRadius, 0, 1)`（`boss25t5.js:boss25t5VorticesTick`）。**进入吸力半径即受 `s5PullMin`**（吸力半径 `s5PullRadius` 边缘处 = min），越靠近涡心吸力线性增强，涡心处 = `s5PullMax`；半径外为 0。默认 `s5PullRadius=900 / s5PullMin=40 / s5PullMax=160`，实测 d=900→40、d=450→100、d→0→160、d>900→0（随距离**单调递增**）；多漩涡向量累加后按 `Math.max(1, s5PullMax)` 钳速度上限（三漩涡叠加封顶 160），消费点 `game-scene.js:236-237`（与 `boss25t5Slow` 同写法叠加）。**`s5PullMax` 必须小于玩家基础移速 `baseSpeed = 180`**（`game-scene.js:228`）—— 否则玩家被吸住后永远挣脱不了，表现为「按住方向键也不动」。`data/levels/Boss2-Test.json` 实配 `s5PullMin: 40` / `s5PullMax: 165`（用户手调，< 180 ✓；要加大手感就得同步确认玩家移速）。子弹侧吸力 `s5BulletPull: 900`（px/s²，未变）是另一条口径，本次只改玩家吸力的 min/max。同时 `boss25t5CastSkill5` 的生成点要求「与玩家之间无墙」且先钳制再判可达，避免涡心落在墙另一侧。

改件效果（定义在 `state.js:ITEM_DEFS`/`MOD_DEFS`，生效点在 `game-scene.js:update` 与 `weapons.js`）：`multi-track` 多轨复制弹、`triple` 三发、`spin` 射速+50%（间隔×2/3）、`ricochet` 撞墙反弹、`split` 分裂、`pierce` 激光穿墙、`capacity` 扩容。数值细节见 `economy-numbers`。

## 6. 扩展指南

### 6.1 新增一种武器
1. `src/systems/combat/weapons.js` 的 `WEAPONS` 加一项，必填 `scheme` `ringColor` `fireInterval` `baseDamage`，可选 `maxAmmo`（不填=无限）`chargeRequired`。
2. 实现 `fire(player, level, scene)`：返回 bullet 数组（每个至少含 `x,y,vx,vy,dist,weaponType,level,trailColor`）；若是即时命中类，返回 `{ beam:true, ox, oy, angle, width, color }` 并在 `game-scene.js:update` 的 beam 分支接上（参考 `green`）。
3. 需要特殊弹道则实现 `stepBullet(b, dt, scene)`；需要自定义外观实现 `drawBullet(g, b)`（`g` 是 Phaser Graphics）。
4. `src/state.js` 的 `WEAPON_TYPES` 与 `WEAPON_LABELS` 各加一条（否则 UI 显示 id）。
5. 若要能购买/解锁：`data/ui/weapon.json` 加 `prices` 条目（详见 `economy-numbers`）。
6. 武器轮图标：`src/ui-layer.js:drawWeaponGlyph` 加分支（详见 `ui-interaction`）。
7. **设计稿武器改 `bullet.speed`/`range` 时注意隧穿**：`bullet.range` 越大越安全（Range 只控制淡出），但 `bullet.speed` 一旦超过 ~2000px/s（每帧位移 > 墙厚/敌人半径）就会穿墙漏检。此时命中判定已用连续碰撞（§7.20），无需再改代码；若新建平行弹道逻辑，务必沿用「上帧→当前帧」线段判定而非逐帧点判定。

### 6.2 新增一种敌人行为
1. `src/state.js:ENEMY_TYPES` 加类型（`hp` / `damage` / `name`）。
2. `src/systems/constants.js:ENEMY_BEHAVIOR` 加同名条目（`size` 必填，其余按需：`approach` `engage` `engageDelay` `colorRange` `orbit` `charge` `spin` `attackRange` `fireInterval` 等）。
3. `enemy-ai.js:initEnemy` 若需要新的运行时字段，在返回对象里补默认值。
4. 行为逻辑：简单变体直接吃 `ENEMY_BEHAVIOR` 参数即可；复杂的仿照 `stepAdvanced2` 新写一个 `stepXxx`，并在 `stepEnemy` 里按 `e.type` 分派。
5. 外观：`src/systems/ui/entity-art.js:drawEnemyShape` 加分支（详见 `ui-interaction`）。
6. 关卡里能配出来：`level-design` skill 的敌人字段。

> **重装机兵（`heavy-mech`）是第三类特殊敌人**（不走母舰/BOSS 范式，也不走通用行为机）。自检 8 处接线：
> ① `state.js:ENEMY_TYPES['heavy-mech']`（art 用 `HEAVY_MECH_ART`）+ `constants.js:ENEMY_BEHAVIOR['heavy-mech']`（size100 → `e.r`=50）
> ② `state.js:normalizeEnemy` 的 `mech` 按 type 分派（`type === 'heavy-mech' ? normalizeHeavyMechConfig(enemy?.mech) : null`）——漏了则编辑器配的 5 项落盘→读回被静默丢弃
> ③ `enemy-ai.js:initEnemy` 的 `heavy-mech` 分支显式初始化全部运行时字段（`mechCfg/headAngle/firePhase/fireTimer/aimSpreadDeg/aimAngle`，与 `stepHeavyMech` 的 `??=` 兜底一一对应）
> ④ `enemy-ai.js:stepEnemy` 顶部派发 `stepHeavyMech(e, dt, sec)` + 四个方法 `stepHeavyMech`/`heavyMechUpdateSight`/`heavyMechFireLaser`/`updateEnemyLasers`（另有模块级私有 `rayDir`/`aimRay`：近零分量归零 + 射线到墙/边界求长，**瞄准线与激光共用这一份几何**）
> ⑤ `game-scene.js:update` 每帧 `this.updateEnemyLasers(dt)`（与玩家 `this.lasers` 的 filter 同级，`:486` 附近）+ `restart` 里 `this.enemyLasers = []`
> ⑥ 接触伤害排除：`e.type !== 'heavy-mech'`（远程单位，伤害由激光承担，与 advanced2 同口径）
> ⑦ `defeatEnemy` 清理该敌残留光束（`this.enemyLasers.filter(bs => bs.ownerId !== e.id)`）
> ⑧ 渲染：`ui/heavy-mech-art.js`（`drawHeavyMechSight` 只按 `e.sightLines` 画/`drawHeavyMechBody`/`drawHeavyMechBeams`）+ `entity-art.js:drawEnemyShape` 分支（`getDesign(e.art || HEAVY_MECH_ART)`，编辑器里 art 为空串也能出图）+ `world-render.js` 的 `drawHeavyMechBeams(g, this.enemyLasers)`（在玩家 lasers 之前）。**瞄准线不做长度上限**：端点每帧由战斗侧 `heavyMechUpdateSight` 算（只被墙/关卡边界截断），渲染端**不得**自己算几何或截断，否则会出现「线穿过墙」或「线在半空断掉」。
> **编辑器可配 5 项**：`entity-properties.js` 敌人分支的 `mech.*` 面板（血量走顶层 `hp`，大小走顶层 `artScale`）。默认值集中在 `HEAVY_MECH_DEFAULTS`，无表格来源。

> **母舰（`mothership`）是特殊敌人，不走通用行为机**，自检以下 7 处（默认值集中 `constants`/`state`，可被关卡预置条目覆盖）：
> ① `ENEMY_TYPES.mothership`（`art`/`artScale` 进 `initEnemy`） ② `ENEMY_BEHAVIOR.mothership` + `MOTHERSHIP_SPAWN_TABLE`（`constants.js`）
> ③ `enemy-ai.js:stepEnemy` 顶部派发 `stepMothership`（慢速逼近+hitFlashT 递减+按 `e.boss.spawnInterval`/`e.boss.spawnTable` 周期 `spawnMothershipMinions`）；`initEnemy` 补 `bossActive:false`+`boss:{spawnInterval,spawnTable,name}`
> ④ `game-scene.js` 敌接触循环母舰分派（**Hitbox 用风筝形非圆**）：撞盾=清盾+`mothershipSelfDestruct`（`mothershipBodyDist<radius`）；贴身=秒杀(`triggerPlayerDefeat()`)+自爆（`mothershipBodyDist<player.r`；`mothershipSelfDestruct(e)` 仍在后）；母舰命中用 `mothershipBulletHit`（`geometry.js`，含 `mothershipPolyVerts`/`mothershipBoundsR`），受击置 `e.hitFlashT=100`
> ⑤ `entity-art.js:drawEnemyShape` 母舰分支：把设计稿相位偏转 `θ+π/2`（θ=敌→玩家方向）使长尖始终朝向玩家；`e.hitFlashT>0` 时对该设计元素 `fill:'#ffffff'`，把整个四边形（描边轮廓）填为实白
> ⑥ 生成点走 `spawning.js:spawnMothership`（整圆穿墙排除+三档兜底保生成，防大身体卡墙/波次空转），经既有波次 `mode:'offscreen'` 触发
> ⑦ Boss 化：母舰**预置**在关卡 `l.enemies[]`（`level-flow:283` 经 `initEnemy` 入队），`bossActive=false`=待机（无敌、不移动、不召唤、无血条，`stepMothership` 顶部早退；`game-scene` 子弹/接触/轨道命中都加 `&& e.bossActive`）。踩带 `bossBattle` 事件的触发器 → `triggers.js:startBossBattle(ev)`：`boss.bossActive=true; this.bossTarget=boss; this.bossBarReveal=0`；UI 血条见 `ui-interaction`（`drawBossBar`/`updateBossBar`）。大小=条目 `artScale`（编辑器「大小」字段）；`bossBattle` 事件类型双份维护（`state.js:EVENT_TYPES` 与 `editor/entity-properties.js:eventTypeOptions`）。

> **原型机-2-5T5（`boss-2-5t5`）是第二类特殊 BOSS**（不走母舰范式，`bossActive` 待机语义与母舰一致）。自检以下 10 处接线：
> ① `state.js:ENEMY_TYPES['boss-2-5t5']`（art 指向 `asset-1788964413981`）+ `constants.js:ENEMY_BEHAVIOR['boss-2-5t5']`（size160 → `e.r`=80）
> ② `state.js:normalizeEnemy` 的 `boss` 按 type 分派：`boss-2-5t5` 走 `normalizeBoss25T5Config`（其余走母舰形状；非 Boss 敌人为 null）
> ③ `enemy-ai.js:initEnemy` 的 `boss-2-5t5` 分支显式初始化全部运行时字段（`bossActive/bossCfg/shieldAlpha/state/zones/...`，与 `??=` 兜底一一对应）
> ④ `enemy-ai.js:stepEnemy` 顶部按 `e.type` 派发 `stepBoss25T5`（`enemy-ai.js:134`）
> ⑤ `game-scene.js` 子弹 filter（`:472` 起，**顺序即契约**）：① `if (b.captured) return !b.dead;`（`:474`，捕获环绕早退）→ ② `b.blockedBoss` 早退（`:479`；够得着时由 `boss25t5VortexPull`/`boss25t5ZoneBulletForce` 解冻并置 `blockedBoss=false`）→ ③ `b.wallFade`（`:484`）→ ④ 位移（`:488-491`）→ ⑤ `boss25t5VortexPull` + `boss25t5ZoneBulletForce`（`:497-498`）→ ⑥ `boss25t5VortexCapture` 保留该弹（`:499`）/ `boss25t5VortexAbsorb` 消灭（`:500`）→ ⑦ `boss25t5TryBlock` 拦截停驻变红（`:506`）→ ⑧ 敌人循环前 `const converted = b.blockedBy != null;` + 循环首行 `if (converted) break;`（`:601`/`:603`，已转化弹不再伤敌人/BOSS）；受击判定加 `boss25t5ShieldActive`（护盾存在时不扣血，`:610`）；filter 之后 `boss25t5UpdateBlocked(dt)`（`:676`）+ `boss25t5VorticesTick(dt)`（`:680`）
> ⑥ `game-scene.js` 敌人循环每帧 `boss25t5ZonesTick(e, dt)`（`:687`，**漏调 = 技能永不结束、BOSS 卡死 skill 态、区域永久定格**）
> ⑦ `game-scene.js` 玩家移动消费 `player.boss25t5Slow`（×0.05，`:231`）；接触伤害/撞盾反杀排除 `boss-2-5t5`（伤害只走技能区域）
> ⑧ 玩家子弹命中半径 `e.r`=80；受击仅在护盾消失时生效，命中置 `e.hitFlashT=100`
> ⑨ `triggers.js:startBossBattle`（`:65`）与 `editor-camera.js:_resolveFocusTarget`（`:254`）的 BOSS 查找都含 `boss-2-5t5`
> ⑩ 渲染：`ui/boss25t5-art.js`（`drawBoss25T5Body`/`drawBoss25T5Zones`/`drawBoss25T5Vortices`）+ `entity-art.js:drawEnemyShape` 分支 + `world-render.js` 在 `drawPlayer` 之前调 `drawBoss25T5Vortices`（`:582`）/ `drawBoss25T5Zones`（`:585`）
> 失败清理：`enemy-ai.js:defeatEnemy` 支持其运镜（读 `e.bossCfg.cutsceneId`）并清理被拦截弹；死亡后重置 `player.boss25t5Slow`。
> **技能种类 = 权重预选；释放方向恒为玩家方向；参战弧等待期对准玩家**：`boss25t5ChooseSkill` 只做 `boss25t5StartSkill(e, cfg, e.skillPick || 1)`（夹角窗口/距离/扇区等几何判定已全部移除）；`boss25t5BeginMove` 用 `pickWeighted(skillWeightS1/S2/S3)`（默认 40/40/20）预选本次技能，并用 `arcTargetsFor(cfg, pick)` 给出两弧相对瞄准方向的目标角（参战弧 → `0` 对准玩家、非参战弧 → 停靠到 `parkMinDeg..180°` 的侧后方，技能3 → 两弧都是 `0` 视觉合并）；`boss25t5StartSkill` 里区域方向恒以「BOSS → 玩家」为中心（`a0/a1 = aim ± span/2`），故三技能都对准玩家、不空放；`stepBoss25T5` 仅在等待期（`e.moveWait>0`，BOSS 静止）用 `rotateToward` 以 `arcAlignDeg`(180°/s) 对齐，其余时间按 `arc4SpinDeg`/`arc5SpinDeg` 自由自转 → 实测占比 ≈ 4:4:2（38.7/38.7/22.5）。改技能类型/瞄准逻辑须四处同改，见 §7 坑 26。
> **护盾窗口由「等待期 + 恢复延迟」决定**：移动前/后各有一次等待期（`moveWaitPreMs`/`moveWaitPostMs`，默认 2000ms）期间 BOSS 不位移、**护盾保持存在**（玩家可打本体）；技能释放期间 + 结束后 `shieldRestoreDelayMs`（默认 600ms）内护盾消失（`e.shieldDown`）。实测护盾存在时长占比 ≈ 53.7%。

> **技能5「蓝色漩涡」接线点**：`boss25t5PickSkill`（半血阈值 `s5HpPct`：未过半血只抽 S1/S2/S3，过半血按 S1/S2/S3/S5 权重抽）由 `boss25t5BeginMove` 调 → `boss25t5ChooseSkill` 的 `skillPick===5` 分支调 `boss25t5CastSkill5`（生成场景级漩涡、`activeZoneId=null` 无 zone）；`stepBoss25T5` 的 `state==='skill'` 分支 `skillKind===5`（技能动作时长 = `s5CastMs`，结束后与其它技能一致 `shieldDownT=shieldRestoreDelayMs` + `boss25t5BeginMove`）。**每帧调用点两处**：`stepBoss25T5` 顶部（在 `if (!e.bossActive) return;` **之前**，保证 BOSS 待机时既有漩涡仍推进）与 `game-scene.js:680`（保底），`boss25t5VorticesTick` 内部帧令牌去重。子弹侧（`game-scene.js:472` 起的 filter）依次接 `boss25t5VortexPull`（`:497`，漩涡吸力 + 解冻）/ `boss25t5ZoneBulletForce`（`:498`，技能1/2 吸推 + 按技能配色写 `forceTrail`）/ `boss25t5VortexCapture`（`:499`，已转化弹 → 捕获环绕，保留该弹）/ `boss25t5VortexAbsorb`（`:500`，普通弹扣漩涡 HP、已转化弹直接消灭）；漩涡消散走 `boss25t5ReleaseCaptured`（`boss25t5VortexAbsorb` 击杀时）与 `boss25t5ClearVortices`（`enemy-ai.js:defeatEnemy`）；渲染 `world-render.js:582` 调 `drawBoss25T5Vortices`（在 `:585` 的 `drawBoss25T5Zones` 之前）。
> **技能1/2 对已转化子弹施力（一次性固定速度+固定距离）+ 像素级命中容差 + 扇形方向固定（不跟随玩家）**：`boss25t5ZoneBulletForce`（`boss25t5.js:1224`）只作用于 `blockedBy != null` 的弹，遍历战斗中 BOSS 的 `s1`/`s2` 区域（相位限 `anim`/`keep`、`b.forceSrc !== z.id`、子弹落在扇形 `[visMin,visMax] × [a0,a1]` 内）→ 授予一次性任务 `b.force={mode,ownerId,speed,remain}` + 写 `b.forceSrc=z.id`；当帧即写速度、解冻（`blockedBoss=false; thawed=true`）、写按技能配色的 `forceTrail`。**速度复用玩家拖拽值、距离 = 玩家距离 × 2**（模块常量 `BULLET_FORCE_DIST_MULT`：s1 `s1DragSpeed` + `s1DragDist`×2，s2 `s2PushSpeed` + `s2PushDist`×2；方向取 BOSS **实时坐标**），每帧按 `speed` 写 `vx/vy` 并扣 `remain`（帧令牌 `b.forceStepT` 去重防同帧重复扣），**距离用尽 / owner 消失 / drag 拖到圆弧1 内缘即停（`vx=vy=0; force=null`）**；**没有速度上限钳制**（速度就是配置的拖拽/击退速度）。返回值 = 本次是否新授予任务（`game-scene` 冻结弹解冻判定依赖）。
> **命中容差（像素级）**：`boss25t5ZonesTick` 第三趟用 `const padPx = Math.max(0, cfg.zoneHitPadPx||0); const hitPad = (padPx>0 && z.kind!=='s3') ? padPx/Math.max(1,d) : 0;`（`boss25t5.js:723-724`）→ 判定区最多只超出绘制扇形斜线 `padPx`(30) 像素，**不再随距离放大**（旧固定 12° 在 `s2Range=1500` 处 ≈314px）；**s3（紫色秒杀）不参与**。
> **扇形方向释放时固定、不跟随玩家（旧口径 `zoneAimTrackDeg` 已删除）**：`boss25t5StartSkill` 在释放瞬间按 `aim ± span/2` 写死 `z.a0/z.a1`，之后 `boss25t5ZonesTick` **全程不再改方向** —— 刻意这么做：**扇形若跟随玩家就会一直罩住玩家、玩家无法走出扇区躲避**；方向固定后玩家横向走出扇区即可躲开。命中只保留**像素级**容差 `zoneHitPadPx`(30px，**仅 s1/s2**，s3 为 0)，见上一条。

### 6.3 新增一种可破坏物
1. `src/state.js` 加 `normalizeXxx` 与关卡字段（参考 `normalizeBarrel`）。
2. `src/systems/combat/destructibles.js` 加 `DestructiblesMixin.breakXxx(obj)`，写清连锁与伤害。
3. `game-scene.js:update` 的子弹命中段加该类型的碰撞判定（用 `geometry.js:hitWall` 或圆判定）。
4. 精灵同步与绘制：`src/systems/ui/world-render.js` 加 `syncXxxSprites`（详见 `ui-interaction`）。
5. 常量放 `constants.js`（伤害/时长/尺寸）。

### 6.4 改动护盾机制
1. 覆盖面/耐久：`constants.js:SHIELD`（`arcDeg` 扇形角、`gap` 与玩家的间距）、`SHIELD_MAX`。
2. 判定逻辑：`player-combat.js:blockWithShield`（角度差用 `Phaser.Math.Angle.Wrap`，距离基准是 `PLAYER_ART.weaponRingRadius + SHIELD.gap + extraRadius`）。
3. 破盾规则：`player-combat.js:hitShield`（注意它**先结算击杀再走格挡**，改顺序会影响撞盾同时反杀的表现）。
4. 视觉：`entity-art.js:drawShieldArc` + `SHIELD.fadeMs` 淡入淡出。

### 6.5 新增一种宠物
1. 在 `data/pets/<id>.json` 加定义（经 `pet-design.js:normalizePetDesign` 归一化），必填 `art`(画板资产id) `radius` `angularSpeed` `size` `weapon`(武器id) `fireInterval` `damage`；生命相关可选 `maxHp`(0=无敌) `hitActive`(是否可被敌弹命中)；购买相关 `price`/`unlockLevel`。机制（环绕+朝最近敌人开火）已硬编码，无需新代码。编辑器用 `pet-board.js` 可视化改数值。
2. `src/state.js` 的 `ITEM_DEFS` 加同 id 物品（`category:'pet'`，`icon` 填画板资产 id，`effect` 写机制说明）。否则装备槽归一化（`normalizeItemList`）会漏掉它。
3. 战斗接入：`initPets` 读 `player.equipment.pets` 与 `pet-store.getPetDef(id)` 自动生成，无需改装配/update。宠物子弹复用 `weapon` 武器的 fire/drawBullet/stepBullet，命中用 `b.petDamage`。
4. 打包端需 `registerBuiltinPets()`（`default-pets.js`）兜底内置，否则无 `/api/pets` 服务器时定义为空、宠物不生成。

### 6.6 特殊机制武器（设计稿 `mechanic` 字段驱动）
普通武器弹道是「封闭模板」，新奇机制用 `weapon-design.js:normalizeMechanic` 字段激活（`weapon-runtime.js:buildWeaponRuntimeEntry` 把 `mechanic` 挂到 `WEAPONS[wt]`），机制行为在 combet 侧按字段分支：
- **`aim:'mouse'`** 鼠标准心：`game-scene.js:update` 里 `weaponAngle` 改为指向 `cameras.main.getWorldPoint(pointer)`，发射环小球+瞄准线不再自动旋转。
- **`charge`** 蓄力射击：按住蓄力（`player.charge` 0..1），松开发射。`fire` 按 charge 把随机散射 `spreadMax*(1-charge)→0`、速度/大小/伤害按 `(1+(mult-1)*charge)` 插值；命中处 `b.damageMult` 生效。发射判断在 `game-scene.js:update` 用 `fireWasDown`（**须在瞄准段覆盖 `previousFireDown` 之前取**，否则同帧读到 false 导致蓄力松开发射失效）——`!fireDown && fireWasDown && charge>0`，不消耗连射 `fireClock`。**蓄力视窗缩放**：蓄力时相机 `chargeZoom` 平滑趋近 `tgt`（当前冥狙 `tgt=1-0.6*charge`，方向由 game-scene 该式决定）；**松开发射瞬间先停顿 `zoomHold=600ms`（保持当前值），停顿结束后再逐渐恢复到 1**；`editor-camera.js:updatePlayCamera` 用 `playZoom()*chargeZoom` 注入缩放（滚动居中仍用 `cam.width/2`，不随 zoom）。
- **`ampArcs`** 发射环外「表盘红弧」带：子弹跨过弧带圆（半径=`arc.r`，用「上帧位置→当前位置」线段跨越判定）且相对 `weaponAngle` 的**飞行航向角** `<=halfDeg` 时变红 `b.amplified=true` + `colorStr` 变红，命中伤害 `*2`。角度必须用子弹速度方向（`atan2(b.vy,b.vx)`），不能用位置角——接近发射环时不同散射角的子弹位置角都压缩到瞄准方向附近会误判（`game-scene.js:update` 子弹 filter 内检测）。
- **`orbit`** 环绕六边形：**无子弹**，`appearance.elements[<orbitIndexes>]` 的复合体（如 禅灭 = elements[0]+[1] 的 6 颗六边形）绕玩家转圈撞击敌身。三段动态轨道在 `game-scene.js:update` 的 `mechanic.orbit` 分支维护运行时 `player.orbit`（按住左键→二段 radius 250/角速×2/体积×2，按住≥`phase3HoldMs`→三段 400/×4/×4；松开→`retractMs` 内平滑收拢回基础）。判伤按 `hitIntervalMs` 对同敌节流，伤害走 `playerDamage`（固定=`baseDamage`，不乘体积倍率）；命中可破坏物：箱子 `spawnCrateDebris`/油桶 `explodeBarrel`（一次触发、无节流）。**`fire()` 直接返回 `[]`**。航迹可配：`trailWidth/trailSamples/trailFade/trailColor`，转速整体缩放 `speedScale`（默认 0.8=转速-20%）。
- 渲染：`entity-art.js:drawWeaponMedium` 在 `chg || mouseAim` 下画**中心瞄准线**（常显、长度近似无限、蓄满变红）+ 两条散射边界线（蓄力中，±当前散射角）+表盘红弧带（**半径=`arc.r`、厚度减半、角度=当前散射角随蓄力减小**）+发射小球改为圆弧（角度=当前散射）。**orbit 武器例外**：`entity-art.js:drawPlayer` 走 `buildOrbitInstance`（weapon-runtime）动态克隆外观渲染（不污染共享 `WEAPONS[id].appearance`）+ `drawOrbitTrail` 画每颗六边形航迹，**跳过 `drawWeaponMedium`**（去掉发射环/小球）。
- 新机制字段要同步 `weapon-design.js:normalizeMechanic` + `weapon-board.js:scalarFields`（特殊机制/蓄力参数组）+ 命中/渲染分支。示例：`data/weapons/weapon-1788656554163.json`（冥狙）、`data/weapons/weapon-1788679714207.json`（禅灭，orbit）。

### 6.7 新增一种矩形障碍 / 可交互实体（火堆范式）

火堆 = 矩形碰撞体，同时参与**子弹命中**与**玩家/敌人移动碰撞**。新增同类实体按下面 3 处接线，**缺一处就会「子弹穿过去」或「人穿过去」**：

| # | 落点 | 做什么 |
|---|---|---|
| ① | `game-scene.js:update` 子弹 filter（约 `:568`） | `const wallAll = [...l.walls, ...this.bulletGateWalls(), ...this.<xxx>Walls()]` —— 把新障碍矩形加进**连续碰撞**列表（沿用 `rayWallDistance`，别新写点判定） |
| ② | `game-scene.js:update` ricochet 分支（约 `:555`） | `const hitW = l.walls.find(...) \|\| this.bulletGateWalls().find(...) \|\| this.<xxx>Walls().find(...)` —— **必须与 ① 同一份障碍集**，否则反弹子弹穿透（见 §7 坑 52） |
| ②b（子弹/激光集不止 2 处） | 敌弹 filter（约 `:770`）、`weapons.js:spawnLaser`（约 `:134`）、`enemy-ai.js:heavyMechUpdateSight`/`heavyMechFireLaser` | 四处都各自拼 `[...l.walls, ...this.bulletGateWalls()]`。**「挡所有子弹」的需求必须四处同改**，否则出现「普通子弹被挡、敌弹/激光穿过」（宝箱上锁红环即按此四处接线，见 level-design §3.14） |
| ③ | `enemy-ai.js:resolveMovementCollision`（约 `:449`） | 仿 vendorWalls：把新障碍映射成 `{ x, y, w, h, shape:'rect', rotation:0 }`（`visible!==false` 过滤；编辑态取 `l.<xxx>`、运行态取 `this.<xxx>`）后调 `resolveCircleAgainstWalls` —— **玩家与敌人移动共用此函数，一处覆盖** |
| ④（可选） | `interactables.js` + `game-scene.js:update` | 若要 F 键交互：加 `<xxx>Walls()` 产出矩形 + `update<Xxx>Interact(dt)`，并在 `if (!inputLocked)` 交互调度链（`updateIdolInteract` / `updateCampfireInteract` 同级）补一行 |

> 口径：**矩形**（与 vendor 一致，不用圆形）；只挡**玩家子弹**，**不处理敌方弹幕**（敌弹走另一条 filter）。

### 6.8 按武器类型直接切换（非滚轮）

需要在代码里把玩家切到某把**已装备**武器（如火堆选卡后自动切到被强化的武器），**不要手写 `player.weaponType`/`weapon`/`weaponIndex`**，一律调用 `this.equipWeaponByType(weaponType)`（`player-combat.js:103`）：

- 传「`player.weapons` 中已登记」的武器 id；`!weaponType` / 未登记 / 已是当前武器 / `WEAPONS` 缺定义时**返回 `false` 且不改任何状态**（幂等、安全，可无脑调）。
- 它负责全流程：守卫 → `leaveWeapon`（回退旧武器祝福）→ 写 5 个字段（`weaponIndex/weaponType/weapon/scheme/weaponArt`）→ `enterWeapon`（应用新武器祝福）→ 重播出场动画（`weaponIntroAt`）→ 轮盘动画（`wheelAnim`）→ `syncUIState()`；成功返回 `true`。
- 示例：`interactables.js:campfirePickUpgrade` 在 `applyCampfireOption` 成功后调 `this.equipWeaponByType(option.weaponType)`。
- 滚轮/按键仍走 `switchWeapon(dir)`（`player-combat.js:91`，只算 `(weaponIndex + dir + n) % n` 再委托本方法）。**别在别处重复实现切换步骤** —— 绕过 `leave`/`enter` 配对会导致火堆祝福残留/丢失（见 §7 坑 51 / 54）。

## 7. 坑与约束

1. **mixin 同名方法会静默覆盖**。装配顺序在 `game-scene.js` 的 `Object.assign(EditorScene.prototype, EnemyAiMixin, PlayerCombatMixin, DestructiblesMixin, SpawningMixin, TriggersMixin, InteractablesMixin, LevelFlowMixin, HudMixin, UiRuntimeMixin, ScreensMixin, SaveLoginMixin, NewbeeHubMixin, WorkshopMixin, DropsMixin, ProgressionMixin, EditorInputMixin, EditorCameraMixin, WorldRenderMixin, WorldOverlayMixin)`。**后面的覆盖前面的**。新增方法前先确认全仓没有同名（`node -e` 扫 `^    方法名(`）。
2. **`const ctx = this.ctx;` 约定**。`ctx` 是 `createGameScene(ctx)` 的注入对象（含 `state` / 各种回调 `onXxx`）。mixin 里用不到闭包，凡是要访问 `ctx` 的方法**必须在方法体首行声明** `const ctx = this.ctx;`。漏写会 ReferenceError，而且 `vite build` **检测不到**（Rollup 不做未定义标识符检查）。
3. **`pointInWall` 有两个版本**：`geometry.js:pointInWall(wall, x, y, pad)` 是纯函数（几何判定），`player-combat.js` 里还有一个同名的场景方法版（遍历当前关卡墙体）。两者用途不同，别互相替换。
4. **`weapons.js ↔ economy/damage.js` 存在循环 import**（`WEAPONS` ↔ `activeMods`）。ESM 函数提升让它在运行期安全，但**绝不能把 `activeMods` 或 `WEAPONS` 改成模块顶层立即求值**，否则 TDZ 拿到 `undefined`。
5. **`spawnLaser` 通过 `scene.ctx` / `scene.worldSize()` 访问场景**，它是纯函数不是 mixin 方法，第一个参数必须传场景实例。
6. **墙体旋转**：所有判定都要先经 `wallRotationRad` 转到局部坐标系。新写判定函数别忘了处理 `rotation`，否则旋转墙会判定错位。
7. **`arc` 形状墙**用 `w/2 ± thickness/2` 的环带 + 角度跨度判定，`circle` 用 `w/2` 当半径而不是 `w`。写新形状记得三处都改：`pointInWall` / `resolveCircleAgainstWalls` / `rayWallDistance`。
8. **闸门（gate）不在 `level.walls` 里**，是 `this.activeGateWalls()` 动态产出的。子弹/敌人碰撞判定要**同时**查这两个来源（`game-scene.js:update` 已这么做，新加判定别漏）。子弹（玩家弹 + 激光）的墙体集是 `[...l.walls, ...this.bulletGateWalls()]`（`bulletGateWalls`= `shieldOnly || active`，triggers.js:129），玩家移动碰撞/敌弹/寻路仍用 `activeGateWalls`（只含 `active`）。所以「只挡子弹门」（`shieldOnly`）未激活时子弹被拦、玩家可穿——新加子弹判定要用 `bulletGateWalls` 而非 `activeGateWalls`，否则盾门拦不住弹。
9. **`defeatEnemy` 只置 `alive=false` 不移出数组**。遍历 `this.enemies` 时必须 `if (!e.alive) continue;`。
10. **敌人寻路网格是关卡加载时一次性构建**（`level-flow.js:restart` 里 `buildGrid`），墙体运行时变化（如开门）**不会**自动重建网格，敌人可能穿过刚关的门附近或绕不必要的路。
11. **`spawnLaser` 是即时伤害**（发射瞬间就判定完），激光的 `ttl` 只是视觉残留。改激光"持续伤害"需要改成每帧判定。
12. **改件 `pierce` 只影响激光**（`spawnLaser` 里判），`ricochet`/`split` 只影响实体子弹（`game-scene.js:update` 里判）。加新改件要想清楚生效点在哪一侧。
13. **已修**：`INTRO_RING_COUNT = 12` 现已在 `src/systems/ui/entity-art.js:170` 的 `INTRO_RING_*` 常量组正式定义（与 `state.js` 归一化默认值一致），未定义引用已消除。仅当 `fx.introRingCount` 为空时才会走到该兜底，目前只有 `data/levels/login.json` 用该特效且已配该字段。改虫洞特效时注意。
14. **`this.player.combat` 可能为空**（`playerDamage` / `playerIncomingDamage` 都有 `if (!combat)` 兜底）。新写读 `combat` 的代码要带默认值。
15. **宠物子弹必须带 `b.petDamage`**。现有命中分支只用 `playerDamage(this, weaponType)`；宠物子弹在 `firePet` 里补 `petDamage`，命中处 `b.petDamage != null` 才覆盖，否则按武器 baseDamage 结算（会偏高）。
16. **敌弹命中宠物在 shield 之后、玩家之前**，且仅 `pet.invincible === false` 时结算。首帧 `draw` 可能先于 `updatePets`，`this.pets` 尚未初始化，`drawPets`/敌弹判定须用 `this.pets || []` 兜底。
17. **宠物环绕不参与墙体碰撞**（`updatePets` 不调 `resolveMovementCollision`）。半径穿墙时宠物会显示在墙内，仅视觉问题；如需卡墙需自行加回推。
18. **ampArc 穿弧判定要用子弹航向角而不是位置角**：子弹从发射环（半径=`medium.radius`）出发，接近环时不同散射角的子弹位置角都逼近 `weaponAngle`，用 `atan2(b.y-p.y, b.x-p.x)` 会把弧外子弹误判为穿弧（该白的红了）；半径判定必须用 `arc.r`（带圆半径），用 `ringR`（=发射环=子弹起点）会让首帧 `d0-ringR==0` 恒穿越（该红的全红）。正确几何见 §6.6。
19. **`rotSpeed*t` 的旋转角在「运行时改 rotSpeed」时会产生角度瞬跳**：`asset-render.js` 的 `renderAsset`/`elementCenter` 都用 `ga = phase + rotSpeed*t*dir`（`t`=场景绝对秒）。运行时把某元素 `rotSpeed` 放大（如 orbit 武器 `buildOrbitInstance` 按 `speedMult` ×2/×4），`ga` 会瞬间跳变（差值≈`ΔrotSpeed×t`）。这个瞬跳是 orbit 六边形「切换轨道时」**刻意保留的移动手感**，但会让历史航迹连出贯穿半径的放射状乱线。处理：① 转速整体缩放用 `mechanic.orbit.speedScale`（默认 0.8=转速-20%）乘到 `rotSpeed`；② 拖尾记录时若某颗新位置与上一帧跨度 `> Math.max(50, radius*0.6)` 视为瞬跳，`arr.length=0` 断开该颗航迹，避免乱线。见 `weapon-runtime.js:buildOrbitInstance` / `game-scene.js` orbit 分支拖尾记录。
20. **高速子弹会隧穿（tunneling），逐帧「当前位置」点判定会漏检**：玩家子弹默认 500px/s（每帧≈8px），但设计稿武器 `bullet.speed` 被拉大后（如 minigun=9000px/s，每帧≈150px，60fps）会越过墙厚(30px)与敌人命中半径(~20px)，子弹一帧跨过整段墙/敌人 → 表现为「穿墙」且穿墙后打不中敌人/箱子/油桶。**根因**：`game-scene.js:update` 子弹 filter 原来用 `hitWall(w, b.x, b.y)`/`Math.hypot(敌, b)` 只测末点位置。**正确做法**：子弹移动前记录 `obx/oby/odist`，改命中共 4 处为连续碰撞——墙体/crate 用 `rayWallDistance(obx, oby, dx, dy, walls)` 的返回值 `t∈[0,1]` 是否穿越（命中时把 `b.x/b.y` 回退到墙面）；barrel/敌人用 `pointSegmentDistance(目标, obx, oby, b.x, b.y)` 点到线段距离（敌人命中点取线段上最近点）。**残留限制**：`b.ricochet` 分支仍是单点 `hitWall` 判定，高速 ricochet 弹仍可能穿墙不回弹；激光 `spawnLaser` 本就即时命中不受影响。
21. **`hasLOS` 会跳过「包含任一端点」的门**（`enemy-ai.js:399`，`activeGateWalls()` 里 `pointInWall(g, x0, y0)||pointInWall(g, x1, y1)` 的过滤）。作用：门把玩家包住 / 玩家贴门时，该门不参与视线遮挡，否则 `spawnGate`+`inscreen` 首波在玩家卡门体积时会形成「整片生成区都被门挡住」的伪遮挡 → 0 只（见 level-design skill §7）。注意：只对门生效，静态墙 `level.walls` 仍会挡视线；`hasLOS` 也用于敌人「是否看见玩家」（enemy-ai.js:56），玩家贴门时敌人会更早看到，属良性。
22. **`boss25t5ZonesTick` 必须每帧对每个存活 BOSS 调用**（`game-scene.js:687`，敌人循环内 `stepEnemy` 之后）。它负责 `e.zones` 的生命周期（`extend→pause→anim→keep→fade`）与命中判定；**漏调 → 技能卡在 `anim`/进不了 `keep`，`stepBoss25T5` 永远等不到 activeZone 结束，BOSS 卡死 `skill` 态且区域永久定格**。
23. **技能区域是「世界锚定」不是「BOSS 跟随」**。`zone.x/zone.y` 是**释放那一刻写死的 BOSS 坐标**，之后命中/渲染/紫色求交一律以它作扇形顶点，**不要换成实时 `e.x/e.y`**。正因为锚定，BOSS 会走出/走进区域，两个不同时刻释放的区域才可能真实重叠（紫区/黑遮罩的前提）。
24. **阻挡护盾只拦玩家子弹**。`boss25t5TryBlock` 只在玩家子弹 filter 里生效；禅灭（orbit 武器）的轨道接触伤害走 `mechanic.orbit` 分支的圆-敌判伤，**不经过护盾拦截**——这是有意为之（轨道是实体占位而非子弹），改护盾交互时别顺手把轨道伤害也拦了。
25. **BOSS 死亡必须清理被拦截弹**。护盾把玩家子弹停在原地变红（`b.blockedBoss`），这些弹对玩家仍是威胁；`enemy-ai.js:defeatEnemy` 的 `boss-2-5t5` 分支会清理它们（`boss25t5UpdateBlocked` 内亦按 `blockedBy` 是否存活判定）。漏了会导致 BOSS 死后红弹滞留、玩家踩到仍扣血。
26. **策划案的技能2/技能3 条件几何互斥 → 技能2 永不触发（占比失控）**。现象（上一轮）：旧实现只出技能1/技能3，技能2 从不出现。根因：策划原案技能2 条件「玩家处于圆弧5 技能范围内」与技能3 条件「圆弧4/5 重叠 >50%」在几何上**等价**——圆弧4 恒瞄准玩家 ⇒ 玩家落在圆弧5 扇形内 ⟺ 两弧重叠 >50%，两条永远同时成立。**现解法（本轮）**：改用「**权重预选 + 区域恒以玩家方向为中心 + 参战弧等待期对准玩家**」，彻底移除几何判定——`pickWeighted`+`arcTargetsFor`（预选技能与两弧目标角）、`boss25t5StartSkill`（区域方向恒为 `aim ± span/2`）、`stepBoss25T5`（仅等待期用 `rotateToward` 对齐）、`boss25t5-art.js:drawBoss25T5Body`（读两弧相位 + 算合并中心）**四处必须同步改**，否则技能占比或「合并态」视觉不一致（实测占比 s1/s2/s3 ≈ 38.7%/38.7%/22.5%）。**上一轮的「夹角窗口 φ 判定」已废弃**：`boss25t5ChooseSkill` 现在只做 `boss25t5StartSkill(e, cfg, e.skillPick || 1)`，夹角窗口/距离/是否在扇区等几何判定全部移除；导出 `boss25t5MergeHalfDeg`、内部 `arc5OffsetFor` / `arcMerge` 均已删除（旧关卡里的旧键被 `normalizeBoss25T5Config` 丢弃，无害）。
27. **圆弧对齐只能在等待期做**（`e.state==='move' && e.moveWait>0`，此时 BOSS 静止 → 瞄准角稳定）。现象：若在位移过程中强制对齐，BOSS 环绕时瞄准角以 `spinFastDeg`(180°/s) 持续旋转 → 参战弧被甩开、到不了玩家方向 → 技能空放。正确做法：仅等待期以 `arcAlignDeg`(180°/s) 对齐到 `arc4OffsetDeg`/`arc5OffsetDeg`，位移中两弧按 `arc4SpinDeg`/`arc5SpinDeg` 自由自转，位移后的等待期再对齐一次（实测区域中心偏离玩家方向平均 0.00°/最大 0.00°，参战弧偏离玩家方向平均 1.08°/最大 1.83°）。
28. **护盾拦截的红子弹可见半径**。现象：护盾把玩家子弹停在原地变红（`b.blockedBoss`），但子弹速度为 0 时拖尾退化为点、只剩默认白色头部圆，小弹几乎看不出是危险弹。正确做法：`boss25t5TryBlock` 置 `b.blockedR=5`，三处渲染各加最小半径兜底——`weapons.js` 的 `radial.drawBullet`（`Math.max(b.blockedR ?? 5, PLAYER_ART.weaponOrbRadius * 1.25)`）、`weapons.js:basic.drawBullet`（`Math.max(b.blockedR ?? 5, 4)`）、`weapon-runtime.js:drawBullet`（`blockedBoss` 时额外叠加 `Math.max(b.blockedR ?? 5, bulletSize*4)` 半径的红色实心圆）。
29. **三种技能的圆弧绘制必须同口径**（`boss25t5-art.js:drawZone` 统一「多条同心弧」+ `MAX_RINGS=64` 上限）。s1 以 `arcR` 为**最内圈**、圆弧由 `arcR` 铺到 `visMax`（向内收紧）；s2/s3 以 `arcR` 为**最外圈**、圆弧由 `visMin` 铺到 `arcR`（向外扩张），间隔统一 `cfg.s1RingGap`，并用 `MAX_RINGS`(64) 限制圈数（超限等比放大间隔）。**只改 s2/s3 一条弧会与 s1 风格不一致；不设圈数上限则单帧上千次 `strokePath`**（三种技能同一口径）。

30. **漩涡对子弹的伤害口径不能静态 `import economy/damage.js`**。现象：`boss25t5.js` 顶部加 `import { playerDamage } from '../economy/damage.js'` 后 `node --test` 直接抛 `Unexpected token 'export'`，测试基线崩。根因：`boss25t5.js` 被 `state.js` 静态引用（单测会加载它），而 `damage.js` 经 `weapons.js` 静态 `import Phaser from 'phaser'`，node 下（CJS 加载 `phaser.esm.js`）无法解析 ESM `export`。**正确做法**：伤害走 `game-scene` 构造函数注入的 `this.playerDamage`（`game-scene.js:42`，与打敌人同口径；取不到时兜底 1），宠物子弹仍用 `b.petDamage` 覆盖。**同类判据**：任何被 `state.js` 间接引用的纯数据模块都不得 import 战斗表 / Phaser（参见 §7 坑 4 与 `boss25t5.js` 顶部注释）。
31. **`boss25t5VorticesTick` 必须帧令牌去重，且要放在 `stepBoss25T5` 的 `bossActive` 早退之前**。现象：漏了会出两种 bug——① 若放在 `if (!e.bossActive) return;` **之后**，BOSS 待机时既有漩涡不推进（玩家吸力/周期伤害停摆）；② 两个调用点（`stepBoss25T5` 顶部与 `game-scene.js:671` 保底）同帧各推一次 → 吸力/周期伤害翻倍（甚至同一帧多次命中）。**正确做法**：`boss25t5VorticesTick` 首行用 `this.time.now` 帧令牌（`this.boss25t5VortexTick === now` 直接 return），保证每帧只清/写一次 `player.boss25t5Pull`、只结算一次伤害；调用点放在 `stepBoss25T5` 早退**之前**。另注意它的写入对象 `player.boss25t5Pull` 与 `boss25t5Slow` 一样只被「下一帧」的玩家移动消费（1 帧延迟，可接受）。
32. **解冻的子弹必须置 `b.thawed` 并让 `boss25t5TryBlock` 首行早退**。现象：`boss25t5VortexPull` / `boss25t5ZoneBulletForce` 把冻结红弹解冻后（`blockedBoss=false`），若不再打标记，该弹的起点正落在护盾面上（`c≈0`）→ 会被护盾**再次冻结** → 表现为一颗永远停在原地、颜色反复闪烁的红弹。**正确做法**：解冻时置 `b.thawed=true`（`boss25t5TryBlock` 首行 `if (b.thawed) return false;`，`boss25t5.js:736`）。注意 `blockedBoss=false` 与 `blockedBy` 是两件事：前者=「不再被护盾拦」，后者=「已转化」（见坑 36）。
33. **护盾消除红弹要复用 `blockWithShield`，且不得再扣一次盾；必须在 `damagePlayer` 之前判定**。现象/根因：`boss25t5UpdateBlocked` 里若自己扣盾、或先 `damagePlayer` 再判格挡，会「扣两次盾」或「挡下还掉血」。**正确做法**：玩家触碰被拦红弹时**先** `this.blockWithShield(b.x, b.y, cfg.shieldClearCost, radius)`（它内部已含扣盾值 + 命中特效 + 抖屏 + 破盾，**外部不得重复扣**），返回 true → `b.dead = true`（红弹消除、玩家不受伤）；返回 false 才 `this.damagePlayer(b.blockedDamage ?? 10)`。新配置 `shieldClearCost`（默认 10）只决定扣除量；找不到 BOSS 时经 `boss25t5CfgFromBullet` 用 `normalizeBoss25T5Config({})` 兜底（cost=10）。

34. **漩涡对玩家的吸力峰值 `s5PullMax` 必须 < 玩家基础移速（180）**（原名：`s5PullAccel` 必须 < 玩家移速，本轮改名为 `s5PullMax`）。现象：吸力是按「本帧位移 = 输入速度 + pull」直接叠加的（`game-scene.js:236-237`），一旦吸力峰值 ≥ 180，玩家进入吸力强的区域后就再也走不出去；若漩涡同时位于墙外/墙另一侧，会被吸到墙面上钉住，表现为「沿该轴按方向键不动」。**正确做法**：吸力峰值 `s5PullMax` 必须**小于**玩家移速（默认 **160**、`Boss2-Test.json` 实配 **165**，均 < 180，留挣脱余量）；半径边缘处的最小吸力 `s5PullMin`（默认 **40**）无此约束（吸力从半径边缘的 `s5PullMin` 线性升到涡心的 `s5PullMax`，见 §5 吸力公式）。另外 `boss25t5CastSkill5` 的生成点判定必须**先做世界边界钳制、再判可达**——先判可达再钳制时钳制会把点挪到墙另一侧让判定失效（实测 200 次里 123 次「玩家与涡心之间隔墙」）；评分取「可达优先、其次距离最远」。**注意**：本条**不是**「BOSS2 关卡上下不能移动」的原因（那次是视觉参照缺失，见坑 35 与 `level-design` skill §7）。
35. **「玩家动不了」的排障顺序（含一次误诊）**：① `player.boss25t5Slow`（紫色领域 95% 减速，`boss25t5ZonesTick` 置位、`stepBoss25T5` 每帧先清）② `player.boss25t5Pull`（漩涡吸力）③ `player.boss25t5Force`（技能1 拖拽 / 技能2 击退 / 技能4 击飞的一次性位移）④ **视觉参照缺失**（玩家其实在动，只是屏幕上没有参照物：大地图 + `camera.mode:'center'` + 空场 + `showGridInPlay:false` ⇒ 相机始终把玩家钉在屏幕正中，上下方向唯一在画面里的墙是**比视口还高的竖直长条**，纵向滑动看不出变化；横向滑动该长条却很明显 ⇒ 误判为「只有上下不能移动」）⑤ 最后才怀疑键盘绑定。**判据**：若「某个关卡才出现」「触发某个事件后就好转」，先怀疑 ④——换个有参照物的位置或让一个明显物体进入画面，症状就会消失。详见 `level-design` skill §7。

36. **已转化子弹必须保留 `b.blockedBy`（清掉 = 三处同时失效）**。现象：解冻 / 捕获 / 释放时若顺手 `b.blockedBy = null`，会出现① `boss25t5CfgFromBullet` 找不到 BOSS（`x.id === b.blockedBy` 匹配失败）→ `shieldClearCost` 落到默认 10；② `enemy-ai.js:defeatEnemy` 清不掉残留弹（它按 `x.blockedBy === e.id` 过滤，`:337-338`）；③ `game-scene` 的 `const converted = b.blockedBy != null` 守卫失效 → 转化弹回头去伤害敌人/BOSS。**正确做法**：解冻（`boss25t5VortexPull`）/ 施力（`boss25t5ZoneBulletForce`）/ 捕获（`boss25t5VortexCapture`）/ 释放（`boss25t5ReleaseCaptured`）一律**只动 `blockedBoss`/`captured`/`vx`/`vy`**，`blockedBy` 保持原值 —— 它就是「已转化子弹」的判定标记。

37. **捕获子弹的位置只能由 `boss25t5VorticesTick` 驱动（filter 必须早退）**。现象：`game-scene` 子弹 filter 里若不给 `if (b.captured) return !b.dead;`（`:474`）早退，捕获弹会被继续位移 / 判墙 / 判箱桶 / 判敌人 / 施力，与 tick 写入的环绕坐标互相覆盖 → 表现为环绕环抖动、绕行半径忽大忽小、偶尔穿墙。**正确做法**：filter 第一行按 `captured` 早退（位置与接触全部交给 `boss25t5VorticesTick`）；`boss25t5ReleaseCaptured` / `boss25t5ClearVortices` 只清 `captured` + 速度归零、**不改位置** → 子弹静止停驻原处（仍是威胁、仍可被护盾消除）。

38. **命中外扩容差必须用「像素级」`zoneHitPadPx`，且只加在 s1/s2、s3 严格为 0（旧口径 `zoneHitPadDeg` 已删除）**。现象：把外扩一并加到 s3 会把「紫色秒杀」的误杀范围放大（玩家在扇形外沿擦过即被判死）。**正确做法**：`boss25t5ZonesTick` 第三趟 `const padPx = Math.max(0, cfg.zoneHitPadPx || 0); const hitPad = (padPx > 0 && z.kind !== 's3') ? padPx / Math.max(1, d) : 0;`（`boss25t5.js:735-736`）—— 只用于外扩判定用的角度区间（`a0 - hitPad .. a1 + hitPad`）；`pointInZonePurple` 的紫色判定必须保持**精确不带 pad**（否则紫区/黑遮罩的实际边界与渲染不符），且 s3 恒 `hitPad = 0`。

39. **已转化子弹不再伤害敌人/BOSS（只威胁玩家）**。现象：解冻 / 捕获释放的弹若回到敌人循环，会变成「BOSS 自己的子弹打自己 / 打死自己的漩涡」。**正确做法**：`game-scene` 敌人循环前 `const converted = b.blockedBy != null;` + 循环首行 `if (converted) break;`（`:601`/`:603`）——**保留**墙/箱/桶碰撞（那些分支在它之上），跳过全部敌人/BOSS 伤害。哪天要在敌人循环里加新判定，别忘了这段守卫（见坑 36）。

40. **s1 拖拽到「圆弧1 内缘」必须让子弹停下（一次性任务到此结束）**。现象：`boss25t5ZoneBulletForce` 若让 s1 一直朝 BOSS 拖，子弹会越过圆心再被反向拖 → 在 BOSS 体内来回震荡（视觉上「卡在 BOSS 肚里抖」）。**正确做法**：推进任务时判断 `f.mode === 'drag' && Math.hypot(b-owner) <= cfgOf(owner).innerRadius * (owner.artScale||1)`（拖到圆弧1 内缘）→ 直接 `b.vx = b.vy = 0; b.force = null`（任务结束、不再施加，见 `boss25t5.js:1245-1248`）。

41. **固定角度容差在远距离会放大成几百像素（旧 `zoneHitPadDeg` 的坑，该键已删除）**。现象：按固定角度外扩（旧 12°）会随距离线性放大 —— `s2Range=1500` 处 12° ≈ 314px，判定区远远超出绘制扇形，玩家站扇形外老远也被判中；近处又几乎没有容差，两个极端都不对。**正确做法**：容差按「像素」定、再换算成该距离下的角度 —— `hitPad = padPx / Math.max(1, d)`（`cfg.zoneHitPadPx`，默认 30），保证判定区最多只比绘制扇形的斜线多 30px，远近一致。**别再引入任何「固定角度」形式的容差**。

42. **不要 让扇形跟随玩家（会让玩家无法躲避）—— 方向在释放瞬间写死**（旧口径 `zoneAimTrackDeg` 的「成型期跟随」已废弃）。现象：若让 `z.a0/z.a1` 在 `extend`/`pause`（甚至 `anim`）阶段持续转向玩家，命中判定就变成「追着玩家判死」——玩家无论往哪躲都躲不过，且视觉上扇形一直罩住玩家。**正确做法**：`boss25t5StartSkill` 在释放瞬间按 `aim ± span/2` 写死 `z.a0/z.a1`，之后 `boss25t5ZonesTick` **不再修改方向**（全程不变）→ 玩家横向走出扇区即可躲避；命中只保留**像素级**容差 `zoneHitPadPx`(30px，仅 s1/s2，s3=0，见坑 38)。文件头注释与函数头注释均已同步该口径（「命中判定」段：扇形方向不跟随玩家）。

43. **技能1/2 对子弹的施力必须是「带距离预算的一次性施力」，不能每帧加速度**。现象：旧口径 `s1BulletForce`/`s2BulletForce`（每帧 `vx/vy += …` 加速度）会让子弹越推越快、**永不停下**（还会越界穿墙）。**正确做法**：授予一次性任务 `b.force = { mode, ownerId, speed, remain }`（`remain` = 剩余距离 px；速度复用玩家的 `s1DragSpeed`/`s2PushSpeed`，距离 = 玩家的 `s1DragDist`/`s2PushDist` × 2（模块常量 `BULLET_FORCE_DIST_MULT`））；每帧按 `speed` 定速写 `vx/vy` 并 `remain -= speed*sec`，距离用尽 / owner 消失 / drag 拖到 `innerRadius×artScale` 内缘 → `vx=vy=0; force=null`。`b.forceSrc`（= 区域 id）保证**同一区域只授予一次**（否则子弹停下后会被反复重新推动）；帧令牌 `b.forceStepT` 防同帧重复扣距离。**被漩涡捕获 / 释放时必须清 `b.force`**（`boss25t5VortexCapture`/`boss25t5ReleaseCaptured`），否则「释放后静止停驻」失效 —— 子弹会带着剩余距离继续跑。

44. **限时加成靠「互逆乘算」回退而非快照**：`applyStatEffect(combat, type, mul, 1)` / `(..., -1)` 分别乘 `mul` 与 `1/mul`。因此**多个同类加成叠加时不是严格可逆**（浮点 + 顺序），但误差可忽略；若将来要精确回退，需改为「基础值快照 + 每次重算」。
45. **`damagePlayer` 是玩家受伤的唯一入口**（子弹命中、敌人接触、母舰接触都走它），所以即时护盾在**这一处**拦截即可覆盖全部来源。护盾**不参与**闪避/免伤（`playerIncomingDamage` 只调用一次，护盾在其后）。若未来新增绕过 `damagePlayer` 的直接扣血，护盾会漏。
46. **护盾吸收顺序 = `itemShields` 数组从前到后**，`splice` 后要 `i--` 修正位移；盾碎会记 `hitEffects` 并抖屏。
47. **临时武器「使用中」才倒计时**（用户确认）；实现是替换 `player.weapon`/`weaponType`/`weaponArt`/`scheme`，并保留 `tempWeaponSaved` 以便取消时还原。**使用中会改 `weaponType` 但不改 `player.weapons`/`weaponIndex`** → 右下角武器轮盘高亮可能偏差；滚轮切武器由 `editor-camera.js:onWheel` 的 `isTempWeaponActive()` 守卫拦住。
48. **设计稿武器的运行时条目经 `registerWeapon` 并入 `WEAPONS`**，所以临时武器可直接复用现有开火链路（`player.weapon.fire/stepBullet/drawBullet`）；若 `WEAPONS[id]` 尚未注册，`useTempWeapon` 会 `ensureWeaponDef(id)` 异步补拉后自动重试一次。
49. `updateRunItems(dt)` 在 `game-scene.js:update()` 里排在战斗处理之后 → 本帧到期的加成晚一帧回退，可忽略。
50. **`playCutscene` 覆盖正在播放的运镜时不回调旧 `onComplete`；BOSS 击破运镜必须让位给死亡运镜**。现象：母舰贴身秒杀 → `triggerPlayerDefeat` → `mothershipSelfDestruct → defeatEnemy` → BOSS 击破运镜顶掉死亡运镜 → `playerDeathFlow` 卡在 `cinematic`、结算页永不出现（`stopCutscene` 只 `cinematicTimer.remove()`，旧 `onComplete` 不触发）。**正确做法**：`enemy-ai.js:defeatEnemy` 里 `if (!this.playerDeathFlow) this.playCutscene(clip, …)` 抑制；同时「运镜已结束但流程未收尾」的窗口里 `cinematicInputLocked()` 返回 false，**身份类流程锁（`playerDeathFlow`）必须自己纳入 `inputLocked`**（`game-scene.js:171`），不能只依赖它（否则黑幕里按 F/4/5 能打开菜单页顶掉结算页）。完整链条见 level-design §4⑨ 与 engine-editor 坑 49-50。

51. **按武器生效的属性强化（火堆祝福）必须在所有武器切换入口成对 `leaveWeapon`/`enterWeapon`**。现象：`player.weaponBuffs[wt]` 的加成直接乘/加在 `player.combat` 上（互逆口径同坑 44），切换武器不回退就会出现 ① 切走后旧武器加成仍挂着（**加成残留**、属性虚高）② 切到新武器没 `enterWeapon`（**加成丢失**）。**正确做法**：`player-combat.js:equipWeaponByType`（**武器轮切换的唯一执行体** —— 滚轮/按键经 `switchWeapon` 委托、火堆选卡直调都汇聚到此）、`run-items-runtime.js:useTempWeapon`、`cancelTempWeapon` **三处成对调用**（改 `weaponType` 之前 `leaveWeapon(this)`、写完 `weaponType/weapon/scheme/weaponArt` 之后 `enterWeapon(this, wt)`）；`switchWeapon` 的 `n<=1` 提前 `return`（此时不调 `equipWeaponByType`）不动（没切换就不动加成）。**漏任何一处 = 加成残留或丢失**（不成对/重复配对的净对数分析见坑 54）。

52. **把障碍加进子弹 `wallAll` 时必须同时加进 ricochet 的 `hitW` 查找**。现象：`game-scene.js:update` 的墙体连续碰撞用 `wallAll = [...l.walls, ...bulletGateWalls(), ...campfireWalls()]`，而反弹改件分支用**另一处独立**的 `hitW` 查找（`l.walls \|\| bulletGateWalls() \|\| campfireWalls()`）。只加一处 → 普通子弹被挡、但 `ricochet` 子弹**穿透**该障碍（不反弹直接飞过）；漏另一处则反弹弹被弹回而普通子弹穿过。**正确做法**：新增矩形障碍时两处同改（见 §6.7 ①②）。

53. **`equipWeaponByType` 把所有守卫前置 → 守卫失败不再留脏态（旧 `switchWeapon` 会）**。现象：旧 `switchWeapon` 在 `const weapon = WEAPONS[wt]; if (!weapon) return;` **之前**就写了 `player.weaponIndex = to`，当 `WEAPONS[wt]` 缺定义时留下 `weaponIndex`（已前进）与 `weaponType`（未变）**不一致的脏态** → 武器轮高亮与实际武器错位、下次切换基于错误索引。**本轮重构**：目标槽位计算（`switchWeapon`，只算不写）与状态写入（`equipWeaponByType`）分离，**全部守卫**（`!weaponType` / 不在 `player.weapons` / 已是当前武器 / `WEAPONS[weaponType]` 缺定义）都排在 `leaveWeapon` + 写字段**之前**，任一命中即 `return false` 且**不动任何状态**。改守卫顺序务必保持「**先判后写**」，别在守卫前写 `weaponIndex`。

54. **`leaveWeapon`/`enterWeapon` 必须成对且不重复加配（火堆选卡后自动切换也满足净 1 对）**。`equipWeaponByType` 执行体固定 `leaveWeapon(this)` → 写字段 → `enterWeapon(this, wt)` 一次；`enterWeapon` 内部还有 `if (p.buffedWeapon === weaponType) return true;` 幂等守卫（重复 enter 不叠加，见 `economy/weapon-buffs.js:33`）。火堆选卡链（`campfirePickUpgrade` → `addWeaponBuffs` → `equipWeaponByType`）两种情形都**净 1 对**：① **目标 = 当前武器**：`addWeaponBuffs` 内 `wasCurrent = buffedWeapon===wt || weaponType===wt` 为真 → 自己 `leave` + 入列 + `enter`（1 对）；随后 `equipWeaponByType` 因「已是当前武器」直接 `return false` → **不重复**。② **目标 ≠ 当前武器**：`addWeaponBuffs` 的 `wasCurrent` 为假且 `p.weaponType !== weaponType` → **只入列、不 leave/enter**；由 `equipWeaponByType` 完成 `leave`(旧) + `enter`(新)（1 对）。所有早退守卫都在 `leaveWeapon` **之前** → **不存在「只 leave 不 enter」的孤儿回退**。以后若新增切换入口，别在守卫前/后额外补 leave/enter，否则破坏净对数（加成残留或重复叠加）。

55. **`rayToBounds` 在近轴射线上会算出「负距离」→ 射线反向/退化**（重装机兵实现时实测踩到）。现象：敌人朝正左（`ang = π`）发射时，`sin(π) = -1.22e-16`（**负的极小值**），`rayToBounds` 的 `else if (dy < 0) t = Min(t, -y0/dy)` 分支因此算出 **t = -59**，`Math.min(墙距, t)` 取到负值 → 终点落在**反方向**（实测激光 `x1 = 138.7` 而起点 `x0 = 79.3`，光束朝背后画、且打不到玩家）。**正确做法**：求交前把近零分量归零 + 长度夹非负 —— 已抽成 `enemy-ai.js` 的**模块级私有 `rayDir(ang)` / `aimRay(scene, ox, oy, ang, walls)`**，重装机兵的**瞄准线与激光共用这一份**（`heavyMechUpdateSight` / `heavyMechFireLaser`）；新写任何「cos/sin 求方向 + rayToBounds/rayWallDistance 求终点」的代码都复用它（`weapons.js:spawnLaser` 仍是自算，属固有隐患）。

56. **瞄准线必须是「无限长、只被墙截断」——端点只能在战斗侧算，渲染端不得自截**（用户口径）。现象（错误实现）：在 `ui/heavy-mech-art.js` 里用固定长度 `sightLen(420)` 画两条线 → 线在半空断掉，且穿墙（渲染侧拿不到墙体数据）。**正确做法**：战斗侧 `heavyMechUpdateSight(e)` 在 `aim`/`align` 相位每帧用 `aimRay` 求「起点→首个墙或关卡边界」的端点写进 `e.sightLines`（起点 = 蓝色多边形边缘 `sightStart×artScale`，两条分别沿 `head ± spread/2`）；渲染端 `drawHeavyMechSight` **只按坐标 `lineBetween`**，仅用 `firePhase` 做显示门控。**代价**：`aim`/`align` 期间每敌每帧 2 条射线（`walls + bulletGateWalls`），量级可忽略；`wait` 相位不重算（渲染端也不画）。`HEAVY_MECH_LASER` 已**删除 `sightLen`**，别再加回固定长度。

57. **激光/技能方向必须在「瞄准收敛」瞬间锁定，而不是发射瞬间**（与坑 42 同一设计口径）。现象：若瞄准线一路跟随玩家、到发射当帧才定方向，那么「停顿」就毫无意义——玩家在停顿期无论怎么走都会被命中（本实现里 `align` 期 `headAngle = e.aimAngle` 冻结，`aimAngle` 在 `aim → align` 转换时写死）。**正确做法**：`aim` 阶段头部按 `rotateSpeed` 追踪玩家 + 夹角按 `aimSpeed` 收拢，夹角到 0 的那一刻写 `e.aimAngle = e.headAngle` 并进入 `align`；`align` 全程（含发射）只用 `aimAngle`。这既给出「单线瞄准 → 激光」的视觉，又把 `fireDelay` 变成真实的躲避窗口（实测横移即可躲开）。

58. **瞄准/发射期间「原地不动」是显式设计，不要顺手改成边走边打**：`stepHeavyMech` 只在 `wait` 分支调 `stepToward`；`aim`/`align` 分支**直接 return**（不位移）。若要恢复边移动边瞄准，必须同时确认「瞄准线是否还跟得住玩家」——方向锁定依赖 BOSS/敌人静止，见坑 27（圆弧对齐只能在等待期做）。

59. **波次不生成 ≠ 波次链坏了；先看 `waitForClear` 的判据算进了谁**（真实踩过：`Level1-Scene2` trigger-178「3/4 波不生成」）。`runTriggerWave` 的定时链本身很硬（只有 `restart` / `stopOnExit` 能掐 timer），所以「勾了等待清理的波次不出」必然是「判据永远不成立」。**旧实现**判据为**全场** `!this.enemies.some(e => e.alive)` → 关卡里手摆的待机敌人（`level-flow.js:293 restart` 会把 `l.enemies` 全部 `initEnemy` 进场且 `alive:true`，例如 `Level1-Scene2` 的 `boss-2-5t5`、`Level1-Scene1` 的 `mothership`，`triggerId` 为空）与别的触发器召唤的怪都会永久拦住它。**已修**：判据改为只算本触发器召唤的敌人（`triggers.js:195`：`!this.enemies.some(e => e.alive && e.triggerId === t.id)`，与 `checkAsyncTriggerEvents` 同规则）。**另两类会让「本触发器的怪」自己清不掉的东西**：① **卡墙/门外的怪**（`canSpawnAt` 只做视线判定、不做寻路判定；门不进寻路网格）→ 兜底自毁 `enemy-ai.js:updateEnemyStuck`：`resolveMovementCollision` 末尾写 `entity.pushBack`（本帧被推回距离），`game-scene.js` 敌人循环在本帧碰撞解算后调用，按 1s 窗口判「顶过障碍（`pushBack > ENEMY_STUCK_PUSH_EPS`）且窗口内净位移 < `ENEMY_STUCK_WINDOW_MOVE_PX`」，累计满 `ENEMY_STUCK_KILL_MS(5000)` → `defeatEnemy`（**母舰 / 原型机-2-5T5 除外**：手摆 BOSS，`defeatEnemy` 会触发击破运镜；也正因如此它们永远拦不住波次了）。实测：门外 basic1 顶住门后满 5s 判死；休眠 advanced2、沿墙滑动、被挤出墙的一次性推回都不误杀。② **远离玩家的 `inscreen` 波 + `advanced2`**：`attackRange:500` 决定 >500px 时只原地自转（`stepAdvanced2` 未激活分支直接 `return`）→ 永远不死，会拦住同触发器的后续波次；数据层把该波改 `surround`（或把 zone 移到玩家附近）、入口触发器首波补 `preDelay ≥ 500`。60. **敌人血量/伤害/尺寸的三层回落只在 `initEnemy` 里做一次，且尺寸必须同时改 `r` 与 `artScale`**（本次新增「触发器单波可覆盖敌人数值 + 关卡级兜底」时落地）。要点：① 回落链 = `resolveEnemyStats(level, type, wave)`（`state.js`，纯函数）→ 波次 `wave.hp/damage/scale` > `level.enemyDefaults[type]` > 全局；`initEnemy` 写法固定为 `stats?.hp ?? e.hp ?? def.hp`（用 `??` 不用 `||`，否则 `damage: 0` 会被当成未配置）。② **尺寸倍率必须同时乘碰撞半径与美术缩放**：`r = (b.size/2) × scale`、`artScale = (def.artScale ?? e.artScale ?? 1) × scale`——只在渲染端改 `artScale` 会「看起来变大、实际命中盒不变」（玩家打不中 / 怪穿墙）；只在 `r` 上改则视觉不变。③ **`wave` 只用于取数值，不留在运行时敌人对象上**：`initEnemy` 首行 `const { wave, ...spawn } = e;` 再 `...spawn`（原实现 `...e` 会把 `wave` 引用挂到每只敌人身上）。④ **生成点校验要同口径**：`spawning.js` 的 `canSpawnAt(x, y, type, minPlayerDist, scale)`（第 5 参，影响世界边界留白与整圆穿墙采样）、`findClearSpawnNearPlayer(type, scale)`、召唤阵顶点、锁定框 `size × scale` 四处都要传。⑤ **数值要传到「落地那一刻」**：`surround` 经 `spawnEffects[].wave`、`inscreen` 经 `lockEffects[].wave` 交给 `initEnemy`；新增生成模式记得同样挂 `wave`，否则该模式下覆盖静默失效。⑥ **关卡预置敌人（`l.enemies[]`）不带 `wave` → 不读 `enemyDefaults`**（它们的字段由 `normalizeEnemy` + 编辑器敌人面板落定），这是有意为之：`enemyDefaults` 只服务触发器/召唤阵生成。⑦ **别静态 import 战斗表**：`resolveEnemyStats` 在 `state.js`（被单测加载），不得反向依赖 Phaser（参见坑 30）。编辑器侧两处入口（每波三项输入 + 侧栏「敌人默认数值」面板）见 `level-design` §3.5.1。

## 8. 验证方式

```bash
# 1) 构建必须过（能抓出 import 路径错、导出名错）
npx vite build          # 基线：built 成功，97 modules（重装机兵新增 combat/heavy-mech.js + ui/heavy-mech-art.js 两个模块）

# 2) 单测必须与基线一致
node --test test/       # 基线：20 tests / 19 pass / 1 fail
                        # 唯一 fail = player-api round-trip 里旧 schema 的 `mods` 字段
                        # 被 normalizePlayer 有意丢弃（既有 schema 迁移不一致，与战斗改动无关）

# 3) 未定义标识符自检（build 抓不到，必做）
#    对你改过的文件，确认所有大写常量与纯函数都有 import
node -e "const c=require('fs').readFileSync('src/systems/combat/你改的文件.js','utf8');const imp=new Set();for(const m of c.matchAll(/import\s*\{([^}]*)\}\s*from/g))m[1].split(',').forEach(s=>imp.add(s.trim()));const body=c.split('\n').filter(l=>!l.trimStart().startsWith('import')).join('\n');[...new Set(body.match(/\b[A-Z][A-Z0-9_]{2,}\b/g)||[])].forEach(n=>{if(!imp.has(n))console.log('可疑未导入:',n)})"

# 4) 起服手动验
node server.js          # 然后浏览器打开，编辑器里选关卡 → 试玩
```

mixin 同名自检（新增 mixin 方法前必做）：装配后方法数 **303 / 真实冲突 0**（本次 +2 = `InteractablesMixin.setChestsLocked`/`chestLockWalls`（宝箱上锁红环），属关卡设计分类；此前 301 = `EnemyAiMixin.updateEnemyStuck`；旧 `if`/`for` 假阳性为扫描脚本误报），有新增即需排查。

手动冒烟对应关卡（`data/levels/`）：
| 验什么 | 用哪个关卡 |
|---|---|
| 基础射击 / 移动 / 新手引导链路 | `newbee.json` |
| 武器切换 / 工坊装改件后的弹道 | `knight-home.json` 进工坊，再进战斗关 |
| 敌人行为 / 寻路绕墙 / 波次 | `Level1-Scene1.json` |
| advanced1 冲锋 / advanced2 点射 | `Level2-Scene1.json`、`Level3-Scene1.json` |
| **重装机兵**：头朝玩家 / 缓慢逼近 / 两条**无限长**瞄准线（只被墙与关卡边界截断）收拢 → 单线锁定 → 停顿 → 激光（变粗→保持→变细）；**停顿期横移可躲开**；墙壁能挡住激光与瞄准线；激光打中只结算一次伤害；编辑器「敌人类型 → 重装机兵」5 项配置（血量/移动/旋转/瞄准/开枪延迟/射击间隔）+ 大小 | 用编辑器在任意战斗关放一只 `heavy-mech`（当前 `data/levels/*.json` 未预置）；也可直接在关卡 json 的 `enemies` 里写 `{"type":"heavy-mech","art":"","mech":{...}}` |
| 油桶连锁 / 木箱破坏 | 任意含 `barrels`/`crates` 的关卡（用 `node -e` 搜 json） |
| 休息火堆：靠近提示 / F 键回血或升级 / **矩形碰撞体挡玩家子弹与移动** / 切武器后祝福生效·回退 / **选属性卡后自动切到该武器**（`campfirePickUpgrade` → `equipWeaponByType`） | 任意含 `campfires` 的关卡（当前 `data/levels/*.json` 尚未配，需用编辑器放置火堆） |
| 局内消耗品 / 限时加成 / 即时护盾 / 临时武器 | 任意有售货机的关卡：买药水看状态图标与倒计时、数字键 5 切临时武器（使用中才倒计时）、护盾吸收后盾碎抖屏 |
| 原型机-2-5T5 全技能 / 阻挡护盾（停驻变红弹）/ 护盾主动撞红弹消除 / 技能5 蓝色漩涡 + 捕获环绕 / 技能区域 + 黑遮罩 / 紫区减速（**观察点**：护盾存在窗口是否明显变长、技能占比是否约 4:4:2（半血后 4:4:2:2）、**每个技能的区域是否都朝玩家（不空放）**、三种技能的同心弧风格是否一致、区域是否 s1 从外向内 / s2 从内向外**方向性消散**、被拦红弹是否至少 5px、**护盾主动撞红弹能否消除且扣盾不扣血**、**半血后是否出现蓝色漩涡**、**红弹被吸回是否变白带彩色拖尾**、**半血后漩涡是否把转化红弹吸成内层环绕环（贴内圈公转、不扎堆）**、**漩涡被击杀 / BOSS 死亡后环绕弹是否静止停驻原地（仍能被打到、仍能撞死玩家）**、**技能1/2 是否会把区域内的转化红弹吸/推走、且拖尾变蓝（s1）/ 变红（s2）**、**技能1/2 拖/推的转化子弹是否走完固定距离后停下（不再无限加速）**、**技能2 的角度边缘（贴合绘制扇形斜线、外扩 ≤ `zoneHitPadPx`=30px 内）是否仍能命中**、**判定是否只在绘制扇形内（最多多出 ≤30px）**、**扇形方向是否全程不变（能靠横走躲开）**、**进吸力半径即被吸、越靠近涡心吸力越强（min→max）**、**被漩涡捕获后释放的子弹是否静止原地（不再被技能带着跑）**、**漩涡被击杀是否消散**、**入涡是否每 0.5s 掉血**） | `Boss2-Test.json` |
| **触发器召唤敌人的数值三层回落**：波次覆盖 > 关卡「敌人默认数值」> 全局；尺寸倍率**同时**放大美术与碰撞体（打得到的判定与外观一致） | `Level1-Scene2.json`（`trigger-178` 有 4 波）或任意战斗关编辑器加 1 波 | 给波次/关卡兜底填 `血量/伤害/尺寸倍率` → 试玩：怪的大小与受伤量按填值生效；清空后回落（先关卡兜底、再全局 `basic1` 30/10/×1）；重开关卡不残留。`initEnemy` 契约可用临时 loader 桩自检（见 `level-design` §8） |

改完必看的现象：子弹拖尾是否正常、命中是否有特效、敌人是否会绕墙而不是贴墙抖动、护盾能否挡下正面来弹、击杀后是否掉落、**限时加成是否按时回退（属性复原且 HUD 图标消失）**、**即时护盾吸收后盾碎是否抖屏且玩家不掉血**、**临时武器使用中是否倒计时并到期自动还原主武器**。
