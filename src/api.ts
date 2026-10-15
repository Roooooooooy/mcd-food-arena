import type {CatalogSnapshot,StoreOption} from './shared/contracts.ts';
import { publicDemoOnly } from './catalog/source.ts';
export function createLiveApi(publicOnly: boolean, fetcher: typeof fetch = fetch) {
function allowLive() { if (publicOnly) throw new Error('真实菜单请在本机运行；公开页面提供门店快照试玩。'); }
async function get<T>(path:string,input:Record<string,string>):Promise<T>{
 allowLive();
 try {
  const response=await fetcher(`${path}?${new URLSearchParams(input)}`,{signal:AbortSignal.timeout(60_000)});
  if(!response.ok){let code='UPSTREAM_FAILED';try{const result=await response.json();if(typeof result.error?.code==='string')code=result.error.code;}catch{/* Do not surface raw proxy output. */}
   const messages:Record<string,string>={MCP_UNAUTHORIZED:'本机 Token 无效或已过期，请检查服务端配置。',MCP_TOKEN_MISSING:'本机尚未配置 Token，请检查服务端配置。',MCP_RATE_LIMITED:'官方服务暂时限流，请稍后再试。',MCP_TIMEOUT:'官方服务响应超时，请重试。',UNSUPPORTED_DINING_MODE:'当前只支持到店自提。',STORE_NOT_VERIFIED:'请先搜索并选择官方返回的门店。',LIVE_NOT_READY:'本机实时服务尚未启动。'};
   throw new Error(messages[code]??'真实菜单服务暂时不可用，请确认本机 API 已启动后重试。');
  }
  return await response.json() as T;
 }catch(error){if(error instanceof Error&&error.name==='TimeoutError')throw new Error('加载超时，请稍后重试。');if(error instanceof TypeError)throw new Error('无法连接本机 API，请启动本机服务后重试。');throw error;}
}
function searchStores(input:{city:string;keyword:string}):Promise<StoreOption[]>{return get('/api/stores',input);}
function loadCatalog(input:{storeId:string;diningMode:string}):Promise<CatalogSnapshot>{return get('/api/catalog',input);}

const quoteMessages:Record<string,string>={
 CATALOG_CONTEXT_MISSING:'菜单或门店已变化，请重新加载菜单后核价。',
 PRODUCT_NOT_IN_CONTEXT:'餐品不在当前菜单，请返回分类重新选择。',
 OPTION_NOT_IN_CONTEXT:'规格已失效，请重新选择实际杯型。',
 SELECTION_REQUIRED:'套餐缺少可确认的默认选择，请调整餐盘或在官方渠道完成选配。',
 QUOTE_INVALID_AMOUNT:'官方响应未提供有效金额，未取得报价。',
 QUOTE_UNAVAILABLE:'官方暂未确认这份餐盘金额，未取得报价。',
 MCP_UNAUTHORIZED:'本机 Token 无效或已过期，请检查服务端配置。',
 MCP_TOKEN_MISSING:'本机尚未配置 Token，请检查服务端配置。',
 MCP_RATE_LIMITED:'官方服务暂时限流，请稍后重试。',
 MCP_TIMEOUT:'官方核价超时，未取得报价，请重试。',
};
async function post<T>(path:string,input:import('./shared/contracts.ts').QuoteRequest):Promise<T>{
 allowLive();
 try {
  const response=await fetcher(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(60_000)});
  if(!response.ok){let code='UPSTREAM_FAILED';try{const body=await response.json();if(typeof body.error?.code==='string')code=body.error.code;}catch{/* Stable text only. */}throw new Error(quoteMessages[code]??'未取得官方结果，请确认本机 API 已启动后重试。');}
  return await response.json() as T;
 }catch(error){if(error instanceof Error&&error.name==='TimeoutError')throw new Error('响应超时，未取得报价，请重试。');if(error instanceof TypeError)throw new Error('无法连接本机 API，请启动本机服务后重试。');throw error;}
}
function quoteBasket(request:import('./shared/contracts.ts').QuoteRequest):Promise<import('./shared/contracts.ts').QuoteResult>{return post('/api/quote',request);}
function loadBasketSelection(request:import('./shared/contracts.ts').QuoteRequest):Promise<import('./shared/contracts.ts').BasketSelection[]>{return post('/api/selection',request);}

return { searchStores, loadCatalog, quoteBasket, loadBasketSelection };
}
const client = createLiveApi(publicDemoOnly);
export const { searchStores, loadCatalog, quoteBasket, loadBasketSelection } = client;
