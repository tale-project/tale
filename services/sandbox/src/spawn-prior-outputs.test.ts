// Unit tests for `stagePriorOutputDownloads` — the spawner-side helper
// that fetches the artifact's previous run outputs (as URLs) and writes
// them back into `/workspace/output/` before the container starts.
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
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stagePriorOutputDownloads } from './spawn.ts';

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
});
