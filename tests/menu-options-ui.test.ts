import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeCatalog} from '../src/catalog/normalize.ts';
import {createArena} from '../src/arena/engine.ts';
test('cart renders folded accessible real options, fixed flavors without artificial size and merchandise with neutral copy',async()=>{
 const raw=JSON.parse(readFileSync(new URL('./fixtures/menu-options.json',import.meta.url),'utf8'));
 const live=normalizeCatalog(raw,{contextKey:'ui',store:{id:'3330251',name:'测试',city:'杭州',address:'测试'},loadedAt:'2026-10-15T00:00:00Z',complete:true});
 const snapshot={...live,mode:'demo',sourceKind:'official-snapshot'};
 const selected=live.items.filter(c=>['香芋派','可乐','巨无霸','BFF四宫格小食盘'].includes(c.name)||c.officialCode==='521946');
 const server=await createServer({server:{middlewareMode:true},appType:'custom'});
 try {
  const {CartPage}=await server.ssrLoadModule('/src/cart/CartPage.tsx');
  const html=renderToStaticMarkup(createElement(CartPage,{snapshot,basket:selected.map(c=>({candidateId:c.id,quantity:1,optionIds:c.defaultVariantId?['variant:'+c.defaultVariantId]:[]})),onBasketChange:()=>{},arenas:[],totalDecisions:0,onReview:()=>{},onRestart:()=>{},onSetup:()=>{}}));
  assert.match(html,/定制餐品/);assert.match(html,/type="radio"/);assert.match(html,/type="checkbox"/);
  assert.match(html,/不加|酸黄瓜/);assert.match(html,/type="number"/);assert.doesNotMatch(html,/香芋派规格|固定口味.*最后再选|1 种规格/);
  assert.match(html,/默认配方/);assert.match(html,/这次，就选这些/);
  assert.doesNotMatch(html,/<details[^>]*class="cart-options"[^>]*open/);
  const {ArenaPage}=await server.ssrLoadModule('/src/arena/ArenaPage.tsx');
  const pies=live.items.filter(c=>['香芋派','菠萝派'].includes(c.name));
  const state=createArena(pies.map(c=>c.id),'pies','dessert',ids=>[ids[0],ids[1]]);
  const arena=renderToStaticMarkup(createElement(ArenaPage,{state,snapshot,arenas:[state],activeIndex:0,onChoose:()=>{},onUndo:()=>{},onSkip:()=>{},onPause:()=>{},onNext:()=>{},onStageSelect:()=>{}}));
  assert.match(arena,/class="meal-price"><strong>¥8\.00/);
  assert.doesNotMatch(arena,/最后再选|1 种规格/);
 } finally {await server.close();}
});
