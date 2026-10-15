import Fastify from 'fastify';
import type { FastifyError, FastifyRequest } from 'fastify';
import { ApiError } from '../app.ts';
import { publicMcpError } from '../mcp/gateway.ts';
import { createSessionManager, type UserSession } from './session.ts';
import type { SessionInfo } from '../../src/commerce/contracts.ts';

export const SESSION_COOKIE_NAME = 'mcd_commerce_session';
const ROOT = '/api/commerce';
const text = { type: 'string', minLength: 1, maxLength: 256 };
const empty = { type: 'object', additionalProperties: false, properties: {} };
const publicCodes = new Set(['INVALID_REQUEST', 'SESSION_REQUIRED', 'SESSION_CAPACITY', 'REQUEST_RATE_LIMITED', 'STORE_NOT_VERIFIED', 'UNSUPPORTED_DINING_MODE', 'STORES_INVALID_RESPONSE', 'CATALOG_INVALID_RESPONSE', 'CATALOG_INVALID_DETAIL', 'CATALOG_CONTEXT_MISSING', 'PRODUCT_NOT_IN_CONTEXT', 'COUPONS_UNAVAILABLE', 'COUPONS_INVALID_RESPONSE', 'COUPON_NOT_IN_CONTEXT', 'INVALID_COUPON_QUANTITY', 'INVALID_BASKET', 'DUPLICATE_BASKET_LINE', 'OPTION_NOT_IN_CONTEXT', 'SELECTION_REQUIRED', 'QUOTE_UNAVAILABLE', 'QUOTE_INVALID_AMOUNT', 'QUOTE_PRODUCT_MISMATCH', 'QUOTE_TAKE_WAYS_INVALID', 'QUOTE_CAPACITY', 'QUOTE_NOT_IN_SESSION', 'QUOTE_AMOUNT_MISMATCH', 'INVALID_TAKE_WAY', 'QUOTE_EXPIRED', 'PRICE_CHANGED', 'CURRENTLY_UNAVAILABLE', 'ORDER_ATTEMPT_CONFLICT', 'ORDER_RESULT_UNKNOWN', 'ORDER_NOT_IN_SESSION', 'ORDER_QUERY_UNAVAILABLE']);
const disconnected: SessionInfo = { connected: false, expiresAt: null };
const info = (user: UserSession): SessionInfo => ({ connected: true, expiresAt: new Date(user.expiresAt).toISOString() });

function loopback(url: URL) { return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); }
function publicOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('INVALID_PUBLIC_ORIGIN'); }
  if (url.origin !== value || url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !loopback(url))) throw new Error('INVALID_PUBLIC_ORIGIN');
  return url;
}

export function createCommerceApp(options: {
  sessions: ReturnType<typeof createSessionManager>;
  origin: string;
  devOrigin?: string;
  secureCookie: boolean;
}) {
  const origin = publicOrigin(options.origin);
  if (!loopback(origin) && !options.secureCookie) throw new Error('SECURE_COOKIE_REQUIRED');
  const origins = new Set([options.origin]);
  if (options.devOrigin !== undefined) {
    const dev = publicOrigin(options.devOrigin);
    if (!loopback(origin) || !loopback(dev)) throw new Error('INVALID_DEV_ORIGIN');
    origins.add(options.devOrigin);
  }
  const app = Fastify({ logger: false, bodyLimit: 65_536, requestTimeout: 20_000, connectionTimeout: 20_000, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  function limit(key: string, maximum: number) {
    const now = Date.now();
    for (const [id, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 1024) throw new ApiError('REQUEST_RATE_LIMITED', 429);
      bucket = { count: 0, expiresAt: now + 60_000 }; buckets.set(key, bucket);
    }
    if (bucket.count >= maximum) throw new ApiError('REQUEST_RATE_LIMITED', 429);
    bucket.count++;
  }
  function sessionId(request: FastifyRequest): string | undefined {
    const values = (request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (values.length !== 1) return undefined;
    const id = values[0].slice(SESSION_COOKIE_NAME.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(id) ? id : undefined;
  }
  function requireSession(request: FastifyRequest): UserSession {
    const id = sessionId(request);
    const user = id ? options.sessions.get(id) : undefined;
    if (!user) throw new ApiError('SESSION_REQUIRED', 401);
    user.assertActive();
    return user;
  }
  function cookie(id: string, maxAge: number) {
    return `${SESSION_COOKIE_NAME}=${id}; Path=${ROOT}; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${options.secureCookie ? '; Secure' : ''}`;
  }
  app.addHook('onClose', async () => { await options.sessions.close(); buckets.clear(); });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    // Render's internal readiness probe is independent of account/browser data.
    if (['GET', 'HEAD'].includes(request.method) && request.routeOptions.url === '/healthz') return;
    const incoming = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    if (request.headers.host !== origin.host || (incoming !== undefined && !origins.has(incoming)) || (['POST', 'OPTIONS'].includes(request.method) && incoming === undefined) || (site !== undefined && !['same-origin', 'same-site', 'none'].includes(String(site)))) {
      return reply.code(403).send({ error: { code: 'ORIGIN_REQUIRED', message: '页面来源无效。' } });
    }
    if (options.devOrigin !== undefined && incoming === options.devOrigin) reply.header('Access-Control-Allow-Origin', incoming).header('Access-Control-Allow-Credentials', 'true').header('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      const requested = String(request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (!['GET', 'POST'].includes(String(request.headers['access-control-request-method'])) || requested.some(value => value !== 'content-type')) return reply.code(403).send({ error: { code: 'ORIGIN_REQUIRED', message: '页面来源无效。' } });
      return reply.header('Access-Control-Allow-Methods', 'GET, POST').header('Access-Control-Allow-Headers', 'Content-Type').code(204).send();
    }
    const path = request.routeOptions.url;
    if (path === `${ROOT}/connect`) limit(`connect:${request.ip}`, 10);
    else if (path?.startsWith(`${ROOT}/`)) {
      const id = sessionId(request);
      if (path === `${ROOT}/session` && (!id || !options.sessions.get(id))) limit(`status:${request.ip}`, 120);
      else { const user = requireSession(request); limit(`session:${user.id}`, 120); }
    }
  });
  app.setErrorHandler((caught, _request, reply) => {
    const error = caught as FastifyError;
    let code = 'UPSTREAM_FAILED'; let status = 502;
    if (error.validation) { code = 'INVALID_REQUEST'; status = 400; }
    else if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') { code = 'PAYLOAD_TOO_LARGE'; status = 413; }
    else if (error.statusCode === 415 || error.code === 'FST_ERR_CTP_INVALID_JSON_BODY') { code = 'INVALID_REQUEST'; status = error.statusCode === 415 ? 415 : 400; }
    else if (caught instanceof ApiError && publicCodes.has(caught.code)) { code = caught.code; status = caught.statusCode; }
    else {
      const safe = publicMcpError(caught).message;
      if (safe === 'MCP_UNAUTHORIZED') { code = safe; status = 401; }
      else if (safe === 'MCP_RATE_LIMITED') { code = safe; status = 429; }
      else if (safe === 'MCP_TIMEOUT') { code = safe; status = 504; }
    }
    return reply.code(status).send({ error: { code, message: status === 401 ? '请重新连接个人账号。' : status < 500 && status !== 429 ? '请求无效，请检查输入。' : '服务暂时不可用，请稍后重试。' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }));
  app.post<{ Body: { token: string } }>(`${ROOT}/connect`, {
    schema: { querystring: empty, body: { type: 'object', additionalProperties: false, required: ['token'], properties: { token: { type: 'string', minLength: 1, maxLength: 4096, pattern: '^[^\\s\\x00-\\x1f\\x7f]+$' } } } },
  }, async (request, reply) => {
    const old = sessionId(request);
    const user = await options.sessions.connect(request.body.token);
    user.assertActive();
    if (old) await options.sessions.disconnect(old);
    user.assertActive();
    reply.header('Set-Cookie', cookie(user.id, Math.max(1, Math.floor((user.expiresAt - Date.now()) / 1000))));
    return info(user);
  });
  app.get(`${ROOT}/session`, { schema: { querystring: empty } }, async request => {
    const id = sessionId(request); const user = id ? options.sessions.get(id) : undefined;
    return user ? info(user) : disconnected;
  });
  app.post(`${ROOT}/disconnect`, { schema: { querystring: empty, body: empty } }, async (request, reply) => {
    const user = requireSession(request);
    await options.sessions.disconnect(user.id);
    reply.header('Set-Cookie', cookie('', 0));
    return disconnected;
  });
  app.get<{ Querystring: { city: string; keyword: string } }>(`${ROOT}/stores`, {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['city', 'keyword'], properties: { city: text, keyword: text } } },
  }, async request => {
    const user = requireSession(request); user.assertActive();
    const result = await user.catalog.searchStores(request.query);
    user.assertActive(); return result;
  });
  app.get<{ Querystring: { storeId: string; diningMode: string } }>(`${ROOT}/catalog`, {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['storeId', 'diningMode'], properties: { storeId: text, diningMode: { type: 'string', enum: ['pickup'] } } } },
  }, async request => {
    const user = requireSession(request); user.assertActive();
    const result = await user.catalog.loadCatalog(request.query);
    user.assertActive(); return result;
  });
  return { app, requireSession };
}
