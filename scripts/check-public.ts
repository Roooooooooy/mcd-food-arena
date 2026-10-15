import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs, parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const SOURCE_FILES: string[] = [
  "docs/commerce-deployment.md",
  "docs/commerce-verification.md",
  "docs/motion-a-verification.md",
  "render.yaml",
  "server/commerce/app.ts",
  "server/commerce/availability.ts",
  "server/commerce/checkout.ts",
  "server/commerce/config.ts",
  "server/commerce/coupons.ts",
  "server/commerce/main.ts",
  "server/commerce/routes.ts",
  "server/commerce/session.ts",
  "server/commerce/static.ts",
  "src/commerce/AccountPanel.tsx",
  "src/commerce/AvailabilityNotice.tsx",
  "src/commerce/CheckoutPanel.tsx",
  "src/commerce/CouponDetails.tsx",
  "src/commerce/api.ts",
  "src/commerce/availability-contracts.ts",
  "src/commerce/contracts.ts",
  "src/commerce/state.ts",
  "src/coupons/CouponRecommendations.tsx",
  "src/coupons/recommend.ts",
  "tests/availability-lifecycle.test.ts",
  "tests/availability-ui.test.ts",
  "tests/commerce-availability.test.ts",
  "tests/commerce-checkout.test.ts",
  "tests/commerce-client.test.ts",
  "tests/commerce-coupons.test.ts",
  "tests/commerce-deployment.test.ts",
  "tests/commerce-fixture.ts",
  "tests/commerce-http.test.ts",
  "tests/commerce-session.test.ts",
  "tests/commerce-ui.test.ts",
  "tests/coupon-recommend.test.ts",
  "tests/fixtures/menu-options.json",
  "tests/menu-options-ui.test.ts",
  "tests/menu-options-service.test.ts",
  "tests/menu-options.test.ts",
  "tests/capture-input.test.ts",
  "src/catalog/option-metadata.ts",
  "src/cart/OptionsEditor.tsx",
  "src/cart/options.ts",
  "scripts/capture-input.ts",
  "docs/menu-options-verification.md",
  ".env.example",
  ".github/workflows/deploy-pages.yml",
  ".gitignore",
  "CONTEST_DECLARATION.md",
  "MCP_INTEGRATION.md",
  "README.md",
  "docs/demo.md",
  "docs/drag-order-verification.md",
  "docs/live-verification.md",
  "docs/mcd-meme-sources.md",
  "docs/mcp-contract.md",
  "docs/public-files.md",
  "docs/submission-readiness.md",
  "docs/submission.md",
  "docs/ui-verification.md",
  "index.html",
  "mcp-config.example.json",
  "package-lock.json",
  "package.json",
  "scripts/capture-demo.ts",
  "scripts/check-public.ts",
  "scripts/demo-images.ts",
  "scripts/dev.ts",
  "scripts/mcp-probe.ts",
  "server/app.ts",
  "server/main.ts",
  "server/mcp/catalog.ts",
  "server/mcp/gateway.ts",
  "server/mcp/quote.ts",
  "src/App.tsx",
  "src/api.ts",
  "src/arena/ArenaPage.tsx",
  "src/arena/CoinDecision.tsx",
  "src/arena/FoodArt.tsx",
  "src/arena/coin-timing.ts",
  "src/arena/engine.ts",
  "src/cart/CartPage.tsx",
  "src/cart/model.ts",
  "src/catalog/CandidateDetails.tsx",
  "src/catalog/filter.ts",
  "src/catalog/normalize.ts",
  "src/catalog/source.ts",
  "src/copy/MemeSources.tsx",
  "src/copy/memes.ts",
  "src/demo/menu.ts",
  "src/demo/snapshot.ts",
  "src/main.tsx",
  "src/setup/SetupPage.tsx",
  "src/setup/StageLineup.tsx",
  "src/setup/stage-order.ts",
  "src/setup/StorePicker.tsx",
  "src/setup/session.ts",
  "src/shared/contracts.ts",
  "src/styles.css",
  "src/ui.css",
  "tests/arena.test.ts",
  "tests/cart.test.ts",
  "tests/catalog-context.test.ts",
  "tests/catalog-service.test.ts",
  "tests/catalog.test.ts",
  "tests/coin.test.ts",
  "tests/demo.test.ts",
  "tests/dev.test.ts",
  "tests/fixtures/catalog-details.json",
  "tests/fixtures/catalog.json",
  "tests/fixtures/quote.json",
  "tests/http.test.ts",
  "tests/mcp.test.ts",
  "tests/public.test.ts",
  "tests/quote.test.ts",
  "tests/session.test.ts",
  "tests/snapshot.test.ts",
  "tests/stage-order.test.ts",
  "tsconfig.json",
  "vite.config.ts"
];
const SCREENSHOTS = new Set([
  'docs/screenshots/demo-home-current.png', 'docs/screenshots/demo-pk-current.png',
  'docs/screenshots/menu-customization-mobile.png',
  'docs/screenshots/menu-customization.png',
  'docs/screenshots/pie-flavors-mobile.png',
  'docs/screenshots/pie-flavors.png',
  'docs/screenshots/drag-order-desktop.png', 'docs/screenshots/drag-order-mobile.png',
  'docs/screenshots/drag-order-preview.png', 'docs/screenshots/drag-order-published.png',
  'docs/screenshots/meme-list-removed-published.png', 'docs/screenshots/task7-public-mobile.png',
  'docs/screenshots/task6-live-menu-desktop.png', 'docs/screenshots/task6-live-match-desktop.png',
  'docs/screenshots/task6-live-result-desktop.png', 'docs/screenshots/task6-live-result-mobile.png',
]);
const DECLARATION_SHA256 = 'cd28101bcb29cc8fb24b372fe91ce6b42c4a1487a54e01f7ade0c8c6a84241b7';
const PLACEHOLDER = 'Bearer ${MCD_MCP_TOKEN}';
const config = { mcpServers: { 'mcd-mcp': { type: 'streamablehttp', url: 'https://mcp.mcd.cn', headers: { Authorization: PLACEHOLDER } } } };
export interface PublicIssue { file: string; line: number; reason: string }
interface PublicFile { path: string; bytes: number; sha256: string; content: Buffer }
export interface PublicCheck { issues: PublicIssue[]; files: PublicFile[]; localCredentialLoaded: boolean }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const formatIssue = (issue: PublicIssue) => `${issue.file.replace(/[\r\n]/g, '_')}:${issue.line}: ${issue.reason}`;
const isCode = (file: string) => /\.(?:ts|tsx|js|css)$/.test(file);

// Never attach matched values to an issue or throw an error containing input bytes.
export function scanContent(file: string, bytes: Buffer, credentials: string[]): PublicIssue[] {
  const text = bytes.toString('utf8'), issues: PublicIssue[] = [];
  const add = (index: number, reason: string) => {
    const line = text.slice(0, index).split('\n').length;
    if (!issues.some(issue => issue.line === line && issue.reason === reason)) issues.push({ file, line, reason });
  };
  for (const credential of credentials) {
    if (!credential) continue;
    const forms = new Set([credential, Buffer.from(credential).toString('base64'), Buffer.from(credential).toString('base64url'),
      encodeURIComponent(credential), JSON.stringify(credential).slice(1, -1),
      [...credential].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('')]);
    for (const value of forms) {
      let index = text.indexOf(value);
      while (index !== -1) { add(index, 'local credential found (literal or common encoding)'); index = text.indexOf(value, index + value.length); }
    }
  }
  for (const expression of [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]) {
    for (const match of text.matchAll(expression)) add(match.index!, 'credential-shaped value');
  }
  for (const match of text.matchAll(/(?:["']?Authorization["']?\s*[:=]\s*)(["'`])([^"'`\r\n]*)\1/gi)) {
    const value = match[2];
    const runtime = file === 'server/mcp/gateway.ts' && match[1] === '`' && value === 'Bearer ${token}';
    if (value !== PLACEHOLDER && !runtime) add(match.index!, 'literal authorization credential');
  }
  for (const match of text.matchAll(/\bMCD_MCP_TOKEN["']?\s*[:=]\s*(["'`])([^"'`\r\n\s]+)\1/g)) {
    if (match[2] !== '${MCD_MCP_TOKEN}') add(match.index!, 'credential assignment');
  }
  if (!isCode(file)) {
    for (const match of text.matchAll(/\bBearer[ \t]+([^\s"'`<>]+)/g)) {
      if (match[1] !== '${MCD_MCP_TOKEN}') add(match.index!, 'literal authorization credential');
    }
    for (const match of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) add(match.index!, 'email address requires removal from public material');
    for (const match of text.matchAll(/(?:MCD_MCP_TOKEN|API_KEY|ACCESS_TOKEN|PASSWORD)\s*[=:]\s*["']?([^\s"']+)/gi)) {
      if (!match[1].startsWith('${')) add(match.index!, 'credential assignment');
    }
    for (const match of text.matchAll(/(?:^|\n)[ \t]*(?:Cookie|Set-Cookie|X-Api-Key)\s*:\s*\S+/gi)) add(match.index!, 'raw authentication header');
  }
  // Structured public datasets must not retain account-derived or raw envelope fields.
  if (/^(?:public\/demo|dist\/demo|tests\/fixtures)\/.*\.json$/.test(file)) {
    try {
      const walk = (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (/^(?:authorization|cookie|headers?|token|apiKey|email|phone|mobile|account(?:Id)?|userId|frequent|traceId|requestId)$/i.test(key)) {
            const index = text.indexOf(JSON.stringify(key)); add(Math.max(index, 0), 'private field in public dataset');
          }
          walk(child);
        }
      };
      walk(JSON.parse(text));
    } catch { add(0, 'invalid public JSON'); }
  }
  return issues;
}

// Local research is retained beside plans, but is not part of the public package.
const LOCAL_RESEARCH = new Set([
  "docs/2026-10-15-availability-research.md",
  "docs/2026-10-15-coupons-order-research.md",
  "docs/2026-10-15-free-hosting-research.md",
  "docs/2026-10-15-meme-motion-research.md"
]);
const ignored = (path: string) => {
  if (LOCAL_RESEARCH.has(path)) return true;
  const first = path.split('/')[0];
  if (['.git', 'node_modules', '.private', '.superpowers'].includes(first)) return true;
  if (/^\.env(?:\.|$)/.test(first) && path !== '.env.example') return true;
  return path === '.DS_Store' || path.endsWith('/.DS_Store') || path === 'docs/progress.md' ||
    path === 'docs/verification-tasks-1-2.md' || path === 'docs/superpowers' || path.startsWith('docs/superpowers/') ||
    (path.startsWith('docs/screenshots/') && !SCREENSHOTS.has(path));
};
async function inventory(root: string, issues: PublicIssue[]) {
  const bytes = new Map<string, Buffer>();
  async function walk(path: string) {
    if (ignored(path)) return;
    const absolute = resolve(root, path);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) { issues.push({ file: path, line: 1, reason: 'symbolic links are not public files' }); return; }
    if (stat.isDirectory()) {
      for (const name of await readdir(absolute)) await walk(path ? `${path}/${name}` : name);
    } else if (stat.isFile()) {
      if (stat.size > 20 * 1024 * 1024) { issues.push({ file: path, line: 1, reason: 'public file exceeds size limit' }); return; }
      bytes.set(path, await readFile(absolute));
    } else issues.push({ file: path, line: 1, reason: 'special files cannot be public' });
  }
  await walk('');
  return bytes;
}

export async function checkPublic(root: string, options: { ci: boolean }): Promise<PublicCheck> {
  root = resolve(root);
  const issues: PublicIssue[] = [], credentials: string[] = [];
  const issue = (file: string, reason: string) => issues.push({ file, line: 1, reason });
  if (!options.ci) {
    const envPath = resolve(root, '.env.local');
    try {
      const stat = await lstat(envPath);
      if (!stat.isFile() || stat.isSymbolicLink()) issue('.env.local', 'private environment must be a regular file');
      else if (stat.size > 64 * 1024) issue('.env.local', 'private environment exceeds size limit');
      else {
        const token = parseEnv(await readFile(envPath, 'utf8')).MCD_MCP_TOKEN?.trim();
        if (token) credentials.push(token);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issue('.env.local', 'private environment could not be read'); }
  }
  const bytes = await inventory(root, issues);
  const allow = new Set([...SOURCE_FILES, ...SCREENSHOTS]);
  const json = (file: string): any => {
    try { return JSON.parse(bytes.get(file)?.toString('utf8') ?? ''); }
    catch { issue(file, 'required JSON is missing or invalid'); return undefined; }
  };
  const imagePaths = new Set<string>();
  const manifestPath = 'public/demo/manifest.json', catalogPath = 'public/demo/catalog.json';
  allow.add(manifestPath); allow.add(catalogPath);
  const manifest = json(manifestPath), catalog = json(catalogPath);
  let validManifest = !!manifest && Array.isArray(manifest.images) && manifest.images.length > 0;
  if (validManifest) {
    for (const image of manifest.images) {
      let validUrl = false;
      try { const url = new URL(image.sourceUrl); validUrl = url.protocol === 'https:' && url.hostname === 'menu-img.mcd.cn' && !url.username && !url.password && !url.search && !url.hash; } catch { /* invalid URL */ }
      if (!validUrl || (image.path !== null && !/^demo\/images\/[0-9a-f]{64}\.(?:png|gif|jpg|webp)$/.test(image.path))) { validManifest = false; continue; }
      if (image.path !== null) imagePaths.add(`public/${image.path}`);
    }
    if (manifest.imageUrls !== manifest.images.length || manifest.imageFiles !== imagePaths.size || manifest.failedImages !== manifest.images.filter((entry: any) => entry.path === null).length) validManifest = false;
  }
  if (!validManifest) issue(manifestPath, 'invalid image manifest');
  let imageBytes = 0;
  for (const path of imagePaths) {
    allow.add(path);
    const content = bytes.get(path);
    if (!content || digest(content) !== path.split('/').at(-1)!.split('.')[0]) issue(path, 'snapshot image is missing or its content hash differs');
    else imageBytes += content.length;
  }
  if (manifest && manifest.imageBytes !== imageBytes) issue(manifestPath, 'image byte count differs from manifest');
  if (!catalog || catalog.mode !== 'demo' || catalog.sourceKind !== 'official-snapshot' || catalog.complete !== true || !Array.isArray(catalog.items) || !catalog.items.length || !catalog.capturedAt || catalog.capturedAt !== manifest?.capturedAt) issue(catalogPath, 'snapshot source or completeness is missing');
  if (Array.isArray(catalog?.items)) for (const item of catalog.items) {
    for (const image of [item.imageUrl, ...(item.variants ?? []).map((variant: any) => variant.imageUrl)]) {
      if (image !== null && image !== undefined && !imagePaths.has(`public/${image}`)) issue(catalogPath, 'snapshot image is not in the image manifest');
    }
  }

  // Static output is limited to the entry's own Vite assets and byte-identical demo assets.
  const entry = bytes.get('dist/index.html')?.toString('utf8');
  if (!entry) issue('dist/index.html', 'production build is required');
  else {
    allow.add('dist/index.html');
    const assets = new Set([...entry.matchAll(/(?:src|href)=["'](?:\/mcd-food-arena\/|\/|\.\/)?assets\/(index-[A-Za-z0-9_-]+\.(?:js|css))["']/g)].map(match => `dist/assets/${match[1]}`));
    if (![...assets].some(path => path.endsWith('.js'))) issue('dist/index.html', 'expected Vite entry is missing');
    for (const path of assets) { allow.add(path); if (!bytes.has(path)) issue(path, 'referenced build asset is missing'); }
    for (const publicPath of [manifestPath, catalogPath, ...imagePaths]) {
      const path = publicPath.replace(/^public\//, 'dist/'); allow.add(path);
      if (!bytes.get(path)?.equals(bytes.get(publicPath) ?? Buffer.alloc(0))) issue(path, 'dist snapshot differs from its public source');
    }
  }
  for (const path of SOURCE_FILES) if (!bytes.has(path)) issue(path, 'required public file is missing');
  for (const [path, content] of bytes) {
    if (!allow.has(path)) issue(path, 'file is not in the public allowlist');
    issues.push(...scanContent(path, content, credentials));
    if (allow.has(path) && path.endsWith('.md')) {
      for (const link of content.toString('utf8').matchAll(/\]\(([^)]+)\)/g)) {
        const target = link[1].replace(/^<|>$/g, '').split('#')[0];
        if (!target || /^https?:\/\//.test(target)) continue;
        const resolved = relative(root, resolve(root, dirname(path), target)).split(sep).join('/');
        if (!allow.has(resolved) || !bytes.has(resolved)) issue(path, 'local link target is not an included public file');
      }
    }
  }
  if (digest(bytes.get('CONTEST_DECLARATION.md') ?? Buffer.alloc(0)) !== DECLARATION_SHA256) issue('CONTEST_DECLARATION.md', 'declaration differs from pinned official bytes');
  if (!options.ci) {
    try {
      const originalPath = resolve(root, '.private/task7-official/CONTEST_DECLARATION.md');
      const stat = await lstat(originalPath);
      if (!stat.isFile() || stat.isSymbolicLink() || !(await readFile(originalPath)).equals(bytes.get('CONTEST_DECLARATION.md') ?? Buffer.alloc(0))) issue('CONTEST_DECLARATION.md', 'declaration differs from downloaded official original');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') issue('CONTEST_DECLARATION.md', 'official original could not be compared'); }
  }
  const canonical = (value: any): any => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const normalized = (value: unknown) => JSON.stringify(canonical(value));
  if (normalized(json('mcp-config.example.json')) !== normalized(config)) issue('mcp-config.example.json', 'MCP example must match the environment-only schema');
  if (bytes.get('.env.example')?.toString('utf8') !== 'MCD_MCP_TOKEN=\n') issue('.env.example', 'environment example must contain an empty credential');
  const submission = bytes.get('docs/submission.md')?.toString('utf8').trimEnd().split('\n') ?? [];
  if (submission.length !== 4 || submission[0] !== '【参赛申请】' || submission[1] !== '项目名称：麦麦二选一' || submission[2] !== '项目地址：https://github.com/Roooooooooy/mcd-food-arena' || !submission[3]?.startsWith('项目简介：') || /守擂|胜者对|样例试玩/.test(submission[3] ?? '') || !submission[3]?.includes('快照') || !submission[3]?.includes('本地')) issue('docs/submission.md', 'submission must use the official four-line format and current product rules');
  const readme = bytes.get('README.md')?.toString('utf8') ?? '';
  for (const required of ['# 麦麦二选一', 'N−1', 'npm', '127.0.0.1:5173', '快照', '官方整单', 'docs/screenshots/', '用户']) if (!readme.includes(required)) issue('README.md', 'README is missing required product or setup information');
  const integration = bytes.get('MCP_INTEGRATION.md')?.toString('utf8') ?? '';
  for (const required of ['https://mcp.mcd.cn', 'query-meals', 'calculate-price', 'Menu', 'PK', 'Basket']) if (!integration.includes(required)) issue('MCP_INTEGRATION.md', 'integration is missing actual tool flow');
  if (!(bytes.get('docs/demo.md')?.toString('utf8') ?? '').includes('menu-img.mcd.cn')) issue('docs/demo.md', 'official image provenance is required');
  if (json('package.json')?.scripts?.['check:public'] !== 'node scripts/check-public.ts') issue('package.json', 'check:public script is required');
  const files = [...bytes].filter(([path]) => allow.has(path)).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({ path, bytes: content.length, sha256: digest(content), content }));
  return { issues, files, localCredentialLoaded: credentials.length > 0 };
}

async function safeOutput(root: string, path: string) {
  if (!/^\.private\/release\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path)) throw new Error('INVALID_RELEASE_OUTPUT');
  const absolute = resolve(root, path);
  if (!relative(resolve(root, '.private/release'), absolute) || relative(root, absolute).startsWith(`..${sep}`)) throw new Error('INVALID_RELEASE_OUTPUT');
  let parent = root;
  for (const part of ['.private', 'release']) {
    parent = resolve(parent, part);
    try { const stat = await lstat(parent); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('INVALID_RELEASE_OUTPUT'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') await mkdir(parent, { mode: 0o700 }); else throw error; }
  }
  try { await lstat(absolute); throw new Error('RELEASE_OUTPUT_EXISTS'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return absolute;
}

export async function publishChecked(root: string, checked: PublicCheck, outputs: { manifest?: string; package?: string }) {
  if (checked.issues.length) throw new Error('PUBLIC_CHECK_FAILED');
  const destination = outputs.package ? await safeOutput(root, outputs.package) : undefined;
  const manifestDestination = outputs.manifest ? await safeOutput(root, outputs.manifest) : undefined;
  if (destination && manifestDestination && destination === manifestDestination) throw new Error('INVALID_RELEASE_OUTPUT');
  // Write the bytes that passed inspection, not a second read of mutable source files.
  if (destination) {
    await mkdir(destination, { mode: 0o700 });
    for (const file of checked.files) {
      await mkdir(dirname(resolve(destination, file.path)), { recursive: true });
      await writeFile(resolve(destination, file.path), file.content, { flag: 'wx' });
    }
  }
  if (manifestDestination) await writeFile(manifestDestination, JSON.stringify({ version: 1, files: checked.files.map(({ content: _content, ...file }) => file) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}

async function main() {
  try {
    const { values } = parseArgs({ options: { ci: { type: 'boolean', default: false }, manifest: { type: 'string' }, package: { type: 'string' } }, strict: true });
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const result = await checkPublic(root, { ci: values.ci });
    if (result.issues.length) { for (const issue of result.issues) console.error(formatIssue(issue)); process.exitCode = 1; return; }
    await publishChecked(root, result, { manifest: values.manifest, package: values.package });
    console.log(`Public check passed: ${result.files.length} files; ${values.ci ? 'CI format/file rules only; private env not read' : result.localCredentialLoaded ? 'local credential literal/common-encoding checks included' : 'no local credential available; format/file rules only'}.`);
  } catch { console.error('scripts/check-public.ts:1: public check or release output failed'); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
