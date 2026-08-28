import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayer } from '../src/player-data.js';

// 玩家存档 API 集成测试（需 dev 服务器已运行）
// 运行：npm run dev 后，另开终端执行 node --test test/player-api.test.js

const BASE = process.env.TEST_API_BASE || 'http://localhost:5173/api';
const TEST_ID = '__test_save__';

async function api(method, path, value) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {})
  });
  if (res.status >= 400) {
    const text = await res.text();
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

async function cleanup() {
  await api('DELETE', `/players/${TEST_ID}`);
}

test('保存新存档 → 读回数据一致（round-trip）', async () => {
  await cleanup();
  const sample = normalizePlayer({
    meta: { name: '测试档', playTimeSec: 60 },
    progress: { level: 5, exp: 200, expToNext: 500, points: 2 },
    currency: { gold: 888 },
    weapons: { radial: { unlocked: true, enhance: [1, 1, 0] }, yellow: { unlocked: true, enhance: [0, 0, 1] } },
    mods: [{ id: 'triple', weapon: '' }],
    modInventory: ['ricochet'],
    playedNewbee: true,
    combat: { maxHp: 140, attackPower: 1.3 },
    levels: { unlocked: ['level-1', 'level-2'], completed: ['level-1'], current: 'level-2' }
  });

  const saved = await api('POST', `/players/${TEST_ID}`, sample);
  assert.equal(saved.ok, true, '保存应返回 ok');

  const loaded = await api('GET', `/players/${TEST_ID}`);
  assert.equal(loaded.meta.name, '测试档');
  assert.equal(loaded.progress.level, 5);
  assert.equal(loaded.currency.gold, 888);
  assert.equal(loaded.weapons.yellow.unlocked, true);
  assert.deepEqual(loaded.weapons.radial.enhance, [1, 1, 0]);
  assert.deepEqual(loaded.mods, [{ id: 'triple', weapon: '' }]);
  assert.deepEqual(loaded.levels.completed, ['level-1']);
});

test('更新已有存档 → 内容变化且槽位不重复', async () => {
  const before = await api('GET', `/players/${TEST_ID}`);
  const updated = { ...before, currency: { ...before.currency, gold: before.currency.gold + 100 } };
  await api('POST', `/players/${TEST_ID}`, updated);

  const after = await api('GET', `/players/${TEST_ID}`);
  assert.equal(after.currency.gold, before.currency.gold + 100, '金币应 +100');

  const { slots } = await api('GET', '/players');
  assert.equal(slots.filter(s => s === TEST_ID).length, 1, '槽位不应重复');
});

test('meta 列表返回最新快照信息', async () => {
  const { metas } = await api('GET', '/players');
  assert.ok(metas[TEST_ID], '列表 meta 应包含测试档');
  assert.equal(metas[TEST_ID].level, 5);
  assert.equal(metas[TEST_ID].name, '测试档');
});

test('删除存档 → 文件与槽位均移除', async () => {
  await api('DELETE', `/players/${TEST_ID}`);
  const { slots } = await api('GET', '/players');
  assert.ok(!slots.includes(TEST_ID), '槽位应已移除');

  let notFound = false;
  try {
    await api('GET', `/players/${TEST_ID}`);
  } catch (e) {
    notFound = /404/.test(e.message);
  }
  assert.ok(notFound, '读取已删除存档应 404');
});

test.after(async () => {
  await cleanup();
});
