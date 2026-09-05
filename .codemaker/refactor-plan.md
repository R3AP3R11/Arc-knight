# demo2 代码结构优化 · 执行规格

> 给执行型 Agent（DeepSeek 等）用的逐轮施工单。
> **每次只说「执行第 N 轮」，就照本文件对应章节做，做完停下报告，不要连做多轮。**

---

## 0. 项目底数

- 纯 ESM（`package.json` 里 `"type": "module"`），Phaser 4 + Vite，入口 `index.html` → `src/main.js`。
- 构建命令：`npx vite build`（cwd = `e:\demo2`）。**当前基线：built 成功，47 modules。**
- 测试：`node --test test/`，基线 **16 pass / 5 fail**，5 个失败全是 `fetch failed`（`test/player-api.test.js` 需要 `node server.js` 在跑），**与重构无关，不用管**。

### 已完成部分（不要重做、不要修改）

`src/main.js` 已由 2000+ 行降到 82 行，编辑器逻辑已拆入 `src/editor/`：

```
src/editor/context.js            共享 ctx 对象 + ctx.hooks 钩子表
src/editor/bindings.js           DOM 事件绑定
src/editor/history.js            撤销 / 剪贴板
src/editor/room-panel.js         房间生成面板
src/editor/entity-properties.js  实体属性面板
src/editor/trigger-panel.js      触发器事件面板
src/editor/drop-rules-panel.js   掉落规则面板
src/editor/player-panels.js      预览 / 试玩玩家面板
src/editor/level-flow.js         关卡选择 / 切换 / 模式 / 快照
src/editor/save-flow.js          存档源与开局流程
src/editor/packaged.js           打包端启动路径
```

`src/game-scene.js` 已由 7224 行降到 **4723 行**，已抽出：

```
src/systems/constants.js                共享常量
src/systems/combat/geometry.js          几何 / 碰撞 / 射线（纯函数）
src/systems/combat/weapons.js           武器定义表 WEAPONS + spawnLaser
src/systems/combat/enemy-ai.js          EnemyAiMixin
src/systems/combat/player-combat.js     PlayerCombatMixin
src/systems/economy/damage.js           伤害公式（纯函数）
src/systems/economy/buffs.js            IDOL_BUFFS / VENDOR_BUFFS
src/systems/ui/entity-art.js            实体美术绘制（纯函数）
src/systems/ui/hud-art.js               HUD / 武器轮盘绘制（纯函数）
src/systems/editor/editor-geometry.js   编辑器句柄 / 拖拽几何（纯函数）
src/systems/level/spawning.js           SpawningMixin
src/systems/level/triggers.js           TriggersMixin
src/systems/level/interactables.js      InteractablesMixin
src/systems/level/level-flow.js         LevelFlowMixin
```

### 六大功能分类（目录约定）

| 分类 | 目录 |
|---|---|
| 数值_经济 | `src/systems/economy/` |
| 关卡设计 | `src/systems/level/` |
| 战斗相关 | `src/systems/combat/` |
| 系统玩法 | `src/systems/gameplay/` |
| 引擎(编辑器)需求 | `src/systems/editor/` + `src/editor/` |
| UI交互 | `src/systems/ui/` |

---

## 1. 通用施工规则（每轮都必须遵守）

### 1.1 Mixin 模式

`src/game-scene.js` 结构为：

```js
export function createGameScene(ctx) {
  class EditorScene extends Phaser.Scene { /* 剩余方法 */ }
  Object.assign(EditorScene.prototype, EnemyAiMixin, PlayerCombatMixin, /* ... */);
  return EditorScene;
}
```

新模块导出方法对象：

```js
// src/systems/ui/hud.js
export const HudMixin = {
  updateHud(dt) { /* 原样搬来的函数体 */ },
  drawHud() { /* ... */ },
};
```

新 mixin 追加进 `Object.assign(...)`，位置必须在 `return EditorScene;` 之前。

### 1.2 ctx 处理规则（关键，与前几轮不同）

构造函数第 76 行已有 `this.ctx = ctx;`，且全文件**没有任何局部 `ctx` 变量遮蔽**（已核实）。

所以搬移引用闭包 `ctx` 的方法时，**唯一允许的改动**是在方法体第一行插入：

```js
    const ctx = this.ctx;
```

函数体其余部分一字不动。这样嵌套的普通 function 闭包也安全（不依赖 `this` 绑定）。

- 只对方法体内确实出现裸 `ctx`（正则 `/(^|[^.\w])ctx\b/`）的方法插这一行；没有就别插。
- 例外：`constructor` 永远不搬。

### 1.3 搬移手法

- **函数体原样搬移，一字不改**。用 node 临时脚本按行区间剪切，禁止手抄。
- 脚本必须带断言：区间首行匹配方法名、尾行是 4 空格缩进的 `    }`。
- 搬完做逐行 diff 比对，允许的差异只有三类：方法末 `}` → `},`、新插的 `const ctx = this.ctx;`、必要的 import 行。
- `this` 语义不变，**不要**改写成显式传 `scene`。
- 方法体引用的模块级常量：只被本组用的随组搬走并从原文件删除；跨组共用的放 `src/systems/constants.js`，两边各自 import。
- **禁止任何新模块 `import` `game-scene.js`**（会成环）。
- 搬走后如果某个 import 在 `game-scene.js` 里已无引用，顺手从 import 清单删掉。

### 1.4 注释要求

每个新文件顶部写中文注释块：

```js
/**
 * 文件职责：一句话说明
 * 归属分类：UI交互
 * 主要导出：HudMixin（10 个方法）
 * 依赖：systems/constants.js、systems/ui/hud-art.js
 */
```

文件内按功能段落加 `// ── 段落名 ──` 分隔。**不要逐行注释。**

### 1.5 禁止事项

- 禁止 `git stash` / `git checkout` / `git reset` / `git commit` 等任何动工作区或历史的 git 命令。
- 禁止改 `package.json` / `index.html` / vite 配置 / `server.js`。
- 禁止新增第三方依赖。
- 禁止「顺手优化」：不改数值、不改默认参数、不改 DOM id、不改 API 调用顺序、不重命名。
- 禁止改动 `src/main.js`、`src/editor/**`、`src/state.js`、`src/ui-layer.js`、`src/ui-config.js`、`src/ui-preview.js`、`src/pathfinding.js`、`src/rooms.js`、`src/player-data.js`。
- 禁止改动本文件「已完成部分」列出的 `src/systems/**` 既有文件（只能 import，唯一例外是第 10 轮明确指定的回填）。

### 1.6 每轮验收（缺一不可）

1. 所有改动/新建 `.js` 跑 `node --check <file>` 全通过。
2. 核对：被搬方法在类体内已删除，无重复定义；所有 mixin 之间 + mixin 与残留类方法之间**无同名冲突**。
3. 核对：新模块内无 `import ... from '../../game-scene.js'` 之类的反向依赖。
4. `npx vite build`（cwd = `e:\demo2`）必须 built 成功。
5. 删干净自己产生的临时脚本 / `.bak` 备份。
6. 报告格式：文件表（路径 | 分类 | 方法数 | 行数）、`game-scene.js` 行数变化、未搬方法及原因、常量搬移记录、build 结果、风险 1-3 条。

### 1.7 每轮开工前先重新取方法清单

行号每轮都会变，**不要用本文件里的行号**，用这条命令现取：

```
node -e "const fs=require('fs');const L=fs.readFileSync('src/game-scene.js','utf8').split(/\r?\n/);L.forEach((l,i)=>{if(/^    [A-Za-z_$][\w$]*\s*\(/.test(l))console.log(i+1,l.trim().split('(')[0])})"
```

---

## 2. 第 4 轮 · HUD 与 UI 运行时（分类：UI交互）

新建 2 个文件：

**`src/systems/ui/hud.js` → 导出 `HudMixin`**
`hudColor`, `setHudMode`, `updateHud`, `drawHudIndicator`, `drawHud`, `drawChargeBars`, `drawSettingsButton`, `drawAmmo`, `hideHudOverlay`, `updateWeaponLabels`

**`src/systems/ui/ui-runtime.js` → 导出 `UiRuntimeMixin`**
`setupUI`, `loadUIImages`, `loadWeaponIcon`, `buildUITexts`, `isMenuLevel`, `isPreviewMode`, `isTrialMode`, `isNewbeeLevel`, `isHubLevel`, `isBattleLevel`, `syncUIState`, `uiPointer`, `drawUI`, `onUIPointer`, `pressAnim`, `pressScale`

---

## 3. 第 5 轮 · 弹窗页面与存档登录

**`src/systems/ui/screens.js` → 导出 `ScreensMixin`（分类：UI交互）**
`drawVendorShop`, `drawLevelSelect`, `drawWeaponShop`, `drawSettingsOverlay`, `openMenuScreen`, `closeMenuScreen`, `openSettingsOverlay`, `closeSettingsOverlay`, `retryBattle`, `exitToHome`

**`src/systems/gameplay/save-login.js` → 导出 `SaveLoginMixin`（分类：系统玩法）**
`openSaveSelect`, `drawSaveSelectUI`, `loginButtons`, `loginButtonRect`, `drawLoginButtons`, `updateLoginHover`, `onLoginButtonClick`, `startIntro`, `updateIntro`

---

## 4. 第 6 轮 · 工坊与引导 Hub（分类：系统玩法）

**`src/systems/gameplay/workshop.js` → 导出 `WorkshopMixin`**
`drawWorkshopUI`, `itemShortLabel`, `drawItemSlot`, `isLightColor`, `drawItemCell`, `workshopInventoryItems`, `isValidWorkshopDrop`, `workshopSlotContains`, `workshopRemoveFromInventory`, `workshopAddToInventory`, `workshopReplaceSlot`, `workshopEquipItem`, `toggleWorkshopWeapon`, `clickWorkshopSlot`, `showWorkshopTip`, `handleWorkshopPointerDown`, `updateWorkshopLongPress`, `updateWorkshopScrollDrag`, `handleWorkshopPointerUp`

**`src/systems/gameplay/newbee-hub.js` → 导出 `NewbeeHubMixin`**
`initNewbee`, `initHub`, `getFKeyBadge`, `setNewbeeHint`, `updateHubInteract`, `updateNewbee`, `advanceNewbee`, `drawNewbeeHint`, `drawNewbeeRects`, `drawNewbeeRect`, `drawWorldLabel`, `drawHubUI`

---

## 5. 第 7 轮 · 掉落与成长经济（分类：数值_经济）

**`src/systems/economy/drops.js` → 导出 `DropsMixin`**
`spawnDrops`, `spawnDropItems`, `collectDrop`, `tryRefillWeapon`, `updateDrops`

**`src/systems/economy/progression.js` → 导出 `ProgressionMixin`**
`applyUpgrade`, `buyBuff`, `buyWeapon`, `buyMod`, `toggleGrowth`, `saveSource`, `persistSave`

---

## 6. 第 8 轮 · 编辑器输入与相机（分类：引擎(编辑器)需求）

**`src/systems/editor/editor-input.js` → 导出 `EditorInputMixin`**
`pointerDown`, `pointerMove`, `updateEditorKeys`, `onWheel`

**`src/systems/editor/editor-camera.js` → 导出 `EditorCameraMixin`**
`worldSize`, `cameraSize`, `applyWorldBounds`, `clampEditorView`, `showZoom`, `resetEditorCamera`, `playZoom`, `setupPlayCamera`, `updatePlayCamera`, `centerCameraOnPlayer`

> `pointerDown` / `pointerMove` 是超大方法（各 100-180 行）且重度依赖 `ctx`，务必严格走 1.2 的 `const ctx = this.ctx;` 规则 + 逐行 diff 比对。

---

## 7. 第 9 轮 · 世界渲染与精灵同步（分类：UI交互）

**`src/systems/ui/world-render.js` → 导出 `WorldRenderMixin`**
`iconSprite`, `loadBackgroundImage`, `reloadBackground`, `syncLevelImages`, `applyBackground`, `syncBarrelSprites`, `syncVendorSprites`, `syncIdolSprites`, `syncIconSprites`, `syncPortalSprites`, `syncChestSprites`, `draw`

**`src/systems/ui/world-overlay.js` → 导出 `WorldOverlayMixin`**
`drawChestStar`, `drawIcons`, `drawPortalUI`, `drawIdolUI`, `drawIconUI`, `drawIdolOffer`, `drawVendorUI`, `drawChestEffects`, `drawPortalEffects`

> `draw` 约 340 行，是主渲染循环，单独小心处理；如果它同时引用了两个模块的私有常量，把常量提到 `systems/constants.js`。

---

## 8. 第 10 轮 · 回收前几轮因 ctx 跳过的遗留方法

前几轮遵循旧规则（引用 `ctx` 就不搬），留下一批方法卡在类里。本轮用 1.2 的新规则把它们**回填进已有 mixin 模块**（这是唯一允许修改既有 `src/systems/**` 文件的一轮）：

| 方法 | 回填目标文件 |
|---|---|
| `initEnemy`, `resolveMovementCollision`, `hasLOS` | `src/systems/combat/enemy-ai.js` |
| `pointInWall`（类方法版） | `src/systems/combat/player-combat.js` |
| `spawnCrateDebris`, `explodeBarrel` | 新建 `src/systems/combat/destructibles.js` → `DestructiblesMixin` |
| `spawnInScreen` | `src/systems/level/spawning.js` |
| `checkAsyncTriggerEvents`, `hasPendingSpawnWaves`, `updateTriggers` | `src/systems/level/triggers.js` |
| `restart`, `commitPlayer`, `settleVictory`, `updateTransition` | `src/systems/level/level-flow.js` |

回填后 `game-scene.js` 应只剩：模块级 import、`createGameScene` 外壳、`constructor`、`create`、`update`、以及 `Object.assign` 装配。目标 **≤ 900 行**。

`create` 和 `update` 是引擎生命周期主循环，**保留在 game-scene.js 不搬**。

---

## 9. 第 11 轮 · 生成六份指导 skill

目录：`.codemaker/skills/`，每个 目录，内含 `SKILL.md`。

```
.codemaker/skills/economy-numbers/SKILL.md     数值_经济
.codemaker/skills/level-design/SKILL.md        关卡设计
.codemaker/skills/combat/SKILL.md              战斗相关
.codemaker/skills/gameplay-systems/SKILL.md    系统玩法
.codemaker/skills/engine-editor/SKILL.md       引擎(编辑器)需求
.codemaker/skills/ui-interaction/SKILL.md      UI交互
```

六份可并行（各写各的文件，互不冲突）。**写 skill 前必须先真正读完该分类下所有源码**，不许靠猜。

### 每份 SKILL.md 必须包含的章节

```markdown
---
name: <skill 名>
description: <一句话，说明什么情况下该读这份 skill>
---

# <分类名> 开发指南

## 1. 这块负责什么
功能边界，一段话。列出玩家/策划视角的可见功能点。

## 2. 文件地图
表格：文件路径 | 职责 | 关键导出 | 大致行数
含「改 X 功能该动哪个文件」的速查。

## 3. 核心数据结构
该分类涉及的运行时对象字段（如 player.combat、enemy、trigger、chest 的字段含义与取值范围），
以及它们在 src/state.js 的 normalize* 函数、data/levels/*.json、data/players/*.json 里的对应关系。

## 4. 关键流程
3-6 条主链路，用「调用链」形式写清楚，标注文件:函数。
例：受伤流程 = enemy-ai.fireEnemyBullet → game-scene.update 子弹推进 →
player-combat.damagePlayer → economy/damage.playerIncomingDamage → HUD 刷新

## 5. 关键常量与数值
表格：常量名 | 所在文件 | 当前值 | 含义 | 调它会影响什么

## 6. 扩展指南
「要加一个新 X，需要改哪几处」——至少 3 个典型需求的分步清单。
例：新增一种武器 / 新增一种敌人 / 新增一个触发器事件类型 / 新增一件工坊道具

## 7. 坑与约束
已知陷阱、隐式耦合、不能改的地方、mixin 装配顺序要求、循环 import 风险等。

## 8. 验证方式
改完怎么验：跑什么命令、看什么现象、哪个关卡 json 能复现。
```

### skill 写作要求

- 中文。面向「没读过这个项目的 agent」，读完就能直接改这块代码。
- 必须写**具体的文件路径和函数名**，不要泛泛而谈。
- 单份控制在 300-500 行，超了就把细节压成表格。
- 不要复制大段源码，用「文件:函数」引用代替。
- 分类之间有交叉的地方（如工坊既是系统玩法又涉及数值），在各自 skill 里写一句「详见 xx skill」互相指路。

---

## 10. 收尾检查（全部轮次做完后）

1. `npx vite build` 成功。
2. `node --test test/` 结果与基线一致（16 pass / 5 fail，失败全为 `fetch failed`）。
3. `node server.js` 起服后打开页面，手动冒烟：编辑器加载关卡 → 试玩 → 战斗受伤 → 拾取掉落 → 开宝箱 → 传送门结算 → 工坊换装 → 存档保存。
4. `git status` 确认没有多余的临时文件残留。
