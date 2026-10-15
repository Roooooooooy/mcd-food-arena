import { randomBytes } from 'node:crypto';
import type { Candidate } from '../../src/shared/contracts.ts';
import type { CommerceRequest, CouponCollection, PersonalCoupon } from '../../src/commerce/contracts.ts';
import { isRecord } from '../../src/catalog/normalize.ts';
import { normalizeModification, normalizeRounds } from '../../src/catalog/option-metadata.ts';
import { prepareBasket } from '../mcp/quote.ts';
import { ApiError } from '../app.ts';
import type { UserSession } from './session.ts';

const key = () => randomBytes(32).toString('base64url');
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const fail = (code: string, status = 400): never => { throw new ApiError(code, status); };
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
function data(raw: unknown): unknown {
  if (!isRecord(raw) || !Object.hasOwn(raw, 'data') || raw.success === false || (raw.code !== undefined && raw.code !== 200)) return fail('COUPONS_UNAVAILABLE', 502);
  return raw.data;
}
function image(value: unknown): string | null {
  try { const url = new URL(text(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
interface CouponEntry { couponId: string; couponCode: string; products: Map<string, Candidate> }
interface Registry { collection: CouponCollection; entries: Map<string, CouponEntry> }

export function createCouponService(user: UserSession) {
  const registries = new Map<string, Registry>();
  function context(contextKey: string) {
    user.assertActive();
    const found = user.catalog.getContext(contextKey);
    if (!found || found.snapshot.mode !== 'live' || !found.snapshot.complete) return fail('CATALOG_CONTEXT_MISSING');
    return found;
  }
  return {
    async load(contextKey: string): Promise<CouponCollection> {
      const current = context(contextKey); const g = await user.gateway();
      const wallet: Record<string, unknown>[] = []; let complete = false; let totalCount = 0;
      for (let page = 1; page <= 5; page++) {
        const raw = data(await g.call('query-my-coupons', { page: String(page), pageSize: '200' }));
        if (!isRecord(raw) || !Array.isArray(raw.coupons) || raw.coupons.length > 200 || !integer(raw.totalCount) || !integer(raw.totalPages) || raw.currentPage !== page || raw.pageSize !== 200 || raw.coupons.some(c => !isRecord(c) || !text(c.id) || !text(c.code) || !text(c.title))) return fail('COUPONS_INVALID_RESPONSE', 502);
        totalCount = raw.totalCount;
        wallet.push(...raw.coupons as Record<string, unknown>[]);
        if (page >= raw.totalPages) { complete = wallet.length >= totalCount; break; }
      }
      const store = data(await g.call('query-store-coupons', { storeCode: current.store.id, orderType: current.orderType, beType: current.beType }));
      if (!Array.isArray(store) || store.length > 1000 || store.some(c => !isRecord(c) || !text(c.couponId) || !text(c.couponCode) || !Array.isArray(c.products))) return fail('COUPONS_INVALID_RESPONSE', 502);
      const entries = new Map<string, CouponEntry>(); const products: Candidate[] = []; const coupons: PersonalCoupon[] = [];
      const seen = new Set<string>();
      for (const owned of wallet) {
        const identity = JSON.stringify([owned.id, owned.code]); if (seen.has(identity)) continue; seen.add(identity);
        // Both provided identifiers must agree; a matching name never establishes ownership.
        const matches = store.filter(s => isRecord(s) && s.couponId === owned.id && s.couponCode === owned.code);
        const eligible = owned.enable === 1 && matches.length === 1;
        const couponKey = key(); const productIds: string[] = []; const candidates = new Map<string, Candidate>();
        if (eligible) {
          for (const raw of (matches[0] as Record<string, unknown>).products as unknown[]) {
            if (!isRecord(raw) || !text(raw.productCode) || !text(raw.productName)) return fail('COUPONS_INVALID_RESPONSE', 502);
            const code = text(raw.productCode);
            if ([...candidates.values()].some(candidate => candidate.officialCode === code)) continue;
            const candidateId = key(); let detail: unknown;
            try { detail = data(await g.call('query-meal-detail', { storeCode: current.store.id, orderType: current.orderType, beType: current.beType, code })); }
            catch (error) { user.assertActive(); if (error instanceof ApiError && error.code === 'COUPONS_UNAVAILABLE') detail = undefined; else throw error; }
            const valid = isRecord(detail) && detail.code === code && text(detail.name) && Array.isArray(detail.rounds) ? detail : undefined;
            const candidate: Candidate = {
              id: candidateId, officialCode: code, name: valid ? text(valid.name) : text(raw.productName),
              stageId: 'coupon', stageLabel: '本人优惠券', sourceCategory: '本人优惠券', imageUrl: valid ? image(valid.image) : null,
              referencePriceCents: null, attributes: [], nutrition: {}, mode: 'live', optionsStatus: valid ? 'ready' : 'unavailable',
              comboRounds: normalizeRounds(valid ? valid.rounds : undefined, candidateId),
              modificationGroups: normalizeModification(valid ? valid.modification : undefined, candidateId, valid ? valid.supportModify : false),
            };
            candidates.set(candidate.id, candidate); products.push(candidate); productIds.push(candidate.id);
          }
          entries.set(couponKey, { couponId: text(owned.id), couponCode: text(owned.code), products: candidates });
        }
        coupons.push({ ...(isRecord(owned.discountInfo) && text(owned.discountInfo.discountDesc) ? {benefitText:text(owned.discountInfo.discountDesc)} : {}), key: couponKey, title: text(owned.title), subtitle: text(owned.subtitle), imageUrl: image(owned.bigImage) ?? image(owned.image), validityText: text(owned.datetimeText) || [text(owned.tradeStartDate), text(owned.tradeEndDate)].filter(Boolean).join(' - '), tags: Array.isArray(owned.tags) ? owned.tags.flatMap(tag => isRecord(tag) && text(tag.label) ? [text(tag.label)] : []) : [], availableAtStore: eligible, productIds });
      }
      user.assertActive();
      const collection = { contextKey, loadedAt: new Date().toISOString(), complete, coupons, products };
      registries.delete(contextKey); registries.set(contextKey, { collection, entries });
      while (registries.size > 20) registries.delete(registries.keys().next().value!);
      return structuredClone(collection);
    },
    // Server-only identities for availability checks. Never serialize this private wire.
    availabilityCandidate(contextKey: string, candidateId: string, couponKey?: string) {
      const current = context(contextKey);
      if (couponKey === undefined && current.candidates.has(candidateId)) return { candidate: current.candidates.get(candidateId)!, coupon: undefined };
      const registry = registries.get(contextKey);
      const entries = couponKey === undefined ? [...(registry?.entries.values() ?? [])] : [registry?.entries.get(couponKey)];
      for (const owned of entries) {
        const candidate = owned?.products.get(candidateId);
        if (owned && candidate) return { candidate, coupon: { couponId: owned.couponId, couponCode: owned.couponCode } };
      }
      return fail(couponKey === undefined ? 'PRODUCT_NOT_IN_CONTEXT' : 'COUPON_NOT_IN_CONTEXT');
    },
    prepare(request: CommerceRequest, allowRequired = false) {
      const current = context(request?.contextKey); const registry = registries.get(request.contextKey);
      if (!Array.isArray(request.basket)) return fail('INVALID_BASKET');
      const couponLines = request.basket.filter(line => line?.couponKey !== undefined);
      if (couponLines.length > 1 || couponLines.some(line => line.quantity !== 1)) return fail('INVALID_COUPON_QUANTITY');
      const candidates = new Map(current.candidates); const rawMeals = new Map(current.rawMeals);
      const ownedItems = new Map<string, CouponEntry>();
      for (const line of request.basket) {
        if (!line || typeof line.candidateId !== 'string') return fail('INVALID_BASKET');
        if (line.couponKey !== undefined) {
          const owned = registry?.entries.get(line.couponKey); const candidate = owned?.products.get(line.candidateId);
          if (!owned || !candidate || !candidate.officialCode) return fail('COUPON_NOT_IN_CONTEXT');
          ownedItems.set(line.candidateId, owned); candidates.set(candidate.id, candidate); rawMeals.set(candidate.officialCode, {});
        } else if (!current.candidates.has(line.candidateId)) return fail('PRODUCT_NOT_IN_CONTEXT');
      }
      const merged = { ...current, candidates, rawMeals };
      const prepared = prepareBasket(request, { ...user.catalog, getContext: id => id === request.contextKey ? merged : undefined }, allowRequired);
      const resolvedLines = request.basket.filter((_line, i) => !prepared.selections[i].requiresSelection);
      for (let i = 0; i < prepared.items.length; i++) {
        const owned = ownedItems.get(resolvedLines[i].candidateId);
        if (owned) Object.assign(prepared.items[i], { couponId: owned.couponId, couponCode: owned.couponCode });
      }
      return prepared;
    },
  };
}
export type CouponService = ReturnType<typeof createCouponService>;
