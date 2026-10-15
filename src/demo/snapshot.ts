import type { Candidate, CatalogSnapshot, Variant, ModificationGroup, ComboRound } from '../shared/contracts.ts';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SNAPSHOT');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new Error('INVALID_SNAPSHOT');
  return value;
}
function timestamp(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error('INVALID_SNAPSHOT_TIME');
  return result;
}
function price(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('INVALID_SNAPSHOT_PRICE');
  return value as number;
}
function nullableInteger(value:unknown):number|null {
 if(value===null)return null;
 if(!Number.isSafeInteger(value))throw new Error('INVALID_SNAPSHOT_OPTIONS');
 return value as number;
}
function groups(value:unknown):ModificationGroup[]{
 if(!Array.isArray(value))throw new Error('INVALID_SNAPSHOT_OPTIONS');
 return value.map(group=>{
  const g=record(group);if(!['single','toggles','unavailable'].includes(String(g.kind))||!Array.isArray(g.values))throw new Error('INVALID_SNAPSHOT_OPTIONS');
  return {id:text(g.id),kind:g.kind as ModificationGroup['kind'],minValues:nullableInteger(g.minValues),maxValues:nullableInteger(g.maxValues),values:g.values.map(value=>{
   const v=record(value);return {id:text(v.id),code:text(v.code),name:text(v.name),minQuantity:nullableInteger(v.minQuantity),maxQuantity:nullableInteger(v.maxQuantity),defaultQuantity:nullableInteger(v.defaultQuantity),selectedKey:text(v.selectedKey),...(v.unselectedKey===undefined?{}:{unselectedKey:text(v.unselectedKey)}),referenceDeltaCents:nullableInteger(v.referenceDeltaCents)};
  })};
 });
}
function rounds(value:unknown):ComboRound[]{
 if(!Array.isArray(value))throw new Error('INVALID_SNAPSHOT_OPTIONS');
 return value.map(value=>{
  const r=record(value);if(!Array.isArray(r.choices))throw new Error('INVALID_SNAPSHOT_OPTIONS');
  return {id:text(r.id),roundId:nullableInteger(r.roundId),name:text(r.name),minQuantity:nullableInteger(r.minQuantity),maxQuantity:nullableInteger(r.maxQuantity),defaultQuantity:nullableInteger(r.defaultQuantity),choices:r.choices.map(value=>{
   const c=record(value);return {id:text(c.id),officialCode:text(c.officialCode),name:text(c.name),maxQuantity:nullableInteger(c.maxQuantity),defaultQuantity:nullableInteger(c.defaultQuantity),referenceDeltaCents:nullableInteger(c.referenceDeltaCents),modificationGroups:groups(c.modificationGroups)};
  })};
 });
}
function optionFields(input:Record<string,unknown>){
 if(input.optionsStatus!==undefined&&input.optionsStatus!=='ready'&&input.optionsStatus!=='unavailable')throw new Error('INVALID_SNAPSHOT_OPTIONS');
 return {...(input.optionsStatus===undefined?{}:{optionsStatus:input.optionsStatus as 'ready'|'unavailable'}),...(input.modificationGroups===undefined?{}:{modificationGroups:groups(input.modificationGroups)})};
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('INVALID_SNAPSHOT');
  return value.map(text);
}
function nutrition(value: unknown): Candidate['nutrition'] {
  const input = record(value), output: Candidate['nutrition'] = {};
  for (const key of ['kcal', 'proteinG', 'fatG', 'carbsG', 'sodiumMg'] as const) {
    const amount = input[key];
    if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) output[key] = amount;
  }
  return output;
}
export function publicImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'menu-img.mcd.cn' && !url.port && !url.username && !url.password && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
function variant(value: unknown): Variant {
  const input = record(value);
  return {
    id: text(input.id), officialCode: text(input.officialCode), name: text(input.name), sizeLabel: text(input.sizeLabel),
    referencePriceCents: price(input.referencePriceCents), nutrition: nutrition(input.nutrition), imageUrl: publicImageUrl(input.imageUrl),
    ...(input.menuCode === undefined ? {} : { menuCode: text(input.menuCode) }),
    ...(Number.isSafeInteger(input.roundId) && (input.roundId as number) >= 0 ? { roundId: input.roundId as number } : {}),
    ...optionFields(input),
  };
}
function candidate(value: unknown): Candidate {
  const input = record(value);
  const variants = input.variants === undefined ? undefined : Array.isArray(input.variants) ? input.variants.map(variant) : (() => { throw new Error('INVALID_SNAPSHOT_VARIANTS'); })();
  if (variants && (!variants.length || new Set(variants.map(v => v.id)).size !== variants.length)) throw new Error('INVALID_SNAPSHOT_VARIANTS');
  const defaultVariantId = input.defaultVariantId === undefined ? undefined : text(input.defaultVariantId);
  if (defaultVariantId && !variants?.some(v => v.id === defaultVariantId)) throw new Error('INVALID_SNAPSHOT_VARIANT');
  return {
    id: text(input.id), officialCode: input.officialCode === null ? null : text(input.officialCode), name: text(input.name),
    stageId: text(input.stageId), sourceCategory: text(input.sourceCategory), imageUrl: publicImageUrl(input.imageUrl),
    referencePriceCents: price(input.referencePriceCents), attributes: strings(input.attributes), nutrition: nutrition(input.nutrition), mode: 'demo', sourceKind: 'official-snapshot',
    ...(input.stageLabel === undefined ? {} : { stageLabel: text(input.stageLabel) }),
    ...(input.sourceCategories === undefined ? {} : { sourceCategories: strings(input.sourceCategories) }),
    ...(variants ? { variants } : {}), ...(defaultVariantId ? { defaultVariantId } : {}),
    ...optionFields(input), ...(input.comboRounds===undefined?{}:{comboRounds:rounds(input.comboRounds)}),
  };
}
/** Export only the normalized public catalog contract, never raw MCP objects. */
export function freezeSnapshot(value: unknown, capturedAt: string): CatalogSnapshot {
  const input = record(value), store = record(input.store);
  const id = text(store.id), time = timestamp(capturedAt);
  if (input.complete !== true || !Array.isArray(input.items) || !input.items.length) throw new Error('INCOMPLETE_SNAPSHOT');
  const items = input.items.map(candidate);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('DUPLICATE_SNAPSHOT_IDENTITY');
  return {
    contextKey: `demo:snapshot:${id}:${time}`, mode: 'demo', sourceKind: 'official-snapshot', capturedAt: time,
    loadedAt: timestamp(input.loadedAt), complete: true,
    store: { id, name: text(store.name), city: text(store.city), address: text(store.address) }, items,
    ...(Number.isSafeInteger(input.rawSkuCount) && (input.rawSkuCount as number) >= 0 ? { rawSkuCount: input.rawSkuCount as number } : {}),
  };
}
export function archiveAssetUrl(value: unknown, baseUrl: string): string | null {
  return typeof value === 'string' && /^demo\/images\/[a-zA-Z0-9_-]+\.(png|gif|jpg|webp)$/.test(value) ? `${baseUrl.replace(/\/?$/, '/')}${value}` : null;
}
