import { randomBytes } from 'node:crypto';
import { basketKey, moneyToCents } from '../../src/cart/model.ts';
import { isRecord } from '../../src/catalog/normalize.ts';
import type { BasketSelection } from '../../src/shared/contracts.ts';
import type { CommerceQuote, CommerceRequest, CreateOrderInput, PersonalOrder } from '../../src/commerce/contracts.ts';
import { ApiError } from '../app.ts';
import type { UserSession } from './session.ts';
import type { CouponService } from './coupons.ts';
import { createAvailabilityService, type AvailabilityService } from './availability.ts';

const QUOTE_TTL_MS = 5 * 60_000;
const CREATE_TIMEOUT_MS = 15_000;
const opaque = () => randomBytes(32).toString('base64url');
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const fail = (code: string, status = 400): never => { throw new ApiError(code, status); };
function cents(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail('QUOTE_INVALID_AMOUNT', 502);
  return value as number;
}
function response(raw: unknown, error: string): Record<string, unknown> {
  if (!isRecord(raw) || raw.success === false || (raw.code !== undefined && raw.code !== 200) || !isRecord(raw.data)) return fail(error, 502);
  return raw.data;
}
function paymentLink(value: unknown): string | null {
  try { const url = new URL(text(value) ?? ''); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
const states: Record<string, [PersonalOrder['status'], string]> = {
  '1': ['pending-payment', '待支付'], '2': ['preparing', '配餐中'], '4': ['delivering', '配送中'],
  '6': ['completed', '已完成'], '7': ['cancelled', '已取消'], '8': ['completed', '已完成'], '10': ['preparing', '配餐中'],
};
function normalizeOrder(key: string, detail: Record<string, unknown>, paymentUrl: string | null, storeName: string | null): PersonalOrder {
  const statusCode = typeof detail.orderStatus === 'string' ? detail.orderStatus : '';
  const [status, statusLabel] = (Object.hasOwn(states, statusCode) ? states[statusCode] : undefined) ?? ['unknown', '订单状态待确认'];
  let totalCents: number | null = null;
  if (typeof detail.totalAmount === 'string') { try { totalCents = moneyToCents(detail.totalAmount, 'yuan'); } catch { /* An unknown amount stays unknown. */ } }
  return { key, status, statusLabel, paymentUrl: ['pending-payment', 'unknown'].includes(status) ? paymentUrl : null, pickupCode: text(detail.pickupCode), totalCents, storeName: text(detail.storeName) ?? storeName };
}
interface QuoteEntry {
  quote: CommerceQuote; request: CommerceRequest;
  attempt?: { takeWayCode: string; result: Promise<PersonalOrder> };
  invalidated?: boolean;
}
interface OrderEntry { upstreamId: string; value: PersonalOrder; paymentUrl: string | null }

export function createCheckoutService(user: UserSession, coupons: CouponService, availability: AvailabilityService = createAvailabilityService(user,coupons)) {
  const quotes = new Map<string, QuoteEntry>(); const orders = new Map<string, OrderEntry>();
  async function calculate(request: CommerceRequest) {
    const prepared = coupons.prepare(request);
    const args = { storeCode: prepared.context.store.id, orderType: prepared.context.orderType, beType: prepared.context.beType, items: prepared.items, needTableware: false };
    const raw = await (await user.gateway()).call('calculate-price', args);
    if (!isRecord(raw) || raw.success !== true || raw.code !== 200) return fail('QUOTE_UNAVAILABLE', 502);
    const data = response(raw, 'QUOTE_UNAVAILABLE'); const totalCents = cents(data.price);
    // Official rows identify parent SKUs. Multiple verified flavor lines may share
    // a parent; account for all quantities whether upstream groups those rows or not.
    if (!Array.isArray(data.productList) || !data.productList.length || data.productList.length > prepared.items.length) return fail('QUOTE_PRODUCT_MISMATCH', 502);
    const remaining = new Map<string, number>();
    for (const item of prepared.items) remaining.set(item.productCode, (remaining.get(item.productCode) ?? 0) + item.quantity);
    for (const row of data.productList) {
      if (!isRecord(row) || typeof row.productCode !== 'string' || !remaining.has(row.productCode) || !Number.isSafeInteger(row.quantity) || (row.quantity as number) <= 0 || remaining.get(row.productCode)! < (row.quantity as number)) return fail('QUOTE_PRODUCT_MISMATCH', 502);
      remaining.set(row.productCode, remaining.get(row.productCode)! - (row.quantity as number));
      if (Object.hasOwn(row, 'subtotal')) cents(row.subtotal);
      if (Object.hasOwn(row, 'originalSubtotal')) cents(row.originalSubtotal);
    }
    if ([...remaining.values()].some(quantity => quantity !== 0)) return fail('QUOTE_PRODUCT_MISMATCH', 502);
    if (!Array.isArray(data.takeWayList) || !data.takeWayList.length || data.takeWayList.length > 20) return fail('QUOTE_TAKE_WAYS_INVALID', 502);
    const takeWays = data.takeWayList.map(value => {
      if (!isRecord(value) || !text(value.code) || !text(value.title)) return fail('QUOTE_TAKE_WAYS_INVALID', 502);
      return { code: text(value.code)!, label: text(value.title)! };
    });
    if (new Set(takeWays.map(way => way.code)).size !== takeWays.length) return fail('QUOTE_TAKE_WAYS_INVALID', 502);
    const fees: CommerceQuote['fees'] = [];
    for (const [field, label] of [['deliveryPrice', '配送费'], ['packingPrice', '打包费'], ['tablewarePrice', '餐具费']] as const) if (Object.hasOwn(data, field)) fees.push({ label, amountCents: cents(data[field]) });
    user.assertActive(); return { args, totalCents, takeWays, fees, storeName: prepared.context.store.name };
  }
  return {
    async selection(request: CommerceRequest): Promise<BasketSelection[]> { return coupons.prepare(request, true).selections; },
    async quote(request: CommerceRequest): Promise<CommerceQuote> {
      user.assertActive();
      for (const [key, entry] of quotes) if (!entry.attempt && Date.parse(entry.quote.expiresAt) <= Date.now()) quotes.delete(key);
      if (quotes.size >= 100) return fail('QUOTE_CAPACITY', 429);
      // Copy before async work so upstream awaits cannot change the accepted basket.
      const frozen = structuredClone(request); await availability.assertBasket(frozen); const result = await calculate(frozen);
      if (quotes.size >= 100) return fail('QUOTE_CAPACITY', 429);
      const quote: CommerceQuote = { contextKey: frozen.contextKey, basketKey: basketKey(frozen.basket), cartRevision: frozen.cartRevision, totalCents: result.totalCents, currency: 'CNY', quotedAt: new Date().toISOString(), mode: 'live', evidence: 'official', fees: result.fees, takeWays: result.takeWays, quoteKey: opaque(), expiresAt: new Date(Math.min(Date.now() + QUOTE_TTL_MS, user.expiresAt)).toISOString() };
      quotes.set(quote.quoteKey, { quote, request: frozen }); return structuredClone(quote);
    },
    async create(input: CreateOrderInput): Promise<PersonalOrder> {
      user.assertActive();
      if (!input || typeof input.quoteKey !== 'string' || typeof input.takeWayCode !== 'string' || typeof input.attemptKey !== 'string' || !input.attemptKey.length || input.attemptKey.length > 256 || !Number.isSafeInteger(input.expectedTotalCents) || input.expectedTotalCents < 0) return fail('INVALID_REQUEST');
      const entry = quotes.get(input.quoteKey); if (!entry) return fail('QUOTE_NOT_IN_SESSION');
      if (entry.quote.totalCents !== input.expectedTotalCents) return fail('QUOTE_AMOUNT_MISMATCH');
      if (!entry.quote.takeWays.some(way => way.code === input.takeWayCode)) return fail('INVALID_TAKE_WAY');
      if (entry.attempt) {
        if (entry.attempt.takeWayCode !== input.takeWayCode) return fail('ORDER_ATTEMPT_CONFLICT', 409);
        const order = await entry.attempt.result; user.assertActive(); return structuredClone(order);
      }
      if (entry.invalidated) return fail('PRICE_CHANGED', 409);
      if (Date.parse(entry.quote.expiresAt) <= Date.now()) return fail('QUOTE_EXPIRED');
      // The quote is consumed before the first await. All attempts share this single outcome.
      const operation = (async () => {
        const fresh = await calculate(entry.request);
        if (fresh.totalCents !== entry.quote.totalCents || !fresh.takeWays.some(way => way.code === input.takeWayCode)) {
          entry.invalidated = true; return fail('PRICE_CHANGED', 409);
        }
        await availability.assertBasket(entry.request);
        user.assertActive();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const gateway = await user.gateway();
          const raw = await Promise.race([gateway.call('create-order', { ...fresh.args, takeWayCode: input.takeWayCode }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('CREATE_TIMEOUT')), CREATE_TIMEOUT_MS); })]);
          user.assertActive(); const data = response(raw, 'ORDER_RESULT_UNKNOWN');
          const detail = isRecord(data.orderDetail) ? data.orderDetail : {};
          const upstreamId = text(data.orderId) ?? text(detail.orderId);
          if (!upstreamId || (text(detail.orderId) && text(detail.orderId) !== upstreamId)) return fail('ORDER_RESULT_UNKNOWN', 409);
          const key = opaque(); const paymentUrl = paymentLink(data.payH5Url);
          const value = normalizeOrder(key, detail, paymentUrl, fresh.storeName);
          orders.set(key, { upstreamId, value, paymentUrl }); return value;
        } catch {
          // A rejected/late create might already exist upstream. Never retry it automatically.
          return fail('ORDER_RESULT_UNKNOWN', 409);
        } finally { clearTimeout(timer); }
      })();
      entry.attempt = { takeWayCode: input.takeWayCode, result: operation };
      const order = await operation; user.assertActive(); return structuredClone(order);
    },
    async query(orderKey: string): Promise<PersonalOrder> {
      user.assertActive(); const owned = orders.get(orderKey); if (!owned) return fail('ORDER_NOT_IN_SESSION');
      const data = response(await (await user.gateway()).call('query-order', { orderId: owned.upstreamId }), 'ORDER_QUERY_UNAVAILABLE');
      if (text(data.orderId) !== owned.upstreamId) return fail('ORDER_QUERY_UNAVAILABLE', 502);
      user.assertActive(); const value = normalizeOrder(orderKey, data, owned.paymentUrl, owned.value.storeName); owned.value = value; return structuredClone(value);
    },
  };
}
export type CheckoutService = ReturnType<typeof createCheckoutService>;
