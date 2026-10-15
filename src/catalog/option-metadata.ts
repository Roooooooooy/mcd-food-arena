import type { ComboRound, ModificationGroup, ModificationValue } from '../shared/contracts.ts';

const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const number=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)?v:null;
export function signedYuanDelta(value:unknown):number|null {
 const match=/^([+-])\s*¥\s*(\d+)(?:\.(\d{1,2}))?$/.exec(text(value));
 if(!match)return null;
 const amount=Number(match[2])*100+Number((match[3]??'').padEnd(2,'0'));
 return Number.isSafeInteger(amount)?amount*(match[1]==='-'?-1:1):null;
}
export const optionScope=(menu:string,round?:number,child?:string)=>`o:${encodeURIComponent(menu)}:${round===undefined?'top':`r${round}:c${encodeURIComponent(child??'')}`}`;
export function exactOneRound(raw:unknown):raw is Record<string,unknown>&{id:number;choices:Record<string,unknown>[]} {
 if(!record(raw)||raw.quantity!==1||raw.minQuantity!==1||raw.maxQuantity!==1||!Number.isSafeInteger(raw.id)||(raw.id as number)<=0||!Array.isArray(raw.choices)||!raw.choices.length)return false;
 if(!raw.choices.every(c=>record(c)&&text(c.code)&&text(c.name)&&number(c.quantity)!==null&&(c.quantity as number)>=0&&(c.quantity as number)<=1&&(c.maxQuantity===-1||number(c.maxQuantity)!==null&&(c.maxQuantity as number)>=1)))return false;
 return raw.choices.reduce((n,c)=>n+(c.quantity as number),0)===1&&new Set(raw.choices.map(c=>c.code)).size===raw.choices.length;
}
/** Whitelist only the two observed editable shapes. Empty upstream groups mean no controls. */
export function normalizeModification(raw:unknown,scope:string,supportModify?:unknown):ModificationGroup[] {
 if(raw===undefined)return supportModify===true?[{id:`${scope}:g0`,kind:'unavailable',minValues:null,maxValues:null,values:[]}]:[];
 if(!record(raw)||!Array.isArray(raw.items))return [{id:`${scope}:g0`,kind:'unavailable',minValues:null,maxValues:null,values:[]}];
 return raw.items.flatMap((group,index)=>{
  const id=`${scope}:g${index}`;
  if(record(group)&&Array.isArray(group.values)&&group.values.length===0)return [];
  if(!record(group)||!Array.isArray(group.values))return [{id,kind:'unavailable' as const,minValues:null,maxValues:null,values:[]}];
  const values:ModificationValue[]=group.values.map((v,i)=>{
   const r=record(v)?v:{};const code=text(r.code);
   return {id:`${id}:v${i}`,code,name:text(r.name),minQuantity:number(r.minQuantity),maxQuantity:number(r.maxQuantity),defaultQuantity:number(r.selectedQuantity),selectedKey:text(r.selectedKey),...(text(r.unselectedKey)?{unselectedKey:text(r.unselectedKey)}:{}),referenceDeltaCents:r.price===0?0:code==='120146'&&r.price===200?200:null};
  });
  const minValues=number(group.minValues),maxValues=number(group.maxValues);
  const valid=values.every(v=>v.code&&v.name&&v.selectedKey&&v.minQuantity===0&&v.maxQuantity===1&&(v.defaultQuantity===0||v.defaultQuantity===1));
  const kind=valid&&minValues===1&&maxValues===1&&values.every(v=>!v.unselectedKey)?'single':valid&&minValues===0&&maxValues===values.length&&values.every(v=>v.unselectedKey)?'toggles':'unavailable';
  return [{id,kind,minValues,maxValues,values}];
 });
}
export function normalizeRounds(raw:unknown,menu:string):ComboRound[] {
 if(!Array.isArray(raw))return [{id:`${optionScope(menu)}:invalid`,roundId:null,name:'选配信息待确认',minQuantity:null,maxQuantity:null,defaultQuantity:null,choices:[]}];
 return raw.map((r,index)=>{
  const round=record(r)?r:{};const roundId=number(round.id);const id=`${optionScope(menu)}:r${roundId??`invalid${index}`}`;
  const choices=Array.isArray(round.choices)?round.choices:[];
  return {id,roundId,name:text(round.name)||'餐品选配',minQuantity:number(round.minQuantity),maxQuantity:number(round.maxQuantity),defaultQuantity:number(round.quantity),choices:choices.map((v,i)=>{
   const c=record(v)?v:{};const code=text(c.code);
   return {id:`${id}:c${encodeURIComponent(code)}:i${i}`,officialCode:code,name:text(c.name),maxQuantity:number(c.maxQuantity),defaultQuantity:number(c.quantity),referenceDeltaCents:signedYuanDelta(c.diffPrice),modificationGroups:normalizeModification(c.modification,optionScope(menu,roundId??undefined,code),c.supportModify)};
  })};
 });
}
