import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the codegen surface so `internalAction(config)` returns the config
// itself, exposing `.handler` for direct invocation — matches the pattern
// used by organizations/scaffold.test.ts.
vi.mock('../../_generated/server', () => ({
  internalAction: vi.fn((config) => config),
}));

const { validateBuiltinCatalog } = await import('./validate_builtin_catalog');

type ActionConfig = {
  handler: (
    ctx: never,
    args: Record<string, never>,
  ) => Promise<{ ok: boolean; issueCount: number; filesValidated: number }>;
};
const handler = (validateBuiltinCatalog as unknown as ActionConfig).handler;

async function writeJson(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf-8');
}

let builtinDir: string;
const savedEnv: { TALE_CONFIG_BUILTIN_DIR?: string } = {};

beforeEach(async () => {
  savedEnv.TALE_CONFIG_BUILTIN_DIR = process.env.TALE_CONFIG_BUILTIN_DIR;
  builtinDir = await mkdtemp(path.join(tmpdir(), 'validate-builtin-catalog-'));
  process.env.TALE_CONFIG_BUILTIN_DIR = builtinDir;
});

afterEach(async () => {
  if (savedEnv.TALE_CONFIG_BUILTIN_DIR === undefined) {
    delete process.env.TALE_CONFIG_BUILTIN_DIR;
  } else {
    process.env.TALE_CONFIG_BUILTIN_DIR = savedEnv.TALE_CONFIG_BUILTIN_DIR;
  }
  await rm(builtinDir, { recursive: true, force: true });
});

describe('validateBuiltinCatalog', () => {
  it('is non-fatal (never throws) and reports ok:false + the issue count for a broken catalog', async () => {
    await writeJson(
      path.join(builtinDir, 'providers', 'broken.json'),
      '{"oops":true}',
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let result: Awaited<ReturnType<typeof handler>>;
    try {
      result = await handler({} as never, {});
    } finally {
      errSpy.mockRestore();
    }

    expect(result.ok).toBe(false);
    expect(result.issueCount).toBeGreaterThan(0);
  });

  it('reports issues (not ok) for an empty catalog dir — every scaffolded domain is missing', async () => {
    // No files at all — every catalog-scaffolded domain dir is absent, which
    // `validateConfigDir` flags as an issue. Confirms the non-fatal shape
    // (a resolved result, never a throw) even when nothing validates.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await handler({} as never, {});
      expect(result.ok).toBe(false);
      expect(result.issueCount).toBeGreaterThan(0);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('skips validation (ok:false, zero issues) when TALE_CONFIG_BUILTIN_DIR is unset', async () => {
    delete process.env.TALE_CONFIG_BUILTIN_DIR;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let result: Awaited<ReturnType<typeof handler>>;
    try {
      result = await handler({} as never, {});
    } finally {
      errSpy.mockRestore();
    }

    expect(result).toEqual({ ok: false, issueCount: 0, filesValidated: 0 });
  });
});
