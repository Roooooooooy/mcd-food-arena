import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/demo/menu.ts';
import { sampleQuote, basketText } from '../src/cart/model.ts';
import * as sources from '../src/catalog/source.ts';
import * as api from '../src/api.ts';
import { readFileSync } from 'node:fs';

test('已归档菜单显示七类：派合并甜品、周边保留，商品与规格证据不改',async()=>{
  const archived=JSON.parse(readFileSync(new URL('../public/demo/catalog.json',import.meta.url),'utf8'));
  const before=structuredClone(archived);
  const result=await sources.loadFrozenDemo('/',async()=>new Response(JSON.stringify(archived)));
  assert.equal(result.items.length,archived.items.length);
  assert.deepEqual([...new Set(result.items.map(item=>item.stageId))].sort(),['burger','coffee','combo','dessert','drink','other','side']);
  assert.equal(result.items.filter(item=>item.stageId==='dessert').length,archived.items.filter((item:{stageId:string})=>item.stageId==='dessert'||item.stageId==='pie').length);
  const pie=result.items.find(item=>item.name==='派');
  if(pie){assert.equal(pie.stageId,'dessert');assert.equal(pie.stageLabel,'甜品');}
  if(archived.items.some((item:{stageId:string})=>item.stageId==='pie'||item.stageId==='chicken'))assert.notEqual(result.contextKey,archived.contextKey);
  else assert.equal(result.contextKey,archived.contextKey);
  assert.equal(result.capturedAt,archived.capturedAt);assert.equal(result.rawSkuCount,111);
  for(const item of result.items){
    const original=archived.items.find((candidate:{id:string})=>candidate.id===item.id);
    assert.equal(item.name,original.name);assert.equal(item.officialCode,original.officialCode);
    assert.equal(item.referencePriceCents,original.referencePriceCents);assert.deepEqual(item.nutrition,original.nutrition);
    assert.deepEqual(item.variants?.map(v=>[v.id,v.officialCode,v.referencePriceCents,v.nutrition]),original.variants?.map((v:{id:string;officialCode:string;referencePriceCents:number|null;nutrition:unknown})=>[v.id,v.officialCode,v.referencePriceCents,v.nutrition]));
  }
  assert.deepEqual(archived,before);
});

test('historical pie classification migrates to dessert while merchandise stays selectable',async()=>{
 const archived=JSON.parse(readFileSync(new URL('../public/demo/catalog.json',import.meta.url),'utf8'));
 const old={...archived,items:[{...archived.items[0],id:'old-pie',stageId:'pie',stageLabel:'派',name:'派'},{...archived.items[0],id:'old-other',stageId:'other',stageLabel:'其他',name:'真实周边贴纸'}]};
 const result=await sources.loadFrozenDemo('/',async()=>new Response(JSON.stringify(old)));
 assert.deepEqual(result.items.map(c=>[c.id,c.stageId,c.name]),[['old-pie','dessert','派'],['old-other','other','真实周边贴纸']]);assert.notEqual(result.contextKey,old.contextKey);
});

test('frozen exports allowlist public fields, keep identities and variants, and separate the live context', async () => {
  const { freezeSnapshot } = await import('../src/demo/snapshot.ts');
  const original = demoCatalog();
  const input = { ...original, mode: 'live', contextKey: 'live:context', loadedAt: '2026-10-14T13:00:00Z', traceId: 'private-trace', token: 'private-token', store: { id: '3330251', name: '公开门店', city: '杭州', address: '公开地址', email: 'private-email' }, items: [{ ...original.items[0], id: 'live:sku:123', officialCode: '123', mode: 'live', imageUrl: 'https://menu-img.mcd.cn/a.png', account: 'private-account', nutrition: { kcal: 123, privateField: 42 }, defaultVariantId: 'small', variants: [{ id: 'small', officialCode: '123-small', name: '小杯', sizeLabel: '小杯', referencePriceCents: null, nutrition: {}, imageUrl: 'https://menu-img.mcd.cn/b.png', menuCode: '123', roundId: 1, header: 'private-header' }] }] };
  const result = freezeSnapshot(input, '2026-10-14T13:01:00Z');
  assert.equal(result.sourceKind, 'official-snapshot');
  assert.equal(result.mode, 'demo');
  assert.match(result.contextKey, /^demo:snapshot:3330251:/);
  assert.notEqual(result.contextKey, input.contextKey);
  assert.equal(result.items[0].id, 'live:sku:123');
  assert.equal(result.items[0].mode, 'demo');
  assert.equal(result.items[0].variants?.[0].referencePriceCents, null);
  assert.equal(result.items[0].variants?.[0].menuCode, '123');
  assert.deepEqual(result.items[0].nutrition, { kcal: 123 });
  assert.doesNotMatch(JSON.stringify(result), /private-|email|account|token|header|traceId/);
  assert.throws(() => freezeSnapshot({ ...input, complete: false }, '2026-10-14T13:01:00Z'));
});

test('only public HTTPS McDonald image URLs without credentials or query data can be captured', async () => {
  const { publicImageUrl } = await import('../src/demo/snapshot.ts');
  assert.equal(publicImageUrl('https://menu-img.mcd.cn/a.png'), 'https://menu-img.mcd.cn/a.png');
  for (const url of ['http://menu-img.mcd.cn/a.png', 'https://user:secret@menu-img.mcd.cn/a.png', 'https://menu-img.mcd.cn/a.png?token=secret', 'https://menu-img.mcd.cn.evil.test/a.png', 'https://example.org/a.png', 'https://menu-img.mcd.cn/a.png#secret']) assert.equal(publicImageUrl(url), null);
});

test('loading archived menu and all image variants respects a nested deployment base and never keeps a remote fallback', async () => {
  assert.equal(typeof sources.loadFrozenDemo, 'function');
  const original = demoCatalog();
  const archived = { ...original, sourceKind: 'official-snapshot', capturedAt: '2026-10-14T13:00:00Z', items: [{ ...original.items[0], imageUrl: 'demo/images/a.png', variants: [{ id: 'a', officialCode: '123', name: '小杯', sizeLabel: '小杯', referencePriceCents: null, nutrition: {}, imageUrl: 'demo/images/b.png' }] }, { ...original.items[1], imageUrl: 'https://menu-img.mcd.cn/c.png' }] };
  let requested = '';
  const result = await sources.loadFrozenDemo('/mcd-food-arena/', async input => { requested = String(input); return new Response(JSON.stringify(archived)); });
  assert.equal(requested, '/mcd-food-arena/demo/catalog.json');
  assert.equal(result.items[0].imageUrl, '/mcd-food-arena/demo/images/a.png');
  assert.equal(result.items[0].variants?.[0].imageUrl, '/mcd-food-arena/demo/images/b.png');
  assert.equal(result.items[1].imageUrl, null);
});

test('public API client refuses every live operation before making a network request', async () => {
  assert.equal(typeof api.createLiveApi, 'function');
  let calls = 0;
  const client = api.createLiveApi(true, async () => { calls++; throw new Error('unexpected network'); });
  const request = { contextKey: 'demo:snapshot:3330251', basket: [], cartRevision: 0 };
  await assert.rejects(client.searchStores({ city: '杭州', keyword: '公开' }), /本机/);
  await assert.rejects(client.loadCatalog({ storeId: '3330251', diningMode: 'pickup' }), /本机/);
  await assert.rejects(client.quoteBasket(request), /本机/);
  await assert.rejects(client.loadBasketSelection(request), /本机/);
  assert.equal(calls, 0);
});

test('image capture enforces byte bounds and accepts only actual image bytes', async () => {
  const { readPublicImage } = await import('../scripts/demo-images.ts');
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  const budget = { used: 0, max: 30 };
  const image = await readPublicImage(new Response(png, { headers: { 'content-type': 'image/png' } }), budget, 20);
  assert.equal(image.extension, 'png');
  assert.deepEqual(new Uint8Array(image.bytes), png);
  assert.equal(budget.used, 10);
  const gif = Buffer.from('GIF89a-original-public-image');
  const mislabeled = await readPublicImage(new Response(gif, { headers: { 'content-type': 'image/png' } }), { used: 0, max: 50 }, 50);
  assert.equal(mislabeled.extension, 'gif');
  assert.deepEqual(mislabeled.bytes, gif);
  await assert.rejects(readPublicImage(new Response(png, { headers: { 'content-type': 'image/png' } }), { used: 0, max: 30 }, 5), /LIMIT/);
  await assert.rejects(readPublicImage(new Response(png, { headers: { 'content-type': 'image/png' } }), { used: 25, max: 30 }, 20), /LIMIT/);
  await assert.rejects(readPublicImage(new Response('not an image', { headers: { 'content-type': 'image/png' } }), { used: 0, max: 30 }, 20), /INVALID_IMAGE/);
  await assert.rejects(readPublicImage(new Response(png, { headers: { 'content-type': 'text/html' } }), { used: 0, max: 30 }, 20), /INVALID_IMAGE/);
});

test('a frozen menu total has snapshot evidence and retains conditional-price context in the exported meal list', () => {
  const original = demoCatalog();
  const snapshot = { ...original, sourceKind: 'official-snapshot' as const, capturedAt: '2026-10-14T13:00:00Z', store: { id: '3330251', name: '公开测试门店', city: '杭州', address: '公开地址' }, items: [{ ...original.items[0], attributes: ['随单购条件价，核价为准'] }] };
  const request = { contextKey: snapshot.contextKey, cartRevision: 1, basket: [{ candidateId: snapshot.items[0].id, quantity: 2, optionIds: [] }] };
  const quote = sampleQuote(request, snapshot);
  assert.equal(quote.evidence, 'snapshot');
  const text = basketText(request, snapshot, [], quote);
  assert.match(text, /门店快照/);
  assert.match(text, /快照参考合计/);
  assert.match(text, /条件价/);
  assert.match(text, /2026-10-14T13:00:00Z/);
  assert.doesNotMatch(text, /虚构|官方整单金额/);
});

test('an unknown selected variant cannot fall back to its parent price, and unselected or stale variants cannot be totalled', () => {
  const original = demoCatalog();
  const item = { ...original.items[0], variants: [{ id: 'unknown', officialCode: 'public-code', name: '大杯', sizeLabel: '大杯', referencePriceCents: null, nutrition: {}, imageUrl: null }] };
  const snapshot = { ...original, items: [item] };
  const request = { contextKey: snapshot.contextKey, cartRevision: 1, basket: [{ candidateId: item.id, quantity: 1, optionIds: ['variant:unknown'] }] };
  assert.throws(() => sampleQuote(request, snapshot));
  assert.throws(() => sampleQuote({ ...request, basket: [{ ...request.basket[0], optionIds: [] }] }, snapshot));
  assert.throws(() => sampleQuote({ ...request, basket: [{ ...request.basket[0], optionIds: ['variant:stale'] }] }, snapshot));
});
