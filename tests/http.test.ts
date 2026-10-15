import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.ts';
import { demoCatalog } from '../src/demo/menu.ts';

const headers = { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:5173' };
const quoteRequest = { contextKey: demoCatalog().contextKey, basket: [{ candidateId: demoCatalog().items[0].id, quantity: 1, optionIds: [] }], cartRevision: 0 };
function fixture() {
  let calls = 0;
  const app = createApp({ stores: async () => { calls++; return []; }, catalog: async () => { calls++; return demoCatalog(); }, quote: async () => { calls++; throw new Error('Bearer confidential-token private-account'); } });
  return { app, calls: () => calls };
}

test('native HTTP rejects cross-site origin, forged host and cross-site metadata before services', async () => {
  const f = fixture();
  for (const requestHeaders of [{ ...headers, origin: 'https://example.invalid' }, { ...headers, host: 'evil.invalid:8787' }, { ...headers, 'sec-fetch-site': 'cross-site' }, { host: headers.host }]) {
    const res = await f.app.inject({ method: 'POST', url: '/api/quote', headers: requestHeaders, payload: quoteRequest });
    assert.equal(res.statusCode, 403);
  }
  assert.equal(f.calls(), 0);
  await f.app.close();
});

test('only normalized API routes exist, with bounded payloads and strict schemas', async () => {
  const f = fixture();
  for (const payload of [{ ...quoteRequest, token: 'untrusted' }, { ...quoteRequest, basket: [{ ...quoteRequest.basket[0], quantity: 0 }] }, { ...quoteRequest, basket: [] }, { ...quoteRequest, cartRevision: -1 }]) {
    const res = await f.app.inject({ method: 'POST', url: '/api/quote', headers, payload });
    assert.equal(res.statusCode, 400);
  }
  const oversized = await f.app.inject({ method: 'POST', url: '/api/quote', headers, payload: { ...quoteRequest, contextKey: 'x'.repeat(70_000) } });
  assert.equal(oversized.statusCode, 413);
  const arbitrary = await f.app.inject({ method: 'POST', url: '/api/mcp', headers, payload: { name: 'create-order' } });
  assert.equal(arbitrary.statusCode, 404);
  assert.equal(f.calls(), 0);
  await f.app.close();
});

test('valid local request reaches service and errors are sanitized', async () => {
  const f = fixture();
  const res = await f.app.inject({ method: 'POST', url: '/api/quote', headers, payload: quoteRequest });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: { code: 'UPSTREAM_FAILED', message: '服务暂时不可用，请稍后重试。' } });
  assert.doesNotMatch(res.body, /confidential|Bearer|private-account/);
  assert.equal(f.calls(), 1);
  const stores = await f.app.inject({ method: 'GET', url: '/api/stores?city=杭州&keyword=凤起路', headers });
  assert.equal(stores.statusCode, 200);
  assert.deepEqual(stores.json(), []);
  await f.app.close();
});

test('native TCP requests enforce loopback Host and Origin before quote service', async () => {
  const { request } = await import('node:http');
  const f = fixture();
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  async function post(requestHeaders: Record<string, string>) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/quote', method: 'POST', headers: { ...requestHeaders, 'content-type': 'application/json' } }, res => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end(JSON.stringify(quoteRequest));
    });
  }
  try {
    assert.equal((await post({ ...headers, host: 'attacker.invalid:8787' })).status, 403);
    assert.equal((await post({ ...headers, origin: 'https://attacker.invalid' })).status, 403);
    assert.equal(f.calls(), 0);
    const local = await post(headers);
    assert.equal(local.status, 502);
    assert.doesNotMatch(local.body, /confidential|Bearer|private-account/);
    assert.equal(f.calls(), 1);
  } finally { await f.app.close(); }
});

test('catalog and store query inputs are validated and forwarded without hidden defaults', async () => {
  let captured: unknown;
  const app = createApp({ stores: async input => { captured = input; return []; }, catalog: async input => { captured = input; return demoCatalog(); }, quote: async () => { throw new Error('unexpected'); } });
  try {
    const catalog = await app.inject({ method: 'GET', url: '/api/catalog?storeId=3330251&diningMode=pickup', headers });
    assert.equal(catalog.statusCode, 200);
    assert.deepEqual(captured, { storeId: '3330251', diningMode: 'pickup' });
    const stores = await app.inject({ method: 'GET', url: '/api/stores?city=上海&keyword=测试', headers });
    assert.equal(stores.statusCode, 200);
    assert.deepEqual(captured, { city: '上海', keyword: '测试' });
    for (const url of ['/api/catalog?storeId=3330251', '/api/stores?city=杭州&keyword=凤起路&tool=create-order']) {
      assert.equal((await app.inject({ method: 'GET', url, headers })).statusCode, 400);
    }
  } finally { await app.close(); }
});

test('selection accepts only normalized current-basket requests behind identical local guards',async()=>{
 let calls=0;const app=createApp({stores:async()=>[],catalog:async()=>demoCatalog(),quote:async()=>{throw new Error('unexpected');},selection:async input=>{calls++;return input.basket.map(line=>({candidateId:line.candidateId,components:[{name:'可乐中杯',quantity:1}],requiresSelection:false}));}});
 try {
  const payload={contextKey:'context',cartRevision:0,basket:[{candidateId:'cola',quantity:1,optionIds:['variant:medium']}]};
  const badOrigin=await app.inject({method:'POST',url:'/api/selection',headers:{host:'127.0.0.1:8787',origin:'https://attacker.invalid'},payload});assert.equal(badOrigin.statusCode,403);
  const extra=await app.inject({method:'POST',url:'/api/selection',headers,payload:{...payload,tool:'create-order'}});assert.equal(extra.statusCode,400);assert.equal(calls,0);
  const response=await app.inject({method:'POST',url:'/api/selection',headers,payload});assert.equal(response.statusCode,200);assert.deepEqual(response.json(),[{candidateId:'cola',components:[{name:'可乐中杯',quantity:1}],requiresSelection:false}]);assert.equal(calls,1);
 }finally{await app.close();}
});
test('option transport permits a complete large combo selection while preserving item and byte bounds',async()=>{
 const app=createApp({stores:async()=>[],catalog:async()=>demoCatalog(),quote:async()=>{throw new Error('unexpected');},selection:async input=>input.basket.map(line=>({candidateId:line.candidateId,components:[{name:'收到完整选项',quantity:line.optionIds.length}],requiresSelection:false}))});
 try{
  const payload={contextKey:'context',cartRevision:0,basket:[{candidateId:'large-combo',quantity:1,optionIds:Array.from({length:31},(_,i)=>`round:official-choice-${i}:1`)}]};
  const response=await app.inject({method:'POST',url:'/api/selection',headers:{host:'127.0.0.1:8787',origin:'http://127.0.0.1:5173'},payload});
  assert.equal(response.statusCode,200);assert.equal(response.json()[0].components[0].quantity,31);
 }finally{await app.close();}
});
