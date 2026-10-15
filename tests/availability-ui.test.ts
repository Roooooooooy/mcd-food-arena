import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as engine from '../src/arena/engine.ts';
import * as state from '../src/commerce/state.ts';
import { commerceFixture } from './commerce-fixture.ts';
import { demoCatalog } from '../src/demo/menu.ts';
import { serializeSession, resumeSession } from '../src/setup/session.ts';
const missing=(id:string)=>({candidateId:id,state:'not-returned',label:'当前菜单未返回，请更换',checkedAt:'2026-10-15T12:00:00Z'});
test('arena gray image keeps readable name/price, guards card and coin but browsing/skip remain',async t=>{
 const f=await commerceFixture(t),server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});t.after(()=>server.close());const {ArenaPage}=await server.ssrLoadModule('/src/arena/ArenaPage.tsx');const ids=f.snapshot.items.slice(0,2).map((i:any)=>i.id),arena=engine.createArena(ids,'a','side',ids=>[ids[0],ids[1]]);
 const html=renderToStaticMarkup(createElement(ArenaPage,{state:arena,snapshot:f.snapshot,arenas:[arena],activeIndex:0,availability:{contextKey:f.snapshot.contextKey,checkedAt:'2026-10-15T12:00:00Z',items:[missing(ids[0])]},onChoose:()=>{},onUndo:()=>{},onSkip:()=>{},onPause:()=>{},onNext:()=>{},onStageSelect:()=>{}}));
 assert.match(html,/data-choice-button="left"[^>]*disabled/);assert.match(html,/class="[^\"]*availability-image-unavailable/);assert.match(html,/当前菜单未返回/);assert.match(html,/14\.00/);assert.match(html,/<button[^>]*disabled[^>]*aria-label="抛硬币选一份"/);assert.match(html,/跳过这类/);
});
test('retained result displays selected original item/quantity and unavailable size blocks quote',async t=>{
 const f=await commerceFixture(t),server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});t.after(()=>server.close());const {CartPage}=await server.ssrLoadModule('/src/cart/CartPage.tsx');const item=f.snapshot.items[0];
 const html=renderToStaticMarkup(createElement(CartPage,{snapshot:f.snapshot,basket:[{candidateId:item.id,quantity:3,optionIds:[]}],availability:{contextKey:f.snapshot.contextKey,checkedAt:'2026-10-15T12:00:00Z',items:[missing(item.id)]},onBasketChange:()=>{},arenas:[],totalDecisions:0,onReview:()=>{},onRestart:()=>{},onSetup:()=>{}}));
 assert.match(html,/中薯条/);assert.match(html,/value="3" selected=""/);assert.match(html,/当前菜单未返回/);assert.match(html,/availability-image-unavailable/);assert.match(html,/移出餐单/);
});
test('redraw preserves survivors/history, never resurrects loser; sole eligible eliminates blocked normally; zero has no invented winner',async()=>{
 const m=engine as any;assert.equal(typeof m.redrawUnavailablePair,'function');const ids=['a','b','c','d','e'];let a=engine.choose(engine.createArena(ids,'x','burger',ids=>[ids[0],ids[1]]),'left',0,ids=>[ids[1],ids[3]]);
 const history=structuredClone(a.history),remaining=[...a.remainingIds];const select=(id:string)=>id==='a'||id==='d';const next=m.redrawUnavailablePair(a,select,(ids:string[])=>[ids[0],ids[1]]);assert.deepEqual(next.pair,['a','d']);assert.deepEqual(next.history,history);assert.deepEqual(next.remainingIds,remaining);assert.equal(next.revision,a.revision+1);assert.equal(next.remainingIds.includes('b'),false);
 const sole=m.availabilityDraw((id:string)=>id==='a', (ids:string[])=>[ids[0],ids[1]]);assert.deepEqual(sole(remaining),['a','c']);const progressed=engine.choose({...next,pair:['a','c']},'left',next.revision,sole);assert.deepEqual(progressed.pair,['a','d']);assert.equal(m.redrawUnavailablePair(next,()=>false),next);assert.equal(next.championId,null);
});
test('redrawn actual personal pause/resume keeps pair and every genuine decision',()=>{
 const m=engine as any;assert.equal(typeof m.redrawUnavailablePair,'function');const snapshot=demoCatalog(),ids=snapshot.items.filter(i=>i.stageId==='drink').map(i=>i.id);let a=engine.choose(engine.createArena(ids,'a','drink',ids=>[ids[0],ids[1]]),'left',0,ids=>[ids[1],ids[3]]);a=m.redrawUnavailablePair(a,(id:string)=>id===ids[0]||id===ids[4],(ids:string[])=>[ids[0],ids[1]]);const restored=resumeSession(snapshot,serializeSession(snapshot,[a],0),null)!.arenas[0];assert.deepEqual(restored.pair,a.pair);assert.deepEqual(restored.history,a.history);assert.deepEqual(restored.remainingIds,a.remainingIds);
});
test('late availability generation/context cannot replace current state; checkout order and unknown persist',()=>{
 const m=state as any;assert.equal(typeof m.createAvailabilityTracker,'function');const scope=state.createConnectionScope();scope.beginConnection();scope.replaceContext('c');const tracker=m.createAvailabilityTracker(scope);const first=tracker.begin('c');const second=tracker.begin('c');const result={contextKey:'c',checkedAt:'2026-10-15T12:00:00Z',items:[missing('a')]};assert.equal(tracker.accept(first,result),false);assert.equal(tracker.accept(second,result),true);scope.beginConnection();scope.replaceContext('c');assert.equal(tracker.accept(second,result),false);assert.equal(tracker.accept(tracker.begin('foreign'),{...result,contextKey:'foreign'}),false);
 const unknown=state.failOrder(state.emptyCheckout(),'ORDER_RESULT_UNKNOWN');assert.equal(state.invalidateCheckout(unknown).status,'unknown');const order={key:'o',status:'completed' as const,statusLabel:'已完成',paymentUrl:null,pickupCode:null,totalCents:100,storeName:null};assert.deepEqual(state.invalidateCheckout(state.finishOrder(unknown,order)).order,order);
});
test('manual and sealed coin guards reject latest unavailable side and release a rejected flight',()=>{
 const m=state as any;assert.equal(typeof m.resolveAvailableChoice,'function');const arena=engine.createArena(['a','b'],'x','burger',ids=>[ids[0],ids[1]]),lock={arenaId:'x',revision:0,finalSide:'left' as const};let committed=0,released=0;const choose=()=>committed++,release=()=>released++;
 assert.equal(m.resolveAvailableChoice(arena,lock,()=>false,choose,release),false);assert.equal(committed,0);assert.equal(released,1);assert.equal(m.resolveAvailableChoice(arena,lock,()=>true,choose,release),true);assert.equal(committed,1);
});
test('disabled commerce availability methods reject before fetch and stale responses are ignored',async()=>{
 const {createCommerceApi}=await import('../src/commerce/api.ts');let calls=0;const disabled=createCommerceApi(false,async()=>{calls++;return new Response('{}');}) as any;assert.equal(typeof disabled.availability,'function');await assert.rejects(()=>disabled.availability({contextKey:'c',candidateIds:['a']}));await assert.rejects(()=>disabled.basketAvailability({contextKey:'c',cartRevision:0,basket:[]}));assert.equal(calls,0);
});

test('status labels cannot read inherited prototype entries and unknown never gets unavailable image styling',async t=>{
 const {availabilityLabel}=await import('../src/commerce/availability-contracts.ts');for(const key of ['constructor','__proto__','toString'])assert.equal(availabilityLabel(key as any),'尚未确认当前状态');
 const f=await commerceFixture(t),server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});t.after(()=>server.close());const {ArenaPage}=await server.ssrLoadModule('/src/arena/ArenaPage.tsx');const ids=f.snapshot.items.slice(0,2).map((i:any)=>i.id),arena=engine.createArena(ids,'a','side',ids=>[ids[0],ids[1]]);
 const html=renderToStaticMarkup(createElement(ArenaPage,{state:arena,snapshot:f.snapshot,arenas:[arena],activeIndex:0,availability:{contextKey:f.snapshot.contextKey,checkedAt:'2026-10-15T12:00:00Z',items:[{...missing(ids[0]),state:'unknown'}]},onChoose:()=>{},onUndo:()=>{},onSkip:()=>{},onPause:()=>{},onNext:()=>{},onStageSelect:()=>{}}));assert.doesNotMatch(html,/availability-image-unavailable/);assert.match(html,/尚未确认当前状态/);
});
test('stale availability HTTP response rejects on disconnect even when transport ignores cancellation',async()=>{
 const {createCommerceApi}=await import('../src/commerce/api.ts');let finish!:(response:Response)=>void;const api=createCommerceApi(true,async()=>new Promise(resolve=>finish=resolve));const pending=api.availability({contextKey:'c',candidateIds:['a']});api.invalidate();finish(new Response('{}'));await assert.rejects(()=>pending,(e:any)=>e.code==='STALE_RESULT');
});

test('availability activity releases on arena/result to setup cancellation and an old settlement cannot clear its successor',async()=>{
 const m=state as any;assert.equal(typeof m.createRequestActivity,'function');
 for(const page of ['arena','result']){
  let busy=false;const activity=m.createRequestActivity((value:boolean)=>busy=value);
  const {createCommerceApi}=await import('../src/commerce/api.ts');const replies:((response:Response)=>void)[]=[];
  const api=createCommerceApi(true,async()=>new Promise(resolve=>replies.push(resolve)));
  const first=activity.begin();const old=(async()=>{try{await api.availability({contextKey:'c',candidateIds:['a']});}finally{activity.finish(first);}})();
  assert.equal(busy,true,page);activity.cancel();assert.equal(busy,false,page+' → setup');
  const next=activity.begin();const successor=(async()=>{try{await api.availability({contextKey:'c',candidateIds:['a']});}finally{activity.finish(next);}})();
  replies[0](new Response('{}'));await old;assert.equal(busy,true,'older request must not clear successor');
  replies[1](new Response('{}'));await successor;assert.equal(busy,false);
 }
});
test('only accepted current quote generation reaches checkout after delayed HTTP and availability invalidation',async()=>{
 const m=state as any;assert.equal(typeof m.createAcceptedQuoteTracker,'function');
 const {createCommerceApi}=await import('../src/commerce/api.ts');const replies:((response:Response)=>void)[]=[];
 const api=createCommerceApi(true,async()=>new Promise(resolve=>replies.push(resolve)));
 const request={contextKey:'c',cartRevision:1,basket:[{candidateId:'a',quantity:1,optionIds:[]}]};
 const {basketKey}=await import('../src/cart/model.ts');
 const quote={contextKey:'c',basketKey:basketKey(request.basket),cartRevision:1,totalCents:100,currency:'CNY',quotedAt:'2026-10-15T12:00:00Z',mode:'live',evidence:'official',fees:[],quoteKey:'old',expiresAt:'2099-01-01',takeWays:[{code:'eat',label:'堂食'}]};
 let checkout=state.emptyCheckout(),generation=0,accepted=0;
 const tracker=m.createAcceptedQuoteTracker(request,()=>{},(q:any,req:any,own:number)=>{if(own!==generation)return;accepted++;checkout=state.acceptQuote(checkout,q,req);});
 const pending=tracker.run((req:any)=>api.quote(req),generation);
 generation++;checkout=state.invalidateCheckout(checkout);tracker.replace(request);
 replies[0](new Response(JSON.stringify(quote)));await pending;
 assert.equal(tracker.getState().status,'idle');assert.equal(tracker.getState().quote,null);assert.equal(checkout.status,'idle');assert.equal(checkout.quote,null);assert.equal(accepted,0);
 const current=tracker.run((req:any)=>api.quote(req),generation);replies[1](new Response(JSON.stringify({...quote,quoteKey:'current'})));await current;
 assert.equal(tracker.getState().status,'success');assert.equal((checkout as state.CheckoutState).quote?.quoteKey,'current');assert.equal(accepted,1);
});
test('accepted quote callback retains its start eligibility generation even before a refresh cancellation effect runs',async()=>{
 const m=state as any;assert.equal(typeof m.createAcceptedQuoteTracker,'function');
 const request={contextKey:'c',cartRevision:1,basket:[{candidateId:'a',quantity:1,optionIds:[]}]};const {basketKey}=await import('../src/cart/model.ts');
 const quote={contextKey:'c',basketKey:basketKey(request.basket),cartRevision:1,totalCents:100,currency:'CNY',quotedAt:'now',mode:'live',evidence:'official',fees:[],quoteKey:'old',expiresAt:'2099-01-01',takeWays:[{code:'eat',label:'堂食'}]};let release!:(q:any)=>void,generation=0,checkout=state.emptyCheckout();
 const tracker=m.createAcceptedQuoteTracker(request,()=>{},(q:any,req:any,own:number)=>{if(own===generation)checkout=state.acceptQuote(checkout,q,req);});const pending=tracker.run(()=>new Promise(resolve=>release=resolve),generation);
 generation++;checkout=state.invalidateCheckout(checkout);release(quote);await pending;
 assert.equal(checkout.status,'idle');assert.equal(checkout.quote,null);
 for(const previous of [state.failOrder(state.emptyCheckout(),'ORDER_RESULT_UNKNOWN'),state.finishOrder(state.emptyCheckout(),{key:'o',status:'completed',statusLabel:'已完成',paymentUrl:null,pickupCode:null,totalCents:100,storeName:null})])assert.deepEqual(state.acceptQuote(state.invalidateCheckout(previous),quote as any,request).order,previous.order);
});
