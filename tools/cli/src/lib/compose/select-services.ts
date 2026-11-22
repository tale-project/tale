import { type AppTier, THREE_WAY } from './app-tier';
import {
  type RotatableService,
  type StatefulService,
  type StopGatedService,
  ALWAYS_ROLL_SERVICES,
  ROTATABLE_SERVICES,
  STOP_GATED_SERVICES,
} from './types';

interface DefaultServiceSelection {
  /**
   * Blue-green rotated: the application tier, under every name a service of
   * it can have. Which of them a colour runs is its image's to say
   * (app-tier.ts), so the deploy narrows this once the image is on the host.
   */
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
 *  - rotatable (`platform`, and `backend-api` and `backend-worker` where the
 *    colour runs them apart) → always, as one blue-green colour. They are
 *    the stateless application tier: one image and one set of wire
 *    contracts, so they move together.
 *  - always-roll (`sandbox`, `sandbox-egress`) → always, in-place via the
 *    stateful compose. The sandbox tier is a singleton by construction (it
 *    holds docker.sock and the session directory) and is drained via
 *    /v1/drain before its recreate (deploy.ts).
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

  return {
    rotatable: [...ROTATABLE_SERVICES],
    stateful: [...ALWAYS_ROLL_SERVICES, ...stopGatedToUpdate],
    leftRunning,
  };
}

/**
 * The services a `tale deploy --host` run does not reach, because the deploy
 * does not recreate them: they keep the host they were started with. Those
 * that serve a host are the proxy and the colour, whichever services a
 * colour of this shape has (app-tier.ts). A container serves the host it was
 * created with.
 */
export function servicesKeepingHost(
  updating: readonly string[],
  tier: AppTier = THREE_WAY,
): string[] {
  return ['proxy', ...tier.services].filter(
    (service) => !updating.includes(service),
  );
}
