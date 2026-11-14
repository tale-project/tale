import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Parser } from 'acorn';

import { createModuleMocks } from './module-mock-fixture';

const CLI_ROOT = join(import.meta.dir, '..', '..');

/**
 * The files of the CLI that may call `mock.module` themselves, each with why
 * the module it replaces can reach no other suite.
 */
const BARE_MODULE_MOCKS_ALLOWED: Record<string, string> = {
  'src/utils/module-mock-fixture.ts':
    'the fixture itself: it puts back each module it replaces',
  'tests/fixtures/dev-command.ts':
    'a program of its own, which the dev command tests spawn',
};

type Node = { type: string; start: number; end: number } & Record<
  string,
  unknown
>;

/** Each `mock.module(…)` call in `source`; one inside a string is no call. */
function bareModuleMocks(source: string, path: string): string[] {
  const loader = path.endsWith('.tsx') ? 'tsx' : 'ts';
  const code = new Bun.Transpiler({ loader }).transformSync(source);
  const program = Parser.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
  }) as unknown as Node;
  const calls: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Node;
    const callee = node.callee as Node | undefined;
    if (
      node.type === 'CallExpression' &&
      callee?.type === 'MemberExpression' &&
      (callee.object as Node).type === 'Identifier' &&
      (callee.object as { name: string }).name === 'mock' &&
      (callee.property as Node).type === 'Identifier' &&
      (callee.property as { name: string }).name === 'module'
    )
      calls.push(code.slice(node.start, node.end).split('\n')[0] ?? '');
    for (const [key, child] of Object.entries(node))
      if (key !== 'type' && key !== 'start' && key !== 'end') visit(child);
  };
  visit(program);
  return calls;
}

describe('createModuleMocks', () => {
  test('restore puts the real module back for every importer', async () => {
    const deployDir = mkdtempSync(join(tmpdir(), 'tale-module-mocks-'));
    try {
      const mocks = createModuleMocks(import.meta.dir);
      await mocks.mockModule('../lib/state/get-current-color', () => ({
        getCurrentColor: async () => undefined,
      }));
      const mocked = await import('../lib/state/get-current-color');
      expect(await mocked.getCurrentColor(deployDir)).toBeUndefined();

      mocks.restore();
      const real = await import('../lib/state/get-current-color');
      // A deploy folder with no state file has no current colour.
      expect(await real.getCurrentColor(deployDir)).toBeNull();
    } finally {
      rmSync(deployDir, { recursive: true, force: true });
    }
  });

  // CI runs every CLI test file in one process, in path order: the colour
  // lifecycle suite runs before the Incus deploy suite, whose flip record
  // refused the `undefined` colour that suite's leaked spy answered.
  test('a suite that mocks the current colour leaves the next suite the real one', async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        'test',
        '--timeout',
        '30000',
        './src/lib/actions/color-lifecycle.test.ts',
        './src/lib/actions/incus-deploy.test.ts',
      ],
      { cwd: CLI_ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const failed = `${stdout}\n${stderr}`
      .split('\n')
      .filter((line) => line.startsWith('(fail)'));
    expect(failed).toEqual([]);
    expect(code).toBe(0);
  }, 120_000);

  // `mock.module` outlives the suite that calls it: a suite replaces a module
  // through `createModuleMocks`, which puts the real one back once it ends.
  test('no CLI file replaces a module outside the fixture', () => {
    const offenders: string[] = [];
    const glob = new Bun.Glob('**/*.{ts,tsx}');
    for (const found of glob.scanSync({ cwd: CLI_ROOT })) {
      const path = found.replaceAll('\\', '/');
      if (path.startsWith('node_modules/') || path.startsWith('dist/'))
        continue;
      if (path in BARE_MODULE_MOCKS_ALLOWED) continue;
      const source = readFileSync(join(CLI_ROOT, path), 'utf8');
      if (!source.includes('mock.module')) continue;
      for (const call of bareModuleMocks(source, path))
        offenders.push(`${path}: ${call}`);
    }
    expect(offenders).toEqual([]);
  });

  test('the guard sees a bare call, and no string or comment', () => {
    const source = [
      "import { mock } from 'bun:test';",
      "const script = `mock.module('./in-a-child', () => ({}))`;",
      "// mock.module('./in-a-comment', () => ({}))",
      "if (true) mock.module('./nested', () => ({ x: 1 as number }));",
    ].join('\n');
    expect(bareModuleMocks(source, 'suite.test.ts')).toEqual([
      'mock.module("./nested", () => ({ x: 1 }))',
    ]);
  });
});
