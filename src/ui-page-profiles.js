// 页面画像：把「代码绘制的现有 UI 页面」还原成可批注的控件矩形列表，
// 供 UI 设计稿(mxGraph 编辑器)导入、标注动画/逻辑描述，并保存到 docs/ui-designs/ 供 AI 精确实现。
// 布局常量与 src/systems/ui/screens.js 及 src/systems/gameplay/workshop.js 保持一致。

function sh(o) {
  return {
    id: o.id, x: o.x, y: o.y, w: o.w, h: o.h,
    label: o.label ?? '',
    shape: o.shape ?? 'rect',
    fill: o.fill ?? null,
    stroke: o.stroke ?? null,
    strokeWidth: o.strokeWidth ?? 1,
    fontColor: o.fontColor ?? (o.fill && o.fill !== '#ffffff' && o.fill !== '#000000' ? '#eaf4fb' : '#000000'),
    fontSize: o.fontSize ?? 22,
    align: o.align ?? 'center',
    verticalAlign: o.verticalAlign ?? 'middle',
    rotation: o.rotation ?? 0,
    dashed: o.dashed ?? false,
    fillOpacity: o.fillOpacity ?? 1,
    strokeOpacity: o.strokeOpacity ?? 1,
    note: o.note ?? ''
  };
}

// 供 AI 精确实现的关键信息：每页附带「页面级」说明，agents 读取时作为实现依据。
const PAGE_NOTES = {
  workshop: '工坊页：左侧为玩家快照+等级/属性加点，右上面板为武器列表（横向滚动卡片），右下为仓库背包（改件/圣物/宠物分页签）。控件含批注：选中后可拖动微调位置，并在右侧填写功能/动画/逻辑描述。',
  weapon: '武器商店页：左侧页签切换武器/改件/宠物/圣物，右侧为商品网格（支持纵向滚动）。每张商品卡含标签、锁定图标、价格与「购买」按钮。',
  levelSelect: '关卡选择页(两页)：页1=模式选关，2 张卡(探险/守卫)，守卫未达 30 级灰底+锁；点击探险进页2。页2=探险子关选关，黑底灰网格(20px,可拖背景)，3 个平行四边形按钮(1-1深蓝号/1-2苍赫之境/1-3破败王座)各连一个旋转圆环，未解锁(通关前置)置灰+锁，点击进对应关卡。',
  settlement: '关卡结算页：全屏黑底，含成败标题、3 个进度球、击败列表、本局收获，右下「回到大厅」按钮。所有元素依次渐现 + count-up 动画。'
};

function workshop() {
  const s = [];
  s.push(sh({ id: 'pg_bg', x: 0, y: 0, w: 1920, h: 1080, label: '工坊页', fill: '#060606', stroke: '#000000', fontSize: 30, note: PAGE_NOTES.workshop }));
  s.push(sh({ id: 'panel_left', x: 40, y: 40, w: 460, h: 1000, label: '左侧面板', fill: '#0a0a0a', stroke: '#222222', note: '左面板：玩家快照 + 等级/经验条/加点 + 圣物/宠物槽。' }));
  s.push(sh({ id: 'panel_weapon', x: 520, y: 40, w: 1360, h: 500, label: '武器列表', fill: '#0a0a0a', stroke: '#222222', note: '右上面板：武器列表，卡片横向滚动(横向 maxScroll)。每卡=选择装备目标。' }));
  s.push(sh({ id: 'panel_inventory', x: 520, y: 560, w: 1360, h: 480, label: '仓库背包', fill: '#0a0a0a', stroke: '#222222', note: '右下面板：仓库背包，上分页签(改件/圣物/宠物)，下方物品格(16 列)，物品长按拖拽到上方槽位。' }));

  for (let i = 0; i < 3; i++) {
    const sy = 64 + i * 46;
    s.push(sh({ id: `weapon_slot_${i}`, x: 400, y: sy, w: 36, h: 36, label: `方案槽${i + 1}`, fill: '#333333', stroke: '#ffffff', fontSize: 12, note: `武器方案槽${i + 1}：切换当前装备方案(0 号=radial 必解锁)。解锁需等级 ${[12, 30][i - 1] ?? 0} 级。` }));
  }
  s.push(sh({ id: 'lv_exp', x: 64, y: 356, w: 380, h: 12, label: 'Lv 经验条', fill: '#222222', stroke: null, fontSize: 14, note: '经验条：底 #222，填充 #00e5ff(比例 exp/expToNext)。上方 Lv 文本(64,320)。' }));

  const keys = ['hpAdd', 'atkAdd', 'spdAdd', 'defAdd']; // 示例四个加点键
  const UPGRADE_STATS_LABEL = ['生命强化', '攻击强化', '攻速强化', '防御强化'];
  for (let i = 0; i < 4; i++) {
    const rowY = 440 + i * 72;
    s.push(sh({ id: `up_${keys[i]}`, x: 412, y: rowY + 20, w: 32, h: 32, label: '+', fill: '#ffffff', stroke: '#000000', fontSize: 20, note: `加点按钮:${UPGRADE_STATS_LABEL[i]}，点击+1 点(耗 spendable)。左侧行含 label(64,rowY)/数值(64,rowY+34)/进度条(64,rowY+56,300,10)。` }));
  }

  const slotSize = 50, slotGap = 10, right = 444;
  const relicStart = right - (3 * slotSize + 2 * slotGap);
  s.push(sh({ id: 'relic_label', x: 64, y: 771, w: 120, h: 30, label: '圣物', fill: null, stroke: null, fontSize: 18, align: 'left', note: '圣物槽标标签。' }));
  for (let i = 0; i < 3; i++) {
    const sx = relicStart + i * (slotSize + slotGap);
    s.push(sh({ id: `relic_${i}`, x: sx, y: 746, w: slotSize, h: slotSize, label: `圣物${i + 1}`, fill: '#555555', stroke: '#333333', fontSize: 12, note: '圣物槽：接收从仓库拖入的圣物(50×50)。' }));
  }
  const petStart = right - (2 * slotSize + slotGap);
  s.push(sh({ id: 'pet_label', x: 64, y: 845, w: 120, h: 30, label: '宠物', fill: null, stroke: null, fontSize: 18, align: 'left', note: '宠物槽标签。' }));
  for (let i = 0; i < 2; i++) {
    const sx = petStart + i * (slotSize + slotGap);
    s.push(sh({ id: `pet_${i}`, x: sx, y: 746 + slotSize + 24, w: slotSize, h: slotSize, label: `宠物${i + 1}`, fill: '#555555', stroke: '#333333', fontSize: 12, note: '宠物槽：接收从仓库拖入的宠物。' }));
  }

  const cardW = 280, cardH = 344, cardGap = 24;
  for (let i = 0; i < 5; i++) {
    const cardX = 544 + i * (cardW + cardGap);
    s.push(sh({ id: `weapon_card_${i}`, x: cardX, y: 120, w: cardW, h: cardH, label: `武器卡${i + 1}`, fill: '#ffffff', stroke: '#cccccc', note: '武器卡：横向滚动列表，卡上部武器外形(卡高 200)，右下装备槽(通用/专属改件)。点击选中为装备。' }));
  }

  const tabs = ['改件', '圣物', '宠物'];
  for (let i = 0; i < 3; i++) {
    s.push(sh({ id: `inv_tab_${i}`, x: 544 + i * 104, y: 584, w: 96, h: 32, label: tabs[i], fill: null, stroke: null, fontSize: 20, align: 'left', verticalAlign: 'top', note: '仓库背包分页签：切换下方物品格分类。' }));
  }
  for (let i = 0; i < 8; i++) {
    const col = i % 8, row = Math.floor(i / 8);
    s.push(sh({ id: `inv_cell_${i}`, x: 544 + col * 80, y: 640 + row * 80, w: 64, h: 64, label: '', fill: '#1a1a1a', stroke: '#333333', fontSize: 10, note: '物品格：显示改件/圣物/宠物，右下角数字=堆叠数量，长按可拖拽。' }));
  }
  return s;
}

function weapon() {
  const s = [];
  // 布局常量取自 data/ui/weapon.json（游戏实际加载 ui.weapon）
  const gridX = 480, gridY = 130, gridW = 1400, gridH = 860;
  const cardW = 260, cardH = 450, gapX = 20, gapY = 24;
  const tabX = 56, tabY = 130, tabW = 375, tabH = 64, tabGap = 16;
  const titleX = 56, titleY = 40, curX = 1430, curY = 56;

  s.push(sh({ id: 'pg_bg', x: 0, y: 0, w: 1920, h: 1080, label: '武器商店', fill: '#060606', stroke: '#000000', fontSize: 30, note: PAGE_NOTES.weapon }));
  s.push(sh({ id: 'title', x: titleX, y: titleY, w: 200, h: 44, label: '商店', fill: null, stroke: null, fontSize: 34, align: 'left', verticalAlign: 'top', note: '页标题：「商店」，恒显。' }));
  s.push(sh({ id: 'grid_bg', x: gridX - 16, y: gridY - 16, w: gridW + 32, h: gridH + 32, label: '商品网格', fill: '#0a0a0a', stroke: null, note: '商品网格背景板(黑、无边框)。网格区 (gridX,gridY,gridW,gridH) 可纵向滚动，卡片超出裁剪。' }));

  const tabs = [['weapon', '武器'], ['mod', '改件'], ['pet', '宠物'], ['relic', '圣物']];
  for (let i = 0; i < tabs.length; i++) {
    const [id, label] = tabs[i];
    s.push(sh({ id: `tab_${id}`, x: tabX, y: tabY + i * (tabH + tabGap), w: tabW, h: tabH, label, fill: null, stroke: null, fontSize: 26, align: 'left', note: `购物页签[${label}]：点击切换商品类型。选中背后白色长条(tabW*0.92 宽)，文字加粗；悬停放大 20%。` }));
  }
  s.push(sh({ id: 'currency', x: curX, y: curY, w: 260, h: 30, label: '货币区', fill: null, stroke: null, fontSize: 22, align: 'left', note: '右上货币区：黄菱形金币#ffd54f + 青菱形绿币#00e5ff，各显示余额。' }));

  const products = [['radial', '环形枪', 0], ['yellow', '黄色枪', 100], ['green', '绿色枪', 200]];
  for (const [type, name, price] of products) {
    const col = products.findIndex(p => p[0] === type);
    const cardX = gridX + col * (cardW + gapX), cardY = gridY;
    s.push(sh({ id: `card_${type}`, x: cardX, y: cardY, w: cardW, h: cardH, label: name, fill: '#ffffff', stroke: '#cccccc', fontSize: 30, note: `商品卡[${name}]：卡上部武器图标，右上锁定/已拥有标识，底部「购买」按钮(${type} 售价 ${price} 金币)。点击购买扣款并解锁。` }));
    const bw = cardW - 56, bh = 44, bx = cardX + 28, by = cardY + cardH - 62;
    s.push(sh({ id: `buy_${type}`, x: bx, y: by, w: bw, h: bh, label: `购买 ${price}`, fill: '#111111', stroke: '#000000', fontSize: 18, note: `购买按钮[${name}]：点击 buyWeapon(${type})，够钱则扣款并解锁武器(写入存档 weapons.${type}.unlocked)。` }));
  }
  return s;
}

function levelSelect() {
  const s = [];
  const cardW = 460, cardH = 560, gap = 88;
  const startX = (1920 - (cardW * 2 + gap)) / 2, topY = 250;
  s.push(sh({ id: 'pg_bg', x: 0, y: 0, w: 1920, h: 1080, label: '模式选关', fill: '#060606', stroke: '#000000', fontSize: 30, note: PAGE_NOTES.levelSelect }));
  const modes = [
    { key: 'explore', title: '探险模式', desc: '在探索宇宙之路上与怪物战斗，获取战利品与成长经验', unlocked: true },
    { key: 'guard', title: '守卫模式', desc: '面对无尽的敌人攻势，守护目标，证明你的实力！', unlocked: false },
  ];
  for (let i = 0; i < 2; i++) {
    const m = modes[i];
    const x = startX + i * (cardW + gap), y = topY;
    s.push(sh({ id: `mode_${m.key}`, x, y, w: cardW, h: cardH, label: m.title, fill: m.unlocked ? '#ffffff' : '#CFCFCF', stroke: '#6fd3ff', fontSize: 46, note: `模式卡[${m.title}]：白底卡片(守卫未达30级=灰底#CFCFCF+锁)。点击探险→页2子关选关；点击守卫(≥30级)→直接进 Level2-Scene1。翻牌出现+悬停放大10%。` }));
    s.push(sh({ id: `mode_${m.key}_thumb`, x: x + 40, y: y + 36, w: cardW - 80, h: cardH * 0.44, label: '', fill: '#999999', stroke: '#999999', note: '灰色关卡缩略图占位' }));
    s.push(sh({ id: `mode_${m.key}_desc`, x: x + 40, y: y + 40 + cardH * 0.44 + 118, w: cardW - 80, h: 60, label: m.desc, shape: 'text', fill: null, stroke: null, fontColor: '#888888', fontSize: 20, align: 'center', note: '模式描述文案' }));
  }
  return s;
}

function settlement() {
  const s = [];
  const BALL_X = [564, 942, 1308], BALL_Y = 366, BALL_R = 42;
  s.push(sh({ id: 'pg_bg', x: 0, y: 0, w: 1920, h: 1080, label: '结算页', fill: '#000000', stroke: '#000000', fontSize: 30, note: PAGE_NOTES.settlement }));
  s.push(sh({ id: 'settle_title', x: 60, y: 51, w: 800, h: 108, label: '撤离成功/失败', shape: 'text', fill: null, stroke: null, fontColor: '#33ff33', fontSize: 84, align: 'left', verticalAlign: 'top', note: '标题：成功=#33ff33「撤离成功」/失败=#ff3b3b「撤离失败」。渐现(appear(0))。' }));
  s.push(sh({ id: 'prog_label', x: 78, y: 187, w: 200, h: 54, label: '进度', shape: 'text', fill: null, stroke: null, fontColor: '#ffffff', fontSize: 48, align: 'left', verticalAlign: 'top', note: '「进度」区块标签，渐现(appear(260))。' }));
  for (let i = 0; i < 3; i++) {
    const cx = BALL_X[i];
    const pass = i < 2; // 代表过关，实际读存档 levels.completed
    s.push(sh({ id: `ball_${i}`, x: cx - BALL_R, y: BALL_Y - BALL_R, w: BALL_R * 2, h: BALL_R * 2, label: `${i + 1}`, shape: 'ellipse', fill: pass ? '#33ff33' : '#ffffff', stroke: '#ffffff', strokeWidth: 3, fontSize: 48, note: `进度球[Scene ${i + 1}]：过关=绿球#33ff33+白勾；未过关=半透明白圈。下方标签 "大关-${i + 1}"。相邻两球都过则画白色连线。` }));
  }
  s.push(sh({ id: 'kill_label', x: 120, y: 534, w: 300, h: 54, label: '击败列表', shape: 'text', fill: null, stroke: null, fontColor: '#ffffff', fontSize: 48, align: 'left', verticalAlign: 'top', note: '「击败列表」标签：下方逐行显示最近 5 类敌人图标×数量，逐个浮现+count-up。起始行 y=580，行高 64。' }));
  s.push(sh({ id: 'gain_label', x: 120, y: 738, w: 300, h: 54, label: '本局收获', shape: 'text', fill: null, stroke: null, fontColor: '#ffffff', fontSize: 48, align: 'left', verticalAlign: 'top', note: '「本局收获」标签：下方黄菱形(金币)#ffff00 ×N、青菱形(经验)#33ffff ×N，count-up 递增。' }));
  s.push(sh({ id: 'settleHome', x: 1450, y: 930, w: 200, h: 80, label: '回到大厅', fill: '#1a1a1a', stroke: '#ffffff', strokeWidth: 2, fontSize: 30, note: '「回到大厅」按钮：点击关闭结算页回到大厅。悬停反色(底白字黑+左圆点)，按下 pressScale 缩放。' }));
  return s;
}

// 可在编辑器导入的现有页面清单
export const pageProfiles = [
  { id: 'workshop', name: '工坊页' },
  { id: 'weapon', name: '武器商店页' },
  { id: 'levelSelect', name: '关卡选择页' },
  { id: 'settlement', name: '游戏结算页' }
];

export function profilePage(pageId) {
  switch (pageId) {
    case 'workshop': return workshop();
    case 'weapon': return weapon();
    case 'levelSelect': return levelSelect();
    case 'settlement': return settlement();
    default: return [];
  }
}
