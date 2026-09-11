import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, link, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { externalDepError, preconditionError } from '../../utils/fail';
import { fileDigest } from './files';
import type { InferenceFetch, InferenceModel } from './model';

export const modelDownloadUrl = (model: InferenceModel, file: string): string =>
  `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.split('/').map(encodeURIComponent).join('/')}`;

function allowedDownload(url: URL): boolean {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  )
    return false;
  return [
    'github.com',
    'release-assets.githubusercontent.com',
    'huggingface.co',
    'cdn-lfs.huggingface.co',
    'cdn-lfs.hf.co',
    'cdn-lfs-us-1.hf.co',
    'cdn-lfs-eu-1.hf.co',
    'cas-bridge.xethub.hf.co',
  ].includes(url.hostname);
}

/** Public pinned downloads never carry API credentials, including redirects.
 * Partial files are owned scratch, never a ready model; replay verifies each
 * completed shard and downloads only missing shards. No unbounded range append. */
export async function downloadArtifact(
  input: { url: string; file: string; bytes: number; sha256: string },
  fetchImpl: InferenceFetch = fetch,
): Promise<'reused' | 'downloaded'> {
  try {
    const info = await lstat(input.file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (await fileDigest(input.file, input.bytes)) !== input.sha256
    )
      throw preconditionError(
        'Existing inference artifact differs; retain it for diagnosis and select a clean release.',
      );
    return 'reused';
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  await mkdir(dirname(input.file), { recursive: true, mode: 0o700 });
  const temporary = input.file + '.partial.' + randomUUID();
  let handle;
  try {
    let url = new URL(input.url);
    let response: Response | undefined;
    // Large pinned shards may take hours on a destination uplink. Each response
    // remains bounded by its exact byte count and an explicit six-hour deadline.
    const signal = AbortSignal.timeout(6 * 60 * 60 * 1000);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (!allowedDownload(url)) throw new Error('unapproved artifact host');
      response = await fetchImpl(url, { redirect: 'manual', signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 5) throw new Error('redirect bound');
      url = new URL(location, url);
    }
    if (!response?.ok || !response.body || response.status !== 200)
      throw new Error('artifact unavailable');
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== input.bytes)
      throw new Error('declared length differs');
    handle = await open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let count = 0;
    for await (const chunk of response.body) {
      count += chunk.length;
      if (count > input.bytes) throw new Error('artifact byte limit');
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(
          chunk,
          offset,
          chunk.length - offset,
        );
        if (written.bytesWritten === 0)
          throw new Error('artifact write stopped');
        offset += written.bytesWritten;
      }
    }
    if (count !== input.bytes || hash.digest('hex') !== input.sha256)
      throw new Error('artifact digest differs');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, input.file);
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          error.code === 'EEXIST'
        ) ||
        (await fileDigest(input.file, input.bytes)) !== input.sha256
      )
        throw error;
    }
    return 'downloaded';
  } catch {
    throw externalDepError(
      'The pinned inference artifact could not be verified. Check network access and the exact revision/file manifest.',
    );
  } finally {
    await handle?.close();
    await unlink(temporary).catch(() => undefined);
  }
}
