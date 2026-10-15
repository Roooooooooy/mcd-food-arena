import { useEffect, useRef, useState } from 'react';
import { resolveOptions } from '../cart/options.ts';
import type { CatalogSnapshot, BasketLine } from '../shared/contracts.ts';
import type { CouponCollection } from '../commerce/contracts.ts';
import type { CommerceApi } from '../commerce/api.ts';
import { recommendCoupons, type CouponProposal } from './recommend.ts';
import { basketKey, quoteIsCurrent } from '../cart/model.ts';
export function CouponArt({imageUrl,name}:{imageUrl:string|null;name:string}){return imageUrl?<img className="coupon-product-image" src={imageUrl} alt={name}/>:<div className="coupon-art-placeholder" role="img" aria-label={`${name}暂无官方图片`}><span aria-hidden="true">—</span><small>暂无官方图片</small></div>;}
export function CouponRecommendations({snapshot,basket,collection,client,revision,eligibilityGeneration=0,onApply,onRefresh,busy=false,canUndo=false,onUndo}:{snapshot:CatalogSnapshot;basket:BasketLine[];collection:CouponCollection;client:CommerceApi;revision:number;eligibilityGeneration?:number;onApply:(p:CouponProposal)=>void;onRefresh:()=>void;busy?:boolean;canUndo?:boolean;onUndo:()=>void}){
 const proposals=recommendCoupons(snapshot,basket,collection,{cartRevision:revision});const [comparison,setComparison]=useState<{id:string;before:number;after:number;expiresAt:number;identity:string}|null>(null);const [comparing,setComparing]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);const version=useRef(0);
 const identity=JSON.stringify([snapshot.contextKey,collection.contextKey,collection.loadedAt,collection.coupons.map(c=>c.key),basketKey(basket),revision,eligibilityGeneration,busy]);
 const currentIdentity=useRef(identity);currentIdentity.current=identity;
 useEffect(()=>{version.current++;setComparison(null);setComparing(null);setError(null);return()=>{version.current++;};},[identity]);
 useEffect(()=>{
  if(!comparison)return;
  const remaining=comparison.expiresAt-Date.now();
  if(remaining<=0){setComparison(null);return;}
  const timer=window.setTimeout(()=>setComparison(current=>current===comparison?null:current),remaining);
  return()=>window.clearTimeout(timer);
 },[comparison]);
 async function compare(p:CouponProposal){
  if(busy)return;
  const current=++version.current;setComparison(null);setComparing(p.productID);setError(null);
  try{
   const beforeRequest={contextKey:snapshot.contextKey,basket,cartRevision:revision};
   const before=await client.quote(beforeRequest);
   if(current!==version.current||identity!==currentIdentity.current)return;
   const afterRequest={contextKey:snapshot.contextKey,basket:p.replacement,cartRevision:revision+1};
   const after=await client.quote(afterRequest);
   if(current!==version.current||identity!==currentIdentity.current)return;
   const expiresAt=Math.min(Date.parse(before.expiresAt),Date.parse(after.expiresAt));
   if(!quoteIsCurrent(before,beforeRequest)||!quoteIsCurrent(after,afterRequest)||before.evidence!=='official'||after.evidence!=='official'||!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw new Error('报价已失效，请重新核对用券前后金额。');
   setComparison({id:p.productID,before:before.totalCents,after:after.totalCents,expiresAt,identity});
  }catch(e){if(current===version.current)setError(e instanceof Error?e.message:'暂时无法核对金额。');}
  finally{if(current===version.current)setComparing(null);}
 }
 return <section className="coupon-recommendations" aria-label="本人优惠券替换方案"><div className="coupon-section-heading"><div><p className="eyebrow">本人优惠券</p><h2>把选好的餐品，换成券内组合</h2><p>匹配按实际餐品编码和数量计算。匹配高不代表更便宜，先看差异，再核对官方金额。</p></div><button className="button button-outline" disabled={busy||!!comparing} onClick={onRefresh}>刷新券包</button></div>{!collection.complete&&<p className="notice" role="status">券包尚未读取完整，以下只展示已确认的券。</p>}
 {basket.some(l=>l.couponKey)?<div className="coupon-active"><p>餐单已使用一张券，不叠加其他券。</p><button className="button button-outline" disabled={!canUndo||busy} onClick={onUndo}>撤销这次用券</button>{!canUndo&&<p>餐单已修改，原替换不能直接撤销。返回分类时会恢复券覆盖的原餐品，并保留其他改动。</p>}</div>:<div className="coupon-proposal-grid">{proposals.map(p=>{const c=collection.coupons.find(c=>c.key===p.couponKey)!,product=collection.products.find(c=>c.id===p.productID)!;const price=comparison?.id===p.productID&&comparison.identity===identity&&comparison.expiresAt>Date.now()?comparison:null;let components:ReturnType<typeof resolveOptions>|null=null;try{components=resolveOptions(product,p.optionIDs);}catch{}
 return <article className="coupon-proposal" key={p.productID}><div className="coupon-proposal-title"><CouponArt imageUrl={product.imageUrl??c.imageUrl} name={c.title}/><div><h3>{c.title}</h3>{c.subtitle&&<p>{c.subtitle}</p>}{c.benefitText&&<p>{c.benefitText}</p>}<strong className="coupon-match">匹配 {p.matchedCount}/{p.unionCount} · {Math.round(p.percent)}%</strong></div></div>{c.validityText&&<p>{c.validityText}</p>}{c.tags.length>0&&<p>{c.tags.join(' · ')}</p>}<p>匹配餐品：{p.matchedFoods.join('、')||'无匹配餐品'}</p><p>将移出：{p.removals.map(r=>`${snapshot.items.find(i=>i.id===r.candidateId)?.name??'餐品'} × ${r.quantity}`).join('、')||'无可安全移出的餐品'}</p>{p.extraFoods.length>0&&<p>券内多出：{p.extraFoods.join('、')}</p>}{p.customizationChanges.map((s,i)=><p className="notice" key={i}>{s}</p>)}{components&&<details className="coupon-recipe"><summary>查看券内实际选配</summary><ul>{components.components.length?components.components.map((c,i)=><li key={i}>{c.name} × {c.quantity}</li>):<li>{product.name} × 1</li>}</ul>{components.summary.length>0&&<p>定制：{components.summary.join('、')}</p>}</details>}{!p.searchComplete&&<p className="form-hint">可选组合较多，当前只比较了部分合法组合。</p>}{p.reason&&<p className="notice">{p.reason}</p>}{price&&<div className="coupon-price-comparison" role="status"><p>本次官方整单报价：用券前 <strong>¥{(price.before/100).toFixed(2)}</strong> → 用券后 <strong>¥{(price.after/100).toFixed(2)}</strong></p><p>{price.after<price.before?`少 ¥${((price.before-price.after)/100).toFixed(2)}`:price.after>price.before?`多 ¥${((price.after-price.before)/100).toFixed(2)}`:'金额相同'}；实际提交前仍需核价确认。</p></div>}<div className="coupon-proposal-actions"><button className="button button-outline" disabled={!p.canApply||busy||!!comparing} onClick={()=>void compare(p)}>{comparing===p.productID?'正在核价…':'核对用券前后金额'}</button><button className="button button-primary" disabled={!p.canApply||busy||!!comparing} onClick={()=>onApply(p)}>用这张券替换</button></div></article>;
 })}</div>}
 {!proposals.length&&!basket.some(l=>l.couponKey)&&<p>当前餐单没有可安全替换的券内组合。</p>}
 <details className="coupon-wallet"><summary>查看全部 {collection.coupons.length} 张本人券</summary>{collection.coupons.map(c=><article key={c.key}><h3>{c.title}</h3>{c.subtitle&&<p>{c.subtitle}</p>}{c.benefitText&&<p>{c.benefitText}</p>}<p>{c.validityText}</p>{c.tags.length>0&&<p>{c.tags.join(' · ')}</p>}<p>{c.availableAtStore?'当前门店可用':'当前门店不可用'}</p></article>)}</details>{error&&<p role="alert" className="notice">{error}</p>}</section>;
}
