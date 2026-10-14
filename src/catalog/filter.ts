import type { Candidate, CatalogSnapshot } from '../shared/contracts.ts';
export function filterCandidates(snapshot:CatalogSnapshot,input:{stageId:string;selectedIds?:string[];excludedIds:string[]}):Candidate[]{
 const selected=input.selectedIds===undefined?null:new Set(input.selectedIds);const excluded=new Set(input.excludedIds);
 return snapshot.items.filter(item=>item.stageId===input.stageId&&!excluded.has(item.id)&&(selected===null||selected.has(item.id)));
}
