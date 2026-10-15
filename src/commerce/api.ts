import type { AvailabilityResult, CandidateAvailabilityRequest, BasketAvailabilityRequest } from './availability-contracts.ts';
import type { BasketSelection, CatalogSnapshot, StoreOption } from '../shared/contracts.ts';
import type { CommerceRequest, CommerceQuote, CouponCollection, CreateOrderInput, PersonalOrder, SessionInfo } from './contracts.ts';

export const publicCommerce = import.meta.env?.VITE_PUBLIC_COMMERCE === 'true';
const messages:Record<string,string>={
 COMMERCE_DISABLED:'此页面可试玩菜单快照。连接本人账号请使用已开启账号功能的本机页面。',
 STALE_RESULT:'账号或菜单已变化，这次结果已忽略。', SESSION_REQUIRED:'账号连接已失效，请重新连接。',
 MCP_UNAUTHORIZED:'Token 无效或已过期，请重新获取后连接。', INVALID_TOKEN:'Token 格式不正确，请检查后连接。',
 MCP_RATE_LIMITED:'官方服务暂时限流，请稍后再试。', MCP_TIMEOUT:'官方服务响应超时，请稍后再试。',
 CURRENTLY_UNAVAILABLE:'当前菜单或优惠券未返回所选餐品，请刷新状态后更换规格或餐品。',
 PRICE_CHANGED:'官方金额或取餐方式已变化。请重新核价，再确认新金额。',
 ORDER_RESULT_UNKNOWN:'订单结果暂时无法确认。请到麦当劳官方 App 查看订单，避免重复下单。',
 ORDER_ATTEMPT_CONFLICT:'这份报价已提交，请查看订单结果。', QUOTE_EXPIRED:'报价已过期，请重新核价。',
 COUPON_NOT_IN_CONTEXT:'这张券已失效或不适用当前门店，请刷新券包后重新选择。',
 CATALOG_CONTEXT_MISSING:'菜单或门店已变化，请重新加载。', PRODUCT_NOT_IN_CONTEXT:'餐品已失效，请重新选择。',
 OPTION_NOT_IN_CONTEXT:'规格或定制选项已失效，请重新选择。', SELECTION_REQUIRED:'请完成必选项和选配数量后再核价。',
 COUPONS_UNAVAILABLE:'暂时无法读取券包，请稍后刷新。', COUPONS_INVALID_RESPONSE:'券包信息暂时无法确认，请稍后刷新。',
 QUOTE_UNAVAILABLE:'暂时无法取得官方报价，请稍后重试。', ORDER_QUERY_UNAVAILABLE:'订单状态刷新失败，可到官方 App 查看。',
 NETWORK_ERROR:'无法连接账号服务，请检查本机服务后重试。', RESPONSE_INVALID:'官方结果暂时无法确认。',
};
export class CommerceError extends Error { code:string; constructor(code:string) {super(messages[code]??'暂时未取得官方结果，请稍后重试。');this.name='CommerceError';this.code=code;} }
export function createCommerceApi(enabled:boolean, fetcher:typeof fetch=fetch) {
 let generation=0;const pending=new Set<AbortController>();
 function invalidate(){generation++;for(const controller of pending)controller.abort();pending.clear();}
 async function request<T>(path:string,body?:unknown,query?:Record<string,string>):Promise<T>{
  if(!enabled)throw new CommerceError('COMMERCE_DISABLED');
  const version=generation,controller=new AbortController();pending.add(controller);
  try {
   const response=await fetcher('/api/commerce'+path+(query?'?'+new URLSearchParams(query):''),{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(path==='/orders'?20_000:60_000)])});
   if(version!==generation)throw new CommerceError('STALE_RESULT');
   let value:any;try{value=await response.json();}catch{throw new CommerceError(path==='/orders'?'ORDER_RESULT_UNKNOWN':'RESPONSE_INVALID');}
   if(version!==generation)throw new CommerceError('STALE_RESULT');
   if(!response.ok)throw new CommerceError(typeof value?.error?.code==='string'?value.error.code:'RESPONSE_INVALID');
   return value as T;
  }catch(error){
   if(version!==generation)throw new CommerceError('STALE_RESULT');
   if(error instanceof CommerceError)throw error;
   throw new CommerceError(path==='/orders'?'ORDER_RESULT_UNKNOWN':'NETWORK_ERROR');
  }finally{pending.delete(controller);}
 }
 return {
  invalidate,
  connect(token:string){invalidate();return request<SessionInfo>('/connect',{token});},
  session:()=>request<SessionInfo>('/session'),
  disconnect(){invalidate();return request<SessionInfo>('/disconnect',{});},
  stores:(input:{city:string;keyword:string})=>request<StoreOption[]>('/stores',undefined,input),
  catalog:(input:{storeId:string;diningMode:string})=>request<CatalogSnapshot>('/catalog',undefined,input),
  coupons:(contextKey:string)=>request<CouponCollection>('/coupons',undefined,{contextKey}),
  availability:(input:CandidateAvailabilityRequest)=>request<AvailabilityResult>('/availability',input),
  basketAvailability:(input:BasketAvailabilityRequest)=>request<AvailabilityResult>('/basket-availability',input),
  selection:(input:CommerceRequest)=>request<BasketSelection[]>('/selection',input),
  quote:(input:CommerceRequest)=>request<CommerceQuote>('/quote',input),
  createOrder:(input:CreateOrderInput)=>request<PersonalOrder>('/orders',input),
  queryOrder:(orderKey:string)=>request<PersonalOrder>('/query-order',{orderKey}),
 };
}
export type CommerceApi=ReturnType<typeof createCommerceApi>;
