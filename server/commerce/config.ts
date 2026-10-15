export function readCommerceConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawPort = env.PORT ?? '8788';
  if (!/^[1-9]\d*$/.test(rawPort) || Number(rawPort) > 65535) throw new Error('INVALID_PORT');
  const port = Number(rawPort);
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('INVALID_HOST');
  const origin = env.PUBLIC_ORIGIN ?? env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${port}`;
  let url: URL;
  try { url = new URL(origin); } catch { throw new Error('INVALID_PUBLIC_ORIGIN'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !loopback)) throw new Error('INVALID_PUBLIC_ORIGIN');
  if (host === '0.0.0.0' && (url.protocol !== 'https:' || loopback)) throw new Error('PUBLIC_ORIGIN_REQUIRED');
  if (env.PUBLIC_ORIGIN === undefined && env.RENDER_EXTERNAL_URL !== undefined && url.protocol !== 'https:') throw new Error('INVALID_PUBLIC_ORIGIN');
  return { host, port, origin, secureCookie: url.protocol === 'https:' };
}
