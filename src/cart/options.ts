import type { Candidate, ComboRound, ModificationGroup, Variant } from '../shared/contracts.ts';

export interface WireModification { values: {code:string;key:string;quantity:number}[] }
export interface WireRound { round:string; comboItemList:{code:string;quantity:number;modification?:WireModification}[] }
interface GroupState { group:ModificationGroup; quantities:(number|null)[]; label:string; childId?:string }
interface RoundState { round:ComboRound; quantities:(number|null)[] }
function fail(code='SELECTION_REQUIRED'):never {throw new Error(code);}
const integer=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const limit=(n:unknown):n is number=>integer(n)||n===-1;
const modId=(id:string,q:number)=>`mod:${id}:${q}`;
const roundId=(id:string,q:number)=>`round:${id}:${q}`;
function selectedVariant(item:Candidate,ids:string[]):Variant|undefined {
 const variants=ids.filter(id=>id.startsWith('variant:'));
 if(variants.length>1)fail('OPTION_NOT_IN_CONTEXT');
 const id=variants[0]?.slice(8)??item.defaultVariantId;
 if(id){const v=item.variants?.find(v=>v.id===id);if(!v)fail('OPTION_NOT_IN_CONTEXT');return v;}
 if(item.variants?.length)fail();
}
/** Decode only finite state on server-issued identities; raw codes/keys are never accepted. */
export function inspectOptions(item:Candidate,ids:string[]) {
 if(!Array.isArray(ids)||ids.length>600||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)fail('OPTION_NOT_IN_CONTEXT');
 const variant=selectedVariant(item,ids);
 const rounds:RoundState[]=(item.comboRounds??[]).map(round=>({round,quantities:round.choices.map(c=>c.defaultQuantity)}));
 const quantities=new Map<string,number>();
 const allChoices=new Map(rounds.flatMap(r=>r.round.choices.map((c,i)=>[c.id,{state:r,index:i}] as const)));
 for(const id of ids){
  if(id.startsWith('variant:'))continue;
  const match=/^(mod|round):(.+):(0|[1-9]\d*)$/.exec(id);if(!match)fail('OPTION_NOT_IN_CONTEXT');
  const q=Number(match[3]);if(!integer(q)||q>99)fail('OPTION_NOT_IN_CONTEXT');
  if(quantities.has(`${match[1]}:${match[2]}`))fail('OPTION_NOT_IN_CONTEXT');
  quantities.set(`${match[1]}:${match[2]}`,q);
  if(match[1]==='round'){const choice=allChoices.get(match[2]);if(!choice)fail('OPTION_NOT_IN_CONTEXT');choice.state.quantities[choice.index]=q;}
 }
 const groups:GroupState[]=[...(item.modificationGroups??[]).map(group=>({group,quantities:group.values.map(v=>v.defaultQuantity),label:item.name})),...(variant?.modificationGroups??[]).map(group=>({group,quantities:group.values.map(v=>v.defaultQuantity),label:variant!.name}))];
 for(const r of rounds)for(let i=0;i<r.round.choices.length;i++)if((r.quantities[i]??0)>0){const c=r.round.choices[i];groups.push(...c.modificationGroups.map(group=>({group,quantities:group.values.map(v=>v.defaultQuantity),label:c.name,childId:c.id})));}
 const activeValues=new Map(groups.flatMap(state=>state.group.values.map((v,i)=>[v.id,{state,index:i}] as const)));
 for(const [id,q] of quantities)if(id.startsWith('mod:')){const v=activeValues.get(id.slice(4));if(!v)fail('OPTION_NOT_IN_CONTEXT');v.state.quantities[v.index]=q;}
 return {variant,groups,rounds,quantities};
}
function validateGroup(state:GroupState){
 const {group,quantities}=state;
 if(group.kind==='unavailable'||!integer(group.minValues)||!integer(group.maxValues)||group.minValues>group.maxValues||!group.values.length)fail();
 const count=(qs:(number|null)[])=>qs.reduce<number>((n,q)=>n+(integer(q)&&q>0?1:0),0);
 for(let i=0;i<group.values.length;i++){
  const v=group.values[i];const q=quantities[i];
  if(!v.code||!v.name||!v.selectedKey||!integer(v.minQuantity)||!integer(v.maxQuantity)||v.minQuantity>v.maxQuantity||!integer(v.defaultQuantity)||v.defaultQuantity<v.minQuantity||v.defaultQuantity>v.maxQuantity||!integer(q)||q<v.minQuantity||q>v.maxQuantity)fail();
  if(group.kind==='toggles'&&!v.unselectedKey)fail();
 }
 for(const qs of [quantities,group.values.map(v=>v.defaultQuantity)])if(count(qs)<group.minValues||count(qs)>group.maxValues)fail();
}
function validateRound(state:RoundState){
 const r=state.round;
 if(!integer(r.roundId)||r.roundId===0||!integer(r.minQuantity)||!limit(r.maxQuantity)||r.maxQuantity!==-1&&r.maxQuantity<r.minQuantity||!integer(r.defaultQuantity)||!r.choices.length||new Set(r.choices.map(c=>c.officialCode)).size!==r.choices.length)fail();
 let defaults=0,total=0;
 for(let i=0;i<r.choices.length;i++){
  const c=r.choices[i],q=state.quantities[i];
  if(!c.officialCode||!c.name||!limit(c.maxQuantity)||!integer(c.defaultQuantity)||!integer(q)||c.maxQuantity!==-1&&(q>c.maxQuantity||c.defaultQuantity>c.maxQuantity))fail();
  defaults+=c.defaultQuantity;total+=q;
 }
 if(defaults!==r.defaultQuantity||defaults<r.minQuantity||r.maxQuantity!==-1&&defaults>r.maxQuantity||total<r.minQuantity||r.maxQuantity!==-1&&total>r.maxQuantity)fail();
}
function noLabel(name:string){return name.startsWith('换')?`不${name}`:`不加${name}`;}
export function resolveOptions(item:Candidate,ids:string[]) {
 const state=inspectOptions(item,ids);
 if(item.optionsStatus==='unavailable'||state.variant?.optionsStatus==='unavailable')fail();
 if(new Set(state.rounds.map(r=>r.round.roundId)).size!==state.rounds.length)fail();
 for(const r of state.rounds)validateRound(r);
 for(const g of state.groups)validateGroup(g);
 let referencePriceCents=state.variant?.referencePriceCents??(item.variants?null:item.referencePriceCents);
 const addDelta=(delta:number|null,q:number)=>{if(q!==0){if(delta===null||referencePriceCents===null)referencePriceCents=null;else referencePriceCents+=delta*q;}};
 const childQuantities=new Map(state.rounds.flatMap(r=>r.round.choices.map((c,i)=>[c.id,r.quantities[i]!] as const)));
 const wires=new Map<string,WireModification>();const summary:string[]=[];
 for(const g of state.groups){
  const copies=g.childId?childQuantities.get(g.childId)??fail():1;
  const edited=g.group.values.some(v=>state.quantities.has(`mod:${v.id}`));
  const values:WireModification['values']=[];
  for(let i=0;i<g.group.values.length;i++){
   const v=g.group.values[i],q=g.quantities[i]!;
   addDelta(v.referenceDeltaCents,(q-v.defaultQuantity!)*copies);
   if(g.group.kind==='toggles'||q>0)summary.push(`${g.childId||state.variant?g.label+'：':''}${q>0?v.name:noLabel(v.name)}`);
   if(edited&&(g.group.kind==='toggles'||q>0))values.push({code:v.code,key:q>0?v.selectedKey:v.unselectedKey!,quantity:q});
  }
  if(edited){const owner=g.childId??(state.variant?.modificationGroups?.includes(g.group)?'variant':'top');const previous=wires.get(owner);wires.set(owner,{values:[...(previous?.values??[]),...values]});}
 }
 const components:{name:string;quantity:number}[]=[];const roundList:WireRound[]=[];
 for(const r of state.rounds){
  const comboItemList:WireRound['comboItemList']=[];
  for(let i=0;i<r.round.choices.length;i++){
   const c=r.round.choices[i],q=r.quantities[i]!;addDelta(c.referenceDeltaCents,q-c.defaultQuantity!);
   if(q>0){const modification=wires.get(c.id);comboItemList.push({code:c.officialCode,quantity:q,...(modification?{modification}:{})});components.push({name:c.name,quantity:q});}
  }
  if(comboItemList.length)roundList.push({round:String(r.round.roundId),comboItemList});
 }
 if(state.variant){
  components.push({name:state.variant.name,quantity:1});
  if(state.variant.roundId!==undefined){const modification=wires.get('variant');roundList.push({round:String(state.variant.roundId),comboItemList:[{code:state.variant.officialCode,quantity:1,...(modification?{modification}:{})}]});}
 }
 const top=wires.get('top'),directVariant=state.variant?.roundId===undefined?wires.get('variant'):undefined;
 const modification=top||directVariant?{values:[...(top?.values??[]),...(directVariant?.values??[])]}:undefined;
 if(referencePriceCents!==null&&(!Number.isSafeInteger(referencePriceCents)||referencePriceCents<0))referencePriceCents=null;
 return {variant:state.variant,roundList,modification,components,summary,referencePriceCents};
}
export function setModification(item:Candidate,ids:string[],valueId:string,quantity:number):string[]{
 const state=inspectOptions(item,ids);const g=state.groups.find(g=>g.group.values.some(v=>v.id===valueId));if(!g||g.group.kind==='unavailable'||quantity!==0&&quantity!==1)fail('OPTION_NOT_IN_CONTEXT');
 const remaining=ids.filter(id=>!g.group.values.some(v=>id.startsWith(`mod:${v.id}:`)));
 return [...remaining,...g.group.values.map((v,i)=>modId(v.id,g.group.kind==='single'?(v.id===valueId?quantity:0):(v.id===valueId?quantity:g.quantities[i]??fail())))];
}
export function setVariant(item:Candidate,ids:string[],id:string):string[]{
 inspectOptions(item,ids);if(!item.variants?.some(v=>v.id===id))fail('OPTION_NOT_IN_CONTEXT');
 const topValues=new Set((item.modificationGroups??[]).flatMap(g=>g.values.map(v=>v.id)));
 return [`variant:${id}`,...ids.filter(value=>{const match=/^mod:(.+):\d+$/.exec(value);return !!match&&topValues.has(match[1]);})];
}
export function setRoundChoice(item:Candidate,ids:string[],choiceId:string,quantity:number):string[]{
 const state=inspectOptions(item,ids),r=state.rounds.find(r=>r.round.choices.some(c=>c.id===choiceId));if(!r||!integer(quantity)||quantity>99)fail('OPTION_NOT_IN_CONTEXT');
 const next=r.quantities.map((q,i)=>r.round.choices[i].id===choiceId?quantity:r.round.maxQuantity===1&&quantity===1?0:q);
 const reset=new Set(r.round.choices.filter((c,i)=>(r.quantities[i]===0)!==(next[i]===0)).flatMap(c=>c.modificationGroups.flatMap(g=>g.values.map(v=>v.id))));
 const remaining=ids.filter(id=>!r.round.choices.some(c=>id.startsWith(`round:${c.id}:`))&&![...reset].some(v=>id.startsWith(`mod:${v}:`)));
 return [...remaining,...r.round.choices.map((c,i)=>roundId(c.id,next[i]??fail()))];
}
