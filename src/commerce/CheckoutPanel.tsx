import { useEffect, useState } from 'react';
import { CommerceError } from './api.ts';
import { canCreateOrder, safePaymentUrl, type CheckoutState } from './state.ts';
export function CheckoutPanel({state,takeWayCode,onTakeWayChange,onCreate,onQuery,queryBusy=false}:{state:CheckoutState;takeWayCode:string;onTakeWayChange:(code:string)=>void;onCreate:()=>void;onQuery:()=>void;queryBusy?:boolean}){
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{setNow(Date.now());if(!state.quote)return;const expires=Date.parse(state.quote.expiresAt);if(!Number.isFinite(expires)||expires<=Date.now())return;const timer=window.setTimeout(()=>setNow(Date.now()),expires-Date.now()+25);return()=>window.clearTimeout(timer);},[state.quote?.quoteKey,state.quote?.expiresAt]);
 const payment=state.order?safePaymentUrl(state.order.paymentUrl):null;
 return <section className="checkout-panel" data-keyboard-isolation aria-label="订单与支付" aria-busy={state.status==='creating'||queryBusy}><p className="eyebrow">订单与支付</p>
 {state.order?<><h2>{state.order.statusLabel}</h2><p>订单已创建，状态以官方返回为准。{state.order.storeName&&` ${state.order.storeName}`}</p>{state.order.totalCents!==null&&<p className="checkout-total">订单金额 ¥{(state.order.totalCents/100).toFixed(2)}</p>}{state.order.pickupCode&&<p>取餐码：<strong>{state.order.pickupCode}</strong></p>}<div className="checkout-actions">{payment&&(state.order.status==='pending-payment'||state.order.status==='unknown')&&<a className="button button-primary" href={payment} target="_blank" rel="noopener noreferrer">去官方页面支付 ↗</a>}<button className="button button-outline" disabled={queryBusy} onClick={onQuery}>{queryBusy?'正在刷新…':'刷新官方订单状态'}</button></div><p>打开支付页面不会改变本站显示的订单状态，请完成支付后刷新官方状态。</p></>:
 state.status==='unknown'?<><h2>订单结果待确认</h2><p role="alert">{new CommerceError('ORDER_RESULT_UNKNOWN').message}</p><a href="https://www.mcdonalds.com.cn/" target="_blank" rel="noopener noreferrer">查看麦当劳官方渠道 ↗</a></>:
 state.status==='creating'?<><h2>正在提交已确认的订单…</h2><p role="status">请稍等。取得结果前不要重复提交。</p></>:
 state.quote?<><h2>确认这份官方报价</h2><p>有效至 {new Date(state.quote.expiresAt).toLocaleTimeString('zh-CN')}；提交前会再次核对官方金额。</p>{Date.parse(state.quote.expiresAt)<=now&&<p role="status">报价已过期，请重新核价。</p>}<label className="cart-field">取餐方式<select value={takeWayCode} onChange={e=>onTakeWayChange(e.target.value)} aria-label="官方取餐方式"><option value="" disabled>请选择取餐方式</option>{state.quote.takeWays.map(t=><option key={t.code} value={t.code}>{t.label}</option>)}</select></label><p>点击下方按钮会创建本人订单，之后由你在官方页面支付。</p><button className="button button-primary" disabled={!canCreateOrder(state,takeWayCode,now)} onClick={onCreate}>确认 ¥{(state.quote.totalCents/100).toFixed(2)}，创建订单</button></>:
 <><h2>先取得当前餐单的官方报价</h2><p>核价后选择官方取餐方式，再确认金额创建订单。</p></>}
 {state.error&&state.status!=='unknown'&&<p role="alert" className="notice">{new CommerceError(state.error).message}</p>}</section>;
}
