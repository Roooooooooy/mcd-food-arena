import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import type { BasketSelection, CatalogSnapshot, QuoteRequest, QuoteResult, StoreOption } from '../src/shared/contracts.ts';

export interface ApiServices {
  stores(input: { city: string; keyword: string }): Promise<StoreOption[]>;
  catalog(input: { storeId: string; diningMode: string }): Promise<CatalogSnapshot>;
  quote(input: QuoteRequest): Promise<QuoteResult>;
  selection?(input: QuoteRequest): Promise<BasketSelection[]>;
}

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode: number) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const originAllowlist = new Set(['http://127.0.0.1:5173', 'http://127.0.0.1:8787']);
const hostAllowlist = new Set(['127.0.0.1:8787']);
const text = { type: 'string', minLength: 1, maxLength: 256 };
const quoteBody = {
  type: 'object', additionalProperties: false, required: ['contextKey', 'basket', 'cartRevision'],
  properties: {
    contextKey: text,
    cartRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    basket: { type: 'array', minItems: 1, maxItems: 50, items: {
      type: 'object', additionalProperties: false, required: ['candidateId', 'quantity', 'optionIds'],
      properties: { candidateId: text, quantity: { type: 'integer', minimum: 1, maximum: 99 }, optionIds: { type: 'array', maxItems: 600, uniqueItems: true, items: text } },
    } },
  },
};

export function createApp(services: ApiServices) {
  const app = Fastify({ logger: false, bodyLimit: 65_536, requestTimeout: 20_000, connectionTimeout: 20_000, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    if (!hostAllowlist.has(request.headers.host ?? '') ||
      (origin !== undefined && !originAllowlist.has(origin)) ||
      (request.method === 'POST' && origin === undefined) ||
      (fetchSite !== undefined && !['same-origin', 'same-site', 'none'].includes(String(fetchSite)))) {
      return reply.code(403).send({ error: { code: 'LOCAL_REQUEST_REQUIRED', message: '仅允许本机页面访问。' } });
    }
  });
  app.setErrorHandler((caught, _request, reply) => {
    const error = caught instanceof Error ? caught as FastifyError : new Error('UPSTREAM_FAILED') as FastifyError;
    let code = 'UPSTREAM_FAILED';
    let status = 502;
    if (error.validation) { code = 'INVALID_REQUEST'; status = 400; }
    else if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') { code = 'PAYLOAD_TOO_LARGE'; status = 413; }
    else if (error.statusCode === 415 || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') { code = 'INVALID_REQUEST'; status = error.statusCode === 415 ? 415 : 400; }
    else if (error instanceof ApiError && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) && error.statusCode >= 400 && error.statusCode <= 599) { code = error.code; status = error.statusCode; }
    else if (error.message === 'MCP_UNAUTHORIZED') { code = 'MCP_UNAUTHORIZED'; status = 401; }
    else if (error.message === 'MCP_RATE_LIMITED') { code = 'MCP_RATE_LIMITED'; status = 429; }
    else if (error.message === 'MCP_TIMEOUT') { code = 'MCP_TIMEOUT'; status = 504; }
    return reply.code(status).send({ error: { code, message: status < 500 && status !== 429 && status !== 401 ? '请求无效，请检查输入。' : '服务暂时不可用，请稍后重试。' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }));
  app.get<{ Querystring: { city: string; keyword: string } }>('/api/stores', {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['city', 'keyword'], properties: { city: text, keyword: text } } },
  }, async request => services.stores({ city: request.query.city, keyword: request.query.keyword }));
  app.get<{ Querystring: { storeId: string; diningMode: string } }>('/api/catalog', {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['storeId', 'diningMode'], properties: { storeId: text, diningMode: text } } },
  }, async request => services.catalog({ storeId: request.query.storeId, diningMode: request.query.diningMode }));
  app.post<{ Body: QuoteRequest }>('/api/quote', { schema: { body: quoteBody } }, async request => services.quote(request.body));
  app.post<{ Body: QuoteRequest }>('/api/selection', { schema: { body: quoteBody } }, async request => {
    if (!services.selection) throw new ApiError('SELECTION_UNAVAILABLE', 503);
    return services.selection(request.body);
  });
  return app;
}
