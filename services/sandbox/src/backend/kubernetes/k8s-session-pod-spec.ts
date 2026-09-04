// Canonical session-Pod builder — the K8s analogue of docker-session-args.ts.
//
// One LONG-LIVED Pod per session running runnerd under the image's tini init
// (the `daemon` entrypoint dispatch). Unlike the one-shot pod-per-exec shape there
// is no stage initContainer / harvest sidecar — runnerd does staging, exec,
// and harvest at runtime over HTTP. `restartPolicy: Always` so a runner crash
// restarts in place against the surviving emptyDir workspace; the daemon is
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

import {
  dindCapabilityOf,
  transparentEgressSupported,
} from '../../runtime-tier.ts';
import { RUNNERD_PORT } from '../../session/runnerd-protocol.ts';
import type { SessionAgentProfileConfig, SpawnerConfig } from '../../types.ts';
import type { SandboxSessionProfile } from '../../wire.ts';

interface SessionPodInput {
  sessionId: string;
  organizationId: string;
  profile: SandboxSessionProfile;
  createdAtMs: number;
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

  const profile =
    inp.profile === 'agent' ? cfg.session.agentProfile : { ...DEFAULT_PROFILE };
  const [uidStr, gidStr] = profile.user.split(':');
  const uid = Number(uidStr ?? '65534');
  const gid = Number(gidStr ?? '65534');
  // K8s memory limits use Mi/Gi; the docker quantity (e.g. '4g') maps to '4Gi'.
  const memLimit = dockerMemToK8s(profile.memory);

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
  const dind = cfg.dockerInContainer;
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
        'tale.dev/created-at': String(inp.createdAtMs),
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
      securityContext: {
        fsGroup: gid,
        seccompProfile: { type: dind ? 'Unconfined' : 'RuntimeDefault' },
      },
      volumes: [
        {
          name: 'workspace',
          persistentVolumeClaim: {
            claimName: sessionWorkspacePvcNameFor(inp.sessionId),
          },
        },
        { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '512Mi' } },
        // /dev/shm — Chromium (Playwright) crashes on the 64Mi default.
        { name: 'dshm', emptyDir: { medium: 'Memory', sizeLimit: '512Mi' } },
        // Inner dockerd store (DinD only): ephemeral emptyDir, size-bounded so a
        // runaway `docker build` can't fill the node. NOT the PVC workspace —
        // overlay-on-overlay is rejected, and image cache shouldn't persist
        // (dirty-overlay2 on a crash would wedge the restart-in-place).
        ...(dind
          ? [
              {
                name: 'docker-storage',
                emptyDir: { sizeLimit: cfg.k8s.workspaceSizeLimit },
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
          // `daemon` entrypoint dispatch → tini (PID 1, reaps orphans) + runnerd.
          args: ['daemon'],
          envFrom,
          env: [
            { name: 'HTTPS_PROXY', value: cfg.egressProxy },
            { name: 'HTTP_PROXY', value: cfg.egressProxy },
            // Gateway reached directly on the cluster network, not via proxy.
            // `llm-gateway` kept alongside the renamed `sandbox-llm-gateway` for
            // one release so in-flight sessions on the old hostname still resolve.
            {
              name: 'NO_PROXY',
              value: '127.0.0.1,localhost,sandbox-llm-gateway,llm-gateway',
            },
            // DinD signal + tier for the entrypoint (sysbox/kata only).
            ...(dind
              ? [
                  { name: 'TALE_DIND', value: '1' },
                  { name: 'TALE_RUNTIME_TIER', value: cfg.runtimeTier },
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
          resources: {
            requests: { cpu: '500m', memory: '1Gi' },
            limits: { cpu: String(profile.cpus), memory: memLimit },
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
