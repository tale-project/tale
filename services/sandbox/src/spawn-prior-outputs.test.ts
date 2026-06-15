// Unit tests for `stagePriorOutputDownloads` — the spawner-side helper
// that fetches the artifact's previous run outputs (as URLs) and writes
// them back into `/user/output/` before the container starts.
//
// We exercise the path-traversal guard end-to-end against a real temp
// directory and a real ephemeral HTTP server (no mocks). Bad names and
// failed fetches are logged + skipped, not fatal.

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stagePriorOutputDownloads } from './exec-common.ts';

// Minimal ephemeral file-server backed by an in-memory map. Each test sets
// the map's `{name: Uint8Array}` entries and computes URLs against the
// returned base.
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const fileMap = new Map<string, Uint8Array>();

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const key = url.searchParams.get('k') ?? '';
      const bytes = fileMap.get(key);
      if (!bytes) return new Response('not found', { status: 404 });
      return new Response(bytes, { status: 200 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  void server.stop();
});

function urlFor(key: string, bytes: Uint8Array | string): string {
  fileMap.set(
    key,
    typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
  );
  return `${baseUrl}/?k=${encodeURIComponent(key)}`;
}

describe('stagePriorOutputDownloads', () => {
  let hostDir: string;
  let outputDir: string;

  beforeEach(async () => {
    hostDir = await mkdtemp(join(tmpdir(), 'tale-sandbox-prior-'));
    outputDir = join(hostDir, 'output');
    await mkdir(outputDir, { recursive: true });
    fileMap.clear();
  });

  afterEach(async () => {
    await rm(hostDir, { recursive: true, force: true });
  });

  test('writes a flat-name prior output to /output/<name>', async () => {
    await stagePriorOutputDownloads(outputDir, [
      { name: 'report.pptx', url: urlFor('report.pptx', 'hello pptx') },
    ]);
    const buf = await readFile(join(outputDir, 'report.pptx'));
    expect(buf.toString('utf8')).toBe('hello pptx');
  });

  test('creates nested directories as needed for a path-shaped name', async () => {
    await stagePriorOutputDownloads(outputDir, [
      { name: 'sub/dir/report.txt', url: urlFor('nested', 'nested') },
    ]);
    const buf = await readFile(join(outputDir, 'sub/dir/report.txt'));
    expect(buf.toString('utf8')).toBe('nested');
  });

  test('refuses ".." traversal — file is NOT written outside outputDir', async () => {
    await stagePriorOutputDownloads(outputDir, [
      { name: '../escape.txt', url: urlFor('nope', 'nope') },
    ]);
    // The skipped file must not appear inside outputDir.
    const inside = await readdir(outputDir);
    expect(inside).not.toContain('escape.txt');
    // And it must not have been written one level up either.
    const oneUp = await readdir(hostDir);
    expect(oneUp).not.toContain('escape.txt');
  });

  test('refuses an absolute path that escapes outputDir', async () => {
    // Absolute paths to `resolve` ignore the `from` arg, so the result is
    // the absolute path verbatim — well outside outputDir.
    await stagePriorOutputDownloads(outputDir, [
      { name: '/tmp/abs-escape.txt', url: urlFor('nope', 'nope') },
    ]);
    const inside = await readdir(outputDir);
    expect(inside).not.toContain('abs-escape.txt');
  });

  test('writes multiple files in one call', async () => {
    await stagePriorOutputDownloads(outputDir, [
      { name: 'a.bin', url: urlFor('a', 'aaa') },
      { name: 'b.bin', url: urlFor('b', 'bbb') },
    ]);
    expect((await readFile(join(outputDir, 'a.bin'))).toString('utf8')).toBe(
      'aaa',
    );
    expect((await readFile(join(outputDir, 'b.bin'))).toString('utf8')).toBe(
      'bbb',
    );
  });

  test('no-ops on an empty list without throwing', async () => {
    await stagePriorOutputDownloads(outputDir, []);
    const inside = await readdir(outputDir);
    expect(inside).toEqual([]);
  });

  test('preserves binary content faithfully', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 0xff, 0x10, 0x20]);
    await stagePriorOutputDownloads(outputDir, [
      { name: 'binary.bin', url: urlFor('binary', bytes) },
    ]);
    const buf = await readFile(join(outputDir, 'binary.bin'));
    expect(Array.from(new Uint8Array(buf))).toEqual(Array.from(bytes));
  });

  test('skips a fetch that returns 404 without throwing', async () => {
    // URL is registered but the key doesn't exist in fileMap → server 404.
    fileMap.clear();
    await stagePriorOutputDownloads(outputDir, [
      { name: 'missing.pptx', url: `${baseUrl}/?k=missing-key` },
    ]);
    const inside = await readdir(outputDir);
    expect(inside).not.toContain('missing.pptx');
  });

  // -------------------------------------------------------------------
  // Return-shape attestation (crispy-curry plan §3).
  //
  // The new signature returns `{staged, skipped}` so the platform can
  // diff what it asked for against what landed on disk. Skip reasons
  // are structured so the LLM-facing error payload can guide recovery
  // (url_expired → re-mint, http_error → check storage, unsafe_path →
  // never legitimate, etc.).
  // -------------------------------------------------------------------

  test('returns staged entries with bytes + sha256 of the written file', async () => {
    const payload = 'hello pptx';
    const expectedSha = createHash('sha256').update(payload).digest('hex');
    const result = await stagePriorOutputDownloads(outputDir, [
      { name: 'report.pptx', url: urlFor('report.pptx', payload) },
    ]);
    expect(result.staged).toHaveLength(1);
    expect(result.staged[0]).toEqual({
      name: 'report.pptx',
      bytes: new TextEncoder().encode(payload).byteLength,
      sha256: expectedSha,
    });
    expect(result.skipped).toEqual([]);
  });

  test('returns sha256 that matches the actual bytes for binary content', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 0xff, 0x10, 0x20]);
    const expectedSha = createHash('sha256').update(bytes).digest('hex');
    const result = await stagePriorOutputDownloads(outputDir, [
      { name: 'binary.bin', url: urlFor('binary', bytes) },
    ]);
    expect(result.staged[0]?.sha256).toBe(expectedSha);
  });

  test('classifies path-traversal as unsafe_path skip', async () => {
    const result = await stagePriorOutputDownloads(outputDir, [
      { name: '../escape.txt', url: urlFor('nope', 'nope') },
    ]);
    expect(result.staged).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      name: '../escape.txt',
      reason: 'unsafe_path',
    });
  });

  test('classifies non-2xx as http_error skip with status in detail', async () => {
    fileMap.clear();
    const result = await stagePriorOutputDownloads(outputDir, [
      { name: 'missing.pptx', url: `${baseUrl}/?k=missing-key` },
    ]);
    expect(result.staged).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      name: 'missing.pptx',
      reason: 'http_error',
    });
    expect(result.skipped[0]?.detail).toContain('404');
  });

  test('classifies 403 / 410 as url_expired skip (presigned URL TTL hint)', async () => {
    // Spin up a tiny server that returns 410 Gone for any request.
    const goneServer = Bun.serve({
      port: 0,
      fetch: () => new Response('gone', { status: 410 }),
    });
    try {
      const result = await stagePriorOutputDownloads(outputDir, [
        {
          name: 'stale.pptx',
          url: `http://localhost:${goneServer.port}/x`,
        },
      ]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({
        name: 'stale.pptx',
        reason: 'url_expired',
      });
    } finally {
      void goneServer.stop();
    }
  });

  test('classifies network-error as fetch_failed skip', async () => {
    // Malformed URL string causes fetch to throw synchronously before
    // any HTTP response — distinct from a remote-end http_error.
    const result = await stagePriorOutputDownloads(outputDir, [
      { name: 'unreachable.txt', url: 'not-a-real-url' },
    ]);
    expect(result.staged).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      name: 'unreachable.txt',
      reason: 'fetch_failed',
    });
  });

  test('mixed staged + skipped surfaces both lists correctly', async () => {
    const result = await stagePriorOutputDownloads(outputDir, [
      { name: 'good.txt', url: urlFor('good', 'ok') },
      { name: '../bad.txt', url: urlFor('bad', 'no') },
      { name: 'missing.txt', url: `${baseUrl}/?k=does-not-exist` },
    ]);
    expect(result.staged.map((s) => s.name)).toEqual(['good.txt']);
    expect(result.skipped.map((s) => s.reason).sort()).toEqual([
      'http_error',
      'unsafe_path',
    ]);
  });

  test('classifies stalled fetch as fetch_timeout skip', async () => {
    // Server that never responds; the timeoutMs override triggers
    // AbortSignal.timeout before any data comes back.
    const slowServer = Bun.serve({
      port: 0,
      async fetch() {
        await new Promise<void>(() => {
          /* never resolves */
        });
        return new Response('unreachable');
      },
    });
    try {
      const result = await stagePriorOutputDownloads(
        outputDir,
        [{ name: 'slow.txt', url: `http://localhost:${slowServer.port}/` }],
        { timeoutMs: 50 },
      );
      expect(result.staged).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({
        name: 'slow.txt',
        reason: 'fetch_timeout',
      });
    } finally {
      void slowServer.stop();
    }
  });

  test('rejects oversize body via Content-Length pre-check', async () => {
    const bigPayload = new Uint8Array(10_000); // server lies/doesn't, see below
    const url = urlFor('big', bigPayload);
    const result = await stagePriorOutputDownloads(
      outputDir,
      [{ name: 'big.bin', url }],
      { maxBytesPerFile: 1_000 },
    );
    expect(result.staged).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      name: 'big.bin',
      reason: 'download_too_large',
    });
  });

  test('rejects oversize body via streaming cap when Content-Length is absent', async () => {
    // Bun.serve with a ReadableStream body usually omits Content-Length,
    // so the size check has to be enforced by the streaming-read path.
    const chunkBytes = new Uint8Array(512);
    const chunks = 8;
    const streamServer = Bun.serve({
      port: 0,
      fetch() {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < chunks; i++) controller.enqueue(chunkBytes);
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    try {
      const result = await stagePriorOutputDownloads(
        outputDir,
        [{ name: 'stream.bin', url: `http://localhost:${streamServer.port}/` }],
        { maxBytesPerFile: 1_000 },
      );
      expect(result.staged).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toMatchObject({
        name: 'stream.bin',
        reason: 'download_too_large',
      });
    } finally {
      void streamServer.stop();
    }
  });
});
