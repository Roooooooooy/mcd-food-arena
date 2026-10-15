import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceFixture } from './commerce-fixture.ts';
const empty={categories:[],meals:{}};
const basket=(f:any,id=f.snapshot.items[0].id)=>({contextKey:f.snapshot.contextKey,cartRevision:0,basket:[{candidateId:id,quantity:1,optionIds:[]}]});
test('current complete menu gives listed/missing with time and no invented inventory',async t=>{
 const f=await commerceFixture(t),ids=f.snapshot.items.map((i:any)=>i.id);
 const r=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:ids});assert.equal(r.statusCode,200);assert.ok(r.json().checkedAt);assert.ok(r.json().items.every((i:any)=>i.state==='listed'));assert.doesNotMatch(r.body,/soldOut|stock|售罄|private-coupon/);
});
test('complete missing ordinary menu blocks quote before calculate and create after repricing',async t=>{
 const f=await commerceFixture(t);const q=await f.request('POST','/quote',basket(f));assert.equal(q.statusCode,200);
 f.state.menu=empty; t.mock.timers.enable({apis:['Date'],now:Date.now()+30_001});f.calls.length=0;
 const a=await f.request('POST','/basket-availability',basket(f));assert.equal(a.statusCode,200);assert.equal(a.json().items[0].state,'not-returned');
 const blocked=await f.request('POST','/quote',basket(f));assert.equal(blocked.statusCode,409);assert.equal(blocked.json().error.code,'CURRENTLY_UNAVAILABLE');assert.equal(f.calls.some(c=>c.name==='calculate-price'),false);
 const quote=q.json();const created=await f.request('POST','/orders',{quoteKey:quote.quoteKey,takeWayCode:'eat-in',attemptKey:'x',expectedTotalCents:quote.totalCents});assert.equal(created.statusCode,409);assert.equal(created.json().error.code,'CURRENTLY_UNAVAILABLE');assert.equal(f.calls.some(c=>c.name==='create-order'),false);
});
test('incomplete/malformed sources are unknown and never fabricate missing',async t=>{
 const f=await commerceFixture(t);for(const menu of [{categories:[{name:'小食',meals:[{code:'4810'}]}],meals:{}}, {categories:[],meals:{'4810':{name:'中薯条'}}}, {categories:[{name:'x',meals:[{code:'4810'}]}],meals:{'4810':null}}]){
 f.state.menu=menu;const a=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:[f.snapshot.items[0].id]});assert.equal(a.statusCode,200);assert.equal(a.json().items[0].state,'unknown');}
});
test('foreign context/products/coupon refs and extra stock fields deny before gateway',async t=>{
 const f=await commerceFixture(t);for(const body of [{contextKey:'foreign',candidateIds:[f.snapshot.items[0].id]},{contextKey:f.snapshot.contextKey,candidateIds:['foreign']},{contextKey:f.snapshot.contextKey,candidateIds:[f.snapshot.items[0].id],stock:true}]){const r=await f.request('POST','/availability',body);assert.equal(r.statusCode,400);}
 const r=await f.request('POST','/basket-availability',{...basket(f),basket:[{candidateId:f.snapshot.items[0].id,quantity:1,optionIds:[],couponKey:'raw'}]});assert.equal(r.statusCode,400);assert.equal(f.calls.length,0);
});
test('fixed flavor checks current parent round child rather than child as menu SKU',async t=>{
 const f=await commerceFixture(t),pies=f.snapshot.items.filter((i:any)=>i.stageId==='dessert');assert.equal(pies.length,2);
 f.state.details={'9900008752':{code:'9900008752',name:'派',rounds:[{id:1,name:'口味',choices:[{code:'4105',name:'菠萝派'}]}]}};
 const a=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:pies.map((i:any)=>i.id)});assert.equal(a.statusCode,200);assert.equal(a.json().items.find((i:any)=>i.candidateId===pies.find((p:any)=>p.name==='菠萝派').id).state,'listed');assert.equal(a.json().items.find((i:any)=>i.candidateId===pies.find((p:any)=>p.name==='香芋派').id).state,'not-returned');assert.equal(f.calls.filter(c=>c.name==='query-meal-detail').every(c=>c.args.code==='9900008752'),true);
});
test('coupon exclusive product uses private current store mapping and details; missing coupon blocks retained line',async t=>{
 const f=await commerceFixture(t),{collection,input}=await f.quoted();const product=collection.products[0];
 const a=await f.request('POST','/basket-availability',input);assert.equal(a.statusCode,200);assert.equal(a.json().items[0].state,'listed');assert.doesNotMatch(a.body,/private-coupon|9900016371/);
 f.state.store=[];t.mock.timers.enable({apis:['Date'],now:Date.now()+30_001});
 const missing=await f.request('POST','/basket-availability',input);assert.equal(missing.json().items[0].state,'not-returned');assert.match(missing.json().items[0].label,/优惠券/);assert.equal((await f.request('POST','/quote',input)).json().error.code,'CURRENTLY_UNAVAILABLE');
});
test('availability caches per context for max thirty seconds and price failure does not become absence',async t=>{
 const f=await commerceFixture(t),input={contextKey:f.snapshot.contextKey,candidateIds:[f.snapshot.items[0].id]};await f.request('POST','/availability',input);await f.request('POST','/availability',input);assert.equal(f.calls.filter(c=>c.name==='query-meals').length,1);
 f.state.quote={success:false,code:500,data:{}};assert.equal((await f.request('POST','/quote',basket(f))).statusCode,502);assert.equal((await f.request('POST','/availability',input)).json().items[0].state,'listed');
 t.mock.timers.enable({apis:['Date'],now:Date.now()+30_001});await f.request('POST','/availability',input);assert.equal(f.calls.filter(c=>c.name==='query-meals').length,2);
});

import { readFileSync } from 'node:fs';
import { setVariant,setModification } from '../src/cart/options.ts';
async function optionsFixture(t:Parameters<typeof commerceFixture>[0]){
 const f=await commerceFixture(t),raw=JSON.parse(readFileSync(new URL('./fixtures/menu-options.json',import.meta.url),'utf8'));
 f.state.menu={categories:raw.categories,meals:raw.meals};f.state.details=structuredClone(raw.details);
 const loaded=await f.request('GET','/catalog?storeId=3330251&diningMode=pickup');assert.equal(loaded.statusCode,200);const snapshot=loaded.json();f.calls.length=0;return {...f,snapshot,raw};
}
test('grouped beverage keeps listed remaining size, precise selected missing size blocks while candidate remains selectable',async t=>{
 const f=await optionsFixture(t),item=f.snapshot.items.find((i:any)=>i.name==='可乐'),small=item.variants[0],large=item.variants[2],parent=small.menuCode;
 (f.state.details![parent] as any).rounds[0].choices=(f.state.details![parent] as any).rounds[0].choices.filter((c:any)=>c.code!==small.officialCode);
 const a=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:[item.id]});assert.equal(a.statusCode,200);assert.equal(a.json().items[0].state,'listed');assert.equal(a.json().items[0].variants.find((v:any)=>v.variantId===small.id).state,'not-returned');
 const input={contextKey:f.snapshot.contextKey,cartRevision:0,basket:[{candidateId:item.id,quantity:1,optionIds:['variant:'+small.id]}]};
 assert.equal((await f.request('POST','/basket-availability',input)).json().items[0].state,'not-returned');assert.equal((await f.request('POST','/quote',input)).json().error.code,'CURRENTLY_UNAVAILABLE');assert.equal(f.calls.some(c=>c.name==='calculate-price'),false);
 const changed={...input,basket:[{...input.basket[0],optionIds:setVariant(item,input.basket[0].optionIds,large.id)}]};assert.equal((await f.request('POST','/basket-availability',changed)).json().items[0].state,'listed');
});
test('candidate checks never require a default recipe and source fields do not imply food absence',async t=>{
 const f=await optionsFixture(t),item=f.snapshot.items.find((i:any)=>i.name==='BFF四宫格小食盘');const detail=f.state.details![item.officialCode] as any;detail.rounds[0].quantity=undefined;detail.rounds[0].choices.forEach((c:any)=>c.quantity=undefined);detail.supportModify=false;
 const a=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:[item.id]});assert.equal(a.statusCode,200);assert.equal(a.json().items[0].state,'listed');
});
test('current customization membership blocks removed explicit option without calling it food stock',async t=>{
 const f=await optionsFixture(t),item=f.snapshot.items.find((i:any)=>i.officialCode==='1100'),pickle=item.modificationGroups[0].values.find((v:any)=>v.name==='酸黄瓜'),ids=setModification(item,[],pickle.id,0);
 const detail=f.state.details!['1100'] as any;detail.modification.items[0].values=detail.modification.items[0].values.filter((v:any)=>v.code!==pickle.code);detail.modification.items[0].maxValues=detail.modification.items[0].values.length;
 const candidate=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:[item.id]});assert.equal(candidate.json().items[0].state,'listed');
 const a=await f.request('POST','/basket-availability',{contextKey:f.snapshot.contextKey,cartRevision:0,basket:[{candidateId:item.id,quantity:1,optionIds:ids}]});assert.equal(a.statusCode,200);assert.equal(a.json().items[0].state,'not-returned');assert.doesNotMatch(a.body,/售罄|stock/);
});
test('cached availability reports original source check time rather than relabeling stale evidence as new',async t=>{
 const f=await commerceFixture(t),input={contextKey:f.snapshot.contextKey,candidateIds:[f.snapshot.items[0].id]};const first=(await f.request('POST','/availability',input)).json();t.mock.timers.enable({apis:['Date'],now:Date.now()+10_000});const cached=(await f.request('POST','/availability',input)).json();assert.equal(cached.checkedAt,first.checkedAt);assert.equal(cached.items[0].checkedAt,first.items[0].checkedAt);
});

test('failed details and malformed coupon mapping yield unknown instead of absent',async t=>{
 const f=await commerceFixture(t),pies=f.snapshot.items.filter((i:any)=>i.stageId==='dessert');f.state.details={'9900008752':undefined};const a=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:pies.map((i:any)=>i.id)});assert.equal(a.statusCode,200);assert.ok(a.json().items.every((i:any)=>i.state==='unknown'));
 const loaded=(await f.coupons()).json();f.state.store=[{couponId:'private-coupon-id',couponCode:'private-coupon-code',products:[{productCode:'9900016371'}]}];const c=await f.request('POST','/availability',{contextKey:f.snapshot.contextKey,candidateIds:[loaded.products[0].id]});assert.equal(c.statusCode,200);assert.equal(c.json().items[0].state,'unknown');assert.doesNotMatch(c.body,/private-coupon/);
});
