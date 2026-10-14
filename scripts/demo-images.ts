export interface ImageBudget { used: number; max: number }
/** Stream into a shared byte budget; a declared Content-Length is never trusted. */
export async function readPublicImage(response: Response, budget: ImageBudget, maxImageBytes = 1024 * 1024): Promise<{ bytes: Buffer; extension: string }> {
  const mime = response.headers.get('content-type')?.split(';')[0].trim();
  if (!response.ok || !response.body || !['image/png', 'image/gif', 'image/jpeg', 'image/webp'].includes(mime ?? '')) { await response.body?.cancel(); throw new Error('INVALID_IMAGE'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength; budget.used += next.value.byteLength;
      if (size > maxImageBytes || budget.used > budget.max) throw new Error('IMAGE_BYTE_LIMIT');
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = Buffer.concat(chunks);
  // Official CDN can label GIF bytes as image/png. Preserve the bytes and choose
  // the extension by actual signature, after requiring an image content type.
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) ? 'gif'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
    : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp' : null;
  if (!extension) throw new Error('INVALID_IMAGE');
  return { bytes, extension };
}
