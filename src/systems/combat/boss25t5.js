/**
 * 原型机-2-5T5（Boss）混入模块（分类：战斗相关）
 *
 * 职责：Boss 专属数据契约（默认值 / 归一化）+ 行为状态机 + 技能区域生命周期 +
 *       阻挡护盾拦截 + 技能区域对玩家的位移/伤害结算。
 *
 * 行为循环：随机选一种移动方式 → 移动结束按玩家状态选技能 → 技能结束回到移动。
 *   移动 4 选 1：①30/s 接近 2~4s ②180°/s 环绕 0.8s ③10°/s 环绕 3s ④30/s 远离 2~4s
 *   技能1：蓝弧扇区向内收紧 → 拖拽玩家   技能2：红弧扇区向外扩张 → 击退+伤害
 *   技能3：圆弧4/5 重叠 >50% 合并紫弧 → 秒杀   技能4：玩家进内圈 → 向外击飞（不打断行动）
 *   技能5：BOSS 血量 ≤ s5HpPct% 后才加入技能组 → 玩家附近生成蓝色漩涡（吸玩家 + 吸全场子弹，
 *          可被玩家子弹击杀；场景级实体，不随技能结束消失，只在被击杀/BOSS 死亡时移除）
 *
 * 画板元素编号映射（data/assets/asset-1788964413981.json）：
 *   [0] 白双弧 r80（内圈）  [1] 红双弧 r80（handLongRadius=65=圆弧2范围）
 *   [2] 全周刻度圈 r220（阻挡护盾）  [3] 青弧 r185（圆弧4，瞄准玩家）
 *   [4] 红弧 r185（圆弧5，自转）     [5] 核心六边形 r30  [6] 3 红弧 r85
 *
 * 通过 Object.assign(EditorScene.prototype, ..., Boss25T5Mixin) 混入，
 * 内部 this 恒为 EditorScene 实例。本模块不 import Phaser（保持纯 JS，可被 state.js 安全引用）。
 *
 * 方法清单：
 *   stepBoss25T5            —— Boss 每帧主状态机（移动 / 选技能 / 技能推进 / 护盾窗口 / 技能4）
 *   boss25t5ArcAngles       —— 圆弧4/5 世界角与重叠度（渲染与本模块共用）
 *   boss25t5ZonesTick       —— e.zones 生命周期（extend→pause→anim→keep→fade）与命中判定
 *   boss25t5ShieldAlpha     —— 护盾透明度 0..1（渲染用）
 *   boss25t5ShieldActive    —— 护盾是否处于"存在"（拦截子弹）状态
 *   boss25t5TryBlock        —— 护盾拦截玩家子弹（停原地 + 变红）
 *   boss25t5UpdateBlocked   —— 被拦截的红子弹触碰玩家 → 先试护盾格挡（消除该弹 + 扣盾），否则扣血并移除
 *   boss25t5StepForce       —— 推进玩家被拖拽/击退的位移
 *   boss25t5PickSkill       —— 按血量决定技能池（半血后才加入技能5）并按各自权重抽一个
 *   boss25t5CastSkill5      —— 生成 1 个蓝色漩涡（场景级数组 this.boss25t5Vortices）
 *   boss25t5VorticesTick    —— 每帧推进全部漩涡：写玩家吸力、捕获子弹环上公转、玩家进入漩涡的周期伤害
 *   boss25t5VortexPull      —— 漩涡对子弹施吸力（顺便把被护盾冻结的红弹解冻成普通白色子弹）
 *   boss25t5VortexCapture   —— 漩涡捕获已转化子弹（黄金角散布到环上公转）；达捕获上限时返回 false
 *   boss25t5ReleaseCaptured —— 释放指定漩涡捕获的全部已转化子弹（漩涡被击杀 / 清空时调用）
 *   boss25t5VortexAbsorb    —— 子弹落进漩涡半径 → 扣漩涡 HP、子弹消失；HP≤0 时移除漩涡
 *   boss25t5ZoneBulletForce —— 技能1/2 对区域内已转化子弹施力（一次性固定速度+固定距离；s1 朝 BOSS 拖 /
 *                              s2 背离 BOSS 推）+ 拖尾配色；返回本次是否新授予了任务
 *   boss25t5ClearVortices   —— 清空场景级漩涡 + 全部捕获 + 玩家吸力（BOSS 死亡时调用）
 *   boss25t5BeginMove/ChooseSkill/StartSkill/MoveStep/CastSkill4/KillPlayer —— 内部环节
 *   boss25t5BossInS1        —— BOSS 中心是否真实落在任一存活 s1 蓝区扇形内（决定移速倍率）
 *
 * ── 世界锚定（关键口径）──
 *   区域在「释放那一刻」把当时的 BOSS 坐标写进 zone.x / zone.y，之后所有几何判定（命中、
 *   玩家/ BOSS 在区域内、紫色求交、渲染取值）一律以 zone.x / zone.y 作扇形顶点，不再用
 *   e.x / e.y。这样 BOSS 会走出/走进区域，两个不同时刻释放的技能区域才可能真实重叠。
 *
 * ── e.zones 元素字段契约（渲染端按此取值）──
 *   {
 *     id,                       // string，唯一
 *     kind: 's1'|'s2'|'s3',     // s1=技能1蓝区 / s2=技能2红区 / s3=技能3紫区
 *     x, y,                     // number，扇形顶点 = 释放时刻的 BOSS 世界坐标（世界锚定）
 *     a0, a1,                   // number，扇形起/止方位角（rad，可能跨 ±π，a1-a0 取最短正张角）
 *                               //   释放瞬间写死、**全程不再改变**（不跟随玩家 → 玩家可以走出扇区躲避）；
 *                               //   渲染与命中都读这两个值。
 *     rMin, rMax,               // number，扇形内外半径（已 × artScale；s1 内圈 / s2·s3 从弧半径起）
 *     phase,                    // 'extend'|'pause'|'anim'|'keep'|'fade'
 *     t,                        // number，当前相位已过毫秒
 *     arcR,                     // number，当前推进圆弧半径（世界单位，自 zone 顶点量起）
 *     prevArcR,                 // number，上一帧 arcR（命中判定用「上帧↔本帧跨越」）
 *     alpha,                    // 0..1，整体淡出用（当前恒为 1；消散走 visMin/visMax 方向性收缩）
 *     purpleAlpha,              // 0..1，紫色多边形填充/黑遮罩的淡出（多边形无法径向裁剪 → 只能淡出）
 *     visMin, visMax,           // number，渲染端实际绘制的径向范围。anim/keep = rMin..rMax；
 *                               //   fade 阶段方向性收缩：s1 visMax→rMin（从外向内消失）、
 *                               //   s2/s3 visMin→rMax（从内向外消失）。弧线/边界线/扇形填充都要按它裁剪。
 *     purplePolys               // null | Array<Array<{x,y}>>
 *                               //   kind==='s3' 且 purplePolys===null → 整区紫色
 *                               //   数组元素 = 与各存活 s1 蓝区的楔形交集多边形（点集，≥3 点）
 *                               //   空数组 [] → 当前无紫色重叠
 *   }
 *
 * ── 命中判定（boss25t5ZonesTick 第三趟）──
 *   玩家到「区域顶点」的距离被圆弧半径跨越（上帧 arcR ↔ 本帧 arcR 分列两侧）且方位角落在扇形内 → 命中。
 *   角度容差取 `cfg.zoneHitPadPx`（像素级）：`hitPad = padPx / d` → 判定区最多只比绘制扇形的斜线多
 *   padPx 像素（旧口径 zoneHitPadDeg 是固定角度，远距离会放大成几百像素）。**s3 不参与**（避免放大紫色秒杀误杀）。
 *   **扇形方向不跟随玩家**（a0/a1 在释放瞬间写死）—— 玩家可以横向走出扇区躲避，这是设计口径。
 *
 * ── 技能5「蓝色漩涡」契约（场景级，不挂在 BOSS 实体上）──
 *   数组：this.boss25t5Vortices = [ ... ]（BOSS 死亡时清空；技能结束后仍存在）
 *   元素：{
 *     id,               // string，唯一
 *     x, y,             // number，漩涡中心（世界坐标，生成时已钳制在世界内）
 *     r,                // number，漩涡半径（= cfg.s5Radius）
 *     hp, maxHp,        // number，生命值（只有玩家子弹能扣；hp<=0 → 从数组移除 = 消散）
 *     t,                // number，存活毫秒（渲染端自转/向内收缩相位用）
 *     hitT              // number，玩家下次受伤剩余毫秒（玩家在漩涡内时倒数）
 *   }
 *   口径：漩涡**不自动消散** —— 只有被击杀（hp<=0）或 boss25t5ClearVortices（BOSS 死亡）才消失；
 *        它属于场景而非技能区域，因此技能结束后继续存在（与 e.zones 生命周期无关）。
 *
 * ── 玩家吸力契约 ──
 *   this.player.boss25t5Pull = { vx, vy }（像素/秒）。写法仿 boss25t5Slow：boss25t5VorticesTick
 *   每帧**先清零**再按存活漩涡写入（带帧令牌去重 → 每帧只清/写一次，多 BOSS/多调用点不会重复累加）；
 *   game-scene 玩家移动段把 vx*sec / vy*sec 叠加到本帧位移上。无漩涡时恒为 {vx:0,vy:0}（不产生位移）。
 *   吸力公式：a = s5PullMin + (s5PullMax - s5PullMin) * clamp(1 - d / s5PullRadius, 0, 1)
 *   （进入吸力半径即受 s5PullMin，越靠近涡心越强、涡心处为 s5PullMax），向量累加后对速度做
 *   上限钳制（上限 = s5PullMax），避免玩家被瞬间弹飞。
 *
 * ── 被护盾冻结的红弹被吸回 / 被技能1·2 施力时「解冻」为转化子弹 ──
 *   boss25t5VortexPull / boss25t5ZoneBulletForce 施力成功时置：blockedBoss=false
 *   （**保留 blockedBy** —— 它同时是「已转化子弹」的判定标记）、colorStr='#ffffff'、
 *   forceTrail={width,length,color}（宽度/长度/颜色可配），并置 b.thawed=true —— 后续
 *   boss25t5TryBlock 对它直接返回 false（否则它会卡在护盾面上反复「冻结→解冻」，
 *   表现为一颗永远停在原地的红弹）。已转化子弹（blockedBy != null）另外还：
 *     · 仍会伤害玩家（boss25t5UpdateBlocked），且可被玩家护盾消除；
 *     · **不再伤害敌人 / BOSS**（game-scene 子弹 filter 里跳过敌人命中循环）；
 *     · 被技能5 漩涡捕获后沿环公转（boss25t5VortexCapture / boss25t5VorticesTick），
 *       捕获期间不前进、不碰撞、不施力，位置由漩涡 tick 驱动；漩涡被击杀即释放。
 *   boss25t5ZoneBulletForce 只作用于技能1（蓝区）/技能2（红区）区域内的已转化子弹：
 *   s1 沿「子弹 → BOSS」方向拖、s2 沿「BOSS → 子弹」方向推，施力后同样解冻 + 设 forceTrail
 *   （s1 拖尾色 s1BulletTrailColor / s2 拖尾色 s2BulletTrailColor）。
 *   **施力口径**：与玩家拖拽/击退一致 —— **一次性固定速度 + 固定距离预算**（用完即停，不再无限加速）：
 *     速度复用玩家拖拽配置（s1 = s1DragSpeed，s2 = s2PushSpeed），
 *     距离 = 玩家距离的 `BULLET_FORCE_DIST_MULT` 倍（2 倍，即 s1DragDist / s2PushDist × 2）；
 *     运行时字段：b.force={mode,ownerId,speed,remain}（remain = 剩余距离 px）、
 *     b.forceSrc=已授予过施力的区域 id（同一区域只授予一次，避免停下后被反复推动）、
 *     b.forceStepT=帧令牌（this.time.now，同帧多调用点只扣一次距离）。
 *     停下条件：owner 消失 / 距离预算用完 / drag 拖到圆弧1 内缘（innerRadius×artScale）。
 *     被漩涡捕获（boss25t5VortexCapture）或释放（boss25t5ReleaseCaptured）时清空 b.force →
 *     释放后子弹静止停驻在原处、不带着剩余距离继续跑。
 *
 * ── 子弹伤害来源（本模块为何不 import economy/damage.js）──
 *   economy/damage.js 经 weapons.js 间接 `import Phaser from 'phaser'`，在 node 下抛
 *   `Unexpected token 'export'`，而本模块被 state.js 静态引用（node --test 会加载它）。
 *   故子弹对漩涡的伤害走 game-scene 构造函数注入的 `this.playerDamage`（与打敌人同口径；
 *   取不到时兜底 1，仅无头自检环境会走到）。宠物子弹仍按 `b.petDamage != null` 覆盖。
 *
 * ── 渲染端（子任务 C）取值方式 ──
 *   · 扇形：以 zone.x/zone.y 为顶点，按 a0..a1 张角、rMin..rMax 半径绘制（用 sectorPoly 同口径）。
 *   · 圆弧：半径 = zone.arcR（同一 zone.x/zone.y 顶点），仅在 phase==='anim' 时推进；命中态见上。
 *   · 紫色边界/重叠区：若 kind==='s3' → 整区画紫；否则对每个 purplePolys 多边形描边/填充紫色。
 *   · 「经过重叠区域的圆弧也变紫」：anim 阶段对每条弧线取「半径 = arcR 的圆弧」与 purplePolys
 *     做上色裁剪——即只把落在 purplePolys 内的弧段画成紫色（数据已齐备：purplePolys + arcR）。
 *   · 黑色遮罩：anim 结束后进入 keep/fade 期间 purplePolys 仍保留，在玩家层之下/其余元素之上
 *     铺一层黑色遮罩 + 领域高亮，透明度跟随 zone.purpleAlpha。保留时长 s2KeepMs/s2FadeMs
 *     （s3 复用同一对配置，见 zoneDur 注释）。
 *
 * ── 技能选择与「对准玩家」口径 ──
 *   技能种类：只有 `skillWeightS1/S2/S3/S5` 权重决定，不用几何条件。BOSS 血量 > `s5HpPct`% 时
 *             技能5 不进池（只在 40/40/20 里抽）；≤ 阈值后才按 40/40/20/20 → 4:4:2:2 抽
 *             （即半血后 s1/s2 ≈33.3%、s3/s5 ≈16.7%）。技能5 没有参战圆弧，两弧停靠到随机侧面。
 *   释放方向：**永远以「BOSS → 玩家」为中心**（boss25t5StartSkill 里 a0/a1 = aim ± span/2），
 *             所以三个技能都对准玩家、不会空放。
 *   圆弧与技能的关系：两弧各有自转相位（e.arc4Phase / e.arc5Phase）。每次移动开始时按权重预选技能，
 *             并给出两弧相对瞄准方向的目标角（arcTargetsFor）：参战弧 → 0（对准玩家）、
 *             非参战弧 → 停靠到 parkMinDeg..180° 的侧后方；技能3 则两弧都对准玩家（视觉合并）。
 *             等待期（BOSS 静止）两弧以 arcAlignDeg 对齐到目标角，因此释放瞬间参战弧就在玩家方向上。
 *   注：策划原案的技能2「玩家处于圆弧5 扇形内」与技能3「圆弧4/5 重叠>50%」互斥（若圆弧4 恒瞄准
 *       玩家，两者等价），且纯几何判定会让技能射向空处，故改为「权重预选 + 参战弧对准玩家」。
 *       圆弧4 也因此不再是「恒瞄准玩家」，而是与圆弧5 一样自转、在等待期被转向玩家。
 *
 * ── HP 口径 ──
 *   本模块不规定血量来源：状态机不使用 bossCfg.hp 决定血量。血量走敌人顶层 e.hp
 *   （由 initEnemy 的 `hp: e.hp ?? def.hp` 提供，ENEMY_TYPES['boss-2-5t5'].hp = 1500）。
 *   配置对象里保留 hp 键仅为兼容外部引用，删除/缺失均不影响战斗。
 */

// pointInPolygon：与 systems/combat/geometry.js 内的实现逐字一致。
// 注意：不从 geometry.js 静态 import —— geometry.js 顶层 `import Phaser from 'phaser'`，
// 在 node 下（CJS 加载 phaser.esm.js）会抛 `Unexpected token 'export'`。而本模块经由
// state.js 被 node --test（player-data.test.js）加载，import geometry 会把该错误带进单测、
// 打破既有基线（基线只允许 player-api round-trip 一个 fail）。故此处本地复用同实现。
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export const BOSS25T5_ART = 'asset-1788964413981';

// 画板设计稿关键半径（design 单位；世界半径 = 该值 × e.artScale）
export const BOSS25T5_DESIGN = {
  innerRadius: 80,      // 圆弧1/2 内圈半径
  arc2Radius: 65,       // 圆弧2（红双弧 hands）范围半径 = handLongRadius
  shieldRadius: 220,    // 圆弧3 全周刻度圈 = 阻挡护盾半径
  arcRadius: 185,       // 圆弧4（青）/圆弧5（红）半径
  arcSpanDeg: 45        // 圆弧4/5 张角（°）
};

// 全部数值均可在编辑器配置（存 e.boss），键名即契约名，不可改名
export const BOSS25T5_DEFAULTS = {
  name: '原型机-2-5T5',
  hp: 1500,
  moveSpeed: 30,
  // 移动前/后的等待期（此期间 BOSS 不位移，护盾保持存在 → 玩家可攻击本体的窗口）
  moveWaitPreMs: 2000,
  moveWaitPostMs: 2000,
  approachMinMs: 2000,
  approachMaxMs: 4000,
  spinFastDeg: 180,
  spinFastMs: 800,
  spinSlowDeg: 10,
  spinSlowMs: 3000,
  fleeMinMs: 2000,
  fleeMaxMs: 4000,
  shieldRadius: 220,
  shieldFadeMs: 400,
  shieldRestoreDelayMs: 600,
  arcRadius: 185,
  arcSpanDeg: 45,
  arc5SpinDeg: 57.3,
  arc4SpinDeg: 30,          // 圆弧4 自由自转（°/s，非等待期）
  arcAlignDeg: 180,         // 等待期把两弧转到「本次技能目标角」的角速度（°/s）
  innerRadius: 80,
  arc2Radius: 65,
  s1Range: 1500,
  s1ExtendMs: 1000,
  s1PauseMs: 2500,
  s1TightenMs: 1000,
  s1RingGap: 10,
  s1DragSpeed: 2000,
  s1DragDist: 500,
  s1KeepMs: 10000,
  s1FadeMs: 1000,
  s1BossSpeedMult: 5,
  // 技能1 施力拖尾（对区域内已转化子弹施力时的配色；施力速度复用 s1DragSpeed，距离 = s1DragDist × 2）
  s1BulletTrailWidth: 6,    // 技能1 施力拖尾宽度(px)
  s1BulletTrailLength: 40,  // 技能1 施力拖尾长度(px)
  s1BulletTrailColor: '#4fc3f7',   // 技能1 施力拖尾颜色（蓝）
  s2Range: 1500,
  s2ExtendMs: 2000,
  s2PauseMs: 1500,
  s2ExpandMs: 1000,
  s2PushSpeed: 2000,
  s2PushDist: 500,
  // 技能2 施力拖尾（对区域内已转化子弹施力时的配色；施力速度复用 s2PushSpeed，距离 = s2PushDist × 2）
  s2BulletTrailWidth: 6,    // 技能2 施力拖尾宽度(px)
  s2BulletTrailLength: 40,  // 技能2 施力拖尾长度(px)
  s2BulletTrailColor: '#ff3b3b',   // 技能2 施力拖尾颜色（红）
  s2Damage: 20,
  // 技能1/2 命中判定的**像素级**外扩容差：判定区最多比绘制扇形的斜线多出该像素数（换算成角度 =
  // padPx / 距离），不再随距离放大成几百像素（旧的固定角度口径在远距离偏差极大，见文件头「命中判定」）。s3 不参与。
  zoneHitPadPx: 30,
  s2KeepMs: 10000,
  s2FadeMs: 1000,
  // 技能选择：由 skillWeightS* 权重决定本次用哪个技能（默认 4:4:2），
  // 释放方向永远对准玩家（参战圆弧在等待期被转到玩家方向）
  mergeOverlapPct: 20,
  parkMinDeg: 108,          // 非参战圆弧的停靠夹角下限（°，相对瞄准方向；避免误判为合并）
  // 技能权重（仅决定「本次攻击预选哪个技能」，实际占比 ≈ 权重归一化后的比例）
  skillWeightS1: 40,
  skillWeightS2: 40,
  skillWeightS3: 20,
  s3Range: 1500,
  s3ExtendMs: 2000,
  s3PauseMs: 1500,
  s3ExpandMs: 1000,
  s4PushSpeed: 2000,
  s4PushDist: 800,
  s4Damage: 20,
  blockedBulletDamage: 10,
  shieldClearCost: 10,      // 用护盾「消除」被拦红弹时扣除的护盾值（走 blockWithShield，其内部负责扣盾/特效/破盾）
  // ── 技能5「蓝色漩涡」──
  s5HpPct: 50,              // BOSS 血量 ≤ 该百分比时才把技能5 加入技能池
  skillWeightS5: 20,        // 技能5 独立权重（半血后与 40/40/20 并列 → 4:4:2:2）
  s5CastMs: 3000,           // 技能5 释放时长（技能5 无技能区域，用它计时结束）
  s5SpawnDist: 600,         // 漩涡生成点距玩家的距离（随机方向）
  s5Radius: 150,            // 漩涡半径
  s5Hp: 500,                // 漩涡生命值（只有玩家子弹能扣）
  s5PullRadius: 900,        // 玩家吸力生效半径（进入即受 s5PullMin，越靠近涡心越强）
  // 吸力速度(px/s)：进入吸力半径处 = s5PullMin，涡心处 = s5PullMax，中间线性插值。
  // **s5PullMax 必须小于玩家基础移速（game-scene.js baseSpeed=180）**，否则玩家一旦被吸住
  // 就永远挣脱不了、表现为「按住方向键也不动」（尤其漩涡在墙外时会被钉在墙上）。
  s5PullMin: 40,            // 最小吸力（吸力半径边缘处的速度，px/s）
  s5PullMax: 160,           // 最大吸力（涡心处的速度上限，px/s）
  s5BulletPull: 900,        // 子弹吸力加速度(px/s²)
  s5HitIntervalMs: 500,     // 玩家在漩涡内每次受伤的间隔(ms)
  s5HitDamage: 15,          // 玩家每次受伤值
  s5BulletTrailWidth: 6,       // 技能5 施力拖尾宽度(px)（原 s5RedTrailWidth 改名）
  s5BulletTrailLength: 40,     // 技能5 施力拖尾长度(px)（原 s5RedTrailLength 改名）
  s5BulletTrailColor: '#4fc3f7',   // 技能5 施力拖尾颜色（蓝；由红改蓝）
  s5CaptureMax: 16,            // 单个漩涡最多捕获的转化子弹数（超出则直接消灭该弹、不扣漩涡 HP）
  s5CaptureOrbitRatio: 0.25,   // 捕获环绕半径 = 漩涡半径 × 该比例（内层）
  s5CaptureSpinDeg: 90,        // 捕获环绕角速度(°/s)
  cutsceneId: ''
};

export function boss25t5Defaults() {
  return { ...BOSS25T5_DEFAULTS };
}

// 归一化：返回补全全部键的配置对象。字符串键（name / cutsceneId）保留字符串，
// 其余键统一 Number 兜底；优先级 BOSS25T5_DEFAULTS < def < boss。
export function normalizeBoss25T5Config(boss = {}, def = {}) {
  const src = {
    ...BOSS25T5_DEFAULTS,
    ...(def && typeof def === 'object' ? def : {}),
    ...(boss && typeof boss === 'object' ? boss : {})
  };
  const out = {};
  for (const key of Object.keys(BOSS25T5_DEFAULTS)) {
    const dv = BOSS25T5_DEFAULTS[key];
    if (typeof dv === 'string') {
      const v = src[key];
      out[key] = (v == null || v === 'undefined') ? dv : String(v);
    } else {
      const n = Number(src[key]);
      out[key] = Number.isFinite(n) ? n : dv;
    }
  }
  return out;
}

// ── 私有常量与纯几何工具 ──
const SKILL4_COOLDOWN_MS = 1200;   // 技能4 触发冷却（防止贴脸时每帧重复击飞）
const BULLET_FORCE_DIST_MULT = 2;  // 技能1/2 施力：子弹的拖拽/击退距离 = 玩家参数的该倍数（速度复用玩家值）
const DEG = Math.PI / 180;

function deg2rad(d) { return d * DEG; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function randRange(a, b) { const lo = Math.min(a, b), hi = Math.max(a, b); return lo + Math.random() * (hi - lo); }
function wrapPi(a) { let r = a; while (r > Math.PI) r -= Math.PI * 2; while (r < -Math.PI) r += Math.PI * 2; return r; }
function norm2pi(a) { let r = a; while (r < 0) r += Math.PI * 2; while (r >= Math.PI * 2) r -= Math.PI * 2; return r; }
function angleBetween(x0, y0, x1, y1) { return Math.atan2(y1 - y0, x1 - x0); }

// 技能预选与两弧目标角（决定长期技能占比 + 技能永远对准玩家）
// 按权重随机挑本次技能（默认 4:4:2；半血后加入技能5 → 4:4:2:2）；参战圆弧的目标角 = 瞄准方向（0），
// 非参战圆弧停靠到侧面，技能3 则两弧都对准玩家（→ 视觉合并），技能5 无参战弧（两弧都停靠）。
// 移动/等待期间两弧朝目标角对齐，因此释放时参战弧必在玩家方向上，技能区域（在 boss25t5StartSkill
// 里同样以瞄准方向为中心）不会空放。
// 通用加权抽取：items = [[技能号, 权重], ...]，返回抽中的技能号（权重全 0 时取第一个）
function pickWeightedBySkill(items) {
  let total = 0;
  for (const it of items) total += Math.max(0, it[1]);
  if (!(total > 0)) return items[0][0];
  let r = Math.random() * total;
  for (const it of items) {
    if ((r -= Math.max(0, it[1])) < 0) return it[0];
  }
  return items[items.length - 1][0];
}

function pickWeighted(w1, w2, w3) {
  return pickWeightedBySkill([[1, w1], [2, w2], [3, w3]]);
}

// 两弧相对「瞄准方向」的目标夹角（度，带符号）：0 = 对准玩家
function arcTargetsFor(cfg, pick) {
  const lo = Math.max(90, Math.min(180, Number(cfg.parkMinDeg) || 108));
  const parkDeg = lo + Math.random() * Math.max(0, 180 - lo);   // parkMinDeg..180 随机（越靠侧面越自然）
  const sign = Math.random() < 0.5 ? -1 : 1;
  if (pick === 1) return { arc4OffsetDeg: 0, arc5OffsetDeg: parkDeg * sign };   // 技能1：圆弧4 参战
  if (pick === 2) return { arc4OffsetDeg: parkDeg * sign, arc5OffsetDeg: 0 };   // 技能2：圆弧5 参战
  if (pick === 5) return { arc4OffsetDeg: parkDeg * sign, arc5OffsetDeg: -parkDeg * sign };  // 技能5：无参战弧，两弧停靠到左右随机侧面
  return { arc4OffsetDeg: 0, arc5OffsetDeg: 0 };                                // 技能3：两弧都对准玩家
}

// 朝目标角旋转（自动走最短弧）；target 为 null 时按 step 自由自转（step 可正可负）
function rotateToward(cur, target, step) {
  if (target === null) return cur + step;
  const diff = wrapPi(target - cur);
  const s = Math.abs(step);
  return Math.abs(diff) <= s ? cur + diff : cur + Math.sign(diff) * s;
}

// 方位角是否落在 [a0, a1] 内（自动处理跨越 ±π 的情况）
function angleInArc(a, a0, a1) {
  const span = norm2pi(a1 - a0);
  if (span <= 1e-9) return false;
  return norm2pi(a - a0) <= span;
}

function moveToward(cur, target, maxDelta) {
  if (cur < target) return Math.min(target, cur + maxDelta);
  if (cur > target) return Math.max(target, cur - maxDelta);
  return target;
}

// ── 扇形多边形 / 凸裁剪 / 楔形求交（世界锚定紫色重叠区用）──
// 标准鞋带面积 ×2（CCW 为正）。用于判定裁剪多边形的绕行方向 + 过滤退化交集。
function signedArea2(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

// 有向边 (a→b) 相对点 p 的叉积；凸多边形内部同号（符号 = signedArea2 符号）
function edgeCross(a, b, p) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

// 扇形/扇环多边形点集：顶点 (x,y)，起止角 a0/a1（按最短路径取正张角），半径 r0..r1。
// r0<=0 时内圈退化为顶点本身（楔形）。返回 [{x,y}, ...]。
function sectorPoly(x, y, a0, a1, r0, r1, steps = 14) {
  const n = Math.max(2, steps | 0);
  let span = wrapPi(a1 - a0);
  if (span <= 1e-9) span += Math.PI * 2;   // 保证正张角（本场景楔形 ≤ 45°）
  const pts = [];
  if (r0 > 1e-6) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + span * (i / n);
      pts.push({ x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0 });
    }
  } else {
    pts.push({ x, y });
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + span * (i / n);
    pts.push({ x: x + Math.cos(a) * r1, y: y + Math.sin(a) * r1 });
  }
  return pts;
}

// Sutherland–Hodgman：用凸多边形 clip 裁剪 subject，返回交集多边形点集（可能为空数组或退化点集）。
function clipConvex(subject, clip) {
  if (!subject || !clip || subject.length < 3 || clip.length < 3) return [];
  const sign = signedArea2(clip) >= 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    for (let k = 0; k < input.length; k++) {
      const c = input[k], d = input[(k + 1) % input.length];
      const cc = edgeCross(a, b, c), cd = edgeCross(a, b, d);
      const cIn = sign * cc >= -1e-9;
      const dIn = sign * cd >= -1e-9;
      if (cIn) out.push(c);
      if (cIn !== dIn) {
        const denom = cc - cd;
        const t = Math.abs(denom) > 1e-12 ? cc / denom : 0;
        out.push({ x: c.x + (d.x - c.x) * t, y: c.y + (d.y - c.y) * t });
      }
    }
  }
  return out;
}

// 两个技能区域（各视作自 zone 顶点出发、半径 0..rMax 的楔形）的世界求交。
// 顶点不同 → 先各自生成楔形多边形再裁剪。无交集/退化返回 null，否则返回交集多边形（≥3 点）。
function sectorOverlapPoly(zA, zB) {
  if (!zA || !zB) return null;
  const polyA = sectorPoly(zA.x, zA.y, zA.a0, zA.a1, 0, zA.rMax, 16);
  const polyB = sectorPoly(zB.x, zB.y, zB.a0, zB.a1, 0, zB.rMax, 16);
  const inter = clipConvex(polyA, polyB);
  if (!inter || inter.length < 3) return null;
  if (Math.abs(signedArea2(inter)) < 1e-6) return null;   // 退化为线/点 → 视为无交集
  return inter;
}

// 点是否落在区域的「整区」扇形内（以 zone.x/zone.y 为顶点；用于 s3 紫色整区判定）
function pointInZoneSector(z, px, py) {
  const d = Math.hypot(px - z.x, py - z.y);
  if (d < z.rMin || d > z.rMax) return false;
  return angleInArc(angleBetween(z.x, z.y, px, py), z.a0, z.a1);
}

// 点是否落在区域的紫色部分（s3 = 整区；s2 = 任一 purplePolys 多边形内）
function pointInZonePurple(z, px, py) {
  if (z.kind === 's3' || z.purplePolys === null) return pointInZoneSector(z, px, py);
  if (!Array.isArray(z.purplePolys)) return false;
  return z.purplePolys.some(poly => pointInPolygon(px, py, poly));
}

// 取（并补全）Boss 配置
function cfgOf(e) {
  if (!e.bossCfg) e.bossCfg = normalizeBoss25T5Config(e.boss);
  return e.bossCfg;
}

// 各技能区域的相位时长（ms）
// s3 无独立 keep/fade 配置 → 复用 s2KeepMs / s2FadeMs（配置表未提供 s3KeepMs/s3FadeMs）
function zoneDur(cfg, kind) {
  if (kind === 's1') {
    return { extend: cfg.s1ExtendMs, pause: cfg.s1PauseMs, anim: cfg.s1TightenMs, keep: cfg.s1KeepMs, fade: cfg.s1FadeMs };
  }
  if (kind === 's3') {
    return { extend: cfg.s3ExtendMs, pause: cfg.s3PauseMs, anim: cfg.s3ExpandMs, keep: cfg.s2KeepMs, fade: cfg.s2FadeMs };
  }
  return { extend: cfg.s2ExtendMs, pause: cfg.s2PauseMs, anim: cfg.s2ExpandMs, keep: cfg.s2KeepMs, fade: cfg.s2FadeMs };
}

export const Boss25T5Mixin = {
  // ── 主状态机 ──
  stepBoss25T5(e, dt, b, sec) {
    if (e.hitFlashT > 0) e.hitFlashT = Math.max(0, e.hitFlashT - dt);
    // 减速标记每帧先清空（子任务 B 在玩家移动处读取；本帧落在紫色区域时会重新置 true）
    if (this.player) this.player.boss25t5Slow = false;
    // 技能5 漩涡是「场景级」实体：即使本 BOSS 待机（bossActive=false）也要推进已存在的漩涡
    // （玩家吸力清零/写入 + 玩家入漩涡的周期伤害）。内部带帧令牌去重 → 多 BOSS / 多调用点每帧只推一次；
    // game-scene.js 在 boss25t5UpdateBlocked 附近也调一次作保底（谁先到谁生效，同帧不重复推进）。
    this.boss25t5VorticesTick(dt);
    if (!e.bossActive) return;   // 待机：未激活不移动、不放技能（与 stepMothership 一致）

    const cfg = cfgOf(e);
    e.zones = e.zones ?? [];
    // 两弧旋转：等待期（BOSS 静止 → 瞄准角稳定）朝「本次技能的目标角」对齐（参战弧 → 玩家方向）；
    // 其余时间各自自由自转。位移后的等待期会再对齐一次，故释放时参战弧必在玩家方向上。
    const pNow = this.player;
    const aimNow = pNow ? angleBetween(e.x, e.y, pNow.x, pNow.y) : 0;
    const aligning = e.state === 'move' && e.moveWait > 0;
    const alignStep = deg2rad(cfg.arcAlignDeg) * sec;
    e.arc4Phase = rotateToward(
      e.arc4Phase ?? 0,
      aligning && Number.isFinite(e.arc4OffsetDeg) ? aimNow + deg2rad(e.arc4OffsetDeg) : null,
      aligning ? alignStep : deg2rad(cfg.arc4SpinDeg) * sec
    );
    e.arc5Phase = rotateToward(
      e.arc5Phase ?? 0,
      aligning && Number.isFinite(e.arc5OffsetDeg) ? aimNow + deg2rad(e.arc5OffsetDeg) : null,
      aligning ? alignStep : deg2rad(cfg.arc5SpinDeg) * sec
    );
    e.state = e.state ?? 'move';
    e.moveKind = e.moveKind ?? 0;
    e.moveT = e.moveT ?? 0;
    e.moveDur = e.moveDur ?? 0;
    e.moveDir = e.moveDir ?? 1;
    e.moveWait = e.moveWait ?? 0;
    e.moveDone = e.moveDone ?? false;
    e.arc4Phase = e.arc4Phase ?? 0;
    e.arc4OffsetDeg = e.arc4OffsetDeg ?? 0;
    e.arc5OffsetDeg = e.arc5OffsetDeg ?? 0;
    e.skillKind = e.skillKind ?? 0;
    e.skillPhase = e.skillPhase ?? 'idle';
    e.skillT = e.skillT ?? 0;
    e.skill4Cooldown = e.skill4Cooldown ?? 0;
    e.shieldAlpha = e.shieldAlpha ?? 1;
    e.shieldDown = e.shieldDown ?? false;
    e.shieldDownT = e.shieldDownT ?? 0;
    e.activeZoneId = e.activeZoneId ?? null;

    // 玩家被拖拽/击退的位移推进（每帧一次；多 Boss 时不重复推）
    // 用场景时间当帧令牌；无 this.time 的环境（单测/无 Phaser 上下文）退化为每次调用都推进
    const nowT = this.time?.now;
    if (nowT === undefined || this.boss25t5ForceTick !== nowT) {
      this.boss25t5ForceTick = nowT;
      this.boss25t5StepForce(dt);
    }

    // 护盾窗口：技能释放期间 + 技能结束后 shieldRestoreDelayMs 内 = 消失
    const inSkill = e.state === 'skill';
    if (inSkill) {
      e.shieldDownT = 0;
      e.shieldDown = true;
    } else {
      e.shieldDownT = Math.max(0, e.shieldDownT - dt);
      e.shieldDown = e.shieldDownT > 0;
    }
    e.shieldAlpha = moveToward(e.shieldAlpha, e.shieldDown ? 0 : 1, dt / Math.max(1, cfg.shieldFadeMs));

    // 技能4：玩家进入 圆弧4/5 半径内 → 无条件触发一次（不打断当前移动/技能）
    const p = this.player;
    const distP = p ? Math.hypot(p.x - e.x, p.y - e.y) : Infinity;
    e.skill4Cooldown = Math.max(0, e.skill4Cooldown - dt);
    if (e.skill4Cooldown <= 0 && distP < cfg.arcRadius * (e.artScale || 1)) {
      e.skill4Cooldown = SKILL4_COOLDOWN_MS;
      this.boss25t5CastSkill4(e, cfg);
    }
    if (e.skill4Fx) { e.skill4Fx.t += dt; if (e.skill4Fx.t >= e.skill4Fx.dur) e.skill4Fx = null; }

    if (e.state === 'skill') {
      // 技能5：没有参战区域（不建 zone），用 s5CastMs 计时结束
      if (e.skillKind === 5) {
        e.skillT += dt;
        if (e.skillT >= cfg.s5CastMs) {
          // 与其它技能结束口径一致：清技能态 → 延迟恢复护盾 → 回到移动循环
          // （漩涡不在此处清除：它是场景级实体，只有被击杀或 BOSS 死亡才消失）
          e.activeZoneId = null;
          e.skillKind = 0;
          e.skillPhase = 'idle';
          e.skillT = 0;
          e.shieldDownT = cfg.shieldRestoreDelayMs;
          this.boss25t5BeginMove(e, cfg);
        }
        return;
      }
      // 技能动作 = 活动区域的 extend→pause→anim；进入 keep 即视为技能结束
      const z = e.zones.find(zz => zz.id === e.activeZoneId);
      if (!z || (z.phase !== 'extend' && z.phase !== 'pause' && z.phase !== 'anim')) {
        e.activeZoneId = null;
        e.skillKind = 0;
        e.skillPhase = 'idle';
        e.skillT = 0;
        e.shieldDownT = cfg.shieldRestoreDelayMs;   // 技能结束后延迟恢复护盾
        this.boss25t5BeginMove(e, cfg);
      }
      return;
    }

    if (e.state === 'moveEnd') {
      this.boss25t5ChooseSkill(e, cfg);
      return;
    }

    // move 阶段：前置等待（不位移、护盾在）→ 位移 → 后置等待 → 选技能
    if (!(e.moveDur > 0)) this.boss25t5BeginMove(e, cfg);
    if (e.moveWait > 0) {
      e.moveWait -= dt;
    } else if (!e.moveDone) {
      e.moveT += dt;
      this.boss25t5MoveStep(e, cfg, sec);
      if (e.moveT >= e.moveDur) {
        e.moveDone = true;
        e.moveWait = Math.max(0, cfg.moveWaitPostMs);
      }
    } else {
      e.moveWait -= dt;
      if (e.moveWait <= 0) e.state = 'moveEnd';
    }
  },

  // ── 圆弧4/5 世界角与重叠度（渲染与本模块共用） ──
  // 两弧都有各自的自转相位（e.arc4Phase / e.arc5Phase）；「瞄准玩家」不是圆弧4 的固有状态，
  // 而是在等待期把参战圆弧转过去（见 arcTargetsFor / stepBoss25T5），这样每次技能都对准玩家。
  boss25t5ArcAngles(e) {
    const cfg = cfgOf(e);
    const spanRad = deg2rad(cfg.arcSpanDeg);
    const p = this.player;
    const aim = p ? angleBetween(e.x, e.y, p.x, p.y) : 0;
    const arc4Center = e.arc4Phase ?? 0;
    const arc5Center = e.arc5Phase ?? 0;
    const d = Math.abs(wrapPi(arc5Center - arc4Center));
    return {
      aim,
      arc4Start: arc4Center - spanRad / 2,
      arc4Center,
      arc5Start: arc5Center - spanRad / 2,
      arc5Center,
      spanRad,
      // 角度重叠占单弧张角的百分比 0..100（等宽弧：重叠宽度 = span - 圆心角距）
      overlapPct: d >= spanRad ? 0 : (1 - d / spanRad) * 100
    };
  },

  // ── 技能区域生命周期 + 命中判定 ──
  // 所有几何判定以 zone.x/zone.y（释放时刻锚点）为扇形顶点，而非 BOSS 当前坐标；
  // 扇形方向（a0/a1）也在释放瞬间写死、全程不跟随玩家 —— 玩家可以走出扇区躲避。
  boss25t5ZonesTick(e, dt) {
    const cfg = cfgOf(e);
    if (!e.zones || !e.zones.length) return;
    const p = this.player;
    const alive = [];

    // 第一趟：相位推进 + 圆弧半径 / 透明度
    for (const z of e.zones) {
      const durs = zoneDur(cfg, z.kind);
      z.t += dt;

      // 相位推进
      if (z.phase === 'extend' && z.t >= durs.extend) { z.phase = 'pause'; z.t = 0; }
      else if (z.phase === 'pause' && z.t >= durs.pause) {
        z.phase = 'anim';
        z.t = 0;
        z.prevArcR = z.kind === 's1' ? z.rMax : z.rMin;   // 收紧从范围末端开始 / 扩张从弧半径开始
      }
      else if (z.phase === 'anim' && z.t >= durs.anim) { z.phase = 'keep'; z.t = 0; }
      else if (z.phase === 'keep' && z.t >= durs.keep) { z.phase = 'fade'; z.t = 0; }
      else if (z.phase === 'fade' && z.t >= durs.fade) { continue; }   // 生命周期结束 → 移除

      // 圆弧半径 / 透明度 / 可见半径范围
      // visMin~visMax = 渲染端实际绘制的径向范围；消散阶段用它做「方向性消失」，
      // 而不是整体淡出：s1 从外向内收（visMax → rMin），s2/s3 从内向外收（visMin → rMax）。
      if (z.phase === 'anim') {
        const k = clamp01(z.t / Math.max(1, durs.anim));
        z.arcR = z.kind === 's1'
          ? z.rMax + (z.rMin - z.rMax) * k      // 向内收紧 rMax → rMin
          : z.rMin + (z.rMax - z.rMin) * k;     // 向外扩张 rMin → rMax
        z.alpha = 1;
        z.purpleAlpha = 1;
        z.visMin = z.rMin;
        z.visMax = z.rMax;
      } else if (z.phase === 'keep') {
        z.arcR = z.kind === 's1' ? z.rMin : z.rMax;
        z.alpha = 1;
        z.purpleAlpha = 1;
        z.visMin = z.rMin;
        z.visMax = z.rMax;
      } else if (z.phase === 'fade') {
        // 方向性消散：arcR 不变，只收缩可见径向范围（圆弧/边界线随范围一起消失）
        const k = clamp01(z.t / Math.max(1, durs.fade));
        z.alpha = 1;
        z.purpleAlpha = 1 - k;                  // 紫色多边形/黑遮罩无法径向裁剪 → 仍用淡出
        if (z.kind === 's1') {
          z.visMin = z.rMin;
          z.visMax = z.rMax + (z.rMin - z.rMax) * k;   // 从外向内
        } else {
          z.visMin = z.rMin + (z.rMax - z.rMin) * k;   // 从内向外
          z.visMax = z.rMax;
        }
      } else {
        z.arcR = z.rMin;   // extend / pause：弧停在起始半径（圆弧1 内圈 / 圆弧4/5 半径）
        z.alpha = 1;
        z.purpleAlpha = 1;
        z.visMin = z.rMin;
        z.visMax = z.rMax;
      }

      alive.push(z);
    }

    // 第二趟：紫色重叠多边形（世界锚定，每帧重算；保留期 keep/fade 期间不重算语义变化——
    // s1 蓝区可能已消失 → 交集随之缩短，符合「变淡消失」的直观）
    // s3：整区紫色 → purplePolys = null（渲染端按 kind 判定）；s1：无紫色 → []。
    const s1Alive = alive.filter(z => z.kind === 's1');
    for (const z of alive) {
      if (z.kind === 's3') { z.purplePolys = null; continue; }
      if (z.kind !== 's2') { z.purplePolys = []; continue; }
      const polys = [];
      for (const z1 of s1Alive) {
        const poly = sectorOverlapPoly(z, z1);   // 两区域顶点不同 → 各自楔形多边形再裁剪
        if (poly && poly.length >= 3) polys.push(poly);
      }
      z.purplePolys = polys;
    }

    // 第三趟：命中判定 + 紫色领域减速
    for (const z of alive) {
      // 命中：玩家到「区域顶点」的距离被 arcR 跨越（上帧↔本帧分列两侧）且方位角落在扇形内
      if (z.phase === 'anim' && p) {
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        const ang = angleBetween(z.x, z.y, p.x, p.y);
        const prev = z.prevArcR ?? z.arcR;
        const lo = Math.min(prev, z.arcR), hi = Math.max(prev, z.arcR);
        // 技能1/2 的**像素级**外扩容差：把 padPx 换算成该距离下的角度 → 判定区最多只超出绘制扇形斜线
        // padPx 像素（旧口径是固定角速度 pad，远距离会放大成几百像素的偏差）。s3 不参与（避免紫色秒杀误杀）。
        const padPx = Math.max(0, cfg.zoneHitPadPx || 0);
        const hitPad = (padPx > 0 && z.kind !== 's3') ? padPx / Math.max(1, d) : 0;
        if (d >= lo && d <= hi && d <= z.rMax && angleInArc(ang, z.a0 - hitPad, z.a1 + hitPad)) {
          if (z.kind === 's1') {
            this.boss25t5ApplyForce(e, cfg.s1DragSpeed, cfg.s1DragDist, 'drag');   // 技能1：向内拖拽
          } else if (pointInZonePurple(z, p.x, p.y)) {
            this.boss25t5KillPlayer();                    // 紫色重叠区 / 技能3：秒杀
          } else {
            this.boss25t5ApplyForce(e, cfg.s2PushSpeed, cfg.s2PushDist, 'push');   // 向外击退
            this.damagePlayer(cfg.s2Damage);
          }
        }
      }

      // 紫色领域减速：圆弧经过后覆盖黑洞遮罩区域 → 玩家进入被减速 95%
      // （子任务 B 在玩家移动处读取 player.boss25t5Slow；本帧清空-置位的既有做法不变）
      if (p && (z.phase === 'anim' || z.phase === 'keep') && pointInZonePurple(z, p.x, p.y)) {
        p.boss25t5Slow = true;
      }

      z.prevArcR = z.arcR;
    }

    e.zones = alive;
  },

  // ── 护盾查询与拦截 ──
  boss25t5ShieldAlpha(e) {
    return clamp01(e.shieldAlpha ?? 1);
  },

  // 护盾"存在"（可拦截子弹）＝不在消失窗口内（透明度只作视觉渐隐）
  boss25t5ShieldActive(e) {
    return !!(e && !e.shieldDown);
  },

  // 护盾拦截：玩家子弹线段（obx,oby → b.x,b.y）穿过护盾圆 → 停在护盾面上、清零速度、变红
  boss25t5TryBlock(e, b, obx, oby) {
    // 已被技能5 漩涡解冻的红弹不再被拦截：它的起点正落在护盾面上（c≈0），若继续拦会在
    // 「冻结↔解冻」之间反复横跳 → 表现为一颗永远停在原地、颜色闪烁的红弹。
    if (b.thawed) return false;
    if (!this.boss25t5ShieldActive(e)) return false;
    const cfg = cfgOf(e);
    const R = cfg.shieldRadius * (e.artScale || 1);
    if (R <= 0) return false;

    const dx = b.x - obx, dy = b.y - oby;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return false;

    const fx = obx - e.x, fy = oby - e.y;
    const c = fx * fx + fy * fy - R * R;
    if (c <= 0) return false;               // 起点已在护盾内（正常不会发生）

    const bq = 2 * (fx * dx + fy * dy);
    const disc = bq * bq - 4 * a * c;
    if (disc < 0) return false;

    const t = (-bq - Math.sqrt(disc)) / (2 * a);   // 取进入护盾的那个交点
    if (t < 0 || t > 1) return false;

    b.x = obx + dx * t;
    b.y = oby + dy * t;
    b.vx = 0;
    b.vy = 0;
    b.blockedBoss = true;
    b.blockedBy = e.id;
    b.blockedDamage = cfg.blockedBulletDamage;
    b.blockedR = 5;                 // 渲染最小半径：小弹放大到 5px 才看得清（见 weapons/weapon-runtime.drawBullet）
    b.trailColor = '#ff3b3b';
    b.colorStr = '#ff3b3b';
    return true;
  },

  // 取「拦住这颗子弹的那个 BOSS」的配置（b.blockedBy = BOSS id）；找不到 BOSS 时用默认值兜底
  // （不改变 boss25t5UpdateBlocked 的对外签名，仍由 game-scene 每帧调 boss25t5UpdateBlocked(dt)）
  boss25t5CfgFromBullet(b) {
    const boss = (this.enemies || []).find(x => x.type === 'boss-2-5t5' && x.id === b?.blockedBy);
    return boss ? cfgOf(boss) : normalizeBoss25T5Config({});
  },

  // 被拦截的红子弹：玩家触碰 → 先用护盾格挡（命中护盾则消除该弹 + 扣护盾值），未挡住才扣血并移除
  boss25t5UpdateBlocked(dt) {
    const list = this.bullets;
    const p = this.player;
    if (!list || !list.length || !p) return;
    const pr = p.r ?? 0;
    for (const b of list) {
      // 判定对象：① 冻结中（blockedBoss）的红弹；② 已解冻的转化子弹（blockedBy != null）。
      // 普通玩家子弹（两者皆无）与已移除的子弹直接跳过。
      if (b.dead) continue;
      if (!b.blockedBoss && b.blockedBy == null) continue;
      const radius = b.r ?? 5;
      if (Math.hypot(b.x - p.x, b.y - p.y) < pr + radius) {
        // 护盾格挡：blockWithShield 内部负责「扣盾值 + 命中特效 + 抖屏 + 破盾」，此处**不重复扣**
        const cost = this.boss25t5CfgFromBullet(b).shieldClearCost;
        if (this.blockWithShield && this.blockWithShield(b.x, b.y, cost, radius)) {
          b.dead = true;   // 命中护盾 → 红弹被消除，玩家不受伤
          continue;
        }
        this.damagePlayer(b.blockedDamage ?? 10);
        b.dead = true;
      }
    }
  },

  // ── 玩家位移（拖拽 / 击退 / 击飞） ──
  boss25t5ApplyForce(e, speed, dist, mode) {
    if (!this.player) return;
    this.player.boss25t5Force = { ownerId: e.id, mode, speed, remain: dist };
  },

  boss25t5StepForce(dt) {
    const p = this.player;
    if (!p) return;
    const f = p.boss25t5Force;
    if (!f) return;
    const boss = (this.enemies || []).find(x => x.id === f.ownerId);
    if (!boss) { p.boss25t5Force = null; return; }

    const step = Math.min(f.remain, f.speed * (dt / 1000));
    if (!(step > 0)) { p.boss25t5Force = null; return; }

    const away = f.mode === 'push';
    const ang = away ? angleBetween(boss.x, boss.y, p.x, p.y) : angleBetween(p.x, p.y, boss.x, boss.y);
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    let nx = p.x + cosA * step, ny = p.y + sinA * step;

    if (!away) {
      // 拖拽：不可进入 圆弧1（内圈）以内
      const cfg = cfgOf(boss);
      const minR = cfg.innerRadius * (boss.artScale || 1);
      const bx = nx - boss.x, by = ny - boss.y;
      const dd = Math.hypot(bx, by);
      if (dd < minR) {
        const k = dd > 1e-6 ? 1 / dd : 1;
        nx = boss.x + (dd > 1e-6 ? bx * k : 1) * minR;
        ny = boss.y + (dd > 1e-6 ? by * k : 0) * minR;
      }
    }

    const { w: ww, h: wh } = this.worldSize();
    const r = p.r ?? 0;
    p.x = Math.max(r, Math.min(ww - r, nx));
    p.y = Math.max(r, Math.min(wh - r, ny));

    f.remain -= step;
    if (f.remain <= 1e-6) p.boss25t5Force = null;
  },

  // ── 状态机环节 ──
  boss25t5BeginMove(e, cfg) {
    e.moveKind = 1 + Math.floor(Math.random() * 4);   // 1接近 2快速环绕 3慢速环绕 4远离
    e.moveT = 0;
    e.moveDir = Math.random() < 0.5 ? -1 : 1;
    e.moveWait = Math.max(0, cfg.moveWaitPreMs);   // 前置等待：护盾保持存在的可攻击窗口
    e.moveDone = false;
    // 预选本次攻击的技能（半血后才把技能5 放进技能池），并把两弧的目标角定到
    // 「参战弧对准玩家 / 非参战弧停靠侧面（技能5 无参战弧 → 两弧都停靠）」
    e.skillPick = this.boss25t5PickSkill(e, cfg);
    const tg = arcTargetsFor(cfg, e.skillPick);
    e.arc4OffsetDeg = tg.arc4OffsetDeg;
    e.arc5OffsetDeg = tg.arc5OffsetDeg;
    if (e.moveKind === 1) e.moveDur = randRange(cfg.approachMinMs, cfg.approachMaxMs);
    else if (e.moveKind === 2) e.moveDur = cfg.spinFastMs;
    else if (e.moveKind === 3) e.moveDur = cfg.spinSlowMs;
    else e.moveDur = randRange(cfg.fleeMinMs, cfg.fleeMaxMs);
    e.state = 'move';
  },

  boss25t5MoveStep(e, cfg, sec) {
    const p = this.player;
    if (!p) return;
    const spd = cfg.moveSpeed * (this.boss25t5BossInS1(e) ? cfg.s1BossSpeedMult : 1);
    const kind = e.moveKind || 1;

    if (kind === 2 || kind === 3) {
      // 环绕玩家：保持半径、按固定角速度旋转
      const deg = kind === 2 ? cfg.spinFastDeg : cfg.spinSlowDeg;
      const ang = angleBetween(p.x, p.y, e.x, e.y);
      const rad = Math.hypot(e.x - p.x, e.y - p.y);
      const na = ang + deg2rad(deg) * (e.moveDir || 1) * sec;
      e.x = p.x + Math.cos(na) * rad;
      e.y = p.y + Math.sin(na) * rad;
      return;
    }

    const ang = angleBetween(e.x, e.y, p.x, p.y);
    const dir = kind === 4 ? -1 : 1;   // 4 = 远离
    e.x += Math.cos(ang) * spd * dir * sec;
    e.y += Math.sin(ang) * spd * dir * sec;
  },

  // BOSS 中心是否真实落在任一存活 s1 蓝区扇形内（距离∈[rMin,rMax] 且方位角∈[a0,a1]，
  // 以该 zone 的 x/y 为顶点）。是 → 本帧移速 ×s1BossSpeedMult，否则 ×1。
  boss25t5BossInS1(e) {
    if (!e.zones || !e.zones.length) return false;
    for (const z of e.zones) if (z.kind === 's1' && pointInZoneSector(z, e.x, e.y)) return true;
    return false;
  },

  // 技能种类由 boss25t5BeginMove 的权重预选（skillWeightS*，默认 4:4:2；半血后 4:4:2:2）决定。
  // 注意：这里**不再**用几何条件（夹角/距离）判定——策划原案的技能2/技能3 条件互斥，
  // 且几何判定会让技能射向空处；改为权重预选 + 参战弧等待期对准玩家（见 arcTargetsFor）。
  boss25t5ChooseSkill(e, cfg) {
    if ((e.skillPick || 1) === 5) { this.boss25t5CastSkill5(e, cfg); return; }
    this.boss25t5StartSkill(e, cfg, e.skillPick || 1);
  },

  // 技能抽取：血量 > s5HpPct% → 只在 S1/S2/S3 里按各自权重抽（技能5 不进池）；
  // ≤ 阈值 → 按 S1/S2/S3/S5 四个权重抽（默认 40/40/20/20 → 4:4:2:2）。
  boss25t5PickSkill(e, cfg) {
    const hp = Number.isFinite(e.hp) ? e.hp : 0;
    const maxHp = Number.isFinite(e.maxHp) && e.maxHp > 0 ? e.maxHp : (hp > 0 ? hp : 1);
    const pct = hp / maxHp * 100;
    const items = [[1, cfg.skillWeightS1], [2, cfg.skillWeightS2], [3, cfg.skillWeightS3]];
    if (pct <= cfg.s5HpPct) items.push([5, cfg.skillWeightS5]);
    return pickWeightedBySkill(items);
  },

  // 技能5：在「距玩家 s5SpawnDist 的随机方向」处生成 1 个蓝色漩涡（钳制在世界内）。
  // 漩涡是场景级实体（this.boss25t5Vortices），技能本体只负责进入 / 退出 skill 态计时。
  boss25t5CastSkill5(e, cfg) {
    const p = this.player;
    const r = Math.max(1, cfg.s5Radius);
    const dist = Math.max(0, cfg.s5SpawnDist);
    const { w: ww, h: wh } = this.worldSize();
    const clampX = cx => Math.max(r, Math.min(ww - r, cx));
    const clampY = cy => Math.max(r, Math.min(wh - r, cy));

    let x, y;
    if (p) {
      // 生成点要求「与玩家之间没有墙」且尽量保持 s5SpawnDist：
      // 若漩涡落在墙外/墙内，吸力会把玩家拖到墙上钉住（表现为按住某条轴的方向键也不动）。
      // 注意必须先做世界边界钳制、再判可达 —— 否则钳制可能把点挪到墙另一侧，让前置判定失效。
      const inWall = (cx, cy) => (typeof this.pointInWall === 'function' ? this.pointInWall(cx, cy) : false);
      const reachable = (cx, cy) => {
        if (inWall(cx, cy)) return false;
        for (let k = 1; k <= 8; k++) {
          const t = k / 8;
          if (inWall(p.x + (cx - p.x) * t, p.y + (cy - p.y) * t)) return false;
        }
        return true;
      };
      const N = 16;
      const base = Math.random() * Math.PI * 2;
      let best = null;
      for (let i = 0; i < N; i++) {
        const ang = base + i * (Math.PI * 2 / N);
        const cx = clampX(p.x + Math.cos(ang) * dist);
        const cy = clampY(p.y + Math.sin(ang) * dist);
        const d = Math.hypot(cx - p.x, cy - p.y);
        // 评分：优先「可达」，其次距离更远（贴世界边缘时避免被钳到玩家脸上）
        const score = (reachable(cx, cy) ? 1e9 : 0) + d;
        if (!best || score > best.score) best = { x: cx, y: cy, score };
      }
      x = best.x; y = best.y;
    } else {
      x = clampX(e.x); y = clampY(e.y);
    }

    this.boss25t5Vortices = this.boss25t5Vortices || [];
    this.boss25t5Vortices.push({
      id: `b25t5v-${e.id}-${(this.boss25t5VortexSeq = (this.boss25t5VortexSeq || 0) + 1)}`,
      x, y, r,
      hp: cfg.s5Hp,
      maxHp: cfg.s5Hp,
      t: 0,
      hitT: Math.max(1, cfg.s5HitIntervalMs)   // 进入后先过一个间隔再结算第一次伤害
    });

    e.state = 'skill';
    e.skillKind = 5;
    e.skillPhase = 'cast';
    e.skillT = 0;
    e.activeZoneId = null;
    e.shieldDown = true;
    e.shieldDownT = 0;
    e.zones = e.zones || [];
  },

  // ── 技能5 漩涡：每帧推进 / 吸子弹 / 吸收 / 清空 ──
  // 取漩涡口径配置：优先「战斗中」的 BOSS，其次任意 BOSS，最后兜底默认值（无头自检环境）
  boss25t5VortexCfg() {
    const list = this.enemies || [];
    const boss = list.find(x => x.type === 'boss-2-5t5' && x.alive && x.bossActive)
      || list.find(x => x.type === 'boss-2-5t5');
    return boss ? cfgOf(boss) : normalizeBoss25T5Config({});
  },

  // 每帧推进全部漩涡（带帧令牌去重 → 多 BOSS / 多调用点同一帧只推一次）：
  //   ① player.boss25t5Pull 先清零（无漩涡时不写 → 恒为 {0,0}，不产生位移）
  //   ② 按存活漩涡写入玩家吸力（越近越强，累加后钳制上限）
  //   ③ 玩家进入漩涡半径 → 每 s5HitIntervalMs 扣 s5HitDamage
  //   ④ 驱动被本漩涡捕获的转化子弹沿环公转（位置 / 切线方向，见 boss25t5VortexCapture）
  boss25t5VorticesTick(dt) {
    const nowT = this.time?.now;
    if (nowT !== undefined) {
      if (this.boss25t5VortexTick === nowT) return;
      this.boss25t5VortexTick = nowT;
    }
    const p = this.player;
    if (p) p.boss25t5Pull = { vx: 0, vy: 0 };   // 先清零（帧令牌已保证每帧只清一次）
    const vs = this.boss25t5Vortices;
    if (!vs || !vs.length) return;

    const cfg = this.boss25t5VortexCfg();
    const sec = (Number.isFinite(dt) ? dt : 0) / 1000;
    const pullR = Math.max(1, cfg.s5PullRadius);

    for (const v of vs) {
      v.t += dt;   // 存活毫秒（渲染端自转/收缩相位）

      // ④ 捕获环绕：被本漩涡捕获的转化子弹沿环公转（位置 / 切线方向由漩涡 tick 驱动）。
      // 放在下面的「p 判空」之前，保证无玩家时捕获子弹仍然推进。
      const capR = Math.max(1, v.r * cfg.s5CaptureOrbitRatio);
      const spin = deg2rad(cfg.s5CaptureSpinDeg) * sec;
      for (const b of this.bullets || []) {
        if (b.captured !== v.id || b.dead) continue;
        const ca = (b.captureAngle ?? 0) + spin;
        b.captureAngle = ca;
        b.x = v.x + Math.cos(ca) * capR;
        b.y = v.y + Math.sin(ca) * capR;
        b.dirX = -Math.sin(ca);
        b.dirY = Math.cos(ca);
        b.vx = 0;
        b.vy = 0;
      }

      if (!p) continue;
      const dx = v.x - p.x, dy = v.y - p.y;
      const d = Math.hypot(dx, dy);

      // ② 玩家吸力：a 为朝漩涡中心的速度分量（px/s）。进入吸力半径即受 s5PullMin，
      // 越靠近涡心越强（线性插值），涡心处为 s5PullMax；半径外为 0。
      if (d <= pullR && d > 1e-6) {
        const tNear = clamp01(1 - d / pullR);   // 0 = 吸力半径边缘，1 = 涡心
        const a = cfg.s5PullMin + (cfg.s5PullMax - cfg.s5PullMin) * tNear;
        p.boss25t5Pull.vx += dx / d * a;
        p.boss25t5Pull.vy += dy / d * a;
      }

      // ③ 玩家在漩涡内：按 hitT 周期结算伤害（离开时重置 → 再次进入重新计时）
      const inRange = d < v.r + (p.r ?? 0);
      if (inRange) {
        v.hitT -= dt;
        if (v.hitT <= 0) {
          v.hitT = Math.max(1, cfg.s5HitIntervalMs);
          this.damagePlayer(cfg.s5HitDamage);
        }
      } else {
        v.hitT = Math.max(1, cfg.s5HitIntervalMs);
      }
    }

    // 吸力速度上限钳制（多漩涡叠加也不至于把玩家瞬间弹飞；无玩家时该对象不存在，直接跳过）
    if (p) {
      const mag = Math.hypot(p.boss25t5Pull.vx, p.boss25t5Pull.vy);
      const maxV = Math.max(1, cfg.s5PullMax);
      if (mag > maxV) {
        const k = maxV / mag;
        p.boss25t5Pull.vx *= k;
        p.boss25t5Pull.vy *= k;
      }
    }
  },

  // 漩涡对单个子弹施吸力（返回是否真的施了力）。
  // 被护盾冻结的红弹一旦被吸住就「解冻」为白弹体 + 彩色拖尾的「转化子弹」（宽度/长度/颜色可配）。
  boss25t5VortexPull(b, dt) {
    const vs = this.boss25t5Vortices;
    if (!b || !vs || !vs.length) return false;
    const cfg = this.boss25t5VortexCfg();
    const sec = (Number.isFinite(dt) ? dt : 0) / 1000;
    const pullR = Math.max(1, cfg.s5PullRadius);
    const maxSpd = Math.max(1, cfg.s5BulletPull);
    let pulled = false;

    for (const v of vs) {
      const dx = v.x - b.x, dy = v.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > pullR || d < 1e-6) continue;   // 半径外不施力；正中心无方向
      const a = cfg.s5BulletPull * clamp01(1 - d / pullR);   // 越近越强
      b.vx = (b.vx ?? 0) + dx / d * a * sec;
      b.vy = (b.vy ?? 0) + dy / d * a * sec;
      pulled = true;
    }
    if (!pulled) return false;

    // 速度上限钳制（子弹不会被漩涡甩飞）
    const spd = Math.hypot(b.vx ?? 0, b.vy ?? 0);
    if (spd > maxSpd) {
      const k = maxSpd / spd;
      b.vx *= k;
      b.vy *= k;
    }

    if (b.blockedBoss) {
      // 解冻：白弹体 + 彩色拖尾（forceTrail），且不再被护盾拦截（见 boss25t5TryBlock）。
      // **保留 blockedBy** —— 它同时是「已转化子弹」的判定标记（仍会伤玩家、可被漩涡捕获、不再伤敌人）。
      b.blockedBoss = false;
      b.colorStr = '#ffffff';
      b.trailColor = cfg.s5BulletTrailColor;
      b.forceTrail = { width: cfg.s5BulletTrailWidth, length: cfg.s5BulletTrailLength, color: cfg.s5BulletTrailColor };
      b.thawed = true;
    }
    return true;
  },

  // 子弹落进任一漩涡半径 → 扣该漩涡 HP、子弹消失，返回 true。
  // 只有玩家子弹能对漩涡造成伤害；伤害口径与「打敌人」一致（pet 弹用 b.petDamage 覆盖）。
  boss25t5VortexAbsorb(b) {
    const vs = this.boss25t5Vortices;
    if (!b || !vs || !vs.length) return false;

    let dmg;
    if (b.petDamage != null) {
      dmg = b.petDamage;
    } else if (typeof this.playerDamage === 'function') {
      dmg = this.playerDamage(this, b.weaponType);   // game-scene 构造函数注入（本模块不静态 import damage.js）
    }
    if (!Number.isFinite(dmg)) dmg = 1;              // 无伤害来源兜底（仅无头自检会走到）
    if (b.damageMult) dmg *= b.damageMult;           // 蓄力伤害倍率（与敌人命中分支同口径）
    if (b.amplified) dmg *= 2;                       // 穿表盘红弧伤害翻倍

    for (let i = vs.length - 1; i >= 0; i--) {
      const v = vs[i];
      if (Math.hypot(b.x - v.x, b.y - v.y) >= v.r) continue;
      // 已转化子弹（blockedBy != null）：进漩涡半径 = 只消灭该弹、不扣漩涡 HP。
      // 同时兜住 boss25t5VortexCapture 的「超捕获上限」——那时它会留在原地，于是走到这里被清除。
      if (b.blockedBy != null) { b.dead = true; return true; }
      v.hp -= dmg;
      b.dead = true;
      if (v.hp <= 0) {
        vs.splice(i, 1);                        // 被击杀 → 消散（漩涡不自动消散，只有这里/BOSS 死亡会移除）
        this.boss25t5ReleaseCaptured(v.id);     // 被击杀 → 释放它捕获的全部转化子弹（静止停驻）
      }
      return true;
    }
    return false;
  },

  // ① 漩涡捕获：已转化子弹（blockedBy != null）落进漩涡半径 → 被捕获、沿环公转。
  // 捕获后该弹不前进、不碰撞、不施力，位置由 boss25t5VorticesTick 每帧驱动。
  // 未转化（普通）子弹返回 false —— 它们照旧走 boss25t5VortexAbsorb 扣漩涡 HP。
  boss25t5VortexCapture(b) {
    const vs = this.boss25t5Vortices;
    if (!b || !vs || !vs.length) return false;
    if (b.blockedBy == null) return false;   // 只捕获已转化子弹
    const cfg = this.boss25t5VortexCfg();
    const list = this.bullets || [];
    for (const v of vs) {
      if (Math.hypot(b.x - v.x, b.y - v.y) >= v.r) continue;
      // 该漩涡已捕获数量：达到上限则不再捕获（留在原地 → 交给 boss25t5VortexAbsorb 直接消灭，不扣 HP）
      let count = 0;
      for (const x of list) if (!x.dead && x.captured === v.id) count++;
      if (count >= Math.max(0, cfg.s5CaptureMax)) return false;

      const capR = Math.max(1, v.r * cfg.s5CaptureOrbitRatio);
      const ang = (count * 2.399963229728653) % (Math.PI * 2);   // 黄金角散布：相邻捕获错开，避免扎堆
      b.captured = v.id;
      b.captureAngle = ang;
      b.vx = 0;
      b.vy = 0;
      b.force = null;   // 丢弃未用完的施力任务（否则释放后会带着剩余距离继续跑）
      b.x = v.x + Math.cos(ang) * capR;
      b.y = v.y + Math.sin(ang) * capR;
      b.dirX = -Math.sin(ang);   // 环上切线方向（拖尾朝向）
      b.dirY = Math.cos(ang);
      if (!b.forceTrail) {
        b.forceTrail = { width: cfg.s5BulletTrailWidth, length: cfg.s5BulletTrailLength, color: cfg.s5BulletTrailColor };
      }
      return true;
    }
    return false;
  },

  // 释放指定漩涡捕获的全部已转化子弹：清除 captured、速度归零（位置保持不变 = 停驻在原地）。
  // 调用点：boss25t5VortexAbsorb（漩涡被击杀）/ boss25t5ClearVortices（BOSS 死亡清空）。
  boss25t5ReleaseCaptured(vortexId) {
    for (const b of this.bullets || []) {
      if (b.captured === vortexId) {
        b.captured = null;
        b.vx = 0;
        b.vy = 0;
        b.force = null;   // 释放 = 静止停驻在原处（不带着未用完的施力任务继续跑）
      }
    }
  },

  // ⑤⑥ 技能1/2 对区域内已转化子弹施力（s1 朝 BOSS 拖 / s2 背离 BOSS 推），返回**本次是否新授予了任务**。
  // 口径与玩家拖拽/击退（boss25t5ApplyForce / boss25t5StepForce）一致：**一次性固定速度 + 固定距离预算**
  // （用完就停，不再无限加速）。参数复用玩家拖拽配置：速度取 s1DragSpeed / s2PushSpeed，
  // 距离 = 玩家的 s1DragDist / s2PushDist × BULLET_FORCE_DIST_MULT（2 倍）。
  // 只作用于已转化子弹（blockedBy != null）；施力同时解冻（blockedBoss=false、thawed=true → 不再被护盾拦截）
  // 并写入按技能配色的 forceTrail。
  //
  // 运行时字段（内部，渲染端/其它模块只读 forceTrail）：
  //   b.force      = { mode:'drag'|'push', ownerId, speed, remain } | null —— 一次性施力任务（remain = 剩余距离 px）
  //   b.forceSrc   = 已对该弹施加过施力的**区域 id**（同一区域只施加一次，避免停下后被反复推动）
  //   b.forceStepT = 本帧是否已推进过任务（帧令牌，取 this.time.now；undefined 时不去重）
  boss25t5ZoneBulletForce(b, dt) {
    if (!b || b.blockedBy == null) return false;
    const sec = (Number.isFinite(dt) ? dt : 0) / 1000;
    const nowT = this.time?.now;

    // ⑴ 推进已有任务：帧令牌去重（同一帧多调用点只扣一次距离预算）
    const f = b.force;
    if (f && (nowT === undefined || b.forceStepT !== nowT)) {
      b.forceStepT = nowT;
      const owner = (this.enemies || []).find(x => x.id === f.ownerId && x.alive);
      const stepLen = f.speed * sec;
      // 停下条件：owner 消失 / 距离预算用完 / drag 拖到圆弧1 内缘（别钻进 BOSS 体内）
      const atInner = !!owner && f.mode === 'drag'
        && Math.hypot(b.x - owner.x, b.y - owner.y) <= cfgOf(owner).innerRadius * (owner.artScale || 1);
      if (!owner || f.remain <= stepLen || atInner) {
        b.vx = 0; b.vy = 0; b.force = null;
      } else {
        // 每帧重算方向（同玩家口径：位移路径会轻微拐弯）：drag 朝 owner / push 背离 owner
        const ang = f.mode === 'push'
          ? angleBetween(owner.x, owner.y, b.x, b.y)
          : angleBetween(b.x, b.y, owner.x, owner.y);
        b.vx = Math.cos(ang) * f.speed;
        b.vy = Math.sin(ang) * f.speed;
        f.remain -= stepLen;
      }
    }

    // ⑵ 新入区子弹授予任务：遍历战斗中的 BOSS 区域，命中扇形且该区域尚未授予过 → 授予（当帧即开始移动）
    let granted = false;
    for (const e of this.enemies || []) {
      if (e.type !== 'boss-2-5t5' || !e.alive || !e.bossActive) continue;
      if (!e.zones || !e.zones.length) continue;
      const cfg = cfgOf(e);
      for (const z of e.zones) {
        if (z.kind !== 's1' && z.kind !== 's2') continue;
        if (z.phase !== 'anim' && z.phase !== 'keep') continue;
        if (b.forceSrc === z.id) continue;   // 同一区域只授予一次

        // 径向可见范围（口径同 boss25t5ZonesTick；非有限值退化为 rMin/rMax）
        const visMin = Number.isFinite(z.visMin) ? Math.max(z.rMin, z.visMin) : z.rMin;
        const visMax = Number.isFinite(z.visMax) ? Math.min(z.rMax, Math.max(visMin, z.visMax)) : z.rMax;
        const d = Math.hypot(b.x - z.x, b.y - z.y);
        if (d < visMin || d > visMax) continue;
        const ang = angleBetween(z.x, z.y, b.x, b.y);
        if (!angleInArc(ang, z.a0, z.a1)) continue;

        const drag = z.kind === 's1';
        const mode = drag ? 'drag' : 'push';
        const speed = Math.max(1, drag ? cfg.s1DragSpeed : cfg.s2PushSpeed);
        // 速度复用玩家拖拽速度；距离 = 玩家距离 × BULLET_FORCE_DIST_MULT（2 倍）
        const remain = Math.max(0, (drag ? cfg.s1DragDist : cfg.s2PushDist) * BULLET_FORCE_DIST_MULT);
        // 方向与玩家拖拽/击退同口径（取 BOSS **实时**坐标）：s1 朝 BOSS / s2 背离 BOSS
        const dirAng = drag ? angleBetween(b.x, b.y, e.x, e.y) : angleBetween(e.x, e.y, b.x, b.y);
        b.vx = Math.cos(dirAng) * speed;
        b.vy = Math.sin(dirAng) * speed;
        b.force = { mode, ownerId: e.id, speed, remain };
        b.forceSrc = z.id;

        // 解冻 + 按技能配色的施力拖尾
        b.blockedBoss = false;
        b.thawed = true;
        b.forceTrail = {
          width: drag ? cfg.s1BulletTrailWidth : cfg.s2BulletTrailWidth,
          length: drag ? cfg.s1BulletTrailLength : cfg.s2BulletTrailLength,
          color: drag ? cfg.s1BulletTrailColor : cfg.s2BulletTrailColor
        };
        granted = true;
      }
    }
    return granted;
  },

  // BOSS 死亡：清空场景级漩涡 + 全部捕获 + 玩家吸力（enemy-ai.js:defeatEnemy 调用）
  boss25t5ClearVortices() {
    for (const b of this.bullets || []) {
      if (b.captured != null) {
        b.captured = null;   // 释放捕获（速度归零、位置不变）
        b.vx = 0;
        b.vy = 0;
      }
    }
    this.boss25t5Vortices = [];
    if (this.player) this.player.boss25t5Pull = { vx: 0, vy: 0 };
  },

  // 开始技能：建区域并进入 skill 状态（技能1=蓝区 / 技能2=红区 / 技能3=紫区）
  // 区域在释放那一刻锚定：把当前 BOSS 坐标写进 zone.x/zone.y（同一次释放的所有区域共用该锚点）。
  // rMin / rMax 均 × artScale 保持单位统一（artScale 默认 1，等价于原 s1Range=1500）。
  boss25t5StartSkill(e, cfg, kind) {
    const a = this.boss25t5ArcAngles(e);
    const artScale = e.artScale || 1;
    const half = a.spanRad / 2;
    const arcRWorld = cfg.arcRadius * artScale;
    const innerWorld = cfg.innerRadius * artScale;

    // 区域方向：永远以「BOSS → 玩家」为中心（技能对准玩家释放，不空放）。
    // 参战圆弧在等待期已被转到同一方向，因此区域与圆弧视觉一致。
    const aim = this.player ? angleBetween(e.x, e.y, this.player.x, this.player.y) : (a.arc4Center ?? 0);
    const a0 = aim - half, a1 = aim + half;

    let rMin, rMax, zoneKind;
    if (kind === 1) {
      rMin = innerWorld; rMax = cfg.s1Range * artScale; zoneKind = 's1';
    } else if (kind === 2) {
      rMin = arcRWorld; rMax = cfg.s2Range * artScale; zoneKind = 's2';
    } else {
      rMin = arcRWorld; rMax = cfg.s3Range * artScale; zoneKind = 's3';
    }

    const zone = {
      id: `b25t5-${e.id}-${(this.boss25t5ZoneSeq = (this.boss25t5ZoneSeq || 0) + 1)}`,
      kind: zoneKind,
      x: e.x, y: e.y,          // 世界锚点：释放时刻的 BOSS 坐标（扇形的顶点）
      a0, a1, rMin, rMax,
      phase: 'extend',
      t: 0,
      arcR: rMin,
      prevArcR: rMin,
      alpha: 1,
      purpleAlpha: 1,
      visMin: rMin,          // 渲染可见径向范围（消散阶段方向性收缩）
      visMax: rMax,
      // s3 = 整区紫色（null）；s1 无紫色（[]）；s2 的紫色重叠多边形在 boss25t5ZonesTick 每帧重算
      purplePolys: zoneKind === 's3' ? null : []
    };

    e.zones.push(zone);
    e.activeZoneId = zone.id;
    e.skillKind = kind;
    e.skillPhase = 'extend';
    e.skillT = 0;
    e.state = 'skill';
    e.shieldDown = true;
    e.shieldDownT = 0;
  },

  // 技能4：从圆弧2 半径向外的灰色圆弧击飞（不打断当前行动）
  boss25t5CastSkill4(e, cfg) {
    const artScale = e.artScale || 1;
    e.skill4Fx = {
      t: 0,
      dur: 300,
      r0: cfg.arc2Radius * artScale,
      r1: cfg.arcRadius * artScale
    };
    this.boss25t5ApplyForce(e, cfg.s4PushSpeed, cfg.s4PushDist, 'push');
    this.damagePlayer(cfg.s4Damage);
  },

  boss25t5KillPlayer() {
    if (this.state === 'fail') return;   // 已结算过，避免重复 syncUIState
    this.player.hp = 0;
    this.player.shield = 0;
    this.player.shieldBroken = true;
    this.player.shieldActive = false;
    this.state = 'fail';
    this.syncUIState();
  }
};
