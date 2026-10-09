// Spawner configuration — parsed from env at boot. Defaults match the plan;
// every knob is overridable so an operator can tune without rebuilding.

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { DOCKER_STORAGE_SIZE_LIMIT } from './backend/kubernetes/k8s-session-pod-spec.ts';
import { parseDindInnerPool } from './network-address.ts';
import {
  dindDefaultEnabled,
  dindExperimental,
  dindIsPrivileged,
  isRuntimeTier,
  k8sRuntimeClassFor,
  RUNTIME_TIERS,
  transparentEgressSupported,
  type RuntimeTier,
} from './runtime-tier.ts';
import { RUNNERD_MAX_REQUEST_BODY_BYTES } from './session/runnerd-protocol.ts';
import type { HubConfig, K8sToleration, SpawnerConfig } from './types.ts';

// Parse a boolean env, returning undefined when UNSET/empty so a caller can
// distinguish "operator didn't set it" (apply a default) from an explicit
// true/false. 'true'/'1'/'yes'/'on' ⇒ true; everything else ⇒ false. Trimmed
// so '  true  ' works. Used for SANDBOX_DOCKER_IN_CONTAINER (tier-aware default).
function boolEnvOpt(name: string): boolean | undefined {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return undefined;
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * The `sandboxRuntime` section of the deployment config, if present. The
 * spawner mounts the shared platform-config dir read-only (see compose.yml);
 * the deployment config is the operator's higher-level source of truth and OVERRIDES
 * the SANDBOX_RUNTIME / SANDBOX_DOCKER_IN_CONTAINER env when it sets them.
 * Reads `deployment.yml` (the current form) with the retired
 * `deployment.json` as a fallback until the platform's next save converts
 * it. Absent files ⇒ env defaults (the common case). Present-but-unparseable
 * ⇒ fail closed (matches the rag/convex boot convention), since silently
 * ignoring a config the operator wrote reads as a misconfiguration.
 */
function deploymentSandboxRuntime(): {
  tier?: string;
  dockerInContainer?: boolean;
  dockerBuildCache?: boolean;
} {
  const dir =
    process.env.TALE_PLATFORM_SHARED_CONFIG_DIR ?? '/app/platform-config';
  const candidates = [`${dir}/deployment.yml`, `${dir}/deployment.json`];
  let raw: string | undefined;
  let path = candidates[0];
  for (const candidate of candidates) {
    try {
      raw = readFileSync(candidate, 'utf8');
      path = candidate;
      break;
    } catch (err) {
      // ENOENT (no deployment config in this form) → try the next form.
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      ) {
        continue;
      }
      throw new Error(`could not read ${candidate}`, { cause: err });
    }
  }
  if (raw === undefined) return {};
  let json: {
    sandboxRuntime?: {
      tier?: unknown;
      dockerInContainer?: unknown;
      dockerBuildCache?: unknown;
    };
  };
  try {
    // YAML is a superset of JSON, so one parser covers both era forms.
    json = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `${path} is present but not valid YAML/JSON (fail-closed)`,
      { cause: err },
    );
  }
  const sr = json.sandboxRuntime;
  if (!sr || typeof sr !== 'object') return {};
  const out: {
    tier?: string;
    dockerInContainer?: boolean;
    dockerBuildCache?: boolean;
  } = {};
  if (typeof sr.tier === 'string') out.tier = sr.tier;
  if (typeof sr.dockerInContainer === 'boolean') {
    out.dockerInContainer = sr.dockerInContainer;
  }
  if (typeof sr.dockerBuildCache === 'boolean') {
    out.dockerBuildCache = sr.dockerBuildCache;
  }
  return out;
}

const CPU_QUANTITY_RE = /^\d+(\.\d+)?m?$/;
const MEMORY_QUANTITY_RE = /^\d+(\.\d+)?(Ki|Mi|Gi|Ti|k|M|G|T)?$/;

/** An optional Kubernetes quantity from the environment: undefined when
 * unset, refused at boot when it is not one (a typo would otherwise reach
 * every Pod create as an apiserver 422). */
function k8sQuantityEnv(name: string, re: RegExp): string | undefined {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') return undefined;
  if (!re.test(value)) {
    throw new Error(
      `Env var ${name} is not a Kubernetes quantity: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** A storage size from the environment that must hold something: a zero
 * sizeLimit or ephemeral-storage limit gets a Pod evicted on its first
 * write. */
function k8sSizeEnv(name: string): string | undefined {
  const value = k8sQuantityEnv(name, MEMORY_QUANTITY_RE);
  if (value !== undefined && Number.parseFloat(value) <= 0) {
    throw new Error(`Env var ${name} must be above zero; got: ${value}`);
  }
  return value;
}

/** A Kubernetes-only setting: refused at boot on the Kubernetes backend when
 * it cannot be read. Any other backend ignores it, so there an unreadable
 * value only warns, and a stray one in a shared env file never stops a
 * Docker spawner from starting. */
function k8sOnlyEnv<T>(name: string, read: () => T): T | undefined {
  try {
    return read();
  } catch (err) {
    if ((process.env.SANDBOX_BACKEND ?? 'docker') === 'kubernetes') throw err;
    console.warn(
      `[sandbox.config] ignoring ${name}, which only the Kubernetes backend reads:`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

const LABEL_NAME_RE = /^[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;
const DNS_SUBDOMAIN_RE =
  /^(?=.{1,253}$)[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** A Kubernetes label key: a name of at most 63 characters, optionally behind
 * a DNS-subdomain prefix (`tale.dev/sandbox`). Toleration keys share it. */
function isLabelKey(key: string): boolean {
  const parts = key.split('/');
  const name = parts.at(-1) ?? '';
  if (parts.length > 2 || !LABEL_NAME_RE.test(name)) return false;
  return parts.length === 1 || DNS_SUBDOMAIN_RE.test(parts[0] ?? '');
}

function isLabelValue(value: string): boolean {
  return value === '' || LABEL_NAME_RE.test(value);
}

/** A JSON value from the environment: undefined when unset, refused at boot
 * when it does not parse. */
function jsonEnv(name: string): unknown {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Env var ${name} is not valid JSON: ${JSON.stringify(raw)}`,
      {
        cause: err,
      },
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The node labels a session Pod must land on (SANDBOX_K8S_NODE_SELECTOR, a
 * JSON object), checked here so a malformed label fails the boot instead of
 * every create at the apiserver. */
function nodeSelectorEnv(): Record<string, string> | undefined {
  const name = 'SANDBOX_K8S_NODE_SELECTOR';
  const parsed = jsonEnv(name);
  if (parsed === undefined) return undefined;
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Env var ${name} must be a JSON object of node labels, such as {"tale.dev/sandbox":"true"}`,
    );
  }
  const selector: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isLabelKey(key)) {
      throw new Error(
        `Env var ${name} has a key that is no Kubernetes label key: ${JSON.stringify(key)}`,
      );
    }
    if (typeof value !== 'string' || !isLabelValue(value)) {
      throw new Error(
        `Env var ${name} has a value for ${key} that is no Kubernetes label value: ${JSON.stringify(value)}`,
      );
    }
    selector[key] = value;
  }
  return Object.keys(selector).length > 0 ? selector : undefined;
}

const TOLERATION_FIELDS = [
  'key',
  'operator',
  'value',
  'effect',
  'tolerationSeconds',
] as const;
const TOLERATION_EFFECTS = [
  'NoSchedule',
  'PreferNoSchedule',
  'NoExecute',
] as const;

function isTolerationEffect(
  value: unknown,
): value is (typeof TOLERATION_EFFECTS)[number] {
  return TOLERATION_EFFECTS.some((effect) => effect === value);
}

/** One entry of SANDBOX_K8S_TOLERATIONS, held to the apiserver's rules. */
function tolerationAt(at: string, entry: unknown): K8sToleration {
  if (!isPlainObject(entry)) throw new Error(`${at} must be a JSON object`);
  const unknown = Object.keys(entry).filter(
    (field) => !TOLERATION_FIELDS.some((known) => known === field),
  );
  if (unknown.length > 0) {
    throw new Error(
      `${at} has unknown field ${unknown.join(', ')}; a toleration takes ${TOLERATION_FIELDS.join(', ')}`,
    );
  }
  const { key, operator, value, effect, tolerationSeconds } = entry;
  const toleration: K8sToleration = {};
  if (key !== undefined) {
    if (typeof key !== 'string' || (key !== '' && !isLabelKey(key))) {
      throw new Error(
        `${at}.key is no Kubernetes label key: ${JSON.stringify(key)}`,
      );
    }
    toleration.key = key;
  }
  // The apiserver reads an empty operator as Equal and an empty effect as
  // every effect, so both count as omitted here too.
  if (operator !== undefined && operator !== '') {
    if (operator !== 'Equal' && operator !== 'Exists') {
      throw new Error(
        `${at}.operator must be Equal or Exists; got: ${JSON.stringify(operator)}`,
      );
    }
    toleration.operator = operator;
  }
  if (value !== undefined) {
    if (typeof value !== 'string' || !isLabelValue(value)) {
      throw new Error(
        `${at}.value is no Kubernetes label value: ${JSON.stringify(value)}`,
      );
    }
    toleration.value = value;
  }
  if (effect !== undefined && effect !== '') {
    if (!isTolerationEffect(effect)) {
      throw new Error(
        `${at}.effect must be ${TOLERATION_EFFECTS.join(', ')}; got: ${JSON.stringify(effect)}`,
      );
    }
    toleration.effect = effect;
  }
  if (tolerationSeconds !== undefined) {
    if (
      typeof tolerationSeconds !== 'number' ||
      !Number.isSafeInteger(tolerationSeconds)
    ) {
      throw new Error(
        `${at}.tolerationSeconds must be a whole number of seconds`,
      );
    }
    toleration.tolerationSeconds = tolerationSeconds;
  }
  if (toleration.operator === 'Exists' && toleration.value) {
    throw new Error(`${at} uses operator Exists, which takes no value`);
  }
  if (!toleration.key && toleration.operator !== 'Exists') {
    throw new Error(`${at} has no key, which needs operator Exists`);
  }
  if (
    toleration.tolerationSeconds !== undefined &&
    toleration.effect !== 'NoExecute'
  ) {
    throw new Error(`${at}.tolerationSeconds applies only to effect NoExecute`);
  }
  return toleration;
}

/** The taints a session Pod tolerates (SANDBOX_K8S_TOLERATIONS, a JSON array
 * in the Pod spec's own shape). */
function tolerationsEnv(): K8sToleration[] | undefined {
  const name = 'SANDBOX_K8S_TOLERATIONS';
  const parsed = jsonEnv(name);
  if (parsed === undefined) return undefined;
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Env var ${name} must be a JSON array of tolerations, such as [{"key":"tale.dev/sandbox","operator":"Exists","effect":"NoSchedule"}]`,
    );
  }
  const tolerations = parsed.map((entry: unknown, index) =>
    tolerationAt(`Env var ${name}[${index}]`, entry),
  );
  return tolerations.length > 0 ? tolerations : undefined;
}

/** The PriorityClass of session Pods (SANDBOX_K8S_PRIORITY_CLASS). */
function priorityClassEnv(): string | undefined {
  const name = 'SANDBOX_K8S_PRIORITY_CLASS';
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') return undefined;
  if (!DNS_SUBDOMAIN_RE.test(value)) {
    throw new Error(
      `Env var ${name} is not a PriorityClass name (lowercase letters, digits, '-' and '.'): ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** A Docker-style size of memory or disk from the environment ('2g',
 * '1536m', bytes), undefined when unset, refused at boot when unreadable. */
function sizeEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') return undefined;
  const m = /^(\d+)([kmg]?)b?$/i.exec(value);
  if (!m) {
    throw new Error(
      `Env var ${name} is not a size such as 2g or 1536m: ${JSON.stringify(value)}`,
    );
  }
  const unit = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[
    (m[2] ?? '').toLowerCase()
  ];
  return Number(m[1]) * (unit ?? 1);
}

/** A duration in whole days or hours from the environment (`14d`, `336h`),
 * `0` or `off` for none: undefined when unset, refused at boot when it is
 * neither. */
function retentionEnv(name: string): number | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === '') return undefined;
  if (value === '0' || value === 'off') return 0;
  const m = /^(\d+)([dh])$/.exec(value);
  if (!m) {
    throw new Error(
      `Env var ${name} is not a duration such as 14d or 336h (or off): ${JSON.stringify(value)}`,
    );
  }
  const hours = m[2] === 'd' ? Number(m[1]) * 24 : Number(m[1]);
  return hours * 60 * 60 * 1000;
}

function numEnv(
  name: string,
  fallback: number,
  opts?: { min?: number; max?: number },
): number {
  const v = process.env[name];
  // Trim + empty-string ⇒ unset. Without the trim, `SANDBOX_PORT='  '` would
  // pass `Number('  ') === 0` and silently disable the port (audit finding).
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(
      `Env var ${name} is not a finite number: ${JSON.stringify(v)}`,
    );
  }
  const min = opts?.min ?? 0;
  if (n < min) {
    throw new Error(`Env var ${name} must be >= ${min}; got: ${n}`);
  }
  if (opts?.max !== undefined && n > opts.max) {
    throw new Error(`Env var ${name} must be <= ${opts.max}; got: ${n}`);
  }
  return n;
}

/** A Docker `--cpu-shares` weight: a whole number in the 2–262144 range the
 * kernel accepts (0 would mean "the default 1024", which defeats the point). */
function cpuSharesEnv(name: string, fallback: number): number {
  const shares = numEnv(name, fallback, { min: 2, max: 262_144 });
  if (!Number.isInteger(shares)) {
    throw new Error(`Env var ${name} must be a whole number; got: ${shares}`);
  }
  return shares;
}

/**
 * Parse + validate a `uid:gid` env (SANDBOX_AGENT_USER). Both must be integers
 * >= 1 — a malformed value (`"invalid"` ⇒ NaN, `":"` ⇒ 0:0 = root) would
 * otherwise silently land the agent container on root, defeating the non-root
 * hardening that Claude Code's bypassPermissions depends on. Returns the
 * canonical `uid:gid` string plus the parsed numerics for backends that need
 * either form.
 */
function userEnv(
  name: string,
  fallback: string,
): { user: string; uid: number; gid: number } {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  if (!/^\d+:\d+$/.test(value)) {
    throw new Error(
      `Env var ${name} must be 'uid:gid' (digits only); got: ${JSON.stringify(value)}`,
    );
  }
  const [uidStr, gidStr] = value.split(':');
  const uid = Number(uidStr);
  const gid = Number(gidStr);
  if (uid < 1 || gid < 1) {
    throw new Error(
      `Env var ${name} must have uid >= 1 and gid >= 1 (no root); got: ${value}`,
    );
  }
  return { user: `${uid}:${gid}`, uid, gid };
}

/** A workload allowlist, with an explicit `none` for a lightweight fleet. */
function dockerWorkloadsEnv(): readonly ('project' | 'workflow')[] | undefined {
  const raw = process.env.SANDBOX_DOCKER_WORKLOADS?.trim();
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'none') return [];
  const values = raw.split(',').map((value) => value.trim());
  if (values.some((value) => value !== 'project' && value !== 'workflow')) {
    throw new Error(
      'SANDBOX_DOCKER_WORKLOADS must be project, workflow, project,workflow or none',
    );
  }
  return [
    ...new Set(
      values.filter(
        (value): value is 'project' | 'workflow' =>
          value === 'project' || value === 'workflow',
      ),
    ),
  ];
}

export function loadConfig(): SpawnerConfig {
  const dockerDataRoot =
    process.env.SANDBOX_DOCKER_DATA_ROOT?.trim() || undefined;
  const dockerDataPath =
    process.env.SANDBOX_DOCKER_DATA_PATH?.trim() ||
    (dockerDataRoot === undefined
      ? undefined
      : '/var/lib/tale-sandbox/docker-data');
  for (const [name, value] of [
    ['SANDBOX_DOCKER_DATA_ROOT', dockerDataRoot],
    ['SANDBOX_DOCKER_DATA_PATH', dockerDataPath],
  ]) {
    if (value !== undefined && (!isAbsolute(value) || value.includes('\0'))) {
      throw new Error(`${name} must be an absolute path`);
    }
  }
  // Runtime tier (default 'runc'). The deployment config (deployment.json,
  // operator's higher-level source of truth) overrides SANDBOX_RUNTIME when set;
  // 'runsc' is accepted as a back-compat alias for the 'gvisor' tier. The tier
  // is the deployment-wide, uniform isolation choice; it resolves to the docker
  // --runtime value and k8s runtimeClassName via runtime-tier.ts.
  const deployment = deploymentSandboxRuntime();
  const rawRuntime = (
    deployment.tier ??
    process.env.SANDBOX_RUNTIME ??
    'runc'
  ).trim();
  const aliased = rawRuntime === 'runsc' ? 'gvisor' : rawRuntime;
  if (!isRuntimeTier(aliased)) {
    throw new Error(
      `SANDBOX_RUNTIME must be one of ${RUNTIME_TIERS.join(', ')} (or 'runsc' for gvisor); got: ${JSON.stringify(rawRuntime)}`,
    );
  }
  const runtimeTier: RuntimeTier = aliased;
  // Native docker-in-container inside session containers. NOT policy-blocked on
  // any tier — the operator chooses the host posture; we surface the trade-offs
  // as loud warnings. Resolution precedence: deployment.json > explicit env >
  // tier-aware default. The default is ON for boundary-keeping tiers (sysbox
  // userns / kata VM — docker "just works" once the runtime is set up) and OFF
  // for runc (privileged host-root — opt-in only) and gvisor (flaky).
  //   runc  → PRIVILEGED inner daemon, no boundary (host-root): trusted-only.
  //   gvisor→ contained by runsc but nested docker networking is unreliable.
  //   sysbox/kata → the recommended, isolated paths.
  const dockerInContainer =
    deployment.dockerInContainer ??
    boolEnvOpt('SANDBOX_DOCKER_IN_CONTAINER') ??
    dindDefaultEnabled(runtimeTier);
  const dockerWorkloads = dockerWorkloadsEnv();
  const rawDindInnerPool = process.env.SANDBOX_DIND_INNER_POOL?.trim();
  const k8sCpuRequest = k8sQuantityEnv(
    'SANDBOX_K8S_CPU_REQUEST',
    CPU_QUANTITY_RE,
  );
  const k8sMemoryRequest = k8sQuantityEnv(
    'SANDBOX_K8S_MEMORY_REQUEST',
    MEMORY_QUANTITY_RE,
  );
  // A render's workspace emptyDir counts toward its Pod's ephemeral-storage
  // limit, so the size must be one the pod spec can add up.
  const k8sWorkspaceSizeLimit =
    k8sOnlyEnv('SANDBOX_K8S_WORKSPACE_SIZE_LIMIT', () =>
      k8sSizeEnv('SANDBOX_K8S_WORKSPACE_SIZE_LIMIT'),
    ) ?? '4Gi';
  const k8sEphemeralStorageRequest = k8sOnlyEnv(
    'SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST',
    () =>
      k8sQuantityEnv(
        'SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST',
        MEMORY_QUANTITY_RE,
      ),
  );
  const k8sEphemeralStorageLimit = k8sOnlyEnv(
    'SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT',
    () => k8sSizeEnv('SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT'),
  );
  const k8sDockerStorageSizeLimit = k8sOnlyEnv(
    'SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT',
    () => k8sSizeEnv('SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT'),
  );
  const k8sNodeSelector = k8sOnlyEnv(
    'SANDBOX_K8S_NODE_SELECTOR',
    nodeSelectorEnv,
  );
  const k8sTolerations = k8sOnlyEnv('SANDBOX_K8S_TOLERATIONS', tolerationsEnv);
  const k8sPriorityClassName = k8sOnlyEnv(
    'SANDBOX_K8S_PRIORITY_CLASS',
    priorityClassEnv,
  );
  const minFreeMemoryBytes = sizeEnv('SANDBOX_MIN_FREE_MEMORY');
  const minFreeDiskBytes = sizeEnv('SANDBOX_MIN_FREE_DISK');
  const criticalFreeDiskBytes = sizeEnv('SANDBOX_CRITICAL_FREE_DISK');
  const buildkitdMemoryBytes = sizeEnv('SANDBOX_BUILDKITD_MEMORY');
  const buildkitdIdleCacheBytes = sizeEnv('SANDBOX_BUILDKITD_IDLE_CACHE');
  const buildkitdMaxCacheBytes = sizeEnv('SANDBOX_BUILDKITD_MAX_CACHE');
  // Zero is no cap at all to BuildKit's GC policy, and less than a gigabyte
  // leaves no room for one build's layers.
  if (
    buildkitdMaxCacheBytes !== undefined &&
    buildkitdMaxCacheBytes < 1024 ** 3
  ) {
    throw new Error(
      `Env var SANDBOX_BUILDKITD_MAX_CACHE must be at least 1g; got: ${JSON.stringify(process.env.SANDBOX_BUILDKITD_MAX_CACHE)}`,
    );
  }
  const buildkitdCacheRetentionMs = retentionEnv(
    'SANDBOX_BUILDKITD_CACHE_RETENTION',
  );
  const packageCacheRetentionMs = retentionEnv(
    'SANDBOX_PACKAGE_CACHE_RETENTION',
  );
  const buildkitdCpus = process.env.SANDBOX_BUILDKITD_CPUS?.trim()
    ? numEnv('SANDBOX_BUILDKITD_CPUS', 0, { min: 0.1 })
    : undefined;
  const buildkitdIdleMs = process.env.SANDBOX_BUILDKITD_IDLE_MS?.trim()
    ? numEnv('SANDBOX_BUILDKITD_IDLE_MS', 0, { min: 60_000 })
    : undefined;
  const dindInnerPool = rawDindInnerPool
    ? parseDindInnerPool(rawDindInnerPool)
    : undefined;
  if (dockerInContainer) {
    if (dindIsPrivileged(runtimeTier)) {
      console.warn(
        `[sandbox.config] WARNING: docker-in-container on the '${runtimeTier}' tier runs a ` +
          `PRIVILEGED inner daemon with NO isolation boundary — in-container root IS host root. ` +
          `Use this ONLY for fully-trusted / single-tenant deployments. For untrusted multi-tenant, ` +
          `set SANDBOX_RUNTIME=sysbox (or kata) so in-container root maps to an unprivileged host uid.`,
      );
    } else if (dindExperimental(runtimeTier)) {
      console.warn(
        `[sandbox.config] WARNING: docker-in-container on the '${runtimeTier}' tier is EXPERIMENTAL — ` +
          `gVisor's user-space netstack + partial iptables commonly break nested-container networking ` +
          `(inner bridge/DNS/port publishing and the in-pod egress fence). Security is fine (runsc ` +
          `contains it); functionality is not guaranteed. Use SANDBOX_RUNTIME=sysbox (or kata) for reliable DinD.`,
      );
    }
  }
  // Shared build cache: one persistent buildkitd and per-registry pull-through
  // mirrors per organization (launched lazily, see buildkitd.ts). Sessions in
  // that organization reuse them for `docker build` / `docker compose up --build`
  // — instead of each session rebuilding all layers in its ephemeral inner
  // /var/lib/docker. DEFAULT = FOLLOW DinD: it's only meaningful with DinD (the
  // inner docker is what builds), and when DinD is on it's a strict, best-effort
  // improvement (a failed daemon falls back to the inner builder), so there's no
  // reason to make the operator opt in twice. Explicit SANDBOX_DOCKER_BUILD_CACHE
  // (or deployment.json) always wins — set it false to keep the extra daemons off.
  const dockerBuildCache =
    deployment.dockerBuildCache ??
    boolEnvOpt('SANDBOX_DOCKER_BUILD_CACHE') ??
    dockerInContainer;
  if (dockerBuildCache && !dockerInContainer) {
    console.warn(
      `[sandbox.config] WARNING: SANDBOX_DOCKER_BUILD_CACHE is on but docker-in-container is OFF — ` +
        `the shared build cache is inert without DinD (there is no inner docker to build). ` +
        `Enable SANDBOX_DOCKER_IN_CONTAINER (or a sysbox/kata tier) to use it.`,
    );
  }
  // Transparent egress for the session container's own processes (default ON).
  // The entrypoint installs an iptables OUTPUT REDIRECT → redsocks so any client
  // egresses through the proxy without honoring HTTP(S)_PROXY env. Reliable on
  // runc/sysbox/kata; unsupported on gvisor (runsc netstack) — warn and let the
  // session fall back to env-proxy for proxy-aware clients only.
  const transparentEgress = boolEnvOpt('SANDBOX_TRANSPARENT_EGRESS') ?? true;
  if (transparentEgress && !transparentEgressSupported(runtimeTier)) {
    console.warn(
      `[sandbox.config] WARNING: transparent egress is not supported on the '${runtimeTier}' tier ` +
        `(runsc's user-space netstack makes the iptables OUTPUT REDIRECT unreliable). Sessions fall ` +
        `back to the HTTPS_PROXY env, so proxy-IGNORANT clients (Node/undici default fetch, Go static ` +
        `binaries) will fail to reach the internet. Use SANDBOX_RUNTIME=runc (or sysbox/kata) for ` +
        `transparent egress, or set SANDBOX_TRANSPARENT_EGRESS=false to silence this.`,
    );
  }

  // The sandbox tier is a SINGLE container that rolls in-place via a serialized
  // drain — there is no blue/green colour here (the platform tier keeps it).
  // The session root is therefore the single flat path; sessions created by a
  // previous (colour-rooted) build are still adoptable, see the legacy-compat
  // fallback in docker-session-backend.ts.
  const sessionRootBase =
    process.env.SANDBOX_HOST_SESSION_ROOT ?? '/var/lib/tale-sandbox/sessions';

  const rawBackend = process.env.SANDBOX_BACKEND ?? 'docker';
  if (rawBackend !== 'docker' && rawBackend !== 'kubernetes') {
    throw new Error(
      `SANDBOX_BACKEND must be 'docker' or 'kubernetes'; got: ${JSON.stringify(rawBackend)}`,
    );
  }
  const backend: 'docker' | 'kubernetes' = rawBackend;
  // SANDBOX_TOKEN is REQUIRED — fail closed. The spawner holds the host docker
  // socket and is reachable from every session container on the shared sandbox
  // network, so it must never boot with HMAC verification off; an unset secret
  // is a hard failure, not a bypass. Trimmed so a whitespace-only value is
  // treated as unset (otherwise it would enable HMAC with a trivially weak
  // space key) — consistent with numEnv/userEnv above and the client side
  // (session_client also trims).
  const sandboxToken = process.env.SANDBOX_TOKEN?.trim() ?? '';
  if (sandboxToken.length === 0) {
    throw new Error(
      'SANDBOX_TOKEN is required: the sandbox spawner refuses to start without the shared HMAC ' +
        'secret (it holds the host docker socket and is reachable from every session container). ' +
        '`tale deploy` and `bun run dev` mint it into .env; for a hand-rolled compose stack set ' +
        'SANDBOX_TOKEN=$(openssl rand -hex 32) in .env (compose.dev.yml carries an insecure dev default).',
    );
  }

  // Cross-backend env combos are accepted (so a single env file can serve
  // both deployment shapes) but warn — a silently-ignored knob reads like a
  // misconfiguration to the operator who set it.
  const K8S_ONLY_ENVS = [
    'SANDBOX_K8S_NAMESPACE',
    'SANDBOX_K8S_WORKSPACE_SIZE_LIMIT',
    'SANDBOX_K8S_EPHEMERAL_STORAGE_REQUEST',
    'SANDBOX_K8S_EPHEMERAL_STORAGE_LIMIT',
    'SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT',
    'SANDBOX_K8S_NODE_SELECTOR',
    'SANDBOX_K8S_TOLERATIONS',
    'SANDBOX_K8S_PRIORITY_CLASS',
    'SANDBOX_K8S_CACHE_STORAGECLASS',
    'SANDBOX_K8S_SERVER',
    'SANDBOX_K8S_TOKEN',
    'SANDBOX_K8S_CAFILE',
  ];
  // (The cache-volume prefixes are NOT docker-only — k8s reuses them as PVC
  // name prefixes.)
  const DOCKER_ONLY_ENVS = [
    'SANDBOX_HOST_SESSION_ROOT',
    'SANDBOX_EGRESS_NETWORK',
  ];
  const inert =
    backend === 'docker'
      ? K8S_ONLY_ENVS
      : backend === 'kubernetes'
        ? DOCKER_ONLY_ENVS
        : [];
  for (const name of inert) {
    const v = process.env[name];
    if (v !== undefined && v.trim() !== '') {
      console.warn(
        `[sandbox.config] ${name} is set but has no effect with SANDBOX_BACKEND=${backend}`,
      );
    }
  }
  // SANDBOX_K8S_WORKSPACE_SIZE_LIMIT does not size the inner Docker store of
  // a session with Docker inside. An operator who set it to keep that store
  // small on small node disks, without the store's own setting, gets the
  // store's larger default and a Pod limit that grows with it, so the boot
  // log names the variable that sizes the store.
  if (
    backend === 'kubernetes' &&
    dockerInContainer &&
    dockerWorkloads?.length !== 0 &&
    (process.env.SANDBOX_K8S_WORKSPACE_SIZE_LIMIT?.trim() ?? '') !== '' &&
    k8sDockerStorageSizeLimit === undefined
  ) {
    console.warn(
      `[sandbox.config] SANDBOX_K8S_WORKSPACE_SIZE_LIMIT no longer sizes the inner Docker store of a ` +
        `session with Docker inside: SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT does (default ` +
        `${DOCKER_STORAGE_SIZE_LIMIT}), and the session Pod's ephemeral-storage limit grows with it. ` +
        `Set SANDBOX_K8S_DOCKER_STORAGE_SIZE_LIMIT to bound the store on small node disks.`,
    );
  }
  // Body cap on every spawner route. /v1/sessions/:id/files/stage takes
  // INLINE base64 content (bound org skills, useSkills subtrees, steer control
  // files), so the cap must fit a real skill-bundle chunk plus JSON envelope;
  // the platform client chunks its stage payloads well under it
  // (session_client.ts STAGE_BODY_BUDGET_BYTES). The same `files` array is
  // forwarded verbatim to runnerd, which caps its bodies at
  // RUNNERD_MAX_REQUEST_BODY_BYTES — so the spawner's cap is CLAMPED to that:
  // a body the spawner accepts can never be refused by the daemon as oversize.
  // Operators can lower it via SANDBOX_MAX_REQUEST_BODY_BYTES; raising it past
  // the daemon's cap is a no-op that warns.
  const requestedMaxRequestBodyBytes = numEnv(
    'SANDBOX_MAX_REQUEST_BODY_BYTES',
    RUNNERD_MAX_REQUEST_BODY_BYTES,
    { min: 4 * 1024 },
  );
  const maxRequestBodyBytes = Math.min(
    requestedMaxRequestBodyBytes,
    RUNNERD_MAX_REQUEST_BODY_BYTES,
  );
  if (maxRequestBodyBytes !== requestedMaxRequestBodyBytes) {
    console.warn(
      `[sandbox.config] SANDBOX_MAX_REQUEST_BODY_BYTES=${requestedMaxRequestBodyBytes} exceeds runnerd's request cap; clamped to ${RUNNERD_MAX_REQUEST_BODY_BYTES}`,
    );
  }

  // Device mode and the hub. A device's spawner is its own instance, so it
  // never adopts the sessions of a Tale deployment on the same Docker daemon.
  const deviceConfigPath = process.env.SANDBOX_DEVICE_CONFIG?.trim() || null;
  const instance =
    process.env.SANDBOX_INSTANCE?.trim() || (deviceConfigPath ? 'device' : '');
  if (!/^[a-z0-9-]{0,32}$/.test(instance)) {
    throw new Error(
      `SANDBOX_INSTANCE must be lowercase letters, digits and dashes (at most 32); got: ${JSON.stringify(instance)}`,
    );
  }
  const hubPort = numEnv('SANDBOX_HUB_PORT', 0, { min: 0, max: 65535 });
  let hub: HubConfig | null = null;
  if (hubPort > 0 && backend !== 'docker') {
    // Placements live on the spawner's disk and a device's tunnel lands on one
    // process: neither holds across Kubernetes replicas.
    console.warn(
      '[sandbox.config] SANDBOX_HUB_PORT is set but connected devices need the Docker backend; the hub stays off',
    );
  } else if (hubPort > 0 && deviceConfigPath !== null) {
    console.warn(
      '[sandbox.config] SANDBOX_HUB_PORT has no effect on a connected device',
    );
  } else if (hubPort > 0) {
    hub = {
      port: hubPort,
      stateDir:
        process.env.SANDBOX_HUB_STATE_DIR?.trim() ||
        join(dirname(sessionRootBase), 'hub'),
      relays: {
        api:
          process.env.SANDBOX_HUB_API_UPSTREAM?.trim() ||
          process.env.SANDBOX_HTTP_API_BASE_URL?.trim() ||
          'http://backend-api:3005',
        gateway:
          process.env.SANDBOX_HUB_GATEWAY_UPSTREAM?.trim() ||
          process.env.EXTERNAL_AGENT_GATEWAY_URL?.trim() ||
          'http://sandbox-llm-gateway:8080',
      },
    };
  }

  return {
    backend,
    ...(dockerDataRoot !== undefined ? { dockerDataRoot } : {}),
    ...(dockerDataPath !== undefined ? { dockerDataPath } : {}),
    instance,
    hub,
    deviceConfigPath,
    k8s: {
      namespace: process.env.SANDBOX_K8S_NAMESPACE ?? 'tale-sandbox',
      // Resolved per tier (runc → null = omit). For tiers that DO carry a class,
      // SANDBOX_RUNTIME_CLASS overrides the default name (clusters that register
      // e.g. 'kata-qemu' instead of 'kata'). It can never conjure a class for
      // runc (null stays null), keeping runc pods runtimeClass-free.
      runtimeClassName:
        k8sRuntimeClassFor(runtimeTier) === null
          ? null
          : (process.env.SANDBOX_RUNTIME_CLASS ??
            k8sRuntimeClassFor(runtimeTier)),
      workspaceSizeLimit: k8sWorkspaceSizeLimit,
      ...(k8sCpuRequest !== undefined ? { cpuRequest: k8sCpuRequest } : {}),
      ...(k8sMemoryRequest !== undefined
        ? { memoryRequest: k8sMemoryRequest }
        : {}),
      ...(k8sEphemeralStorageRequest !== undefined
        ? { ephemeralStorageRequest: k8sEphemeralStorageRequest }
        : {}),
      ...(k8sEphemeralStorageLimit !== undefined
        ? { ephemeralStorageLimit: k8sEphemeralStorageLimit }
        : {}),
      ...(k8sDockerStorageSizeLimit !== undefined
        ? { dockerStorageSizeLimit: k8sDockerStorageSizeLimit }
        : {}),
      ...(k8sNodeSelector !== undefined
        ? { nodeSelector: k8sNodeSelector }
        : {}),
      ...(k8sTolerations !== undefined ? { tolerations: k8sTolerations } : {}),
      ...(k8sPriorityClassName !== undefined
        ? { priorityClassName: k8sPriorityClassName }
        : {}),
    },
    port: numEnv('SANDBOX_PORT', 8003, { min: 1, max: 65535 }),
    // The shared HMAC secret every state-changing route is verified against
    // (request-auth.ts). Always set — validated above.
    sandboxToken,
    runtimeImage:
      process.env.SANDBOX_RUNTIME_IMAGE ?? 'tale-sandbox-runtime:latest',
    runtimeTier,
    dockerInContainer,
    ...(dockerWorkloads !== undefined ? { dockerWorkloads } : {}),
    ...(dindInnerPool ? { dindInnerPool } : {}),
    // Per-org cross-session build cache (defaults to DinD's setting, resolved
    // above). Each organization gets its own builder, mirrors and private net.
    dockerBuildCache,
    // The shared buildkitd image the spawner launches (buildkitd.ts). Defaults
    // to a dev tag; release deployments set SANDBOX_BUILDKITD_IMAGE to the
    // pinned ghcr ref so the daemon matches the deployed version.
    buildkitdImage:
      process.env.SANDBOX_BUILDKITD_IMAGE ?? 'tale-sandbox-buildkitd:latest',
    // The pull-through registry mirror image the spawner launches alongside
    // the buildkitd so base-image pulls resolve by name on the internal net:
    // stock registry 2.8.3, pinned by digest so every host runs the same
    // bytes, and the same default as both compose pipelines. Overridable for
    // a mirrored ref in fenced deploys.
    buildkitdMirrorImage:
      process.env.SANDBOX_BUILDKITD_MIRROR_IMAGE ??
      'registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373',
    ...(buildkitdCpus !== undefined ? { buildkitdCpus } : {}),
    buildkitdProvisionTimeoutMs: numEnv(
      'SANDBOX_BUILDKITD_PROVISION_TIMEOUT_MS',
      5_000,
      { min: 100, max: 60_000 },
    ),
    ...(buildkitdMemoryBytes !== undefined ? { buildkitdMemoryBytes } : {}),
    ...(buildkitdCacheRetentionMs !== undefined
      ? { buildkitdCacheRetentionMs }
      : {}),
    ...(packageCacheRetentionMs !== undefined
      ? { packageCacheRetentionMs }
      : {}),
    ...(buildkitdIdleCacheBytes !== undefined
      ? { buildkitdIdleCacheBytes }
      : {}),
    ...(buildkitdIdleMs !== undefined ? { buildkitdIdleMs } : {}),
    ...(buildkitdMaxCacheBytes !== undefined ? { buildkitdMaxCacheBytes } : {}),
    // Transparent egress for the session's own processes (default on; resolved +
    // gvisor-warned above). Off ⇒ env-proxy-only (today's behavior).
    transparentEgress,
    maxTimeoutMs: numEnv('SANDBOX_MAX_TIMEOUT_MS', 300_000, { min: 1 }),
    // Single flat session root — the sandbox tier no longer has a blue/green
    // colour, so there is no per-colour sub-directory to scope.
    hostSessionRoot: sessionRootBase,
    cacheVolumePrefix: {
      pip:
        process.env.SANDBOX_PIP_CACHE_VOLUME_PREFIX ?? 'tale-sandbox-pip-cache',
      npm:
        process.env.SANDBOX_NPM_CACHE_VOLUME_PREFIX ?? 'tale-sandbox-npm-cache',
      bun:
        process.env.SANDBOX_BUN_CACHE_VOLUME_PREFIX ?? 'tale-sandbox-bun-cache',
    },
    egressNetwork: process.env.SANDBOX_EGRESS_NETWORK ?? 'tale-sandbox-net',
    egressProxy:
      process.env.SANDBOX_EGRESS_PROXY ?? 'http://sandbox-egress:3128',
    stdoutMaxBytes: numEnv('SANDBOX_STDOUT_MAX_BYTES', 5 * 1024 * 1024, {
      min: 1024,
    }),
    stderrMaxBytes: numEnv('SANDBOX_STDERR_MAX_BYTES', 5 * 1024 * 1024, {
      min: 1024,
    }),
    maxRequestBodyBytes,
    session: {
      // Runtime admission ceiling across organizations: Docker host or K8s
      // namespace inventory. Separate from the platform's project/workflow/
      // render allocation budgets (defaults 2/2/2), and not a CPU or memory
      // reservation. Operators size this against the host and session profiles.
      maxSessions: numEnv('SANDBOX_MAX_SESSIONS', 8, { min: 1 }),
      autoMaxSessions: (process.env.SANDBOX_MAX_SESSIONS ?? '').trim() === '',
      ...(minFreeMemoryBytes !== undefined ? { minFreeMemoryBytes } : {}),
      ...(minFreeDiskBytes !== undefined ? { minFreeDiskBytes } : {}),
      ...(criticalFreeDiskBytes !== undefined ? { criticalFreeDiskBytes } : {}),
      maxLifetimeMs: numEnv(
        'SANDBOX_SESSION_MAX_LIFETIME_MS',
        24 * 60 * 60 * 1000,
        { min: 60_000 },
      ),
      maxIdleMs: numEnv('SANDBOX_SESSION_MAX_IDLE_MS', 30 * 60 * 1000, {
        min: 60_000,
      }),
      // A released session (its turn or run settled) costs a slot and its
      // processes' memory while warm, and resumes in well under a second, so
      // it is stopped after a few idle minutes rather than the full window.
      releasedIdleMs: numEnv(
        'SANDBOX_SESSION_RELEASED_IDLE_MS',
        5 * 60 * 1000,
        { min: 60_000 },
      ),
      // How long a drained (lingering) spawner keeps serving its sessions after
      // a deploy before reclaiming their compute itself. 30 min covers a typical
      // long agent turn; the deploy CLI normally tears the spawner down sooner
      // once its sessions end. Min 1 min so it can't thrash.
      maxLingerMs: numEnv('SANDBOX_SESSION_MAX_LINGER_MS', 30 * 60 * 1000, {
        min: 60_000,
      }),
      execDefaultTimeoutMs: numEnv(
        'SANDBOX_SESSION_EXEC_DEFAULT_TIMEOUT_MS',
        10 * 60 * 1000,
        { min: 1_000 },
      ),
      // Per-exec hard ceiling. Raised from 2h to 24h so a long agent task isn't
      // SIGKILLed mid-run by runnerd; a single task is bounded by budget /
      // completion / manual stop, not a wall clock. Env-tunable higher.
      execMaxTimeoutMs: numEnv(
        'SANDBOX_SESSION_EXEC_MAX_TIMEOUT_MS',
        24 * 60 * 60 * 1000,
        { min: 1_000 },
      ),
      createHealthTimeoutMs: numEnv(
        'SANDBOX_SESSION_CREATE_TIMEOUT_MS',
        180_000,
        { min: 5_000 },
      ),
      agentProfile: {
        cpus: numEnv('SANDBOX_AGENT_CPUS', 2, { min: 1 }),
        // CPU weight under contention. `--cpus` alone is a quota: six busy
        // sessions at the default weight compete with the database, backend
        // and spawner as equals, and on a 4-vCPU host that stalled the control
        // plane for hours (pool timeouts, 503s, `docker ps` timing out). 256
        // against the 1024 every other container runs at (cgroup v2 weight
        // about 10 against 100) hands the CPU to the control plane first; an
        // idle host still grants the full quota.
        cpuShares: cpuSharesEnv('SANDBOX_AGENT_CPU_SHARES', 256),
        // Memory is a real resource budget (the session cgroup is shared by the
        // agent and, under DinD, the inner dockerd + every nested build/run).
        // Unlike the pids/fsize *guards* (lifted unconditionally under DinD),
        // this is a deliberate allocation — but 4g is too low to host a real
        // `docker compose up --build`: a heavy frontend bundle (e.g. vite) is
        // OOM-killed mid-build (exit 137). `--memory` is a ceiling, not a
        // reservation (idle sessions don't consume it), so DinD gets a larger
        // default headroom while staying operator-tunable — an explicit
        // SANDBOX_AGENT_MEMORY always wins, and the operator sizes host RAM for
        // the concurrent-session peak.
        memory:
          process.env.SANDBOX_AGENT_MEMORY ?? (dockerInContainer ? '8g' : '4g'),
        memoryWithoutDocker: process.env.SANDBOX_AGENT_MEMORY ?? '4g',
        pidsLimit: numEnv('SANDBOX_AGENT_PIDS', 512, { min: 64 }),
        nofileSoft: numEnv('SANDBOX_AGENT_NOFILE_SOFT', 4096, { min: 256 }),
        nofileHard: numEnv('SANDBOX_AGENT_NOFILE_HARD', 8192, { min: 256 }),
        fsizeBytes: numEnv('SANDBOX_AGENT_FSIZE_BYTES', 512 * 1024 * 1024, {
          min: 1024 * 1024,
        }),
        tmpfsSize: process.env.SANDBOX_AGENT_TMP_SIZE ?? '512m',
        shmSize: process.env.SANDBOX_AGENT_SHM_SIZE ?? '512m',
        // The image's `agent` user (uid 10001). Overridable only for
        // emergency rollback to nobody — Claude Code's bypassPermissions
        // requires non-root either way. Validated to a real uid:gid >= 1 so a
        // malformed override can't silently drop the container onto root.
        ...userEnv('SANDBOX_AGENT_USER', '10001:10001'),
      },
    },
  };
}
