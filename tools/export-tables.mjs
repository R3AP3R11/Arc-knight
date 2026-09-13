// 策划表格 → JSON 导表工具
// 读取 策划文档/server 下的消耗品/武器/老虎机 xlsx，归一化为 data/inner-shop.json。
// 消耗品表新增的「效果类型 / 效果数值 / 效果时长」三列中，「效果时长」单位为秒（0 表示本局永久）。
// 「美术方案类型/名称（局内表现）」两列为局内 HUD / 掉落物用的美术方案，策划未填时由消费方回退「图标」两列。
// 同时导出 buildInnerShop() 供 server.js 在开发期复用（避免重复解析逻辑）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';

// 老虎机表里没有「抽卡花费 / 金币保底」两列，用固定常量集中定义。
export const DEFAULT_DRAW_COST = 15;
export const DEFAULT_GOLD_PRIZE = 15;

// 仓库根目录（本文件位于 tools/ 下）。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 老虎机「描述」列 → key 映射；未识别的描述直接用原文当 key。
const LOTTERY_KEY_MAP = { 武器: 'weapon', 护盾: 'shield', 金币: 'gold', 垃圾: 'trash' };

// 数据行终止阈值：连续 N 行编号/描述为空则停止读取。
const BLANK_ROW_STOP = 5;

const SHEET_CONSUMABLES = { file: '消耗品.xlsx', sheet: 'innerItemInfo', headerKey: '编号' };
const SHEET_WEAPONS = { file: '武器.xlsx', sheet: 'weapon', headerKey: '编号' };
const SHEET_LOTTERY = { file: '老虎机.xlsx', sheet: 'main', headerKey: '描述' };

// 取单元格原始值（兼容 richText / 公式 / 超链接 / 日期等 exceljs 结构）。
function rawValue(cell) {
  const v = cell ? cell.value : null;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text ?? '').join('');
    if (v.text !== undefined) return v.text;
    if (v.result !== undefined) return v.result;
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  return v;
}

// 归一化为 trim 后的字符串。
function asText(cell) {
  const v = rawValue(cell);
  return v === null || v === undefined ? '' : String(v).trim();
}

// 归一化为数值，非法回退 fallback。
function asNum(cell, fallback = 0) {
  const s = asText(cell).replace(/[\s,]/g, '');
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

// 归一化为整数，非法回退 fallback。
function asInt(cell, fallback = 0) {
  const n = asNum(cell, fallback);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// 单元格真值判定：1 / "1" / true / "true" 均视为 true。
function asBool(cell) {
  const v = rawValue(cell);
  if (v === true || v === 1) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true';
}

// 消耗品编号去千分位逗号后作为字符串 ID。
function normalizeId(cell) {
  return asText(cell).replace(/,/g, '');
}

function idShape(v) {
  return /^\d+$/.test(v);
}

// 加载 workbook，找不到文件/页签时抛出清晰错误。
async function loadSheet({ dir, file, sheet }) {
  const full = path.join(dir, file);
  try {
    await fs.access(full);
  } catch {
    throw new Error(`找不到策划表格：${full}`);
  }
  const wb = new ExcelJS.Workbook();
  let ws;
  try {
    ws = await wb.xlsx.readFile(full).then(() => wb.getWorksheet(sheet));
  } catch (e) {
    throw new Error(`解析策划表格失败：${full}（${e.message}）`);
  }
  if (!ws) throw new Error(`策划表格缺少页签：${full} → ${sheet}`);
  return ws;
}

// 找到含中文列名的表头行（该行存在某个单元格 text === headerKey）。
function findHeaderRow(ws, headerKey) {
  const maxScan = Math.min(ws.rowCount, 30);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= ws.columnCount; c++) {
      if (asText(row.getCell(c)) === headerKey) return r;
    }
  }
  return -1;
}

// 依据表头行建立 列名 → 列号 映射（同为列名取首次出现）。
function buildColumnMap(ws, headerRow) {
  const map = {};
  const row = ws.getRow(headerRow);
  for (let c = 1; c <= ws.columnCount; c++) {
    const name = asText(row.getCell(c));
    if (name && !(name in map)) map[name] = c;
  }
  return map;
}

export async function parseConsumables(dir) {
  const ws = await loadSheet({ dir, ...SHEET_CONSUMABLES });
  const headerRow = findHeaderRow(ws, SHEET_CONSUMABLES.headerKey);
  if (headerRow < 0) throw new Error(`消耗品表未找到含「${SHEET_CONSUMABLES.headerKey}」的表头行（${SHEET_CONSUMABLES.sheet}）`);
  const col = buildColumnMap(ws, headerRow);
  const out = [];
  let blank = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const at = name => (col[name] ? row.getCell(col[name]) : null);
    const id = normalizeId(at('编号'));
    if (!idShape(id)) { if (++blank >= BLANK_ROW_STOP) break; continue; }
    blank = 0;
    const desc = asText(at('描述')) || asText(at('逻辑语言描述（程序不读该字段）'));
    out.push({
      id,
      name: asText(at('备注')),
      desc,
      cost: asInt(at('购买花费')),
      artType: asText(at('美术方案类型（图标）')),
      artName: asText(at('美术方案名称（图标）')),
      artTypeInRun: asText(at('美术方案类型（局内表现）')),
      artNameInRun: asText(at('美术方案名称（局内表现）')),
      instant: asBool(at('是否即时生效')),
      inLottery: asBool(at('是否进老虎机')),
      slot: asInt(at('局内栏位')),
      effectType: asText(at('效果类型')),
      effectValue: asNum(at('效果数值')),
      effectSec: asNum(at('效果时长'))
    });
  }
  return out;
}

export async function parseWeapons(dir) {
  const ws = await loadSheet({ dir, ...SHEET_WEAPONS });
  const headerRow = findHeaderRow(ws, SHEET_WEAPONS.headerKey);
  if (headerRow < 0) throw new Error(`武器表未找到含「${SHEET_WEAPONS.headerKey}」的表头行（${SHEET_WEAPONS.sheet}）`);
  const col = buildColumnMap(ws, headerRow);
  const out = [];
  let blank = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const at = name => (col[name] ? row.getCell(col[name]) : null);
    const id = normalizeId(at('编号'));
    if (!idShape(id)) { if (++blank >= BLANK_ROW_STOP) break; continue; }
    blank = 0;
    if (!asBool(at('是否加入局内临时'))) continue; // 只导出「是否加入局内临时=1」的行
    out.push({
      id,
      name: asText(at('备注')),
      cost: asInt(at('临时价格（局内临时为1时才生效）')),
      durationSec: asNum(at('临时时长（局内临时为1时才生效）')),
      inLottery: asBool(at('是否进老虎机'))
    });
  }
  return out;
}

export async function parseLottery(dir) {
  const ws = await loadSheet({ dir, ...SHEET_LOTTERY });
  const headerRow = findHeaderRow(ws, SHEET_LOTTERY.headerKey);
  if (headerRow < 0) throw new Error(`老虎机表未找到含「${SHEET_LOTTERY.headerKey}」的表头行（${SHEET_LOTTERY.sheet}）`);
  const col = buildColumnMap(ws, headerRow);
  const kinds = [];
  let blank = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const at = name => (col[name] ? row.getCell(col[name]) : null);
    const name = asText(at('描述'));
    // 老虎机表无编号列，用「直接出货权重」必须是数值来跳过 Type/类型表头行。
    const weightText = asText(at('直接出货权重')).replace(/[\s,]/g, '');
    const weight = weightText === '' ? NaN : Number(weightText);
    if (!name || !Number.isFinite(weight)) { if (++blank >= BLANK_ROW_STOP) break; continue; }
    blank = 0;
    kinds.push({
      key: LOTTERY_KEY_MAP[name] || name,
      name,
      weight,
      artType: asText(at('美术方案类型（图标）')),
      artName: asText(at('美术方案名称（图标）'))
    });
  }
  return kinds;
}

// 读 data/weapons/*.json 建立「武器名 → 项目武器 id」映射。
// 武器表的「备注」列与武器设计 JSON 的 name 一致，但导出的编号是表格编号（"101"…），
// 与项目武器 id（"yellow"/"green"/"weapon-…"）不同，故导出时按名反查补上 weaponId。
export async function loadWeaponNameIndex(dir = path.join(ROOT, 'data', 'weapons')) {
  const map = new Map();
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter(f => f.toLowerCase().endsWith('.json'));
  } catch {
    return map; // 目录不存在（首次导出/打包环境）→ 全空映射，weaponId 留空串
  }
  for (const f of files) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      const name = String(raw?.name ?? '').trim();
      const id = String(raw?.id ?? '').trim();
      if (name && id && !map.has(name)) map.set(name, id);
    } catch {
      // 跳过损坏/非武器 JSON
    }
  }
  return map;
}

// 解析三张表并组装最终契约对象。
export async function buildInnerShop({ tablesDir, weaponsDir, now = Date.now() } = {}) {
  if (!tablesDir) throw new Error('buildInnerShop 需要 tablesDir 参数');
  const [consumables, weapons, kinds, weaponIndex] = await Promise.all([
    parseConsumables(tablesDir),
    parseWeapons(tablesDir),
    parseLottery(tablesDir),
    loadWeaponNameIndex(weaponsDir)
  ]);
  const weaponsWithId = weapons.map(w => ({
    id: w.id,
    weaponId: weaponIndex.get(String(w.name ?? '').trim()) || '',
    name: w.name,
    cost: w.cost,
    durationSec: w.durationSec,
    inLottery: w.inLottery
  }));
  return {
    generatedAt: now,
    consumables,
    weapons: weaponsWithId,
    lottery: { drawCost: DEFAULT_DRAW_COST, goldPrize: DEFAULT_GOLD_PRIZE, kinds }
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const tablesDir = process.env.TABLES_DIR || path.join(root, '策划文档', 'server');
  const outPath = path.join(root, 'data', 'inner-shop.json');
  try {
    const obj = await buildInnerShop({ tablesDir });
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(obj, null, 2));
    console.log(`消耗品 ${obj.consumables.length} 条 / 武器 ${obj.weapons.length} 条 / 老虎机 ${obj.lottery.kinds.length} 类`);
    console.log(`输出路径 ${outPath}`);
  } catch (e) {
    console.error(`[export-tables] ${e.message}`);
    process.exitCode = 1;
  }
}
