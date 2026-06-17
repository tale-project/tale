// Regression gate for the Kubernetes runtime-Pod builder — the K8s analogue of
// docker-args.test.ts. Asserts the docker→Pod field mapping, the hardened
// securityContext, the exec-free 3-container shape (stage init + runner +
// harvest), that the per-exec Secret is mounted ONLY into stage/harvest (never
// the runner), and that unsafe identifiers are rejected. No cluster needed.

import { describe, expect, test } from 'bun:test';

import { TEST_SESSION_CONFIG } from '../../session/session-test-config.ts';
import type { SpawnerConfig } from '../../types.ts';
import { EXEC_SPEC_MOUNT_DIR, secretNameFor } from './exec-spec.ts';
import { buildSandboxPod, podNameFor } from './k8s-pod-spec.ts';

const cfg: SpawnerConfig = {
  backend: 'kubernetes',
  port: 8003,
  sandboxToken: 'test',
  runtimeImage: 'tale-sandbox-runtime:test',
  runtimeTier: 'runc',
  dockerInContainer: false,
  browserView: false,
  transparentEgress: false,
  k8s: {
    namespace: 'tale-sandbox',
    runtimeClassName: null,
    spawnerImage: 'tale-sandbox:test',
    cacheMode: 'none',
    workspaceSizeLimit: '4Gi',
  },
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  maxConcurrent: 4,
  hostSessionRoot: '/var/lib/tale-sandbox/sessions',
  cacheVolumePrefix: { pip: 'pip', npm: 'npm', bun: 'bun' },
  egressNetwork: 'tale-sandbox-net',
  egressProxy: 'http://sandbox-egress:3128',
  stdoutMaxBytes: 5_242_880,
  stderrMaxBytes: 5_242_880,
  outputFileMaxBytes: 52_428_800,
  outputTotalMaxBytes: 104_857_600,
  maxRequestBodyBytes: 262_144,
  session: TEST_SESSION_CONFIG,
};

const goodInput = {
  executionId: 'k74m9zr5b8jcgvx2pqfwsdyhntq3l1a0',
  organizationId: 'org_456',
  language: 'python' as const,
  entryPath: 'main.py',
  startedAtMs: 1_700_000_000_000,
};

type Pod = ReturnType<typeof buildSandboxPod>;

function runner(pod: Pod) {
  const c = pod.spec?.containers.find((x) => x.name === 'runner');
  if (!c) throw new Error('no runner container');
  return c;
}
function harvest(pod: Pod) {
  const c = pod.spec?.containers.find((x) => x.name === 'harvest');
  if (!c) throw new Error('no harvest container');
  return c;
}
function stage(pod: Pod) {
  const c = pod.spec?.initContainers?.find((x) => x.name === 'stage');
  if (!c) throw new Error('no stage initContainer');
  return c;
}

describe('podNameFor', () => {
  test('is deterministic, DNS-1123-safe, and <= 63 chars', () => {
    const a = podNameFor(goodInput.executionId);
    const b = podNameFor(goodInput.executionId);
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(63);
    expect(a).toMatch(/^[a-z0-9-]+$/);
    expect(a.startsWith('tale-sbx-')).toBe(true);
  });

  test('normalizes uppercase/underscore/over-long ids into a safe name', () => {
    const ugly = 'ABC_def-' + 'x'.repeat(80);
    const name = podNameFor(ugly);
    expect(name).toMatch(/^tale-sbx-[a-f0-9]{16}$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });
});

describe('buildSandboxPod', () => {
  test('metadata: name/namespace/labels/annotations', () => {
    const pod = buildSandboxPod(cfg, goodInput);
    expect(pod.apiVersion).toBe('v1');
    expect(pod.kind).toBe('Pod');
    expect(pod.metadata?.name).toBe(podNameFor(goodInput.executionId));
    expect(pod.metadata?.namespace).toBe('tale-sandbox');
    expect(pod.metadata?.labels?.['tale.sandbox']).toBe('1');
    // NetworkPolicy selects runtime pods by this label for egress isolation.
    expect(pod.metadata?.labels?.['tale.sandbox/role']).toBe('runtime');
    // Raw ids preserved in annotations (no charset/length limit).
    expect(pod.metadata?.annotations?.['tale.dev/execution-id']).toBe(
      goodInput.executionId,
    );
    expect(pod.metadata?.annotations?.['tale.dev/organization-id']).toBe(
      'org_456',
    );
    expect(pod.metadata?.annotations?.['tale.dev/started-at']).toBe(
      '1700000000000',
    );
  });

  test('pod spec hardening: restartPolicy, no SA token, no service links, fsGroup', () => {
    const pod = buildSandboxPod(cfg, goodInput);
    expect(pod.spec?.restartPolicy).toBe('Never');
    expect(pod.spec?.automountServiceAccountToken).toBe(false);
    expect(pod.spec?.enableServiceLinks).toBe(false);
    expect(pod.spec?.terminationGracePeriodSeconds).toBe(0);
    expect(pod.spec?.securityContext?.fsGroup).toBe(65534);
    expect(pod.spec?.securityContext?.seccompProfile?.type).toBe(
      'RuntimeDefault',
    );
  });

  test('exec-free shape: one stage initContainer + runner + harvest containers', () => {
    const pod = buildSandboxPod(cfg, goodInput);
    expect(pod.spec?.initContainers?.map((c) => c.name)).toEqual(['stage']);
    expect(pod.spec?.containers.map((c) => c.name)).toEqual([
      'runner',
      'harvest',
    ]);
    // No holder sidecar / exec transport remnants.
    expect(
      pod.spec?.containers.find((c) => c.name === 'holder'),
    ).toBeUndefined();
  });

  test('runner container maps the docker-args contract', () => {
    const c = runner(buildSandboxPod(cfg, goodInput));
    expect(c.image).toBe('tale-sandbox-runtime:test');
    // Pull once + reuse (matches docker); never re-pull :latest every exec.
    expect(c.imagePullPolicy).toBe('IfNotPresent');
    // command runs the image entrypoint as a CHILD (no `exec`) so the wrapper
    // resumes to capture the exit code; stderr is split to a file.
    expect(c.command?.[0]).toBe('/bin/sh');
    expect(c.command?.[1]).toBe('-c');
    expect(c.command?.[2]).toContain('/entrypoint.sh "$0" "$1" "$2" "$3"');
    expect(c.command?.[2]).toContain('2>/user/.runtime/tale/stderr.log');
    expect(c.command?.[2]).toContain('echo $? > /user/.runtime/tale/exit-code');
    // No sentinel handshake — staging is an initContainer now.
    expect(c.command?.[2]).not.toContain('.staged');
    expect(c.command?.[2]).not.toContain('exec /entrypoint.sh');
    // positional args = entrypoint's [language, packages, options, entry].
    expect(c.args).toEqual([
      'python',
      '/user/code/packages.json',
      '/user/code/options.json',
      'main.py',
    ]);
  });

  test('runner resource caps mirror --cpus=1 --memory=1500m', () => {
    const c = runner(buildSandboxPod(cfg, goodInput));
    expect(c.resources?.requests?.cpu).toBe('1');
    expect(c.resources?.requests?.memory).toBe('1500Mi');
    expect(c.resources?.limits?.cpu).toBe('1');
    expect(c.resources?.limits?.memory).toBe('1500Mi');
  });

  test('runner securityContext mirrors --read-only --cap-drop=ALL no-new-privileges --user 65534', () => {
    const sc = runner(buildSandboxPod(cfg, goodInput)).securityContext;
    expect(sc?.runAsUser).toBe(65534);
    expect(sc?.runAsGroup).toBe(65534);
    expect(sc?.runAsNonRoot).toBe(true);
    expect(sc?.readOnlyRootFilesystem).toBe(true);
    expect(sc?.allowPrivilegeEscalation).toBe(false);
    expect(sc?.capabilities?.drop).toEqual(['ALL']);
    expect(sc?.seccompProfile?.type).toBe('RuntimeDefault');
  });

  test('runner egress env mirrors HTTP(S)_PROXY/NO_PROXY', () => {
    const env = runner(buildSandboxPod(cfg, goodInput)).env ?? [];
    const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
    expect(byName.HTTPS_PROXY).toBe('http://sandbox-egress:3128');
    expect(byName.HTTP_PROXY).toBe('http://sandbox-egress:3128');
    expect(byName.NO_PROXY).toBe('127.0.0.1,localhost');
    // cacheMode 'none' must NOT set /cache/* env (no mount → readonly-fs break).
    expect(byName.PIP_CACHE_DIR).toBeUndefined();
    expect(byName.NPM_CONFIG_CACHE).toBeUndefined();
  });

  test('SECURITY: per-exec Secret is mounted into stage + harvest, NEVER the runner', () => {
    const pod = buildSandboxPod(cfg, goodInput);
    const secretName = secretNameFor(goodInput.executionId);
    // The Secret volume exists at Pod level...
    const vol = pod.spec?.volumes?.find((v) => v.name === 'exec-spec');
    expect(vol?.secret?.secretName).toBe(secretName);
    // ...mounted read-only into the trusted helper containers...
    for (const c of [stage(pod), harvest(pod)]) {
      const m = c.volumeMounts?.find((x) => x.name === 'exec-spec');
      expect(m?.mountPath).toBe(EXEC_SPEC_MOUNT_DIR);
      expect(m?.readOnly).toBe(true);
    }
    // ...and NOT mounted into the runner (no token / presigned URLs reach
    // user code). This is the core security invariant of the exec-free design.
    expect(
      runner(pod).volumeMounts?.find((m) => m.name === 'exec-spec'),
    ).toBeUndefined();
  });

  test('runner env carries no SANDBOX_TOKEN / presigned URLs', () => {
    const env = runner(buildSandboxPod(cfg, goodInput)).env ?? [];
    const names = env.map((e) => e.name);
    expect(names).not.toContain('SANDBOX_TOKEN');
    // Only the egress proxy + HOME are set — no callback endpoints/URLs.
    for (const e of env) {
      expect(e.value ?? '').not.toContain('http://sandbox-egress:3128/upload');
    }
  });

  test('stage initContainer + harvest run the spawner image with their entry modes', () => {
    const pod = buildSandboxPod(cfg, goodInput);
    const s = stage(pod);
    expect(s.image).toBe('tale-sandbox:test');
    expect(s.command?.[0]).toBe('bun');
    expect(s.command?.[1]).toContain('k8s-stage.ts');
    const h = harvest(pod);
    expect(h.image).toBe('tale-sandbox:test');
    expect(h.command?.[0]).toBe('bun');
    expect(h.command?.[1]).toContain('k8s-harvest.ts');
  });

  test('workspace emptyDir is shared by stage, runner, and harvest at /user', () => {
    const pod = buildSandboxPod(cfg, goodInput);
    const ws = pod.spec?.volumes?.find((v) => v.name === 'workspace');
    expect(ws?.emptyDir).toBeDefined();
    // Disk-bound: everything the execution writes lands here (HOME, TMPDIR,
    // deps, outputs), so an uncapped emptyDir is a node-disk DoS surface.
    expect(ws?.emptyDir?.sizeLimit).toBe('4Gi');
    for (const c of [stage(pod), runner(pod), harvest(pod)]) {
      const m = c.volumeMounts?.find((x) => x.name === 'workspace');
      expect(m?.mountPath).toBe('/user');
    }
  });

  test('workspace sizeLimit is operator-configurable', () => {
    const pod = buildSandboxPod(
      { ...cfg, k8s: { ...cfg.k8s, workspaceSizeLimit: '10Gi' } },
      goodInput,
    );
    const ws = pod.spec?.volumes?.find((v) => v.name === 'workspace');
    expect(ws?.emptyDir?.sizeLimit).toBe('10Gi');
  });

  test('helper containers are hardened non-root', () => {
    const pod = buildSandboxPod(cfg, goodInput);
    for (const c of [stage(pod), harvest(pod)]) {
      expect(c.securityContext?.runAsUser).toBe(65534);
      expect(c.securityContext?.runAsNonRoot).toBe(true);
      expect(c.securityContext?.readOnlyRootFilesystem).toBe(true);
      expect(c.securityContext?.allowPrivilegeEscalation).toBe(false);
      // Pin the full hardening set — a silently-weakened helper would carry
      // the SANDBOX_TOKEN with extra capabilities.
      expect(c.securityContext?.capabilities?.drop).toEqual(['ALL']);
      expect(c.securityContext?.seccompProfile?.type).toBe('RuntimeDefault');
    }
  });

  test('RUNNER_WRAPPER invariant: a surviving wrapper always exits 0 (echo is last)', () => {
    // The runner-dead short-circuit in k8s-backend.ts depends on this: the
    // wrapper's LAST command is the echo into the exit-code file, so a
    // non-zero runner-container exit means the wrapper itself was killed and
    // the exit-code file will never appear.
    const c = runner(buildSandboxPod(cfg, goodInput));
    const script = c.command?.[2] ?? '';
    const lastLine = script.trim().split('\n').at(-1) ?? '';
    expect(lastLine).toBe('echo $? > /user/.runtime/tale/exit-code');
  });

  test('runtimeClassName: omitted for runc, applied per tier', () => {
    expect(
      buildSandboxPod(cfg, goodInput).spec?.runtimeClassName,
    ).toBeUndefined();
    const gvisor = buildSandboxPod(
      {
        ...cfg,
        runtimeTier: 'gvisor',
        k8s: { ...cfg.k8s, runtimeClassName: 'gvisor' },
      },
      goodInput,
    );
    expect(gvisor.spec?.runtimeClassName).toBe('gvisor');
    const sysbox = buildSandboxPod(
      {
        ...cfg,
        runtimeTier: 'sysbox',
        k8s: { ...cfg.k8s, runtimeClassName: 'sysbox-runc' },
      },
      goodInput,
    );
    expect(sysbox.spec?.runtimeClassName).toBe('sysbox-runc');
  });

  test('cacheMode pvc mounts per-org PVCs + sets cache env', () => {
    const pod = buildSandboxPod(
      { ...cfg, k8s: { ...cfg.k8s, cacheMode: 'pvc' } },
      { ...goodInput, cache: { pip: 'pip-org_456', npm: 'npm-org_456' } },
    );
    const vols = pod.spec?.volumes ?? [];
    expect(
      vols.find((v) => v.name === 'pip-cache')?.persistentVolumeClaim
        ?.claimName,
    ).toBe('pip-org_456');
    expect(
      vols.find((v) => v.name === 'npm-cache')?.persistentVolumeClaim
        ?.claimName,
    ).toBe('npm-org_456');
    const env = runner(pod).env ?? [];
    const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
    expect(byName.PIP_CACHE_DIR).toBe('/cache/pip');
    expect(byName.NPM_CONFIG_CACHE).toBe('/cache/npm');
  });

  test('rejects unsafe executionId / organizationId / entryPath', () => {
    expect(() =>
      buildSandboxPod(cfg, { ...goodInput, executionId: 'bad;id' }),
    ).toThrow(/executionId/);
    expect(() =>
      buildSandboxPod(cfg, { ...goodInput, organizationId: 'org 456' }),
    ).toThrow(/organizationId/);
    expect(() =>
      buildSandboxPod(cfg, { ...goodInput, entryPath: '../escape.py' }),
    ).toThrow(/entryPath/);
  });
});
