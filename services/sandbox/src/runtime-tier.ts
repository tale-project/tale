// Container runtime tiers — the single source of truth for how a deployment's
// chosen OCI runtime maps to the docker `--runtime` value, the k8s
// `runtimeClassName`, and whether (and how) docker-in-container is delivered.
//
// The runtime is a DEPLOYMENT-LEVEL, uniform choice (same for every tenant in a
// deployment); there is no per-org/per-session override by design. `runc` is the
// default. Docker-in-container is opt-in (SANDBOX_DOCKER_IN_CONTAINER) and is NOT
// policy-blocked on any tier — per the "one codebase, operator configures the
// host to their needs" model, every tier may enable it; the trade-offs are loud
// boot warnings, not hard refusals. Each tier delivers it differently (see
// DindCapability): `sysbox` (userns) and `kata` (VM) keep an isolation boundary;
// `runc` runs a PRIVILEGED inner daemon with NO boundary (in-container root IS
// host root — trusted-only); `gvisor` is contained by runsc but its netstack
// makes nested docker functionally unreliable (dindExperimental).

export type RuntimeTier = 'runc' | 'gvisor' | 'sysbox' | 'kata';

// nosemgrep: tools.opengrep.rules.trailofbits.generic.container-privileged.container-privileged -- intentional: descriptive prose documenting the trusted-only `runc` runtime tier; no container invocation here
// How a tier delivers docker-in-container:
//   'privileged' — real inner dockerd via --privileged; NO boundary, host-root
//                  (runc): functional but trusted-only / single-tenant
//   'native'     — real inner dockerd, unprivileged; the runtime is the boundary
//                  (sysbox userns; gvisor runsc — but gvisor is flaky for DinD)
//   'vm'         — inner dockerd inside a guest VM, VM-contained (kata)
//   'none'       — reserved (no tier currently uses it)
type DindCapability = 'none' | 'privileged' | 'native' | 'vm';

interface TierResolution {
  /** docker `--runtime=` value. */
  dockerRuntime: string;
  /** Default pod `runtimeClassName` (null = omit the field entirely). */
  k8sRuntimeClass: string | null;
  /** Whether/how docker-in-container is available on this tier. */
  dind: DindCapability;
}

const TIERS: Record<RuntimeTier, TierResolution> = {
  runc: { dockerRuntime: 'runc', k8sRuntimeClass: null, dind: 'privileged' },
  // gvisor is itself the boundary (runsc syscall interception), so DinD runs
  // unprivileged ('native'); the catch is functional, not security — see
  // dindExperimental.
  gvisor: { dockerRuntime: 'runsc', k8sRuntimeClass: 'gvisor', dind: 'native' },
  sysbox: {
    dockerRuntime: 'sysbox-runc',
    k8sRuntimeClass: 'sysbox-runc',
    dind: 'native',
  },
  kata: { dockerRuntime: 'kata', k8sRuntimeClass: 'kata', dind: 'vm' },
};

export const RUNTIME_TIERS: readonly RuntimeTier[] = [
  'runc',
  'gvisor',
  'sysbox',
  'kata',
];

export function isRuntimeTier(value: string): value is RuntimeTier {
  return value in TIERS;
}

/** docker `--runtime=` value for a tier. */
export function dockerRuntimeFor(tier: RuntimeTier): string {
  return TIERS[tier].dockerRuntime;
}

/** Default pod `runtimeClassName` for a tier (null = omit). */
export function k8sRuntimeClassFor(tier: RuntimeTier): string | null {
  return TIERS[tier].k8sRuntimeClass;
}

export function dindCapabilityOf(tier: RuntimeTier): DindCapability {
  return TIERS[tier].dind;
}

/** True when this tier's DinD keeps NO isolation boundary (runc → privileged,
 * in-container root = host root). Trusted-only; callers warn loudly. */
export function dindIsPrivileged(tier: RuntimeTier): boolean {
  return TIERS[tier].dind === 'privileged';
}

/**
 * True when DinD on this tier is functionally unreliable (gvisor): gVisor's
 * user-space netstack + partial iptables generally break nested-container
 * networking (inner bridge/DNS/port-publish + the in-pod egress fence). It's
 * NOT a security weakness (runsc still contains it) — it just likely won't
 * work. Allowed per the operator-decides model; loadConfig warns loudly.
 */
export function dindExperimental(tier: RuntimeTier): boolean {
  return tier === 'gvisor';
}

/**
 * Tier-aware DEFAULT for SANDBOX_DOCKER_IN_CONTAINER when the operator hasn't
 * set it explicitly: on for the tiers where DinD is both safe AND reliable
 * (`sysbox` userns, `kata` VM), off for the rest. The point is "docker just
 * works once you've set up a boundary-keeping runtime" — while `runc` (the only
 * zero-config option, and privileged host-root) and `gvisor` (functionally
 * flaky) stay opt-in so neither is silently enabled on, say, a multi-tenant
 * deployment. An explicit env / deployment.json value always overrides this.
 */
export function dindDefaultEnabled(tier: RuntimeTier): boolean {
  return tier === 'sysbox' || tier === 'kata';
}

/**
 * True when transparent egress (an iptables OUTPUT REDIRECT → redsocks for the
 * session's own TCP) works reliably on this tier. False only on gvisor: runsc's
 * user-space netstack + partial iptables make REDIRECT functionally unreliable
 * (same limitation as dindExperimental). On an unsupported tier the session
 * falls back to the HTTPS_PROXY env (proxy-aware clients only); loadConfig warns.
 */
export function transparentEgressSupported(tier: RuntimeTier): boolean {
  return tier !== 'gvisor';
}

// No fail-closed policy gate for DinD: per the "one codebase, operator
// configures the host to their needs" model, every tier may enable it. The
// trade-offs (runc = host-root, gvisor = likely-broken) are surfaced as loud
// boot warnings (see loadConfig), not hard blocks.
