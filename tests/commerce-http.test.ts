import test from 'node:test';
import assert from 'node:assert/strict';
import type { McpGateway } from '../server/mcp/gateway.ts';
import { createSessionManager } from '../server/commerce/session.ts';
import { createCommerceApp } from '../server/commerce/app.ts';

const headers = { host: '127.0.0.1:8788', origin: 'http://127.0.0.1:5173' };
const root = '/api/commerce';
function fixture(options: { fail?: boolean; now?: () => number; slowStore?: Promise<void> } = {}) {
  let connects = 0; let calls = 0; let closed = 0;
  const gateway: McpGateway = { listTools: async () => [], close: async () => { closed++; }, call: async name => {
    calls++;
    if (name === 'query-nearby-stores') { await options.slowStore; return { data: [{ storeCode: '3330251', storeName: '本人门店', address: '本人地址' }] }; }
    if (name === 'query-meals') return { data: { categories: [{ name: '汉堡', meals: [{ code: 'burger' }] }], meals: { burger: { name: '汉堡', currentPrice: '10' } } } };
    if (name === 'list-nutrition-foods') return { data: '' };
    if (name === 'query-meal-detail') return { data: { code: 'burger', name: '汉堡', rounds: [] } };
    throw new Error('Bearer test-token private-account');
  } };
  const sessions = createSessionManager({ connect: async () => { connects++; if (options.fail) throw new Error('401 Bearer test-token private-account'); return gateway; }, now: options.now });
  const { app, requireSession } = createCommerceApp({ sessions, origin: 'http://127.0.0.1:8788', devOrigin: headers.origin, secureCookie: false });
  async function connect() {
    const response = await app.inject({ method: 'POST', url: `${root}/connect`, headers, payload: { token: 'test-token' } });
    assert.equal(response.statusCode, 200);
    return { response, cookie: String(response.headers['set-cookie']).split(';')[0] };
  }
  return { app, sessions, requireSession, connect, connects: () => connects, calls: () => calls, closed: () => closed };
}

test('connect returns only status and expiry with an HttpOnly Strict cookie; disconnect destroys transport', async () => {
  const f = fixture();
  try {
    const { response, cookie } = await f.connect();
    assert.deepEqual(Object.keys(response.json()).sort(), ['connected', 'expiresAt']);
    assert.equal(response.json().connected, true); assert.ok(Date.parse(response.json().expiresAt));
    assert.doesNotMatch(response.body, /test-token|Bearer|private-account|sessionId/);
    const id = cookie.split('=')[1]; assert.doesNotMatch(response.body, new RegExp(id));
    assert.match(String(response.headers['set-cookie']), /HttpOnly/); assert.match(String(response.headers['set-cookie']), /SameSite=Strict/);
    assert.equal(response.headers['cache-control'], 'no-store');
    const status = await f.app.inject({ method: 'GET', url: `${root}/session`, headers: { ...headers, cookie } });
    assert.deepEqual(status.json(), response.json());
    const stores = await f.app.inject({ method: 'GET', url: `${root}/stores?city=杭州&keyword=本人`, headers: { ...headers, cookie } });
    assert.equal(stores.statusCode, 200); assert.equal(stores.json()[0].name, '本人门店');
    const catalog = await f.app.inject({ method: 'GET', url: `${root}/catalog?storeId=3330251&diningMode=pickup`, headers: { ...headers, cookie } });
    assert.equal(catalog.statusCode, 200); assert.equal(catalog.json().items[0].name, '汉堡');
    const disconnected = await f.app.inject({ method: 'POST', url: `${root}/disconnect`, headers: { ...headers, cookie }, payload: {} });
    assert.equal(disconnected.statusCode, 200); assert.deepEqual(disconnected.json(), { connected: false, expiresAt: null });
    assert.match(String(disconnected.headers['set-cookie']), /Max-Age=0/); assert.equal(f.closed(), 1);
    assert.equal((await f.app.inject({ method: 'GET', url: `${root}/stores?city=杭州&keyword=本人`, headers: { ...headers, cookie } })).statusCode, 401);
  } finally { await f.app.close(); }
});

test('foreign origins, forged hosts and missing or duplicate cookies fail before protected calls', async () => {
  const f = fixture();
  try {
    for (const bad of [{ ...headers, origin: 'https://evil.invalid' }, { ...headers, host: 'evil.invalid:8788' }, { host: headers.host }, { ...headers, 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await f.app.inject({ method: 'POST', url: `${root}/connect`, headers: bad, payload: { token: 'test-token' } })).statusCode, 403);
    }
    assert.equal(f.connects(), 0);
    const { cookie } = await f.connect();
    for (const bad of [headers, { ...headers, cookie: 'mcd_commerce_session=invalid' }, { ...headers, cookie: `${cookie}; ${cookie}` }, { ...headers, cookie, origin: 'https://evil.invalid' }]) {
      const response = await f.app.inject({ method: 'GET', url: `${root}/stores?city=杭州&keyword=本人`, headers: bad });
      assert.ok([401, 403].includes(response.statusCode));
    }
    assert.equal(f.calls(), 0);
  } finally { await f.app.close(); }
});

test('strict schemas reject tokens in URL, unknown fields and invalid payloads before SDK calls', async () => {
  const f = fixture();
  try {
    for (const payload of [{ token: '' }, { token: '   ' }, { token: 'test-token', ownerToken: 'private' }, { token: 'x'.repeat(4097) }]) {
      assert.equal((await f.app.inject({ method: 'POST', url: `${root}/connect`, headers, payload })).statusCode, 400);
    }
    assert.equal((await f.app.inject({ method: 'POST', url: `${root}/connect?token=private`, headers, payload: { token: 'test-token' } })).statusCode, 400);
    assert.equal(f.connects(), 0);
    const { cookie } = await f.connect();
    for (const url of [`${root}/stores?city=杭州`, `${root}/stores?city=杭州&keyword=本人&token=private`, `${root}/catalog?storeId=3330251`, `${root}/catalog?storeId=3330251&diningMode=delivery`]) {
      assert.equal((await f.app.inject({ method: 'GET', url, headers: { ...headers, cookie } })).statusCode, 400);
    }
    assert.equal(f.calls(), 0);
    assert.equal((await f.app.inject({ method: 'POST', url: `${root}/mcp`, headers: { ...headers, cookie }, payload: { name: 'create-order' } })).statusCode, 404);
  } finally { await f.app.close(); }
});

test('failed authentication sets no cookie and never exposes token or upstream text', async () => {
  const f = fixture({ fail: true });
  try {
    const response = await f.app.inject({ method: 'POST', url: `${root}/connect`, headers, payload: { token: 'test-token' } });
    assert.equal(response.statusCode, 401); assert.equal(response.json().error.code, 'MCP_UNAUTHORIZED');
    assert.equal(response.headers['set-cookie'], undefined); assert.doesNotMatch(response.body, /test-token|Bearer|private-account/);
    assert.deepEqual((await f.app.inject({ method: 'GET', url: `${root}/session`, headers })).json(), { connected: false, expiresAt: null });
  } finally { await f.app.close(); }
});

test('connect and protected request rate limits reject before another SDK operation', async () => {
  const f = fixture({ fail: true });
  try {
    let limited = false;
    for (let i = 0; i < 20; i++) {
      const response = await f.app.inject({ method: 'POST', url: `${root}/connect`, headers, payload: { token: 'test-token' } });
      if (response.statusCode === 429) { const before = f.connects(); await f.app.inject({ method: 'POST', url: `${root}/connect`, headers, payload: { token: 'test-token' } }); assert.equal(f.connects(), before); limited = true; break; }
    }
    assert.ok(limited);
  } finally { await f.app.close(); }
  const protectedFixture = fixture();
  try {
    const { cookie } = await protectedFixture.connect(); let limited = false;
    for (let i = 0; i < 200; i++) {
      const response = await protectedFixture.app.inject({ method: 'GET', url: `${root}/stores?city=杭州&keyword=本人`, headers: { ...headers, cookie } });
      if (response.statusCode === 429) { const before = protectedFixture.calls(); await protectedFixture.app.inject({ method: 'GET', url: `${root}/stores?city=杭州&keyword=本人`, headers: { ...headers, cookie } }); assert.equal(protectedFixture.calls(), before); limited = true; break; }
    }
    assert.ok(limited);
  } finally { await protectedFixture.app.close(); }
});

test('late responses cannot return catalog or store data after the session expires', async () => {
  let now = 0; let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); const f = fixture({ now: () => now, slowStore: wait });
  try {
    const { cookie } = await f.connect();
    const pending = f.app.inject({ method: 'GET', url: `${root}/stores?city=杭州&keyword=本人`, headers: { ...headers, cookie } });
    while (f.calls() === 0) await new Promise(resolve => setImmediate(resolve));
    now = 30 * 60 * 1000; release(); const response = await pending;
    assert.equal(response.statusCode, 401); assert.doesNotMatch(response.body, /本人门店|本人地址/);
  } finally { release(); await f.app.close(); }
});

test('production requires HTTPS and Secure cookies while dev preflight only grants its exact origin', async () => {
  const sessions = createSessionManager({ connect: async () => { throw new Error('unexpected'); } });
  assert.throws(() => createCommerceApp({ sessions, origin: 'http://example.com', secureCookie: false }), /INVALID_PUBLIC_ORIGIN/);
  assert.throws(() => createCommerceApp({ sessions, origin: 'https://example.com', secureCookie: false }), /SECURE_COOKIE_REQUIRED/);
  const f = fixture();
  try {
    const allowed = await f.app.inject({ method: 'OPTIONS', url: `${root}/connect`, headers: { ...headers, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(allowed.statusCode, 204); assert.equal(allowed.headers['access-control-allow-origin'], headers.origin); assert.equal(allowed.headers['access-control-allow-credentials'], 'true');
    const rejected = await f.app.inject({ method: 'OPTIONS', url: `${root}/connect`, headers: { ...headers, origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    assert.equal(rejected.statusCode, 403); assert.equal(rejected.headers['access-control-allow-origin'], undefined);
  } finally { await f.app.close(); await sessions.close(); }
  const prodSessions = createSessionManager({ connect: async () => ({ listTools: async () => [], call: async () => ({}), close: async () => {} }) });
  const { app } = createCommerceApp({ sessions: prodSessions, origin: 'https://example.com', secureCookie: true });
  try {
    const response = await app.inject({ method: 'POST', url: `${root}/connect`, headers: { host: 'example.com', origin: 'https://example.com' }, payload: { token: 'test-token' } });
    assert.equal(response.statusCode, 200); assert.match(String(response.headers['set-cookie']), /Secure/);
    const status = await app.inject({ method: 'GET', url: `${root}/session`, headers: { host: 'example.com', cookie: String(response.headers['set-cookie']).split(';')[0] } });
    assert.equal(status.statusCode, 200); assert.equal(status.headers['access-control-allow-origin'], undefined); assert.equal(status.headers['access-control-allow-credentials'], undefined);
  } finally { await app.close(); }
});

test('same-origin GET can omit Origin while a connected session still guards upstream errors', async () => {
  const f = fixture();
  f.app.get(`${root}/private-failure`, async request => { const user = f.requireSession(request); return (await user.gateway()).call('private-failure', {}); });
  try {
    const { cookie } = await f.connect();
    const response = await f.app.inject({ method: 'GET', url: `${root}/stores?city=杭州&keyword=本人`, headers: { host: headers.host, cookie } });
    assert.equal(response.statusCode, 200);
    const failed = await f.app.inject({ method: 'GET', url: `${root}/private-failure`, headers: { host: headers.host, cookie } });
    assert.equal(failed.statusCode, 502); assert.equal(failed.json().error.code, 'UPSTREAM_FAILED'); assert.doesNotMatch(failed.body, /test-token|Bearer|private-account/);
  } finally { await f.app.close(); }
});

for (const encodedRoot of ['/api/%63ommerce', '/%61pi/commerce']) {
  test(`encoded connect path ${encodedRoot} shares the canonical pre-SDK rate limit`, async () => {
    const f = fixture({ fail: true });
    try {
      for (let i = 0; i < 10; i++) {
        const prefix = i % 2 === 0 ? root : encodedRoot;
        const response = await f.app.inject({ method: 'POST', url: `${prefix}/connect`, headers, payload: { token: 'test-token' } });
        assert.equal(response.statusCode, 401);
      }
      assert.equal(f.connects(), 10);
      for (const prefix of [encodedRoot, root]) {
        const response = await f.app.inject({ method: 'POST', url: `${prefix}/connect`, headers, payload: { token: 'test-token' } });
        assert.equal(response.statusCode, 429);
        assert.equal(response.json().error.code, 'REQUEST_RATE_LIMITED');
        assert.equal(f.connects(), 10);
      }
    } finally { await f.app.close(); }
  });

  test(`encoded protected path ${encodedRoot} shares the canonical session rate limit`, async () => {
    const f = fixture();
    try {
      const { cookie } = await f.connect();
      for (let i = 0; i < 120; i++) {
        const prefix = i % 2 === 0 ? root : encodedRoot;
        const response = await f.app.inject({ method: 'GET', url: `${prefix}/stores?city=杭州&keyword=本人`, headers: { ...headers, cookie } });
        assert.equal(response.statusCode, 200);
      }
      assert.equal(f.calls(), 120);
      for (const url of [`${encodedRoot}/stores?city=杭州&keyword=本人`, `${encodedRoot}/catalog?storeId=3330251&diningMode=pickup`, `${root}/stores?city=杭州&keyword=本人`]) {
        const response = await f.app.inject({ method: 'GET', url, headers: { ...headers, cookie } });
        assert.equal(response.statusCode, 429);
        assert.equal(response.json().error.code, 'REQUEST_RATE_LIMITED');
        assert.equal(f.calls(), 120);
      }
      const anonymous = await f.app.inject({ method: 'GET', url: `${encodedRoot}/stores?city=杭州&keyword=本人`, headers });
      assert.equal(anonymous.statusCode, 401);
      assert.equal(f.calls(), 120);
    } finally { await f.app.close(); }
  });
}
