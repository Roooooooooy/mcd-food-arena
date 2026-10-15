import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { freezeSnapshot, publicImageUrl } from '../src/demo/snapshot.ts';
import { readPublicImage } from './demo-images.ts';
import { loadCaptureInput } from './capture-input.ts';

// Local normalized public API only. This script never loads authentication files.
const root = new URL('../', import.meta.url);
const snapshot = freezeSnapshot(await loadCaptureInput(process.argv.slice(2)), new Date().toISOString());
if (snapshot.store?.id !== '3330251') throw new Error('UNEXPECTED_STORE');
const urls = [...new Set(snapshot.items.flatMap(item => [item.imageUrl, ...(item.variants ?? []).map(v => v.imageUrl)]).filter((url): url is string => url !== null))];
if (urls.length > 160) throw new Error('IMAGE_COUNT_LIMIT');
const images = new Map<string, string | null>(), hashes = new Set<string>();
const budget = { used: 0, max: 20 * 1024 * 1024 };
let storedBytes = 0, index = 0;
await mkdir(new URL('public/demo/images/', root), { recursive: true });
async function download(url: string): Promise<string | null> {
  if (!publicImageUrl(url)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (budget.used >= budget.max) return null;
    try {
      // A redirect never broadens the approved public image host boundary.
      const result = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) });
      const image = await readPublicImage(result, budget);
      const hash = createHash('sha256').update(image.bytes).digest('hex');
      const name = `${hash}.${image.extension}`;
      if (!hashes.has(hash)) { await writeFile(new URL(`public/demo/images/${name}`, root), image.bytes); hashes.add(hash); storedBytes += image.bytes.length; }
      return `demo/images/${name}`;
    } catch { /* Failed official images use the existing SVG, never a fabricated photo. */ }
  }
  return null;
}
await Promise.all(Array.from({ length: 4 }, async () => {
  while (index < urls.length) { const url = urls[index++]; images.set(url, await download(url)); }
}));
for (const item of snapshot.items) {
  item.imageUrl = item.imageUrl ? images.get(item.imageUrl) ?? null : null;
  for (const variant of item.variants ?? []) variant.imageUrl = variant.imageUrl ? images.get(variant.imageUrl) ?? null : null;
}
const manifest = {
  capturedAt: snapshot.capturedAt, loadedAt: snapshot.loadedAt, store: snapshot.store,
  rawSkuCount: snapshot.rawSkuCount, candidates: snapshot.items.length, categories: new Set(snapshot.items.map(item => item.stageId)).size,
  variants: snapshot.items.reduce((sum, item) => sum + (item.variants?.length ?? 0), 0),
  imageUrls: urls.length, imageFiles: hashes.size, failedImages: [...images.values()].filter(value => value === null).length, imageBytes: storedBytes,
  images: urls.map(sourceUrl => ({ sourceUrl, path: images.get(sourceUrl) ?? null })),
};
await writeFile(new URL('public/demo/catalog.json', root), JSON.stringify(snapshot, null, 2) + '\n');
await writeFile(new URL('public/demo/manifest.json', root), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ...manifest, images: undefined, output: fileURLToPath(new URL('public/demo/', root)) }, null, 2));
