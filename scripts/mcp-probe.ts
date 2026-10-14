import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createGateway, publicMcpError } from '../server/mcp/gateway.ts';
import type { McpGateway } from '../server/mcp/gateway.ts';

const { values } = parseArgs({ options: { city: { type: 'string', default: '杭州' }, keyword: { type: 'string', default: '凤起路' } }, strict: true });
let gateway: McpGateway | undefined;
try {
  gateway = await createGateway(process.env.MCD_MCP_TOKEN ?? '');
  const tools = await gateway.listTools();
  await mkdir('.private', { recursive: true, mode: 0o700 });
  await writeFile('.private/probe-tools-schema.json', JSON.stringify(tools, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ status: 'handshake-ok', tools }, null, 2));
  const tool = tools.find(tool => tool.name === 'query-nearby-stores');
  const schema = tool?.inputSchema as { properties?: Record<string, { enum?: unknown[] }> } | undefined;
  // These meanings were verified from this run's schema descriptions: 1=self pickup, 2=location search.
  if (!schema?.properties?.beType?.enum?.includes(1) || !schema.properties.searchType?.enum?.includes(2) || !schema.properties.city || !schema.properties.keyword) throw new Error('MCP_INVALID_SCHEMA');
  const response = await gateway.call('query-nearby-stores', { beType: 1, searchType: 2, city: values.city, keyword: values.keyword });
  if (!response || typeof response !== 'object' || !('data' in response) || !Array.isArray(response.data)) throw new Error('MCP_INVALID_RESPONSE');
  // Keep only public store identity/address/channel evidence. Never write account, trace or header data.
  const stores = response.data.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('MCP_INVALID_RESPONSE');
    const store = item as Record<string, unknown>;
    if (typeof store.storeCode !== 'string' || typeof store.storeName !== 'string' || typeof store.address !== 'string') throw new Error('MCP_INVALID_RESPONSE');
    return { storeId: store.storeCode, name: store.storeName, address: store.address, channels: [{ beType: 1, name: '到店自提', verifiedBy: 'query-nearby-stores(beType=1)' }], ...(typeof store.businessStatus === 'boolean' ? { open: store.businessStatus } : {}) };
  });
  const evidence = { city: values.city, keyword: values.keyword, returnedStoreFields: response.data.length ? Object.keys(response.data[0]) : [], selectionRequired: stores.length !== 1, stores };
  await writeFile('.private/probe-store-fixture.json', JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(publicMcpError(error).message);
  process.exitCode = 1;
} finally {
  try { await gateway?.close(); } catch (error) { console.error(publicMcpError(error).message); process.exitCode = 1; }
}
