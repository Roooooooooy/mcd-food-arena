import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { CommerceRequest, CreateOrderInput } from '../../src/commerce/contracts.ts';
import type { UserSession } from './session.ts';
import { createCouponService } from './coupons.ts';
import { createCheckoutService } from './checkout.ts';
import { createAvailabilityService } from './availability.ts';
import type { CandidateAvailabilityRequest } from '../../src/commerce/availability-contracts.ts';

const ROOT = '/api/commerce';
const text = { type: 'string', minLength: 1, maxLength: 256 };
const contextKey = { ...text, maxLength: 512 };
const empty = { type: 'object', additionalProperties: false, properties: {} };
const basketBody = {
  type: 'object', additionalProperties: false, required: ['contextKey', 'basket', 'cartRevision'],
  properties: {
    contextKey, cartRevision: { type: 'integer', minimum: 0 },
    basket: { type: 'array', minItems: 1, maxItems: 50, items: {
      type: 'object', additionalProperties: false, required: ['candidateId', 'quantity', 'optionIds'],
      properties: { candidateId: text, quantity: { type: 'integer', minimum: 1, maximum: 99 }, couponKey: text, optionIds: { type: 'array', maxItems: 600, items: text } },
    } },
  },
};
export function registerCommerceRoutes(app: FastifyInstance, requireSession: (request: FastifyRequest) => UserSession) {
  const services = new WeakMap<UserSession, { coupons: ReturnType<typeof createCouponService>; checkout: ReturnType<typeof createCheckoutService>; availability: ReturnType<typeof createAvailabilityService> }>();
  function forRequest(request: FastifyRequest) {
    const user = requireSession(request); let service = services.get(user);
    if (!service) { const coupons = createCouponService(user); const availability = createAvailabilityService(user, coupons); service = { coupons, availability, checkout: createCheckoutService(user, coupons, availability) }; services.set(user, service); }
    return service;
  }
  app.get<{ Querystring: { contextKey: string } }>(ROOT + '/coupons', { schema: { querystring: { type: 'object', additionalProperties: false, required: ['contextKey'], properties: { contextKey } } } }, async request => forRequest(request).coupons.load(request.query.contextKey));
  app.post<{ Body: CandidateAvailabilityRequest }>(ROOT + '/availability', { schema: { querystring: empty, body: {type:'object',additionalProperties:false,required:['contextKey','candidateIds'],properties:{contextKey,candidateIds:{type:'array',maxItems:200,uniqueItems:true,items:text}}} } }, async request => forRequest(request).availability.candidates(request.body));
  app.post<{ Body: CommerceRequest }>(ROOT + '/basket-availability', { schema: { querystring: empty, body: basketBody } }, async request => forRequest(request).availability.basket(request.body));
  app.post<{ Body: CommerceRequest }>(ROOT + '/selection', { schema: { querystring: empty, body: basketBody } }, async request => forRequest(request).checkout.selection(request.body));
  app.post<{ Body: CommerceRequest }>(ROOT + '/quote', { schema: { querystring: empty, body: basketBody } }, async request => forRequest(request).checkout.quote(request.body));
  app.post<{ Body: CreateOrderInput }>(ROOT + '/orders', { schema: { querystring: empty, body: { type: 'object', additionalProperties: false, required: ['quoteKey', 'takeWayCode', 'attemptKey', 'expectedTotalCents'], properties: { quoteKey: text, takeWayCode: text, attemptKey: text, expectedTotalCents: { type: 'integer', minimum: 0 } } } } }, async request => forRequest(request).checkout.create(request.body));
  app.post<{ Body: { orderKey: string } }>(ROOT + '/query-order', { schema: { querystring: empty, body: { type: 'object', additionalProperties: false, required: ['orderKey'], properties: { orderKey: text } } } }, async request => forRequest(request).checkout.query(request.body.orderKey));
}
