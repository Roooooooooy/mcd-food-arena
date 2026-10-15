import test from 'node:test';
import assert from 'node:assert/strict';
import type { McpGateway } from '../server/mcp/gateway.ts';
import { guardGateway, READ_TOOLS } from '../server/mcp/gateway.ts';
import { createSessionManager } from '../server/commerce/session.ts';

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function external() {
  let closed = 0;
  const gateway: McpGateway = {
    listTools: async () => [], close: async () => { closed++; },
    call: async (name, args) => {
      if (name === 'query-nearby-stores') return { data: [{ storeCode: 'private-store', storeName: '本人门店', address: '本人地址' }] };
      if (name === 'query-meals') return { data: { categories: [{ name: '汉堡', meals: [{ code: 'burger' }] }], meals: { burger: { name: '汉堡', currentPrice: '10' } } } };
      if (name === 'list-nutrition-foods') return { data: '' };
      if (name === 'query-meal-detail') return { data: { code: args.code, name: '汉堡', rounds: [] } };
      throw new Error('unexpected external operation');
    },
  };
  return { gateway, closed: () => closed };
}

test('personal sessions own different SDK connections and caches even for identical catalog hashes', async () => {
  const one = external(); const two = external(); const sources = [one, two];
  const manager = createSessionManager({ connect: async () => sources.shift()!.gateway });
  try {
    const first = await manager.connect('test-token-one'); const second = await manager.connect('test-token-two');
    assert.notEqual(first.id, second.id); assert.match(first.id, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(first), /test-token|Bearer/);
    const input = { storeId: '3330251', diningMode: 'pickup' };
    const a = await first.catalog.loadCatalog(input); const b = await second.catalog.loadCatalog(input);
    assert.equal(a.contextKey, b.contextKey);
    assert.notEqual(first.catalog.getContext(a.contextKey), second.catalog.getContext(b.contextKey));
    await first.catalog.searchStores({ city: '杭州', keyword: '本人' });
    await assert.rejects(second.catalog.loadCatalog({ storeId: 'private-store', diningMode: 'pickup' }), /STORE_NOT_VERIFIED/);
    await manager.disconnect(first.id);
    assert.equal(manager.get(first.id), undefined); assert.equal(one.closed(), 1); assert.ok(manager.get(second.id));
    await assert.rejects(first.gateway(), /SESSION_REQUIRED/);
  } finally { await manager.close(); }
  assert.equal(two.closed(), 1);
});

test('expired sessions reject access and close the expired transport once', async () => {
  let now = 1000; const f = external();
  const manager = createSessionManager({ connect: async () => f.gateway, now: () => now, ttlMs: 10 });
  const user = await manager.connect('test-token'); now = 1010;
  assert.throws(() => user.assertActive(), /SESSION_REQUIRED/);
  assert.equal(manager.get(user.id), undefined);
  await manager.disconnect(user.id); await manager.close(); assert.equal(f.closed(), 1);
});

test('64 pending connects consume slots before SDK success; failed connects release their reservations', async () => {
  const waits: ReturnType<typeof deferred<McpGateway>>[] = [];
  const manager = createSessionManager({ connect: () => { const wait = deferred<McpGateway>(); waits.push(wait); return wait.promise; } });
  const pending = Array.from({ length: 64 }, () => manager.connect('test-token'));
  const firstFailure = assert.rejects(pending[0], /MCP_UNAVAILABLE/);
  await assert.rejects(manager.connect('overflow-token'), /SESSION_CAPACITY/);
  assert.equal(waits.length, 64);
  waits[0].reject(new Error('private upstream detail test-token')); await firstFailure;
  const replacement = manager.connect('replacement-token'); assert.equal(waits.length, 65);
  waits.slice(1).forEach(wait => wait.resolve(external().gateway));
  await Promise.all([...pending.slice(1), replacement]); await manager.close();
});

test('closing while SDK connect is pending cannot resurrect a session and closes the late gateway', async () => {
  const wait = deferred<McpGateway>(); const f = external();
  const manager = createSessionManager({ connect: () => wait.promise });
  const pending = manager.connect('test-token'); const rejected = assert.rejects(pending, /SESSION_REQUIRED/);
  await manager.close(); wait.resolve(f.gateway); await rejected;
  assert.equal(f.closed(), 1); await assert.rejects(manager.connect('test-token'), /SESSION_REQUIRED/);
});

test('connect timeout releases capacity and closes a transport that arrives after timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wait = deferred<McpGateway>(); const f = external(); let attempts = 0;
  const manager = createSessionManager({ maxSessions: 1, connect: () => attempts++ === 0 ? wait.promise : Promise.resolve(external().gateway) });
  const pending = manager.connect('test-token'); const rejected = assert.rejects(pending, /MCP_TIMEOUT/);
  t.mock.timers.tick(15_000); await rejected;
  const user = await manager.connect('replacement-token'); assert.ok(manager.get(user.id));
  wait.resolve(f.gateway); await Promise.resolve(); await Promise.resolve(); assert.equal(f.closed(), 1);
  await manager.close();
});

test('expired sessions are cleaned up by a timer even without another request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let now = 0; const f = external();
  const manager = createSessionManager({ connect: async () => f.gateway, ttlMs: 20, now: () => now });
  await manager.connect('test-token'); now = 20; t.mock.timers.tick(20);
  await Promise.resolve(); assert.equal(f.closed(), 1); await manager.close();
});

test('commerce opt-in preserves read defaults and denies payment, binding and unrelated account tools', async () => {
  let calls = 0;
  const names = [...READ_TOOLS, 'query-my-coupons', 'query-store-coupons', 'create-order', 'query-order', 'pay', 'auto-bind-coupons', 'order-list', 'cancel-order'];
  const raw: McpGateway = { listTools: async () => names.map(name => ({ name, inputSchema: { type: 'object', additionalProperties: false } })), call: async () => { calls++; return { success: true, data: {} }; }, close: async () => {} };
  const defaults = guardGateway(raw);
  await assert.rejects(defaults.call('query-my-coupons', {}), /TOOL_NOT_ALLOWED/);
  const commerce = guardGateway(raw, { allowedTools: [...READ_TOOLS, 'query-my-coupons', 'query-store-coupons', 'create-order', 'query-order'] });
  assert.equal((await commerce.call('query-my-coupons', {}) as { success: boolean }).success, true);
  for (const name of ['pay', 'auto-bind-coupons', 'order-list', 'cancel-order']) await assert.rejects(commerce.call(name, {}), /TOOL_NOT_ALLOWED/);
  assert.equal(calls, 1);
});

test('a retained gateway cannot finish a user operation after disconnect', async () => {
  const wait = deferred<unknown>(); let calls = 0;
  const manager = createSessionManager({ connect: async () => ({ listTools: async () => [], close: async () => {}, call: async () => { calls++; return wait.promise; } }) });
  const user = await manager.connect('test-token'); const gateway = await user.gateway();
  const pending = gateway.call('query-nearby-stores', {}); const rejected = assert.rejects(pending, /SESSION_REQUIRED/);
  await manager.disconnect(user.id); wait.resolve({ data: 'private result' }); await rejected;
  await assert.rejects(gateway.call('query-nearby-stores', {}), /SESSION_REQUIRED/); assert.equal(calls, 1); await manager.close();
});

test('transport cleanup remains bounded when close never settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = createSessionManager({ connect: async () => ({ listTools: async () => [], call: async () => ({}), close: async () => new Promise<void>(() => {}) }) });
  const user = await manager.connect('test-token'); const closing = manager.disconnect(user.id);
  t.mock.timers.tick(15_000); await closing; assert.equal(manager.get(user.id), undefined); await manager.close();
});
