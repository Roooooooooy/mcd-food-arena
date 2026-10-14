import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/demo/menu.ts';
import { createArena } from '../src/arena/engine.ts';

test('合成菜单覆盖八个可独立守擂的赛区，每区 4–6 个餐品', () => {
  const catalog = demoCatalog();
  const stageIds = ['burger', 'chicken', 'side', 'drink', 'coffee', 'dessert', 'pie', 'breakfast'];
  assert.deepEqual([...new Set(catalog.items.map(item => item.stageId))].sort(), [...stageIds].sort());
  for (const stageId of stageIds) {
    const items = catalog.items.filter(item => item.stageId === stageId);
    assert.ok(items.length >= 4 && items.length <= 6, `${stageId} 候选数量`);
    const state = createArena(items.map(item => item.id), `demo-run-${stageId}`, stageId);
    assert.equal(state.status, 'active');
    assert.equal(state.orderedIds.length, items.length);
  }
});

test('所有餐品是独立稳定的 demo 身份，参考价格和营养均无官方身份', () => {
  const catalog = demoCatalog();
  assert.ok(catalog.items.length > 0);
  assert.equal(catalog.mode, 'demo');
  assert.equal(catalog.store, null);
  assert.equal(catalog.complete, true);
  assert.ok(catalog.contextKey.startsWith('demo:'));
  assert.ok(Number.isFinite(Date.parse(catalog.loadedAt)));
  assert.equal(new Set(catalog.items.map(item => item.id)).size, catalog.items.length);
  for (const item of catalog.items) {
    assert.ok(item.id.startsWith('demo:'));
    assert.equal(item.mode, 'demo');
    assert.equal(item.officialCode, null);
    assert.equal(item.imageUrl, null);
    assert.ok(item.name.length > 0);
    assert.ok(item.sourceCategory.length > 0);
    if (item.referencePriceCents !== null) {
      assert.ok(Number.isInteger(item.referencePriceCents) && item.referencePriceCents > 0);
    }
    for (const value of Object.values(item.nutrition)) {
      assert.ok(Number.isFinite(value) && value >= 0);
    }
  }
  assert.deepEqual(demoCatalog(), catalog);
});

test('样例保留至少一款未知价格与未知营养，不猜测为零', () => {
  const catalog = demoCatalog();
  const unknown = catalog.items.find(item => item.referencePriceCents === null && Object.keys(item.nutrition).length === 0);
  assert.ok(unknown);
  assert.ok(catalog.items.some(item => item.referencePriceCents !== null));
  assert.ok(catalog.items.some(item => Object.keys(item.nutrition).length > 0));
});

test('调用方修改样例菜单不会污染下一次读取', () => {
  const first = demoCatalog();
  const original = structuredClone(first);
  assert.ok(first.items.length > 0);
  first.items[0].name = '已修改';
  first.items[0].attributes.length = 0;
  first.items[0].nutrition.kcal = -1;
  first.items.reverse();
  assert.deepEqual(demoCatalog(), original);
});
