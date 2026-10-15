import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCommerceConfig } from '../server/commerce/config.ts';
import { createCommerceRuntime, startCommerceServer } from '../server/commerce/main.ts';

test('environment defaults stay loopback while an explicit Render config trusts only the published HTTPS origin', () => {
  assert.deepEqual(readCommerceConfig({}), { host: '127.0.0.1', port: 8788, origin: 'http://127.0.0.1:8788', secureCookie: false });
  assert.deepEqual(readCommerceConfig({ PORT: '10000', HOST: '0.0.0.0', RENDER_EXTERNAL_URL: 'https://meal.onrender.com' }), { host: '0.0.0.0', port: 10000, origin: 'https://meal.onrender.com', secureCookie: true });
  assert.equal(readCommerceConfig({ PORT: '8989' }).origin, 'http://127.0.0.1:8989');
  assert.equal(readCommerceConfig({ HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://custom.example', RENDER_EXTERNAL_URL: 'https://meal.onrender.com' }).origin, 'https://custom.example');
});

test('invalid port, host and noncanonical or insecure public origins fail before binding', () => {
  for (const PORT of ['', '0', '65536', '8788x', '-1', '1.5', ' 10000', '010000']) assert.throws(() => readCommerceConfig({ PORT }), /INVALID_PORT/);
  for (const HOST of ['', 'localhost', '192.168.1.1', '::', '0.0.0.0 ']) assert.throws(() => readCommerceConfig({ HOST }), /INVALID_HOST/);
  for (const PUBLIC_ORIGIN of ['', 'http://remote.example', 'https://remote.example/', 'https://user:secret@remote.example', 'https://remote.example/path', 'https://remote.example?x=1', 'https://remote.example#hash', 'https://REMOTE.example', 'https://remote.example:443', 'ftp://remote.example']) assert.throws(() => readCommerceConfig({ PUBLIC_ORIGIN }), /INVALID_PUBLIC_ORIGIN/);
  for (const env of [{ HOST: '0.0.0.0' }, { HOST: '0.0.0.0', PUBLIC_ORIGIN: 'http://127.0.0.1:8788' }, { HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://localhost' }, { RENDER_EXTERNAL_URL: 'http://localhost:10000' }]) assert.throws(() => readCommerceConfig(env), /PUBLIC_ORIGIN/);
});

async function fixture(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'commerce-deployment-'));
  const dist = join(dir, 'dist'); await mkdir(join(dist, 'assets'), { recursive: true }); await mkdir(join(dist, '.private'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>PUBLIC_APP</title>');
  await writeFile(join(dist, 'assets', 'app-a1b2c3.js'), 'console.log("public asset")');
  await writeFile(join(dir, 'private.json'), '{"token":"PRIVATE_TOKEN_SENTINEL"}');
  await writeFile(join(dist, '.env.local'), 'PRIVATE_TOKEN_SENTINEL');
  await writeFile(join(dist, '.private', 'account.json'), 'PRIVATE_TOKEN_SENTINEL');
  await symlink(join(dir, 'private.json'), join(dist, 'leak.json'));
  await symlink(dir, join(dist, 'escape'));
  let connects = 0;
  const runtime = createCommerceRuntime({ origin: 'https://meal.example', staticDir: dist, connect: async () => { connects++; throw new Error('unexpected external operation'); } } as Parameters<typeof createCommerceRuntime>[0]);
  t.after(async () => { await runtime.app.close(); await rm(dir, { recursive: true, force: true }); });
  return { ...runtime, dist, connects: () => connects, headers: { host: 'meal.example' } };
}

test('one runtime serves built HTML/assets and a host-independent health probe without account or MCP data', async t => {
  const f = await fixture(t);
  const html = await f.app.inject({ url: '/', headers: f.headers });
  assert.equal(html.statusCode, 200); assert.match(html.body, /PUBLIC_APP/); assert.match(String(html.headers['content-type']), /text\/html/); assert.equal(html.headers['cache-control'], 'no-store');
  assert.equal(html.headers['x-content-type-options'], 'nosniff'); assert.equal(html.headers['referrer-policy'], 'no-referrer');
  const asset = await f.app.inject({ url: '/assets/app-a1b2c3.js', headers: f.headers });
  assert.equal(asset.statusCode, 200); assert.match(asset.body, /public asset/); assert.match(String(asset.headers['content-type']), /javascript/); assert.match(String(asset.headers['cache-control']), /public.*immutable/);
  const head = await f.app.inject({ method: 'HEAD', url: '/assets/app-a1b2c3.js', headers: f.headers }); assert.equal(head.statusCode, 200); assert.equal(head.body, '');
  for (const method of ['GET', 'HEAD'] as const) {
    const health = await f.app.inject({ method, url: '/healthz', headers: { host: '127.0.0.1:10000', origin: 'https://probe.example', 'sec-fetch-site': 'cross-site' } });
    assert.equal(health.statusCode, 200); assert.equal(health.headers['cache-control'], 'no-store'); assert.equal(health.headers['set-cookie'], undefined);
    if (method === 'GET') assert.deepEqual(health.json(), { status: 'ok' }); else assert.equal(health.body, '');
  }
  assert.equal(f.connects(), 0);
});

test('HTML fallback is limited to document navigation and unknown API/assets never become the app shell', async t => {
  const f = await fixture(t); const navigation = { ...f.headers, accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  assert.equal((await f.app.inject({ url: '/pick-a-meal', headers: navigation })).statusCode, 200);
  for (const url of ['/api', '/api/not-real', '/api/commerce/not-real', '/%61pi/commerce/not-real', '/assets/missing.js', '/demo/missing']) {
    const response = await f.app.inject({ url, headers: navigation }); assert.equal(response.statusCode, 404, url); assert.equal(response.json().error.code, 'NOT_FOUND'); assert.doesNotMatch(response.body, /PUBLIC_APP/);
  }
  for (const headers of [f.headers, { ...f.headers, accept: 'application/json' }, { ...navigation, 'sec-fetch-mode': 'cors' }]) assert.equal((await f.app.inject({ url: '/pick-a-meal', headers })).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'POST', url: '/pick-a-meal', headers: { ...navigation, origin: 'https://meal.example' }, payload: {} })).statusCode, 404);
});

test('encoded or repeated separators cannot turn missing API or demo resources into HTML navigation', async t => {
  const f = await fixture(t);
  const navigation = { ...f.headers, accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
  for (const url of ['/%2fapi/commerce/not-real', '//api/commerce/not-real', '/%2fdemo/missing', '//demo/missing', '/demo//missing', '/demo/%2fmissing', '/pick//a-meal', '/api%2fcommerce%2fnot-real']) {
    for (const method of ['GET', 'HEAD'] as const) {
      const response = await f.app.inject({ method, url, headers: navigation });
      assert.equal(response.statusCode, 404, `${method} ${url}`);
      assert.match(String(response.headers['content-type']), /application\/json/);
      assert.doesNotMatch(response.body, /PUBLIC_APP/);
      if (method === 'GET') assert.equal(response.json().error.code, 'NOT_FOUND'); else assert.equal(response.body, '');
    }
  }
  assert.equal(f.connects(), 0);
});

test('traversal, dotfiles and symlinks cannot expose private files through GET or HEAD', async t => {
  const f = await fixture(t);
  for (const url of ['/../private.json', '/%2e%2e/private.json', '/assets/%2e%2e/%2e%2e/private.json', '/%252e%252e/private.json', '/%2eenv.local', '/.private/account.json', '/leak.json', '/escape/private.json', '/assets%5c..%5cprivate.json', '/%00private.json']) {
    for (const method of ['GET', 'HEAD'] as const) {
      const response = await f.app.inject({ method, url, headers: { ...f.headers, accept: 'text/html', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
      assert.equal(response.statusCode, 404, `${method} ${url}`); assert.doesNotMatch(response.body, /PRIVATE_TOKEN_SENTINEL|PUBLIC_APP/);
    }
  }
});

test('static serving preserves origin guards and encoded health paths cannot widen the health exemption', async t => {
  const f = await fixture(t);
  for (const url of ['/', '/assets/app-a1b2c3.js', '/healthz/anything', '/%68ealthz/../api/commerce/session', '/%61pi/commerce/session']) {
    const response = await f.app.inject({ url, headers: { host: 'attacker.example' } }); assert.equal(response.statusCode, 403, url);
  }
  const foreign = await f.app.inject({ url: '/', headers: { ...f.headers, origin: 'https://attacker.example' } }); assert.equal(foreign.statusCode, 403);
  const session = await f.app.inject({ url: '/api/commerce/session', headers: f.headers }); assert.equal(session.statusCode, 200); assert.deepEqual(session.json(), { connected: false, expiresAt: null }); assert.equal(session.headers['cache-control'], 'no-store');
});

test('start uses the provided listener options and fails closed when the build directory is missing', async t => {
  const f = await fixture(t);
  const running = await startCommerceServer({ port: 0, host: '127.0.0.1', staticDir: f.dist, connect: async () => { throw new Error('unexpected'); } } as Parameters<typeof startCommerceServer>[0]);
  t.after(() => running.app.close()); const address = running.app.server.address(); assert.ok(address && typeof address === 'object'); assert.equal(address.address, '127.0.0.1'); assert.ok(address.port > 0);
  await assert.rejects(startCommerceServer({ port: 0, staticDir: join(f.dist, 'missing') } as Parameters<typeof startCommerceServer>[0]), /COMMERCE_BUILD_MISSING/);
});
