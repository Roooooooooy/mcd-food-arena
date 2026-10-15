import { randomBytes } from 'node:crypto';
import { ApiError } from '../app.ts';
import { createCatalogService, type CatalogService } from '../mcp/catalog.ts';
import { publicMcpError, type McpGateway } from '../mcp/gateway.ts';

export interface UserSession {
  id: string;
  expiresAt: number;
  catalog: CatalogService;
  gateway: () => Promise<McpGateway>;
  assertActive(): void;
}
export interface SessionManagerOptions {
  connect: (token: string) => Promise<McpGateway>;
  now?: () => number;
  ttlMs?: number;
  maxSessions?: number;
}
const TIMEOUT_MS = 15_000;

export function createSessionManager(options: SessionManagerOptions) {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
  const maxSessions = options.maxSessions ?? 64;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 30 * 60 * 1000 || !Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 64) throw new Error('INVALID_SESSION_CONFIG');
  const sessions = new Map<string, { user: UserSession; dispose: () => Promise<void>; timer: ReturnType<typeof setTimeout> }>();
  const pending = new Set<() => void>();
  const closing = new Set<Promise<void>>();
  let closed = false;
  const inactive = () => new ApiError('SESSION_REQUIRED', 401);

  function closeGateway(raw: McpGateway): Promise<void> {
    const operation = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([raw.close(), new Promise<void>(resolve => { timer = setTimeout(resolve, TIMEOUT_MS); timer.unref?.(); })]);
      } catch { /* No upstream messages or credentials cross the cleanup boundary. */ }
      finally { clearTimeout(timer); }
    })();
    closing.add(operation);
    void operation.finally(() => closing.delete(operation));
    return operation;
  }
  function remove(id: string): Promise<void> {
    const entry = sessions.get(id);
    if (!entry) return Promise.resolve();
    sessions.delete(id);
    clearTimeout(entry.timer);
    return entry.dispose();
  }
  function expire() {
    for (const [id, entry] of sessions) if (now() >= entry.user.expiresAt) void remove(id);
  }

  return {
    async connect(token: string): Promise<UserSession> {
      if (closed) throw inactive();
      if (typeof token !== 'string' || token.length < 1 || token.length > 4096 || /[\s\x00-\x1f\x7f]/.test(token)) throw new ApiError('INVALID_REQUEST', 400);
      expire();
      if (sessions.size + pending.size >= maxSessions) throw new ApiError('SESSION_CAPACITY', 503);
      let abandoned = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stop!: () => void;
      const stopped = new Promise<never>((_, reject) => { stop = () => reject(inactive()); });
      pending.add(stop);
      let raw: McpGateway | undefined;
      try {
        // The Token is used only as the SDK argument; it is never attached to a session.
        const operation = options.connect(token).then(connection => {
          if (abandoned || closed) { void closeGateway(connection); throw inactive(); }
          return connection;
        });
        raw = await Promise.race([operation, stopped, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MCP_TIMEOUT')), TIMEOUT_MS); })]);
        if (closed) { void closeGateway(raw); throw inactive(); }
        const id = randomBytes(32).toString('base64url');
        const expiresAt = now() + ttlMs;
        const connection = raw;
        const assertActive = () => {
          if (closed || !sessions.has(id) || now() >= expiresAt) { void remove(id); throw inactive(); }
        };
        const guarded: McpGateway = {
          listTools: async () => { assertActive(); const value = await connection.listTools(); assertActive(); return value; },
          call: async (name, args) => { assertActive(); const value = await connection.call(name, args); assertActive(); return value; },
          close: () => remove(id),
        };
        const gateway = async () => { assertActive(); return guarded; };
        const user: UserSession = { id, expiresAt, catalog: createCatalogService(gateway), gateway, assertActive };
        const expiryTimer = setTimeout(() => { expire(); }, ttlMs);
        expiryTimer.unref?.();
        sessions.set(id, { user, timer: expiryTimer, dispose: () => closeGateway(connection) });
        return user;
      } catch (error) {
        abandoned = true;
        throw error instanceof ApiError ? error : publicMcpError(error);
      } finally { clearTimeout(timer); pending.delete(stop); }
    },
    get(id: string): UserSession | undefined {
      expire();
      return sessions.get(id)?.user;
    },
    disconnect: remove,
    async close(): Promise<void> {
      closed = true;
      for (const stop of pending) stop();
      await Promise.all([...sessions.keys()].map(remove));
      await Promise.all(closing);
    },
  };
}
