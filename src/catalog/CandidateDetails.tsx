import type {Candidate}from'../shared/contracts.ts';
export function nutritionText(nutrition:Candidate['nutrition']):string {
 const parts=[nutrition.kcal===undefined?null:`${nutrition.kcal} kcal`,nutrition.proteinG===undefined?null:`蛋白 ${nutrition.proteinG} g`,nutrition.fatG===undefined?null:`脂肪 ${nutrition.fatG} g`,nutrition.carbsG===undefined?null:`碳水 ${nutrition.carbsG} g`,nutrition.sodiumMg===undefined?null:`钠 ${nutrition.sodiumMg} mg`].filter(Boolean);
 return parts.join(' · ')||'营养数据未知';
}
export function CandidateDetails({item}:{item:Candidate}){
 const label=item.sourceKind==='official-snapshot'?'快照参考':item.mode==='demo'?'样例参考':'菜单参考';
 return item.variants?<div className="variant-details" aria-label={`${item.name}规格价格和营养`}>{item.variants.map(v=><div className="variant-detail" key={v.id}><p><strong>{v.sizeLabel}</strong><span>{v.referencePriceCents===null?'参考价未知':`¥${(v.referencePriceCents/100).toFixed(2)}`} <small>{label}</small></span></p><div>{nutritionText(v.nutrition)}</div></div>)}<p className="variant-note">规格在最终餐盘选择 · {item.sourceKind==='official-snapshot'?'采集时':'当前菜单'}共 {item.variants.length} 种</p></div>:<p className="meal-nutrition">{nutritionText(item.nutrition)}{Object.keys(item.nutrition).length>0?item.sourceKind==='official-snapshot'?' · 采集时营养':item.mode==='demo'?' · 样例营养':'':''}</p>;
}
