// Per-execution Secret payload — the exec-free transport's trust boundary.
//
// In the exec-free K8s flow the workspace I/O happens INSIDE the Pod: the
// `stage` initContainer downloads inputs from presigned URLs and the `harvest`
// container uploads outputs + calls EP1/EP2. Those two helper containers run
// the SPAWNER image (Bun + the exec-common helpers) and need the request's
// presigned URLs, the upload slots, the EP1/EP2 endpoints, the SANDBOX_TOKEN,
// and the byte caps. None of that may reach the `runner` container (untrusted
// user code), so it travels in a Kubernetes Secret mounted ONLY into
// stage/harvest — never the runner.
//
// The payload is the full ExecuteRequest (so the in-Pod modes call the exact
// same `stageWorkspace` / `harvestOutputDir` the docker path uses, byte-for-
// byte) plus the cfg-derived token + caps. Mounted at EXEC_SPEC_PATH; the
// in-Pod entry scripts (k8s-stage.ts / k8s-harvest.ts) read + `parseExecSpec`
// it.

import { createHash } from 'node:crypto';

import type { V1Secret } from '@kubernetes/client-node';

import type { ExecuteRequest, SpawnerConfig } from '../../types.ts';

/** Where the per-exec Secret is mounted in the stage/harvest containers. */
export const EXEC_SPEC_MOUNT_DIR = '/tale';
export const EXEC_SPEC_FILENAME = 'spec.json';
export const EXEC_SPEC_PATH = `${EXEC_SPEC_MOUNT_DIR}/${EXEC_SPEC_FILENAME}`;

/** Output/stream byte caps the in-Pod harvest enforces (mirror SpawnerConfig). */
export interface ExecSpecCaps {
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
  outputFileMaxBytes: number;
  outputTotalMaxBytes: number;
}

/**
 * The complete per-execution payload handed to the in-Pod stage/harvest
 * modes. `req` is the verbatim ExecuteRequest so the helpers reuse the
 * docker path's staging/harvest unchanged; `sandboxToken` + `caps` are the
 * cfg-derived bits the Pod can't otherwise see.
 */
export interface ExecSpec {
  req: ExecuteRequest;
  sandboxToken: string | null;
  caps: ExecSpecCaps;
  /**
   * The clamped inner (user) wall-clock cap in ms. The harvest container
   * enforces it: it waits at most this long for the runner's exit-code file,
   * then harvests whatever partial output exists with exitCode 124 (TIMEOUT).
   * This is the exec-free analogue of the docker path's inner SIGKILL — and it
   * keeps partial output on timeout (the runner is killed by the Pod delete
   * only AFTER the harvest result is read).
   */
  timeoutMs: number;
}

export function buildExecSpec(
  cfg: SpawnerConfig,
  req: ExecuteRequest,
  timeoutMs: number,
): ExecSpec {
  return {
    req,
    sandboxToken: cfg.sandboxToken,
    caps: {
      stdoutMaxBytes: cfg.stdoutMaxBytes,
      stderrMaxBytes: cfg.stderrMaxBytes,
      outputFileMaxBytes: cfg.outputFileMaxBytes,
      outputTotalMaxBytes: cfg.outputTotalMaxBytes,
    },
    timeoutMs,
  };
}

/**
 * Deterministic, DNS-1123-safe Secret name derived from the execution id (the
 * same hashing podNameFor uses, with a `-spec` suffix). Deterministic so the
 * backend can mount it by name on the Pod and delete it by name on cleanup
 * without a label lookup.
 */
export function secretNameFor(executionId: string): string {
  const h = createHash('sha1').update(executionId).digest('hex').slice(0, 16);
  return `tale-sbx-${h}-spec`;
}

/**
 * Build the per-exec Secret carrying the serialized ExecSpec. `stringData`
 * (not `data`) so the apiserver base64-encodes it; we never hand-encode. The
 * Secret is GC'd by the backend after the Pod terminates.
 */
export function buildExecSecret(
  cfg: SpawnerConfig,
  req: ExecuteRequest,
  timeoutMs: number,
): V1Secret {
  const spec = buildExecSpec(cfg, req, timeoutMs);
  return {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: secretNameFor(req.executionId),
      namespace: cfg.k8s.namespace,
      labels: {
        'tale.sandbox': '1',
        'tale.sandbox/role': 'exec-spec',
      },
      annotations: {
        'tale.dev/execution-id': req.executionId,
      },
    },
    type: 'Opaque',
    stringData: {
      [EXEC_SPEC_FILENAME]: JSON.stringify(spec),
    },
  };
}

/**
 * Parse + minimally validate a serialized ExecSpec read from the mounted
 * Secret file. Used by the in-Pod stage/harvest entry scripts. Throws on a
 * structurally invalid payload (a corrupt Secret is a hard failure — the
 * Pod must not run user code against a half-built spec).
 */
export function parseExecSpec(json: string): ExecSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `exec-spec: payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('exec-spec: payload is not an object');
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const obj = parsed as Record<string, unknown>;
  const req = obj.req;
  if (req === null || typeof req !== 'object') {
    throw new Error('exec-spec: missing or invalid `req`');
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const executionId = (req as Record<string, unknown>).executionId;
  if (typeof executionId !== 'string') {
    throw new Error('exec-spec: missing or invalid `req.executionId`');
  }
  if (obj.caps === null || typeof obj.caps !== 'object') {
    throw new Error('exec-spec: missing or invalid `caps`');
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  return parsed as ExecSpec;
}
