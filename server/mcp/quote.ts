import type { BasketLine, BasketSelection, Candidate, QuoteRequest, QuoteResult, Variant } from '../../src/shared/contracts.ts';
import { basketKey } from '../../src/cart/model.ts';
import { isRecord } from '../../src/catalog/normalize.ts';
import { ApiError } from '../app.ts';
import type { CatalogContext, CatalogService } from './catalog.ts';
import type { McpGateway } from './gateway.ts';
interface Round { round: string; comboItemList: {code:string;quantity:number}[] }
interface Product { productCode:string; quantity:number; roundList?:Round[] }
const fail = (code:string,status=400):never => { throw new ApiError(code,status); };
const positive = (n:unknown):n is number => Number.isSafeInteger(n) && (n as number)>0;
function validate(request:QuoteRequest,catalog:CatalogService):{context:CatalogContext;lines:{line:BasketLine;candidate:Candidate;variant?:Variant;code:string}[]} {
  if(!request || typeof request.contextKey!=='string' || !Number.isSafeInteger(request.cartRevision) || request.cartRevision<0 || !Array.isArray(request.basket) || request.basket.length<1 || request.basket.length>50) return fail('INVALID_BASKET');
  const context=catalog.getContext(request.contextKey);
  if(!context || context.snapshot.mode!=='live' || !context.snapshot.complete) return fail('CATALOG_CONTEXT_MISSING');
  const seen=new Set<string>();
  const lines=request.basket.map(line=>{
    if(!line || !positive(line.quantity) || line.quantity>99 || !Array.isArray(line.optionIds) || line.optionIds.length>1 || line.optionIds.some(id=>typeof id!=='string')) return fail('INVALID_BASKET');
    if(seen.has(line.candidateId))return fail('DUPLICATE_BASKET_LINE');seen.add(line.candidateId);
    const candidate=context.candidates.get(line.candidateId);if(!candidate || candidate.mode!=='live')return fail('PRODUCT_NOT_IN_CONTEXT');
    let variant:Variant|undefined;
    const token=line.optionIds[0];
    if(token && !token.startsWith('variant:'))return fail('OPTION_NOT_IN_CONTEXT');
    const variantId=token?.slice('variant:'.length) ?? candidate.defaultVariantId;
    if(variantId){
      const own=candidate.variants?.find(v=>v.id===variantId);variant=context.variants.get(variantId);
      if(!own || !variant || own.officialCode!==variant.officialCode || own.menuCode!==variant.menuCode || own.roundId!==variant.roundId)return fail('OPTION_NOT_IN_CONTEXT');
    } else if(candidate.variants?.length)return fail('SELECTION_REQUIRED');
    if(token && !variant)return fail('OPTION_NOT_IN_CONTEXT');
    const code=variant?.menuCode ?? variant?.officialCode ?? candidate.officialCode;
    if(!code || !context.rawMeals.has(code))return fail('PRODUCT_NOT_IN_CONTEXT');
    return {line,candidate,variant,code};
  });
  return {context,lines};
}
function roundsFor(detail:Record<string,unknown>,variant?:Variant):{roundList:Round[];components:BasketSelection['components']} {
  if(!Array.isArray(detail.rounds))return fail('CATALOG_INVALID_DETAIL',502);
  const result:Round[]=[];const components:BasketSelection['components']=[];const seen=new Set<string>();
  for(const raw of detail.rounds){
    if(!isRecord(raw) || !positive(raw.id) || seen.has(String(raw.id)) || !Array.isArray(raw.choices))return fail('CATALOG_INVALID_DETAIL',502);
    seen.add(String(raw.id));
    const choices=raw.choices;
    if(Object.hasOwn(raw,'quantity') && (!Number.isSafeInteger(raw.quantity) || (raw.quantity as number)<0))return fail('SELECTION_REQUIRED');
    const explicitVariant=variant?.roundId===raw.id;
    if(!explicitVariant){
      // Validate all declared defaults before filtering, so invalid ones cannot disappear.
      for(const choice of choices){
        if(!isRecord(choice) || !Number.isSafeInteger(choice.quantity) || (choice.quantity as number)<0 || (choice.isDefault!==0 && choice.isDefault!==1))return fail('SELECTION_REQUIRED');
        if((choice.isDefault===1)!==positive(choice.quantity))return fail('SELECTION_REQUIRED');
      }
    }
    const selected=explicitVariant ? choices.filter(c=>isRecord(c)&&c.code===variant!.officialCode).map(c=>({...c as Record<string,unknown>,quantity:1})) : choices.filter(c=>isRecord(c)&&c.isDefault===1&&positive(c.quantity));
    if(explicitVariant && selected.length!==1)return fail('OPTION_NOT_IN_CONTEXT');
    const items:{code:string;quantity:number}[]=[];
    for(const choice of selected){
      if(!isRecord(choice) || typeof choice.code!=='string' || !choice.code || typeof choice.name!=='string' || !positive(choice.quantity))return fail('CATALOG_INVALID_DETAIL',502);
      if(typeof choice.maxQuantity!=='number' || (!Number.isSafeInteger(choice.maxQuantity)) || (choice.maxQuantity!==-1 && choice.quantity>choice.maxQuantity))return fail('SELECTION_REQUIRED');
      items.push({code:choice.code,quantity:choice.quantity});components.push({name:choice.name,quantity:choice.quantity});
    }
    const quantity=items.reduce((n,c)=>n+c.quantity,0);
    if(!Number.isSafeInteger(raw.minQuantity) || !Number.isSafeInteger(raw.maxQuantity) || (raw.minQuantity as number)<0 || ((raw.maxQuantity as number)!==-1 && (raw.maxQuantity as number)<(raw.minQuantity as number)))return fail('SELECTION_REQUIRED');
    if(quantity<(raw.minQuantity as number) || ((raw.maxQuantity as number)!==-1 && quantity>(raw.maxQuantity as number)) || (Object.hasOwn(raw,'quantity')&&quantity!==raw.quantity))return fail('SELECTION_REQUIRED');
    if(items.length)result.push({round:String(raw.id),comboItemList:items});
  }
  if(variant?.roundId!==undefined && !seen.has(String(variant.roundId)))return fail('OPTION_NOT_IN_CONTEXT');
  return {roundList:result,components};
}
function price(value:unknown):number { if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)return fail('QUOTE_INVALID_AMOUNT',502);return value; }
export function createQuoteService(catalog:CatalogService,source:McpGateway|(()=>Promise<McpGateway>)) {
  const gateway=async()=>typeof source==='function'?await source():source;
  async function resolve(request:QuoteRequest,allowRequired:boolean){
    // Validate the entire normalized basket before any detail or calculate-price call.
    const {context,lines}=validate(request,catalog);const items:Product[]=[];const selections:BasketSelection[]=[];
    for(const {line,variant,code} of lines){
      const detail=await catalog.getDetail(request.contextKey,code);
      try {
        const {roundList,components}=roundsFor(detail,variant);
        items.push({productCode:code,quantity:line.quantity,...(roundList.length?{roundList}:{})});
        selections.push({candidateId:line.candidateId,components:components.length?components:variant?[{name:variant.name,quantity:1}]:[],requiresSelection:false});
      }catch(error){
        if(!allowRequired || !(error instanceof ApiError) || error.code!=='SELECTION_REQUIRED')throw error;
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
