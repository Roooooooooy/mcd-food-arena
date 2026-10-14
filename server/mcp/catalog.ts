import { createHash } from 'node:crypto';
import type { Candidate, CatalogSnapshot, StoreOption, Variant } from '../../src/shared/contracts.ts';
import { isRecord, normalizeCatalog } from '../../src/catalog/normalize.ts';
import { ApiError } from '../app.ts';
import type { McpGateway } from './gateway.ts';

export const DEFAULT_STORE:StoreOption={id:'3330251',name:'麦当劳杭州下城区-凤起路农贸市场餐厅',city:'杭州',address:'杭州建国北路286号'};
export interface CatalogContext {
 snapshot:CatalogSnapshot;
 store:StoreOption;
 diningMode:'pickup';
 orderType:1;
 beType:1;
 rawMeals:ReadonlyMap<string,Record<string,unknown>>;
 candidates:ReadonlyMap<string,Candidate>;
 variants:ReadonlyMap<string,Variant>;
}
export interface CatalogService {
 searchStores(input:{city:string;keyword:string}):Promise<StoreOption[]>;
 loadCatalog(input:{storeId:string;diningMode:string}):Promise<CatalogSnapshot>;
 getContext(contextKey:string):CatalogContext|undefined;
 getDetail(contextKey:string,officialCode:string):Promise<Record<string,unknown>>;
}
function domain(response:unknown):unknown {
 if(!isRecord(response)||!Object.hasOwn(response,'data'))throw new ApiError('CATALOG_INVALID_RESPONSE',502);
 return response.data;
}
function verifyDetail(value:unknown,code:string):Record<string,unknown>{
 if(!isRecord(value)||value.code!==code||typeof value.name!=='string'||!Array.isArray(value.rounds))throw new ApiError('CATALOG_INVALID_DETAIL',502);
 return value;
}
function canonical(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(isRecord(value))return `{${Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
}
function semanticContextKey(snapshot:CatalogSnapshot,store:StoreOption):string {
 // Only the normalized public catalog enters the seed, never raw upstream metadata or credentials.
 const items=snapshot.items.map(item=>({...item,attributes:[...item.attributes].sort(),sourceCategories:item.sourceCategories?[...item.sourceCategories].sort():undefined,variants:item.variants?[...item.variants].sort((a,b)=>a.id.localeCompare(b.id)):undefined})).sort((a,b)=>a.id.localeCompare(b.id));
 const content={version:1,store,diningMode:'pickup',orderType:1,beType:1,mode:snapshot.mode,complete:snapshot.complete,rawSkuCount:snapshot.rawSkuCount,items};
 return `live:${store.id}:pickup:${createHash('sha256').update(canonical(content)).digest('hex')}`;
}
export function createCatalogService(source:McpGateway|(()=>Promise<McpGateway>)):CatalogService {
 const gateway=async()=>typeof source==='function'?await source():source;
 const stores=new Map<string,StoreOption>([[DEFAULT_STORE.id,DEFAULT_STORE]]);
 const contexts=new Map<string,CatalogContext>();const detailCaches=new Map<string,Map<string,Promise<Record<string,unknown>>>>();
 return {
  async searchStores(input){
   const result=domain(await (await gateway()).call('query-nearby-stores',{beType:1,searchType:2,city:input.city,keyword:input.keyword}));
   if(!Array.isArray(result))throw new ApiError('STORES_INVALID_RESPONSE',502);
   const found:StoreOption[]=[];
   for(const raw of result){
    if(!isRecord(raw)||typeof raw.storeCode!=='string'||typeof raw.storeName!=='string'||typeof raw.address!=='string')throw new ApiError('STORES_INVALID_RESPONSE',502);
    const store={id:raw.storeCode,name:raw.storeName,address:raw.address,city:input.city};stores.set(store.id,store);if(!found.some(s=>s.id===store.id))found.push(store);
   }
   return found;
  },
  async loadCatalog(input){
   if(input.diningMode!=='pickup')throw new ApiError('UNSUPPORTED_DINING_MODE',400);
   const store=stores.get(input.storeId);if(!store)throw new ApiError('STORE_NOT_VERIFIED',400);
   const g=await gateway();const args={storeCode:store.id,orderType:1,beType:1};
   const raw=domain(await g.call('query-meals',args));if(!isRecord(raw))throw new ApiError('CATALOG_INVALID_RESPONSE',502);
   const nutrition=domain(await g.call('list-nutrition-foods',{}));
   const context={contextKey:'pending',store,loadedAt:new Date().toISOString(),complete:true};
   const base=normalizeCatalog({...raw,nutrition},context);
   const details:Record<string,Record<string,unknown>>={};
   const cache=new Map<string,Promise<Record<string,unknown>>>();
   const beverageCodes = new Set(base.items.filter(candidate => ['drink','coffee'].includes(candidate.stageId)).flatMap(candidate => [candidate.officialCode, ...(candidate.variants ?? []).map(v => v.menuCode ?? v.officialCode)]).filter((code):code is string => code !== null));
   for(const code of beverageCodes){
    const detail=verifyDetail(domain(await g.call('query-meal-detail',{...args,code})),code);details[code]=detail;cache.set(code,Promise.resolve(detail));
   }
   const snapshot=normalizeCatalog({...raw,nutrition,details},context);
   const contextKey=semanticContextKey(snapshot,store);snapshot.contextKey=contextKey;
   const rawMeals=new Map<string,Record<string,unknown>>(isRecord(raw.meals)?Object.entries(raw.meals).filter((entry):entry is [string,Record<string,unknown>]=>isRecord(entry[1])):[]);
   contexts.delete(contextKey); // Refresh the same semantic context at the newest cache position.
   contexts.set(contextKey,{snapshot,store,diningMode:'pickup',orderType:1,beType:1,rawMeals,candidates:new Map(snapshot.items.map(item=>[item.id,item])),variants:new Map(snapshot.items.flatMap(item=>(item.variants??[]).map(v=>[v.id,v] as const)))});
   detailCaches.set(contextKey,cache);
   while(contexts.size>20){const oldest=contexts.keys().next().value!;contexts.delete(oldest);detailCaches.delete(oldest);}
   return snapshot;
  },
  getContext:key=>contexts.get(key),
  async getDetail(key,code){
   const context=contexts.get(key);if(!context)throw new ApiError('CATALOG_CONTEXT_MISSING',400);
   if(!context.rawMeals.has(code)&&![...context.variants.values()].some(v=>v.officialCode===code))throw new ApiError('PRODUCT_NOT_IN_CONTEXT',400);
   const cache=detailCaches.get(key)!;let detail=cache.get(code);
   if(!detail){detail=(async()=>verifyDetail(domain(await (await gateway()).call('query-meal-detail',{storeCode:context.store.id,orderType:context.orderType,beType:context.beType,code})),code))();cache.set(code,detail);detail.catch(()=>cache.delete(code));}
   return detail;
  },
 };
}
