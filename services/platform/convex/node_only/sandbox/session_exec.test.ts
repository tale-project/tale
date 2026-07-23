// Inline-snippet staging contract (pure functions), the executeCodeInSession
// arg mutex, runStepsInSession's install semantics — pip/npm exit codes
// must fail the run (INSTALL_FAILED) and installs get their own floored
// budget — plus the workspace staging plan's lane routing and the harvest's
// per-file skip semantics. The session wire is mocked at the session_client
// boundary, the same seam the crawler render tests use.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../_generated/server';

const drainSessionExecResilient = vi.fn();
const sessionListFiles = vi.fn();
const sessionReadFile = vi.fn();

vi.mock('./helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) =>
    drainSessionExecResilient(...args),
  sessionDeleteFiles: vi.fn(),
  sessionListFiles: (...args: unknown[]) => sessionListFiles(...args),
  sessionReadFile: (...args: unknown[]) => sessionReadFile(...args),
  sessionStageFiles: vi.fn(),
}));

const readBlobBytes = vi.fn();
const putBlob = vi.fn();
const deleteBlob = vi.fn();

vi.mock('../../lib/storage/blob_access', () => ({
  readBlobBytes: (...args: unknown[]) => readBlobBytes(...args),
  putBlob: (...args: unknown[]) => putBlob(...args),
  deleteBlob: (...args: unknown[]) => deleteBlob(...args),
}));

const orgSlugFromIdOrNull = vi.fn();

vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: (...args: unknown[]) => orgSlugFromIdOrNull(...args),
}));

import {
  execInputsError,
  inlineStagePath,
  planWorkspaceStaging,
  runAndHarvestInSession,
  runStepsInSession,
  stagePathOf,
  type WorkspaceStageRow,
} from './session_exec';

describe('inlineStagePath', () => {
  it('routes each language to the extension the runtime dispatches on', () => {
    expect(inlineStagePath('python', 'abc')).toBe('code/.inline/run-abc.py');
    expect(inlineStagePath('node', 'abc')).toBe('code/.inline/run-abc.mjs');
    expect(inlineStagePath('bash', 'abc')).toBe('code/.inline/run-abc.sh');
  });

  it('stages under the hidden code/.inline/ dir, unique per run id', () => {
    const a = inlineStagePath('bash', 'id-a');
    const b = inlineStagePath('bash', 'id-b');
    expect(a.startsWith('code/.inline/')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('round-trips through stagePathOf like every other step path', () => {
    const rel = inlineStagePath('python', 'x');
    expect(stagePathOf(`/user/${rel}`)).toBe(rel);
  });
});

describe('execInputsError', () => {
  it('accepts script, inline, and install-only combinations', () => {
    expect(execInputsError({ stepPaths: ['/user/code/a.py'] })).toBeNull();
    expect(
      execInputsError({ stepPaths: [], inlineCode: { content: 'x' } }),
    ).toBeNull();
    expect(
      execInputsError({
        stepPaths: [],
        packagesByLang: { python: ['pandas'] },
      }),
    ).toBeNull();
  });

  it('rejects steps + inline together and the fully-empty call', () => {
    expect(
      execInputsError({
        stepPaths: ['/user/code/a.py'],
        inlineCode: { content: 'x' },
      }),
    ).toContain('not both');
    expect(execInputsError({ stepPaths: [] })).toContain('requires');
    // Declared-but-empty package buckets don't make an empty call executable.
    expect(
      execInputsError({ stepPaths: [], packagesByLang: { python: [] } }),
    ).toContain('requires');
  });
});

function execResult(over: Partial<Record<string, unknown>> = {}) {
  return {
    status: 'completed',
    exitCode: 0,
    durationMs: 5,
    stdoutBase64: Buffer.from('').toString('base64'),
    stderrBase64: Buffer.from('').toString('base64'),
    truncated: { stdout: false, stderr: false },
    ...over,
  };
}

function callArg(call: number): {
  command: string[];
  timeoutMs: number;
  cwd: string;
} {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test helper over the mocked wire body
  return drainSessionExecResilient.mock.calls[call][1] as {
    command: string[];
    timeoutMs: number;
    cwd: string;
  };
}

describe('runStepsInSession — install semantics', () => {
  beforeEach(() => {
    drainSessionExecResilient.mockReset();
  });

  it('runs a packages-only call to completed and surfaces installer stdout', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({
        stdoutBase64: Buffer.from(
          'Successfully installed pandas-2.2.1\n',
        ).toString('base64'),
      }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['pandas'] },
    });
    expect(run.status).toBe('completed');
    expect(run.exitCode).toBe(0);
    expect(run.errorCode).toBeUndefined();
    expect(run.stdout).toContain('Successfully installed pandas-2.2.1');
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
    expect(callArg(0).command).toEqual([
      'python3',
      '-m',
      'pip',
      'install',
      '--no-input',
      'pandas',
    ]);
    // Installs run from the workspace root — /user/code may not exist yet on
    // a fresh session with nothing staged, and runnerd rejects a missing cwd.
    expect(callArg(0).cwd).toBe('/user');
  });

  it('fails the run when pip exits non-zero: INSTALL_FAILED, nothing else runs', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({
        exitCode: 1,
        stderrBase64: Buffer.from(
          'ERROR: No matching distribution found for nope\n',
        ).toString('base64'),
      }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      packagesByLang: { python: ['nope'], node: ['sharp'] },
    });
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('INSTALL_FAILED');
    expect(run.errorMessage).toContain('pip install failed (exit 1)');
    expect(run.stderr).toContain('No matching distribution');
    // Short-circuit: neither the npm install nor the step ran.
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
  });

  it('fails on npm after a clean pip and names the failing tool', async () => {
    drainSessionExecResilient
      .mockResolvedValueOnce(execResult())
      .mockResolvedValueOnce(execResult({ exitCode: 127 }));
    const run = await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['pandas'], node: ['sharp'] },
    });
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('INSTALL_FAILED');
    expect(run.errorMessage).toContain('npm install failed (exit 127)');
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(2);
  });

  it('treats a non-completed install status as INSTALL_FAILED even with exit 0', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({ status: 'failed', errorCode: 'TIMEOUT' }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['torch'] },
    });
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('INSTALL_FAILED');
    expect(run.errorMessage).toContain('TIMEOUT');
  });

  it('floors the install budget at 120s while the step keeps its own timeout', async () => {
    drainSessionExecResilient.mockResolvedValue(execResult());
    await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      packagesByLang: { python: ['pandas'] },
      timeoutMs: 30_000,
    });
    expect(callArg(0).timeoutMs).toBe(120_000);
    expect(callArg(1).timeoutMs).toBe(30_000);
    expect(callArg(1).command).toEqual(['python3', '/user/code/a.py']);
    expect(callArg(0).cwd).toBe('/user');
    expect(callArg(1).cwd).toBe('/user/code');
  });

  it('keeps a caller-raised timeout for the install too, capped at 300s', async () => {
    drainSessionExecResilient.mockResolvedValue(execResult());
    await runStepsInSession('sid', {
      stepPaths: [],
      packagesByLang: { python: ['torch'] },
      timeoutMs: 240_000,
    });
    expect(callArg(0).timeoutMs).toBe(240_000);
  });

  it('does not add install execs for package-less callers (workflow/crawler path)', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({
        stdoutBase64: Buffer.from('hello\n').toString('base64'),
      }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      timeoutMs: 45_000,
    });
    expect(run.status).toBe('completed');
    expect(run.stdout).toBe('hello\n');
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
    expect(callArg(0).command).toEqual(['python3', '/user/code/a.py']);
    expect(callArg(0).timeoutMs).toBe(45_000);
  });

  it('keeps install noise out of a successful script run stdout', async () => {
    drainSessionExecResilient
      .mockResolvedValueOnce(
        execResult({
          stdoutBase64: Buffer.from(
            'Collecting pandas\nSuccessfully installed pandas-2.2.1\n',
          ).toString('base64'),
        }),
      )
      .mockResolvedValueOnce(
        execResult({
          stdoutBase64: Buffer.from('report written\n').toString('base64'),
        }),
      );
    const run = await runStepsInSession('sid', {
      stepPaths: ['/user/code/a.py'],
      packagesByLang: { python: ['pandas'] },
    });
    expect(run.stdout).toBe('report written\n');
  });
});

const HMAC_ENV = 'WEBDAV_APP_PASSWORD_HMAC_KEY';
const ORG = 'org-1';

function stageRow(over: Partial<WorkspaceStageRow>): WorkspaceStageRow {
  return {
    organizationId: ORG,
    path: '/user/uploads/a.txt',
    storageId: 'kg-convex-id',
    size: 5,
    source: 'user_upload',
    ...over,
  };
}

function stagingCtx(getUrl: (id: string) => Promise<string | null>) {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `storage.getUrl` is exercised by the plan
  return { storage: { getUrl } } as unknown as ActionCtx;
}

describe('planWorkspaceStaging — lane routing', () => {
  beforeEach(() => {
    readBlobBytes.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('stages a _storage blob by its alias-rewritten capability URL', async () => {
    const ctx = stagingCtx(async () => 'http://127.0.0.1:3210/api/storage/u1');
    const plan = await planWorkspaceStaging(ctx, [stageRow({})], {
      organizationId: ORG,
      includeRunOutputs: true,
      stageOrgSlug: 'acme',
    });
    expect(plan.toStage).toEqual([
      { path: 'uploads/a.txt', url: 'http://convex:3210/api/storage/u1' },
    ]);
    expect(plan.stagingSkipped).toEqual([]);
  });

  it('reports a purged _storage blob instead of dropping it silently', async () => {
    const ctx = stagingCtx(async () => null);
    const plan = await planWorkspaceStaging(ctx, [stageRow({})], {
      organizationId: ORG,
      includeRunOutputs: true,
      stageOrgSlug: 'acme',
    });
    expect(plan.toStage).toEqual([]);
    expect(plan.stagingSkipped).toEqual([
      { path: '/user/uploads/a.txt', reason: 'stored bytes are missing' },
    ]);
  });

  it('stages an org-bucket blob via the token-gated stream route', async () => {
    vi.stubEnv(HMAC_ENV, 'ab'.repeat(32));
    const ctx = stagingCtx(async () => {
      throw new Error('getUrl must not be called for an s3 ref');
    });
    const plan = await planWorkspaceStaging(
      ctx,
      [
        stageRow({
          path: '/user/uploads/big.bin',
          storageId: 's3:acme/big-object',
          size: 30 * 1024 * 1024,
        }),
      ],
      { organizationId: ORG, includeRunOutputs: true, stageOrgSlug: 'acme' },
    );
    expect(plan.stagingSkipped).toEqual([]);
    expect(plan.toStage).toHaveLength(1);
    expect(plan.toStage[0].path).toBe('uploads/big.bin');
    expect(plan.toStage[0].url).toMatch(
      /^http:\/\/convex:3211\/api\/sandbox-blob\?token=/,
    );
  });

  it('falls back to bounded inline base64 when no stage-token key exists', async () => {
    vi.stubEnv(HMAC_ENV, '');
    readBlobBytes.mockResolvedValue(new TextEncoder().encode('hello'));
    const ctx = stagingCtx(async () => null);
    const plan = await planWorkspaceStaging(
      ctx,
      [
        stageRow({
          path: '/user/uploads/small.bin',
          storageId: 's3:acme/small-object',
          size: 5,
        }),
        stageRow({
          path: '/user/uploads/big.bin',
          storageId: 's3:acme/big-object',
          size: 2 * 1024 * 1024,
        }),
      ],
      { organizationId: ORG, includeRunOutputs: true, stageOrgSlug: 'acme' },
    );
    expect(plan.toStage).toEqual([
      {
        path: 'uploads/small.bin',
        contentBase64: Buffer.from('hello').toString('base64'),
      },
    ]);
    expect(plan.stagingSkipped).toHaveLength(1);
    expect(plan.stagingSkipped[0].path).toBe('/user/uploads/big.bin');
    expect(plan.stagingSkipped[0].reason).toContain('inline staging cap');
  });

  it('reports unresolvable orgs and failed bucket reads as skips', async () => {
    vi.stubEnv(HMAC_ENV, '');
    readBlobBytes.mockRejectedValue(new Error('bucket down'));
    const ctx = stagingCtx(async () => null);
    const noSlug = await planWorkspaceStaging(
      ctx,
      [stageRow({ storageId: 's3:acme/x', size: 5 })],
      { organizationId: ORG, includeRunOutputs: true, stageOrgSlug: null },
    );
    expect(noSlug.stagingSkipped[0].reason).toContain('unresolvable');
    const readFail = await planWorkspaceStaging(
      ctx,
      [stageRow({ storageId: 's3:acme/x', size: 5 })],
      { organizationId: ORG, includeRunOutputs: true, stageOrgSlug: 'acme' },
    );
    expect(readFail.stagingSkipped[0].reason).toContain(
      'reading the org-bucket bytes failed',
    );
  });

  it('filters cross-org rows and warm-session run_outputs entirely', async () => {
    const ctx = stagingCtx(async () => 'http://127.0.0.1:3210/api/storage/u1');
    const plan = await planWorkspaceStaging(
      ctx,
      [
        stageRow({ organizationId: 'someone-else' }),
        stageRow({ path: '/user/output/old.txt', source: 'run_output' }),
        stageRow({ path: '/user/code/gen.py', source: 'agent_write' }),
      ],
      { organizationId: ORG, includeRunOutputs: false, stageOrgSlug: 'acme' },
    );
    expect(plan.toStage.map((f) => f.path)).toEqual(['code/gen.py']);
    expect(plan.stagingSkipped).toEqual([]);
  });
});

function harvestCtx(over: {
  runQuery?: ReturnType<typeof vi.fn>;
  runMutation?: ReturnType<typeof vi.fn>;
  store?: ReturnType<typeof vi.fn>;
  storageDelete?: ReturnType<typeof vi.fn>;
}) {
  const ctx = {
    runQuery: over.runQuery ?? vi.fn().mockResolvedValue(null),
    runMutation:
      over.runMutation ??
      vi.fn().mockResolvedValue({ id: 'row', replaced: false }),
    storage: {
      store: over.store ?? vi.fn().mockResolvedValue('kg-stored'),
      delete: over.storageDelete ?? vi.fn(),
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- harvest touches only these ctx members
  return ctx as unknown as ActionCtx;
}

function outputEntry(name: string, size = 5) {
  return { name, type: 'file' as const, size, mtimeMs: 0 };
}

function textBytes(s: string): { bytes: ArrayBuffer; contentType: string } {
  const encoded = new TextEncoder().encode(s);
  const buf = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buf).set(encoded);
  return { bytes: buf, contentType: 'text/plain' };
}

describe('runAndHarvestInSession — per-file harvest skips', () => {
  beforeEach(() => {
    drainSessionExecResilient.mockReset();
    drainSessionExecResilient.mockResolvedValue(execResult());
    sessionListFiles.mockReset();
    sessionReadFile.mockReset();
    orgSlugFromIdOrNull.mockReset();
    orgSlugFromIdOrNull.mockResolvedValue(null);
  });

  const runArgs = {
    organizationId: ORG,
    workspaceThreadId: 'thread-1',
    sessionId: 'sid',
    stepPaths: ['/user/code/a.py'],
  };

  it('skips an over-cap output without reading it and keeps the run green', async () => {
    sessionListFiles.mockResolvedValue([
      outputEntry('big.bin', 25 * 1024 * 1024),
      outputEntry('ok.txt'),
    ]);
    sessionReadFile.mockResolvedValue(textBytes('hello'));
    const ctx = harvestCtx({});
    const run = await runAndHarvestInSession(ctx, runArgs);
    expect(run.status).toBe('completed');
    expect(run.files.map((f) => f.path)).toEqual(['/user/output/ok.txt']);
    expect(run.harvestSkipped).toHaveLength(1);
    expect(run.harvestSkipped?.[0].path).toBe('/user/output/big.bin');
    expect(run.harvestSkipped?.[0].reason).toContain('20.0 MB');
    // The oversize file was never pulled across the wire.
    expect(sessionReadFile).toHaveBeenCalledTimes(1);
  });

  it('turns a store rejection into a skip, not a run failure', async () => {
    // The post-copy failure point this case originally exercised (the
    // thread-file mirror write) is skipped while the chat backend is
    // rebuilt, so the catch's orphan-reap branch is dormant — the only
    // rejection left happens IN the store itself, before any blob lands.
    // The contract that matters survives: one file's failure records a
    // skip and never fails the run or the sibling file.
    sessionListFiles.mockResolvedValue([
      outputEntry('a.txt'),
      outputEntry('b.txt'),
    ]);
    sessionReadFile
      .mockResolvedValueOnce(textBytes('content-a'))
      .mockResolvedValueOnce(textBytes('content-b'));
    const store = vi
      .fn()
      .mockRejectedValueOnce(new Error('Workspace would exceed the byte cap.'))
      .mockResolvedValueOnce('kg-b');
    const storageDelete = vi.fn();
    const ctx = harvestCtx({ store, storageDelete });
    const run = await runAndHarvestInSession(ctx, runArgs);
    expect(run.status).toBe('completed');
    expect(run.files.map((f) => f.path)).toEqual(['/user/output/b.txt']);
    expect(run.harvestSkipped).toHaveLength(1);
    expect(run.harvestSkipped?.[0].path).toBe('/user/output/a.txt');
    expect(run.harvestSkipped?.[0].reason).toContain(
      'not saved to the workspace',
    );
    // Nothing to reap: the rejected store never produced a blob, and b.txt's
    // blob stays.
    expect(storageDelete).not.toHaveBeenCalled();
  });

  it('reports files beyond the per-run cap and unreadable files', async () => {
    const many = Array.from({ length: 18 }, (_, i) => outputEntry(`f${i}.txt`));
    sessionListFiles.mockResolvedValue(many);
    sessionReadFile.mockImplementation(async (_sid: string, path: string) =>
      path === '/user/output/f3.txt' ? null : textBytes('x'),
    );
    const ctx = harvestCtx({});
    const run = await runAndHarvestInSession(ctx, runArgs);
    expect(run.status).toBe('completed');
    // The 16-slot cap counts HARVESTED files: f3's read failure frees a slot,
    // so 16 of the remaining 17 land and the last (f17) reports the cap.
    expect(run.files).toHaveLength(16);
    expect(run.harvestSkipped).toHaveLength(2);
    expect(
      run.harvestSkipped?.find((s) => s.path === '/user/output/f3.txt')?.reason,
    ).toContain('read from sandbox failed');
    expect(
      run.harvestSkipped?.find((s) => s.path === '/user/output/f17.txt')
        ?.reason,
    ).toContain('per-run harvest cap');
  });
});
