// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Replace the Convex function builders with identity functions so the loaded
// action is the plain `{ args, returns, handler }` config object.
vi.mock('../../_generated/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    internalAction: (config: Record<string, unknown>) => config,
  };
});

type Handler = {
  handler: (
    ctx: unknown,
    args: Record<string, never>,
  ) => Promise<{ ok: boolean; issueCount: number; filesValidated: number }>;
};

async function run(): Promise<{
  ok: boolean;
  issueCount: number;
  filesValidated: number;
}> {
  const mod = (await import('./validate_builtin_catalog')) as unknown as {
    validateBuiltinCatalog: Handler;
  };
  return mod.validateBuiltinCatalog.handler({}, {});
}

let catalogRoot: string;

beforeEach(async () => {
  catalogRoot = await mkdtemp(path.join(tmpdir(), 'builtin-catalog-'));
  vi.stubEnv('TALE_CONFIG_BUILTIN_DIR', catalogRoot);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(catalogRoot, { recursive: true, force: true });
});

describe('validateBuiltinCatalog', () => {
  it('accepts a valid governance catalog', async () => {
    const gov = path.join(catalogRoot, 'governance');
    await mkdir(gov, { recursive: true });
    await writeFile(
      path.join(gov, 'password-policy.yml'),
      'minLength: 12\nrequireUpper: true\nrequireLower: true\nrequireDigit: true\nrequireSpecial: true\nrotationDays: 0\n',
    );
    await writeFile(
      path.join(gov, 'retention.yml'),
      'auditLog:\n  min: 365\n  max: 3650\n  default: 400\n  unit: days\n',
    );
    expect(await run()).toEqual({ ok: true, issueCount: 0, filesValidated: 2 });
  });

  it('flags files no schema claims (registry-completeness posture)', async () => {
    const gov = path.join(catalogRoot, 'governance');
    await mkdir(gov, { recursive: true });
    await writeFile(path.join(gov, 'not-a-policy.yml'), 'enabled: true\n');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.issueCount).toBe(1);
  });

  it('flags schema-invalid content, stray .json, and subdirectories', async () => {
    const gov = path.join(catalogRoot, 'governance');
    await mkdir(path.join(gov, 'nested'), { recursive: true });
    await writeFile(path.join(gov, 'password-policy.yml'), 'minLength: 2\n');
    await writeFile(path.join(gov, 'budgets.json'), '{}\n');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.issueCount).toBe(3);
  });

  it('reports a missing governance dir as an issue', async () => {
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.issueCount).toBe(1);
  });

  it('reports failure when no catalog root resolves', async () => {
    // A set-but-relative env refuses rather than guessing at a root.
    vi.stubEnv('TALE_CONFIG_BUILTIN_DIR', 'relative/path');
    const result = await run();
    expect(result).toEqual({ ok: false, issueCount: 0, filesValidated: 0 });
  });

  it('validates the shipped repo catalog via the env-unset fallback', async () => {
    // Empty env → resolution falls back to the repo checkout's
    // configs/platform/custom (found from the vitest working directory) —
    // proving the 22 governance seeds this repo ships are all valid.
    vi.stubEnv('TALE_CONFIG_BUILTIN_DIR', '');
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.filesValidated).toBe(22);
  });
});
