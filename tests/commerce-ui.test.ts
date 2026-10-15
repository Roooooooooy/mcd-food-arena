import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { commerceFixture } from './commerce-fixture.ts';
import { createArena } from '../src/arena/engine.ts';
import { basketKey, basketText } from '../src/cart/model.ts';
test('coupon detail controls sit outside whole-card choice and coupons stay out of PK candidates',async t=>{
 const f=await commerceFixture(t),collection=(await f.coupons()).json();const server=await createServer({server:{middlewareMode:true},appType:'custom'});t.after(()=>server.close());const {ArenaPage}=await server.ssrLoadModule('/src/arena/ArenaPage.tsx');const state=createArena(f.snapshot.items.slice(0,2).map((i:any)=>i.id),'test','side',ids=>[ids[0],ids[1]]);
 const html=renderToStaticMarkup(createElement(ArenaPage,{state,snapshot:f.snapshot,arenas:[state],activeIndex:0,coupons:collection,onChoose:()=>{},onUndo:()=>{},onSkip:()=>{},onPause:()=>{},onNext:()=>{},onStageSelect:()=>{}}));
 assert.match(html,/<div class="card-info">[\s\S]*class="coupon-details"/);assert.match(html,/data-choice-button="left"[^>]*><\/button>/);assert.doesNotMatch(html,/data-candidate-id="[^"]+"[^>]*>[\s\S]*立即用券/);
});
test('checkout renders fresh official amount/take ways, external safe payment and persistent unknown states',async t=>{
 const f=await commerceFixture(t),{quote}=await f.quoted();const server=await createServer({server:{middlewareMode:true},appType:'custom'});t.after(()=>server.close());const m=await server.ssrLoadModule('/src/commerce/CheckoutPanel.tsx');assert.ok(m.CheckoutPanel);
 const render=(overrides:any)=>renderToStaticMarkup(createElement(m.CheckoutPanel,{state:{status:'ready',quote,order:null,error:null,attemptedQuoteKeys:[],...overrides},onTakeWayChange:()=>{},takeWayCode:quote.takeWays[0].code,onCreate:()=>{},onQuery:()=>{}}));
 assert.match(render({}),/15\.90/);assert.match(render({}),/堂食/);assert.match(render({}),/<button[^>]*>[^<]*15\.90/);
 const order={key:'owned',status:'pending-payment',statusLabel:'待支付',paymentUrl:'https://pay.example.test/order',pickupCode:null,totalCents:1590,storeName:'门店'};assert.match(render({status:'created',quote:null,order}),/href="https:\/\/pay.example.test\/order"[^>]*target="_blank"/);assert.doesNotMatch(render({status:'created',order:{...order,paymentUrl:'javascript:alert(1)'}}),/href="javascript/);
 const unknown=render({status:'unknown',quote:null,error:'ORDER_RESULT_UNKNOWN'});assert.match(unknown,/role="alert"/);assert.doesNotMatch(unknown,/未创建订单|确认创建/);
});
test('actual cart replacement renders trusted coupon product, neutral art and no false export after creation',async t=>{
 const f=await commerceFixture(t),collection=(await f.coupons()).json(),product=collection.products[0];const basket=[{candidateId:product.id,couponKey:collection.coupons[0].key,quantity:1,optionIds:[]}];const server=await createServer({server:{middlewareMode:true},appType:'custom'});t.after(()=>server.close());const {CartPage}=await server.ssrLoadModule('/src/cart/CartPage.tsx');const html=renderToStaticMarkup(createElement(CartPage,{snapshot:f.snapshot,basket,coupons:collection,onBasketChange:()=>{},arenas:[],totalDecisions:0,onReview:()=>{},onRestart:()=>{},onSetup:()=>{}}));
 assert.match(html,/data-coupon-product/);assert.doesNotMatch(html,/这份餐品已失效/);assert.match(html,/coupon-art-placeholder/);
 const text=basketText({contextKey:f.snapshot.contextKey,cartRevision:1,basket},f.snapshot,[],null,{products:collection.products,order:{key:'order',status:'pending-payment',statusLabel:'待支付',paymentUrl:null,pickupCode:null,totalCents:1590,storeName:'门店'},unknown:false});assert.doesNotMatch(text,/未创建订单/);assert.match(text,/待支付/);assert.match(text,/王牌小食拼/);
});
test('checkout state blocks attempted quotes, preserves unknown/order across basket edits and isolates connections',async()=>{
 const m=await import('../src/commerce/state.ts').catch(()=>null);assert.ok(m,'state model must exist');const basket=[{candidateId:'food',quantity:1,optionIds:[]}];const request={contextKey:'a',basket,cartRevision:1};const q={...request,basketKey:basketKey(basket),totalCents:100,currency:'CNY' as const,quotedAt:'now',mode:'live' as const,evidence:'official' as const,fees:[],quoteKey:'quote',expiresAt:'2099-01-01',takeWays:[{code:'eat',label:'堂食'}]};
 let state=m.emptyCheckout();state=m.acceptQuote(state,q,request);assert.equal(m.canCreateOrder(state,'eat'),true);state=m.beginOrder(state,'eat');assert.equal(m.canCreateOrder(state,'eat'),false);state=m.failOrder(state,'ORDER_RESULT_UNKNOWN');state=m.invalidateCheckout(state);assert.equal(state.status,'unknown');assert.equal(state.error,'ORDER_RESULT_UNKNOWN');assert.equal(state.quote,null);assert.equal(m.canCreateOrder(m.acceptQuote(state,{...q,quoteKey:'new'},request),'eat'),false);
 const order={key:'o',status:'pending-payment' as const,statusLabel:'待支付',paymentUrl:null,pickupCode:null,totalCents:100,storeName:null};state=m.finishOrder(state,order);assert.deepEqual(m.invalidateCheckout(state).order,order);assert.equal(m.emptyCheckout().order,null);
});
test('personal connection/context scope rejects prior identities even when a later account gets the same menu key',async()=>{
 const m=await import('../src/commerce/state.ts');assert.equal(typeof m.createConnectionScope,'function');const scope=m.createConnectionScope();const first=scope.beginConnection();scope.replaceContext('menu');const old=scope.stamp();assert.equal(scope.isCurrent(old),true);scope.replaceContext('next');assert.equal(scope.isCurrent(old),false);scope.beginConnection();scope.replaceContext('menu');assert.equal(scope.ownsConnection(first),false);assert.equal(scope.isCurrent(old),false);assert.equal('token' in scope,false);
});
test('account controls expose official credential link, password field and isolated keyboard region; disabled flag renders nothing',async t=>{
 const server=await createServer({server:{middlewareMode:true},appType:'custom'});t.after(()=>server.close());const {AccountPanel}=await server.ssrLoadModule('/src/commerce/AccountPanel.tsx');
 const props={session:{connected:false,expiresAt:null},busy:false,error:null,onConnect:async()=>{},onDisconnect:()=>{}};const html=renderToStaticMarkup(createElement(AccountPanel,{...props,enabled:true}));assert.match(html,/href="https:\/\/open.mcd.cn\/mcp"/);assert.match(html,/type="password"/);assert.match(html,/data-keyboard-isolation/);assert.equal(renderToStaticMarkup(createElement(AccountPanel,{...props,enabled:false})), '');
});
test('account entry is a closed native disclosure with connected status and private actions inside it',async t=>{
 const server=await createServer({server:{middlewareMode:true},appType:'custom'});t.after(()=>server.close());const {AccountPanel}=await server.ssrLoadModule('/src/commerce/AccountPanel.tsx');
 const props={enabled:true,session:{connected:true,expiresAt:'2099-01-01T00:00:00Z'},busy:false,error:null,onConnect:async()=>{},onDisconnect:()=>{}};const html=renderToStaticMarkup(createElement(AccountPanel,props));
 assert.match(html,/^<details[^>]*data-keyboard-isolation[^>]*><summary[^>]*>[\s\S]*已连接本人账号[\s\S]*<\/summary>/);assert.doesNotMatch(html,/^<details[^>]*\bopen(?:=|[ >])/);assert.match(html,/<\/summary>[\s\S]*连接有效期：[\s\S]*断开账号/);assert.doesNotMatch(html,/<h2/);
});
test('a loaded live menu offers refresh without instructing the user to load it for the first time',async t=>{
 const f=await commerceFixture(t);const server=await createServer({server:{middlewareMode:true},appType:'custom'});t.after(()=>server.close());const {StorePicker}=await server.ssrLoadModule('/src/setup/StorePicker.tsx');
 const html=renderToStaticMarkup(createElement(StorePicker,{mode:'live',store:f.snapshot.store,stores:[f.snapshot.store],busy:false,publicOnly:false,snapshot:f.snapshot,onModeChange:()=>{},onStoreChange:()=>{},onSearch:()=>{},onLoad:()=>{},loaded:true}));
 assert.doesNotMatch(html,/点按钮加载官方菜单/);assert.match(html,/官方菜单已加载/);assert.match(html,/<button[^>]*>刷新真实菜单/);
});
test('price change requires a new quote and chosen official take way before another explicit attempt',async()=>{
 const m=await import('../src/commerce/state.ts');const request={contextKey:'c',basket:[{candidateId:'food',quantity:1,optionIds:[]}],cartRevision:1};const quote={contextKey:'c',basketKey:basketKey(request.basket),cartRevision:1,totalCents:1590,currency:'CNY' as const,quotedAt:'now',mode:'live' as const,evidence:'official' as const,fees:[],quoteKey:'old',expiresAt:'2099-01-01',takeWays:[{code:'eat',label:'堂食'}]};let state=m.acceptQuote(m.emptyCheckout(),quote,request);assert.equal(m.canCreateOrder(state,'fake'),false);state=m.failOrder(m.beginOrder(state,'eat'),'PRICE_CHANGED');assert.equal(m.canCreateOrder(m.acceptQuote(state,quote,request),'eat'),false);state=m.acceptQuote(state,{...quote,quoteKey:'fresh',totalCents:1690},request);assert.equal(m.canCreateOrder(state,'eat'),true);assert.equal(m.canCreateOrder(state,'eat',Date.parse('2099-01-02')),false);
});
