import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { commerceFixture } from './commerce-fixture.ts';
import { demoCatalog } from '../src/demo/menu.ts';
import { basketKey } from '../src/cart/model.ts';

// Invoke the actual components and their real effect callbacks using React's dispatcher.
// Only hook scheduling/host globals and the external fetch boundary are supplied by this test.
function componentHooks(component:(props?:any)=>any){
 const slots:any[]=[];let cursor=0,dirty=true,tree:any,props:any,queued:(()=>void)[]=[];
 const dispatcher={
  useState(initial:any){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return [slots[index].value,(next:any)=>{const value=typeof next==='function'?next(slots[index].value):next;if(!Object.is(value,slots[index].value)){slots[index].value=value;dirty=true;}}];},
  useRef(value:any){const index=cursor++;if(!(index in slots))slots[index]={current:value};return slots[index];},
  useEffect(callback:()=>void|(()=>void),deps?:any[]){const index=cursor++,old=slots[index];if(!old||!deps||!old.deps||deps.some((v,i)=>!Object.is(v,old.deps[i]))){slots[index]={deps,cleanup:old?.cleanup};queued.push(()=>{slots[index].cleanup?.();slots[index].cleanup=callback();});}},
 };
 return {
  get tree(){return tree;},get dirty(){return dirty;},
  render(nextProps?:any){if(nextProps!==undefined)props=nextProps;cursor=0;dirty=false;
   const internals=(React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,previous=internals.H;internals.H=dispatcher;
   try{tree=component(props);}finally{internals.H=previous;}
   const effects=queued;queued=[];for(const effect of effects)effect();return tree;
  },
  unmount(){for(const slot of slots)slot?.cleanup?.();},
 };
}
function nodes(root:any):any[]{if(Array.isArray(root))return root.flatMap(nodes);if(!root||typeof root!=='object')return [];return [root,...nodes(root.props?.children)];}
function component(root:any,name:string){return nodes(root).find(node=>typeof node.type==='function'&&node.type.name===name);}
function words(node:any):string {if(Array.isArray(node))return node.map(words).join('');if(typeof node==='string'||typeof node==='number')return String(node);return node&&typeof node==='object'?words(node.props?.children):'';}
function button(root:any,label:string){const found=nodes(root).find(node=>node.type==='button'&&words(node).includes(label));assert.ok(found,label);return found;}
async function lifecycle(t:TestContext,withCoupons=false){
 const f=await commerceFixture(t),originalEnv=process.env.VITE_PUBLIC_COMMERCE;process.env.VITE_PUBLIC_COMMERCE='true';
 const collection=withCoupons?(await f.coupons()).json():{contextKey:f.snapshot.contextKey,loadedAt:'now',complete:true,coupons:[],products:[]};
 if(withCoupons)f.snapshot.items.push({...f.snapshot.items.find((item:any)=>item.name==='中薯条'),id:'other-food',officialCode:'other-code',name:'其他餐品',stageId:'burger'});
 const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});t.after(()=>server.close());
 t.after(()=>{if(originalEnv===undefined)delete process.env.VITE_PUBLIC_COMMERCE;else process.env.VITE_PUBLIC_COMMERCE=originalEnv;});
 const frozen={...demoCatalog(),sourceKind:'official-snapshot'};
 const hostGlobals={window:(globalThis as any).window,localStorage:(globalThis as any).localStorage};
 let now=Date.now(),timerId=0;const timers=new Map<number,{at:number;callback:()=>void}>();t.mock.method(Date,'now',()=>now);
 (globalThis as any).window={scrollTo:()=>{},setTimeout:(callback:()=>void,delay:number)=>{const id=++timerId;timers.set(id,{at:now+delay,callback});return id;},clearTimeout:(id:number)=>timers.delete(id)};(globalThis as any).localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const pendingAvailability:{body:any;reply:(response:Response)=>void}[]=[],pendingQuotes:{body:any;reply:(response:Response)=>void}[]=[];
 const control={holdAvailability:false,availabilityState:'listed'};
 const result=(body:any)=>({contextKey:body.contextKey,checkedAt:'2026-10-15T12:00:00Z',items:(body.candidateIds??body.basket.map((l:any)=>l.candidateId)).map((candidateId:string)=>({candidateId,state:control.availabilityState,label:'当前菜单状态',checkedAt:'2026-10-15T12:00:00Z'}))});
 const response=(value:any)=>new Response(JSON.stringify(value));
 t.mock.method(globalThis,'fetch',async(url:any,init?:RequestInit)=>{
  const path=String(url),body=init?.body?JSON.parse(String(init.body)):undefined;
  if(path.endsWith('/demo/catalog.json'))return response(frozen);
  if(path.endsWith('/connect'))return response({connected:true,expiresAt:'2099-01-01'});
  if(path.includes('/catalog?'))return response(f.snapshot);
  if(path.includes('/coupons?'))return response(collection);
  if(path.endsWith('/selection'))return response(body.basket.map((l:any)=>({candidateId:l.candidateId,components:[],requiresSelection:false})));
  if(path.endsWith('/availability')||path.endsWith('/basket-availability'))return control.holdAvailability?new Promise<Response>(reply=>pendingAvailability.push({body,reply})):response(result(body));
  if(path.endsWith('/quote'))return new Promise<Response>(reply=>pendingQuotes.push({body,reply}));
  throw new Error('Unexpected external boundary path '+path);
 });
 const {default:App}=await server.ssrLoadModule('/src/App.tsx'),{CartPage}=await server.ssrLoadModule('/src/cart/CartPage.tsx'),{CouponRecommendations}=await server.ssrLoadModule('/src/coupons/CouponRecommendations.tsx');
 const app=componentHooks(App);let cart:ReturnType<typeof componentHooks>|null=null,coupons:ReturnType<typeof componentHooks>|null=null;
 t.after(()=>{app.unmount();cart?.unmount();coupons?.unmount();for(const [key,value] of Object.entries(hostGlobals))if(value===undefined)delete (globalThis as any)[key];else (globalThis as any)[key]=value;});
 async function flush(){for(let i=0;i<12;i++){let parentRendered=false,cartRendered=false;if(app.dirty||!app.tree){app.render();parentRendered=true;}const child=component(app.tree,'CartPage');if(child){if(!cart)cart=componentHooks(CartPage);if(parentRendered||cart.dirty||!cart.tree){cart.render(child.props);cartRendered=true;}}else if(cart){cart.unmount();cart=null;}const recommendation=cart&&component(cart.tree,'CouponRecommendations');if(recommendation){if(!coupons)coupons=componentHooks(CouponRecommendations);if(cartRendered||coupons.dirty||!coupons.tree)coupons.render(recommendation.props);}else if(coupons){coupons.unmount();coupons=null;}await new Promise(resolve=>setImmediate(resolve));}}
 await flush();await component(app.tree,'AccountPanel').props.onConnect('fake-token');await flush();assert.equal(component(app.tree,'AccountPanel').props.session.connected,true);
 return {app,get cart(){return cart;},get coupons(){return coupons;},get now(){return now;},advance(ms:number){now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.callback();}},f,control,flush,pendingAvailability,pendingQuotes,result,response};
}

async function couponResult(t:TestContext){
 const h=await lifecycle(t,true),fries=h.f.snapshot.items.find((item:any)=>item.name==='中薯条'),pie=h.f.snapshot.items.find((item:any)=>item.name==='菠萝派');
 component(h.app.tree,'SetupPage').props.onSelectionChange([fries,pie].map(item=>({id:item.stageId,candidateIds:[item.id]})));await h.flush();
 component(h.app.tree,'SetupPage').props.onStart();await h.flush();for(let i=0;i<2;i++){component(h.app.tree,'ArenaPage').props.onNext();await h.flush();}
 function replyQuote(totalCents:number,expiresAt:number){const pending=h.pendingQuotes.shift();assert.ok(pending,'the actual comparison requested an official quote');const request=pending.body;pending.reply(h.response({contextKey:request.contextKey,basketKey:basketKey(request.basket),cartRevision:request.cartRevision,totalCents,currency:'CNY',quotedAt:new Date(h.now).toISOString(),mode:'live',evidence:'official',fees:[],quoteKey:'quote-'+totalCents,expiresAt:new Date(expiresAt).toISOString(),takeWays:[{code:'eat',label:'堂食'}]}));}
 async function compare(beforeExpiry=h.now+1000,afterExpiry=h.now+5000){button(h.coupons!.tree,'核对用券前后金额').props.onClick();await h.flush();replyQuote(2200,beforeExpiry);await h.flush();replyQuote(1590,afterExpiry);await h.flush();assert.ok(nodes(h.coupons!.tree).some(node=>node.props?.className==='coupon-price-comparison'));}
 return {...h,get cart(){return h.cart;},get coupons(){return h.coupons;},get now(){return h.now;},replyQuote,compare};
}
function hasComparison(root:any){return nodes(root).some(node=>node.props?.className==='coupon-price-comparison');}

for(const firstExpires of ['before','after'])test(`actual coupon comparison disappears when the ${firstExpires} quote expires first, and application stays independent`,async t=>{
 const h=await couponResult(t),earlier=h.now+1000,later=h.now+5000;await h.compare(firstExpires==='before'?earlier:later,firstExpires==='after'?earlier:later);
 h.advance(999);await h.flush();assert.equal(hasComparison(h.coupons!.tree),true);
 h.advance(1);await h.flush();assert.equal(hasComparison(h.coupons!.tree),false);
 assert.equal(button(h.coupons!.tree,'用这张券替换').props.disabled,false);assert.equal(button(h.coupons!.tree,'核对用券前后金额').props.disabled,false);
 await h.compare(h.now+1000,h.now+5000);assert.match(words(h.coupons!.tree),/6\.10/);
});

test('actual coupon comparison rejects a response whose earlier quote expired while awaiting its second quote',async t=>{
 const h=await couponResult(t);button(h.coupons!.tree,'核对用券前后金额').props.onClick();await h.flush();
 h.replyQuote(2200,h.now+10);await h.flush();h.advance(11);h.replyQuote(1590,h.now+5000);await h.flush();
 assert.equal(hasComparison(h.coupons!.tree),false);assert.equal(button(h.coupons!.tree,'用这张券替换').props.disabled,false);
});

test('actual coupon comparison clears on availability refresh with unchanged basket and eligibility result',async t=>{
 const h=await couponResult(t);await h.compare();h.control.holdAvailability=true;button(h.app.tree,'刷新可用状态').props.onClick();await h.flush();
 assert.equal(hasComparison(h.coupons!.tree),false);assert.equal(button(h.coupons!.tree,'用这张券替换').props.disabled,true);
 h.control.holdAvailability=false;const request=h.pendingAvailability.shift()!;request.reply(h.response(h.result(request.body)));await h.flush();
 assert.equal(hasComparison(h.coupons!.tree),false);assert.equal(button(h.coupons!.tree,'用这张券替换').props.disabled,false);
 button(h.coupons!.tree,'用这张券替换').props.onClick();await h.flush();assert.equal(component(h.app.tree,'CartPage').props.basket.filter((line:any)=>line.couponKey).length,1);
});

test('actual coupon comparison rejects its delayed second quote after availability refresh finishes',async t=>{
 const h=await couponResult(t);button(h.coupons!.tree,'核对用券前后金额').props.onClick();await h.flush();h.replyQuote(2200,h.now+5000);await h.flush();
 button(h.app.tree,'刷新可用状态').props.onClick();await h.flush();h.replyQuote(1590,h.now+5000);await h.flush();
 assert.equal(hasComparison(h.coupons!.tree),false);assert.equal(button(h.coupons!.tree,'用这张券替换').props.disabled,false);
});

test('actual coupon comparison clears even when an unchanged availability refresh finishes before the next render',async t=>{
 const h=await couponResult(t);await h.compare();button(h.app.tree,'刷新可用状态').props.onClick();
 await new Promise(resolve=>setImmediate(resolve));await h.flush();
 assert.equal(button(h.app.tree,'刷新可用状态').props.disabled,false);assert.equal(hasComparison(h.coupons!.tree),false);
});

test('actual coupon comparison does not continue its delayed first quote after availability refresh',async t=>{
 const h=await couponResult(t);button(h.coupons!.tree,'核对用券前后金额').props.onClick();await h.flush();
 button(h.app.tree,'刷新可用状态').props.onClick();await h.flush();h.replyQuote(2200,h.now+5000);await h.flush();
 assert.equal(hasComparison(h.coupons!.tree),false);assert.equal(button(h.coupons!.tree,'用这张券替换').props.disabled,false);
 assert.equal(h.pendingQuotes.length,0,'invalidated comparison cannot start a second quote');
});

test('actual App full restart adds the same winner again after removing it from the result basket',async t=>{
 const h=await lifecycle(t);const fries=h.f.snapshot.items.find((item:any)=>item.name==='中薯条');
 component(h.app.tree,'SetupPage').props.onSelectionChange([{id:fries.stageId,candidateIds:[fries.id]}]);await h.flush();
 component(h.app.tree,'SetupPage').props.onStart();await h.flush();component(h.app.tree,'ArenaPage').props.onNext();await h.flush();
 assert.deepEqual(component(h.app.tree,'CartPage').props.basket,[{candidateId:fries.id,quantity:1,optionIds:[]}]);
 button(h.cart!.tree,'移出餐单').props.onClick();await h.flush();assert.deepEqual(component(h.app.tree,'CartPage').props.basket,[]);
 component(h.app.tree,'CartPage').props.onRestart();await h.flush();component(h.app.tree,'ArenaPage').props.onNext();await h.flush();
 assert.deepEqual(component(h.app.tree,'CartPage').props.basket,[{candidateId:fries.id,quantity:1,optionIds:[]}]);
});

test('actual App category review restores coupon-covered foods while preserving unrelated quantities and options',async t=>{
 const h=await lifecycle(t,true),fries=h.f.snapshot.items.find((item:any)=>item.name==='中薯条'),pie=h.f.snapshot.items.find((item:any)=>item.name==='菠萝派');
 const other=h.f.snapshot.items.find((item:any)=>item.id==='other-food');
 component(h.app.tree,'SetupPage').props.onSelectionChange([fries,pie,other].map(item=>({id:item.stageId,candidateIds:[item.id]})));await h.flush();
 component(h.app.tree,'SetupPage').props.onStart();await h.flush();
 for(let i=0;i<3;i++){component(h.app.tree,'ArenaPage').props.onNext();await h.flush();}
 component(h.app.tree,'CartPage').props.onBasketChange(component(h.app.tree,'CartPage').props.basket.map((line:any)=>line.candidateId===other.id?{...line,quantity:3}:line));await h.flush();
 assert.equal(button(h.coupons!.tree,'用这张券替换').props.disabled,false);button(h.coupons!.tree,'用这张券替换').props.onClick();await h.flush();
 assert.equal(component(h.app.tree,'CartPage').props.basket.filter((line:any)=>line.couponKey).length,1);
 // Category review is intentionally separate from the full fresh-run callback.
 component(h.app.tree,'CartPage').props.onReview(0);await h.flush();
 for(let i=0;i<3;i++){component(h.app.tree,'ArenaPage').props.onNext();await h.flush();}
 assert.deepEqual(component(h.app.tree,'CartPage').props.basket,[{candidateId:fries.id,quantity:1,optionIds:[]},{candidateId:pie.id,quantity:1,optionIds:['variant:live:sku:9900008752:4105']},{candidateId:other.id,quantity:3,optionIds:[]}]);
});
for(const page of ['arena','result'])test(`actual App ${page} to setup releases pending availability ownership`,async t=>{
 const h=await lifecycle(t);if(page==='arena')component(h.app.tree,'SetupPage').props.onSelectionChange([{id:'dessert',candidateIds:h.f.snapshot.items.filter((i:any)=>i.stageId==='dessert').map((i:any)=>i.id)}]);await h.flush();
 if(page==='arena')h.control.holdAvailability=true;
 component(h.app.tree,'SetupPage').props.onStart();await h.flush();
 if(page==='result'){h.control.holdAvailability=true;component(h.app.tree,'ArenaPage').props.onNext();await h.flush();}
 assert.equal(button(h.app.tree,'刷新可用状态').props.disabled,true);assert.equal(h.pendingAvailability.length,1);
 if(page==='arena')component(h.app.tree,'ArenaPage').props.onPause();else component(h.app.tree,'CartPage').props.onSetup();await h.flush();
 h.control.holdAvailability=false;const request=h.pendingAvailability.shift()!;request.reply(h.response(h.result(request.body)));await h.flush();
 assert.ok(component(h.app.tree,'SetupPage'));assert.equal(button(h.app.tree,'刷新可用状态').props.disabled,false);
});
test('actual CartPage delayed canceled quote cannot restore App checkout after availability refresh',async t=>{
 const h=await lifecycle(t);component(h.app.tree,'SetupPage').props.onStart();await h.flush();component(h.app.tree,'ArenaPage').props.onNext();await h.flush();
 const quoteButton=button(h.cart!.tree,'获取官方整单报价');assert.equal(quoteButton.props.disabled,false);quoteButton.props.onClick();await h.flush();assert.equal(h.pendingQuotes.length,1);
 h.control.availabilityState='unknown';button(h.app.tree,'刷新可用状态').props.onClick();await h.flush();
 const pending=h.pendingQuotes.shift()!,request=pending.body;pending.reply(h.response({contextKey:request.contextKey,basketKey:basketKey(request.basket),cartRevision:request.cartRevision,totalCents:1400,currency:'CNY',quotedAt:'2026-10-15T12:00:00Z',mode:'live',evidence:'official',fees:[],quoteKey:'old',expiresAt:'2099-01-01',takeWays:[{code:'eat',label:'堂食'}]}));await h.flush();
 const checkout=component(h.app.tree,'CheckoutPanel').props.state;assert.equal(checkout.status,'idle');assert.equal(checkout.quote,null);assert.match(words(h.cart!.tree),/未取得报价/);
});

test('actual App paused old request cannot release a new manual setup refresh',async t=>{
 const h=await lifecycle(t);component(h.app.tree,'SetupPage').props.onSelectionChange([{id:'dessert',candidateIds:h.f.snapshot.items.filter((i:any)=>i.stageId==='dessert').map((i:any)=>i.id)}]);await h.flush();h.control.holdAvailability=true;component(h.app.tree,'SetupPage').props.onStart();await h.flush();
 component(h.app.tree,'ArenaPage').props.onPause();await h.flush();assert.equal(button(h.app.tree,'刷新可用状态').props.disabled,false);
 button(h.app.tree,'刷新可用状态').props.onClick();await h.flush();assert.equal(h.pendingAvailability.length,2);
 const old=h.pendingAvailability.shift()!;old.reply(h.response(h.result(old.body)));await h.flush();assert.equal(button(h.app.tree,'刷新可用状态').props.disabled,true);
 const current=h.pendingAvailability.shift()!;current.reply(h.response(h.result(current.body)));await h.flush();assert.equal(button(h.app.tree,'刷新可用状态').props.disabled,false);
});
