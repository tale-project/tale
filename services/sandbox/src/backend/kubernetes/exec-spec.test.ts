// Unit tests for the per-exec Secret payload builder. The Secret is the
// exec-free transport's trust boundary — it carries the presigned URLs + token
// + caps that must reach stage/harvest but never the runner. These tests pin
// the payload shape + the serialize/parse round-trip (no cluster needed; the
// mounted-only-into-stage/harvest invariant is asserted in k8s-pod-spec.test).

import { describe, expect, test } from 'bun:test';

import type { ExecuteRequest, SpawnerConfig } from '../../types.ts';
import {
  EXEC_SPEC_FILENAME,
  buildExecSecret,
  buildExecSpec,
  parseExecSpec,
  secretNameFor,
} from './exec-spec.ts';

const cfg: SpawnerConfig = {
  backend: 'kubernetes',
  port: 8003,
  sandboxToken: 'super-secret-token',
  runtimeImage: 'tale-sandbox-runtime:test',
  runtime: 'runc',
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: 'gvisor',
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
  },
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  maxConcurrent: 4,
  hostSessionRoot: '/var/lib/tale-sandbox/sessions',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 5_242_880,
  stderrMaxBytes: 5_242_880,
  outputFileMaxBytes: 52_428_800,
  outputTotalMaxBytes: 104_857_600,
  maxRequestBodyBytes: 262_144,
};

const req: ExecuteRequest = {
  executionId: 'k74m9zr5b8jcgvx2pqfwsdyhntq3l1a0',
  organizationId: 'org_456',
  language: 'python',
  files: [{ path: 'main.py', url: 'http://proxy/code/main.py?sig=abc' }],
  entryPath: 'main.py',
  outputUploadSlots: [{ url: 'http://proxy/upload/slot1?sig=xyz' }],
  outputUrlEndpoint: 'http://platform/ep1?sig=1',
  reportUploadedEndpoint: 'http://platform/ep2?sig=2',
};

describe('secretNameFor', () => {
  test('is deterministic, DNS-1123-safe, and suffixed -spec', () => {
    const a = secretNameFor(req.executionId);
    expect(a).toBe(secretNameFor(req.executionId));
    expect(a).toMatch(/^tale-sbx-[a-f0-9]{16}-spec$/);
    expect(a.length).toBeLessThanOrEqual(63);
  });
});

describe('buildExecSpec', () => {
  test('carries req + token + caps + clamped timeout', () => {
    const spec = buildExecSpec(cfg, req, 45_000);
    expect(spec.req).toEqual(req);
    expect(spec.sandboxToken).toBe('super-secret-token');
    expect(spec.timeoutMs).toBe(45_000);
    expect(spec.caps).toEqual({
      stdoutMaxBytes: 5_242_880,
      stderrMaxBytes: 5_242_880,
      outputFileMaxBytes: 52_428_800,
      outputTotalMaxBytes: 104_857_600,
    });
  });

  test('passes through a null token (HMAC disabled)', () => {
    const spec = buildExecSpec({ ...cfg, sandboxToken: null }, req, 30_000);
    expect(spec.sandboxToken).toBeNull();
  });
});

describe('buildExecSecret', () => {
  test('targets the deterministic name + namespace as an Opaque Secret', () => {
    const secret = buildExecSecret(cfg, req, 30_000);
    expect(secret.metadata?.name).toBe(secretNameFor(req.executionId));
    expect(secret.metadata?.namespace).toBe('tale-sandbox');
    expect(secret.type).toBe('Opaque');
    expect(secret.metadata?.annotations?.['tale.dev/execution-id']).toBe(
      req.executionId,
    );
  });

  test('stringData holds the serialized spec (apiserver base64s it)', () => {
    const secret = buildExecSecret(cfg, req, 30_000);
    const raw = secret.stringData?.[EXEC_SPEC_FILENAME];
    expect(typeof raw).toBe('string');
    const parsed = parseExecSpec(raw ?? '');
    expect(parsed.req).toEqual(req);
    expect(parsed.sandboxToken).toBe('super-secret-token');
    expect(parsed.timeoutMs).toBe(30_000);
  });
});

describe('parseExecSpec', () => {
  test('round-trips a built spec', () => {
    const spec = buildExecSpec(cfg, req, 30_000);
    expect(parseExecSpec(JSON.stringify(spec))).toEqual(spec);
  });

  test('throws on non-JSON', () => {
    expect(() => parseExecSpec('{not json')).toThrow(/not valid JSON/);
  });

  test('throws on a missing req', () => {
    expect(() => parseExecSpec(JSON.stringify({ caps: {} }))).toThrow(/req/);
  });

  test('throws on a req without an executionId', () => {
    expect(() => parseExecSpec(JSON.stringify({ req: {}, caps: {} }))).toThrow(
      /executionId/,
    );
  });

  test('throws on missing caps', () => {
    expect(() =>
      parseExecSpec(JSON.stringify({ req: { executionId: 'x' } })),
    ).toThrow(/caps/);
  });
});
