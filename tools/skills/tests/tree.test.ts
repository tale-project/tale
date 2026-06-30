import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  diffTrees,
  expectedTargetTree,
  isClean,
  readTree,
  type FileTree,
} from '../src/tree';

/** Build a FileTree from a plain object (utf-8 encoded values). */
function tree(entries: Record<string, string>): FileTree {
  const map: FileTree = new Map();
  const enc = new TextEncoder();
  for (const [key, value] of Object.entries(entries)) {
    map.set(key, enc.encode(value));
  }
  return map;
}

/** Write a file under `root`, creating parent directories. */
function writeUnder(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

describe('diffTrees', () => {
  test('identical trees are clean', () => {
    const a = tree({ 'SKILL.md': 'x', 'scripts/a.ts': 'y' });
    const b = tree({ 'SKILL.md': 'x', 'scripts/a.ts': 'y' });
    expect(isClean(diffTrees(a, b))).toBe(true);
  });

  test('detects a changed file', () => {
    const diff = diffTrees(
      tree({ 'SKILL.md': 'x' }),
      tree({ 'SKILL.md': 'CHANGED' }),
    );
    expect(diff.changed).toEqual(['SKILL.md']);
    expect(diff.missing).toEqual([]);
    expect(diff.extra).toEqual([]);
  });

  test('detects a missing file', () => {
    const diff = diffTrees(
      tree({ 'SKILL.md': 'x', 'scripts/new.ts': 'n' }),
      tree({ 'SKILL.md': 'x' }),
    );
    expect(diff.missing).toEqual(['scripts/new.ts']);
  });

  test('detects a stale extra file (the case git status cannot)', () => {
    const diff = diffTrees(
      tree({ 'SKILL.md': 'x' }),
      tree({ 'SKILL.md': 'x', 'scripts/old.ts': 'o' }),
    );
    expect(diff.extra).toEqual(['scripts/old.ts']);
  });

  test('a wholly absent target reads as everything missing', () => {
    const diff = diffTrees(
      tree({ 'SKILL.md': 'x', 'scripts/a.ts': 'y' }),
      tree({}),
    );
    expect(diff.missing).toEqual(['SKILL.md', 'scripts/a.ts']);
    expect(diff.changed).toEqual([]);
    expect(diff.extra).toEqual([]);
  });

  test('same length, one differing byte => changed (content-sensitive)', () => {
    const expected: FileTree = new Map([['f', new Uint8Array([1, 2, 3])]]);
    const actual: FileTree = new Map([['f', new Uint8Array([1, 9, 3])]]);
    expect(diffTrees(expected, actual).changed).toEqual(['f']);
  });
});

describe('expectedTargetTree', () => {
  test('drops test + secrets files, keeps shipped files (incl. binary)', () => {
    const source = tree({
      'SKILL.md': 'x',
      'scripts/a.ts': 'y',
      'scripts/a.test.ts': 'z',
      'scripts/b.spec.ts': 'z',
      'provider.secrets.json': 's',
      'assets/logo.png': 'binary-bytes',
    });
    expect([...expectedTargetTree(source).keys()].sort()).toEqual([
      'SKILL.md',
      'assets/logo.png',
      'scripts/a.ts',
    ]);
  });
});

describe('readTree', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tale-skills-tree-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('a missing directory reads as an empty tree', () => {
    expect(readTree(join(root, 'does-not-exist')).size).toBe(0);
  });

  test('reads nested files with POSIX skill-relative keys', () => {
    writeUnder(root, 'SKILL.md', 'hi');
    writeUnder(root, 'scripts/office/pack.py', 'print(1)');
    const keys = [...readTree(root).keys()].sort();
    expect(keys).toEqual(['SKILL.md', 'scripts/office/pack.py']);
  });

  test('preserves exact bytes (binary-safe)', () => {
    writeFileSync(join(root, 'logo.bin'), Buffer.from([0, 1, 2, 255, 254]));
    const bytes = readTree(root).get('logo.bin');
    expect(bytes && [...bytes]).toEqual([0, 1, 2, 255, 254]);
  });

  test('rejects symlinks (path-traversal / supply-chain defense)', () => {
    writeFileSync(join(root, 'real.txt'), 'r');
    symlinkSync(join(root, 'real.txt'), join(root, 'link.txt'));
    expect(() => readTree(root)).toThrow(/symlink not allowed/);
  });

  test('rejects case-insensitive duplicate paths (where the FS preserves both)', () => {
    writeFileSync(join(root, 'Dup.md'), 'a');
    writeFileSync(join(root, 'dup.md'), 'b');
    const names = readdirSync(root);
    if (names.includes('Dup.md') && names.includes('dup.md')) {
      // Case-sensitive FS (Linux CI): both entries exist -> the guard fires.
      expect(() => readTree(root)).toThrow(/case-insensitive duplicate/);
    } else {
      // Case-insensitive FS (typical macOS): the two writes collapsed to one
      // file, so the collision cannot be constructed here — nothing to assert.
      expect(readTree(root).size).toBeGreaterThan(0);
    }
  });
});
