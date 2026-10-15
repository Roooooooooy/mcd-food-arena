import { demoCatalog } from '../demo/menu.ts';
import { stageLabels } from './normalize.ts';
import type {CatalogSnapshot} from '../shared/contracts.ts';
import type {StageSelection} from '../setup/session.ts';
import { archiveAssetUrl } from '../demo/snapshot.ts';
export const publicDemoOnly = import.meta.env?.VITE_PUBLIC_DEMO === 'true';
export async function loadFrozenDemo(baseUrl: string = import.meta.env?.BASE_URL ?? '/', fetcher: typeof fetch = fetch): Promise<CatalogSnapshot> {
 const response = await fetcher(`${baseUrl.replace(/\/?$/, '/')}demo/catalog.json`);
 if (!response.ok) throw new Error('门店快照暂时无法加载，请刷新页面重试。');
 const snapshot = await response.json() as CatalogSnapshot;
 if (snapshot.mode !== 'demo' || snapshot.sourceKind !== 'official-snapshot' || !snapshot.complete || !Array.isArray(snapshot.items)) throw new Error('门店快照的格式不对，暂时无法使用。');
 return {...snapshot, items: snapshot.items.map(item => ({...item, mode:'demo', sourceKind:'official-snapshot', imageUrl:archiveAssetUrl(item.imageUrl, baseUrl), ...(item.variants ? {variants:item.variants.map(v=>({...v,imageUrl:archiveAssetUrl(v.imageUrl,baseUrl)}))} : {})}))};
}
export function demoForDisplay():CatalogSnapshot {
 const snapshot=demoCatalog();return {...snapshot,contextKey:'demo:mcd-food-arena:grouped:v2',items:snapshot.items.map(item=>({...item,stageId:item.stageId==='chicken'?'side':item.stageId,stageLabel:stageLabels[item.stageId==='chicken'?'side':item.stageId]}))};
}
export function defaultSelection(snapshot:CatalogSnapshot):StageSelection[]{
 const preferred=['burger','side','drink'];const all=[...new Set(snapshot.items.map(item=>item.stageId))];
 const stages=preferred.filter(id=>all.includes(id));return(stages.length?stages:all.slice(0,1)).map(id=>({id,candidateIds:snapshot.items.filter(item=>item.stageId===id).map(item=>item.id)}));
}
