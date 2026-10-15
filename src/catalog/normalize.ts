import { normalizeModification, normalizeRounds, optionScope, signedYuanDelta, exactOneRound } from './option-metadata.ts';
import type { CatalogSnapshot, StoreOption, Candidate, Variant } from '../shared/contracts.ts';

export const stageLabels: Record<string,string> = {burger:'主食',side:'小食',drink:'饮料',coffee:'咖啡',dessert:'甜品',combo:'套餐',breakfast:'早餐',other:'其他'};
export function stageName(item: Candidate): string { return item.stageLabel ?? item.sourceCategory; }
export function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function text(value:unknown):string{return typeof value==='string'?value.trim():'';}
function nameKey(name:string):string{return name.normalize('NFKC').replace(/\s/g,'').replace(/\(([大中小]杯)\)/g,'$1');}
function image(value:unknown):string|null {
 try {const url=new URL(text(value));return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
export function yuanToCents(value:unknown):number|null {
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const raw=String(value).trim();if(!/^\d+(?:\.\d{1,2})?$/.test(raw))return null;
 const [whole,fraction='']=raw.split('.');const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(cents)?cents:null;
}
function csvRow(line:string):string[]|null {
 const values:string[]=[];let value='';let quoted=false;let closed=false;
 for(let i=0;i<line.length;i++){
  const char=line[i];
  if(quoted){if(char==='"'){if(line[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=char;}
  else if(char===','){values.push(value.trim());value='';closed=false;}
  else if(char==='"'){if(value.trim()||closed)return null;quoted=true;value='';}
  else {if(closed&&char.trim())return null;value+=char;}
 }
 if(quoted)return null;values.push(value.trim());return values;
}
export function parseNutrition(raw:unknown):Map<string,Candidate['nutrition']>{
 const result=new Map<string,Candidate['nutrition']>();if(typeof raw!=='string')return result;
 const lines=raw.trim().split(/\r?\n/);const header=/^\[(\d+)\]\{([^}]+)\}:$/.exec(lines.shift()??'');
 if(!header||Number(header[1])!==lines.length)return result;
 const columns=header[2].split(',').map(s=>s.trim());if(!columns.includes('productName'))return result;
 const names:Record<string,keyof Candidate['nutrition']>={energyKcal:'kcal',protein:'proteinG',fat:'fatG',carbohydrate:'carbsG',sodium:'sodiumMg'};
 const conflicts=new Set<string>();
 for(const line of lines){
  const values=csvRow(line.trim());if(!values||values.length!==columns.length)return new Map();
  const product=values[columns.indexOf('productName')];if(!product||product==='null')continue;
  const nutrition:Candidate['nutrition']={};
  for(const [column,key]of Object.entries(names)){
   const v=values[columns.indexOf(column)];if(v!==undefined&&/^\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v)))nutrition[key]=Number(v);
  }
  const id=nameKey(product);if(result.has(id)&&JSON.stringify(result.get(id))!==JSON.stringify(nutrition))conflicts.add(id);else result.set(id,nutrition);
 }
 for(const key of conflicts)result.delete(key);return result;
}
export function classifyMeal(name:string,categories:string[],tags:string[]):string {
 const category=categories.join(' ');const evidence=tags.join(' ');
 if(/套餐|[二三四五六七八九十\d]+件套|单人餐|双人餐|多人餐|分享餐|亲子.*餐|乐园餐|随心配|随心拼/.test(name)||tags.includes('套餐'))return 'combo';
 if(/早餐|早安|麦满分|热松饼|粥/.test(name)||/早餐/.test(category))return 'breakfast';
 if(/麦旋风|新地|圣代|冰淇淋|圆筒|阿芙佳朵/.test(name)||/冰淇淋/.test(evidence))return 'dessert';
 if(name==='派'||/派$/.test(name)||tags.includes('派'))return 'dessert';
 if(/汉堡|牛堡|鸡腿堡|鳕鱼堡|鸡肉堡|牛肉堡|麦香鸡|麦香鱼|巨无霸|卷$/.test(name))return 'burger';
 if(/薯|鸡翅|鸡排|麦乐鸡|V翅|脆汁鸡|鸡球|玉米杯|苹果片|芝士条|小食盘/.test(name)||tags.includes('小食'))return 'side';
 if(/咖啡|美式|奶铁|拿铁|卡布奇诺|玛奇朵/.test(name))return 'coffee';
 if(/麦咖啡/.test(category)||/饮品/.test(category))return 'drink';
 if(/星愿贴|贴纸|按摩[捶锤]|痒痒挠|玩具|徽章|钥匙扣/.test(name)||tags.some(tag=>/周边|玩具/.test(tag)))return 'other';
 return 'other';
}
export function explicitSize(name:string):{base:string;size:string}|null {
 const match=/[（(]?([大中小]杯)[）)]?/.exec(name);if(!match)return null;
 const base=name.replace(match[0],'').trim();return base?{base,size:match[1]}:null;
}
function variantId(menuCode:string,code:string):string{return menuCode===code?`live:sku:${code}`:`live:sku:${menuCode}:${code}`;}
interface Context {contextKey:string;store:StoreOption;loadedAt:string;complete:boolean}
export function normalizeCatalog(raw:unknown,context:Context):CatalogSnapshot{
 const snapshot:CatalogSnapshot={...context,mode:'live',items:[],rawSkuCount:0,complete:context.complete};
 if(!isRecord(raw)||!Array.isArray(raw.categories)||!isRecord(raw.meals)){snapshot.complete=false;return snapshot;}
 const categories=new Map<string,string[]>();const tags=new Map<string,string[]>();const refs=new Set<string>();
 for(const category of raw.categories){
  if(!isRecord(category)||!text(category.name)||!Array.isArray(category.meals)){snapshot.complete=false;continue;}
  for(const entry of category.meals){
   if(!isRecord(entry)||!text(entry.code)){snapshot.complete=false;continue;}
   const code=text(entry.code);refs.add(code);
   categories.set(code,[...new Set([...(categories.get(code)??[]),String(category.name)])]);
   const labels=Array.isArray(entry.tags)?entry.tags.filter((v):v is string=>typeof v==='string'):[];
   tags.set(code,[...new Set([...(tags.get(code)??[]),...labels])]);
  }
 }
 const nutrition=parseNutrition(raw.nutrition);const details=isRecord(raw.details)?raw.details:{};
 const codes=[...refs,...Object.keys(raw.meals).filter(code=>!refs.has(code))];
 snapshot.rawSkuCount=Object.keys(raw.meals).length;
 if(!codes.length||refs.size!==Object.keys(raw.meals).length||[...refs].some(code=>!raw.meals || !Object.hasOwn(raw.meals,code)))snapshot.complete=false;
 const candidates:Candidate[]=[];
 for(const code of codes){
  const meal=raw.meals[code];if(!isRecord(meal)||!text(meal.name)){snapshot.complete=false;continue;}
  const sourceCategories=categories.get(code)??['其他'];const attributes=tags.get(code)??[];
  const stageId=classifyMeal(String(meal.name),sourceCategories,attributes);
  const detail=details[code];const actualName=isRecord(detail)&&text(detail.name)&&['drink','coffee'].includes(stageId)?text(detail.name):text(meal.name);
  const base:Candidate={id:`live:sku:${code}`,officialCode:code,name:actualName,stageId,stageLabel:stageLabels[stageId],sourceCategory:sourceCategories[0],sourceCategories,imageUrl:image(meal.image),referencePriceCents:yuanToCents(meal.currentPrice),attributes:[...attributes,...(meal.canWithOrder===true?['随单购条件价，核价为准']:[])],nutrition:nutrition.get(nameKey(actualName))??{},mode:'live'};
  if(isRecord(detail)){base.modificationGroups=normalizeModification(detail.modification,optionScope(code),detail.supportModify);base.comboRounds=normalizeRounds(detail.rounds,code);base.optionsStatus='ready';}
  const makeVariant=(c:Record<string,unknown>,roundId:number,sizeLabel:string):Variant=>{const diff=signedYuanDelta(c.diffPrice);const child=details[text(c.code)];return {id:variantId(code,text(c.code)),officialCode:text(c.code),name:text(c.name),sizeLabel,referencePriceCents:base.referencePriceCents!==null&&diff!==null&&base.referencePriceCents+diff>=0?base.referencePriceCents+diff:null,nutrition:nutrition.get(nameKey(text(c.name)))??{},imageUrl:isRecord(child)?image(child.image)??base.imageUrl:base.imageUrl,menuCode:code,roundId,modificationGroups:normalizeModification(c.modification,optionScope(code,roundId,text(c.code)),c.supportModify),optionsStatus:'ready'};};
  if(!['drink','coffee','combo'].includes(stageId)&&isRecord(detail)&&Array.isArray(detail.rounds)&&detail.rounds.length===1){
   const round=detail.rounds[0];
   if(exactOneRound(round)&&round.choices.length>1){
    for(const c of round.choices){const variant=makeVariant(c as Record<string,unknown>,round.id as number,'固定口味');candidates.push({...base,id:variant.id,officialCode:null,name:variant.name,referencePriceCents:variant.referencePriceCents,nutrition:variant.nutrition,imageUrl:variant.imageUrl,variants:[variant],defaultVariantId:variant.id,comboRounds:[]});}
    continue;
   }
  }
  if(['drink','coffee'].includes(stageId)&&isRecord(detail)&&Array.isArray(detail.rounds)&&detail.rounds.length===1){
   const round=detail.rounds[0];
   if(exactOneRound(round)&&round.choices.every(c=>explicitSize(text(c.name)))){
    const families=new Map<string,Variant[]>();
    for(const choice of round.choices){
     const c=choice as Record<string,unknown>;const named=explicitSize(text(c.name))!;const key=nameKey(named.base);
     const v=makeVariant(c,round.id as number,named.size);
     families.set(key,[...(families.get(key)??[]),v]);
    }
    let index=0;for(const variants of families.values()){const named=explicitSize(variants[0].name)!;candidates.push({...base,id:index++===0?base.id:`live:family:${code}:${encodeURIComponent(named.base)}`,officialCode:null,name:named.base,referencePriceCents:null,nutrition:{},variants,defaultVariantId:variants[0].id,comboRounds:[]});}
    continue;
   }
  }
  const size=explicitSize(actualName);
  if(['drink','coffee'].includes(stageId)&&size){base.variants=[{id:base.id,officialCode:code,name:actualName,sizeLabel:size.size,referencePriceCents:base.referencePriceCents,nutrition:base.nutrition,imageUrl:base.imageUrl,menuCode:code,modificationGroups:base.modificationGroups,optionsStatus:base.optionsStatus}];base.defaultVariantId=base.id;base.name=size.base;base.modificationGroups=[];}
  candidates.push(base);
 }
 // Only explicitly sized beverage identities enter a family; unrelated tastes and temperatures retain their names.
 const families=new Map<string,Candidate>();
 for(const candidate of candidates){
  if(!candidate.variants||candidate.variants.some(v=>v.roundId!==undefined)){snapshot.items.push(candidate);continue;}
  const key=`${candidate.stageId}:${nameKey(candidate.name)}`;const previous=families.get(key);
  if(!previous){families.set(key,candidate);snapshot.items.push(candidate);continue;}
  previous.variants!.push(...candidate.variants);previous.officialCode=null;previous.referencePriceCents=null;previous.nutrition={};
  previous.sourceCategories=[...new Set([...(previous.sourceCategories??[]),...(candidate.sourceCategories??[])])];
 }
 return snapshot;
}
