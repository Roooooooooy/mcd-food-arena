import test from 'node:test';
import assert from 'node:assert/strict';
async function client(enabled:boolean,fetcher:typeof fetch) {const m=await import('../src/commerce/api.ts').catch(()=>null);assert.ok(m,'commerce client must exist');return m.createCommerceApi(enabled,fetcher);}
test('disabled build rejects every commerce method without HTTP calls',async()=>{
 let calls=0;const api=await client(false,async()=>{calls++;throw new Error('unexpected');});
 for(const action of [()=>api.session(),()=>api.connect('fake'),()=>api.disconnect(),()=>api.catalog({storeId:'1',diningMode:'pickup'}),()=>api.coupons('context'),()=>api.stores({city:'杭州',keyword:'门店'}),()=>api.selection({contextKey:'x',basket:[],cartRevision:0}),()=>api.quote({contextKey:'x',basket:[],cartRevision:0}),()=>api.createOrder({quoteKey:'q',attemptKey:'a',takeWayCode:'t',expectedTotalCents:1}),()=>api.queryOrder('o')])await assert.rejects(action);assert.equal(calls,0);
});
test('Token is sent only on explicit connect, then cookie-owned same-origin methods',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];const api=await client(true,async(url,init)=>{calls.push({url:String(url),init:init!});return new Response(JSON.stringify({connected:true}),{status:200});});
 assert.equal(calls.length,0);await api.connect('fake-token');await api.session();await api.coupons('context');await api.queryOrder('order');
 assert.deepEqual(calls.map(c=>c.url),['/api/commerce/connect','/api/commerce/session','/api/commerce/coupons?contextKey=context','/api/commerce/query-order']);assert.ok(calls.every(c=>c.init.credentials==='include'));assert.equal(calls[0].init.body,JSON.stringify({token:'fake-token'}));assert.ok(calls.slice(1).every(c=>!String(c.init.body).includes('fake-token')));
});
test('errors expose stable codes and safe Chinese text, never raw upstream response',async()=>{
 const api=await client(true,async()=>new Response(JSON.stringify({error:{code:'PRICE_CHANGED',message:'secret upstream token'}}),{status:409}));await assert.rejects(()=>api.createOrder({quoteKey:'q',takeWayCode:'t',attemptKey:'a',expectedTotalCents:1}),(e:any)=>e.code==='PRICE_CHANGED'&&!e.message.includes('secret'));
});
test('disconnect and context invalidation discard late responses even if fetch ignores abort',async()=>{
 let finish!:(r:Response)=>void;const api=await client(true,async(url)=>String(url).endsWith('/disconnect')?new Response('{}'):new Promise(r=>{finish=r;}));
 const pending=api.coupons('old');await api.disconnect();finish(new Response('{}'));await assert.rejects(()=>pending,(e:any)=>e.code==='STALE_RESULT');
 const next=api.catalog({storeId:'1',diningMode:'pickup'});api.invalidate();finish(new Response('{}'));await assert.rejects(()=>next,(e:any)=>e.code==='STALE_RESULT');
});
