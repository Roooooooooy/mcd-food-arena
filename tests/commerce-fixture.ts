import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createCommerceRuntime } from '../server/commerce/main.ts';
import type { McpGateway } from '../server/mcp/gateway.ts';
import { setRoundChoice } from '../src/cart/options.ts';
export const headers = { host: '127.0.0.1:8788', origin: 'http://127.0.0.1:5173' };
export const ROOT = '/api/commerce';
export const couponDetail = { code:'9900016371',name:'王牌小食拼',supportModify:false,rounds:[
 {id:1,name:'选择小食',minQuantity:1,maxQuantity:1,quantity:1,choices:[
  {code:'1700',name:'麦辣鸡翅2块',quantity:1,isDefault:1,maxQuantity:-1},
  {code:'4810',name:'中薯条',quantity:0,isDefault:0,maxQuantity:-1},
  {code:'505416',name:'麦麦脆汁鸡-琵琶腿',quantity:0,isDefault:0,maxQuantity:-1},
 ]},
 {id:2,name:'选择饮料/小食',minQuantity:1,maxQuantity:1,quantity:1,choices:[
  {code:'3050',name:'可乐中杯',quantity:1,isDefault:1,maxQuantity:-1},
  {code:'3071',name:'无糖可口可乐中杯',quantity:0,isDefault:0,maxQuantity:-1},
  {code:'3505',name:'锡兰红茶',quantity:0,isDefault:0,maxQuantity:-1},
  {code:'4106',name:'香芋派',quantity:0,isDefault:0,maxQuantity:-1},
  {code:'4105',name:'菠萝派',quantity:0,isDefault:0,maxQuantity:-1},
 ]},
] };
export async function commerceFixture(t:TestContext) {
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const wallet=[{id:'private-coupon-id',code:'private-coupon-code',title:'王牌小食拼',subtitle:'自选小食',enable:1,datetimeText:'有效期见卡包',tags:[{label:'本人券'}]}, {id:'not-store',code:'not-store-code',title:'仅卡包券',enable:1}];
 const store=[{couponId:'private-coupon-id',couponCode:'private-coupon-code',title:'王牌小食拼',products:[{productCode:'9900016371',productName:'王牌小食拼'}]}];
 const state:{wallet:unknown[];store:unknown;detail:unknown;pages:number;quote?:unknown;price?:number;create?:unknown;createWait?:Promise<unknown>;order:unknown;menu?:unknown;details?:Record<string,unknown>}={wallet,store,detail:couponDetail,pages:1,order:{data:{orderId:'private-order-id',orderStatus:'1',totalAmount:'15.90',storeName:'本人门店',pickupCode:'A001'}}};
 const gateway:McpGateway={listTools:async()=>[],close:async()=>{},call:async(name,args)=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='query-meals'&&state.menu!==undefined)return{data:state.menu};
  if(name==='query-meals')return{data:{categories:[{name:'小食',meals:[{code:'4810'},{code:'9900008752'}]}],meals:{'4810':{name:'中薯条',currentPrice:'14'},'9900008752':{name:'派',currentPrice:'8'}}}};
  if(name==='list-nutrition-foods')return{data:''};
  if(name==='query-meal-detail'){if(state.details&&Object.hasOwn(state.details,String(args.code)))return{data:state.details[String(args.code)]};if(args.code==='9900016371')return{data:state.detail};if(args.code==='9900008752')return{data:{code:'9900008752',name:'派',rounds:[{id:1,name:'派口味',minQuantity:1,maxQuantity:1,quantity:1,choices:[{code:'4105',name:'菠萝派',quantity:1,isDefault:1,maxQuantity:-1},{code:'4106',name:'香芋派',quantity:0,isDefault:0,maxQuantity:-1}]}]}};return{data:{code:args.code,name:args.code==='4810'?'中薯条':'菠萝派',rounds:[]}};}
  if(name==='query-my-coupons')return{success:true,code:200,data:{coupons:state.wallet,totalCount:state.wallet.length*state.pages,currentPage:Number(args.page),pageSize:200,totalPages:state.pages}};
  if(name==='query-store-coupons')return{data:state.store};
  if(name==='calculate-price'){
   if(state.quote!==undefined)return state.quote;
   const items=args.items as {productCode:string;quantity:number}[];
   return{success:true,code:200,data:{price:state.price??items.reduce((n,i)=>n+({'4810':1400,'9900008752':800,'9900016371':1590}[i.productCode]??0)*i.quantity,0),productList:items.map(i=>({...i,productName:i.productCode,subtotal:i.productCode==='9900016371'?1590:800})),takeWayList:[{code:'eat-in',title:'堂食',subtitle:'店内用餐'}]}};
  }
  if(name==='create-order'){if(state.createWait)return state.createWait;return state.create??{data:{orderId:'private-order-id',payH5Url:'https://pay.example.test/order',orderDetail:state.order && (state.order as {data:unknown}).data}};}
  if(name==='query-order')return state.order;
  throw new Error('unexpected external gateway call');
 }};
 const runtime=createCommerceRuntime({connect:async()=>gateway});t.after(()=>runtime.app.close());
 async function connect(){const r=await runtime.app.inject({method:'POST',url:ROOT+'/connect',headers,payload:{token:'fake-token'}});assert.equal(r.statusCode,200);return String(r.headers['set-cookie']).split(';')[0];}
 const cookie=await connect();
 async function request(method:'GET'|'POST',path:string,payload?:Record<string,unknown>,ownCookie=cookie){return runtime.app.inject({method,url:ROOT+path,headers:{...headers,cookie:ownCookie},payload});}
 const catalog=await request('GET','/catalog?storeId=3330251&diningMode=pickup');assert.equal(catalog.statusCode,200);
 const snapshot=catalog.json();calls.length=0;
 async function coupons(){return request('GET','/coupons?contextKey='+encodeURIComponent(snapshot.contextKey));}
 async function quoted(){const c=await coupons();assert.equal(c.statusCode,200);const collection=c.json();const candidate=collection.products[0];assert.ok(candidate);let optionIds:string[]=[];for(const code of ['4810','4105']){const choice=candidate.comboRounds.flatMap((r:any)=>r.choices).find((c:any)=>c.officialCode===code)!;optionIds=setRoundChoice(candidate,optionIds,choice.id,1);}const input={contextKey:snapshot.contextKey,cartRevision:1,basket:[{candidateId:candidate.id,quantity:1,optionIds,couponKey:collection.coupons[0].key}]};const q=await request('POST','/quote',input);assert.equal(q.statusCode,200);return {quote:q.json(),input,collection};}
 return{...runtime,cookie,connect,request,coupons,quoted,calls,state,snapshot};
}
