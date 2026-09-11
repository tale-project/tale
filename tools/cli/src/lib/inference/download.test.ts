import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../config/releases/identity';
import { downloadArtifact } from './download';
import type { InferenceFetch } from './model';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tale-model-download-'));
  directories.push(directory);
  const bytes = Buffer.from('synthetic model shard, not weights');
  return {
    directory,
    bytes,
    input: {
      url:
        'https://huggingface.co/example/model/resolve/' +
        'a'.repeat(40) +
        '/model.safetensors',
      file: join(directory, 'model.safetensors'),
      bytes: bytes.length,
      sha256: sha256(bytes),
    },
  };
}
describe('bounded pinned model downloads', () => {
  test('follows an allowed public CDN without credentials and reuses verified bytes', async () => {
    const f = await fixture();
    let calls = 0;
    const transport = (async (
      url: string | URL | Request,
      options?: RequestInit,
    ) => {
      calls++;
      expect(options?.redirect).toBe('manual');
      expect(options?.headers).toBeUndefined();
      return String(url).startsWith('https://huggingface.co/')
        ? new Response(null, {
            status: 302,
            headers: {
              location:
                'https://cas-bridge.xethub.hf.co/synthetic?signature=not-a-secret',
            },
          })
        : new Response(f.bytes);
    }) as InferenceFetch;
    expect(await downloadArtifact(f.input, transport)).toBe('downloaded');
    expect(await downloadArtifact(f.input, transport)).toBe('reused');
    expect(calls).toBe(2);
    expect(await readFile(f.input.file)).toEqual(f.bytes);
    expect(await readdir(f.directory)).toEqual(['model.safetensors']);
  });
  test.each([
    'http://huggingface.co/file',
    'https://untrusted.example/file',
    'https://name:password@huggingface.co/file',
    'https://huggingface.co:444/file',
  ])(
    'refuses a redirect outside the exact public transport boundary %s',
    async (location) => {
      const f = await fixture();
      let calls = 0;
      const transport = (async () => {
        calls++;
        return new Response(null, { status: 302, headers: { location } });
      }) as InferenceFetch;
      await expect(downloadArtifact(f.input, transport)).rejects.toThrow(
        'could not be verified',
      );
      expect(calls).toBe(1);
      expect(await readdir(f.directory)).toEqual([]);
    },
  );
  test.each([
    'truncated',
    'oversized',
    'wrong-hash',
    'wrong-length',
    'redirect-loop',
    'stream-failure',
  ])('leaves no ready or partial artifact after %s', async (kind) => {
    const f = await fixture();
    let calls = 0;
    const transport = (async () => {
      calls++;
      if (kind === 'redirect-loop')
        return new Response(null, {
          status: 302,
          headers: { location: f.input.url },
        });
      if (kind === 'stream-failure')
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(f.bytes.subarray(0, 5));
              controller.error(new Error('private upstream body'));
            },
          }),
        );
      if (kind === 'wrong-length')
        return new Response(f.bytes, { headers: { 'content-length': '999' } });
      return new Response(
        kind === 'truncated'
          ? f.bytes.subarray(0, 5)
          : kind === 'oversized'
            ? Buffer.concat([f.bytes, f.bytes])
            : Buffer.alloc(f.bytes.length),
      );
    }) as InferenceFetch;
    await expect(downloadArtifact(f.input, transport)).rejects.toThrow(
      'could not be verified',
    );
    expect(calls).toBeLessThanOrEqual(6);
    expect(await readdir(f.directory)).toEqual([]);
  });
  test('retains an existing wrong shard without contacting the network', async () => {
    const f = await fixture();
    const old = Buffer.from('retained wrong bytes');
    await writeFile(f.input.file, old);
    let contacted = false;
    await expect(
      downloadArtifact(f.input, (async () => {
        contacted = true;
        return new Response(f.bytes);
      }) as InferenceFetch),
    ).rejects.toThrow();
    expect(contacted).toBe(false);
    expect(await readFile(f.input.file)).toEqual(old);
  });
});
