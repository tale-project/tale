// Unit tests for the `stageWorkspace` helper — the part that lays out
// /workspace/code/<files> and /workspace/.tale/runner.{py,js} on the host
// bind-mounted dir before the container starts.
//
// We do not assert ownership (chownRecursive's lchown(65534) needs root and
// is irrelevant to the layout contract). The test catches and ignores the
// EPERM that fires after the writes have completed.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stageWorkspace } from './spawn.ts';
import type { ExecuteRequest } from './types.ts';

async function stageIgnoringChown(
  hostDir: string,
  req: ExecuteRequest,
): Promise<void> {
  try {
    await stageWorkspace(hostDir, req);
  } catch (err) {
    if (err instanceof Error && /EPERM|EINVAL/.test(err.message)) {
      // Non-root test env can't chown to 65534 — fine, the file layout has
      // already been written by the time chownRecursive runs.
      return;
    }
    throw err;
  }
}

function baseReq(overrides: Partial<ExecuteRequest>): ExecuteRequest {
  return {
    executionId: 'abc-123',
    organizationId: 'org_42',
    language: 'python',
    files: [{ path: 'main.py', content: 'print("ok")' }],
    entryPath: 'main.py',
    ...overrides,
  };
}

describe('stageWorkspace', () => {
  let hostDir: string;

  beforeEach(async () => {
    hostDir = await mkdtemp(join(tmpdir(), 'tale-sandbox-stage-'));
  });

  afterEach(async () => {
    await rm(hostDir, { recursive: true, force: true });
  });

  test('single-script mode stages user files at declared paths and writes NO synthetic main.py mirror', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        files: [
          { path: 'main.py', content: 'print("user main")' },
          { path: 'helpers.py', content: 'X = 1' },
        ],
        entryPath: 'main.py',
      }),
    );

    // Files land at /workspace/code/<path>.
    const main = await readFile(join(hostDir, 'code', 'main.py'), 'utf8');
    expect(main).toBe('print("user main")');
    const helpers = await readFile(join(hostDir, 'code', 'helpers.py'), 'utf8');
    expect(helpers).toBe('X = 1');

    // No /workspace/.tale/ in single-script mode.
    let taleExists = true;
    try {
      await stat(join(hostDir, '.tale'));
    } catch {
      taleExists = false;
    }
    expect(taleExists).toBe(false);
  });

  test('multi-step mode writes the wrapper at /workspace/.tale/runner.py and leaves user files untouched', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        files: [
          // Critically: user file named main.py — the leaky-abstraction
          // regression gate. The wrapper must NOT overwrite it.
          { path: 'main.py', content: 'print("user generator")' },
          { path: 'test.py', content: 'print("user validator")' },
        ],
        entryPath: undefined,
        steps: ['main.py', 'test.py'],
      }),
    );

    // User's main.py survives intact.
    const userMain = await readFile(join(hostDir, 'code', 'main.py'), 'utf8');
    expect(userMain).toBe('print("user generator")');
    const userTest = await readFile(join(hostDir, 'code', 'test.py'), 'utf8');
    expect(userTest).toBe('print("user validator")');

    // Wrapper lands in /workspace/.tale/, NOT /workspace/code/.
    const wrapper = await readFile(join(hostDir, '.tale', 'runner.py'), 'utf8');
    expect(wrapper).toContain('Tale multi-step wrapper');
    expect(wrapper).toContain('"main.py"');
    expect(wrapper).toContain('"test.py"');

    // /workspace/code/ only contains user files + packages.json + options.json.
    const codeEntries = await readdir(join(hostDir, 'code'));
    expect(codeEntries.sort()).toEqual(
      ['main.py', 'options.json', 'packages.json', 'test.py'].sort(),
    );
    // /workspace/.tale/ only contains the wrapper.
    const taleEntries = await readdir(join(hostDir, '.tale'));
    expect(taleEntries).toEqual(['runner.py']);
  });

  test('multi-step mode for node language writes runner.js', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        language: 'node',
        files: [
          { path: 'main.js', content: 'console.log("gen")' },
          { path: 'test.js', content: 'console.log("validate")' },
        ],
        entryPath: undefined,
        steps: ['main.js', 'test.js'],
      }),
    );

    const wrapper = await readFile(join(hostDir, '.tale', 'runner.js'), 'utf8');
    expect(wrapper).toContain('Tale multi-step wrapper');
    expect(wrapper).toContain('"main.js"');
  });

  test('polyglot mode writes runner.py + packages-{python,node}.json with per-bucket specs', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        language: 'polyglot',
        files: [
          { path: 'gen.js', content: 'console.log("gen")' },
          { path: 'qa.py', content: 'print("qa")' },
        ],
        entryPath: undefined,
        steps: ['gen.js', 'qa.py'],
        packagesByLang: {
          python: ['markitdown[pptx]==0.0.1a3'],
          node: ['pptxgenjs@3.12.0'],
        },
      }),
    );

    // Polyglot uses the Python-hosted dispatcher.
    const wrapper = await readFile(join(hostDir, '.tale', 'runner.py'), 'utf8');
    expect(wrapper).toContain('Tale polyglot multi-step wrapper');
    expect(wrapper).toContain('interpreter_for');
    expect(wrapper).toContain('"gen.js"');
    expect(wrapper).toContain('"qa.py"');

    const pyPkgs = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages-python.json'), 'utf8'),
    );
    expect(pyPkgs).toEqual(['markitdown[pptx]==0.0.1a3']);
    const nodePkgs = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages-node.json'), 'utf8'),
    );
    expect(nodePkgs).toEqual(['pptxgenjs@3.12.0']);
    // Legacy packages.json is empty in polyglot mode — the entrypoint
    // reads packages-python.json / packages-node.json directly.
    const legacy = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages.json'), 'utf8'),
    );
    expect(legacy).toEqual([]);
  });

  test('packages.json and options.json land in /workspace/code/ alongside user files', async () => {
    await stageIgnoringChown(
      hostDir,
      baseReq({
        packages: ['numpy', 'pandas'],
        options: { allowSdist: false, allowInstallScripts: false },
      }),
    );

    const pkgs = JSON.parse(
      await readFile(join(hostDir, 'code', 'packages.json'), 'utf8'),
    );
    expect(pkgs).toEqual(['numpy', 'pandas']);
    const opts = JSON.parse(
      await readFile(join(hostDir, 'code', 'options.json'), 'utf8'),
    );
    expect(opts).toEqual({ allowSdist: false, allowInstallScripts: false });
  });
});
