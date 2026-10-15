import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCatalogService} from '../server/mcp/catalog.ts';
import {createQuoteService} from '../server/mcp/quote.ts';
import {setModification,setRoundChoice} from '../src/cart/options.ts';
import type {McpGateway} from '../server/mcp/gateway.ts';
const raw=JSON.parse(readFileSync(new URL('./fixtures/menu-options.json',import.meta.url),'utf8'));
async function setup(){
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const g:McpGateway={listTools:async()=>[],close:async()=>{},call:async(name,args)=>{
  calls.push({name,args});if(name==='query-meals')return{data:raw};if(name==='list-nutrition-foods')return{data:raw.nutrition};
  if(name==='query-meal-detail'){const code=String(args.code);if(raw.details[code])return{data:raw.details[code]};if(code==='4106')return{data:{code,name:'香芋派',image:'https://menu-img.mcd.cn/official-taro.png',rounds:[]}};throw new Error('no child image');}
  if(name==='calculate-price')return{success:true,code:200,data:{price:2650}};throw new Error('unexpected call');
 }};
 const catalog=createCatalogService(g),snapshot=await catalog.loadCatalog({storeId:'3330251',diningMode:'pickup'}),service=createQuoteService(catalog,g);
 calls.length=0;return {snapshot,service,calls,catalog};
}
test('full catalog captures top and combo customization, independent flavor image and cached quote identity',async()=>{
 const f=await setup(),pie=f.snapshot.items.find(c=>c.name==='香芋派')!;
 assert.equal(pie.imageUrl,'https://menu-img.mcd.cn/official-taro.png');
 const req={contextKey:f.snapshot.contextKey,cartRevision:0,basket:[{candidateId:pie.id,quantity:2,optionIds:['variant:'+pie.defaultVariantId]}]};
 await f.service.quoteBasket(req);
 assert.deepEqual(f.calls,[{name:'calculate-price',args:{storeCode:'3330251',orderType:1,beType:1,needTableware:false,items:[{productCode:'9900008752',quantity:2,roundList:[{round:'1',comboItemList:[{code:'4106',quantity:1}]}]}]}}]);
});
test('server emits cancelled toggle and exactly one duplicate-code ice radio at correct wire paths',async()=>{
 const f=await setup(),burger=f.snapshot.items.find(c=>c.officialCode==='1100')!,cola=f.snapshot.items.find(c=>c.name==='可乐')!;
 const burgerIds=setModification(burger,[],burger.modificationGroups![0].values[3].id,0),v=cola.variants![1];
 const colaIds=setModification(cola,['variant:'+v.id],v.modificationGroups![0].values[1].id,1);
 const request={contextKey:f.snapshot.contextKey,cartRevision:1,basket:[{candidateId:burger.id,quantity:1,optionIds:burgerIds},{candidateId:cola.id,quantity:1,optionIds:colaIds}]};
 await f.service.quoteBasket(request);assert.equal(f.calls.length,1);
 const items=f.calls[0].args.items as any[];
 assert.deepEqual(items[0].modification.values[3],{code:'100202',key:'0-0',quantity:0});
 assert.deepEqual(items[1].roundList[0].comboItemList[0].modification,{values:[{code:'200002',key:'0-0',quantity:1}]});
 for(const ids of [[...burgerIds,...burgerIds],['mod:forged:1'],['variant:'+v.id]]){f.calls.length=0;await assert.rejects(f.service.quoteBasket({...request,basket:[{candidateId:burger.id,quantity:1,optionIds:ids}]}));assert.equal(f.calls.length,0);}
});
test('multi-count official defaults survive contradictory flags and invalid edited totals reject before gateway',async()=>{
 const f=await setup(),bff=f.snapshot.items.find(c=>c.name==='BFF四宫格小食盘')!;
 const req={contextKey:f.snapshot.contextKey,cartRevision:0,basket:[{candidateId:bff.id,quantity:1,optionIds:[] as string[]}]};
 await f.service.quoteBasket(req);assert.equal((f.calls[0].args.items as any[])[0].roundList[0].comboItemList.length,3);
 f.calls.length=0;req.basket[0].optionIds=setRoundChoice(bff,[],bff.comboRounds![0].choices[0].id,0);
 await assert.rejects(f.service.quoteBasket(req),/SELECTION_REQUIRED/);assert.equal(f.calls.length,0);
});
