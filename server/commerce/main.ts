import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGateway, READ_TOOLS } from '../mcp/gateway.ts';
import { createCommerceApp } from './app.ts';
import { registerCommerceRoutes } from './routes.ts';
import { createSessionManager, type SessionManagerOptions } from './session.ts';
import { readCommerceConfig } from './config.ts';
import { registerCommerceStatic } from './static.ts';

export const COMMERCE_TOOLS = [...READ_TOOLS, 'query-my-coupons', 'query-store-coupons', 'create-order', 'query-order'] as const;

export function createCommerceRuntime(options: {
  origin?: string;
  devOrigin?: string;
  secureCookie?: boolean;
  connect?: SessionManagerOptions['connect'];
  staticDir?: string;
} = {}) {
  const origin = options.origin ?? 'http://127.0.0.1:8788';
  const sessions = createSessionManager({ connect: options.connect ?? (token => createGateway(token, { allowedTools: COMMERCE_TOOLS })) });
  const runtime = createCommerceApp({ sessions, origin, devOrigin: options.devOrigin ?? (new URL(origin).hostname === '127.0.0.1' ? 'http://127.0.0.1:5173' : undefined), secureCookie: options.secureCookie ?? origin.startsWith('https://') });
  registerCommerceRoutes(runtime.app, runtime.requireSession);
  runtime.app.get('/healthz', async () => ({ status: 'ok' }));
  if (options.staticDir !== undefined) registerCommerceStatic(runtime.app, options.staticDir);
  return { ...runtime, sessions };
}

export async function startCommerceServer(options: Parameters<typeof createCommerceRuntime>[0] & { host?: string; port?: number } = {}) {
  const runtime = createCommerceRuntime(options);
  const shutdown = () => { void runtime.app.close(); };
  runtime.app.addHook('onClose', async () => { for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeListener(signal, shutdown); });
  try { await runtime.app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 8788 }); }
  catch (error) { await runtime.app.close(); throw error; }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, shutdown);
  return runtime;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = readCommerceConfig();
    await startCommerceServer({ ...config, staticDir: fileURLToPath(new URL('../../dist/', import.meta.url)) });
    console.log(`Personal commerce app listening on ${config.host}:${config.port}`);
  } catch { console.error('COMMERCE_API_START_FAILED'); process.exitCode = 1; }
}
