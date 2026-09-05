---
name: product-manager
description: 收到任何新需求、迭代、改动、bug 修复请求时**先读这份**。负责把需求归类到 6 大功能分类、指路对应 skill、给出跨分类同步清单，并在实施完成后回写更新相应 skill。触发词：新需求 / 加个功能 / 改一下 / 迭代 / 这个需求怎么做 / 归到哪类 / 更新 skill / 我想做…。
---

# 产品经理 · 需求路由与 skill 维护指南

> 你是本项目的需求入口。任何需求进来，**先用这份 skill 完成归类与指路，再去读对应的分类 skill 动手**。
> 不要凭直觉直接改代码 —— 本项目有 63 个源文件、19 个 mixin、大量跨文件同步点，漏改一处就会出运行时崩溃（`vite build` 抓不到）。

---

## 1. 你的职责

| 阶段 | 你要做的事 | 产出 |
|---|---|---|
| ① 澄清 | 把模糊需求变成可判定的改动描述 | 一句话需求 + 验收标准 |
| ② 归类 | 判定主分类 + 涉及的次分类 | 分类结论 + 要读哪几份 skill |
| ③ 指路 | 给出落点文件与跨分类同步清单 | 文件级 TODO 清单 |
| ④ 实施 | 读对应 skill 后动手（或派子 agent） | 代码改动 |
| ⑤ 验证 | 跑构建/测试/未定义标识符自检/手动冒烟 | 验证结果 |
| ⑥ 回写 | **更新受影响的 skill**，保持文档与代码同步 | skill diff |

**⑥ 不是可选项。** 代码改了但 skill 没更新，下一个 agent 就会按过期信息干活。本项目已经吃过这个亏（见 §7.1）。

---

## 2. 项目全景（一页速查）

**技术栈**：Phaser 4 + Vite，纯 ESM（`package.json` 里 `"type":"module"`），Electron 打包，`server.js` 提供开发期 JSON 读写 API。
**形态**：游戏 + 关卡编辑器二合一，同一个 `EditorScene` 靠 `this.editing` / `ctx.state.mode`（`editor`/`play`/`trial`）分流。

### 代码分布（`src/` 共 63 文件 / 16834 行）

| 分类 | 目录 | 文件数 | 行数 | 对应 skill |
|---|---|---|---|---|
| 战斗相关 | `src/systems/combat/` | 6 | 1055 | `combat` |
| 数值_经济 | `src/systems/economy/` + `player-data.js` | 5 | 627 | `economy-numbers` |
| 关卡设计 | `src/systems/level/` + `rooms.js` | 5 | 1403 | `level-design` |
| 系统玩法 | `src/systems/gameplay/` | 3 | 1718 | `gameplay-systems` |
| UI交互 | `src/systems/ui/` + `ui-layer/ui-bindings/ui-config/ui-preview/ui.js` | 12 | 4425 | `ui-interaction` |
| 引擎(编辑器) | `src/systems/editor/` + `src/editor/` + `server.js` + `src/systems/art/` | 31 | 6577 | `engine-editor` |
| 共享 | `game-scene.js`(589) `state.js`(527) `constants.js`(91) `pathfinding.js`(105) `api.js`(67) `main.js`(93) | 6 | 1472 | 见 §3.3 |

### 架构不变量（改任何分类都必须遵守）

1. **mixin 装配顺序**（`src/game-scene.js` 末尾）：
   `EnemyAiMixin, PlayerCombatMixin, DestructiblesMixin, PetMixin, SpawningMixin, TriggersMixin, InteractablesMixin, LevelFlowMixin, HudMixin, UiRuntimeMixin, ScreensMixin, SaveLoginMixin, NewbeeHubMixin, WorkshopMixin, DropsMixin, ProgressionMixin, EditorInputMixin, EditorCameraMixin, WorldRenderMixin, WorldOverlayMixin`
   **后者覆盖前者同名方法**。新增方法前先扫全仓是否重名。
2. **`const ctx = this.ctx;` 约定**：mixin 方法要访问注入对象 `ctx`（含 `ctx.state` 与 `ctx.onXxx` 回调）时，**必须在方法体首行声明**。漏写 → 运行时 ReferenceError，且 `vite build` 检测不到。
3. **`game-scene.js` 只保留 `constructor` / `create` / `update` + 装配**。新逻辑一律写进对应分类的 mixin 模块，不要往 `game-scene.js` 堆。
4. **不允许 `src/systems/**` 反向 import `game-scene.js`**（会成环）。
5. **已知循环 import**：`combat/weapons.js` ↔ `economy/damage.js`（`WEAPONS` ↔ `activeMods`）。运行期安全，但**不能改成模块顶层立即求值**。
6. **武器目录叶子模块**：新增 `src/systems/art/weapon-registry.js`（无依赖叶子）管理运行时武器目录（radial/yellow/green + 设计武器 id），供 `state.js`/`player-data.js` 查询，**避免 state↔player-data 循环依赖**。黄色/绿色武器由启动 `registerBuiltinWeapons()` 从设计稿注册驱动，**不再硬编码战斗逻辑**（`combat/weapons.js` 字面量仅剩 radial/basic，`WEAPON_TYPES=['radial']`）。目录查询用 `weaponCatalog()`/`isKnownWeapon()`。

### 基线（每次改完必须回到这个状态）

```bash
npx vite build      # 成功，约 79 modules
node --test test/   # 无 server：16 pass / 5 fail；起 server 后 19 pass / 1 fail
                    # 5 个 fail 全是 test/player-api.test.js 的 'fetch failed'（需先起 node server.js）。
                    # 起 server 后剩 1 个 fail 为 player-api round-trip 里旧 schema 的 `mods` 字段
                    # 被 normalizePlayer 有意丢弃（既有的 schema 迁移不一致，非本改件任务引入）
```

---

## 3. 需求归类

### 3.1 决策流程（按顺序问，第一个命中即为主分类）

```
需求进来
 │
 ├─ 涉及「一个数字/概率/价格/公式/存档字段」的调整？        → 数值_经济
 │    （伤害值、掉落率、商店价、加点收益、等级曲线、物品定义）
 │
 ├─ 涉及「战斗中每帧发生的事」？                          → 战斗相关
 │    （弹道、命中、敌人AI、寻路、护盾、可破坏物）
 │
 ├─ 涉及「关卡里配什么、什么时候刷、走到哪触发」？          → 关卡设计
 │    （关卡json、触发器、波次、刷怪点、宝箱/传送门/售货机、关卡切换）
 │
 ├─ 涉及「战斗外的流程与元游戏」？                        → 系统玩法
 │    （工坊装备、新手引导、骑士之家、登录、存档选择）
 │
 ├─ 涉及「玩家看到的界面长什么样、点了有什么反应」？        → UI交互
 │    （HUD、弹窗页面、世界层特效、data/ui 节点图、点击派发）
 │
 └─ 涉及「编辑器怎么编、数据怎么存、怎么打包」？            → 引擎(编辑器)需求
      （编辑器拖拽、属性面板、撤销、相机、server API、Electron）
```

### 3.2 关键词路由表

| 需求里出现这些词 | 主分类 | 必读 skill |
|---|---|---|
| 伤害、暴击、闪避、免伤、攻速倍率 | 数值_经济 | `economy-numbers` + `combat` |
| 掉落、概率、金币、经验、物品、改件数值 | 数值_经济 | `economy-numbers` |
| 加点、升级、等级、存档字段 | 数值_经济 | `economy-numbers` |
| 商店价格、售价 | 数值_经济 | `economy-numbers`（价格在 `data/ui/weapon.json`，不在代码里） |
| 武器、弹道、子弹、激光、开火、弹夹 | 战斗相关 | `combat` |
| 敌人、AI、行为、寻路、绕路、冲锋、点射 | 战斗相关 | `combat` |
| 护盾、格挡、破盾、受击 | 战斗相关 | `combat` |
| 木箱、油桶、爆炸、破坏 | 战斗相关 | `combat` |
| 关卡、场景、地图、房间生成 | 关卡设计 | `level-design` |
| 触发器、事件、波次、刷怪、门/gate | 关卡设计 | `level-design` |
| 宝箱、传送门、售货机、神像、图标交互 | 关卡设计 | `level-design` |
| 通关、结算、关卡切换、过场 | 关卡设计 | `level-design` |
| 工坊、背包、装备、装/卸改件、拖拽装备 | 系统玩法 | `gameplay-systems` |
| 新手引导、教程、提示 | 系统玩法 | `gameplay-systems` |
| 骑士之家、Hub、F 键交互 | 系统玩法 | `gameplay-systems` |
| 登录、开新档、选存档、存档槽 | 系统玩法 | `gameplay-systems` |
| HUD、血条、弹药显示、武器轮盘 | UI交互 | `ui-interaction` |
| 弹窗、页面、按钮、点击、界面布局 | UI交互 | `ui-interaction` |
| 特效、渐显、动画、美术表现、颜色 | UI交互 | `ui-interaction` |
| data/ui、节点图、renderGraph、绑定 | UI交互 | `ui-interaction` |
| 编辑器、拖拽实体、手柄、框选、吸附 | 引擎(编辑器) | `engine-editor` |
| 属性面板、字段、下拉框 | 引擎(编辑器) | `engine-editor` |
| 撤销、复制粘贴、快捷键 | 引擎(编辑器) | `engine-editor` |
| 相机、缩放、视图、跟随 | 引擎(编辑器) | `engine-editor` |
| 保存、草稿、API、server、落盘 | 引擎(编辑器) | `engine-editor` |
| 打包、Electron、exe、资源分发 | 引擎(编辑器) | `engine-editor` |
| 画板、美术资产、设计稿、一组多边形转动、动画资产、轮廓、独立画板、轮廓库 | 引擎(编辑器) | `engine-editor` |
| 试玩、预览、模式切换 | 引擎(编辑器) | `engine-editor` + `gameplay-systems` |

### 3.3 共享文件的归属判定

这几个文件被多分类共用，**按你改的字段判定归属，并通知所有受影响分类**：

| 文件 | 改什么 → 归哪类 |
|---|---|
| `src/state.js` | `ENEMY_TYPES` → 战斗；`ITEM_DEFS`/`MOD_DEFS`/`DROP_ITEMS` → 数值_经济；`normalizeLevel`/`normalizeCrate` 等/`EVENT_TYPES` → 关卡设计；`createState`/`state.ui` → 引擎 |
| `src/systems/constants.js` | 按常量语义分（`SHIELD`/`ENEMY_BEHAVIOR` → 战斗；`CHEST_*`/`GATE_*` → 关卡；`VIEW_*`/`FONT_*`/`PLAYER_ART` → UI；`ROTATE_HANDLE_OFFSET` → 引擎） |
| `src/game-scene.js` | 只有 `create`/`update` 的调度顺序会改 → 通知所有相关分类 |
| `src/pathfinding.js` | → 战斗（寻路），但网格构建时机在 `level/level-flow.js:restart` → 同步通知关卡设计 |
| `src/api.js` | → 引擎(编辑器) |
| `src/main.js` | → 引擎(编辑器) |

### 3.4 多分类需求怎么拆

大多数真实需求跨 2-4 个分类。**标准做法：定一个主分类负责主逻辑，其余作为「同步点」列清单**。

**示例：「新增一种武器」**
| 分类 | 落点 | 必要性 |
|---|---|---|
| 战斗相关（主） | `combat/weapons.js` 的 `WEAPONS`（字面量仅 radial/basic）+ `fire`/`stepBullet`/`drawBullet` | 必须 |
| 引擎(编辑器) | 新武器设计稿：`art/weapon-registry.js`(`weaponCatalog`/`isKnownWeapon`) + `art/default-weapons.js`(`buildBuiltinWeaponDesigns`) + `art/weapon-store.js`(`registerBuiltinWeapons`)，并确保 `main.js` 顶层调用 `registerBuiltinWeapons()` | 必须 |
| 数值_经济 | `data/ui/weapon.json` 加价格；`state.js` 的 `WEAPON_TYPES`/`WEAPON_LABELS` | 必须 |
| UI交互 | `ui-layer.js:drawWeaponGlyph` 加武器图标分支 | 必须 |
| 系统玩法 | 工坊页武器槽显示（`weaponCatalog()` 通常自动适配，需验证） | 验证 |

**示例：「新增一种敌人」**
| 分类 | 落点 |
|---|---|
| 战斗相关（主） | `state.js:ENEMY_TYPES` + `constants.js:ENEMY_BEHAVIOR` + `enemy-ai.js:initEnemy`/行为分派 |
| UI交互 | `ui/entity-art.js:drawEnemyShape` 加外观分支 |
| 关卡设计 | 关卡 json 能配出来 + 波次能刷出来 |
| 数值_经济 | 掉落规则是否要为新类型单独配 |

**示例：「新增一个触发器事件类型」**
| 分类 | 落点 |
|---|---|
| 关卡设计（主） | `state.js:EVENT_TYPES` + `level/triggers.js:dispatchTriggerEvent` 加分支 |
| 引擎(编辑器) | `editor/entity-properties.js` 的事件类型下拉**硬编码列表**（与 `EVENT_TYPES` 各自维护，漏改则面板选不到） |

---

## 4. 标准工作流

### 步骤 1 · 澄清需求
把需求写成这个格式，模糊处**主动问用户**（用选择题，别自己猜）：
```
需求：<一句话，动词开头>
验收：<怎么算做完了，最好是可观察的现象>
范围：<明确不做什么>
```

### 步骤 2 · 归类并宣告
输出给用户看的归类结论：
```
主分类：<X>（读 .codemaker/skills/<x>/SKILL.md）
同步点：<Y 分类的 a 文件>、<Z 分类的 b 文件>
预计落点：<文件:函数 列表>
```

### 步骤 3 · 读 skill 再动手
**必须先读主分类 skill 的第 2、3、6、7 章**（文件地图 / 数据结构 / 扩展指南 / 坑）。扩展指南里往往已经有现成的分步清单。

### 步骤 4 · 实施
- 遵守 §2 的 5 条架构不变量。
- 新增逻辑放对应 mixin 模块，不要新建平行体系。
- 单文件超过 ~600 行考虑再拆（本项目重构基线：`game-scene.js` 从 7224 行拆到 568 行）。

### 步骤 5 · 验证（四件套，缺一不可）

```bash
# ① 构建
npx vite build

# ② 测试（改了 player-data.js / state.js 的数值字段时尤其重要）
node --test test/

# ③ 未定义标识符自检 —— vite build 抓不到，本项目已因此崩过两次
node -e "const fs=require('fs');const f='你改的文件路径';const c=fs.readFileSync(f,'utf8');const imp=new Set();for(const m of c.matchAll(/import\s*\{([^}]*)\}\s*from/g))m[1].split(',').forEach(s=>imp.add(s.trim().split(/\s+as\s+/).pop()));for(const m of c.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g))imp.add(m[1]);const decl=new Set([...c.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]));const body=c.split('\n').filter(l=>!l.trimStart().startsWith('import')).join('\n');[...new Set(body.match(/\b[A-Z][A-Z0-9_]{2,}\b/g)||[])].forEach(n=>{if(!imp.has(n)&&!decl.has(n))console.log('可疑未导入:',n)})"

# ④ mixin 同名冲突自检
node -e "const fs=require('fs'),p=require('path');const fl=[];(function w(d){for(const f of fs.readdirSync(d)){const q=p.join(d,f);fs.statSync(q).isDirectory()?w(q):q.endsWith('.js')&&fl.push(q.replace(/\\/g,'/'))}})('src/systems');const o=new Map();for(const f of fl){const c=fs.readFileSync(f,'utf8');const i=c.search(/export const \w+Mixin = \{/);if(i<0)continue;c.slice(i).split(/\r?\n/).forEach(l=>{const m=l.match(/^    ([A-Za-z_$][\w$]*)\s*\(/);if(m){if(!o.has(m[1]))o.set(m[1],[]);o.get(m[1]).push(f)}})}let d=0;for(const [n,v] of o)if(v.length>1){console.log('❌ 同名:',n,'->',v.join(' , '));d++}console.log('mixin 方法数',o.size,'冲突',d)"
```

改了 `server.js` 或存档相关：额外起 `node server.js` 再跑一遍 `node --test test/`，5 个 fetch 用例应转绿。

手动冒烟（`node server.js` 后开页面）：
| 验什么 | 关卡 |
|---|---|
| 登录 / 存档选择 | `data/levels/login.json` |
| Hub / 工坊 / 商店 | `knight-home.json` |
| 新手引导 | `newbee.json` |
| 战斗 / 敌人 / 触发器 | `Level1-Scene1.json` |
| 编辑器全流程 | 任意关卡：拖实体 → 改属性 → 撤销 → 存草稿 → 试玩 → 退出确认编辑器数据未变 |

### 步骤 6 · 回写 skill（详见 §5）

---

## 5. skill 回写规范

### 5.1 哪种改动要更新哪一章

| 你做了什么 | 要更新的章节 |
|---|---|
| 新增/删除文件 | 第 2 章 文件地图（含行数）+ 速查表 |
| 新增/改名方法 | 第 2 章 速查表 + 第 4 章 关键流程（若在主链路上） |
| 改数值/常量 | **第 5 章 关键常量与数值（必须改当前值）** |
| 新增运行时字段 | 第 3 章 核心数据结构 |
| 改调用链顺序 | 第 4 章 关键流程 |
| 加了新的跨文件同步点 | 第 6 章 扩展指南 + 第 7 章 坑 |
| 踩到并解决了一个坑 | **第 7 章 坑与约束（写清现象 + 根因 + 正确做法）** |
| 改了验证方式 | 第 8 章 验证方式 |
| 改动影响其他分类 | 对应分类 skill 的同名章节 + 双方的「详见 xx skill」指路 |

### 5.2 回写硬性要求

- **行数与数值必须实测**，不许沿用旧值。文件行数用：
  `node -e "console.log(require('fs').readFileSync('路径','utf8').split(/\r?\n/).length)"`
- 保留 8 章结构与 frontmatter 的 `name` / `description` 格式。
- `description` 里要能被触发词命中；新增了能力就补触发词。
- 单份 skill 控制在 300-760 行，超了压成表格，不要贴大段源码（用「文件:函数」引用）。
- 分类边界变动时，**同时**改双方 skill 的指路句，避免出现孤岛。

### 5.3 也要更新这份 PM skill 的时机

- 新增/合并了功能分类 → §2 分布表 + §3.1 决策流程 + §3.2 路由表
- 架构不变量变了（如改了 mixin 方案、去掉 `this.ctx` 约定）→ §2 不变量
- 基线变了（modules 数、测试通过数）→ §2 基线 + §4 步骤 5
- 出现新的高频需求类型 → §3.4 拆解示例

### 5.4 skill 健康检查

每次回写后跑一遍：
```bash
node -e "const fs=require('fs');for(const d of fs.readdirSync('.codemaker/skills')){const p='.codemaker/skills/'+d+'/SKILL.md';if(!fs.existsSync(p)){console.log('❌ 缺 SKILL.md:',d);continue}const t=fs.readFileSync(p,'utf8');const L=t.split(/\r?\n/);const secs=L.filter(l=>/^## \d/.test(l)).length;const fm=/^---[\s\S]*?name:\s*\S+[\s\S]*?description:\s*\S+[\s\S]*?---/.test(t);console.log((secs===8&&fm?'✅':'⚠️ '),d.padEnd(18),L.length+'行','章节'+secs,fm?'frontmatter ok':'frontmatter 缺失')}"
```

---

## 6. 常见需求 → 归类速查

| 需求原话 | 主分类 | 涉及文件（起点） |
|---|---|---|
| 「敌人太难了，削弱一下」 | 数值_经济 | `state.js:ENEMY_TYPES`（血/伤）+ `constants.js:ENEMY_BEHAVIOR`（速度/距离） |
| 「加一把霰弹枪」 | 战斗相关 | `combat/weapons.js` → 见 §3.4 |
| 「敌人会绕后偷袭」 | 战斗相关 | `combat/enemy-ai.js:stepEnemy` + `ENEMY_BEHAVIOR` |
| 「子弹打墙要反弹」 | 战斗相关 | 已有 `ricochet` 改件；扩展看 `geometry.js:reflectBulletAgainstWall` |
| 「做第 4 大关」 | 关卡设计 | 新建 `data/levels/Level4-Scene*.json` + `ui/screens.js:drawLevelSelect` 的关卡数 |
| 「打完一波关门放第二波」 | 关卡设计 | `level/triggers.js` 波次 + `spawnGate`/`removeGate` 事件 |
| 「加个隐藏房间带宝箱」 | 关卡设计 | 关卡 json 的 `walls`/`chests` + `level/interactables.js` |
| 「工坊能一键卸下全部装备」 | 系统玩法 | `gameplay/workshop.js` 新增方法 + `data/ui/workshop.json` 加按钮 |
| 「新手引导加一步教举盾」 | 系统玩法 | `gameplay/newbee-hub.js:advanceNewbee` 阶段机 |
| 「存档从 3 个加到 5 个」 | 系统玩法 | `gameplay/save-login.js:drawSaveSelectUI` + `data/players/index.json` + `server.js` |
| 「血条改成竖的放左边」 | UI交互 | `ui/hud.js:drawHudBars` + `ui/hud-art.js` |
| 「加个小地图」 | UI交互 | 新增 `ui/minimap.js` `MinimapMixin` + `game-scene.js` 装配（末尾`Minimap`）+ `ui-runtime.js:drawUI` 战斗态兜底分支调用；标记数据契约挂在 `roomLayout.cells[].marker`（`state.js` 的 `MINIMAP_MARKER_TYPES/LABELS`+`normalizeRoomMarker`、`rooms.js:generateRoomLayout` 的 `rooms[i].marker`），编辑器右侧房间面板 `#roomCellPopup` 配标记类型+图标资产（`room-panel.js:applyRoomMarker`） |
| 「击杀要有飘字」 | UI交互 | `ui/world-overlay.js` 新增方法 |
| 「编辑器要支持多选」 | 引擎(编辑器) | `systems/editor/editor-input.js` + `state.selected` 改数组（**当前是单选，改动面大**） |
| 「属性面板加一个字段」 | 引擎(编辑器) | `editor/entity-properties.js` + `state.js` 的 normalize |
| 「导出关卡为独立文件」 | 引擎(编辑器) | `server.js` 新增端点 + `src/api.js` + `editor/bindings.js` |
| 「打包后找不到图标」 | 引擎(编辑器) | `package.json` 的 `extraResources` + `electron/` 主进程静态路径 |
| 「画板 / 美术资产 / 一组多边形绕圆心转 / 动态资产 / 保存设计稿 / 绘制轮廓 / 轮廓库」 | 引擎(编辑器) | `src/systems/art/asset-render.js`（渲染核心）+ `src/editor/artboard.js`（主画板工作台）+ `src/editor/draw-board.js`（独立画板轮廓绘制）+ `server.js` `/api/assets`+`/api/outlines` + `api.js` |
| 「武器 / 弹道 / 设计子弹外形轨迹 / 单发数量散布 / 发射媒介」 | 引擎(编辑器) | `src/systems/art/weapon-runtime.js`（弹道解释器）+ `src/editor/weapon-board.js`（工作台）+ `weapon-design.js` + `weapon-store.js`（`registerBuiltinWeapons`）+ `weapon-registry.js`（`weaponCatalog`/`isKnownWeapon`）+ `default-weapons.js`（`buildBuiltinWeaponDesigns`）+ `server.js` `/api/weapons`；战斗接入见 `player-data.js`、`main.js`（`loadWeaponDefs`/`registerBuiltinWeapons`）、`weapon-caps.js` |
| 「宠物 / 环绕攻击 / 圣物 / 局内购买宠物」 | 战斗相关 + 引擎(编辑器) | 数值在 `data/pets/*.json`（`pet-design.js`/`pet-store.js`/`pet-board.js`/`default-pets.js`/`server.js` `/api/pets`）；战斗行为 `combat/pet-runtime.js:PetMixin`（机制硬编码）；装备/购买写 `equipment.pets`/`items.uniques`（`screens.js:buyPet`）；`state.js:ITEM_DEFS` 加 `category:'pet'` 物品 | 
| 「点了按钮没反应」 | 先定位再归类 | 若是游戏内 UI → `ui-interaction`（`buttons` 命中区 / `onUIPointer`）；若是编辑器 DOM → `engine-editor`（`bindings.js` + `index.html` id） |
| 「页面/关卡切换要有淡入淡出」「加了个页面没转场」 | UI交互 | 全屏菜单页/设置蒙层开关已内置 `pageFade` 蒙层淡入淡出（`ui-runtime.js` `openMenuScreen`/`closeMenuScreen`/`PAGE_FADE_MS`）；关卡切换 `beginSwitch`/`levelIntro` 与 `onOpenLevel` DOM `fadeAndSwitch` 已覆盖。新页面经 `openMenuScreen` 打开即自动带淡入淡出 |

---

## 7. 反模式与历史教训

### 7.1 文档与代码脱节（真实踩过）
重构过程中曾出现：`refactor-plan.md` 里列的 7 个相机方法（`worldSize`/`playZoom` 等）被误判为「不存在」而漏搬，导致**有调用无定义**；`onLoginButtonClick`/`startIntro`/`updateIntro` 同样丢失。**教训**：以代码实测为准，文档只是索引；改完必须回写。

### 7.2 `vite build` 通过 ≠ 代码能跑
Rollup 不做未定义标识符检查。已发生过 3 起：`workshop.js` 缺 4 个 import、`world-render.js` 缺 6 个、`editor-camera.js` 缺 `Phaser`。**必须跑 §4 步骤 5 的 ③**。

### 7.3 mixin 区间重叠导致重复定义
拆分时曾把同一段方法同时抽进 `hud.js` 与 `ui-runtime.js`，两份完全一致，靠装配顺序静默生效后者 —— 改前一份完全没效果。**必须跑 §4 步骤 5 的 ④**。

### 7.4 枚举双份维护
同一枚举在两处独立硬编码，改一处漏一处：
| 枚举 | 位置 A | 位置 B |
|---|---|---|
| 触发器事件类型 | `state.js:219 EVENT_TYPES` | `editor/entity-properties.js:79-87` 下拉硬编码 |
| 武器槽解锁等级 `[12,30]` | `player-data.js:17 SLOT_UNLOCK_LEVELS` | `ui/ui-runtime.js:18 WEAPON_SLOT_LEVELS` |
| 门默认色 | `constants.js:81-82` | `state.js:418-419` |
新增枚举值时**先搜有没有第二份**。

### 7.5 三套玩家数据不可混用
`state.player`（正式）/ `state.trialPlayer`（试玩）/ `state.previewPlayer`（预览），读写目标由 `saveSource()` 与 `state.saveStore` 决定。试玩**不写回**正式档。改存档相关逻辑必须过一遍这三条路径。详见 `economy-numbers` 与 `gameplay-systems`。

### 7.6 不要新建平行体系
需求看起来「不属于任何现有模块」时，99% 是你没找对分类。先查 §3.2 路由表和对应 skill 的文件地图。真要新建模块：放进对应 `src/systems/<分类>/`，导出 `XxxMixin`，在 `game-scene.js` 装配，并**同步更新该分类 skill 的第 2 章**。

### 7.7 不要在 `game-scene.js` 堆逻辑
它是重构后的成果（7224 → 568 行）。新逻辑进 mixin。

---

## 8. 交付清单

需求完成时，逐项确认：

- [ ] 需求已澄清，验收标准明确
- [ ] 已宣告主分类 + 同步点，并读过对应 skill 的第 2/3/6/7 章
- [ ] 代码改动遵守 §2 五条架构不变量
- [ ] `npx vite build` 通过（约 79 modules）
- [ ] `node --test test/` 与基线一致（无 server：16 pass / 5 fail，fail 全为 `fetch failed`；起 server 后为 19 pass / 1 fail，后者是旧 schema `mods` 字段的既有不一致）
- [ ] 未定义标识符自检通过（§4 步骤 5 ③）
- [ ] mixin 同名冲突自检通过（§4 步骤 5 ④）
- [ ] 手动冒烟过了对应关卡
- [ ] 跨分类同步点全部落实（枚举双份、normalize、data/ui、关卡 json）
- [ ] **受影响的 skill 已回写**（按 §5.1 对表，行数与数值实测）
- [ ] 若架构/基线/分类有变，本 PM skill 也已更新（§5.3）
- [ ] skill 健康检查通过（§5.4）
- [ ] 临时脚本 / `.bak` 文件已清理，`git status` 干净
