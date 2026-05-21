// Unit tests for `stagePriorOutputFiles` — the spawner-side helper that
// writes the artifact's previous run outputs back into
// `/workspace/output/` before the container starts.
//
// We exercise the path-traversal guard end-to-end against a real temp
// directory (no mocks). bad names are logged + skipped, not fatal.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stagePriorOutputFiles } from './spawn.ts';

function b64(text: string): string {
  return Buffer.from(text).toString('base64');
}

describe('stagePriorOutputFiles', () => {
  let hostDir: string;
  let outputDir: string;

  beforeEach(async () => {
    hostDir = await mkdtemp(join(tmpdir(), 'tale-sandbox-prior-'));
    outputDir = join(hostDir, 'output');
    await mkdir(outputDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(hostDir, { recursive: true, force: true });
  });

  test('writes a flat-name prior output to /output/<name>', async () => {
    await stagePriorOutputFiles(outputDir, [
      { name: 'report.pptx', contentBase64: b64('hello pptx') },
    ]);
    const buf = await readFile(join(outputDir, 'report.pptx'));
    expect(buf.toString('utf8')).toBe('hello pptx');
  });

  test('creates nested directories as needed for a path-shaped name', async () => {
    await stagePriorOutputFiles(outputDir, [
      { name: 'sub/dir/report.txt', contentBase64: b64('nested') },
    ]);
    const buf = await readFile(join(outputDir, 'sub/dir/report.txt'));
    expect(buf.toString('utf8')).toBe('nested');
  });

  test('refuses ".." traversal — file is NOT written outside outputDir', async () => {
    await stagePriorOutputFiles(outputDir, [
      { name: '../escape.txt', contentBase64: b64('nope') },
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
    await stagePriorOutputFiles(outputDir, [
      { name: '/tmp/abs-escape.txt', contentBase64: b64('nope') },
    ]);
    const inside = await readdir(outputDir);
    expect(inside).not.toContain('abs-escape.txt');
  });

  test('writes multiple files in one call', async () => {
    await stagePriorOutputFiles(outputDir, [
      { name: 'a.bin', contentBase64: b64('aaa') },
      { name: 'b.bin', contentBase64: b64('bbb') },
    ]);
    expect((await readFile(join(outputDir, 'a.bin'))).toString('utf8')).toBe(
      'aaa',
    );
    expect((await readFile(join(outputDir, 'b.bin'))).toString('utf8')).toBe(
      'bbb',
    );
  });

  test('no-ops on an empty list without throwing', async () => {
    await stagePriorOutputFiles(outputDir, []);
    const inside = await readdir(outputDir);
    expect(inside).toEqual([]);
  });

  test('preserves binary content faithfully (round-trip through base64)', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 0xff, 0x10, 0x20]);
    const b64payload = Buffer.from(bytes).toString('base64');
    await stagePriorOutputFiles(outputDir, [
      { name: 'binary.bin', contentBase64: b64payload },
    ]);
    const buf = await readFile(join(outputDir, 'binary.bin'));
    expect(Array.from(new Uint8Array(buf))).toEqual(Array.from(bytes));
  });
});
