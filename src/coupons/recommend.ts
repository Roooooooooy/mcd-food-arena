import { basketKey } from '../cart/model.ts';
import { inspectOptions, resolveOptions, setModification, setRoundChoice, setVariant } from '../cart/options.ts';
import type { BasketLine, Candidate, CatalogSnapshot } from '../shared/contracts.ts';
import type { CouponCollection } from '../commerce/contracts.ts';

interface Atom {code:string;name:string;quantity:number;recipe:string;groups:ReturnType<typeof inspectOptions>['groups']}
export interface CouponProposal {
 couponKey:string;productID:string;optionIDs:string[];sourceBasketKey:string;sourceRevision:number;contextKey:string;
 replacement:BasketLine[];matchedCount:number;unionCount:number;percent:number;matchedFoods:string[];extraFoods:string[];
 removals:{index:number;candidateId:string;quantity:number}[];customizationChanges:string[];canApply:boolean;reason:string|null;searchComplete:boolean;
}
function recipe(groups:Atom['groups']):string {
 return JSON.stringify(groups.flatMap(g=>g.group.values.map((v,i)=>[v.code,g.quantities[i]!>0?v.selectedKey:v.unselectedKey??v.selectedKey,g.quantities[i]])).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
function describeRecipe(groups:Atom['groups']):string {
 return groups.flatMap(g=>g.group.values.flatMap((v,i)=>g.group.kind==='single'&&g.quantities[i]===0?[]:[g.quantities[i]!>0?v.name:v.name.startsWith('换')?`不${v.name}`:`不加${v.name}`])).join('、')||'沿用官方默认';
}
function atoms(item:Candidate,ids:string[]):Atom[]{
 const selected=resolveOptions(item,ids),state=inspectOptions(item,ids);
 const top=state.groups.filter(g=>!g.childId&&!(state.variant?.modificationGroups??[]).includes(g.group));
 if(state.rounds.length)return state.rounds.flatMap(r=>r.round.choices.flatMap((c,i)=>{const groups=[...top,...state.groups.filter(g=>g.childId===c.id)];return r.quantities[i]!>0?[{code:c.officialCode,name:c.name,quantity:r.quantities[i]!,recipe:recipe(groups),groups}]:[];}));
 const groups=state.groups;const code=selected.variant?.officialCode??item.officialCode;
 if(!code)throw new Error('FOOD_CODE_UNKNOWN');
 return [{code,name:selected.variant?.name??item.name,quantity:1,recipe:recipe(groups),groups}];
}
function counts(values:Atom[]):Map<string,number>{const map=new Map<string,number>();for(const a of values)map.set(a.code,(map.get(a.code)??0)+a.quantity);return map;}
const total=(m:Map<string,number>)=>[...m.values()].reduce((n,q)=>n+q,0);
/** Keep ordinary combo units indivisible and use precisely these covered servings for recipe transfer. */
function coverage(units:Atom[][],basket:BasketLine[],food:Atom[]){
 const remaining=counts(food),removals:CouponProposal['removals']=[],sources:Atom[]=[];let partial=false;
 for(let index=0;index<basket.length;index++){
  const values=units[index],unitCounts=counts(values);let covered=basket[index].quantity;
  for(const [code,q] of unitCounts)covered=Math.min(covered,Math.floor((remaining.get(code)??0)/q));
  if(covered===0){if(values.length>1&&values.some(a=>(remaining.get(a.code)??0)>0))partial=true;continue;}
  removals.push({index,candidateId:basket[index].candidateId,quantity:covered});
  for(const a of values){const quantity=a.quantity*covered;remaining.set(a.code,(remaining.get(a.code)??0)-quantity);sources.push({...a,quantity});}
 }
 return {removals,sources,partial};
}
/** Allocate exact code+recipe quantities first, then account for every remaining same-code serving. */
function allocateRecipes(sources:Atom[],targets:Atom[]){
 const from=sources.map(atom=>({atom,left:atom.quantity})),to=targets.map(atom=>({atom,left:atom.quantity}));
 const allocations:{source:Atom;target:Atom;quantity:number}[]=[];
 for(const exact of [true,false])for(const source of from)for(const target of to){
  if(source.left===0||target.left===0||source.atom.code!==target.atom.code||exact&&source.atom.recipe!==target.atom.recipe)continue;
  const quantity=Math.min(source.left,target.left);source.left-=quantity;target.left-=quantity;allocations.push({source:source.atom,target:target.atom,quantity});
 }
 return allocations;
}
function transferGroups(item:Candidate,ids:string[],target:Atom,sourceAtom:Atom):string[]{
 let next=ids;
 for(const group of target.groups){
  const source=sourceAtom.groups.find(g=>g.group.values.length===group.group.values.length&&group.group.values.every(v=>g.group.values.some(s=>s.code===v.code&&s.selectedKey===v.selectedKey&&s.unselectedKey===v.unselectedKey)));
  if(!source)continue;
  if(group.group.kind==='single'){
   const index=source.quantities.findIndex(q=>q===1),value=source.group.values[index];const dest=group.group.values.find(v=>v.code===value?.code&&v.selectedKey===value?.selectedKey);if(dest)next=setModification(item,next,dest.id,1);
  }else for(const value of group.group.values){const index=source.group.values.findIndex(v=>v.code===value.code&&v.selectedKey===value.selectedKey);const q=source.quantities[index];if(q===0||q===1)next=setModification(item,next,value.id,q);}
 }
 resolveOptions(item,next);return next;
}
/** Explore only normalized official recipes. Unknown constraints never become invented defaults. */
function recipes(item:Candidate,basketAtoms:Atom[],max:number,coveredSources:(food:Atom[])=>Atom[]){
 let complete=true,steps=0;const results:string[][]=[];const seen=new Set<string>();
 const add=(ids:string[])=>{try{resolveOptions(item,ids);const key=JSON.stringify([...ids].sort());if(!seen.has(key)){if(results.length>=max){complete=false;return;}seen.add(key);results.push(ids);}}catch{/* Unresolved official recipe is ineligible. */}};
 const transfer=(ids:string[])=>{
  add(ids);
  let targets:Atom[];try{targets=atoms(item,ids);}catch{return;}
  const allocations=allocateRecipes(coveredSources(targets),targets);let next=[...ids];
  for(const target of targets){
   const alternatives=new Map<string,{source:Atom;quantity:number}>();
   for(const match of allocations)if(match.target===target){const previous=alternatives.get(match.source.recipe);alternatives.set(match.source.recipe,{source:match.source,quantity:(previous?.quantity??0)+match.quantity});}
   // One choice's repeated servings share customization; preserve the largest compatible group.
   const desired=[...alternatives.values()].sort((a,b)=>b.quantity-a.quantity||Number(b.source.recipe===target.recipe)-Number(a.source.recipe===target.recipe));
   for(const source of desired)try{next=transferGroups(item,next,target,source.source);break;}catch{/* Keep the legal recipe; changed servings are disclosed below. */}
  }
  add(next);
 };
 try{inspectOptions(item,[]);}catch{return {results,complete:false};}
 const base=item.variants?.length?item.variants.map(v=>setVariant(item,[],v.id)):[[] as string[]];
 function walk(roundIndex:number,ids:string[]){
  if(++steps>max){complete=false;return;}
  const found=item.comboRounds?.[roundIndex];if(!found){transfer(ids);return;}const r:NonNullable<Candidate['comboRounds']>[number]=found;
  if(r.minQuantity===null||r.maxQuantity===null||r.defaultQuantity===null||r.roundId===null||r.choices.some(c=>c.defaultQuantity===null||c.maxQuantity===null)){complete=false;return;}
  const cap=r.maxQuantity===-1?Math.min(99,Math.max(r.defaultQuantity,r.minQuantity,total(counts(basketAtoms)))):r.maxQuantity;
  if(r.maxQuantity===-1)complete=false;
  function distribute(index:number,qs:number[],sum:number){
   if(++steps>max){complete=false;return;}
   if(index===r.choices.length){if(sum<r.minQuantity!||sum>cap)return;let next=ids;for(let i=0;i<qs.length;i++)next=setRoundChoice(item,next,r.choices[i].id,qs[i]);walk(roundIndex+1,next);return;}
   const c=r.choices[index],limit=c.maxQuantity===-1?Math.min(99,cap):Math.min(99,cap,c.maxQuantity!);
   // Prefer defaults first so a bounded traversal still reviews the official default.
   const values=[c.defaultQuantity!,...Array.from({length:limit+1},(_,q)=>q).filter(q=>q!==c.defaultQuantity)].filter(q=>q<=limit);
   for(const q of values)if(sum+q<=cap)distribute(index+1,[...qs,q],sum+q);
  }
  distribute(0,[],0);
 }
 for(const ids of base){transfer(ids);walk(0,ids);}
 return {results,complete};
}
export function recommendCoupons(snapshot:CatalogSnapshot,basket:BasketLine[],collection:CouponCollection,options:{maxRecipes?:number;cartRevision?:number}={}):CouponProposal[]{
 if(snapshot.mode!=='live'||snapshot.contextKey!==collection.contextKey||basket.some(l=>l.couponKey))return [];
 const byId=new Map(snapshot.items.map(i=>[i.id,i]));let units:Atom[][];
 try{units=basket.map(l=>atoms(byId.get(l.candidateId)!,l.optionIds));}catch{return [];}
 const all=units.flatMap((values,i)=>values.map(a=>({...a,quantity:a.quantity*basket[i].quantity}))),basketCounts=counts(all),proposals:CouponProposal[]=[];
 for(const coupon of collection.coupons)for(const productID of coupon.productIds){
  const item=collection.products.find(p=>p.id===productID);if(!item)continue;
  const search=recipes(item,all,Math.max(1,Math.min(2048,options.maxRecipes??512)),food=>coverage(units,basket,food).sources);let best:CouponProposal|undefined,bestChangedCount=Infinity;
  for(const optionIDs of search.results){
   const food=atoms(item,optionIDs),couponCounts=counts(food);let matchedCount=0;for(const [code,q] of basketCounts)matchedCount+=Math.min(q,couponCounts.get(code)??0);
   const unionCount=total(basketCounts)+total(couponCounts)-matchedCount,{removals,sources,partial}=coverage(units,basket,food),changed=new Map<string,{source:Atom;target:Atom;quantity:number}>(),matchedFoods:string[]=[...basketCounts].flatMap(([code,q])=>Math.min(q,couponCounts.get(code)??0)>0?[`${all.find(a=>a.code===code)!.name} × ${Math.min(q,couponCounts.get(code)??0)}`]:[]);
   for(const match of allocateRecipes(sources,food))if(match.source.recipe!==match.target.recipe){const key=JSON.stringify([match.source.code,match.source.recipe,match.target.recipe]);const previous=changed.get(key);changed.set(key,{...match,quantity:(previous?.quantity??0)+match.quantity});}
   const changes=[...changed.values()].map(({source,target,quantity})=>`${source.name} × ${quantity}：原餐品为「${describeRecipe(source.groups)}」，券内为「${describeRecipe(target.groups)}」。`),changedCount=[...changed.values()].reduce((n,c)=>n+c.quantity,0);
   const extraFoods=[...couponCounts].flatMap(([code,q])=>q-(basketCounts.get(code)??0)>0?[`${food.find(a=>a.code===code)!.name} × ${q-(basketCounts.get(code)??0)}`]:[]);
   const replacement=basket.flatMap((l,index)=>{const q=l.quantity-(removals.find(r=>r.index===index)?.quantity??0);return q>0?[{...l,quantity:q,optionIds:[...l.optionIds]}]:[];});
   replacement.push({candidateId:productID,quantity:1,optionIds:[...optionIDs],couponKey:coupon.key});
   const canApply=coupon.availableAtStore&&!partial&&removals.length>0;
   const p:CouponProposal={couponKey:coupon.key,productID,optionIDs,sourceBasketKey:basketKey(basket),sourceRevision:options.cartRevision??0,contextKey:snapshot.contextKey,replacement,matchedCount,unionCount,percent:unionCount?matchedCount/unionCount*100:0,matchedFoods,extraFoods,removals,customizationChanges:changes,canApply,reason:!coupon.availableAtStore?'当前门店不可用':partial?'原套餐只能整份保留，不能拆出部分餐品用券。':!removals.length?'没有可安全替换的餐品。':null,searchComplete:search.complete};
   if(!best||p.percent>best.percent||p.percent===best.percent&&(Number(p.canApply)>Number(best.canApply)||p.canApply===best.canApply&&changedCount<bestChangedCount)){best=p;bestChangedCount=changedCount;}
  }
  if(best)proposals.push(best);
 }
 return proposals.sort((a,b)=>b.percent-a.percent);
}
export interface CouponBasketState {basket:BasketLine[];revision:number;applied:{before:BasketLine[];removed:BasketLine[];appliedKey:string;revision:number}|null}
export const createCouponBasket=(basket:BasketLine[]):CouponBasketState=>({basket:structuredClone(basket),revision:0,applied:null});
export function applyCoupon(state:CouponBasketState,p:CouponProposal):CouponBasketState {
 if(!p.canApply||state.applied||state.revision!==p.sourceRevision||basketKey(state.basket)!==p.sourceBasketKey)throw new Error('STALE_COUPON_PROPOSAL');
 const basket=structuredClone(p.replacement),revision=state.revision+1;
 return {basket,revision,applied:{before:structuredClone(state.basket),removed:p.removals.map(r=>({...state.basket[r.index],quantity:r.quantity})),appliedKey:basketKey(basket),revision}};
}
export function editCouponBasket(state:CouponBasketState,basket:BasketLine[]):CouponBasketState{
 for(const removed of state.applied?.removed??[]){const current=basket.find(l=>l.candidateId===removed.candidateId&&!l.couponKey);if(current&&(current.quantity+removed.quantity>99||JSON.stringify([...current.optionIds].sort())!==JSON.stringify([...removed.optionIds].sort())))throw new Error('COVERED_LINE_REQUIRES_RESTORE');}
 return {...state,basket:structuredClone(basket),revision:state.revision+1};
}
export const canUndoCoupon=(state:CouponBasketState)=>!!state.applied&&state.revision===state.applied.revision&&basketKey(state.basket)===state.applied.appliedKey;
export function undoCoupon(state:CouponBasketState):CouponBasketState {if(!canUndoCoupon(state))throw new Error('STALE_COUPON_UNDO');return {basket:structuredClone(state.applied!.before),revision:state.revision+1,applied:null};}
/** Before category review, return covered winners and retain edits to all surviving ordinary lines. */
export function restoreCoveredBasket(state:CouponBasketState):CouponBasketState {
 if(!state.applied)return state;
 const basket=structuredClone(state.basket.filter(l=>!l.couponKey));
 for(const removed of state.applied.removed){const current=basket.find(l=>l.candidateId===removed.candidateId&&JSON.stringify([...l.optionIds].sort())===JSON.stringify([...removed.optionIds].sort()));if(current)current.quantity+=removed.quantity;else basket.push(structuredClone(removed));}
 // Original order keeps reconciliation and export stable.
 basket.sort((a,b)=>state.applied!.before.findIndex(l=>l.candidateId===a.candidateId)-state.applied!.before.findIndex(l=>l.candidateId===b.candidateId));
 return {basket,revision:state.revision+1,applied:null};
}
