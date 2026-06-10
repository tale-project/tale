// Cross-backend contract test for the shared terminal-response constructors.
// Both backends route every terminal ExecuteResponse through exec-response.ts,
// so the per-outcome invariants asserted here (see the normative outcome table
// on ExecutionBackend.execute in backend/types.ts) hold for docker AND k8s
// without needing a daemon or a cluster.

import { describe, expect, test } from 'bun:test';

import {
  buildCancelled,
  buildCompleted,
  buildHarvestMissing,
  buildInfraFailure,
  buildRunnerKilled,
  buildRuntimeFailure,
  buildTimeoutBackstop,
  classifyHarvestError,
  type ResponseParts,
} from './exec-response.ts';

const parts: ResponseParts = {
  stdoutCapped: 'hello',
  stderrCapped: 'oops',
  stdoutTruncated: false,
  stderrTruncated: true,
  durationMs: 1_234,
  truncatedFiles: 2,
  outputFiles: [
    {
      name: 'a.txt',
      storageId: 'stor_1',
      size: 5,
      contentType: 'text/plain',
      sha256: 'abc',
    },
  ],
  steps: [{ path: 'a.py', status: 'completed', exitCode: 0, durationMs: 10 }],
  uploadStats: { attempted: 1, succeeded: 1, failures: [] },
  timing: { stageMs: 1, executeMs: 2, harvestMs: 3, uploadMs: 4 },
  priorStage: { staged: [], skipped: [] },
};

const noFlags = {
  quotaExhausted: false,
  uploadFailed: false,
  reportFailed: false,
  readFailed: false,
};

describe('base-field passthrough', () => {
  test('every constructor carries the identical base payload', () => {
    const responses = [
      buildCancelled(parts),
      buildCompleted(parts),
      buildRuntimeFailure(parts, 3, ''),
      buildTimeoutBackstop(parts),
      buildHarvestMissing(parts, null),
      buildRunnerKilled(parts, 137, 'OOMKilled'),
      buildInfraFailure(parts, 'daemon down'),
    ];
    for (const r of responses) {
      expect(r.stdoutBase64).toBe(Buffer.from('hello').toString('base64'));
      expect(r.stderrBase64).toBe(Buffer.from('oops').toString('base64'));
      expect(r.durationMs).toBe(1_234);
      expect(r.truncated).toEqual({ stdout: false, stderr: true, files: 2 });
      expect(r.outputFiles).toEqual(parts.outputFiles);
      expect(r.steps).toEqual(parts.steps);
      expect(r.uploadStats).toEqual(parts.uploadStats);
      expect(r.timing).toEqual(parts.timing);
      expect(r.priorStage).toEqual(parts.priorStage);
    }
  });

  test('optional fields are omitted (not undefined) when absent', () => {
    const { steps: _s, priorStage: _p, ...rest } = parts;
    const r = buildCompleted(rest);
    expect('steps' in r).toBe(false);
    expect('priorStage' in r).toBe(false);
  });
});

describe('outcome invariants', () => {
  test('cancelled ⇒ status cancelled, exitCode null, CANCELLED', () => {
    const r = buildCancelled(parts);
    expect(r.status).toBe('cancelled');
    expect(r.exitCode).toBeNull();
    expect(r.errorCode).toBe('CANCELLED');
  });

  test('completed ⇒ exit 0 and no errorCode', () => {
    const r = buildCompleted(parts);
    expect(r.status).toBe('completed');
    expect(r.exitCode).toBe(0);
    expect(r.errorCode).toBeUndefined();
  });

  test('completed + harvest error ⇒ failed but exitCode stays 0', () => {
    const r = buildCompleted(
      parts,
      classifyHarvestError({ ...noFlags, uploadFailed: true }),
    );
    expect(r.status).toBe('failed');
    expect(r.exitCode).toBe(0);
    expect(r.errorCode).toBe('UPLOAD_FAILED');
  });

  test('runtime failure ⇒ failed with the real exit code', () => {
    const r = buildRuntimeFailure(parts, 3, '');
    expect(r.status).toBe('failed');
    expect(r.exitCode).toBe(3);
    expect(r.errorCode).toBe('RUNTIME_ERROR');
  });

  test('timeout backstop ⇒ failed / 124 / TIMEOUT', () => {
    const r = buildTimeoutBackstop(parts, 'harvest container never reported');
    expect(r.status).toBe('failed');
    expect(r.exitCode).toBe(124);
    expect(r.errorCode).toBe('TIMEOUT');
    expect(r.errorMessage).toContain('Wall-clock timeout exceeded');
  });

  test('harvest missing ⇒ HARVEST_READ_FAILED with recovered exit code or null', () => {
    expect(buildHarvestMissing(parts, null).exitCode).toBeNull();
    const recovered = buildHarvestMissing(parts, 0);
    expect(recovered.exitCode).toBe(0);
    expect(recovered.errorCode).toBe('HARVEST_READ_FAILED');
    expect(recovered.status).toBe('failed');
  });

  test('runner killed ⇒ OOMKilled maps to OOM/137, others to RUNTIME_ERROR', () => {
    const oom = buildRunnerKilled(parts, 137, 'OOMKilled');
    expect(oom.errorCode).toBe('OOM');
    expect(oom.exitCode).toBe(137);
    const evicted = buildRunnerKilled(parts, 2, 'Error');
    expect(evicted.errorCode).toBe('RUNTIME_ERROR');
    expect(evicted.exitCode).toBe(2);
    expect(evicted.errorMessage).toContain('Error');
  });

  test('infra failure ⇒ SPAWNER_UNAVAILABLE with exitCode null', () => {
    const r = buildInfraFailure(parts, 'docker daemon unreachable');
    expect(r.status).toBe('failed');
    expect(r.exitCode).toBeNull();
    expect(r.errorCode).toBe('SPAWNER_UNAVAILABLE');
  });
});

describe('classifyHarvestError priority (quota > upload > report > read)', () => {
  test('orders correctly and returns undefined when clean', () => {
    expect(classifyHarvestError(noFlags)).toBeUndefined();
    expect(
      classifyHarvestError({
        quotaExhausted: true,
        uploadFailed: true,
        reportFailed: true,
        readFailed: true,
      })?.code,
    ).toBe('UPLOAD_QUOTA_EXCEEDED');
    expect(
      classifyHarvestError({
        ...noFlags,
        uploadFailed: true,
        reportFailed: true,
        readFailed: true,
      })?.code,
    ).toBe('UPLOAD_FAILED');
    expect(
      classifyHarvestError({ ...noFlags, reportFailed: true, readFailed: true })
        ?.code,
    ).toBe('UPLOAD_REPORT_FAILED');
    expect(classifyHarvestError({ ...noFlags, readFailed: true })?.code).toBe(
      'HARVEST_READ_FAILED',
    );
  });
});
