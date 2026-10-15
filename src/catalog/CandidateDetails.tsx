import { availabilityLabel, type AvailabilityItem } from '../commerce/availability-contracts.ts';
import type { Candidate } from '../shared/contracts.ts';

export function nutritionText(nutrition: Candidate['nutrition']): string {
  const parts = [nutrition.kcal === undefined ? null : `${nutrition.kcal} kcal`, nutrition.proteinG === undefined ? null : `蛋白 ${nutrition.proteinG} g`, nutrition.fatG === undefined ? null : `脂肪 ${nutrition.fatG} g`, nutrition.carbsG === undefined ? null : `碳水 ${nutrition.carbsG} g`, nutrition.sodiumMg === undefined ? null : `钠 ${nutrition.sodiumMg} mg`].filter(Boolean);
  return parts.join(' · ') || '营养数据未知';
}

export function CandidateDetails({ item, showPrices = true, showNutrition = true, availability }: { availability?:AvailabilityItem; item: Candidate; showPrices?: boolean; showNutrition?: boolean }) {
  const variants = item.variants?.length===1&&item.variants[0].sizeLabel==='固定口味'?undefined:item.variants;
  const label = item.sourceKind === 'official-snapshot' ? '采集时营养' : item.mode === 'demo' ? '样例营养' : '菜单营养';
  return <div className="candidate-details">
    {variants && showPrices && <div className="variant-price-list" aria-label={`${item.name}各规格参考价`}>
      <p className="variant-price-caption">{item.sourceKind === 'official-snapshot' ? '快照参考价' : item.mode === 'demo' ? '样例参考价' : '菜单参考价'}</p>
      {variants.map(variant => <div className="variant-price-row" key={variant.id}><span>{variant.sizeLabel}{availability?.variants?.find(v=>v.variantId===variant.id)?.state==='not-returned'&&<small> · {availabilityLabel('not-returned')}</small>}</span><strong>{variant.referencePriceCents === null ? '价格未知' : `¥${(variant.referencePriceCents / 100).toFixed(2)}`}</strong></div>)}
      <p className="variant-note">{variants.length} 种规格 · 最后再选</p>
    </div>}
    {showNutrition && <details className="nutrition-disclosure">
      <summary aria-label={`${item.name}营养详情`}>营养详情{!variants && <span>{item.nutrition.kcal === undefined ? '未知' : `${item.nutrition.kcal} kcal`}</span>}</summary>
      <div className="nutrition-content">
        {variants ? variants.map(variant => <div className="nutrition-variant" key={variant.id}><strong>{variant.sizeLabel} · {variant.name}</strong><p>{nutritionText(variant.nutrition)}</p></div>) : <p>{nutritionText(item.nutrition)}</p>}
        <p className="nutrition-source">{label}数据，默认配方参考</p>
      </div>
    </details>}
  </div>;
}
