import type { Candidate } from '../shared/contracts.ts';
import type { CouponCollection } from './contracts.ts';
export function CouponDetails({item,collection}:{item:Candidate;collection?:CouponCollection|null}){
 if(!collection)return null;
 const codes=new Set([item.officialCode,...(item.variants??[]).map(v=>v.officialCode),...(item.comboRounds??[]).flatMap(r=>r.choices.map(c=>c.officialCode))]);
 const related=collection.coupons.filter(c=>c.productIds.some(id=>{const p=collection.products.find(p=>p.id===id);return p&&(codes.has(p.officialCode)||(p.comboRounds??[]).some(r=>r.choices.some(ch=>codes.has(ch.officialCode))));}));
 if(!related.length)return null;
 return <details className="coupon-details"><summary aria-label={`${item.name}相关优惠券`}>相关优惠券 <span>{related.length} 张</span></summary><div className="coupon-detail-list">{related.map(c=><article key={c.key}><h3>{c.title}</h3>{c.subtitle&&<p>{c.subtitle}</p>}{c.benefitText&&<p>{c.benefitText}</p>}{c.validityText&&<p>{c.validityText}</p>}{c.tags.length>0&&<p>{c.tags.join(' · ')}</p>}<p>{c.availableAtStore?'当前门店可用；选完餐品后在餐单中查看替换方案。':'当前门店不可用。'}</p></article>)}</div></details>;
}
