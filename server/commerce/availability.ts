import { isRecord } from '../../src/catalog/normalize.ts';
import { normalizeModification } from '../../src/catalog/option-metadata.ts';
import { inspectOptions } from '../../src/cart/options.ts';
import { availabilityLabel, type AvailabilityItem, type AvailabilityResult, type AvailabilityState, type BasketAvailabilityRequest, type CandidateAvailabilityRequest } from '../../src/commerce/availability-contracts.ts';
import type { Candidate, Variant } from '../../src/shared/contracts.ts';
import { ApiError } from '../app.ts';
import type { UserSession } from './session.ts';
import type { CouponService } from './coupons.ts';
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const fail=(code:string):never=>{throw new ApiError(code,400);};
function domain(raw:unknown):unknown {
 if(!isRecord(raw)||!Object.hasOwn(raw,'data')||raw.success===false||(raw.code!==undefined&&raw.code!==200))throw new Error('UNCONFIRMED_SOURCE');
 return raw.data;
}
function menuCodes(raw:unknown):Set<string> {
 if(!isRecord(raw)||!Array.isArray(raw.categories)||!isRecord(raw.meals))throw new Error('UNCONFIRMED_SOURCE');
 const refs=new Set<string>();
 for(const category of raw.categories){
  if(!isRecord(category)||!text(category.name)||!Array.isArray(category.meals))throw new Error('UNCONFIRMED_SOURCE');
  for(const ref of category.meals){if(!isRecord(ref)||!text(ref.code))throw new Error('UNCONFIRMED_SOURCE');refs.add(ref.code);}
 }
 const meals=raw.meals as Record<string,unknown>;const codes=Object.keys(meals);
 if(refs.size!==codes.length||codes.some(code=>!refs.has(code)||!text(code)||!isRecord(meals[code])||!text((meals[code] as Record<string,unknown>).name)))throw new Error('UNCONFIRMED_SOURCE');
 return new Set(codes);
}
function detailData(raw:unknown,code:string):Record<string,unknown>{
 if(!isRecord(raw)||raw.code!==code||!text(raw.name)||!Array.isArray(raw.rounds))throw new Error('UNCONFIRMED_SOURCE');
 const seen=new Set<number>();
 for(const r of raw.rounds){
  if(!isRecord(r)||!Number.isSafeInteger(r.id)||(r.id as number)<=0||seen.has(r.id as number)||!text(r.name)||!Array.isArray(r.choices))throw new Error('UNCONFIRMED_SOURCE');seen.add(r.id as number);
  const codes=new Set<string>();for(const c of r.choices){if(!isRecord(c)||!text(c.code)||!text(c.name)||codes.has(c.code))throw new Error('UNCONFIRMED_SOURCE');codes.add(c.code);}
 }
 return raw;
}
function childState(detail:Record<string,unknown>|undefined,roundId:number,code:string):AvailabilityState {
 if(!detail)return 'unknown';
 const round=(detail.rounds as Record<string,unknown>[]).find(r=>r.id===roundId);
 return round&&(round.choices as Record<string,unknown>[]).some(c=>c.code===code)?'listed':'not-returned';
}
const aggregate=(states:AvailabilityState[]):AvailabilityState=>states.includes('listed')?'listed':states.includes('unknown')?'unknown':'not-returned';
export function createAvailabilityService(user:UserSession,coupons:CouponService){
 const cache=new Map<string,{at:number;value:unknown}>(),pending=new Map<string,Promise<unknown>>();
 async function source(contextKey:string,kind:string,args:Record<string,unknown>,verify:(raw:unknown)=>unknown):Promise<unknown>{
  const key=JSON.stringify([contextKey,kind,args.code??'']);const old=cache.get(key);if(old&&Date.now()-old.at<30_000)return old;
  if(pending.has(key))return pending.get(key);
  const work=(async()=>{try{const value=verify(domain(await (await user.gateway()).call(kind,args)));user.assertActive();const entry={at:Date.now(),value};cache.set(key,entry);while(cache.size>1000)cache.delete(cache.keys().next().value!);return entry;}catch{user.assertActive();return undefined;}})();
  pending.set(key,work);try{return await work;}finally{pending.delete(key);}
 }
 function context(key:string){user.assertActive();const c=user.catalog.getContext(key);if(!c||c.snapshot.mode!=='live'||!c.snapshot.complete)fail('CATALOG_CONTEXT_MISSING');return c!;}
 async function check(contextKey:string,targets:{candidate:Candidate;coupon?:{couponId:string;couponCode:string};optionIds?:string[]}[]):Promise<AvailabilityResult>{
  const current=context(contextKey),args={storeCode:current.store.id,orderType:current.orderType,beType:current.beType};
  const observed:number[]=[];
  async function checked(kind:string,args:Record<string,unknown>,verify:(raw:unknown)=>unknown){const entry=await source(contextKey,kind,args,verify) as {at:number;value:unknown}|undefined;if(entry)observed.push(entry.at);return entry?.value;}
  const hasNormal=targets.some(t=>!t.coupon),hasCoupon=targets.some(t=>t.coupon);
  const menu=hasNormal?await checked('query-meals',args,menuCodes) as Set<string>|undefined:undefined;
  const store=hasCoupon?await checked('query-store-coupons',args,raw=>{
   if(!Array.isArray(raw)||raw.length>1000||raw.some(c=>!isRecord(c)||!text(c.couponId)||!text(c.couponCode)||!Array.isArray(c.products)||c.products.some(p=>!isRecord(p)||!text(p.productCode)||!text(p.productName))))throw new Error('UNCONFIRMED_SOURCE');return raw;
  }) as Record<string,unknown>[]|undefined:undefined;
  const now=new Date().toISOString();
  const items=await Promise.all(targets.map(async({candidate,coupon,optionIds})=>{
   const detail=async(code:string)=>await checked('query-meal-detail',{...args,code},raw=>detailData(raw,code)) as Record<string,unknown>|undefined;
   let state:AvailabilityState='unknown';const variants:NonNullable<AvailabilityItem['variants']>=[];
   const parentState=(code:string):AvailabilityState=>!menu?'unknown':menu.has(code)?'listed':'not-returned';
   if(coupon){
    if(store){const matches=store.filter(s=>s.couponId===coupon.couponId&&s.couponCode===coupon.couponCode);state=matches.length===0?'not-returned':matches.length!==1?'unknown':(matches[0].products as Record<string,unknown>[]).some(p=>p.productCode===candidate.officialCode)?'listed':'not-returned';}
   }else if(candidate.variants?.length){
    for(const v of candidate.variants){const code=v.menuCode??v.officialCode;let status=parentState(code);if(status==='listed'&&v.roundId!==undefined)status=childState(await detail(code),v.roundId,v.officialCode);variants.push({variantId:v.id,state:status,label:availabilityLabel(status)});}state=aggregate(variants.map(v=>v.state));
   }else if(candidate.officialCode)state=parentState(candidate.officialCode);
   const inspected=optionIds===undefined?undefined:inspectOptions(candidate,optionIds);
   const code=inspected?.variant?.menuCode??inspected?.variant?.officialCode??candidate.officialCode??candidate.variants?.[0]?.menuCode;
   // Basket checks are exact selected options. Candidate checks never demand a default recipe.
   const needsDetail=state==='listed'&&(!!coupon||!!candidate.comboRounds?.length||optionIds!==undefined&&!!(candidate.modificationGroups?.length||candidate.variants?.some(v=>v.modificationGroups?.length)));
   const currentDetail=needsDetail&&code?await detail(code):undefined;
   if(needsDetail&&!currentDetail)state='unknown';
   if(currentDetail){for(const round of candidate.comboRounds??[])for(const choice of round.choices){const status=round.roundId===null?'unknown':childState(currentDetail,round.roundId,choice.officialCode);variants.push({variantId:choice.id,state:status,label:availabilityLabel(status,coupon!==undefined)});}}
   if(optionIds!==undefined&&state!=='not-returned'){
    const selection=inspected!;
    if(selection.variant){const status=variants.find(v=>v.variantId===selection.variant!.id)?.state;if(status==='not-returned')state=status;else if(status==='unknown')state='unknown';}
    for(const r of selection.rounds)for(let i=0;i<r.round.choices.length;i++)if((r.quantities[i]??0)>0){const status=variants.find(v=>v.variantId===r.round.choices[i].id)?.state;if(status==='not-returned')state=status;else if(status==='unknown'&&state!=='not-returned')state='unknown';}
   }
   if(inspected&&currentDetail&&state!=='not-returned'){
    for(const group of inspected.groups){
      let owner:Record<string,unknown>|undefined=currentDetail;
      if(group.childId){const r=inspected.rounds.find(r=>r.round.choices.some(c=>c.id===group.childId));const c=r?.round.choices.find(c=>c.id===group.childId);const round=(currentDetail.rounds as Record<string,unknown>[]).find(v=>v.id===r?.round.roundId);owner=(round?.choices as Record<string,unknown>[]|undefined)?.find(v=>v.code===c?.officialCode);}
      else if(inspected.variant?.modificationGroups?.includes(group.group)&&inspected.variant.roundId!==undefined){const round=(currentDetail.rounds as Record<string,unknown>[]).find(r=>r.id===inspected.variant!.roundId);owner=(round?.choices as Record<string,unknown>[]|undefined)?.find(c=>c.code===inspected.variant!.officialCode);}
      const fresh=owner?normalizeModification(owner.modification,'availability',owner.supportModify):undefined;
      for(let i=0;i<group.group.values.length;i++){
        const value=group.group.values[i],q=group.quantities[i];
        const status:AvailabilityState=!fresh||fresh.some(g=>g.kind==='unavailable')?'unknown':fresh.some(g=>g.values.some(v=>v.code===value.code&&v.selectedKey===value.selectedKey&&v.unselectedKey===value.unselectedKey))?'listed':'not-returned';
        variants.push({variantId:value.id,state:status,label:availabilityLabel(status,!!coupon)});
        // Only explicit wire edits require the old customization identity. Defaults belong to the current official recipe.
        if(inspected.quantities.has(`mod:${value.id}`)&&(group.group.kind==='toggles'||(q??0)>0)){if(status==='not-returned')state=status;else if(status==='unknown'&&state!=='not-returned')state='unknown';}
      }
    }
   }
   return {candidateId:candidate.id,state,label:availabilityLabel(state,!!coupon),checkedAt:state==='unknown'?null:now,...(variants.length?{variants}:{})};
  }));user.assertActive();const checkedAt=observed.length?new Date(Math.min(...observed)).toISOString():now;for(const item of items)if(item.checkedAt)item.checkedAt=checkedAt;return {contextKey,checkedAt,items};
 }
 return {
  async candidates(request:CandidateAvailabilityRequest){context(request?.contextKey);if(!Array.isArray(request.candidateIds)||request.candidateIds.length>200||request.candidateIds.some(id=>!text(id))||new Set(request.candidateIds).size!==request.candidateIds.length)fail('INVALID_REQUEST');const targets=request.candidateIds.map(id=>coupons.availabilityCandidate(request.contextKey,id));return check(request.contextKey,targets);},
  async basket(request:BasketAvailabilityRequest){coupons.prepare(request,true);const targets=request.basket.map(l=>({...coupons.availabilityCandidate(request.contextKey,l.candidateId,l.couponKey),optionIds:l.optionIds}));return check(request.contextKey,targets);},
  async assertBasket(request:BasketAvailabilityRequest){const result=await this.basket(request);if(result.items.some(i=>i.state==='not-returned'))throw new ApiError('CURRENTLY_UNAVAILABLE',409);return result;},
 };
}
export type AvailabilityService=ReturnType<typeof createAvailabilityService>;
