// Canonical runtime-Pod builder — the Kubernetes analogue of docker-args.ts.
//
// Pure function so a unit test can snapshot/inspect the Pod object without
// touching a cluster. Same defense-in-depth: every identifier that lands in a
// name/label/annotation/arg position is re-validated with strict regexes.
//
// CRITICAL: user code is NEVER passed via the Pod spec, and the per-exec
// Secret (presigned URLs, SANDBOX_TOKEN, upload slots) is mounted ONLY into the
// trusted `stage` / `harvest` containers — never the `runner`. Only typed
// identifiers (execution id, org id, language, image, entry path) reach the
// runner's spec.
//
// Exec-free Pod shape (one Pod, shared `/user` emptyDir, no PVC required):
//   - initContainer `stage` (the SPAWNER image, k8s-stage.ts): downloads
//     inputs from presigned URLs into /user and writes the multi-step
//     wrapper + the prior-stage attestation. initContainers complete before
//     app containers, so the runner finds a fully-staged workspace — no
//     sentinel handshake. A required-input failure exits non-zero → Pod fails
//     → spawner surfaces PRE_STAGE_FAILED.
//   - container `runner` (the runtime image): command override runs the
//     image's real /entrypoint.sh as a CHILD of `sh -c` (NOT `exec`), so the
//     wrapper resumes after it to capture the exit code into EXIT_CODE_PATH.
//     stderr is redirected to STDERR_PATH (the K8s log API merges stdout+stderr;
//     keeping stderr on disk leaves the runner's logs clean stdout for phase
//     parsing). No runtime-image change, no credentials, no callbacks.
//   - container `harvest` (the SPAWNER image, k8s-harvest.ts): waits for the
//     runner's exit code, uploads /user/output via presigned slots +
//     EP1/EP2, and prints the result line the spawner reads back from its logs.
//
// Every spawner↔Pod interaction is plain HTTP (createNamespacedPod,
// readNamespacedPodLog, deleteNamespacedPod) — no exec websocket anywhere.

import { createHash } from 'node:crypto';

import type {
  V1EnvVar,
  V1Pod,
  V1Volume,
  V1VolumeMount,
} from '@kubernetes/client-node';

import type { Language, SpawnerConfig } from '../../types.ts';
import type { CacheStores } from '../types.ts';
import { EXEC_SPEC_MOUNT_DIR, secretNameFor } from './exec-spec.ts';
import { EXIT_CODE_PATH, STDERR_PATH, TALE_DIR } from './k8s-protocol.ts';

interface SandboxPodInput {
  executionId: string;
  organizationId: string;
  language: Extract<Language, 'python' | 'node' | 'polyglot'>;
  /** Absolute path the runtime entrypoint will exec (see docker-args.ts). */
  entryPath: string;
  startedAtMs: number;
  /** Per-org cache PVC names; only consumed when cfg.k8s.cacheMode === 'pvc'. */
  cache?: CacheStores;
  /**
   * Sanitized step-scoped env (reserved names already dropped upstream by
   * validate-request). Injected into the RUNNER container only — never the
   * stage/harvest helpers (which hold the exec-spec Secret). Skips any name
   * that collides with the infrastructure baseline (proxy / cache / HOME).
   */
  userEnv?: Record<string, string>;
}

const RUNTIME_UID = 65534;
const RUNTIME_GID = 65534;
const WORKSPACE_MOUNT = '/user';

// In-Pod entry-mode scripts (the spawner image's WORKDIR is /app).
const STAGE_ENTRY = '/app/src/backend/kubernetes/k8s-stage.ts';
const HARVEST_ENTRY = '/app/src/backend/kubernetes/k8s-harvest.ts';

// Mirror docker-args.ts's safety regexes (kept local so this builder is
// independently testable, exactly like docker-args.test.ts).
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const ENTRY_PATH_RE =
  /^(?:\/user\/(?:code|\.runtime\/tale)\/(?!.*\.\.)[A-Za-z0-9_./-]{1,256}|(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_./-]{0,255})$/;
// Mirror docker-args.ts: a user step env var must never shadow the runner's
// infrastructure baseline, and must be a valid env identifier.
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Uppercase; the collision check normalizes the candidate so a lowercase
// variant can't slip past. Covers the canonical reserved names + proxy/cache.
const BASELINE_ENV_NAMES = new Set([
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'PIP_CACHE_DIR',
  'UV_CACHE_DIR',
  'NPM_CONFIG_CACHE',
  'HOME',
  'PATH',
  'TMPDIR',
]);

function assertSafe(name: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw new Error(
      `k8s-pod-spec: ${name} value rejected by safety regex: ${JSON.stringify(value)}`,
    );
  }
}

/**
 * Deterministic, DNS-1123-safe Pod name derived from the execution id. The raw
 * execution id may exceed 63 chars or contain uppercase/underscore (invalid in
 * a Pod name), so we hash it. Deterministic so `cancel(executionId)` can
 * recompute the name without a label lookup. Collision space is 64 bits.
 */
export function podNameFor(executionId: string): string {
  const h = createHash('sha1').update(executionId).digest('hex').slice(0, 16);
  return `tale-sbx-${h}`;
}

// The runner's command wrapper. Run the image's real entrypoint as a CHILD of
// `sh -c` (NOT `exec`): the entrypoint internally `exec`s python/node, which
// replaces only that child, so `sh -c` resumes here to capture the exit code.
// stderr → a file (kept out of the K8s log stream, which is stdout-only for
// clean phase parsing). $0..$3 come from the Pod `args` trailer below.
const RUNNER_WRAPPER = [
  `mkdir -p ${TALE_DIR}`,
  `/entrypoint.sh "$0" "$1" "$2" "$3" 2>${STDERR_PATH}`,
  `echo $? > ${EXIT_CODE_PATH}`,
].join('\n');

export function buildSandboxPod(
  cfg: SpawnerConfig,
  inp: SandboxPodInput,
): V1Pod {
  assertSafe('executionId', inp.executionId, ID_RE);
  assertSafe('organizationId', inp.organizationId, ORG_RE);
  assertSafe('entryPath', inp.entryPath, ENTRY_PATH_RE);
  if (
    inp.language !== 'python' &&
    inp.language !== 'node' &&
    inp.language !== 'polyglot'
  ) {
    throw new Error(`k8s-pod-spec: bad language: ${inp.language as string}`);
  }

  const usePvcCache = cfg.k8s.cacheMode === 'pvc' && inp.cache !== undefined;

  // Runner env mirrors docker-args.ts. The dependency-cache env vars are set
  // only in pvc mode — pointing them at /cache/* with no mount would break
  // installs under readOnlyRootFilesystem (uv/npm can't create the dir). In
  // 'none' mode uv/npm fall back to HOME-based caches under the writable /tmp.
  const runnerEnv: V1EnvVar[] = [
    { name: 'HTTPS_PROXY', value: cfg.egressProxy },
    { name: 'HTTP_PROXY', value: cfg.egressProxy },
    { name: 'NO_PROXY', value: '127.0.0.1,localhost' },
    { name: 'HOME', value: '/tmp' },
  ];
  if (usePvcCache) {
    runnerEnv.push(
      { name: 'PIP_CACHE_DIR', value: '/cache/pip' },
      { name: 'UV_CACHE_DIR', value: '/cache/pip' },
      { name: 'NPM_CONFIG_CACHE', value: '/cache/npm' },
    );
  }
  // Step-scoped env (sanitized upstream) — appended AFTER the baseline and
  // only into the RUNNER container. Collisions with the infrastructure
  // baseline are skipped so a user var can never shadow proxy/cache/HOME.
  if (inp.userEnv) {
    for (const [name, value] of Object.entries(inp.userEnv)) {
      if (
        !ENV_NAME_RE.test(name) ||
        BASELINE_ENV_NAMES.has(name.toUpperCase())
      ) {
        continue;
      }
      runnerEnv.push({ name, value });
    }
  }

  const runnerMounts: V1VolumeMount[] = [
    { name: 'workspace', mountPath: WORKSPACE_MOUNT },
    { name: 'tmp', mountPath: '/tmp' },
  ];
  const volumes: V1Volume[] = [
    // sizeLimit bounds everything the execution writes (deps installs, temp
    // files, outputs — the entrypoint points HOME/TMPDIR/PIP_TARGET here).
    // Exceeding it evicts the pod; the spawner's runner-dead path classifies
    // that instead of burning the full timeout. K8s analogue of the docker
    // path's fsize ulimit (which has no per-process equivalent here).
    {
      name: 'workspace',
      emptyDir: { sizeLimit: cfg.k8s.workspaceSizeLimit },
    },
    { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '128Mi' } },
    // The per-exec Secret (presigned URLs + token + caps). Defined at Pod level
    // but mounted ONLY into stage/harvest below — never the runner.
    {
      name: 'exec-spec',
      secret: { secretName: secretNameFor(inp.executionId) },
    },
    // Scratch for the helper containers' Bun runtime (HOME=/helper-tmp) under
    // readOnlyRootFilesystem. Separate from the runner's /tmp.
    { name: 'helper-tmp', emptyDir: { medium: 'Memory', sizeLimit: '64Mi' } },
  ];
  if (usePvcCache && inp.cache) {
    runnerMounts.push(
      { name: 'pip-cache', mountPath: '/cache/pip' },
      { name: 'npm-cache', mountPath: '/cache/npm' },
    );
    volumes.push(
      {
        name: 'pip-cache',
        persistentVolumeClaim: { claimName: inp.cache.pip },
      },
      {
        name: 'npm-cache',
        persistentVolumeClaim: { claimName: inp.cache.npm },
      },
    );
  }

  const hardenedSecurityContext = {
    runAsUser: RUNTIME_UID,
    runAsGroup: RUNTIME_GID,
    runAsNonRoot: true,
    readOnlyRootFilesystem: true,
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    seccompProfile: { type: 'RuntimeDefault' },
  };

  // The trusted helper containers (stage/harvest) run the spawner image as the
  // same non-root uid, sharing /user via fsGroup, with the per-exec Secret
  // mounted read-only + a writable HOME/TMPDIR for Bun (the root fs is
  // read-only). They hold the token but run no user code, so they don't need
  // gVisor containment (the Pod-level RuntimeClass still covers them when runsc
  // is on — harmless overhead).
  const helperEnv: V1EnvVar[] = [
    { name: 'HOME', value: '/helper-tmp' },
    { name: 'TMPDIR', value: '/helper-tmp' },
  ];
  const helperMounts: V1VolumeMount[] = [
    { name: 'workspace', mountPath: WORKSPACE_MOUNT },
    { name: 'exec-spec', mountPath: EXEC_SPEC_MOUNT_DIR, readOnly: true },
    { name: 'helper-tmp', mountPath: '/helper-tmp' },
  ];
  const helperResources = {
    requests: { cpu: '100m', memory: '256Mi' },
    limits: { cpu: '1', memory: '1Gi' },
  };

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podNameFor(inp.executionId),
      namespace: cfg.k8s.namespace,
      labels: {
        'tale.sandbox': '1',
        // The NetworkPolicy selector ops apply for egress isolation targets.
        'tale.sandbox/role': 'runtime',
      },
      // Raw (un-sanitized) identifiers live in annotations — no charset/length
      // limit, so the orphan sweep + cancel can recover the real ids.
      annotations: {
        'tale.dev/execution-id': inp.executionId,
        'tale.dev/organization-id': inp.organizationId,
        'tale.dev/started-at': String(inp.startedAtMs),
      },
    },
    spec: {
      restartPolicy: 'Never',
      automountServiceAccountToken: false,
      // Don't leak Service env vars (URLs, tokens) into untrusted code.
      enableServiceLinks: false,
      // Untrusted: no graceful-shutdown contract — SIGKILL on delete, like the
      // docker --runtime path. The spawner only deletes after reading the
      // harvest result, so output isn't lost.
      terminationGracePeriodSeconds: 0,
      // RuntimeClass replaces docker's --runtime; resolved per tier (null for
      // runc → field omitted, e.g. gvisor → 'gvisor', sysbox → 'sysbox-runc').
      ...(cfg.k8s.runtimeClassName !== null && {
        runtimeClassName: cfg.k8s.runtimeClassName,
      }),
      securityContext: {
        // fsGroup so the shared emptyDir is group-writable across the stage,
        // runner, and harvest containers — the K8s replacement for the
        // host-side chownRecursive on the docker path.
        fsGroup: RUNTIME_GID,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      volumes,
      initContainers: [
        {
          name: 'stage',
          image: cfg.k8s.spawnerImage,
          imagePullPolicy: 'IfNotPresent',
          command: ['bun', STAGE_ENTRY],
          workingDir: '/app',
          env: helperEnv,
          resources: helperResources,
          securityContext: hardenedSecurityContext,
          volumeMounts: helperMounts,
        },
      ],
      containers: [
        {
          name: 'runner',
          image: cfg.runtimeImage,
          // Pull once and reuse (matches the docker path, where ensureImage
          // pulls at boot and `docker run` reuses the local image). Default
          // 'Always' on a :latest tag would re-pull EVERY execution and ignore
          // a locally-loaded image (e.g. `kind load`).
          imagePullPolicy: 'IfNotPresent',
          command: ['/bin/sh', '-c', RUNNER_WRAPPER],
          // $0..$3 inside RUNNER_WRAPPER → the image entrypoint's positional
          // args, identical to the docker path (docker-args.ts trailer).
          args: [
            inp.language,
            '/user/code/packages.json',
            '/user/code/options.json',
            inp.entryPath,
          ],
          env: runnerEnv,
          resources: {
            requests: { cpu: '1', memory: '1500Mi' },
            limits: { cpu: '1', memory: '1500Mi' },
          },
          securityContext: hardenedSecurityContext,
          volumeMounts: runnerMounts,
        },
        {
          name: 'harvest',
          image: cfg.k8s.spawnerImage,
          imagePullPolicy: 'IfNotPresent',
          command: ['bun', HARVEST_ENTRY],
          workingDir: '/app',
          env: helperEnv,
          resources: helperResources,
          securityContext: hardenedSecurityContext,
          volumeMounts: helperMounts,
        },
      ],
    },
  };
}
