import { quoteIsCurrent } from '../cart/model.ts';
import type { CommerceQuote, CommerceRequest, PersonalOrder } from './contracts.ts';
/** A new connection always invalidates prior menu identities, even if context keys happen to repeat. */
export function createConnectionScope(){
 let connection=0,contextRevision=0,contextKey:string|null=null;
 return {
  get connection(){return connection;},get contextRevision(){return contextRevision;},
  beginConnection(){connection++;contextRevision++;contextKey=null;return connection;},
  replaceContext(key:string|null){contextRevision++;contextKey=key;},
  ownsConnection:(value:number)=>value===connection,
  stamp:()=>({connection,contextRevision,contextKey}),
  isCurrent:(stamp:{connection:number;contextRevision:number;contextKey:string|null})=>stamp.connection===connection&&stamp.contextRevision===contextRevision&&stamp.contextKey===contextKey,
  hasContext:(key:string)=>contextKey===key,
 };
}
export interface CheckoutState {
 status:'idle'|'ready'|'creating'|'created'|'unknown'|'error';
 quote:CommerceQuote|null;order:PersonalOrder|null;error:string|null;attemptedQuoteKeys:string[];
}
export const emptyCheckout=():CheckoutState=>({status:'idle',quote:null,order:null,error:null,attemptedQuoteKeys:[]});
export function invalidateCheckout(state:CheckoutState):CheckoutState {
 return {...state,quote:null,status:state.order?'created':state.status==='unknown'?'unknown':state.status==='creating'?'creating':'idle',error:state.status==='unknown'?state.error:null};
}
export function acceptQuote(state:CheckoutState,quote:CommerceQuote,request:CommerceRequest):CheckoutState {
 if(!quoteIsCurrent(quote,request)||quote.evidence!=='official')throw new Error('STALE_QUOTE');
 if(state.order||state.status==='unknown'||state.status==='creating')return state;
 return {...state,quote,status:'ready',error:null};
}
export function canCreateOrder(state:CheckoutState,takeWayCode:string,now=Date.now()):boolean {
 return state.status==='ready'&&!state.order&&!!state.quote&&Number.isFinite(Date.parse(state.quote.expiresAt))&&Date.parse(state.quote.expiresAt)>now&&!state.attemptedQuoteKeys.includes(state.quote.quoteKey)&&state.quote.takeWays.some(t=>t.code===takeWayCode);
}
export function beginOrder(state:CheckoutState,takeWayCode:string):CheckoutState {
 if(!canCreateOrder(state,takeWayCode))throw new Error('ORDER_NOT_READY');
 return {...state,status:'creating',error:null,attemptedQuoteKeys:[...state.attemptedQuoteKeys,state.quote!.quoteKey]};
}
export function finishOrder(state:CheckoutState,order:PersonalOrder):CheckoutState{return {...state,status:'created',quote:null,order,error:null};}
export function failOrder(state:CheckoutState,code:string):CheckoutState{return {...state,quote:null,status:code==='ORDER_RESULT_UNKNOWN'||code==='STALE_RESULT'?'unknown':'error',error:code==='STALE_RESULT'?'ORDER_RESULT_UNKNOWN':code};}
export function safePaymentUrl(value:string|null):string|null {try{const url=new URL(value??'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}

import type { AvailabilityResult } from './availability-contracts.ts';
import type { ArenaState } from '../shared/contracts.ts';
import { lockMatchesArena, type CoinLock } from '../arena/coin-timing.ts';
export function createAvailabilityTracker(scope:ReturnType<typeof createConnectionScope>){
 let generation=0,value:AvailabilityResult|null=null;
 return {
  begin(contextKey:string){return {generation:++generation,scope:scope.stamp(),contextKey};},
  accept(ticket:{generation:number;scope:ReturnType<typeof scope.stamp>;contextKey:string},result:AvailabilityResult){if(ticket.generation!==generation||!scope.isCurrent(ticket.scope)||!scope.hasContext(ticket.contextKey)||ticket.contextKey!==result.contextKey)return false;value=result;return true;},
  current(ticket:{generation:number;scope:ReturnType<typeof scope.stamp>;contextKey:string}){return ticket.generation===generation&&scope.isCurrent(ticket.scope)&&scope.hasContext(ticket.contextKey);},
  invalidate(){generation++;value=null;},get:()=>value,
 };
}
/** Both manual/keyboard and sealed coin commits use the same latest identity and availability guard. */
export function resolveAvailableChoice(arena:ArenaState,lock:CoinLock,selectable:(id:string)=>boolean,commit:()=>void,release:()=>void):boolean {
 const id=arena.pair?.[lock.finalSide==='left'?0:1];
 if(!lockMatchesArena(lock,arena)||!id||!selectable(id)){release();return false;}commit();return true;
}

/** Busy belongs to one request, not the page that happened to start it. */
export function createRequestActivity(publish:(busy:boolean)=>void){
 let sequence=0,owner:number|null=null;
 return {
  begin(){owner=++sequence;publish(true);return owner;},
  finish(ticket:number){if(owner!==ticket)return false;owner=null;publish(false);return true;},
  cancel(){if(owner===null)return;owner=null;publish(false);},
 };
}

import { createQuoteTracker, type QuoteState } from '../cart/model.ts';
import type { QuoteRequest, QuoteResult } from '../shared/contracts.ts';
/** Publish to checkout only from the base tracker's accepted generation. */
export function createAcceptedQuoteTracker(request:QuoteRequest,publish:(state:QuoteState)=>void,onAccepted:(quote:CommerceQuote,request:QuoteRequest,eligibilityGeneration:number)=>void){
 let eligibilityGeneration=0;
 const tracker=createQuoteTracker(request,state=>{
  publish(state);
  if(state.status==='success'&&state.quote?.evidence==='official')onAccepted(state.quote as CommerceQuote,state.request,eligibilityGeneration);
 });
 return {
  getState:tracker.getState,replace:tracker.replace,cancel:tracker.cancel,
  run(provider:(request:QuoteRequest)=>Promise<QuoteResult>,generation:number){eligibilityGeneration=generation;return tracker.run(provider);},
 };
}
