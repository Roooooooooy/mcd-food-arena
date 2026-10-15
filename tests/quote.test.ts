import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCatalogService } from '../server/mcp/catalog.ts';
import { createQuoteService } from '../server/mcp/quote.ts';
import type { McpGateway } from '../server/mcp/gateway.ts';
import type { QuoteRequest } from '../src/shared/contracts.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/quote.json',import.meta.url),'utf8'));
const menu=JSON.parse(readFileSync(new URL('./fixtures/catalog.json',import.meta.url),'utf8'));
const details=JSON.parse(readFileSync(new URL('./fixtures/catalog-details.json',import.meta.url),'utf8'));
async function setup(){
 const calls:{name:string,args:Record<string,unknown>}[]=[];let response:unknown=fixture.quotes.medium;let customDetail:unknown;
 const g:McpGateway={listTools:async()=>[],close:async()=>{},call:async(name,args)=>{calls.push({name,args});if(name==='query-meals')return{data:menu};if(name==='list-nutrition-foods')return{data:menu.nutrition};if(name==='query-meal-detail')return{data:(args.code==='9900004236'?customDetail:undefined)??(args.code==='9900004236'?fixture.comboDetail:details[String(args.code)]??{code:args.code,name:menu.meals[String(args.code)].name,rounds:[]})};if(name==='calculate-price')return response;throw new Error('unexpected');}};
 const catalog=createCatalogService(g);const snapshot=await catalog.loadCatalog({storeId:'3330251',diningMode:'pickup'});calls.length=0;
 const service=createQuoteService(catalog,g);const cola=snapshot.items.find(i=>i.name==='可乐')!;
 const request:QuoteRequest={contextKey:snapshot.contextKey,cartRevision:2,basket:[{candidateId:cola.id,quantity:1,optionIds:['variant:'+cola.variants!.find(v=>v.officialCode==='3050')!.id]}]};
 return {catalog,service,snapshot,request,calls,respond:(r:unknown)=>{response=r;},detail:async(r:unknown)=>{customDetail=r;const latest=await catalog.loadCatalog({storeId:'3330251',diningMode:'pickup'});request.contextKey=latest.contextKey;calls.length=0;}};
}
test('可乐真实父编码＋轮次＋杯型，分金额不再乘100',async()=>{const f=await setup();const result=await f.service.quoteBasket(f.request);assert.equal(result.totalCents,1000);assert.equal(result.mode,'live');assert.equal(result.evidence,'official');assert.deepEqual(f.calls.filter(c=>c.name==='calculate-price')[0].args,{storeCode:'3330251',orderType:1,beType:1,needTableware:false,items:[{productCode:'9900008751',quantity:1,roundList:[{round:'1',comboItemList:[{code:'3050',quantity:1}]}]}]});});
test('换大杯和数量准确传给官方',async()=>{const f=await setup();const cola=f.snapshot.items.find(i=>i.name==='可乐')!;f.request.basket[0].optionIds=['variant:'+cola.variants!.find(v=>v.officialCode==='3100')!.id];f.request.basket[0].quantity=2;f.respond(fixture.quotes.large);assert.equal((await f.service.quoteBasket(f.request)).totalCents,1200);const item=(f.calls.find(c=>c.name==='calculate-price')!.args.items as any[])[0];assert.equal(item.quantity,2);assert.equal(item.roundList[0].comboItemList[0].code,'3100');});
test('普通单品传真实商品编码；完整套餐四轮取实际默认选项',async()=>{const f=await setup();f.request.basket=[{candidateId:'live:sku:1100',quantity:1,optionIds:[]}];f.respond(fixture.quotes.single);assert.equal((await f.service.quoteBasket(f.request)).totalCents,2650);assert.deepEqual(f.calls.find(c=>c.name==='calculate-price')!.args.items,[{productCode:'1100',quantity:1}]);f.calls.length=0;f.request.basket=[{candidateId:'live:sku:9900004236',quantity:1,optionIds:[]}];f.respond(fixture.quotes.combo);assert.equal((await f.service.quoteBasket(f.request)).totalCents,5700);assert.deepEqual(f.calls.find(c=>c.name==='calculate-price')!.args.items,[{productCode:'9900004236',quantity:1,roundList:[{round:'1',comboItemList:[{code:'1440',quantity:1}]},{round:'2',comboItemList:[{code:'4810',quantity:1}]},{round:'3',comboItemList:[{code:'515106',quantity:1}]},{round:'4',comboItemList:[{code:'3050',quantity:1}]}]}]);});
test('未知菜单、无糖冒充普通可乐、数量和选项错误在任何MCP调用前拒绝',async()=>{const f=await setup();const invalid=[{...f.request,contextKey:'unknown'},...[-1,0,1.5,100,NaN].map(quantity=>({...f.request,basket:[{...f.request.basket[0],quantity}]})),...['unknown','variant:missing','coupon:use'].map(id=>({...f.request,basket:[{...f.request.basket[0],optionIds:[id]}]})),{...f.request,basket:[{candidateId:'not-current-menu',quantity:1,optionIds:[]}]},{...f.request,basket:[{...f.request.basket[0],optionIds:['variant:'+f.snapshot.items.find(i=>i.name==='无糖可口可乐')!.variants![0].id]}]}];for(const req of invalid)await assert.rejects(f.service.quoteBasket(req));assert.equal(f.calls.length,0);});
test('缺失套餐默认选择拒绝正式核价',async()=>{const f=await setup();f.request.basket=[{candidateId:'live:sku:9900004236',quantity:1,optionIds:[]}];await f.detail({...fixture.comboDetail,rounds:fixture.comboDetail.rounds.map((r:any)=>({...r,choices:r.choices.map((c:any)=>({...c,quantity:0,isDefault:0}))}))});await assert.rejects(f.service.quoteBasket(f.request),/SELECTION_REQUIRED/);assert.equal(f.calls.some(c=>c.name==='calculate-price'),false);});
test('失败、缺价、非整数金额不可变成0；费用已有单位且不叠加整单金额',async()=>{const f=await setup();for(const response of [fixture.quotes.failure,fixture.quotes.missing,{success:true,code:500,data:{price:0}},{success:true,code:200,data:{price:'1000'}},{success:true,code:200,data:{price:-1}},{success:true,code:200,data:{price:1.5}},{success:true,code:200,data:{price:100,packingPrice:'bad'}}]){f.respond(response);await assert.rejects(f.service.quoteBasket(f.request));}f.respond(fixture.quotes.fees);const result=await f.service.quoteBasket(f.request);assert.equal(result.totalCents,1234);assert.deepEqual(result.fees,[{label:'配送费',amountCents:0},{label:'打包费',amountCents:100}]);f.respond({success:true,code:200,data:{price:0}});assert.equal((await f.service.quoteBasket(f.request)).totalCents,0);});
test('规范选择摘要公开实际套餐默认内容，缺默认返回需选择',async()=>{const f=await setup();f.request.basket=[{candidateId:'live:sku:9900004236',quantity:1,optionIds:[]}];const summary=await f.service.selection(f.request);assert.deepEqual(summary,[{candidateId:'live:sku:9900004236',requiresSelection:false,components:[{name:'麦辣鸡腿汉堡',quantity:1},{name:'中薯条',quantity:1},{name:'麦乐鸡4块',quantity:1},{name:'可乐中杯',quantity:1}]}]);assert.equal(f.calls.some(c=>c.name==='calculate-price'),false);});
test('直接规格商品保持实际SKU不变，不伪造父套餐结构',async()=>{const f=await setup();const sprite=f.snapshot.items.find(i=>i.officialCode==='3010')!;assert.ok(sprite);f.request.basket=[{candidateId:sprite.id,quantity:1,optionIds:sprite.defaultVariantId?['variant:'+sprite.defaultVariantId]:[]}];await f.service.quoteBasket(f.request);assert.deepEqual(f.calls.find(c=>c.name==='calculate-price')!.args.items,[{productCode:'3010',quantity:1}]);});
test('同候选重复行、两个规格、无效revision全部先拒绝',async()=>{const f=await setup();for(const request of [{...f.request,cartRevision:-1},{...f.request,basket:[f.request.basket[0],f.request.basket[0]]},{...f.request,basket:[{...f.request.basket[0],optionIds:[...f.request.basket[0].optionIds,'variant:second']}]}])await assert.rejects(f.service.quoteBasket(request));assert.equal(f.calls.length,0);});

for(const [name,mutate] of [
 ['负数默认数量',(round:any)=>({...round,choices:round.choices.map((choice:any)=>({...choice,quantity:-1}))})],
 ['轮次声明数量是字符串',(round:any)=>({...round,quantity:'2'})],
 ['追加默认子项的数量是字符串',(round:any)=>({...round,choices:[...round.choices,{code:'other',name:'畸形默认子项',quantity:'1',maxQuantity:-1,isDefault:1}]})],
] as const){
 test(`畸形默认详情失败关闭：${name}`,async()=>{
  const f=await setup();f.request.basket=[{candidateId:'live:sku:9900004236',quantity:1,optionIds:[]}];
  await f.detail({...fixture.comboDetail,rounds:[mutate(fixture.comboDetail.rounds[0])]});
  const summary=await f.service.selection(f.request);
  assert.equal(summary[0].requiresSelection,true);assert.deepEqual(summary[0].components,[]);
  await assert.rejects(f.service.quoteBasket(f.request),/SELECTION_REQUIRED|CATALOG_INVALID_DETAIL/);
  assert.equal(f.calls.some(call=>call.name==='calculate-price'),false);
 });
}
test('明确选择中杯允许原始choice为非默认且数量0',async()=>{
 const f=await setup();const cola=f.snapshot.items.find(item=>item.name==='可乐')!;
 assert.equal(details['9900008751'].rounds[0].choices.find((choice:any)=>choice.code==='3050').isDefault,0);
 assert.equal(details['9900008751'].rounds[0].choices.find((choice:any)=>choice.code==='3050').quantity,0);
 const summary=await f.service.selection(f.request);assert.equal(summary[0].requiresSelection,false);
 assert.equal((await f.service.quoteBasket(f.request)).totalCents,1000);
 assert.equal((f.calls.find(call=>call.name==='calculate-price')!.args.items as any[])[0].roundList[0].comboItemList[0].code,'3050');
 assert.equal(cola.variants!.some(v=>v.officialCode==='3050'),true);
});
test('可选轮次真实数量0保持空，maxQuantity=-1仍表示不限',async()=>{
 const f=await setup();f.request.basket=[{candidateId:'live:sku:9900004236',quantity:1,optionIds:[]}];
 const round=fixture.comboDetail.rounds[0];await f.detail({...fixture.comboDetail,rounds:[round,{id:2,minQuantity:0,maxQuantity:-1,quantity:0,choices:[{code:'optional',name:'可选子项',quantity:0,isDefault:0,maxQuantity:-1}]}]});
 const summary=await f.service.selection(f.request);assert.equal(summary[0].requiresSelection,false);assert.equal(summary[0].components.length,1);
 await f.service.quoteBasket(f.request);assert.deepEqual((f.calls.find(call=>call.name==='calculate-price')!.args.items as any[])[0].roundList,[{round:'1',comboItemList:[{code:'1440',quantity:1}]}]);
});

test('正数量子项的默认标记为0仍按实际quantity核价',async()=>{const f=await setup();f.request.basket=[{candidateId:'live:sku:9900004236',quantity:1,optionIds:[]}];await f.detail({...fixture.comboDetail,rounds:fixture.comboDetail.rounds.map((r:any)=>({...r,choices:r.choices.map((c:any)=>({...c,isDefault:0}))}))});assert.equal((await f.service.selection(f.request))[0].requiresSelection,false);await f.service.quoteBasket(f.request);assert.equal((f.calls[0].args.items as any[])[0].roundList.length,4);});
