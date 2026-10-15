import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogService } from '../server/mcp/catalog.ts';
import type { McpGateway } from '../server/mcp/gateway.ts';
import { choose, getMatch } from '../src/arena/engine.ts';
import { restoreSession, serializeSession, startSession } from '../src/setup/session.ts';

function upstream() {
  const menu = {
    categories: [{ name: '汉堡', meals: [{ code: 'a' }, { code: 'b' }] }, { name: '饮品', meals: [{ code: 'cola' }] }],
    meals: { a: { name: '芝士牛肉堡', currentPrice: '20' }, b: { name: '鸡腿堡', currentPrice: '18' }, cola: { name: '可乐', currentPrice: '10' } },
    traceId: 'first-request', loadedAt: 'upstream-first', credential: 'synthetic-private-marker',
  };
  const detail = { code: 'cola', name: '可乐', rounds: [{ id: 1, quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [
    { code: 'small', name: '可乐小杯', diffPrice: '+ ¥0' }, { code: 'large', name: '可乐大杯', diffPrice: '+ ¥2' },
  ] }] };
  let nutrition = '[1]{productName,energyKcal}:\n芝士牛肉堡,300';
  const g: McpGateway = {
    listTools: async () => [], close: async () => {},
    call: async (name, args) => {
      if (name === 'query-meals') return { data: menu, traceId: menu.traceId };
      if (name === 'list-nutrition-foods') return { data: nutrition };
      if (name === 'query-meal-detail') return { data: detail };
      if (name === 'query-nearby-stores') return { data: [{ storeCode: 'another', storeName: '另一测试门店', address: '测试地址' }] };
      throw new Error(`Unexpected read ${name}: ${String(args.code)}`);
    },
  };
  return { g, menu, detail, nutrition: (value: string) => { nutrition = value; } };
}
const selection = [{ id: 'burger', candidateIds: ['live:sku:a', 'live:sku:b'] }];
const input = { storeId: '3330251', diningMode: 'pickup' };

test('identical live semantic content restores a paused game across reloads and a fresh service', async () => {
  const f = upstream(); const service = createCatalogService(f.g);
  const first = await service.loadCatalog(input);
  const [initial] = startSession(first, selection);
  const paused = choose(initial, getMatch(initial)!.leftId === 'live:sku:b' ? 'left' : 'right', initial.revision);
  const saved = serializeSession(first, [paused], 0);
  await new Promise(resolve => setTimeout(resolve, 3));
  f.menu.traceId = 'second-request'; f.menu.loadedAt = 'upstream-second'; f.menu.credential = 'different-private-marker';
  const second = await service.loadCatalog(input);
  assert.equal(second.contextKey, first.contextKey);
  assert.notEqual(second.loadedAt, first.loadedAt);
  assert.equal(service.getContext(first.contextKey)?.snapshot, second);
  const restarted = await createCatalogService(f.g).loadCatalog(input);
  assert.equal(restarted.contextKey, first.contextKey);
  const restored = restoreSession(restarted, saved);
  assert.equal(restored.arenas[0].championId, 'live:sku:b');
  assert.equal(restored.arenas[0].history.length, 1);
  assert.equal(getMatch(restored.arenas[0]), null);
  assert.notEqual(restored.arenas[0].arenaId, paused.arenaId);
  assert.equal(second.contextKey.includes('private-marker'), false);
});

for (const [name, mutate] of [
  ['price', (f: ReturnType<typeof upstream>) => { f.menu.meals.a.currentPrice = '21'; }],
  ['meal identity', (f: ReturnType<typeof upstream>) => { f.menu.categories[0].meals[0].code = 'replacement'; (f.menu.meals as Record<string, unknown>).replacement = f.menu.meals.a; delete (f.menu.meals as Record<string, unknown>).a; }],
  ['variant identity', (f: ReturnType<typeof upstream>) => { f.detail.rounds[0].choices[1].code = 'new-large'; }],
  ['variant price', (f: ReturnType<typeof upstream>) => { f.detail.rounds[0].choices[1].diffPrice = '+ ¥3'; }],
  ['classification', (f: ReturnType<typeof upstream>) => { f.menu.categories[0].name = '早餐'; }],
  ['nutrition', (f: ReturnType<typeof upstream>) => { f.nutrition('[1]{productName,energyKcal}:\n芝士牛肉堡,301'); }],
] as const) {
  test(`changed ${name} invalidates the old saved game`, async () => {
    const f = upstream(); const service = createCatalogService(f.g); const first = await service.loadCatalog(input);
    const saved = serializeSession(first, startSession(first, selection), 0);
    mutate(f); const changed = await service.loadCatalog(input);
    assert.notEqual(changed.contextKey, first.contextKey);
    assert.throws(() => restoreSession(changed, saved));
  });
}

test('store identity separates saved games and unsupported channels stay rejected', async () => {
  const f = upstream(); const service = createCatalogService(f.g); const first = await service.loadCatalog(input);
  const saved = serializeSession(first, startSession(first, selection), 0);
  await service.searchStores({ city: '杭州', keyword: '测试' });
  const another = await service.loadCatalog({ ...input, storeId: 'another' });
  assert.notEqual(another.contextKey, first.contextKey);
  assert.throws(() => restoreSession(another, saved));
  await assert.rejects(service.loadCatalog({ ...input, diningMode: 'delivery' }), /UNSUPPORTED_DINING_MODE/);
});

test('matching content does not bypass saved candidate or decision validation', async () => {
  const service = createCatalogService(upstream().g); const first = await service.loadCatalog(input);
  const saved = JSON.parse(serializeSession(first, startSession(first, selection), 0));
  const second = await service.loadCatalog(input);
  saved.stages[0].candidateIds = ['live:sku:missing'];
  assert.throws(() => restoreSession(second, JSON.stringify(saved)));
  saved.stages[0].candidateIds = selection[0].candidateIds; saved.stages[0].decisions = ['right', 'left'];
  assert.throws(() => restoreSession(second, JSON.stringify(saved)));
});

test('distinct semantic contexts remain bounded and expired keys are unusable', async () => {
  const f = upstream(); const service = createCatalogService(f.g); const first = await service.loadCatalog(input);
  let latest = first;
  for (let price = 21; price <= 40; price++) { f.menu.meals.a.currentPrice = String(price); latest = await service.loadCatalog(input); }
  assert.equal(service.getContext(first.contextKey), undefined);
  assert.ok(service.getContext(latest.contextKey));
  await assert.rejects(service.getDetail(first.contextKey, 'a'), /CATALOG_CONTEXT_MISSING/);
});
