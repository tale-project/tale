// Backend-neutral per-profile capability gates, shared by the Docker argv
// builder (docker-session-args.ts) and the K8s Pod builder
// (k8s-session-pod-spec.ts) so the two launchers cannot drift: a capability
// the operator turns on deployment-wide is still granted per PROFILE, and the
// `default` profile (run_code / crawler page rendering — untrusted content,
// uid 65534) never gets the agent-only ones.

import type { SpawnerConfig } from '../types.ts';
import type { SandboxSessionProfile } from '../wire.ts';

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
  cfg: SpawnerConfig,
  profile: SandboxSessionProfile,
): boolean {
  return cfg.dockerInContainer && profile === 'agent';
}

/**
 * Live browser view (operator flag SANDBOX_BROWSER_VIEW): the session is
 * launched with TALE_BROWSER_CDP=1 so the entrypoint brings up the headed
 * Chromium + x11vnc read-only mirror and runnerd enables its browser-control
 * surface. Agent-only, like DinD: a run_code (`default`) session has no
 * browser tool, so the headed stack would be pure boot latency + attack
 * surface.
 */
export function sessionBrowserViewEnabled(
  cfg: SpawnerConfig,
  profile: SandboxSessionProfile,
): boolean {
  return cfg.browserView && profile === 'agent';
}
