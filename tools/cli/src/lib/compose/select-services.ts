import {
  type RotatableService,
  type StatefulService,
  type StopGatedService,
  ALWAYS_ROLL_SERVICES,
  BACKEND_TIER_SERVICES,
  ROTATABLE_SERVICES,
  STOP_GATED_SERVICES,
} from './types';

interface DefaultServiceSelection {
  /** Blue-green rotated (platform). */
  rotatable: RotatableService[];
  /** Deployed via the stateful compose: always-roll tier + any stop-gated to update. */
  stateful: StatefulService[];
  /** Running stop-gated services deliberately left untouched (operator must pass --stop). */
  leftRunning: StopGatedService[];
}

/**
 * Decide which services a default `tale deploy` (no explicit `--services`)
 * touches, per the three-tier policy:
 *
 *  - rotatable (`platform`) → always, blue-green.
 *  - always-roll (`convex`, `sandbox-llm-gateway`, `sandbox`, `sandbox-egress`,
 *    and — on a stack that has cut over to Postgres — `backend-api` /
 *    `backend-worker`) → always, in-place via the stateful compose. The
 *    sandbox tier is a single container (blue-green dropped) and is drained
 *    via /v1/drain before its recreate (deploy.ts), like convex and the pg
 *    backend. The backend tier is filtered out entirely when the deployment
 *    has not cut over (`backendEnabled: false`), so a 0.4 stack never starts
 *    a Postgres backend it does not use.
 *  - stop-gated (`db`, `proxy`) → only when already stopped, on a first deploy,
 *    or when the operator opts into the downtime with `--stop`; otherwise left
 *    running and surfaced in `leftRunning` so the caller can warn.
 *
 * Pure (the running-state probe is injected) so it's unit-testable without Docker.
 */
export function selectDefaultServices(opts: {
  isFirstDeploy: boolean;
  stop: boolean;
  isStopGatedRunning: (service: StopGatedService) => boolean;
  /** Has this deployment cut over to the Postgres backend? */
  backendEnabled: boolean;
}): DefaultServiceSelection {
  const stopGatedToUpdate: StopGatedService[] = [];
  const leftRunning: StopGatedService[] = [];

  for (const service of STOP_GATED_SERVICES) {
    if (opts.isFirstDeploy || opts.stop || !opts.isStopGatedRunning(service)) {
      stopGatedToUpdate.push(service);
    } else {
      leftRunning.push(service);
    }
  }

  const alwaysRoll = opts.backendEnabled
    ? [...ALWAYS_ROLL_SERVICES]
    : ALWAYS_ROLL_SERVICES.filter(
        (service) =>
          !(BACKEND_TIER_SERVICES as readonly string[]).includes(service),
      );

  return {
    rotatable: [...ROTATABLE_SERVICES],
    stateful: [...alwaysRoll, ...stopGatedToUpdate],
    leftRunning,
  };
}
