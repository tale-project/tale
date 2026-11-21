import { preconditionError } from '../../utils/fail';
import {
  getReplicaCounts,
  type ReplicaCounts,
  type ReplicatedRole,
} from '../../utils/load-env';
import * as logger from '../../utils/logger';
import type { RotatableService } from './types';

/**
 * The shape of a colour's application tier: which services it runs, and
 * what each of them is.
 *
 * The platform image serves three things: the web tier (the built app), the
 * API, and the job queues. They used to be three services of every colour,
 * three processes of about 50, 90 and 70 MiB at rest. An image that serves
 * the web tier from its backend process runs them as ONE, which is what a
 * deployment gets unless it asks for the job runners apart:
 *
 * - `unified`    `platform` alone, in the `all` role: the app on 3000, the
 *                API on 3005 and the jobs, in one process per replica.
 * - `split`      `platform` in the `api` role (the API and the app) and
 *                `backend-worker` for the jobs, each scaled on its own. Asked
 *                for by setting a backend replica count.
 * - `three-way`  `platform` (the web tier alone), `backend-api` and
 *                `backend-worker`: the only shape an image from before the
 *                web tier moved can run, and the one the Incus compiler and
 *                the managed runtime still build. It is also the only shape
 *                a CLI from before the shapes can deploy over: its writer
 *                census looks for the two backend services by name. A
 *                workspace that is to go back to such a CLI asks for it
 *                first (`TALE_APP_TIER`).
 *
 * `platform` and `backend-api` stay the two names the edge and the sandbox
 * address. In the first two shapes `platform` answers both.
 */
export type AppTierShape = 'unified' | 'split' | 'three-way';

/** What a container of the platform image starts as (`TALE_ROLE`). */
export type AppRole = 'web' | 'api' | 'worker' | 'all';

export interface AppTier {
  readonly shape: AppTierShape;
  /** The services a colour of this shape runs. */
  readonly services: readonly RotatableService[];
  /** The role each of them starts in. */
  readonly roles: Readonly<Partial<Record<RotatableService, AppRole>>>;
}

export const UNIFIED: AppTier = {
  shape: 'unified',
  services: ['platform'],
  roles: { platform: 'all' },
};

export const SPLIT: AppTier = {
  shape: 'split',
  services: ['platform', 'backend-worker'],
  roles: { platform: 'api', 'backend-worker': 'worker' },
};

export const THREE_WAY: AppTier = {
  shape: 'three-way',
  services: ['platform', 'backend-api', 'backend-worker'],
  roles: { platform: 'web', 'backend-api': 'api', 'backend-worker': 'worker' },
};

/** The service whose replicas answer the API in a colour of this shape. */
export function apiService(tier: AppTier): RotatableService {
  return tier.shape === 'three-way' ? 'backend-api' : 'platform';
}

/**
 * The image label that says its `api` and `all` roles serve the web tier
 * too, beside the API (services/platform/Dockerfile). An image without it
 * serves the web tier only from a container of its own.
 */
export const APP_IN_BACKEND_LABEL = 'io.tale.app-in-backend';

/** Missing metadata is an old image, never evidence of the new shape. */
export function imageServesAppInBackend(
  labels: Record<string, string> | null | undefined,
): boolean {
  return labels?.[APP_IN_BACKEND_LABEL] === '1';
}

/** The variables that, once set, ask for the job runners apart. */
const BACKEND_REPLICA_VARIABLES = [
  'TALE_BACKEND_API_REPLICAS',
  'TALE_BACKEND_WORKER_REPLICAS',
] as const;

type Read = (name: string) => string | undefined;
const fromProcess: Read = (name) => process.env[name];

/** The backend replica counts that are set, to any value. */
function backendReplicaVariablesSet(read: Read): string[] {
  return BACKEND_REPLICA_VARIABLES.filter(
    (name) => (read(name) ?? '').trim() !== '',
  );
}

/** The variable that names the shape outright. */
const APP_TIER_VARIABLE = 'TALE_APP_TIER';

/** The words `TALE_APP_TIER` takes, and the shape each asks for. */
const ASKED_SHAPES: ReadonlyMap<string, AppTier> = new Map([
  ['one-process', UNIFIED],
  ['workers-apart', SPLIT],
  ['three-services', THREE_WAY],
]);

/**
 * The shape the deployment asked for by name, or null where it named none.
 * A word that is no shape is refused: which services run is not something to
 * guess from a typo. Read before anything is pulled, so the refusal comes
 * where the command asks.
 */
export function askedAppTier(read: Read = fromProcess): AppTier | null {
  const asked = (read(APP_TIER_VARIABLE) ?? '').trim();
  if (asked === '') return null;
  const tier = ASKED_SHAPES.get(asked);
  if (tier === undefined)
    throw preconditionError(
      `${APP_TIER_VARIABLE} must be ${[...ASKED_SHAPES.keys()].join(', ')}, or unset; got: ${JSON.stringify(asked)}`,
    );
  return tier;
}

/**
 * The shape a new colour of an image gets. `appInBackend` is what the image
 * says of itself ({@link imageServesAppInBackend}); the rest is the
 * deployment's own wish, read from the environment `loadEnv` folded the
 * project's `.env` into: the shape it names (`TALE_APP_TIER`), or one
 * process unless a backend replica count is set, which asks for the job
 * runners apart. An image that cannot serve the app from its backend runs as
 * three services whatever is asked.
 */
export function appTierFor(
  image: { appInBackend: boolean },
  read: Read = fromProcess,
): AppTier {
  const asked = askedAppTier(read);
  if (!image.appInBackend) return THREE_WAY;
  return (
    asked ?? (backendReplicaVariablesSet(read).length > 0 ? SPLIT : UNIFIED)
  );
}

/**
 * The replica counts that are set for a service a colour of this shape does
 * not run: a backend count beside `TALE_APP_TIER=one-process`, where the one
 * process is the API and the job runner. A deploy names them once, so a
 * count that scales nothing is not mistaken for one that does.
 */
export function unusedReplicaVariables(
  tier: AppTier,
  read: Read = fromProcess,
): string[] {
  return tier.shape === 'unified' ? backendReplicaVariablesSet(read) : [];
}

/**
 * The shape of a colour that is already up, from the role its `platform`
 * runs: each shape starts `platform` in a role of its own, so the role names
 * the shape where a list of services cannot (a colour that lost its worker
 * still has a `platform` that runs no jobs). An unset role is the image's
 * own default, the web tier, which is how a colour of three services has
 * always started it. Null for a word that is no role of `platform`.
 */
export function appTierOfPlatformRole(
  role: string | undefined,
): AppTier | null {
  const named = role ?? 'web';
  return (
    [THREE_WAY, SPLIT, UNIFIED].find((tier) => tier.roles.platform === named) ??
    null
  );
}

/**
 * How many replicas each service of a colour of this shape runs. A service
 * the shape does not have counts 0.
 *
 * `TALE_PLATFORM_REPLICAS` counts `platform` in every shape. Where
 * `platform` also answers the API (`split`), it takes the larger of that and
 * `TALE_BACKEND_API_REPLICAS`, so neither the pages nor the API lose a
 * replica the deployment asked for.
 *
 * A count the shape has no use for is not read at all, so a value out of
 * range there is not clamped aloud for a service that does not run
 * (`unusedReplicaVariables` names it instead).
 */
export function tierReplicaCounts(
  tier: AppTier,
  read: Read = fromProcess,
  warn: (message: string) => void = logger.warn,
): ReplicaCounts {
  const unused = new Set(unusedReplicaVariables(tier, read));
  const asked = getReplicaCounts(
    (name) => (unused.has(name) ? undefined : read(name)),
    warn,
  );
  const counts: Record<ReplicatedRole, number> = {
    platform: 0,
    'backend-api': 0,
    'backend-worker': 0,
  };
  for (const service of tier.services) counts[service] = asked[service];
  if (tier.shape === 'split')
    counts.platform = Math.max(asked.platform, asked['backend-api']);
  return counts;
}

/** `platform×1, backend-worker×2`: a colour's replicas, for a log line. */
export function describeReplicas(tier: AppTier, replicas: ReplicaCounts) {
  return tier.services
    .map((service) => `${service}×${replicas[service]}`)
    .join(', ');
}
