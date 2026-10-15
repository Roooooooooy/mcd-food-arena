export interface SessionInfo {
  connected: boolean;
  expiresAt: string | null;
}

import type { BasketLine, Candidate, QuoteResult } from '../shared/contracts.ts';
export interface CommerceLine extends BasketLine { couponKey?: string }
export interface CommerceRequest { contextKey: string; basket: CommerceLine[]; cartRevision: number }
export interface PersonalCoupon {
  benefitText?: string;
  key: string; title: string; subtitle: string; imageUrl: string | null;
  validityText: string; tags: string[]; availableAtStore: boolean; productIds: string[];
}
export interface CouponCollection {
  contextKey: string; loadedAt: string; complete: boolean; coupons: PersonalCoupon[]; products: Candidate[];
}
export interface CommerceQuote extends QuoteResult {
  quoteKey: string; expiresAt: string; takeWays: {code: string; label: string}[];
}
export interface CreateOrderInput {
  quoteKey: string; takeWayCode: string; attemptKey: string; expectedTotalCents: number;
}
export interface PersonalOrder {
  key: string;
  status: 'pending-payment' | 'preparing' | 'delivering' | 'completed' | 'cancelled' | 'unknown';
  statusLabel: string; paymentUrl: string | null; pickupCode: string | null;
  totalCents: number | null; storeName: string | null;
}
