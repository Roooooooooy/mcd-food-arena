import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { checkPublic, publishChecked, scanContent, SOURCE_FILES, formatIssue } from '../scripts/check-public.ts';

const project = resolve(import.meta.dirname, '..');
const token = ['fixture', 'credential', 'not', 'real', '123456789'].join('-');
const requiredMaterials = ['README.md', 'MCP_INTEGRATION.md', 'CONTEST_DECLARATION.md', 'mcp-config.example.json', 'docs/submission.md', 'docs/demo.md', 'package.json', 'package-lock.json', '.env.example'];
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'mcd-public-'));
  for (const path of SOURCE_FILES) {
    await mkdir(dirname(resolve(root, path)), { recursive: true });
    const content = requiredMaterials.includes(path) ? await readFile(resolve(project, path)) : Buffer.from(path.endsWith('.json') ? '{}' : '');
    await writeFile(resolve(root, path), content);
  }
  await mkdir(resolve(root, 'docs/screenshots'), { recursive: true });
  for (const path of ['demo-home-current.png', 'demo-pk-current.png', 'meme-list-removed-published.png', 'task7-public-mobile.png']) await writeFile(resolve(root, 'docs/screenshots', path), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
  const hash = createHash('sha256').update(image).digest('hex');
  const imagePath = `demo/images/${hash}.png`;
  const catalog = { mode: 'demo', sourceKind: 'official-snapshot', complete: true, capturedAt: '2026-10-14T13:26:17.369Z', items: [{ imageUrl: imagePath, variants: [] }] };
  const manifest = { capturedAt: catalog.capturedAt, imageUrls: 1, imageFiles: 1, imageBytes: image.length, failedImages: 0, images: [{ sourceUrl: 'https://menu-img.mcd.cn/example.png', path: imagePath }] };
  await mkdir(resolve(root, 'public/demo/images'), { recursive: true });
  await writeFile(resolve(root, 'public/demo/catalog.json'), JSON.stringify(catalog));
  await writeFile(resolve(root, 'public/demo/manifest.json'), JSON.stringify(manifest));
  await writeFile(resolve(root, 'public', imagePath), image);
  await mkdir(resolve(root, 'dist/assets'), { recursive: true });
  await mkdir(resolve(root, 'dist/demo/images'), { recursive: true });
  await writeFile(resolve(root, 'dist/index.html'), '<script type="module" src="/mcd-food-arena/assets/index-a123.js"></script><link rel="stylesheet" href="/mcd-food-arena/assets/index-b123.css">');
  await writeFile(resolve(root, 'dist/assets/index-a123.js'), 'console.log("demo")');
  await writeFile(resolve(root, 'dist/assets/index-b123.css'), 'body{}');
  await writeFile(resolve(root, 'dist/demo/catalog.json'), JSON.stringify(catalog));
  await writeFile(resolve(root, 'dist/demo/manifest.json'), JSON.stringify(manifest));
  await writeFile(resolve(root, 'dist', imagePath), image);
  await mkdir(resolve(root, '.private/task7-official'), { recursive: true });
  await writeFile(resolve(root, '.private/task7-official/CONTEST_DECLARATION.md'), await readFile(resolve(project, 'CONTEST_DECLARATION.md')));
  return root;
}
async function withFixture(run: (root: string) => Promise<void>) {
  const root = await fixture();
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('exact environment placeholder is accepted; other documented bearer values are rejected without printing values', () => {
  const valid = JSON.stringify({ Authorization: 'Bearer ${MCD_MCP_TOKEN}' });
  assert.deepEqual(scanContent('mcp-config.example.json', Buffer.from(valid), []), []);
  const invalid = JSON.stringify({ Authorization: ['Bearer', token].join(' ') });
  const issues = scanContent('README.md', Buffer.from('\n' + invalid), []);
  assert.ok(issues.some(issue => issue.line === 2 && issue.reason === 'literal authorization credential'));
  const report = issues.map(formatIssue).join('\n');
  assert.ok(report.includes('README.md:2:'));
  assert.ok(!report.includes(token));
});

test('actual local credential is detected in source, base64 bundle and serialized unicode', () => {
  for (const [file, content] of [
    ['src/App.tsx', 'export const leak = ' + JSON.stringify(token)],
    ['dist/assets/index-a123.js', 'const leak="' + Buffer.from(token).toString('base64') + '"'],
    ['dist/assets/index-a123.js', 'const leak="' + [...token].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '"'],
  ]) {
    const issues = scanContent(file, Buffer.from(content), [token]);
    assert.ok(issues.some(issue => issue.reason.startsWith('local credential')));
    assert.ok(!issues.map(formatIssue).join('\n').includes(token));
  }
});

test('runtime Authorization in the gateway remains legitimate while hardcoded headers in source fail', async () => {
  const actual = await readFile(resolve(project, 'server/mcp/gateway.ts'));
  assert.deepEqual(scanContent('server/mcp/gateway.ts', actual, []), []);
  assert.ok(scanContent('src/App.tsx', Buffer.from('const h={' + 'Authorization' + ':' + JSON.stringify(['Bearer', token].join(' ')) + '}'), []).length > 0);
});

test('public datasets reject raw account and authentication envelopes', () => {
  const body = JSON.stringify({ data: { accountId: 'fixture-account', frequent: [], headers: { Authorization: 'Bearer ${MCD_MCP_TOKEN}' } } });
  const issues = scanContent('tests/fixtures/catalog.json', Buffer.from(body), []);
  assert.ok(issues.filter(issue => issue.reason === 'private field in public dataset').length > 0);
  assert.deepEqual(scanContent('tests/fixtures/catalog.json', Buffer.from('{"name":"公开餐品"}'), []), []);
});

test('checked inventory includes runnable source and dist but excludes known internal files', async () => withFixture(async root => {
  await writeFile(resolve(root, '.env.local'), 'MCD_MCP_TOKEN=' + token + '\n');
  await mkdir(resolve(root, '.superpowers/private'), { recursive: true });
  await writeFile(resolve(root, '.superpowers/private/report.md'), token);
  await writeFile(resolve(root, 'docs/screenshots/random-pool-published.png'), 'historical screenshot');
  const result = await checkPublic(root, { ci: false });
  assert.deepEqual(result.issues, []);
  assert.equal(result.localCredentialLoaded, true);
  assert.ok(result.files.some(file => file.path === 'package-lock.json'));
  assert.ok(result.files.some(file => file.path === 'dist/assets/index-a123.js'));
  assert.ok(!result.files.some(file => file.path.startsWith('.superpowers') || file.path.startsWith('.private') || file.path === '.env.local'));
  assert.ok(!result.files.some(file => file.path === 'docs/screenshots/random-pool-published.png'));
  assert.equal(await readFile(resolve(root, 'docs/screenshots/random-pool-published.png'), 'utf8'), 'historical screenshot');
}));

test('source and dist leaks make local check fail', async () => withFixture(async root => {
  await writeFile(resolve(root, '.env.local'), 'MCD_MCP_TOKEN=' + token + '\n');
  await writeFile(resolve(root, 'src/App.tsx'), '\n' + JSON.stringify(token));
  await writeFile(resolve(root, 'dist/assets/index-a123.js'), Buffer.from(token).toString('base64'));
  const result = await checkPublic(root, { ci: false });
  assert.ok(result.issues.some(issue => issue.file === 'src/App.tsx' && issue.line === 2));
  assert.ok(result.issues.some(issue => issue.file === 'dist/assets/index-a123.js'));
  await assert.rejects(publishChecked(root, result, { package: '.private/release/bad' }), /PUBLIC_CHECK_FAILED/);
}));

test('CI never follows or reads a private env symlink and reports only format checks', async () => withFixture(async root => {
  await symlink('/does-not-exist/private-env', resolve(root, '.env.local'));
  const result = await checkPublic(root, { ci: true });
  assert.deepEqual(result.issues, []);
  assert.equal(result.localCredentialLoaded, false);
  const local = await checkPublic(root, { ci: false });
  assert.ok(local.issues.some(issue => issue.file === '.env.local' && issue.reason === 'private environment must be a regular file'));
}));

test('unknown source, public and dist files are rejected rather than silently entering the package', async () => withFixture(async root => {
  for (const path of ['src/unreviewed.ts', 'public/demo/images/extra.png', 'dist/assets/extra.js']) await writeFile(resolve(root, path), 'extra');
  const result = await checkPublic(root, { ci: true });
  for (const file of ['src/unreviewed.ts', 'public/demo/images/extra.png', 'dist/assets/extra.js']) assert.ok(result.issues.some(issue => issue.file === file && issue.reason === 'file is not in the public allowlist'));
}));

test('allowlisted source symlink and manifest traversal are rejected', async () => withFixture(async root => {
  await rm(resolve(root, 'src/App.tsx'));
  await symlink(resolve(root, '.private/task7-official/CONTEST_DECLARATION.md'), resolve(root, 'src/App.tsx'));
  const manifest = JSON.parse(await readFile(resolve(root, 'public/demo/manifest.json'), 'utf8'));
  manifest.images[0].path = '../../.private/secret.png';
  await writeFile(resolve(root, 'public/demo/manifest.json'), JSON.stringify(manifest));
  const result = await checkPublic(root, { ci: true });
  assert.ok(result.issues.some(issue => issue.file === 'src/App.tsx' && issue.reason === 'symbolic links are not public files'));
  assert.ok(result.issues.some(issue => issue.file === 'public/demo/manifest.json' && issue.reason === 'invalid image manifest'));
}));

test('required declaration bytes, configuration schema, 4-line submission and copied dist are checked', async () => withFixture(async root => {
  await writeFile(resolve(root, 'CONTEST_DECLARATION.md'), 'changed');
  await writeFile(resolve(root, 'mcp-config.example.json'), '{}');
  await writeFile(resolve(root, 'docs/submission.md'), '【参赛申请】\nwrong');
  await writeFile(resolve(root, 'dist/demo/catalog.json'), '{}');
  const result = await checkPublic(root, { ci: true });
  for (const file of ['CONTEST_DECLARATION.md', 'mcp-config.example.json', 'docs/submission.md', 'dist/demo/catalog.json']) assert.ok(result.issues.some(issue => issue.file === file));
}));

test('source credential assignments and broken public screenshot links are rejected in CI', async () => withFixture(async root => {
  await writeFile(resolve(root, 'src/App.tsx'), 'const ' + 'MCD_MCP_TOKEN' + ' = ' + JSON.stringify(token));
  await rm(resolve(root, 'docs/screenshots/task7-public-mobile.png'));
  const result = await checkPublic(root, { ci: true });
  assert.ok(result.issues.some(issue => issue.file === 'src/App.tsx' && issue.reason === 'credential assignment'));
  assert.ok(result.issues.some(issue => issue.file === 'README.md' && issue.reason === 'local link target is not an included public file'));
}));

test('manifest and package come from checked bytes and cannot traverse, follow output symlinks or overwrite', async () => withFixture(async root => {
  const result = await checkPublic(root, { ci: true });
  assert.deepEqual(result.issues, []);
  await assert.rejects(publishChecked(root, result, { package: '../outside' }), /INVALID_RELEASE_OUTPUT/);
  await symlink(resolve(root, 'src'), resolve(root, '.private/release'));
  await assert.rejects(publishChecked(root, result, { package: '.private/release/package' }), /INVALID_RELEASE_OUTPUT/);
  await rm(resolve(root, '.private/release'));
  await mkdir(resolve(root, '.private/release'), { recursive: true });
  await symlink(resolve(root, 'src'), resolve(root, '.private/release/escape'));
  await assert.rejects(publishChecked(root, result, { package: '.private/release/escape' }), /RELEASE_OUTPUT_EXISTS/);
  await publishChecked(root, result, { manifest: '.private/release/files.json', package: '.private/release/package' });
  const manifest = JSON.parse(await readFile(resolve(root, '.private/release/files.json'), 'utf8'));
  assert.equal(manifest.files.length, result.files.length);
  for (const file of manifest.files) {
    const bytes = await readFile(resolve(root, '.private/release/package', file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  assert.ok(!(await readdir(resolve(root, '.private/release/package'))).includes('.private'));
  await assert.rejects(publishChecked(root, result, { package: '.private/release/package' }), /RELEASE_OUTPUT_EXISTS/);
}));
