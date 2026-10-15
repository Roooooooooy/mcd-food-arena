import type { CommerceLine } from './contracts.ts';
export type AvailabilityState = 'listed' | 'not-returned' | 'unknown';
export interface AvailabilityItem {
 candidateId:string; state:AvailabilityState; label:string; checkedAt:string|null;
 variants?:{variantId:string;state:AvailabilityState;label:string}[];
}
export interface AvailabilityResult {contextKey:string;checkedAt:string;items:AvailabilityItem[]}
export interface CandidateAvailabilityRequest {contextKey:string;candidateIds:string[]}
export interface BasketAvailabilityRequest {contextKey:string;basket:CommerceLine[];cartRevision:number}
export function availabilityLabel(state:AvailabilityState,coupon=false):string {
 if(state==='listed')return coupon?'当前门店优惠券仍适用':'当前菜单有此餐品';
 if(state==='not-returned')return coupon?'优惠券当前不可用，请更换':'当前菜单未返回，请更换';
 return '尚未确认当前状态';
}
export function isSelectable(item:AvailabilityItem|undefined):boolean{return item?.state!=='not-returned';}
export function isVariantSelectable(item:AvailabilityItem|undefined,id:string):boolean{return item?.variants?.find(v=>v.variantId===id)?.state!=='not-returned';}
