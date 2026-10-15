import { availabilityLabel, type AvailabilityItem } from './availability-contracts.ts';
export function AvailabilityNotice({item,replace=false}:{item:AvailabilityItem|undefined;replace?:boolean}){
 if(!item)return null;
 const checked=item.checkedAt&&Number.isFinite(Date.parse(item.checkedAt))?new Date(item.checkedAt).toLocaleString('zh-CN'):null;
 return <p className={`availability-notice availability-${item.state}`} role="status"><strong>{availabilityLabel(item.state,item.label.startsWith('优惠券')||item.label.includes('优惠券'))}</strong>{replace&&item.state==='not-returned'&&<span>已选记录保留。请换规格、移出餐品或重新挑选。</span>}{checked&&<small>检查时间：{checked}</small>}</p>;
}
