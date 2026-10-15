import { resolveOptions } from './options.ts';
import { mcdMemes } from '../copy/memes.ts';
import type { BasketLine, QuoteRequest, QuoteResult } from '../shared/contracts.ts';
export function buildBasket(winners: string[]): BasketLine[] {
  return [...new Set(winners)].map(candidateId => ({ candidateId, quantity: 1, optionIds: [] }));
}
export function basketKey(lines: BasketLine[]): string {
  return JSON.stringify(lines.map(line => ({ candidateId: line.candidateId, quantity: line.quantity, optionIds: [...line.optionIds].sort() })).sort((a,b) => a.candidateId.localeCompare(b.candidateId) || JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function quoteIsCurrent(quote: QuoteResult, request: QuoteRequest): boolean {
  return quote.contextKey === request.contextKey && quote.basketKey === basketKey(request.basket) && quote.cartRevision === request.cartRevision;
}
export function moneyToCents(value: string | number, unit: 'yuan' | 'cent'): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('INVALID_MONEY');
  const [whole, fraction = ''] = text.split('.');
  if (unit === 'cent' && fraction && Number(fraction) !== 0) throw new Error('INVALID_MONEY');
  const amount = unit === 'yuan' ? Number(whole) * 100 + Number(fraction.padEnd(2,'0')) : Number(whole);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('INVALID_MONEY');
  return amount;
}
export interface QuoteState { request: QuoteRequest; status: 'idle'|'loading'|'success'|'error'; quote: QuoteResult|null; error: string|null }
export function createQuoteTracker(request: QuoteRequest, publish: (state: QuoteState) => void = () => {}) {
  let state: QuoteState = { request, status:'idle', quote:null, error:null };
  let generation = 0;
  const emit = () => publish(state);
  return {
    getState: () => state,
    replace(next: QuoteRequest) { generation++; state = {request:next,status:'idle',quote:null,error:null}; emit(); },
    cancel() { generation++; },
    async run(provider: (request: QuoteRequest) => Promise<QuoteResult>) {
      const version = ++generation;
      const current = structuredClone(state.request);
      state = {...state,status:'loading',quote:null,error:null}; emit();
      try {
        const quote = await provider(current);
        if (version !== generation) return;
        if (!quoteIsCurrent(quote,state.request)) throw new Error('餐单改了，请重新核价。');
        state = {...state,status:'success',quote,error:null}; emit();
      } catch(error) {
        if(version !== generation) return;
        state = {...state,status:'error',quote:null,error:error instanceof Error ? error.message : '未取得报价，请重试。'}; emit();
      }
    },
  };
}
export function buildWinnerBasket(winners:string[],snapshot:import('../shared/contracts.ts').CatalogSnapshot):BasketLine[]{
 return buildBasket(winners).map(line=>{const item=snapshot.items.find(i=>i.id===line.candidateId);return {...line,optionIds:item?.defaultVariantId?['variant:'+item.defaultVariantId]:[]};});
}
export function sampleQuote(request:QuoteRequest,snapshot:import('../shared/contracts.ts').CatalogSnapshot):QuoteResult{
 const label=snapshot.sourceKind==='official-snapshot'?'快照':'样例';
 if(snapshot.mode!=='demo'||request.contextKey!==snapshot.contextKey||!request.basket.length)throw new Error(`${label}餐单不可用。`);
 let totalCents=0;
 const seen=new Set<string>();
 for(const line of request.basket){
  const item=snapshot.items.find(i=>i.id===line.candidateId);
  if(!item||seen.has(line.candidateId)||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>99)throw new Error(`${label}餐单不可用。`);
  seen.add(line.candidateId);
  const value=resolveOptions(item,line.optionIds).referencePriceCents;
  if(value===null||!Number.isSafeInteger(value)||value<0)throw new Error(`${label}参考价未知，未取得合计。`);
  totalCents+=value*line.quantity;
 }
 if(!Number.isSafeInteger(totalCents))throw new Error(`${label}金额不可用。`);
 return {contextKey:request.contextKey,basketKey:basketKey(request.basket),cartRevision:request.cartRevision,totalCents,currency:'CNY',quotedAt:new Date().toISOString(),mode:'demo',evidence:snapshot.sourceKind==='official-snapshot'?'snapshot':'sample',fees:[]};
}
export function basketText(request:QuoteRequest,snapshot:import('../shared/contracts.ts').CatalogSnapshot,selections:import('../shared/contracts.ts').BasketSelection[],quote:QuoteResult|null):string{
 const current=quote&&quoteIsCurrent(quote,request)?quote:null;
 const frozen=snapshot.sourceKind==='official-snapshot';
 const lines=request.basket.map(line=>{
  const item=snapshot.items.find(i=>i.id===line.candidateId);if(!item)return '失效商品';
  const selection=selections.find(s=>s.candidateId===line.candidateId);
  try {
   const selected=resolveOptions(item,line.optionIds);
   const parts=selected.components.length?selected.components:selection?.components??[];
   const composition=parts.map(c=>`${c.name} × ${c.quantity}`).join('、');
   const condition=item.attributes.filter(a=>a.includes('条件价')).join('、');
   return `${item.name} × ${line.quantity}${composition?`；实际选配：${composition}`:''}${selected.summary.length?`；定制：${selected.summary.join('、')}`:'；沿用官方默认'}${frozen&&condition?`；${condition}`:''}`;
  }catch{return `${item.name} × ${line.quantity}；选配待确认`;}
 });
 return ['麦麦二选一 · 餐单',`来源：${frozen?'官方菜单（门店快照）':snapshot.mode==='live'?'官方菜单':'虚构样例'}`,`门店：${snapshot.store?.name??'样例门店'}`,...(frozen?[`快照采集时间：${snapshot.capturedAt??snapshot.loadedAt}`,'价格、规格和营养来自采集时的菜单，仅供参考。条件价不保证适用，未取得实时官方报价。']:[]),...lines,'营养仅为官方默认配方参考，未计算定制后的营养。',current?`${current.evidence==='official'?'官方整单金额':current.evidence==='snapshot'?'快照参考合计':'样例合计'}：¥${(current.totalCents/100).toFixed(2)}`:frozen?'快照参考合计：未计算或参考价未知':'官方整单金额：未取得报价',`${frozen?'计算':'核价'}时间：${current?.quotedAt??'未计算'}`,'本页只生成餐单，未创建订单。',mcdMemes.eternal.text].join('\n');
}
export function reconcileBasket(previous:BasketLine[],previousWinners:string[],winners:string[],snapshot:import('../shared/contracts.ts').CatalogSnapshot):BasketLine[]{
 const kept=previous.filter(line=>winners.includes(line.candidateId));
 const added=buildWinnerBasket(winners.filter(id=>!previousWinners.includes(id)),snapshot);
 return [...kept,...added];
}
