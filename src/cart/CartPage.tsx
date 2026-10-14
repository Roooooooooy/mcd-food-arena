import { useEffect, useState } from 'react';
import type { ArenaState, BasketLine, BasketSelection, CatalogSnapshot } from '../shared/contracts.ts';
import { loadBasketSelection, quoteBasket } from '../api.ts';
import { FoodArt } from '../arena/FoodArt.tsx';
import { referencePrice } from '../arena/ArenaPage.tsx';
import { CandidateDetails, nutritionText } from '../catalog/CandidateDetails.tsx';
import { stageName } from '../catalog/normalize.ts';
import { basketKey, basketText, createQuoteTracker, moneyToCents, sampleQuote, type QuoteState } from './model.ts';

interface Props {snapshot:CatalogSnapshot;basket:BasketLine[];onBasketChange:(lines:BasketLine[])=>void;arenas:ArenaState[];totalDecisions:number;onReview:(index:number)=>void;onRestart:()=>void;onSetup:()=>void}
export function CartPage({snapshot,basket,onBasketChange,arenas,totalDecisions,onReview,onRestart,onSetup}:Props){
 const frozen=snapshot.sourceKind==='official-snapshot';
 const conditional=basket.some(line=>snapshot.items.find(item=>item.id===line.candidateId)?.attributes.some(a=>a.includes('条件价')));
 const initial={contextKey:snapshot.contextKey,basket,cartRevision:0};
 const [state,setState]=useState<QuoteState>({request:initial,status:'idle',quote:null,error:null});
 const [tracker]=useState(()=>createQuoteTracker(initial,setState));
 const [selections,setSelections]=useState<BasketSelection[]>([]);
 const [selectionStatus,setSelectionStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle');
 const [selectionError,setSelectionError]=useState<string|null>(null);
 const [selectionRetry,setSelectionRetry]=useState(0);
 const [budget,setBudget]=useState('');
 const [notice,setNotice]=useState<string|null>(null);
 const key=basketKey(state.request.basket);
 useEffect(()=>()=>tracker.cancel(),[tracker]);
 useEffect(()=>{
  let active=true;
  setSelections([]);setSelectionError(null);
  if(snapshot.mode==='demo'||state.request.basket.length===0){setSelectionStatus('ready');return;}
  setSelectionStatus('loading');
  void loadBasketSelection(state.request).then(result=>{if(active){setSelections(result);setSelectionStatus('ready');}},error=>{if(active){setSelectionStatus('error');setSelectionError(error instanceof Error?error.message:'选配读取失败，请重试。');}});
  return()=>{active=false;};
 },[key,snapshot.contextKey,snapshot.mode,selectionRetry]);
 function change(lines:BasketLine[]){onBasketChange(lines);tracker.replace({...state.request,basket:lines,cartRevision:state.request.cartRevision+1});setNotice(null);}
 function update(id:string,values:Partial<BasketLine>){change(state.request.basket.map(line=>line.candidateId===id?{...line,...values}:line));}
 const text=basketText(state.request,snapshot,selections,state.quote);
 async function copy(){try{await navigator.clipboard.writeText(text);setNotice('餐单已复制。');}catch{setNotice('浏览器未允许复制，可下载餐单。');}}
 function download(){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='麦麦擂台餐单.txt';link.click();URL.revokeObjectURL(url);setNotice('餐单已下载。');}
 let budgetCents:number|null=null;let budgetError=false;
 if(budget){try{budgetCents=moneyToCents(budget,'yuan');}catch{budgetError=true;}}
 const over=state.quote&&budgetCents!==null?Math.max(0,state.quote.totalCents-budgetCents):0;
 const needsSelection=selections.some(s=>s.requiresSelection);
 const canQuote=state.request.basket.length>0&&selectionStatus==='ready'&&!needsSelection&&state.status!=='loading';
 return <section className="result-page cart-page" data-page="result"><div className="result-celebration" aria-hidden="true"><span>✦</span><span>✧</span><span>✦</span></div><p className="eyebrow">每一轮，都是你的口味</p><h1>今天的心动冠军，<br/><span>集合了。</span></h1><p className="result-description">经过 {totalDecisions} 次选择，餐盘由你最后拍板。选好{frozen?'快照中的规格':'实际杯型'}和数量，再{frozen?'计算参考合计':'核对整单金额'}。</p><div className="result-stats"><span>{arenas.length} 个赛区</span><span>{totalDecisions} 次决定</span><span>{state.request.basket.length} 种餐品</span></div>
  <div className="champion-grid">{state.request.basket.map(line=>{
   const item=snapshot.items.find(i=>i.id===line.candidateId);
   if(!item)return <article className="result-card" key={line.candidateId}><h2>餐品已失效</h2><button className="button button-outline" onClick={()=>change(state.request.basket.filter(l=>l.candidateId!==line.candidateId))}>移出餐盘</button></article>;
   const arenaIndex=arenas.findIndex(a=>a.championId===item.id);
   const selected=item.variants?.find(v=>'variant:'+v.id===line.optionIds[0]);
   const selection=selections.find(s=>s.candidateId===item.id);
   return <article className="result-card cart-card" key={item.id}><div className="result-card-top"><span>{stageName(item)}赛区</span><span>冠军 ★</span></div><FoodArt item={selected?{...item,imageUrl:selected.imageUrl??item.imageUrl}:item}/><h2>{item.name}</h2>
    {item.variants&&<label className="cart-field">实际规格<select value={selected?.id??''} onChange={e=>update(item.id,{optionIds:['variant:'+e.target.value]})}>{!selected&&<option value="" disabled>请选择规格</option>}{item.variants.map(v=><option key={v.id} value={v.id}>{v.sizeLabel} · {v.name}</option>)}</select></label>}
    {selected&&<p className="selected-variant"><strong>已选：{selected.name}</strong><br/>{nutritionText(selected.nutrition)}</p>}
    <p><strong>{selected?selected.referencePriceCents===null?'参考价未知':`¥${(selected.referencePriceCents/100).toFixed(2)}`:referencePrice(item)}</strong><span> {frozen?'快照参考':snapshot.mode==='demo'?'样例参考':'菜单参考'}</span></p><CandidateDetails item={item}/>{frozen&&item.attributes.some(a=>a.includes('条件价'))&&<p className="notice">{item.attributes.filter(a=>a.includes('条件价')).join(' · ')}；快照不保证满足适用条件。</p>}
    {snapshot.mode==='live'&&selectionStatus==='loading'&&<p className="cart-composition">正在确认实际默认选配…</p>}
    {selection&&selection.components.length>0&&<div className="cart-composition"><strong>{item.variants?'实际规格':'官方默认套餐内容'}</strong><ul>{selection.components.map((c,index)=><li key={index}>{c.name} × {c.quantity}</li>)}</ul></div>}
    {selection?.requiresSelection&&<p className="notice">此套餐暂无可确认的默认选配，不能核价。请重选餐品或到官方渠道完成选配。</p>}
    <div className="cart-line-actions"><label className="cart-field">数量<select aria-label={`${item.name}数量`} value={line.quantity} onChange={e=>update(item.id,{quantity:Number(e.target.value)})}>{Array.from({length:99},(_,i)=>i+1).map(n=><option key={n} value={n}>{n} 份</option>)}</select></label><button className="cart-remove" onClick={()=>change(state.request.basket.filter(l=>l.candidateId!==item.id))}>移出餐盘</button></div><button className="result-review" onClick={()=>{tracker.cancel();onReview(arenaIndex);}}>重选这个赛区 <span aria-hidden="true">↗</span></button>
   </article>;
  })}</div>
  {state.request.basket.length===0&&<p className="notice">餐盘现在是空的。可返回赛区重新选出冠军。</p>}
  <section className="cart-quote" aria-label={frozen?'快照参考合计':'整单核价'} aria-busy={state.status==='loading'}><div><p className="eyebrow">{frozen?'快照参考合计 / 采集时数据':snapshot.mode==='live'?'官方整单核价':'样例合计 / 非官方报价'}</p><h2>{state.quote?`¥${(state.quote.totalCents/100).toFixed(2)}`:state.status==='loading'?frozen?'正在计算…':'正在核价…':frozen?'尚未计算参考合计':'未取得报价'}</h2><p>{snapshot.store?.name??'虚构样例门店'} · 到店自提</p><p>{frozen?'按采集时菜单参考价相加；不含实时费用、优惠或套餐选配校验。':'参考价仅供比较，整单金额以本次官方返回为准。'}</p>{frozen&&conditional&&<p className="notice">餐盘含随单购条件价，参考合计仅在对应条件适用时成立，不能作为购买报价。</p>}</div>
   <div className="cart-quote-controls"><label className="cart-field">我的预算（元，可选）<input type="number" min="0" step="0.01" placeholder="不限预算" value={budget} onChange={e=>setBudget(e.target.value)}/></label>{budgetError&&<p role="status">请填写有效预算，最多两位小数。</p>}<button className="button button-primary" disabled={!canQuote} onClick={()=>void tracker.run(snapshot.mode==='live'?quoteBasket:req=>Promise.resolve(sampleQuote(req,snapshot)))}>{state.status==='loading'?frozen?'正在计算…':'正在核价…':frozen?'计算快照参考合计':snapshot.mode==='live'?'获取官方整单报价':'计算样例合计'} <span aria-hidden="true">→</span></button></div>
   {selectionStatus==='error'&&<p className="notice" role="status">{selectionError} <button className="cart-remove" onClick={()=>setSelectionRetry(v=>v+1)}>重试选配</button></p>}
   {state.error&&<p className="notice" role="status">{frozen?'未取得参考合计。':'未取得报价。'}{state.error}</p>}
   {state.quote&&<div className="quote-evidence" role="status"><p>{state.quote.evidence==='official'?'来源：官方 calculate-price 整单结果':state.quote.evidence==='snapshot'?'来源：保存的官方门店菜单参考价合计，非实时官方报价':'来源：虚构样例参考价合计，非官方报价'}</p>{frozen&&<p>快照采集时间：{new Date(snapshot.capturedAt??snapshot.loadedAt).toLocaleString('zh-CN')}</p>}<p>{frozen?'计算':'核价'}时间：{new Date(state.quote.quotedAt).toLocaleString('zh-CN')}</p>{state.quote.fees.length?state.quote.fees.map(f=><p key={f.label}>{f.label} ¥{(f.amountCents/100).toFixed(2)}（官方返回，已包含于整单金额）</p>):<p>{frozen?'快照未包含实时费用明细。':snapshot.mode==='live'?'本次官方响应未提供单独费用明细。':'样例不提供真实费用明细。'}</p>}{over>0&&<p className="notice">超出预算 ¥{(over/100).toFixed(2)}，可调整数量、移出餐品或重选赛区后{frozen?'重新计算':'再核价'}。</p>}</div>}
  </section>
  <p className="result-note">数量、规格或餐盘变化后，{frozen?'参考合计':'报价'}立即失效。此处生成餐单与{frozen?'快照参考合计':'核价'}，未创建订单。</p><div className="result-actions"><button className="button button-outline" onClick={copy} disabled={!state.request.basket.length}>复制餐单</button><button className="button button-outline" onClick={download} disabled={!state.request.basket.length}>下载餐单</button></div>{notice&&<p role="status" className="notice">{notice}</p>}
  <div className="cart-stage-links">{arenas.map((arena,index)=>{const item=snapshot.items.find(i=>i.stageId===arena.stageId);return <button className="cart-remove" key={arena.arenaId} onClick={()=>{tracker.cancel();onReview(index);}}>重选{item?stageName(item):'当前'}赛区</button>;})}</div><div className="result-actions"><button className="button button-primary" onClick={onRestart}>重新开局 <span aria-hidden="true">↻</span></button><button className="button button-outline" onClick={onSetup}>调整赛区 <span aria-hidden="true">→</span></button></div>
 </section>;
}
