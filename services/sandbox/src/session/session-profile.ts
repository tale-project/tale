// Backend-neutral per-profile capability gates, shared by the Docker argv
// builder (docker-session-args.ts) and the K8s Pod builder
// (k8s-session-pod-spec.ts) so the two launchers cannot drift: a capability
// the operator turns on deployment-wide is still granted per PROFILE, and the
// `default` profile (run_code / crawler page rendering — untrusted content,
// uid 65534) never gets the agent-only ones.

import type { SpawnerConfig } from '../types.ts';
import type { SandboxSessionProfile } from '../wire.ts';

/** Coding-agent identity and persistent workspace, with or without Docker. */
export function isAgentSessionProfile(
  profile: unknown,
): profile is 'agent' | 'agent-light' {
  return profile === 'agent' || profile === 'agent-light';
}

export function sessionAgentProfile(
  cfg: SpawnerConfig,
  profile: SandboxSessionProfile,
): SpawnerConfig['session']['agentProfile'] {
  return profile === 'agent-light' && cfg.session.agentLightMemory
    ? { ...cfg.session.agentProfile, memory: cfg.session.agentLightMemory }
    : cfg.session.agentProfile;
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
