import { pathToFileURL } from 'node:url';
import { createApp } from './app.ts';
import type { ApiServices } from './app.ts';
import { createGateway } from './mcp/gateway.ts';
import type { McpGateway } from './mcp/gateway.ts';
import { createCatalogService } from './mcp/catalog.ts';
import { createQuoteService } from './mcp/quote.ts';

export function createRuntimeServices(connect: () => Promise<McpGateway> = () => createGateway(process.env.MCD_MCP_TOKEN ?? '')) {
  let connection: Promise<McpGateway> | undefined;
  const getGateway = () => {
    connection ??= connect().catch(error => { connection = undefined; throw error; });
    return connection;
  };
  const catalog = createCatalogService(getGateway);
  const quote = createQuoteService(catalog, getGateway);
  const services: ApiServices = {
    stores: input => catalog.searchStores(input),
    catalog: input => catalog.loadCatalog(input),
    quote: input => quote.quoteBasket(input),
    selection: input => quote.selection(input),
  };
  return { services, catalog, close: async () => { if (connection) { try { await (await connection).close(); } catch { /* Stable public errors are handled at the API boundary. */ } } } };
}

export async function startServer(services: ApiServices, onClose?: () => Promise<void>) {
  const app = createApp(services);
  if (onClose) app.addHook('onClose', onClose);
  await app.listen({ host: '127.0.0.1', port: 8787 });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().then(() => { process.exitCode = 0; }); });
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runtime = createRuntimeServices();
  try {
    await startServer(runtime.services, runtime.close);
    console.log('Local API listening at http://127.0.0.1:8787');
  } catch {
    console.error('LOCAL_API_START_FAILED');
    process.exitCode = 1;
  }
}
