import test from 'node:test';
import assert from 'node:assert/strict';
import { guardGateway } from '../server/mcp/gateway.ts';

const schema = { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false };
const tools = [{ name: 'query-nearby-stores', inputSchema: schema }];

test('financial and account write tools are denied before any SDK request', async () => {
  let sdkCalls = 0;
  const gateway = guardGateway({ listTools: async () => { sdkCalls++; return tools; }, call: async () => { sdkCalls++; return {}; }, close: async () => {} });
  for (const name of ['create-order', 'pay', 'bind-coupon', 'use-points', 'lottery', 'unknown-tool']) {
    await assert.rejects(() => gateway.call(name, {}), /TOOL_NOT_ALLOWED/);
  }
  assert.equal(sdkCalls, 0);
});

test('runtime schema rejects missing, extra and wrong-type arguments before call', async () => {
  let sdkCalls = 0;
  const gateway = guardGateway({ listTools: async () => tools, call: async () => { sdkCalls++; return { structuredContent: { stores: [] } }; }, close: async () => {} });
  for (const args of [{}, { city: 3 }, { city: '杭州', token: 'secret' }]) {
    await assert.rejects(() => gateway.call('query-nearby-stores', args), /INVALID_TOOL_ARGUMENTS/);
  }
  assert.equal(sdkCalls, 0);
  assert.deepEqual(await gateway.call('query-nearby-stores', { city: '杭州' }), { stores: [] });
});

test('upstream failures never expose headers, tokens or private response', async () => {
  for (const failure of [new Error('HTTP 401 Authorization Bearer confidential-token user=private-account'), new Error('HTTP 429 confidential-token'), new Error('timeout confidential-token')]) {
    const gateway = guardGateway({ listTools: async () => tools, call: async () => { throw failure; }, close: async () => {} });
    await assert.rejects(() => gateway.call('query-nearby-stores', { city: '杭州' }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^MCP_(UNAUTHORIZED|RATE_LIMITED|TIMEOUT)$/);
      assert.doesNotMatch(JSON.stringify(error) + error.message, /confidential|Authorization|private-account/);
      return true;
    });
  }
});

test('tool error envelopes are rejected and JSON text content is decoded', async () => {
  const failed = guardGateway({ listTools: async () => tools, call: async () => ({ isError: true, content: [{ type: 'text', text: 'private detail' }] }), close: async () => {} });
  await assert.rejects(() => failed.call('query-nearby-stores', { city: '杭州' }), /^Error: MCP_TOOL_FAILED$/);
  const successful = guardGateway({ listTools: async () => tools, call: async () => ({ content: [{ type: 'text', text: '{"stores":[]}' }] }), close: async () => {} });
  assert.deepEqual(await successful.call('query-nearby-stores', { city: '杭州' }), { stores: [] });
});

test('structured business failure does not masquerade as a successful result', async () => {
  const gateway = guardGateway({ listTools: async () => tools, call: async () => ({ structuredContent: { success: false, code: 500, message: 'Bearer confidential-token' } }), close: async () => {} });
  await assert.rejects(() => gateway.call('query-nearby-stores', { city: '杭州' }), /^Error: MCP_TOOL_FAILED$/);
});

test('malformed structured result is rejected instead of exposing an upstream string', async () => {
  const gateway = guardGateway({ listTools: async () => tools, call: async () => ({ structuredContent: 'confidential-token' }), close: async () => {} });
  await assert.rejects(() => gateway.call('query-nearby-stores', { city: '杭州' }), /^Error: MCP_INVALID_RESPONSE$/);
});
