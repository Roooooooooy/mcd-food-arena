import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCatalog, parseNutrition } from '../src/catalog/normalize.ts';
import { filterCandidates } from '../src/catalog/filter.ts';
import { demoCatalog } from '../src/demo/menu.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/catalog.json',import.meta.url),'utf8'));
const context={contextKey:'live:3330251:pickup:test',store:{id:'3330251',name:'麦当劳杭州下城区-凤起路农贸市场餐厅',city:'杭州',address:'杭州建国北路286号'},loadedAt:'2026-10-14T00:00:00.000Z',complete:true};
const normalized=()=>normalizeCatalog(fixture,context);
const identities=(items:ReturnType<typeof normalized>['items'])=>new Set(items.flatMap(item=>[item.officialCode,...(item.variants??[]).map(v=>v.officialCode)]).filter(Boolean));

test('all 109 official menu identities survive overlaps and classification',()=>{
 const snapshot=normalized();
 assert.equal(snapshot.complete,true);
 assert.equal(snapshot.rawSkuCount,109);
 assert.deepEqual(identities(snapshot.items),new Set(Object.keys(fixture.meals)));
 assert.equal(new Set(snapshot.items.map(i=>i.id)).size,snapshot.items.length);
 assert.equal(snapshot.items.filter(i=>i.officialCode==='521950').length,1);
 assert.deepEqual(snapshot.items.find(i=>i.officialCode==='521950')?.sourceCategories,['人气热卖','小食甜品\n/其他']);
});
test('unknown price remains null and actual zero stays zero without modifying evidence',()=>{
 const raw=structuredClone(fixture);delete raw.meals['1100'].currentPrice;raw.meals['1406'].currentPrice='0';raw.meals['1450'].currentPrice='not money';
 const snapshot=normalizeCatalog(raw,context);
 assert.equal(snapshot.items.find(i=>i.officialCode==='1100')?.referencePriceCents,null);
 assert.equal(snapshot.items.find(i=>i.officialCode==='1406')?.referencePriceCents,0);
 assert.equal(snapshot.items.find(i=>i.officialCode==='1450')?.referencePriceCents,null);
 assert.equal(normalized().items.find(i=>i.officialCode==='1100')?.referencePriceCents,2650);
});
test('missing references or malformed entries mark a catalog incomplete while retaining valid candidates',()=>{
 const raw=structuredClone(fixture);raw.categories[0].meals.push({code:'missing'});raw.meals['1100'].name=null;
 const snapshot=normalizeCatalog(raw,context);assert.equal(snapshot.complete,false);assert.ok(snapshot.items.length>100);
 assert.equal(normalizeCatalog(fixture,{...context,complete:false}).complete,false);
 assert.equal(normalizeCatalog({categories:[],meals:{}},context).complete,false);
});
test('nutrition parser checks TOON count and quotes, preserves zero, missing and exact identity',()=>{
 const rows=parseNutrition('[2]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:\n  "饮料,无糖",null,0,0,null,0,1,0,null\n  巨无霸,null,2146,513,27,26,42,961,171');
 assert.deepEqual(rows.get('饮料,无糖'),{kcal:0,fatG:0,carbsG:1,sodiumMg:0});assert.equal(rows.get('巨无霸')?.kcal,513);
 assert.equal(parseNutrition('[3]{productName,energyKcal}:\n巨无霸,513').size,0);
 assert.equal(normalized().items.find(i=>i.officialCode==='1100')?.nutrition.kcal,513);
 assert.deepEqual(normalized().items.find(i=>i.officialCode==='9900005466')?.nutrition,{});
});
test('actual classification removes chicken category, separates sides, burgers, dessert, pie and other',()=>{
 const items=normalized().items;assert.ok(!items.some(i=>i.stageId==='chicken'));
 for(const code of ['1401','1700','520445'])assert.equal(items.find(i=>i.officialCode===code)?.stageId,'side');
 assert.equal(items.find(i=>i.officialCode==='1440')?.stageId,'burger');
 assert.equal(items.find(i=>i.officialCode==='9900005466')?.stageId,'combo');
 assert.equal(items.find(i=>i.officialCode==='515837')?.stageId,'dessert');
 assert.equal(items.find(i=>i.officialCode==='9900008752')?.stageId,'pie');
 assert.equal(items.find(i=>i.officialCode==='521946')?.stageId,'other');
});
test('manual selection retains 100 candidates in observed order without Top-N',()=>{
 const snapshot=demoCatalog();snapshot.items=Array.from({length:100},(_,i)=>({...snapshot.items[0],id:`demo:${i}`,stageId:'burger'}));
 assert.equal(filterCandidates(snapshot,{stageId:'burger',excludedIds:[]}).length,100);
 assert.deepEqual(filterCandidates(snapshot,{stageId:'burger',selectedIds:['demo:99','demo:1','demo:2'],excludedIds:['demo:2']}).map(i=>i.id),['demo:1','demo:99']);
});
test('explicit same-drink sizes merge while flavor, no-sugar and temperature stay distinct',()=>{
 const names=['可乐小杯','可乐（中杯）','可乐大杯','无糖可口可乐小杯','无糖可口可乐大杯','冰拿铁小杯','冰拿铁大杯','热拿铁小杯','桃味茶小杯','柠檬茶小杯'];
 const raw={categories:[{name:'饮品',meals:names.map((_,i)=>({code:String(i)}))}],meals:Object.fromEntries(names.map((name,i)=>[String(i),{name,currentPrice:String(10+i)}]))};
 const snapshot=normalizeCatalog(raw,context);assert.equal(snapshot.items.length,6);assert.equal(identities(snapshot.items).size,10);
 const cola=snapshot.items.find(i=>i.name==='可乐')!;assert.equal(cola.variants?.length,3);assert.deepEqual(cola.variants?.map(v=>v.sizeLabel),['小杯','中杯','大杯']);
 assert.equal(cola.defaultVariantId,cola.variants?.[0].id);assert.equal(cola.officialCode,null);
});
test('live drink details expose separate regular/no-sugar families with all verified sizes',()=>{
 const details=JSON.parse(readFileSync(new URL('./fixtures/catalog-details.json',import.meta.url),'utf8'));
 const snapshot=normalizeCatalog({...fixture,details},context);
 assert.equal(snapshot.rawSkuCount,109);assert.equal(snapshot.items.length,110);
 const cola=snapshot.items.find(i=>i.name==='可乐')!;const zero=snapshot.items.find(i=>i.name==='无糖可口可乐')!;
 assert.equal(cola.officialCode,null);assert.equal(cola.variants?.length,3);assert.equal(zero.variants?.length,3);
 assert.deepEqual(cola.variants?.map(v=>v.referencePriceCents),[950,1000,1200]);
 assert.deepEqual(cola.variants?.map(v=>v.nutrition.kcal),[107,147,224]);
 assert.equal(cola.variants?.[1].menuCode,'9900008751');assert.equal(cola.variants?.[1].roundId,1);
 assert.equal(snapshot.items.find(i=>i.officialCode==='3010')?.variants?.length,1);
});
test('sample display groups chicken into sides without dropping any sample identity',async()=>{
 const {demoForDisplay}=await import('../src/catalog/source.ts');const sample=demoForDisplay();assert.equal(sample.items.length,40);assert.equal(sample.items.filter(i=>i.stageId==='side').length,10);assert.ok(!sample.items.some(i=>i.stageId==='chicken'));assert.notEqual(sample.contextKey,demoCatalog().contextKey);
 assert.deepEqual(new Set(sample.items.map(i=>i.id)),new Set(demoCatalog().items.map(i=>i.id)));
});
test('an incomplete live snapshot cannot start an arena',async()=>{
 const {startSession}=await import('../src/setup/session.ts');const snapshot=normalized();snapshot.complete=false;assert.throws(()=>startSession(snapshot,[{id:'burger',candidateIds:snapshot.items.filter(i=>i.stageId==='burger').map(i=>i.id)}]),/菜单.*完整/);
});
test('explicit size parentheses do not hide the exact corresponding nutrition record', () => {
 const snapshot=normalizeCatalog({categories:[{name:'饮品',meals:[{code:'s'}]}],meals:{s:{name:'雪碧（小杯）',currentPrice:'9.5'}},nutrition:fixture.nutrition},context);
 assert.equal(snapshot.items[0].variants?.[0].nutrition.kcal,76);
});
