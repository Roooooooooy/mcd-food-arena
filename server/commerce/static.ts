import { realpath, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在。' } });
function safePath(path: string) {
  return !path.includes('//') && !/[\\\x00-\x1f\x7f%]/.test(path) && !path.split('/').some(part => part.startsWith('.') || part === 'node_modules');
}

/** Only the immutable build directory is public. Realpath also bounds symlink targets. */
export function registerCommerceStatic(app: FastifyInstance, directory: string) {
  app.register(async instance => {
    let root: string;
    try {
      root = await realpath(directory);
      const index = await realpath(join(root, 'index.html'));
      if (relative(root, index) !== 'index.html' || !(await stat(index)).isFile()) throw new Error();
    } catch { throw new Error('COMMERCE_BUILD_MISSING'); }

    async function publicFile(path: string) {
      try {
        const file = await realpath(join(root, path));
        const bounded = relative(root, file);
        if (!bounded || bounded === '..' || bounded.startsWith(`..${sep}`) || !safePath(bounded.split(sep).join('/')) || !(await stat(file)).isFile()) return null;
        const contentType = types[extname(file).toLowerCase()];
        return contentType ? { body: await readFile(file), contentType } : null;
      } catch { return null; }
    }
    async function serve(request: FastifyRequest, reply: FastifyReply) {
      let path: string;
      try { path = decodeURIComponent(request.url.split('?')[0]); } catch { return notFound(reply); }
      if (!path.startsWith('/') || !safePath(path) || path === '/api' || path.startsWith('/api/')) return notFound(reply);
      const target = path === '/' ? 'index.html' : path.slice(1);
      let file = await publicFile(target);
      if (!file && extname(path) === '' && !/^\/(assets|demo)(\/|$)/.test(path) && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document' && String(request.headers.accept ?? '').includes('text/html')) file = await publicFile('index.html');
      if (!file) return notFound(reply);
      const immutable = path.startsWith('/assets/') || /^\/demo\/images\/[a-f0-9]{64}\./.test(path);
      reply.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
      return reply.type(file.contentType).send(file.body);
    }
    instance.get('/', serve);
    instance.get('/*', serve);
  });
}
