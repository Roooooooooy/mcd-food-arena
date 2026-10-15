import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceFixture } from './commerce-fixture.ts';
import { sampleQuote, basketKey, reconcileBasket } from '../src/cart/model.ts';
import { setRoundChoice } from '../src/cart/options.ts';
import type { Candidate, BasketLine } from '../src/shared/contracts.ts';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../src/catalog/normalize.ts';
import { resolveOptions, setModification } from '../src/cart/options.ts';

async function model() { const module = await import('../src/coupons/recommend.ts').catch(() => null); assert.ok(module, 'recommendation model must exist'); return module; }
const line = (c: Candidate, quantity = 1): BasketLine => ({candidateId:c.id,quantity,optionIds:[]});
test('exact parent-round child recipes match two of three foods and preserve unrelated quantity/options', async t => {
 const f=await commerceFixture(t), c=(await f.coupons()).json(), m=await model();
 const fries=f.snapshot.items.find((i:Candidate)=>i.name==='中薯条'), pie=f.snapshot.items.find((i:Candidate)=>i.name==='菠萝派');
 const burger:Candidate={...fries,id:'burger',officialCode:'1100',name:'巨无霸',stageId:'burger'};
 const basket=[line(fries),line(pie),line(burger)];
 const p=m.recommendCoupons({...f.snapshot,items:[...f.snapshot.items,burger]},basket,c)[0];
 assert.equal(p.matchedCount,2);assert.equal(p.unionCount,3);assert.equal(p.percent,2/3*100);
 assert.deepEqual(p.replacement.filter(l=>!l.couponKey),[line(burger)]);
 assert.deepEqual(p.removals.map(r=>r.quantity),[1,1]);assert.equal(p.canApply,true);
 const selected=c.products[0].comboRounds.flatMap((r:any)=>r.choices).filter((v:any)=>['4810','4105'].includes(v.officialCode));
 let ids:string[]=[];for(const choice of selected)ids=setRoundChoice(c.products[0],ids,choice.id,1);
 assert.deepEqual([...p.optionIDs].sort(),[...ids].sort());
});
test('fries quantity two and single-food coupon one give 1/2 and only remove one',async t=>{
 const f=await commerceFixture(t);f.state.detail={code:'9900016371',name:'中薯条券',rounds:[]};
 const c=(await f.coupons()).json();c.products[0].officialCode='4810';const fries=f.snapshot.items.find((i:Candidate)=>i.name==='中薯条');
 const p=(await model()).recommendCoupons(f.snapshot,[line(fries,2)],c)[0];
 assert.equal(p.matchedCount,1);assert.equal(p.unionCount,2);assert.equal(p.percent,50);assert.equal(p.replacement.find(l=>!l.couponKey)?.quantity,1);
});
test('cola vs zero, sizes and fixed pie flavors require exact food codes',async t=>{
 const f=await commerceFixture(t), c=(await f.coupons()).json(), m=await model();
 const base=f.snapshot.items[0];const drinks=[{...base,id:'zero',name:'无糖可乐',officialCode:'3071'},{...base,id:'large',name:'大可乐',officialCode:'3060'}];
 const p=m.recommendCoupons({...f.snapshot,items:drinks},drinks.map(i=>line(i)),c)[0];assert.equal(p.matchedCount,1);assert.ok(p.matchedFoods.some(s=>s.includes('无糖')));assert.ok(p.extraFoods.length>0);
 const pie=f.snapshot.items.find((i:Candidate)=>i.name==='香芋派');const flavor=m.recommendCoupons(f.snapshot,[line(pie)],c)[0];assert.equal(flavor.matchedCount,1);assert.ok(flavor.matchedFoods.some(s=>s.includes('香芋')));
});
test('partial ordinary combos are never silently split',async t=>{
 const f=await commerceFixture(t), c=(await f.coupons()).json(), m=await model();
 const combo:Candidate={...c.products[0],id:'ordinary-combo',officialCode:'ordinary',stageId:'side'};
 combo.comboRounds=structuredClone(combo.comboRounds);combo.comboRounds![1].choices=[{...combo.comboRounds![1].choices[0],officialCode:'burger-only',name:'汉堡'}];
 const p=m.recommendCoupons({...f.snapshot,items:[combo]},[line(combo)],c)[0];assert.equal(p.matchedCount,1);assert.ok(p.matchedFoods.some(s=>s.includes('麦辣鸡翅')));assert.equal(p.canApply,false);assert.deepEqual(p.replacement.filter(l=>!l.couponKey),[line(combo)]);
});
test('bounded official recipe traversal reports incomplete and does not claim global best',async t=>{
 const f=await commerceFixture(t),c=(await f.coupons()).json();const p=(await model()).recommendCoupons(f.snapshot,[line(f.snapshot.items[0])],c,{maxRecipes:1})[0];assert.equal(p.searchComplete,false);
});
test('application is revision-aware, guarded undo and review restore covered winners while keeping later unrelated edits',async t=>{
 const f=await commerceFixture(t),c=(await f.coupons()).json(),m=await model();const fries=f.snapshot.items.find((i:Candidate)=>i.name==='中薯条'),pie=f.snapshot.items.find((i:Candidate)=>i.name==='菠萝派');
 const unrelated:Candidate={...fries,id:'other',officialCode:'other',name:'其他'};const snapshot={...f.snapshot,items:[...f.snapshot.items,unrelated]};const original=[line(fries),line(pie),line(unrelated)];
 const p=m.recommendCoupons(snapshot,original,c)[0];let state=m.createCouponBasket(original);state=m.applyCoupon(state,p);assert.equal(state.basket.filter(l=>l.couponKey).length,1);assert.ok(m.canUndoCoupon(state));
 assert.deepEqual(m.undoCoupon(state).basket,original);
 state=m.editCouponBasket(state,state.basket.map(l=>l.candidateId===unrelated.id?{...l,quantity:2}:l));assert.equal(m.canUndoCoupon(state),false);assert.throws(()=>m.undoCoupon(state));
 const restored=m.restoreCoveredBasket(state);assert.equal(restored.basket.find(l=>l.candidateId===fries.id)?.quantity,1);assert.equal(restored.basket.find(l=>l.candidateId===unrelated.id)?.quantity,2);
 assert.deepEqual(reconcileBasket(restored.basket,original.map(l=>l.candidateId),original.map(l=>l.candidateId),snapshot),restored.basket);
 assert.throws(()=>m.applyCoupon(m.createCouponBasket([line(fries,2)]),p),/STALE/);
});
test('frozen sample calculation rejects personal coupon keys',()=>{
 const item:Candidate={id:'x',officialCode:'4810',name:'薯条',stageId:'side',sourceCategory:'小食',imageUrl:null,referencePriceCents:1400,attributes:[],nutrition:{},mode:'demo'};
 assert.throws(()=>sampleQuote({contextKey:'demo',cartRevision:1,basket:[{candidateId:'x',quantity:1,optionIds:[],couponKey:'private'}]},{contextKey:'demo',mode:'demo',complete:true,loadedAt:'now',store:null,items:[item]}));
});
test('benefit description is preserved as text without interpreting discountValue as a price',async t=>{
 const f=await commerceFixture(t);(f.state.wallet[0] as any).discountInfo={discountDesc:'小食二选一，详见券面',discountValue:'1590'};const c=(await f.coupons()).json();assert.equal(c.coupons[0].benefitText,'小食二选一，详见券面');assert.equal(c.products[0].referencePriceCents,null);
});
test('covered customization differences name the original recipe and leave unrelated customized lines intact',async t=>{
 const f=await commerceFixture(t),raw=JSON.parse(readFileSync(new URL('./fixtures/menu-options.json',import.meta.url),'utf8'));
 const foods=normalizeCatalog(raw,{contextKey:f.snapshot.contextKey,store:f.snapshot.store,loadedAt:'now',complete:true});const burger=foods.items.find(i=>i.officialCode==='1100')!;
 f.state.detail={code:'9900016371',name:'汉堡券',rounds:[]};const c=(await f.coupons()).json();c.products[0].officialCode='1100';
 const value=burger.modificationGroups![0].values.find(v=>v.name==='酸黄瓜')!;const customized={...line(burger),optionIds:setModification(burger,[],value.id,0)};
 const other={...burger,id:'unrelated',officialCode:'unrelated'};const untouched={...line(other,2),optionIds:[...customized.optionIds]};
 const p=(await model()).recommendCoupons({...foods,items:[burger,other]},[customized,untouched],c)[0];assert.equal(p.canApply,true);assert.match(p.customizationChanges.join(' '),/不加酸黄瓜/);assert.deepEqual(p.replacement.find(l=>l.candidateId===other.id),untouched);
});
test('compatible coupon customization is transferred through official setters rather than changing the recipe',async t=>{
 const f=await commerceFixture(t),raw=JSON.parse(readFileSync(new URL('./fixtures/menu-options.json',import.meta.url),'utf8'));
 const foods=normalizeCatalog(raw,{contextKey:f.snapshot.contextKey,store:f.snapshot.store,loadedAt:'now',complete:true});const burger=foods.items.find(i=>i.officialCode==='1100')!;
 f.state.detail={...raw.details['1100'],code:'9900016371',name:'汉堡券',rounds:[],supportModify:true};const c=(await f.coupons()).json();c.products[0].officialCode='1100';
 const value=burger.modificationGroups![0].values.find(v=>v.name==='酸黄瓜')!;const p=(await model()).recommendCoupons(foods,[{...line(burger),optionIds:setModification(burger,[],value.id,0)}],c)[0];
 assert.deepEqual(p.customizationChanges,[]);assert.ok(resolveOptions(c.products[0],p.optionIDs).modification!.values.some(v=>v.code==='100202'&&v.key==='0-0'&&v.quantity===0));
});
test('an edit invalidates a previous proposal even if the basket returns to identical contents',async t=>{
 const f=await commerceFixture(t),c=(await f.coupons()).json(),m=await model(),basket=[line(f.snapshot.items[0])];const p=m.recommendCoupons(f.snapshot,basket,c)[0];const edited=m.editCouponBasket(m.createCouponBasket(basket),basket);assert.throws(()=>m.applyCoupon(edited,p),/STALE/);
});
test('partially covered ordinary lines cannot change recipe or exceed restorable quantity; unrelated edits stay legal',async t=>{
 const f=await commerceFixture(t),m=await model();f.state.detail={code:'9900016371',name:'薯条券',rounds:[]};const c=(await f.coupons()).json();c.products[0].officialCode='4810';const fries=f.snapshot.items.find((i:Candidate)=>i.name==='中薯条');const basket=[line(fries,2)];const p=m.recommendCoupons(f.snapshot,basket,c)[0],state=m.applyCoupon(m.createCouponBasket(basket),p);
 assert.throws(()=>m.editCouponBasket(state,state.basket.map(l=>!l.couponKey?{...l,optionIds:['variant:another']}:l)),/COVERED/);
 assert.throws(()=>m.editCouponBasket(state,state.basket.map(l=>!l.couponKey?{...l,quantity:99}:l)),/COVERED/);
 const edited=m.editCouponBasket(state,state.basket.map(l=>!l.couponKey?{...l,quantity:3}:l));const restored=m.restoreCoveredBasket(edited);assert.equal(restored.basket.length,1);assert.equal(restored.basket[0].quantity,4);assert.deepEqual(restored.basket[0].optionIds,[]);
});
function repeatedRecipeFixture(sourceRecipes:{pickle:number;quantity:number}[],rounds:{pickle:number;quantity:number;locked?:boolean}[]){
 const raw=JSON.parse(readFileSync(new URL('./fixtures/menu-options.json',import.meta.url),'utf8'));
 const live=normalizeCatalog(raw,{contextKey:'repeated-recipes',store:{id:'3330251',name:'测试',city:'杭州',address:'测试'},loadedAt:'now',complete:true});const burger=live.items.find(i=>i.officialCode==='1100')!;
 const sources=sourceRecipes.map((r,i)=>({...burger,id:'source-'+i}));
 const basket=sources.map((item,i)=>({...line(item,sourceRecipes[i].quantity),optionIds:setModification(item,[],item.modificationGroups![0].values.find(v=>v.name==='酸黄瓜')!.id,sourceRecipes[i].pickle)}));
 const coupon:Candidate={...burger,id:'coupon-product',name:'双份汉堡券',stageId:'coupon',officialCode:'coupon-parent',modificationGroups:[],comboRounds:rounds.map((r,i)=>{
  const groups=structuredClone(burger.modificationGroups!);for(const group of groups){group.id='coupon-group-'+i+'-'+group.id;for(const value of group.values){value.id='coupon-value-'+i+'-'+value.id;if(value.name==='酸黄瓜'){value.defaultQuantity=r.pickle;if(r.locked){value.minQuantity=r.pickle;value.maxQuantity=r.pickle;}}}}
  return {id:'coupon-round-'+i,roundId:i+1,name:'汉堡第'+(i+1)+'轮',minQuantity:r.quantity,maxQuantity:r.quantity,defaultQuantity:r.quantity,choices:[{id:'coupon-choice-'+i,officialCode:'1100',name:'巨无霸'+(i+1),maxQuantity:r.quantity,defaultQuantity:r.quantity,referenceDeltaCents:0,modificationGroups:groups}]};
 })};
 const snapshot={...live,items:sources};const collection={contextKey:snapshot.contextKey,loadedAt:'now',complete:true,products:[coupon],coupons:[{key:'coupon-key',title:'双份汉堡券',subtitle:'',imageUrl:null,validityText:'',tags:[],availableAtStore:true,productIds:[coupon.id]}]};
 return {snapshot,basket,coupon,collection};
}
test('same-code customization reaches both independent coupon rounds, including a different second default',async()=>{
 const f=repeatedRecipeFixture([{pickle:0,quantity:2}],[{pickle:0,quantity:1},{pickle:1,quantity:1}]);assert.match(resolveOptions(f.coupon,[]).summary.join('、'),/巨无霸2：酸黄瓜/);
 const p=(await model()).recommendCoupons(f.snapshot,f.basket,f.collection)[0];assert.equal(p.canApply,true);assert.equal(p.matchedCount,2);assert.deepEqual(p.customizationChanges,[]);
 const resolved=resolveOptions(f.coupon,p.optionIDs);assert.equal(resolved.summary.filter(s=>s.includes('不加酸黄瓜')).length,2);assert.ok(resolved.roundList.every(r=>r.comboItemList[0].modification?.values.some(v=>v.code==='100202'&&v.quantity===0)));
});
test('same-code different source recipes are allocated by quantity to independent coupon choices',async()=>{
 const f=repeatedRecipeFixture([{pickle:0,quantity:1},{pickle:1,quantity:1}],[{pickle:0,quantity:1},{pickle:0,quantity:1}]);const p=(await model()).recommendCoupons(f.snapshot,f.basket,f.collection)[0];assert.equal(p.canApply,true);assert.deepEqual(p.customizationChanges,[]);
 const resolved=resolveOptions(f.coupon,p.optionIDs);assert.equal(resolved.summary.filter(s=>s.endsWith('不加酸黄瓜')).length,1);assert.equal(resolved.summary.filter(s=>s.endsWith('：酸黄瓜')).length,1);
});
test('same choice quantity two shares a recipe and discloses the one source serving it cannot preserve',async()=>{
 const f=repeatedRecipeFixture([{pickle:0,quantity:1},{pickle:1,quantity:1}],[{pickle:0,quantity:2}]);const p=(await model()).recommendCoupons(f.snapshot,f.basket,f.collection)[0];assert.equal(p.matchedCount,2);assert.equal(p.customizationChanges.length,1);assert.match(p.customizationChanges[0],/× 1/);assert.match(p.customizationChanges[0],/原餐品|券内/);
 assert.equal(resolveOptions(f.coupon,p.optionIDs).roundList[0].comboItemList[0].quantity,2);
});
test('same choice quantity two preserves both identical source recipes when official setters support them',async()=>{
 const f=repeatedRecipeFixture([{pickle:0,quantity:2}],[{pickle:1,quantity:2}]);const p=(await model()).recommendCoupons(f.snapshot,f.basket,f.collection)[0];assert.deepEqual(p.customizationChanges,[]);const wire=resolveOptions(f.coupon,p.optionIDs).roundList[0].comboItemList[0];assert.equal(wire.quantity,2);assert.ok(wire.modification?.values.some(v=>v.code==='100202'&&v.quantity===0));
});
test('a locked second same-code recipe reports its own changed serving rather than comparing the first one twice',async()=>{
 const f=repeatedRecipeFixture([{pickle:0,quantity:2}],[{pickle:0,quantity:1},{pickle:1,quantity:1,locked:true}]);const p=(await model()).recommendCoupons(f.snapshot,f.basket,f.collection)[0];assert.equal(p.customizationChanges.length,1);assert.match(p.customizationChanges[0],/× 1/);assert.match(p.customizationChanges[0],/不加酸黄瓜/);assert.match(resolveOptions(f.coupon,p.optionIDs).summary.join('、'),/巨无霸2：酸黄瓜/);
});
