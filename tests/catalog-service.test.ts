import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';
import {createCatalogService}from'../server/mcp/catalog.ts';import type{McpGateway}from'../server/mcp/gateway.ts';
const menu=JSON.parse(readFileSync(new URL('./fixtures/catalog.json',import.meta.url),'utf8'));
const details=JSON.parse(readFileSync(new URL('./fixtures/catalog-details.json',import.meta.url),'utf8'));
function gateway(){let count=0;const calls:{name:string;args:Record<string,unknown>}[]=[];const g:McpGateway={listTools:async()=>[],close:async()=>{},call:async(name,args)=>{count++;calls.push({name,args});if(name==='query-nearby-stores')return{data:[{storeCode:'3330251',storeName:'麦当劳杭州下城区-凤起路农贸市场餐厅',address:'杭州建国北路286号'}]};if(name==='query-meals')return{data:menu};if(name==='list-nutrition-foods')return{data:menu.nutrition};if(name==='query-meal-detail')return{data:details[String(args.code)]??{code:args.code,name:menu.meals[String(args.code)].name,rounds:[]}};throw new Error('unexpected');}};return{g,calls,count:()=>count};}
test('catalog service preserves exact store, all menu ids, variant mapping and cached context details',async()=>{
 const f=gateway();const service=createCatalogService(f.g);assert.equal(f.count(),0);
 const stores=await service.searchStores({city:'杭州',keyword:'建国北路286号'});assert.equal(stores[0].id,'3330251');
 const snapshot=await service.loadCatalog({storeId:stores[0].id,diningMode:'pickup'});assert.equal(snapshot.items.length,110);assert.equal(snapshot.rawSkuCount,109);
 const context=service.getContext(snapshot.contextKey)!;assert.equal(context.orderType,1);assert.equal(context.beType,1);assert.equal(context.store.id,'3330251');assert.equal(context.rawMeals.size,109);
 const cola=snapshot.items.find(i=>i.name==='可乐')!;const variant=cola.variants![1];assert.equal(context.variants.get(variant.id)?.officialCode,'3050');assert.equal(context.candidates.get(cola.id)?.id,cola.id);
 const before=f.count();await service.getDetail(snapshot.contextKey,'9900008751');await service.getDetail(snapshot.contextKey,'9900008751');assert.equal(f.count(),before);
 await service.getDetail(snapshot.contextKey,'1100');await service.getDetail(snapshot.contextKey,'1100');assert.equal(f.count(),before+1);
 assert.equal(f.calls.some(c=>c.name==='calculate-price'),false);assert.ok(f.calls.filter(c=>c.name.startsWith('query-meal')).every(c=>c.args.beType===1&&c.args.orderType===1&&!('beCode'in c.args)));
 const refresh=await service.loadCatalog({storeId:'3330251',diningMode:'pickup'});assert.equal(refresh.contextKey,snapshot.contextKey);
});
test('catalog service fails closed for unknown modes, stores, contexts and details',async()=>{
 const f=gateway();const service=createCatalogService(f.g);
 await assert.rejects(service.loadCatalog({storeId:'3330251',diningMode:'delivery'}),/UNSUPPORTED_DINING_MODE/);
 await assert.rejects(service.loadCatalog({storeId:'unverified',diningMode:'pickup'}),/STORE_NOT_VERIFIED/);assert.equal(f.count(),0);
 await assert.rejects(service.getDetail('missing','1100'),/CATALOG_CONTEXT_MISSING/);assert.equal(f.count(),0);
 const snapshot=await service.loadCatalog({storeId:'3330251',diningMode:'pickup'});const before=f.count();await assert.rejects(service.getDetail(snapshot.contextKey,'not-a-product'),/PRODUCT_NOT_IN_CONTEXT/);assert.equal(f.count(),before);
});
test('catalog service never uses a sample catalog when live menu call fails',async()=>{
 const f=gateway();f.g.call=async()=>{throw new Error('MCP_UNAUTHORIZED');};const service=createCatalogService(f.g);
 await assert.rejects(service.loadCatalog({storeId:'3330251',diningMode:'pickup'}),/MCP_UNAUTHORIZED/);
});
test('runtime adapters stay lazy, wire real catalog HTTP, and reject quote for an unknown context before MCP',async()=>{
 const {createRuntimeServices}=await import('../server/main.ts');const {createApp}=await import('../server/app.ts');const f=gateway();let connections=0;
 const runtime=createRuntimeServices(async()=>{connections++;return f.g;});const app=createApp(runtime.services);assert.equal(connections,0);
 try {
  const headers={host:'127.0.0.1:8787',origin:'http://127.0.0.1:5173'};
  const quote=await app.inject({method:'POST',url:'/api/quote',headers,payload:{contextKey:'pending',basket:[{candidateId:'unknown',quantity:1,optionIds:[]}],cartRevision:0}});assert.equal(quote.statusCode,400);assert.equal(quote.json().error.code,'CATALOG_CONTEXT_MISSING');assert.equal(connections,0);
  const response=await app.inject({method:'GET',url:'/api/catalog?storeId=3330251&diningMode=pickup',headers});assert.equal(response.statusCode,200);assert.equal(response.json().rawSkuCount,109);assert.equal(response.json().items.length,110);assert.equal(connections,1);
  const invalid=await app.inject({method:'GET',url:'/api/catalog?storeId=3330251&diningMode=delivery',headers});assert.equal(invalid.statusCode,400);assert.equal(invalid.json().error.code,'UNSUPPORTED_DINING_MODE');
 }finally{await app.close();await runtime.close();}
});
test('catalog loads details for every original size SKU even when the menu itself already groups them',async()=>{
 const calls:string[]=[];const raw={categories:[{name:'饮品',meals:[{code:'a'},{code:'b'}]}],meals:{a:{name:'可乐小杯',currentPrice:'10'},b:{name:'可乐大杯',currentPrice:'12'}}};
 const g:McpGateway={listTools:async()=>[],close:async()=>{},call:async(name,args)=>{if(name==='query-meals')return{data:raw};if(name==='list-nutrition-foods')return{data:''};if(name==='query-meal-detail'){calls.push(String(args.code));return{data:{code:args.code,name:raw.meals[args.code as 'a'|'b'].name,rounds:[]}};}throw new Error('unexpected');}};
 const service=createCatalogService(g);const snapshot=await service.loadCatalog({storeId:'3330251',diningMode:'pickup'});assert.deepEqual(calls,['a','b']);assert.equal(snapshot.items.length,1);assert.equal(snapshot.items[0].variants?.length,2);
});
