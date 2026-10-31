// Backend-neutral per-profile capability gates, shared by the Docker argv
// builder (docker-session-args.ts), the K8s Pod builder
// (k8s-session-pod-spec.ts) and the Incus instance builder
// (backend/incus/incus-session-spec.ts) so the launchers cannot drift: a capability
// the operator turns on deployment-wide is still granted per PROFILE, and the
// `default` profile (run_code / crawler page rendering — untrusted content,
// uid 65534) never gets the agent-only ones.

import { transparentEgressSupported } from '../runtime-tier.ts';
import type { SessionAgentProfileConfig, SpawnerConfig } from '../types.ts';
import type { SandboxSessionProfile } from '../wire.ts';

/** Resource caps + user for the `default` profile (the one-shot limits;
 * uid 65534). Kept here so every backend's launcher builds both profiles from
 * the same caps.
 *
 * The pids cap is the exception to "one-shot limits": the platform's website
 * crawler renders pages in a `default` session, and a headless Chromium
 * beside node and the session daemon runs 160 tasks and more on an ordinary
 * content page. Under the one-shot cap of 128 the browser could not start
 * another renderer after two or three such pages: every later navigation of
 * the batch died `net::ERR_ABORTED` and the site's pages were recorded as
 * render failures. 512 — the agent profile's default — leaves the browser
 * room and is still a fork-bomb guard.
 *
 * Its CPU weight is half an agent's: a page render or a run_code call is
 * background work that yields first, to agents and to the control plane. */
export const DEFAULT_SESSION_PROFILE: SessionAgentProfileConfig = {
  cpus: 1,
  cpuShares: 128,
  memory: '1500m',
  pidsLimit: 512,
  nofileSoft: 1024,
  nofileHard: 4096,
  fsizeBytes: 104857600,
  tmpfsSize: '128m',
  shmSize: '64m',
  user: '65534:65534',
  uid: 65534,
  gid: 65534,
};

/** What a session reaches directly instead of through the egress proxy: the
 * loopback, the LLM gateway and the backend origin (the connector bridge and
 * the staging callback). The Docker and Incus launchers set it as NO_PROXY. */
export const SESSION_NO_PROXY =
  '127.0.0.1,localhost,sandbox-llm-gateway,backend-api,backend-relay';

/**
 * Does a session resolve the egress proxy's address once at boot and keep
 * it? Transparent egress relays the session's public connections and its DNS
 * to that address, and Docker-in-sandbox relays its nested containers' and
 * hands the inner engine the address as their DNS server. A session that does
 * neither reaches the proxy only by name through its proxy environment, and
 * so follows the proxy wherever it moves.
 */
export function sessionPinsEgressAddress(
  cfg: Pick<SpawnerConfig, 'transparentEgress' | 'runtimeTier'>,
  dind: boolean,
): boolean {
  return (
    dind ||
    (cfg.transparentEgress && transparentEgressSupported(cfg.runtimeTier))
  );
}

/** Coding-agent identity and persistent workspace, with or without Docker. */
export function isAgentSessionProfile(
  profile: unknown,
): profile is 'agent' | 'agent-light' {
  return profile === 'agent' || profile === 'agent-light';
}

/**
 * DinD is an AGENT-profile capability, never a `default`-profile one. The
 * `default` profile is the hardened run_code posture (untrusted user code,
 * uid 65534): giving it the DinD boot would (a) hand untrusted code a
 * `--privileged` container / Pod on the runc tier, and (b) crash the session —
 * the entrypoint's DinD branch setpriv-drops to the agent uid (10001)
 * unconditionally, which cannot write the 65534-owned workspace, so the
 * skeleton mkdir dies and runnerd never comes up. Gating here (not in the
 * callers) keeps both builders and the Docker backend's volume/buildkitd
 * setup in lockstep.
 */
export function sessionDindEnabled(
  cfg: Pick<SpawnerConfig, 'dockerInContainer' | 'dockerWorkloads'>,
  profile: SandboxSessionProfile,
  requested?: boolean,
): boolean {
  return cfg.dockerInContainer && profile === 'agent' && requested !== false;
}

/**
 * Whether a session mounts the organization's shared dependency caches (pip,
 * npm, bun): an agent session without Docker inside. Never under DinD, where
 * a cross-session shared volume's ownership is unsafe (sysbox userns
 * shifting). And never the `default` profile, which runs UNTRUSTED code: a
 * cache that code can write and an agent session later reads would carry
 * whatever it wrote into a more privileged session — pip serves the bytes of a
 * cached URL without checking them, and npm's index is as writable as its
 * content. Cold caches are the safe default there; installs still work, just
 * uncached across sessions. The argv builder, the volume setup and the cache
 * retention all ask this one question.
 */
export function sessionSharesPackageCaches(
  profile: SandboxSessionProfile,
  dind: boolean,
): boolean {
  return !dind && profile !== 'default';
}

/** Resolve once at creation and record it on the backend object. A caller
 * can narrow the deployment's capability, never enable a disabled one.
 * Untagged callers keep the legacy default only while all workloads are
 * enabled, so an older caller cannot bypass an operator's restriction. */
export function sessionDockerCapability(
  cfg: Pick<SpawnerConfig, 'dockerInContainer' | 'dockerWorkloads'>,
  profile: SandboxSessionProfile,
  workload?: 'project' | 'workflow',
  requested?: boolean,
): boolean {
  const allowed = cfg.dockerWorkloads;
  const workloadAllowed =
    allowed === undefined ||
    (workload === undefined
      ? allowed.includes('project') && allowed.includes('workflow')
      : allowed.includes(workload));
  return workloadAllowed && sessionDindEnabled(cfg, profile, requested);
}

/** The derived memory ceiling follows the session's actual Docker capability.
 * CPU, ownership and other agent limits remain the configured profile's. */
export function sessionAgentProfile(
  cfg: Pick<SpawnerConfig, 'session'>,
  docker: boolean,
): SessionAgentProfileConfig {
  const profile = cfg.session.agentProfile;
  return !docker && profile.memoryWithoutDocker !== undefined
    ? { ...profile, memory: profile.memoryWithoutDocker }
    : profile;
}
