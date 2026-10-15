import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpGateway {
  listTools(): Promise<{ name: string; inputSchema: object }[]>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export const READ_TOOLS = ['query-nearby-stores', 'query-meals', 'query-meal-detail', 'list-nutrition-foods', 'calculate-price', 'now-time-info'] as const;
export interface GatewayOptions { allowedTools?: readonly string[] }
const TIMEOUT_MS = 15_000;
const knownCodes = new Set(['TOOL_NOT_ALLOWED', 'TOOL_NOT_AVAILABLE', 'INVALID_TOOL_ARGUMENTS', 'MCP_INVALID_SCHEMA', 'MCP_INVALID_RESPONSE', 'MCP_TOOL_FAILED', 'MCP_UNAUTHORIZED', 'MCP_RATE_LIMITED', 'MCP_TIMEOUT', 'MCP_UNAVAILABLE', 'MCP_TOKEN_MISSING']);

// Only stable public codes cross this boundary; upstream messages and causes never do.
export function publicMcpError(error: unknown): Error {
  const message = error instanceof Error ? error.message : '';
  if (knownCodes.has(message)) return new Error(message);
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (/\b401\b/.test(message + code)) return new Error('MCP_UNAUTHORIZED');
  if (/\b429\b/.test(message + code)) return new Error('MCP_RATE_LIMITED');
  if (/timeout|timed out|abort/i.test(message) || code === '-32001') return new Error('MCP_TIMEOUT');
  return new Error('MCP_UNAVAILABLE');
}

async function bounded<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MCP_TIMEOUT')), TIMEOUT_MS); })]);
  } catch (error) {
    throw publicMcpError(error);
  } finally {
    clearTimeout(timer);
  }
}

function checkBusinessResult(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('MCP_INVALID_RESPONSE');
  if (value && typeof value === 'object' && 'success' in value && value.success === false) throw new Error('MCP_TOOL_FAILED');
  return value;
}

function decodeResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('MCP_INVALID_RESPONSE');
  const envelope = result as Record<string, unknown>;
  if (envelope.isError === true) throw new Error('MCP_TOOL_FAILED');
  if (envelope.structuredContent !== undefined) return checkBusinessResult(envelope.structuredContent);
  if (Array.isArray(envelope.content)) {
    const chunks = envelope.content.filter((part): part is { type: 'text'; text: string } => !!part && part.type === 'text' && typeof part.text === 'string');
    if (!chunks.length) throw new Error('MCP_INVALID_RESPONSE');
    let parsed: unknown;
    try { parsed = JSON.parse(chunks.map(part => part.text).join('\n')); }
    catch { throw new Error('MCP_INVALID_RESPONSE'); }
    return checkBusinessResult(parsed);
  }
  return checkBusinessResult(result);
}

export function guardGateway(raw: McpGateway, options: GatewayOptions = {}): McpGateway {
  const allowed = new Set<string>(options.allowedTools ?? READ_TOOLS);
  const ajv = new Ajv({ strict: false, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
  let catalog: Promise<{ tools: { name: string; inputSchema: object }[]; validators: Map<string, ValidateFunction> }> | undefined;
  function loadCatalog() {
    catalog ??= bounded(async () => {
      const tools = (await raw.listTools()).filter(tool => allowed.has(tool.name));
      const validators = new Map<string, ValidateFunction>();
      try { for (const tool of tools) validators.set(tool.name, ajv.compile(tool.inputSchema)); }
      catch { throw new Error('MCP_INVALID_SCHEMA'); }
      return { tools, validators };
    });
    return catalog;
  }
  return {
    listTools: async () => (await loadCatalog()).tools,
    call: async (name, args) => {
      // Deny before even tools/list: fake and real transports share this boundary.
      if (!allowed.has(name)) throw new Error('TOOL_NOT_ALLOWED');
      const validate = (await loadCatalog()).validators.get(name);
      if (!validate) throw new Error('TOOL_NOT_AVAILABLE');
      if (!validate(args)) throw new Error('INVALID_TOOL_ARGUMENTS');
      return bounded(async () => decodeResult(await raw.call(name, args)));
    },
    close: async () => { await bounded(() => raw.close()); },
  };
}

export async function createGateway(token: string, options: GatewayOptions = {}): Promise<McpGateway> {
  if (!token.trim()) throw new Error('MCP_TOKEN_MISSING');
  const client = new Client({ name: 'mcd-food-arena', version: '0.1.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.mcd.cn'), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (url, init) => fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) }),
  });
  try {
    await bounded(() => client.connect(transport));
    const gateway = guardGateway({
      listTools: async () => {
        const all: { name: string; inputSchema: object }[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        do {
          const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: TIMEOUT_MS, maxTotalTimeout: TIMEOUT_MS });
          all.push(...page.tools);
          cursor = page.nextCursor;
          if (cursor && seen.has(cursor)) throw new Error('MCP_INVALID_RESPONSE');
          if (cursor) seen.add(cursor);
        } while (cursor);
        return all;
      },
      call: (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: TIMEOUT_MS, maxTotalTimeout: TIMEOUT_MS }),
      close: () => client.close(),
    }, options);
    await gateway.listTools();
    return gateway;
  } catch (error) {
    try { await bounded(() => client.close()); } catch { /* no upstream data is logged */ }
    throw publicMcpError(error);
  }
}
