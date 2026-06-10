// Canonical runtime-Pod builder — the Kubernetes analogue of docker-args.ts.
//
// Pure function so a unit test can snapshot/inspect the Pod object without
// touching a cluster. Same defense-in-depth: every identifier that lands in a
// name/label/annotation/arg position is re-validated with strict regexes.
//
// CRITICAL: user code is NEVER passed via the Pod spec. Inputs are delivered
// by the spawner staging them into the shared `/workspace` emptyDir via the
// holder sidecar (exec-tar), exactly like the docker bind-mount. Only typed
// identifiers (execution id, org id, language, image, entry path) reach the
// spec.
//
// Pod shape (validated by the Phase-2 transport spike):
//   - container `runner` (the runtime image): its command is overridden to
//     wait for a `/workspace/.tale/.staged` sentinel (written by the spawner
//     after tar-in), then `exec`s the image's real /entrypoint.sh with the
//     same positional args the docker path passes, redirecting stderr to a
//     file (the K8s log API merges stdout+stderr, so we keep stderr separate
//     on disk and harvest it via tar-out). No runtime-image change required.
//   - container `holder` (a minimal sh+tar image): sleeps for the pod's life
//     sharing the `/workspace` emptyDir, so the spawner can exec `tar` to
//     stage inputs in and harvest outputs out — including AFTER the runner
//     has exited. Holds no secret and runs no user-influenced logic.

import { createHash } from 'node:crypto';

import type {
  V1EnvVar,
  V1Pod,
  V1Volume,
  V1VolumeMount,
} from '@kubernetes/client-node';

import type { Language, SpawnerConfig } from '../../types.ts';
import type { CacheStores } from '../types.ts';

export interface SandboxPodInput {
  executionId: string;
  organizationId: string;
  language: Extract<Language, 'python' | 'node' | 'polyglot'>;
  /** Absolute path the runtime entrypoint will exec (see docker-args.ts). */
  entryPath: string;
  startedAtMs: number;
  /** Per-org cache PVC names; only consumed when cfg.k8s.cacheMode === 'pvc'. */
  cache?: CacheStores;
}

const RUNTIME_UID = 65534;
const RUNTIME_GID = 65534;
const WORKSPACE_MOUNT = '/workspace';
const SENTINEL = '/workspace/.tale/.staged';
const STDERR_FILE = '/workspace/.tale/stderr.log';

// Mirror docker-args.ts's safety regexes (kept local so this builder is
// independently testable, exactly like docker-args.test.ts).
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const ENTRY_PATH_RE =
  /^(?:\/workspace\/(?:code|\.tale)\/(?!.*\.\.)[A-Za-z0-9_./-]{1,256}|(?!.*\.\.)[A-Za-z0-9_-][A-Za-z0-9_./-]{0,255})$/;

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

// The runner's command wrapper: block until the spawner signals staging is
// complete, then hand off to the image's real entrypoint with stderr split to
// a file. Positional $0..$3 come from the Pod `args` (sh -c <script> $0 $1...).
// The bounded loop (~300s) is a backstop so a pod is never wedged forever if
// the spawner dies before staging — the orphan sweep also reaps it.
const RUNNER_WRAPPER = [
  'n=0',
  `while [ ! -e ${SENTINEL} ]; do`,
  '  n=$((n+1))',
  '  if [ "$n" -gt 6000 ]; then echo "sandbox: stage-in timeout" >&2; exit 65; fi',
  '  sleep 0.05',
  'done',
  'mkdir -p /workspace/.tale',
  `exec /entrypoint.sh "$0" "$1" "$2" "$3" 2>${STDERR_FILE}`,
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

  // Env mirrors docker-args.ts. The dependency-cache env vars are set only in
  // pvc mode — pointing them at /cache/* with no mount would break installs
  // under readOnlyRootFilesystem (uv/npm can't create the dir). In 'none' mode
  // uv/npm fall back to HOME-based caches under the writable /workspace/.home
  // that entrypoint.sh sets up.
  const env: V1EnvVar[] = [
    { name: 'HTTPS_PROXY', value: cfg.egressProxy },
    { name: 'HTTP_PROXY', value: cfg.egressProxy },
    { name: 'NO_PROXY', value: '127.0.0.1,localhost' },
    { name: 'HOME', value: '/tmp' },
  ];
  if (usePvcCache) {
    env.push(
      { name: 'PIP_CACHE_DIR', value: '/cache/pip' },
      { name: 'UV_CACHE_DIR', value: '/cache/pip' },
      { name: 'NPM_CONFIG_CACHE', value: '/cache/npm' },
    );
  }

  const runnerMounts: V1VolumeMount[] = [
    { name: 'workspace', mountPath: WORKSPACE_MOUNT },
    { name: 'tmp', mountPath: '/tmp' },
  ];
  const volumes: V1Volume[] = [
    { name: 'workspace', emptyDir: {} },
    { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '128Mi' } },
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
      // docker --runtime path. Harvest happens before delete, so 0 is safe.
      terminationGracePeriodSeconds: 0,
      // gVisor: the RuntimeClass replaces docker's --runtime=runsc.
      ...(cfg.runtime === 'runsc' && {
        runtimeClassName: cfg.k8s.runtimeClassName,
      }),
      securityContext: {
        // fsGroup so the shared emptyDir is group-writable by `nobody` — the
        // K8s replacement for the host-side chownRecursive on the docker path.
        fsGroup: RUNTIME_GID,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      volumes,
      containers: [
        {
          name: 'runner',
          image: cfg.runtimeImage,
          command: ['/bin/sh', '-c', RUNNER_WRAPPER],
          // $0..$3 inside RUNNER_WRAPPER → the image entrypoint's positional
          // args, identical to the docker path (docker-args.ts trailer).
          args: [
            inp.language,
            '/workspace/code/packages.json',
            '/workspace/code/options.json',
            inp.entryPath,
          ],
          env,
          resources: {
            requests: { cpu: '1', memory: '1500Mi' },
            limits: { cpu: '1', memory: '1500Mi' },
          },
          securityContext: hardenedSecurityContext,
          volumeMounts: runnerMounts,
        },
        {
          name: 'holder',
          image: cfg.k8s.holderImage,
          // Stay alive for the pod's life so the spawner can exec `tar` to
          // stage in / harvest out — including after `runner` terminates.
          command: ['/bin/sh', '-c', 'sleep 86400'],
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '500m', memory: '256Mi' },
          },
          securityContext: hardenedSecurityContext,
          volumeMounts: [{ name: 'workspace', mountPath: WORKSPACE_MOUNT }],
        },
      ],
    },
  };
}
