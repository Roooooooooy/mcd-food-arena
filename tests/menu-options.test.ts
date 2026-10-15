import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog } from '../src/catalog/normalize.ts';

const raw=JSON.parse(readFileSync(new URL('./fixtures/menu-options.json',import.meta.url),'utf8'));
const context={contextKey:'options',store:{id:'3330251',name:'测试门店',city:'杭州',address:'测试地址'},loadedAt:'2026-10-15T00:00:00Z',complete:true};
export const menuOptionsSnapshot=()=>normalizeCatalog(raw,context);
test('six real exact-one food families become thirteen fixed flavors, retain merchandise and beverage sizes',()=>{
 const snapshot=menuOptionsSnapshot();
 const parents=['9900008752','9900008745','9900008754','9900008746','9900008747','9900003586'];
 const flavors=snapshot.items.filter(c=>c.variants?.some(v=>parents.includes(v.menuCode!)));
 assert.equal(flavors.length,13);
 for(const [parent,children] of Object.entries({'9900008752':['4105','4106'],'9900008745':['4410','4416'],'9900008754':['1217','4900'],'9900008746':['515295','521147'],'9900008747':['1000','1010','520551'],'9900003586':['520312','8317']}))assert.deepEqual(flavors.filter(c=>c.variants![0].menuCode===parent).map(c=>c.variants![0].officialCode).sort(),children.sort());
 const pie=flavors.find(c=>c.name==='香芋派')!;
 assert.equal(pie.stageId,'dessert');assert.equal(pie.referencePriceCents,800);
 assert.equal(pie.variants!.length,1);assert.equal(pie.variants![0].officialCode,'4106');assert.equal(pie.variants![0].menuCode,'9900008752');assert.equal(pie.variants![0].roundId,1);
 assert.equal(snapshot.items.find(c=>c.officialCode==='521946')!.stageId,'other');
 assert.equal(snapshot.items.find(c=>c.name==='可乐')!.variants!.length,3);
 assert.equal(snapshot.items.filter(c=>c.name==='BFF四宫格小食盘').length,1);
});
test('default vs explicitly removed ingredients serialize different states and safe official keys',async()=>{
 const options=await import('../src/cart/options.ts');const item=menuOptionsSnapshot().items.find(c=>c.officialCode==='1100')!;
 const pickle=item.modificationGroups![0].values.find(v=>v.name==='酸黄瓜')!;
 assert.equal(options.resolveOptions(item,[]).modification,undefined);
 const ids=options.setModification(item,[],pickle.id,0);
 assert.ok(ids.length>0);
 const resolved=options.resolveOptions(item,ids);
 assert.deepEqual(resolved.modification!.values.find(v=>v.code==='100202'),{code:'100202',key:'0-0',quantity:0});
 assert.match(resolved.summary.join('、'),/不加酸黄瓜/);
 assert.throws(()=>options.resolveOptions(item,[...ids,...ids]),/OPTION/);
 assert.throws(()=>options.resolveOptions(item,[...ids,`mod:${pickle.id}:1`]),/OPTION/);
 assert.throws(()=>options.resolveOptions(item,['mod:forged:0']),/OPTION/);
});
test('ice radios with repeated codes send exactly one selected key and variant changes discard old child edits',async()=>{
 const options=await import('../src/cart/options.ts');const item=menuOptionsSnapshot().items.find(c=>c.name==='可乐')!;
 const medium=item.variants![1];const noIce=medium.modificationGroups![0].values[1];
 const ids=options.setModification(item,['variant:'+medium.id],noIce.id,1);
 const resolved=options.resolveOptions(item,ids);
 assert.deepEqual(resolved.roundList,[{round:'1',comboItemList:[{code:'3050',quantity:1,modification:{values:[{code:'200002',key:'0-0',quantity:1}]}}]}]);
 const switched=options.setVariant(item,ids,item.variants![2].id);
 assert.deepEqual(switched,['variant:'+item.variants![2].id]);
 assert.equal(options.resolveOptions(item,switched).roundList[0].comboItemList[0].modification,undefined);
 assert.throws(()=>options.resolveOptions(item,[...ids,'mod:'+item.variants![0].modificationGroups![0].values[1].id+':1']),/OPTION/);
 assert.throws(()=>options.resolveOptions(item,['variant:'+medium.id,`mod:${noIce.id}:1`]),/SELECTION_REQUIRED/);
});
test('actual multi-count defaults ignore isDefault flags and edited rounds preserve signed price differences',async()=>{
 const options=await import('../src/cart/options.ts');const item=menuOptionsSnapshot().items.find(c=>c.name==='BFF四宫格小食盘')!;
 const r=item.comboRounds![0];const resolved=options.resolveOptions(item,[]);
 assert.deepEqual(resolved.roundList[0].comboItemList.map(c=>[c.code,c.quantity]),[['516013',1],['516014',1],['516012',1]]);
 const ids=options.setRoundChoice(item,[],r.choices[2].id,0);
 assert.throws(()=>options.resolveOptions(item,ids),/SELECTION_REQUIRED/);
 const edited=options.setRoundChoice(item,ids,r.choices[3].id,1);
 assert.equal(options.resolveOptions(item,edited).referencePriceCents,item.referencePriceCents!-100);
 assert.throws(()=>options.resolveOptions(item,['round:'+r.choices[3].id+':2']),/SELECTION_REQUIRED/);
});
test('paid customization adds verified cents and unknown charges or malformed constraints cannot become free',async()=>{
 const options=await import('../src/cart/options.ts');const item=menuOptionsSnapshot().items.find(c=>c.name==='冰浓浓黑巧')!;
 const v=item.variants![0];const oat=v.modificationGroups![0].values[0];const ids=options.setModification(item,['variant:'+v.id],oat.id,1);
 assert.equal(options.resolveOptions(item,ids).referencePriceCents,v.referencePriceCents!+200);
 const unknown=structuredClone(item);unknown.variants![0].modificationGroups![0].values[0].referenceDeltaCents=null;
 assert.equal(options.resolveOptions(unknown,ids).referencePriceCents,null);
 const bad=structuredClone(item);bad.variants![0].modificationGroups![0].values[0].defaultQuantity=null;
 assert.throws(()=>options.resolveOptions(bad,[]),/SELECTION_REQUIRED/);
});
test('two real combo drinks charge oat milk twice, keep shared wire once and multiply outer quantity only once',async()=>{
 const {resolveOptions,setModification,setRoundChoice}=await import('../src/cart/options.ts');const {sampleQuote}=await import('../src/cart/model.ts');
 const live=menuOptionsSnapshot(),item=live.items.find(c=>c.officialCode==='9900011056')!;
 const round=item.comboRounds!.find(r=>r.roundId===6)!,chocolate=round.choices.find(c=>c.officialCode==='515946')!;
 let ids:string[]=[];
 for(const choice of round.choices)ids=setRoundChoice(item,ids,choice.id,choice.id===chocolate.id?2:0);
 const standard=resolveOptions(item,ids);assert.equal(standard.referencePriceCents,7190);
 const oat=chocolate.modificationGroups.flatMap(g=>g.values).find(v=>v.code==='120146')!;
 ids=setModification(item,ids,oat.id,1);const customized=resolveOptions(item,ids);
 assert.equal(customized.referencePriceCents,7590);
 assert.deepEqual(customized.roundList.find(r=>r.round==='6'),{round:'6',comboItemList:[{code:'515946',quantity:2,modification:{values:[{code:'120146',key:'0-1',quantity:1}]}}]});
 const snapshot={...live,mode:'demo' as const,sourceKind:'official-snapshot' as const};
 const request={contextKey:snapshot.contextKey,cartRevision:1,basket:[{candidateId:item.id,quantity:2,optionIds:ids}]};
 assert.equal(sampleQuote(request,snapshot).totalCents,15180);
 const off=setModification(item,ids,oat.id,0);assert.equal(sampleQuote({...request,basket:[{...request.basket[0],optionIds:off}]},snapshot).totalCents,14380);
 const direct=live.items.find(c=>c.name==='冰浓浓黑巧')!,variant=direct.variants![0],directOat=variant.modificationGroups!.flatMap(g=>g.values).find(v=>v.code==='120146')!;
 const directIds=setModification(direct,['variant:'+variant.id],directOat.id,1);
 assert.equal(resolveOptions(direct,directIds).referencePriceCents,1590);
 assert.equal(sampleQuote({...request,basket:[{candidateId:direct.id,quantity:2,optionIds:directIds}]},snapshot).totalCents,3180);
});
test('metadata keeps scoped duplicate-code ice choices, signed differences and actual multi-choice defaults',()=>{
 const snapshot=menuOptionsSnapshot();const cola=snapshot.items.find(c=>c.name==='可乐')!;
 const ice=cola.variants![1].modificationGroups![0];
 assert.equal(ice.kind,'single');assert.equal(ice.values.length,4);
 assert.equal(new Set(ice.values.map(v=>v.id)).size,4);assert.equal(new Set(ice.values.map(v=>v.code)).size,1);
 const bff=snapshot.items.find(c=>c.name==='BFF四宫格小食盘')!;
 assert.deepEqual(bff.comboRounds![0].choices.map(c=>c.defaultQuantity),[1,1,1,0,0]);
 assert.equal(bff.comboRounds![0].choices[3].referenceDeltaCents,-50);
 assert.equal(snapshot.items.find(c=>c.name==='冰浓浓黑巧')!.variants![0].modificationGroups![0].values[0].referenceDeltaCents,200);
});
test('snapshot preserves nested option whitelists and excludes private envelope fields recursively',async()=>{
 const {freezeSnapshot}=await import('../src/demo/snapshot.ts');const snapshot=menuOptionsSnapshot();const burger=snapshot.items.find(c=>c.officialCode==='1100')!;
 (burger.modificationGroups![0] as any).account='private-marker';(burger.modificationGroups![0].values[0] as any).token='private-marker';
 const frozen=freezeSnapshot(snapshot,'2026-10-15T00:01:00Z');
 assert.equal(frozen.items.find(c=>c.officialCode==='1100')!.modificationGroups!.length,1);
 assert.equal(frozen.items.find(c=>c.name==='BFF四宫格小食盘')!.comboRounds![0].choices[3].referenceDeltaCents,-50);
 assert.doesNotMatch(JSON.stringify(frozen),/private-marker|account|token/);
});
test('snapshot reference total and export include actual options with default-recipe nutrition reference',async()=>{
 const {sampleQuote,basketText}=await import('../src/cart/model.ts');const {setModification}=await import('../src/cart/options.ts');
 const source=menuOptionsSnapshot(),snapshot={...source,mode:'demo' as const,sourceKind:'official-snapshot' as const};
 const item=snapshot.items.find(c=>c.name==='冰浓浓黑巧')!,v=item.variants![0];const ids=setModification(item,['variant:'+v.id],v.modificationGroups![0].values[0].id,1);
 const request={contextKey:snapshot.contextKey,cartRevision:1,basket:[{candidateId:item.id,quantity:2,optionIds:ids}]};
 const quote=sampleQuote(request,snapshot);assert.equal(quote.totalCents,(v.referencePriceCents!+200)*2);
 assert.match(basketText(request,snapshot,[],quote),/换燕麦奶/);assert.match(basketText(request,snapshot,[],quote),/默认配方/);
 const burger=snapshot.items.find(c=>c.officialCode==='1100')!;request.basket=[{candidateId:burger.id,quantity:1,optionIds:setModification(burger,[],burger.modificationGroups![0].values[3].id,0)}];
 assert.match(basketText(request,snapshot,[],null),/不加酸黄瓜/);
});
test('malformed exact-one child quantities cannot gain a bypass through a fixed variant',async()=>{
 const {resolveOptions}=await import('../src/cart/options.ts');
 for(const change of [(c:any)=>{c.quantity='1';},(c:any)=>{c.quantity=-1;},(c:any)=>{c.maxQuantity=0;},(c:any)=>{c.maxQuantity='1';}]){
  const invalid=structuredClone(raw);change(invalid.details['9900008752'].rounds[0].choices[0]);
  const snapshot=normalizeCatalog(invalid,context);const pie=snapshot.items.find(c=>c.officialCode==='9900008752')??snapshot.items.find(c=>c.name==='菠萝派')!;
  assert.throws(()=>resolveOptions(pie,pie.defaultVariantId?['variant:'+pie.defaultVariantId]:[]),/SELECTION_REQUIRED/);
 }
});
test('empty required modification groups vanish, unknown nonempty shapes fail and changed round children reset only dependent edits',async()=>{
 const {resolveOptions,setModification,setRoundChoice}=await import('../src/cart/options.ts');
 const data=structuredClone(raw);data.details['1100'].modification={items:[{minValues:1,maxValues:1,values:[]}]};
 const simple=normalizeCatalog(data,context).items.find(c=>c.officialCode==='1100')!;assert.deepEqual(simple.modificationGroups,[]);assert.equal(resolveOptions(simple,[]).modification,undefined);
 data.details['1100'].modification={items:[{minValues:2,maxValues:3,values:raw.details['1100'].modification.items[0].values}]};
 assert.throws(()=>resolveOptions(normalizeCatalog(data,context).items.find(c=>c.officialCode==='1100')!,[]),/SELECTION_REQUIRED/);
 const burger=menuOptionsSnapshot().items.find(c=>c.officialCode==='1100')!;
 const combo=structuredClone(menuOptionsSnapshot().items.find(c=>c.name==='BFF四宫格小食盘')!);
 combo.modificationGroups=burger.modificationGroups;combo.comboRounds![1].choices[0].modificationGroups=structuredClone(burger.modificationGroups!);
 combo.comboRounds![1].choices[0].modificationGroups[0].id='newgroup';combo.comboRounds![1].choices[0].modificationGroups[0].values.forEach((v,i)=>v.id='newvalue'+i);
 const top=burger.modificationGroups![0].values[0].id,child='newvalue0';
 const ids=setModification(combo,setModification(combo,[],top,0),child,0);
 const switched=setRoundChoice(combo,ids,combo.comboRounds![1].choices[1].id,1);
 assert.ok(switched.some(id=>id.startsWith('mod:'+top+':')));assert.ok(!switched.some(id=>id.includes('newvalue')));
 const back=setRoundChoice(combo,switched,combo.comboRounds![1].choices[0].id,1);assert.equal(resolveOptions(combo,back).roundList[1].comboItemList[0].modification,undefined);
});
test('option edits immediately invalidate a completed and in-flight quote',async()=>{
 const {createQuoteTracker,basketKey}=await import('../src/cart/model.ts');const {setModification}=await import('../src/cart/options.ts');const item=menuOptionsSnapshot().items.find(c=>c.officialCode==='1100')!;
 const request={contextKey:'options',cartRevision:1,basket:[{candidateId:item.id,quantity:1,optionIds:[] as string[]}]};const tracker=createQuoteTracker(request);
 const quote={contextKey:'options',cartRevision:1,basketKey:basketKey(request.basket),totalCents:2650,currency:'CNY' as const,quotedAt:'now',mode:'live' as const,evidence:'official' as const,fees:[]};
 await tracker.run(async()=>quote);assert.equal(tracker.getState().quote!.totalCents,2650);
 let deliver!:(q:typeof quote)=>void;const pending=tracker.run(()=>new Promise(r=>{deliver=r;}));
 const optionIds=setModification(item,[],item.modificationGroups![0].values[3].id,0);tracker.replace({...request,cartRevision:2,basket:[{...request.basket[0],optionIds}]});
 assert.equal(tracker.getState().quote,null);deliver(quote);await pending;assert.equal(tracker.getState().quote,null);
});
