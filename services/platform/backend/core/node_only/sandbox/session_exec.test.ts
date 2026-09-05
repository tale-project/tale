// runStepsInSession's run semantics — the staged steps run from /agent/code
// with the caller's timeout — plus the harvest's per-file skip semantics and
// its fail-loud rule for an org whose bucket cannot be resolved. The session
// wire is mocked at the session_client boundary, the same seam the crawler
// render tests use.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';

const drainSessionExecResilient = vi.fn();
const sessionIsAlive = vi.fn();
const sessionListFiles = vi.fn();
const sessionReadFile = vi.fn();

vi.mock('./helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) =>
    drainSessionExecResilient(...args),
  sessionIsAlive: (...args: unknown[]) => sessionIsAlive(...args),
  sessionListFiles: (...args: unknown[]) => sessionListFiles(...args),
  sessionReadFile: (...args: unknown[]) => sessionReadFile(...args),
}));

const putBlob = vi.fn();
const deleteBlob = vi.fn();

vi.mock('../../lib/storage/blob_access', () => ({
  putBlob: (...args: unknown[]) => putBlob(...args),
  deleteBlob: (...args: unknown[]) => deleteBlob(...args),
}));

const orgSlugFromIdOrNull = vi.fn();

vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromIdOrNull: (...args: unknown[]) => orgSlugFromIdOrNull(...args),
}));

import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import { harvestSessionOutput, runStepsInSession } from './session_exec';

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

describe('runStepsInSession — run semantics', () => {
  beforeEach(() => {
    drainSessionExecResilient.mockReset();
  });

  it('runs each staged step from /agent/code with the caller timeout', async () => {
    drainSessionExecResilient.mockResolvedValue(
      execResult({
        stdoutBase64: Buffer.from('hello\n').toString('base64'),
      }),
    );
    const run = await runStepsInSession('sid', {
      stepPaths: ['/agent/code/a.py'],
      timeoutMs: 45_000,
    });
    expect(run.status).toBe('completed');
    expect(run.stdout).toBe('hello\n');
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
    expect(callArg(0).command).toEqual(['python3', '/agent/code/a.py']);
    expect(callArg(0).timeoutMs).toBe(45_000);
    expect(callArg(0).cwd).toBe('/agent/code');
  });

  it('stops at the first failing step and reports its exit code', async () => {
    drainSessionExecResilient
      .mockResolvedValueOnce(execResult({ exitCode: 2 }))
      .mockResolvedValueOnce(execResult());
    const run = await runStepsInSession('sid', {
      stepPaths: ['/agent/code/a.py', '/agent/code/b.js'],
    });
    expect(run.status).toBe('failed');
    expect(run.exitCode).toBe(2);
    expect(drainSessionExecResilient).toHaveBeenCalledTimes(1);
  });
});

const ORG = 'org-1';

function harvestCtx(over: {
  runQuery?: ReturnType<typeof vi.fn>;
  runMutation?: ReturnType<typeof vi.fn>;
}) {
  const ctx = {
    runQuery: over.runQuery ?? vi.fn().mockResolvedValue(null),
    runMutation:
      over.runMutation ??
      vi.fn().mockResolvedValue({ id: 'row', replaced: false }),
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

describe('harvestSessionOutput — per-file harvest skips', () => {
  beforeEach(() => {
    sessionIsAlive.mockReset();
    sessionListFiles.mockReset();
    sessionReadFile.mockReset();
    orgSlugFromIdOrNull.mockReset();
    orgSlugFromIdOrNull.mockResolvedValue('acme');
    putBlob.mockReset();
    putBlob.mockResolvedValue('s3:acme/blob');
    deleteBlob.mockReset();
  });

  const harvestArgs = { organizationId: ORG, sessionId: 'sid' };

  it('fails LOUD before touching the session when the org has no bucket', async () => {
    // The org bucket is the only store harvested outputs have. An org whose
    // slug does not resolve was deleted mid-run — skipping every file would
    // launder that into "produced nothing".
    orgSlugFromIdOrNull.mockResolvedValue(null);
    const ctx = harvestCtx({});
    await expect(harvestSessionOutput(ctx, harvestArgs)).rejects.toThrow(
      /does not resolve to a slug/,
    );
    expect(sessionListFiles).not.toHaveBeenCalled();
    expect(putBlob).not.toHaveBeenCalled();
  });

  it('stores every harvested file in the org bucket', async () => {
    sessionListFiles.mockResolvedValue([outputEntry('a.txt')]);
    sessionReadFile.mockResolvedValue(textBytes('hello'));
    const ctx = harvestCtx({});
    const { files } = await harvestSessionOutput(ctx, harvestArgs);
    expect(files).toHaveLength(1);
    expect(files[0]?.storageId).toBe('s3:acme/blob');
    expect(putBlob).toHaveBeenCalledTimes(1);
    expect(putBlob.mock.calls[0]?.[1]).toBe('acme');
  });

  it('treats a subdir 404 on a LIVE session as a legitimately empty harvest', async () => {
    // A turn that wrote nothing never created its output subdir — that is an
    // empty delivery, not an infra fault (the loud-404 rule guards only the
    // pre-created top-level box). Throwing here once wedged every no-output
    // agent turn at settle time. The aliveness probe is what separates this
    // from a dead session, whose 404 looks identical on the wire.
    sessionListFiles.mockResolvedValue(null);
    sessionIsAlive.mockResolvedValue(true);
    const ctx = harvestCtx({});
    const { files, harvestSkipped } = await harvestSessionOutput(ctx, {
      ...harvestArgs,
      outputDir: '/agent/output/turn-abc',
    });
    expect(files).toEqual([]);
    expect(harvestSkipped).toEqual([]);
    expect(sessionIsAlive).toHaveBeenCalledWith('sid');
  });

  it('fails LOUD on a subdir 404 when the session is gone — never an empty delivery', async () => {
    // The same wire response as "the turn wrote nothing" — but the session
    // died, so its deliverables were lost. A clean empty settle here would
    // launder the infra fault into "produced nothing".
    sessionListFiles.mockResolvedValue(null);
    sessionIsAlive.mockResolvedValue(false);
    const ctx = harvestCtx({});
    await expect(
      harvestSessionOutput(ctx, {
        ...harvestArgs,
        outputDir: '/agent/output/turn-abc',
      }),
    ).rejects.toThrow(/session is gone/);
  });

  it('fails LOUD when the output listing 404s — never an empty delivery', async () => {
    // A 404 at harvest time means the session/delivery box vanished; the
    // entrypoint pre-creates /agent/output, so this is never "no outputs".
    // Swallowing it once laundered a passing run into "produced nothing".
    sessionListFiles.mockResolvedValue(null);
    const ctx = harvestCtx({});
    await expect(harvestSessionOutput(ctx, harvestArgs)).rejects.toThrow(/404/);
  });

  it('fails LOUD when the box 404s during the empty-listing retry', async () => {
    // First read succeeded (empty), then the session died before the
    // read-after-write retry — the `?? []` that once sat here settled that
    // as a clean empty delivery.
    sessionListFiles.mockResolvedValueOnce([]).mockResolvedValueOnce(null);
    const ctx = harvestCtx({});
    await expect(harvestSessionOutput(ctx, harvestArgs)).rejects.toThrow(
      /mid-harvest/,
    );
  });

  it('skips an over-cap output without reading it and keeps the harvest green', async () => {
    sessionListFiles.mockResolvedValue([
      outputEntry('big.bin', 25 * 1024 * 1024),
      outputEntry('ok.txt'),
    ]);
    sessionReadFile.mockResolvedValue(textBytes('hello'));
    const ctx = harvestCtx({});
    const { files, harvestSkipped } = await harvestSessionOutput(
      ctx,
      harvestArgs,
    );
    expect(files.map((f) => f.path)).toEqual(['/agent/output/ok.txt']);
    expect(harvestSkipped).toHaveLength(1);
    expect(harvestSkipped[0]?.path).toBe('/agent/output/big.bin');
    expect(harvestSkipped[0]?.reason).toContain('20.0 MB');
    // The oversize file was never pulled across the wire.
    expect(sessionReadFile).toHaveBeenCalledTimes(1);
  });

  it('turns a store rejection into a skip, not a harvest failure', async () => {
    // One file's storage failure records a skip and never fails the harvest
    // or the sibling file.
    sessionListFiles.mockResolvedValue([
      outputEntry('a.txt'),
      outputEntry('b.txt'),
    ]);
    sessionReadFile
      .mockResolvedValueOnce(textBytes('content-a'))
      .mockResolvedValueOnce(textBytes('content-b'));
    putBlob
      .mockRejectedValueOnce(new Error('Workspace would exceed the byte cap.'))
      .mockResolvedValueOnce('s3:acme/b');
    const ctx = harvestCtx({});
    const { files, harvestSkipped } = await harvestSessionOutput(
      ctx,
      harvestArgs,
    );
    expect(files.map((f) => f.path)).toEqual(['/agent/output/b.txt']);
    expect(harvestSkipped).toHaveLength(1);
    expect(harvestSkipped[0]?.path).toBe('/agent/output/a.txt');
    expect(harvestSkipped[0]?.reason).toContain('not saved to the workspace');
    // Nothing to reap: the rejected store never produced a blob, and b.txt's
    // blob stays.
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it('renews the turn lease once per file when the settle names its exec', async () => {
    sessionListFiles.mockResolvedValue([
      outputEntry('a.txt'),
      outputEntry('b.txt'),
    ]);
    sessionReadFile.mockResolvedValue(textBytes('x'));
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = harvestCtx({ runMutation });
    await harvestSessionOutput(ctx, { ...harvestArgs, execId: 'exec-9' });
    const bumps = runMutation.mock.calls.filter(
      (call) =>
        functionRefName(call[0]) ===
        'sandbox/session_mutations:bumpSessionOpHeartbeat',
    );
    expect(bumps).toHaveLength(2);
    expect(bumps[0]?.[1]).toEqual({ sessionId: 'sid', execId: 'exec-9' });
  });

  it('leaves the lease alone when no exec is named (the script-host shape)', async () => {
    sessionListFiles.mockResolvedValue([outputEntry('a.txt')]);
    sessionReadFile.mockResolvedValue(textBytes('x'));
    const runMutation = vi.fn().mockResolvedValue(null);
    const ctx = harvestCtx({ runMutation });
    await harvestSessionOutput(ctx, harvestArgs);
    const bumps = runMutation.mock.calls.filter(
      (call) =>
        functionRefName(call[0]) ===
        'sandbox/session_mutations:bumpSessionOpHeartbeat',
    );
    expect(bumps).toHaveLength(0);
  });

  it('reports files beyond the per-run cap and unreadable files', async () => {
    // 64 is a runaway backstop, not a working budget — a real run's 18
    // legitimate files once tripped a 16 cap and lost its primary deliverable.
    const many = Array.from({ length: 66 }, (_, i) => outputEntry(`f${i}.txt`));
    sessionListFiles.mockResolvedValue(many);
    sessionReadFile.mockImplementation(async (_sid: string, path: string) =>
      path === '/agent/output/f3.txt' ? null : textBytes('x'),
    );
    const ctx = harvestCtx({});
    const { files, harvestSkipped } = await harvestSessionOutput(
      ctx,
      harvestArgs,
    );
    // The 64-slot cap counts HARVESTED files: f3's read failure frees a slot,
    // so 64 of the remaining 65 land and the last (f65) reports the cap.
    expect(files).toHaveLength(64);
    expect(harvestSkipped).toHaveLength(2);
    expect(
      harvestSkipped.find((s) => s.path === '/agent/output/f3.txt')?.reason,
    ).toContain('read from sandbox failed');
    expect(
      harvestSkipped.find((s) => s.path === '/agent/output/f65.txt')?.reason,
    ).toContain('per-run harvest cap');
  });
});
