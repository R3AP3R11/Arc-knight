---
name: combat
description: 改武器手感与弹道、敌人 AI 行为、伤害与命中判定、护盾格挡、寻路、可破坏物（木箱/油桶）时读这份。覆盖 src/systems/combat/** 与 src/systems/economy/damage.js。
---

# 战斗相关 开发指南

> 面向首次接触本项目的 agent。读完这份应能独立完成武器/敌人/碰撞层面的需求。
> 关联 skill：数值口径见 `economy-numbers`，渲染表现见 `ui-interaction`，刷怪点与触发器见 `level-design`。

## 1. 这块负责什么

从「玩家扣下扳机」到「敌人掉落物落地」之间的全部实时逻辑：弹道生成与推进、命中与穿墙判定、敌人行为决策与寻路、玩家受伤与护盾格挡、可破坏物的破坏与连锁伤害。

玩家可见功能点：
- 3 种可用武器（基础环射 `radial` / 散射 `yellow` / 激光 `green`）+ 1 个内部保留武器（`basic`），滚轮或按键切换
- 改件（Mods）改变弹道：多轨、三发、转速、反弹、分裂、穿透、扩容
- 4 种敌人（basic1/basic2/advanced1/advanced2），各有接近—交战—环绕—冲锋/点射的行为机
- 敌人被墙阻挡时会 A* 绕路
- 玩家护盾（扇形，有角度与距离判定，可被破盾）
- 木箱可打碎产生碎片，油桶爆炸有范围伤害
- 命中特效、受击红闪、击杀计数

**不负责**：掉落内容与概率（`economy-numbers`）、敌人从哪刷出来（`level-design`）、子弹长什么样以外的世界渲染（`ui-interaction` 的 `world-render.js` 负责实际绘制调度）。

## 2. 文件地图

| 文件 | 职责 | 关键导出 | 行数 |
|---|---|---|---|
| `src/systems/combat/geometry.js` | 纯几何：网格吸附、墙体命中、圆体推出、射线求交、子弹反射 | `snap` `toCell` `wallRotationRad` `wallCorners` `pointInWall` `hitWall` `resolveCircleAgainstWalls` `hitTrigger` `rayRectIntersect` `rayRotatedRectDistance` `rayWallDistance` `rayCircleDistance` `rayToBounds` `reflectBulletAgainstWall` `pointSegmentDistance` | 222 |
| `src/systems/combat/weapons.js` | 武器定义表 + 激光生成 | `WEAPONS` `spawnLaser` | 229 |
| `src/systems/combat/enemy-ai.js` | 敌人行为机、寻路、开火、死亡结算 | `EnemyAiMixin`（13 方法） | 363 |
| `src/systems/combat/player-combat.js` | 玩家受伤、护盾格挡、武器切换、受击闪屏 | `PlayerCombatMixin`（6 方法） | 112 |
| `src/systems/combat/destructibles.js` | 木箱碎片、油桶爆炸 | `DestructiblesMixin`（2 方法） | 77 |
| `src/systems/combat/pet-runtime.js` | 玩家宠物：环绕玩家、索敌开火、受击结算 | `PetMixin`（5 方法）+ 依赖 `pet-store.getPetDef` | 163 |
| `src/systems/economy/damage.js` | 伤害公式与改件生效集合（归数值_经济，但战斗必经） | `playerDamage` `playerIncomingDamage` `activeMods` | 50 |
| `src/systems/constants.js` | 战斗相关常量（护盾、命中特效、敌人行为参数） | `SHIELD` `SHIELD_MAX` `HIT_FX_TTL` `HIT_FX_RADIUS` `BULLET_DAMAGE` `ENEMY_BEHAVIOR` `BARREL_DAMAGE` 等 | 84 |
| `src/pathfinding.js` | 网格构建与 A* | `buildGrid` `findPath` `nearestWalkable` | 105 |
| `src/game-scene.js` | `update` 主循环：开火节流、子弹推进、命中判定、敌人更新的调度点 | `createGameScene` | 742 |

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
| 改敌人绕路策略 | `enemy-ai.js:stepToward` / `findEnemyPath` + `pathfinding.js` |
| 改护盾角度/耐久/破盾 | `constants.js:SHIELD` / `SHIELD_MAX` + `player-combat.js:blockWithShield` |
| 改免伤/闪避/暴击公式 | `economy/damage.js`（同时看 `economy-numbers` skill） |
| 改墙体形状支持（矩形/圆/弧） | `geometry.js:pointInWall` + `resolveCircleAgainstWalls` |
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

`player.combat` 字段（**全部来自存档，改动请同步 `economy-numbers`**）：`maxHp` `maxShield` `attackPower`(倍率,默认1) `attackSpeed`(倍率) `critRate`(0..1) `dodgeRate`(0..1) `moveSpeed`(倍率) `damageReduction`(倍率,越小越抗)。

### 3.2 `enemy`（由 `enemy-ai.js:initEnemy` 产出）

| 字段 | 含义 | 说明 |
|---|---|---|
| `type` | 敌人类型 | `basic1`/`basic2`/`advanced1`/`advanced2` |
| `r` | 碰撞半径 | `ENEMY_BEHAVIOR[type].size / 2` |
| `alive` | 存活标记 | `defeatEnemy` 置 false，不立即移出数组 |
| `hp` / `maxHp` | 血量 | 默认取 `ENEMY_TYPES[type].hp` |
| `damage` | 撞击/子弹伤害 | 默认 `ENEMY_TYPES[type].damage` |
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

每帧推进：this.bullets.filter(...)                    game-scene.js:321
  ├ 位移 + b.dist 累加
  ├ WEAPONS[type].stepBullet?.(b, dt, this)          yellow 蛇形在此
  ├ ricochet 分支：hitWall 命中 → reflectBulletAgainstWall  geometry.js
  ├ 墙体命中：l.walls + this.activeGateWalls() 逐个 hitWall(pad=3)
  └ 敌人命中：距离 < e.r → playerDamage() 扣血 → hitEffects.push → defeatEnemy
```

### 4.2 敌人决策 → 位移
```
game-scene.js:update → 遍历 this.enemies
  ├ isInView(e)                        enemy-ai.js（相机可视矩形 viewRect）
  ├ stepEnemy(e, dt) / stepAdvanced2    enemy-ai.js（行为机主体）
  │   ├ hasLOS(x0,y0,x1,y1)            enemy-ai.js → geometry.js:rayWallDistance
  │   ├ 有视线 → moveToward（直线逼近，e.path 清空）
  │   └ 无视线 → stepToward（速度×2）→ findEnemyPath → pathfinding.js:findPath
  │        路点跟随：PATH_WAYPOINT_RADIUS = CELL*0.4，重算节流 PATH_REPATH_INTERVAL=0.25s
  ├ resolveEnemyCollision / resolveMovementCollision  enemy-ai.js
  │   └ geometry.js:resolveCircleAgainstWalls（圆体推出，含 circle/arc 特殊处理）
  └ 环绕/冲锋分支由 ENEMY_BEHAVIOR[type] 的 orbit / charge 驱动
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
  │    └ 新手关血量下限 NEWBEE_MIN_HP=5（永不失败）
  │    └ hp<=0 → this.state='fail' + syncUIState()
  └ 近身撞击走 player-combat.js:hitShield（先结算击杀，再走格挡）
```

### 4.4 敌人死亡 → 掉落
```
enemy-ai.js:defeatEnemy(e)
  ├ e.alive = false; this.kills++
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

## 5. 关键常量与数值

| 常量 | 位置 | 当前值 | 含义 | 调它影响 |
|---|---|---|---|---|
| `BULLET_DAMAGE` | `constants.js:65` | 10 | 无武器定义时的兜底伤害 | 极少走到 |
| `HIT_FX_TTL` | `constants.js:66` | 100 | 命中特效存活 ms | 特效闪现时长 |
| `HIT_FX_RADIUS` | `constants.js:67` | 40 | 命中特效绘制半径 | 特效大小 |
| `SHIELD` | `constants.js:58` | `{color:'#00eeff', arcDeg:120, gap:10, fadeMs:500}` | 护盾扇形角度/间距/淡入 | 格挡覆盖面 |
| `SHIELD_MAX` | `constants.js:59` | 50 | 护盾上限硬顶 | 存档 maxShield 天花板 |
| `SHIELD_SHAKE_MS` / `_INTENSITY` | `constants.js:60-61` | 150 / 0.004 | 挡弹抖屏 | 打击感 |
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
| `ENEMY_BEHAVIOR.basic1` | `constants.js:72` | size30 approach200 engage50 engageDelay0.4 colorRange300 | 接近距离/交战距离/变红距离 | 压迫感 |
| `ENEMY_BEHAVIOR.basic2` | `constants.js:73` | orbit `{period:2,duration:1,degPerSec:30}` spin4 | 环绕节奏 | — |
| `ENEMY_BEHAVIOR.advanced1` | `constants.js:74` | engage160 charge `{pause:0.6,speed:200}` | 冲锋前摇与速度 | 最危险近战 |
| `ENEMY_BEHAVIOR.advanced2` | `constants.js:75` | attackRange500 fireInterval400 burstInterval3000 burstCount3 speed30 | 三连点射节奏 | 远程压制 |
| `BARREL_DAMAGE` | `constants.js:35` | 30 | 油桶爆炸伤害 | 环境击杀强度 |
| `BARREL_EXPLOSION_MS` | `constants.js:36` | 100 | 爆炸动画时长 | — |
| `CRATE_DEBRIS_TTL` | `constants.js:37` | 450 | 木箱碎片存活 ms | — |
| `PLAYER_COLLISION_RADIUS` | `constants.js` | — | 玩家碰撞半径 | 卡墙手感 |
| `CELL` | `constants.js:9` | 30 | 寻路网格与吸附单位 | 全局 |
| `PATH_INFLATE` | `level/level-flow.js` | 24 | 寻路网格障碍膨胀 | 敌人贴墙程度 |

改件效果（定义在 `state.js:ITEM_DEFS`/`MOD_DEFS`，生效点在 `game-scene.js:update` 与 `weapons.js`）：`multi-track` 多轨复制弹、`triple` 三发、`spin` 射速+50%（间隔×2/3）、`ricochet` 撞墙反弹、`split` 分裂、`pierce` 激光穿墙、`capacity` 扩容。数值细节见 `economy-numbers`。

## 6. 扩展指南

### 6.1 新增一种武器
1. `src/systems/combat/weapons.js` 的 `WEAPONS` 加一项，必填 `scheme` `ringColor` `fireInterval` `baseDamage`，可选 `maxAmmo`（不填=无限）`chargeRequired`。
2. 实现 `fire(player, level, scene)`：返回 bullet 数组（每个至少含 `x,y,vx,vy,dist,weaponType,level,trailColor`）；若是即时命中类，返回 `{ beam:true, ox, oy, angle, width, color }` 并在 `game-scene.js:update` 的 beam 分支接上（参考 `green`）。
3. 需要特殊弹道则实现 `stepBullet(b, dt, scene)`；需要自定义外观实现 `drawBullet(g, b)`（`g` 是 Phaser Graphics）。
4. `src/state.js` 的 `WEAPON_TYPES` 与 `WEAPON_LABELS` 各加一条（否则 UI 显示 id）。
5. 若要能购买/解锁：`data/ui/weapon.json` 加 `prices` 条目（详见 `economy-numbers`）。
6. 武器轮图标：`src/ui-layer.js:drawWeaponGlyph` 加分支（详见 `ui-interaction`）。

### 6.2 新增一种敌人行为
1. `src/state.js:ENEMY_TYPES` 加类型（`hp` / `damage` / `name`）。
2. `src/systems/constants.js:ENEMY_BEHAVIOR` 加同名条目（`size` 必填，其余按需：`approach` `engage` `engageDelay` `colorRange` `orbit` `charge` `spin` `attackRange` `fireInterval` 等）。
3. `enemy-ai.js:initEnemy` 若需要新的运行时字段，在返回对象里补默认值。
4. 行为逻辑：简单变体直接吃 `ENEMY_BEHAVIOR` 参数即可；复杂的仿照 `stepAdvanced2` 新写一个 `stepXxx`，并在 `stepEnemy` 里按 `e.type` 分派。
5. 外观：`src/systems/ui/entity-art.js:drawEnemyShape` 加分支（详见 `ui-interaction`）。
6. 关卡里能配出来：`level-design` skill 的敌人字段。

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
- **`orbit`** 环绕六边形：**无子弹**，`appearance.elements[<orbitIndexes>]` 的复合体（如 禅灭 = elements[0]+[1] 的 6 颗六边形）绕玩家转圈撞击敌身。三段动态轨道在 `game-scene.js:update` 的 `mechanic.orbit` 分支维护运行时 `player.orbit`（按住左键→二段 radius 250/角速×2/体积×2，按住≥`phase3HoldMs`→三段 400/×4/×4；松开→`retractMs` 内平滑收拢回基础）。判伤按 `hitIntervalMs` 对同敌节流，伤害走 `playerDamage`（固定=`baseDamage`，不乘体积倍率）；命中可破坏物：箱子 `spawnCrateDebris`/油桶 `explodeBarrel`（一次触发、无节流）。**`fire()` 直接返回 `[]`**。
- 渲染：`entity-art.js:drawWeaponMedium` 在 `chg || mouseAim` 下画**中心瞄准线**（常显、长度近似无限、蓄满变红）+ 两条散射边界线（蓄力中，±当前散射角）+表盘红弧带（**半径=`arc.r`、厚度减半、角度=当前散射角随蓄力减小**）+发射小球改为圆弧（角度=当前散射）。**orbit 武器例外**：`entity-art.js:drawPlayer` 走 `buildOrbitInstance`（weapon-runtime）动态克隆外观渲染（不污染共享 `WEAPONS[id].appearance`）+ `drawOrbitTrail` 画每颗六边形航迹，**跳过 `drawWeaponMedium`**（去掉发射环/小球）。
- 新机制字段要同步 `weapon-design.js:normalizeMechanic` + `weapon-board.js:scalarFields`（特殊机制/蓄力参数组）+ 命中/渲染分支。示例：`data/weapons/weapon-1788656554163.json`（冥狙）、`data/weapons/weapon-1788679714207.json`（禅灭，orbit）。

## 7. 坑与约束

1. **mixin 同名方法会静默覆盖**。装配顺序在 `game-scene.js` 的 `Object.assign(EditorScene.prototype, EnemyAiMixin, PlayerCombatMixin, DestructiblesMixin, SpawningMixin, TriggersMixin, InteractablesMixin, LevelFlowMixin, HudMixin, UiRuntimeMixin, ScreensMixin, SaveLoginMixin, NewbeeHubMixin, WorkshopMixin, DropsMixin, ProgressionMixin, EditorInputMixin, EditorCameraMixin, WorldRenderMixin, WorldOverlayMixin)`。**后面的覆盖前面的**。新增方法前先确认全仓没有同名（`node -e` 扫 `^    方法名(`）。
2. **`const ctx = this.ctx;` 约定**。`ctx` 是 `createGameScene(ctx)` 的注入对象（含 `state` / 各种回调 `onXxx`）。mixin 里用不到闭包，凡是要访问 `ctx` 的方法**必须在方法体首行声明** `const ctx = this.ctx;`。漏写会 ReferenceError，而且 `vite build` **检测不到**（Rollup 不做未定义标识符检查）。
3. **`pointInWall` 有两个版本**：`geometry.js:pointInWall(wall, x, y, pad)` 是纯函数（几何判定），`player-combat.js` 里还有一个同名的场景方法版（遍历当前关卡墙体）。两者用途不同，别互相替换。
4. **`weapons.js ↔ economy/damage.js` 存在循环 import**（`WEAPONS` ↔ `activeMods`）。ESM 函数提升让它在运行期安全，但**绝不能把 `activeMods` 或 `WEAPONS` 改成模块顶层立即求值**，否则 TDZ 拿到 `undefined`。
5. **`spawnLaser` 通过 `scene.ctx` / `scene.worldSize()` 访问场景**，它是纯函数不是 mixin 方法，第一个参数必须传场景实例。
6. **墙体旋转**：所有判定都要先经 `wallRotationRad` 转到局部坐标系。新写判定函数别忘了处理 `rotation`，否则旋转墙会判定错位。
7. **`arc` 形状墙**用 `w/2 ± thickness/2` 的环带 + 角度跨度判定，`circle` 用 `w/2` 当半径而不是 `w`。写新形状记得三处都改：`pointInWall` / `resolveCircleAgainstWalls` / `rayWallDistance`。
8. **闸门（gate）不在 `level.walls` 里**，是 `this.activeGateWalls()` 动态产出的。子弹/敌人碰撞判定要**同时**查这两个来源（`game-scene.js:update` 已这么做，新加判定别漏）。
9. **`defeatEnemy` 只置 `alive=false` 不移出数组**。遍历 `this.enemies` 时必须 `if (!e.alive) continue;`。
10. **敌人寻路网格是关卡加载时一次性构建**（`level-flow.js:restart` 里 `buildGrid`），墙体运行时变化（如开门）**不会**自动重建网格，敌人可能穿过刚关的门附近或绕不必要的路。
11. **`spawnLaser` 是即时伤害**（发射瞬间就判定完），激光的 `ttl` 只是视觉残留。改激光"持续伤害"需要改成每帧判定。
12. **改件 `pierce` 只影响激光**（`spawnLaser` 里判），`ricochet`/`split` 只影响实体子弹（`game-scene.js:update` 里判）。加新改件要想清楚生效点在哪一侧。
13. **既有隐患**：`src/systems/ui/entity-art.js:193` 的 `INTRO_RING_COUNT` 是未定义变量（原始代码遗留）。仅当 `fx.introRingCount` 为空时才会走到，目前只有 `data/levels/login.json` 用该特效且已配该字段，所以不会崩。改虫洞特效时注意。
14. **`this.player.combat` 可能为空**（`playerDamage` / `playerIncomingDamage` 都有 `if (!combat)` 兜底）。新写读 `combat` 的代码要带默认值。
15. **宠物子弹必须带 `b.petDamage`**。现有命中分支只用 `playerDamage(this, weaponType)`；宠物子弹在 `firePet` 里补 `petDamage`，命中处 `b.petDamage != null` 才覆盖，否则按武器 baseDamage 结算（会偏高）。
16. **敌弹命中宠物在 shield 之后、玩家之前**，且仅 `pet.invincible === false` 时结算。首帧 `draw` 可能先于 `updatePets`，`this.pets` 尚未初始化，`drawPets`/敌弹判定须用 `this.pets || []` 兜底。
17. **宠物环绕不参与墙体碰撞**（`updatePets` 不调 `resolveMovementCollision`）。半径穿墙时宠物会显示在墙内，仅视觉问题；如需卡墙需自行加回推。
18. **ampArc 穿弧判定要用子弹航向角而不是位置角**：子弹从发射环（半径=`medium.radius`）出发，接近环时不同散射角的子弹位置角都逼近 `weaponAngle`，用 `atan2(b.y-p.y, b.x-p.x)` 会把弧外子弹误判为穿弧（该白的红了）；半径判定必须用 `arc.r`（带圆半径），用 `ringR`（=发射环=子弹起点）会让首帧 `d0-ringR==0` 恒穿越（该红的全红）。正确几何见 §6.6。

## 8. 验证方式

```bash
# 1) 构建必须过（能抓出 import 路径错、导出名错）
npx vite build          # 基线：built 成功，约 60 modules

# 2) 单测必须与基线一致
node --test test/       # 基线：16 pass / 5 fail
                        # 5 个 fail 全是 player-api.test.js 的 'fetch failed'，
                        # 需要先起 node server.js 才会过，属既有情况、与战斗改动无关

# 3) 未定义标识符自检（build 抓不到，必做）
#    对你改过的文件，确认所有大写常量与纯函数都有 import
node -e "const c=require('fs').readFileSync('src/systems/combat/你改的文件.js','utf8');const imp=new Set();for(const m of c.matchAll(/import\s*\{([^}]*)\}\s*from/g))m[1].split(',').forEach(s=>imp.add(s.trim()));const body=c.split('\n').filter(l=>!l.trimStart().startsWith('import')).join('\n');[...new Set(body.match(/\b[A-Z][A-Z0-9_]{2,}\b/g)||[])].forEach(n=>{if(!imp.has(n))console.log('可疑未导入:',n)})"

# 4) 起服手动验
node server.js          # 然后浏览器打开，编辑器里选关卡 → 试玩
```

手动冒烟对应关卡（`data/levels/`）：
| 验什么 | 用哪个关卡 |
|---|---|
| 基础射击 / 移动 / 新手引导链路 | `newbee.json` |
| 武器切换 / 工坊装改件后的弹道 | `knight-home.json` 进工坊，再进战斗关 |
| 敌人行为 / 寻路绕墙 / 波次 | `Level1-Scene1.json` |
| advanced1 冲锋 / advanced2 点射 | `Level2-Scene1.json`、`Level3-Scene1.json` |
| 油桶连锁 / 木箱破坏 | 任意含 `barrels`/`crates` 的关卡（用 `node -e` 搜 json） |

改完必看的现象：子弹拖尾是否正常、命中是否有特效、敌人是否会绕墙而不是贴墙抖动、护盾能否挡下正面来弹、击杀后是否掉落。
