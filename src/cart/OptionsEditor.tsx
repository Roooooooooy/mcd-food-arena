import { isVariantSelectable, type AvailabilityItem } from '../commerce/availability-contracts.ts';
import type {Candidate} from '../shared/contracts.ts';
import {inspectOptions,resolveOptions,setModification,setRoundChoice} from './options.ts';
function difference(amount:number|null){return amount===null?'费用未知，核价为准':amount===0?'':`${amount<0?'−':'+'}¥${(Math.abs(amount)/100).toFixed(2)}`;}
export function OptionsEditor({item,optionIds,onChange,availability}:{availability?:AvailabilityItem;item:Candidate;optionIds:string[];onChange:(ids:string[])=>void}){
 let state:ReturnType<typeof inspectOptions>;
 try {state=inspectOptions(item,optionIds);}catch{return <p className="notice">选项已变化，请重新选择这份商品。</p>;}
 let valid=true;try{resolveOptions(item,optionIds);}catch{valid=false;}
 if(!state.groups.length&&!state.rounds.length)return null;
 const edited=optionIds.some(id=>!id.startsWith('variant:'));
 return <details className="cart-options"><summary>定制餐品 <span>{edited?'已修改选项':'沿用官方默认'}</span></summary><div className="cart-options-content">
  <p className="cart-options-note">按需调整。同一套餐内相同子项的多份数量共用定制。</p>
  {state.rounds.map(({round,quantities})=>{
   const total=quantities.reduce<number>((n,q)=>n+(q??0),0),single=round.maxQuantity===1;
   const required=round.minQuantity===round.maxQuantity?`需选 ${round.minQuantity??'未知'} 份`:`需选 ${round.minQuantity??'未知'}–${round.maxQuantity===-1?'不限':round.maxQuantity??'未知'} 份`;
   return <fieldset className="cart-option-group" key={round.id}><legend>{round.name}</legend><p className="cart-options-note">已选 {total} 份 · {required}</p>
    {round.choices.map((choice,i)=><label className="cart-option-choice" key={choice.id}>
     {single?<input type="radio" name={`${item.id}-${round.id}`} disabled={!isVariantSelectable(availability,choice.id)} checked={quantities[i]===1} onChange={()=>{if(isVariantSelectable(availability,choice.id))onChange(setRoundChoice(item,optionIds,choice.id,1));}}/>:<input type="number" disabled={!isVariantSelectable(availability,choice.id)} aria-label={`${round.name} ${choice.name}数量`} min="0" max={Math.min(choice.maxQuantity===-1?99:choice.maxQuantity??0,round.maxQuantity===-1?99:round.maxQuantity??0)} step="1" value={quantities[i]??''} onChange={e=>{const q=Number(e.target.value);if(isVariantSelectable(availability,choice.id)&&Number.isSafeInteger(q)&&q>=0&&q<=99)onChange(setRoundChoice(item,optionIds,choice.id,q));}}/>}
     <span>{choice.name}{!isVariantSelectable(availability,choice.id)&&<small> · 当前选项未返回</small>}</span><small>{difference(choice.referenceDeltaCents)}</small>
    </label>)}
   </fieldset>;
  })}
  {state.groups.map(({group,quantities,label})=><fieldset className="cart-option-group" key={group.id}><legend>{label} · {group.kind==='single'?'冰量':'配料与替换'}</legend>
   {group.kind==='unavailable'?<p className="notice">可用选项尚未确认，暂时不能核价。</p>:<>
    <p className="cart-options-note">{group.kind==='single'?'必选 1 项':`可选 0–${group.maxValues} 项`}</p>
    {group.values.map((value,i)=><label className="cart-option-choice" key={value.id}><input type={group.kind==='single'?'radio':'checkbox'} disabled={!isVariantSelectable(availability,value.id)} name={`${item.id}-${group.id}`} checked={quantities[i]===1} onChange={e=>{if(isVariantSelectable(availability,value.id))onChange(setModification(item,optionIds,value.id,e.target.checked?1:0));}}/><span>{value.name}</span><small>{difference(value.referenceDeltaCents)}</small></label>)}
   </>}
  </fieldset>)}
  {!valid&&<p className="notice" role="status">请满足数量和必选规则后再核价；未知选项需要重新读取菜单。</p>}
  <p className="cart-options-note">营养为默认配方参考，未计算定制后的营养。</p>
 </div></details>;
}
