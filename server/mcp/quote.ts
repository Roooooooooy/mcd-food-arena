import { inspectOptions, resolveOptions, type WireRound, type WireModification } from '../../src/cart/options.ts';
import type { BasketLine, BasketSelection, Candidate, QuoteRequest, QuoteResult, Variant } from '../../src/shared/contracts.ts';
import { basketKey } from '../../src/cart/model.ts';
import { isRecord } from '../../src/catalog/normalize.ts';
import { ApiError } from '../app.ts';
import type { CatalogContext, CatalogService } from './catalog.ts';
import type { McpGateway } from './gateway.ts';
interface Product { productCode:string; quantity:number; roundList?:WireRound[]; modification?:WireModification }
const fail = (code:string,status=400):never => { throw new ApiError(code,status); };
const positive = (n:unknown):n is number => Number.isSafeInteger(n) && (n as number)>0;
function validate(request:QuoteRequest,catalog:CatalogService):{context:CatalogContext;lines:{line:BasketLine;candidate:Candidate;variant?:Variant;code:string}[]} {
  if(!request || typeof request.contextKey!=='string' || !Number.isSafeInteger(request.cartRevision) || request.cartRevision<0 || !Array.isArray(request.basket) || request.basket.length<1 || request.basket.length>50) return fail('INVALID_BASKET');
  const context=catalog.getContext(request.contextKey);
  if(!context || context.snapshot.mode!=='live' || !context.snapshot.complete) return fail('CATALOG_CONTEXT_MISSING');
  const seen=new Set<string>();
  const lines=request.basket.map(line=>{
    if(!line || !positive(line.quantity) || line.quantity>99 || !Array.isArray(line.optionIds) || line.optionIds.length>600 || line.optionIds.some(id=>typeof id!=='string')) return fail('INVALID_BASKET');
    if(seen.has(line.candidateId))return fail('DUPLICATE_BASKET_LINE');seen.add(line.candidateId);
    const candidate=context.candidates.get(line.candidateId);if(!candidate || candidate.mode!=='live')return fail('PRODUCT_NOT_IN_CONTEXT');
    let variant:Variant|undefined;
    try { variant=inspectOptions(candidate,line.optionIds).variant; }
    catch(error){return fail(error instanceof Error?error.message:'OPTION_NOT_IN_CONTEXT');}
    const code=variant?.menuCode ?? variant?.officialCode ?? candidate.officialCode;
    if(!code || !context.rawMeals.has(code))return fail('PRODUCT_NOT_IN_CONTEXT');
    return {line,candidate,variant,code};
  });
  return {context,lines};
}
function price(value:unknown):number { if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return fail('QUOTE_INVALID_AMOUNT',502);return value; }
export function createQuoteService(catalog:CatalogService,source:McpGateway|(()=>Promise<McpGateway>)) {
  const gateway=async()=>typeof source==='function'?await source():source;
  async function resolve(request:QuoteRequest,allowRequired:boolean){
    // Validate the entire normalized basket before any detail or calculate-price call.
    const {context,lines}=validate(request,catalog);const items:Product[]=[];const selections:BasketSelection[]=[];
    for(const {line,candidate,code} of lines){
      try {
        const {roundList,modification,components}=resolveOptions(candidate,line.optionIds);
        items.push({productCode:code,quantity:line.quantity,...(roundList.length?{roundList}:{}),...(modification?{modification}:{})});
        selections.push({candidateId:line.candidateId,components,requiresSelection:false});
      }catch(error){
        const code=error instanceof Error?error.message:'SELECTION_REQUIRED';
        if(!allowRequired || code!=='SELECTION_REQUIRED')return fail(code);
        selections.push({candidateId:line.candidateId,components:[],requiresSelection:true});
      }
    }
    return {context,items,selections};
  }
  return {
    async selection(request:QuoteRequest):Promise<BasketSelection[]> {return (await resolve(request,true)).selections;},
    async quoteBasket(request:QuoteRequest):Promise<QuoteResult> {
      const {context,items}=await resolve(request,false);
      const raw=await (await gateway()).call('calculate-price',{storeCode:context.store.id,orderType:context.orderType,beType:context.beType,items,needTableware:false});
      if(!isRecord(raw)||raw.success!==true||raw.code!==200||!isRecord(raw.data))return fail('QUOTE_UNAVAILABLE',502);
      const totalCents=price(raw.data.price);
      const fees:QuoteResult['fees']=[];
      for(const [field,label] of [['deliveryPrice','配送费'],['packingPrice','打包费'],['tablewarePrice','餐具费']] as const){
        if(Object.hasOwn(raw.data,field))fees.push({label,amountCents:price(raw.data[field])});
      }
      return {contextKey:request.contextKey,basketKey:basketKey(request.basket),cartRevision:request.cartRevision,totalCents,currency:'CNY',quotedAt:new Date().toISOString(),mode:'live',evidence:'official',fees};
    },
  };
}
