// Canonical session-Pod builder — the K8s analogue of docker-session-args.ts.
//
// One LONG-LIVED Pod per session running runnerd under the image's tini init
// (the `daemon` entrypoint dispatch). Unlike the one-shot pod-per-exec shape there
// is no stage initContainer / harvest sidecar — runnerd does staging, exec,
// and harvest at runtime over HTTP. `restartPolicy: Always` so a runner crash
// restarts in place against the surviving PVC workspace; the daemon is
// boot-idempotent, so the session survives with a brief `degraded` blip.
//
// Pure function so a unit test can snapshot the Pod without a cluster. Every
// identifier in a name/label position is regex-validated (defense in depth).
//
// The spawner reaches runnerd at the Pod IP on :8200 (plain HTTP) — exec-free,
// no kubectl exec/attach anywhere. The per-session Secret carries the runnerd
// token + seed env; it is the only secret in the Pod (no SANDBOX_TOKEN, no
// presigned URLs at rest).

import { createHash } from 'node:crypto';

import type { V1Pod, V1EnvFromSource } from '@kubernetes/client-node';

import { parseDindInnerPool } from '../../network-address.ts';
import {
  dindCapabilityOf,
  transparentEgressSupported,
} from '../../runtime-tier.ts';
import { RUNNERD_PORT } from '../../session/runnerd-protocol.ts';
import {
  isAgentSessionProfile,
  sessionAgentProfile,
  sessionDindEnabled,
} from '../../session/session-profile.ts';
import type { SessionAgentProfileConfig, SpawnerConfig } from '../../types.ts';
import type { SandboxSessionProfile } from '../../wire.ts';

interface SessionPodInput {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  docker?: boolean;
  createdAtMs: number;
  /** Durable startup lease, shared by peer spawners during recovery. */
  startupDeadlineMs?: number;
}

const WORKSPACE_MOUNT = '/agent';
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ORG_RE = /^[a-zA-Z0-9_-]{1,128}$/;

function assertSafe(name: string, value: string, re: RegExp): void {
  if (!re.test(value)) {
    throw new Error(
      `k8s-session-pod-spec: ${name} rejected by safety regex: ${JSON.stringify(value)}`,
    );
  }
}

/** Deterministic DNS-1123 Pod name (the raw sessionId may be too long / have
 * invalid chars). Deterministic so any replica can address/delete by name. */
export function sessionPodNameFor(sessionId: string): string {
  const h = createHash('sha1').update(sessionId).digest('hex').slice(0, 16);
  return `tale-sbx-ses-${h}`;
}

/** Per-session Secret name (runnerd token + seed env). */
export function sessionSecretNameFor(sessionId: string): string {
  return `${sessionPodNameFor(sessionId)}-spec`;
}

/** Per-session workspace PVC name. The PVC outlives the Pod (a stop deletes the
 * Pod but keeps the PVC), so /agent data survives idle-stop + resume and is
 * removed only by destroySession. */
export function sessionWorkspacePvcNameFor(sessionId: string): string {
  return `${sessionPodNameFor(sessionId)}-ws`;
}

/** What a session Pod asks the scheduler for: its typical working set, not
 * its ceiling. An idle session uses ~60 MB and next to no CPU and an agent
 * turn a few hundred MB, so the old flat 500m / 1Gi reserved ~17x the idle
 * footprint and capped a node's sessions by CPU it never used. A crawler
 * render is never idle: Chromium is up from the start, at 170 MB with no page
 * and 365 MB after five modest ones (measured), so it asks for that. Limits
 * stay the profile's; an operator override applies to every session Pod. */
const SESSION_REQUESTS = {
  agent: { cpu: '250m', memory: '512Mi' },
  dind: { cpu: '250m', memory: '1Gi' },
  default: { cpu: '250m', memory: '512Mi' },
} as const;

/** A CPU quantity in millicores ('250m', '2', '1.5'), NaN when unreadable. */
function cpuMillis(quantity: string): number {
  return quantity.endsWith('m')
    ? Number(quantity.slice(0, -1))
    : Number(quantity) * 1000;
}

const MEMORY_UNITS: Record<string, number> = {
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
};

/** A memory quantity in bytes ('512Mi', '4Gi', '1500M'), NaN when unreadable. */
function memoryBytes(quantity: string): number {
  const m = /^(\d+(?:\.\d+)?)([KMGT]i|[kMGT])?$/.exec(quantity);
  if (!m) return Number.NaN;
  return Number(m[1]) * (MEMORY_UNITS[m[2] ?? ''] ?? Number.NaN);
}

/** What a session's runner asks of the node's disk (`ephemeral-storage`), and
 * what it may write there outside its sized volumes: the writable root
 * filesystem (an inner dockerd's under DinD) and the container logs, which
 * the kubelet rotates at 10 MiB, keeping five files, by default. Without
 * them a session can fill
 * a node until DiskPressure evicts the platform's Pods beside it; with them
 * the kubelet evicts the session alone, and under node disk pressure it
 * evicts Pods using more than they request first, by priority, then by how
 * far their use exceeds their request. */
const EPHEMERAL_STORAGE = { request: '256Mi', headroom: '2Gi' } as const;

/** sizeLimit of a DinD session's inner Docker store (`/var/lib/docker`). A
 * single pull of a large build image unpacks to several GiB, and an emptyDir
 * past its sizeLimit gets the whole session evicted, so the store is sized on
 * its own rather than like the workspace. */
export const DOCKER_STORAGE_SIZE_LIMIT = '20Gi';

const BINARY_UNITS = [
  ['Ti', 2 ** 40],
  ['Gi', 2 ** 30],
  ['Mi', 2 ** 20],
  ['Ki', 2 ** 10],
] as const;

/** The sum of storage quantities, in the largest binary unit that holds it
 * exactly ('2Gi' + '20Gi' → '22Gi'). */
function sumStorage(quantities: readonly string[]): string {
  const bytes = Math.ceil(
    quantities.reduce((total, quantity) => total + memoryBytes(quantity), 0),
  );
  if (!Number.isFinite(bytes)) {
    throw new Error(
      `k8s-session-pod-spec: unreadable storage quantity in ${JSON.stringify(quantities)}`,
    );
  }
  const unit = BINARY_UNITS.find(([, size]) => bytes % size === 0);
  return unit ? `${bytes / unit[1]}${unit[0]}` : String(bytes);
}

/** The request, unless it would exceed the limit (the apiserver refuses a
 * request above its limit, which failed every create). */
function notAbove(
  request: string,
  limit: string,
  measure: (quantity: string) => number,
): string {
  return measure(request) > measure(limit) ? limit : request;
}

/** Default profile mirrors the one-shot caps (uid 65534). */
const DEFAULT_PROFILE: Pick<
  SessionAgentProfileConfig,
  'cpus' | 'memory' | 'user'
> = { cpus: 1, memory: '1500Mi', user: '65534:65534' };

export function buildSessionPod(
  cfg: SpawnerConfig,
  inp: SessionPodInput,
): V1Pod {
  assertSafe('sessionId', inp.sessionId, ID_RE);
  assertSafe('organizationId', inp.organizationId, ORG_RE);

  const dind = sessionDindEnabled(cfg, inp.profile, inp.docker);
  const profile = isAgentSessionProfile(inp.profile)
    ? sessionAgentProfile(cfg, dind)
    : { ...DEFAULT_PROFILE };
  const [uidStr, gidStr] = profile.user.split(':');
  const uid = Number(uidStr ?? '65534');
  const gid = Number(gidStr ?? '65534');
  // K8s memory limits use Mi/Gi; the docker quantity (e.g. '4g') maps to '4Gi'.
  const memLimit = dockerMemToK8s(profile.memory);
  const cpuLimit = String(profile.cpus);

  const hardenedSecurityContext = {
    runAsUser: uid,
    runAsGroup: gid,
    runAsNonRoot: true,
    readOnlyRootFilesystem: true,
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    seccompProfile: { type: 'RuntimeDefault' },
  };

  // Docker-in-container. The inner dockerd starts as root (the entrypoint drops
  // to uid 10001 for runnerd) and needs a writable rootfs + seccomp/AppArmor
  // latitude. HOW the boundary is kept depends on the tier:
  //   sysbox/kata ('native'/'vm') — userns / guest VM is the boundary; run as
  //     root-in-userns, NOT privileged.
  //   runc ('privileged') — privileged: true; NO boundary (in-pod root = node
  //     root). config allows this only with a loud trusted-only warning, and on
  //     a shared node it is genuinely dangerous — operator's single-tenant call.
  // Agent-profile ONLY (sessionDindEnabled, shared with the Docker builder): a
  // `default` Pod must never run untrusted content as root/privileged, and the
  // entrypoint's DinD branch drops to uid 10001 which cannot write the
  // 65534-group workspace — the Pod would never become ready.
  const dindPrivileged = dindCapabilityOf(cfg.runtimeTier) === 'privileged';
  const dindSecurityContext = {
    runAsUser: 0,
    runAsGroup: 0,
    runAsNonRoot: false,
    readOnlyRootFilesystem: false,
    allowPrivilegeEscalation: true,
    seccompProfile: { type: 'Unconfined' },
    ...(dindPrivileged ? { privileged: true } : {}),
  };
  const runnerSecurityContext = dind
    ? dindSecurityContext
    : hardenedSecurityContext;
  const requested =
    SESSION_REQUESTS[
      dind ? 'dind' : isAgentSessionProfile(inp.profile) ? 'agent' : 'default'
    ];
  const requests = {
    cpu: notAbove(cfg.k8s.cpuRequest ?? requested.cpu, cpuLimit, cpuMillis),
    memory: notAbove(
      cfg.k8s.memoryRequest ?? requested.memory,
      memLimit,
      memoryBytes,
    ),
  };
  // A crawler render (the `default` profile) is created for one batch and
  // destroyed after it, never resumed: its workspace is a sized emptyDir, not
  // a provisioned volume (a CSI create/attach/delete per batch). Agent
  // sessions keep their PVC across stop and resume.
  const durableWorkspace = isAgentSessionProfile(inp.profile);
  const dockerStorageSizeLimit =
    cfg.k8s.dockerStorageSizeLimit ?? DOCKER_STORAGE_SIZE_LIMIT;
  // The kubelet evicts a Pod whose disk use (writable layers, logs and
  // disk-backed emptyDirs) exceeds the sum of its containers' limits, so the
  // runner's limit is its headroom plus every sized scratch volume it mounts.
  const ephemeralLimit = sumStorage([
    cfg.k8s.ephemeralStorageLimit ?? EPHEMERAL_STORAGE.headroom,
    ...(durableWorkspace ? [] : [cfg.k8s.workspaceSizeLimit]),
    ...(dind ? [dockerStorageSizeLimit] : []),
  ]);
  const ephemeralRequest = notAbove(
    cfg.k8s.ephemeralStorageRequest ?? EPHEMERAL_STORAGE.request,
    ephemeralLimit,
    memoryBytes,
  );

  // Transparent egress (non-DinD, supported tier). A native sidecar (an init
  // container with restartPolicy: Always — K8s 1.28+) holds NET_ADMIN, installs
  // the iptables OUTPUT REDIRECT into the SHARED pod netns, then drops to the
  // redsocks uid and runs redsocks. Because it is a native sidecar it is started
  // BEFORE the runner, so the redirect + redsocks are in place before any user
  // code can egress. The `runner` container itself stays fully hardened
  // (drop:[ALL], runAsNonRoot) and never holds NET_ADMIN — its outbound TCP is
  // transparently tunnelled through the egress proxy with zero app awareness.
  // Skipped on gvisor (runsc netstack makes the REDIRECT unreliable) and under
  // DinD (the entrypoint already installs redsocks in-container there).
  const transparentEgress =
    cfg.transparentEgress && transparentEgressSupported(cfg.runtimeTier);
  // Non-DinD uses a native sidecar (runner stays hardened, never holds
  // NET_ADMIN). DinD instead lets the already-root runner install the OUTPUT
  // REDIRECT inline (signalled via TALE_TRANSPARENT_EGRESS in the runner env
  // below), exactly like the docker DinD path.
  const transparentEgressSidecar = transparentEgress && !dind;
  // On a node that reports no ephemeral-storage capacity any request at all
  // leaves the Pod unschedulable, so a zero runner request zeroes the
  // sidecar's too. It stays explicit: a container with a limit and no
  // request is given its limit as the request.
  const egressEphemeralRequest =
    memoryBytes(ephemeralRequest) === 0 ? '0' : '16Mi';
  const egressSidecars = transparentEgressSidecar
    ? [
        {
          name: 'egress',
          image: cfg.runtimeImage,
          imagePullPolicy: 'IfNotPresent',
          // `egress-sidecar` entrypoint dispatch: install the OUTPUT REDIRECT as
          // root, then setpriv-drop to the redsocks uid and exec redsocks.
          args: ['egress-sidecar'],
          // Native sidecar: started (and kept running) before the runner.
          restartPolicy: 'Always',
          // redsocks idles at ~2 MB and logs only errors. Explicit resources
          // also let the Pod through a namespace ResourceQuota, which refuses
          // any container without them.
          resources: {
            requests: {
              cpu: '10m',
              memory: '16Mi',
              'ephemeral-storage': egressEphemeralRequest,
            },
            limits: {
              cpu: '250m',
              memory: '64Mi',
              'ephemeral-storage': '128Mi',
            },
          },
          env: [
            // redsocks resolves the egress proxy endpoint from these.
            { name: 'HTTPS_PROXY', value: cfg.egressProxy },
            { name: 'HTTP_PROXY', value: cfg.egressProxy },
          ],
          securityContext: {
            // Boot as root to install iptables; the entrypoint drops to the
            // redsocks uid for redsocks itself (which needs no caps).
            runAsUser: 0,
            runAsGroup: 0,
            runAsNonRoot: false,
            // redsocks.conf is written to the sidecar's own /tmp.
            readOnlyRootFilesystem: false,
            allowPrivilegeEscalation: false,
            // NET_ADMIN/NET_RAW install the OUTPUT REDIRECT; SETUID/SETGID let
            // the entrypoint setpriv-drop from root to the redsocks uid (cleared
            // on the uid change, so redsocks itself runs capless). This sidecar
            // runs ONLY redsocks — the `runner` container stays drop:[ALL].
            capabilities: {
              drop: ['ALL'],
              add: ['NET_ADMIN', 'NET_RAW', 'SETUID', 'SETGID'],
            },
            seccompProfile: { type: 'RuntimeDefault' },
          },
        },
      ]
    : [];

  // runnerd token + seed env arrive via the per-session Secret, not the Pod
  // spec (so `kubectl get pod` never shows them). envFrom maps every Secret
  // key to an env var (TALE_RUNNERD_TOKEN, TALE_SESSION_ENV).
  const envFrom: V1EnvFromSource[] = [
    { secretRef: { name: sessionSecretNameFor(inp.sessionId) } },
  ];

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: sessionPodNameFor(inp.sessionId),
      namespace: cfg.k8s.namespace,
      labels: {
        // Distinct from the one-shot `tale.sandbox=1` so the one-shot sweep
        // never reaps a session; `role: session` is the NetworkPolicy selector.
        'tale.sandbox-session': '1',
        'tale.sandbox/role': 'session',
      },
      annotations: {
        'tale.dev/session-id': inp.sessionId,
        'tale.dev/organization-id': inp.organizationId,
        'tale.dev/profile': inp.profile,
        'tale.dev/docker': String(dind),
        'tale.dev/created-at': String(inp.createdAtMs),
        ...(inp.startupDeadlineMs === undefined
          ? {}
          : { 'tale.dev/startup-deadline': String(inp.startupDeadlineMs) }),
        // AppArmor unconfined for the inner dockerd (the userns/VM is the real
        // boundary). Annotation form for broad node-version compatibility.
        ...(dind && {
          'container.apparmor.security.beta.kubernetes.io/runner': 'unconfined',
        }),
      },
    },
    spec: {
      // In-place restart on crash; the PVC-backed workspace survives, runnerd
      // re-boots idempotently. The PVC also survives a deliberate stop (Pod
      // deleted, PVC kept) so an idle-stopped session resumes with its data.
      restartPolicy: 'Always',
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      // RuntimeClass resolved per tier (null for runc → field omitted).
      ...(cfg.k8s.runtimeClassName !== null && {
        runtimeClassName: cfg.k8s.runtimeClassName,
      }),
      // Operator placement, for every profile: untrusted (under runc DinD,
      // privileged) sessions kept to their own nodes, and ranked below the
      // platform when the scheduler preempts or the kubelet evicts. Unset,
      // the fields are omitted and the scheduler places sessions anywhere.
      ...(cfg.k8s.nodeSelector !== undefined && {
        nodeSelector: { ...cfg.k8s.nodeSelector },
      }),
      ...(cfg.k8s.tolerations !== undefined && {
        tolerations: cfg.k8s.tolerations.map((toleration) => ({
          ...toleration,
        })),
      }),
      ...(cfg.k8s.priorityClassName !== undefined && {
        priorityClassName: cfg.k8s.priorityClassName,
      }),
      securityContext: {
        fsGroup: gid,
        // Without it the kubelet re-chowns the whole workspace (repositories,
        // node_modules, site-packages) on every mount, i.e. every resume.
        fsGroupChangePolicy: 'OnRootMismatch',
        seccompProfile: { type: dind ? 'Unconfined' : 'RuntimeDefault' },
      },
      volumes: [
        durableWorkspace
          ? {
              name: 'workspace',
              persistentVolumeClaim: {
                claimName: sessionWorkspacePvcNameFor(inp.sessionId),
              },
            }
          : {
              name: 'workspace',
              emptyDir: { sizeLimit: cfg.k8s.workspaceSizeLimit },
            },
        { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '512Mi' } },
        // /dev/shm — Chromium (Playwright) crashes on the 64Mi default.
        { name: 'dshm', emptyDir: { medium: 'Memory', sizeLimit: '512Mi' } },
        // Inner dockerd store (DinD only): Pod-scoped, size-bounded emptyDir,
        // separate from the PVC workspace so nested overlay has its own store.
        // It survives runner-container restarts within this Pod, including
        // image/network state; stop/destroy deletes the Pod and this store.
        ...(dind
          ? [
              {
                name: 'docker-storage',
                emptyDir: { sizeLimit: dockerStorageSizeLimit },
              },
            ]
          : []),
      ],
      // Transparent-egress native sidecar (empty unless enabled). Installs the
      // OUTPUT REDIRECT + runs redsocks in the shared netns before the runner.
      ...(egressSidecars.length > 0 ? { initContainers: egressSidecars } : {}),
      containers: [
        {
          name: 'runner',
          image: cfg.runtimeImage,
          imagePullPolicy: 'IfNotPresent',
          // A runner that exits during start (the entrypoint's FATAL line)
          // reports its last log lines as the termination message, which a
          // create that fails fast names as the reason.
          terminationMessagePolicy: 'FallbackToLogsOnError',
          // `daemon` entrypoint dispatch → tini (PID 1, reaps orphans) + runnerd.
          args: ['daemon'],
          envFrom,
          env: [
            { name: 'HTTPS_PROXY', value: cfg.egressProxy },
            { name: 'HTTP_PROXY', value: cfg.egressProxy },
            // Gateway reached directly on the cluster network, not via proxy.
            {
              name: 'NO_PROXY',
              value: '127.0.0.1,localhost,sandbox-llm-gateway',
            },
            // DinD signal + tier for the entrypoint (sysbox/kata only).
            ...(dind
              ? [
                  { name: 'TALE_DIND', value: '1' },
                  { name: 'TALE_RUNTIME_TIER', value: cfg.runtimeTier },
                  ...(cfg.dindInnerPool !== undefined
                    ? [
                        {
                          name: 'TALE_DIND_INNER_POOL_OVERRIDE',
                          value: parseDindInnerPool(cfg.dindInnerPool),
                        },
                      ]
                    : []),
                ]
              : []),
            // DinD transparent egress: the already-root runner installs the
            // OUTPUT REDIRECT inline after the inner dockerd is up (non-DinD uses
            // the native sidecar above, so the runner gets no such signal there).
            ...(transparentEgress && dind
              ? [{ name: 'TALE_TRANSPARENT_EGRESS', value: '1' }]
              : []),
          ],
          ports: [{ containerPort: RUNNERD_PORT }],
          // Unauthenticated probe endpoint (returns no session data).
          readinessProbe: {
            httpGet: { path: '/readyz', port: RUNNERD_PORT },
            initialDelaySeconds: 1,
            periodSeconds: 5,
          },
          // Give DinD/bootstrap its full create budget. Once booted, an
          // unresponsive daemon must recover even when its session is pinned.
          // Probe daemon responsiveness, never an agent's stdout or Docker.
          startupProbe: {
            httpGet: { path: '/readyz', port: RUNNERD_PORT },
            periodSeconds: 5,
            timeoutSeconds: 2,
            failureThreshold: Math.max(
              1,
              Math.ceil(cfg.session.createHealthTimeoutMs / 5_000),
            ),
          },
          livenessProbe: {
            // Docker readiness can fail while runnerd still owns active work.
            httpGet: { path: '/livez', port: RUNNERD_PORT },
            periodSeconds: 10,
            timeoutSeconds: 5,
            failureThreshold: 6,
          },
          resources: {
            requests: { ...requests, 'ephemeral-storage': ephemeralRequest },
            limits: {
              cpu: cpuLimit,
              memory: memLimit,
              'ephemeral-storage': ephemeralLimit,
            },
          },
          securityContext: runnerSecurityContext,
          volumeMounts: [
            { name: 'workspace', mountPath: WORKSPACE_MOUNT },
            { name: 'tmp', mountPath: '/tmp' },
            { name: 'dshm', mountPath: '/dev/shm' },
            ...(dind
              ? [{ name: 'docker-storage', mountPath: '/var/lib/docker' }]
              : []),
          ],
        },
      ],
    },
  };
}

/** Map a docker memory quantity ('4g', '1500m', '512Mi') to a K8s one. */
function dockerMemToK8s(mem: string): string {
  const m = /^(\d+)([bkmg]?)$/i.exec(mem);
  if (!m) return mem; // already a K8s quantity (e.g. '1500Mi')
  const n = m[1];
  switch ((m[2] ?? '').toLowerCase()) {
    case 'g':
      return `${n}Gi`;
    case 'm':
      return `${n}Mi`;
    case 'k':
      return `${n}Ki`;
    default:
      return `${n}`;
  }
}
