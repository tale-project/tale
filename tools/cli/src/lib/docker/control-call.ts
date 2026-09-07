/**
 * THE machine channel between the CLI and a running deployment:
 * `docker exec <backend-api> curl localhost:$PORT/api/control/...`.
 *
 * Deliberately NOT the proxy — a control call often runs precisely while the
 * proxy is pointing at a container that is going away (deploy drain), and the
 * door must answer from the container that is actually being acted on.
 *
 * The door is bearer-authenticated by `TALE_CONTROL_TOKEN`, which the
 * container already carries in its own environment: `sh -c` expands it INSIDE
 * the container, so the deployment's control token never crosses the CLI's
 * process boundary, its argv, or its logs. Request bodies ride stdin for the
 * same reason (a password in argv would land in the container's process
 * list).
 *
 * Replaces the pre-0.5 `convex-run.ts` channel, which piped an admin key and
 * a `bunx convex run` incantation into the platform container.
 */

import { getProjectId } from '../../utils/load-env';
import type { DeploymentColor } from '../compose/types';
import { getOppositeColor } from '../state/get-opposite-color';
import { docker } from './docker';
import { exec } from './exec';
import { listRunningServiceContainers } from './list-service-containers';

/** The api container's in-container port (compose sets PORT=3005). */
const BACKEND_CONTROL_PORT = '3005';

/** The compose service the api role runs as, in every project shape. */
const BACKEND_API_SERVICE = 'backend-api';

/**
 * Compose projects an api replica can live in, most-specific first:
 * each colour's own project, then the stateful project the tier lived in
 * before it joined the colours. Listing all three is what lets one CLI drive
 * a deployment mid-upgrade, where the running api is still the stateful
 * singleton but the colour projects already exist.
 */
function backendProjects(colour?: DeploymentColor | null): string[] {
  const id = getProjectId();
  if (colour) return [`${id}-${colour}`, id];
  return [`${id}-blue`, `${id}-green`, id];
}

/**
 * Projects to search for a replica that can WRITE `draining_colour`.
 *
 * `beginDrain` must run on an image that knows the column. On the first
 * deploy across this change the retiring colour has no api (it was
 * platform-only) and the leftover singleton is the pre-0085 image — posting
 * `{ colour }` there leaves the column NULL and the newly promoted colour
 * refuses chats. The colour that is NOT being retired just came up on the
 * new image, so it is the writer. Fall back to the retiring colour, then
 * the leftover singleton, only if nothing newer is up.
 */
function drainWriterProjects(retiring: DeploymentColor): string[] {
  const id = getProjectId();
  return [`${id}-${getOppositeColor(retiring)}`, `${id}-${retiring}`, id];
}

/**
 * Every RUNNING api replica, in replica order. Scoped to one colour when
 * given — a drain aims at the colour it is retiring, not at the one that
 * just took over.
 */
export async function backendApiContainers(
  colour?: DeploymentColor | null,
): Promise<string[]> {
  const found: string[] = [];
  for (const project of backendProjects(colour)) {
    found.push(
      ...(await listRunningServiceContainers(project, BACKEND_API_SERVICE)),
    );
  }
  return found;
}

/**
 * One running api replica to address a control call to, or `null` when the
 * tier is down. Any replica will do: every control door acts on shared
 * state (a database row, the config volume), not on the container it
 * happens to reach.
 */
export async function backendApiContainer(
  colour?: DeploymentColor | null,
): Promise<string | null> {
  return (await backendApiContainers(colour))[0] ?? null;
}

/**
 * Replica that should receive `POST /drain` when the drain is aimed at
 * `retiring`. Prefers a new-image colour replica over the leftover
 * singleton — see {@link drainWriterProjects}.
 */
export async function backendApiDrainWriter(
  retiring: DeploymentColor,
): Promise<string | null> {
  for (const project of drainWriterProjects(retiring)) {
    const found = await listRunningServiceContainers(
      project,
      BACKEND_API_SERVICE,
    );
    const first = found[0];
    if (first !== undefined) return first;
  }
  return null;
}

/** Running api replicas in ONE colour's project — not the leftover singleton. */
export async function backendApiContainersInColor(
  colour: DeploymentColor,
): Promise<string[]> {
  return listRunningServiceContainers(
    `${getProjectId()}-${colour}`,
    BACKEND_API_SERVICE,
  );
}

/** How to NAME the api tier in a message when no replica is up to name.
 *  The containers are compose-numbered, so there is no single name to
 *  print — the service is the honest handle. */
export const BACKEND_API_LABEL = 'backend-api';

/** Is any backend api replica up? Every control call degrades on `false`
 *  rather than failing the command that wraps it. */
export async function isBackendTierRunning(): Promise<boolean> {
  return (await backendApiContainers()).length > 0;
}

export interface ControlCallResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/**
 * Default budget for a control-door call. The doors answer in milliseconds;
 * a container that accepts TCP but never answers (a half-alive api tier —
 * exactly what a deploy often fixes) must not hang the caller while it holds
 * the deploy lock. Callers with genuinely long calls (reseed) pass their own.
 */
export const DEFAULT_CONTROL_TIMEOUT_S = 15;

/**
 * One control-door call. `body`, when given, is sent as a JSON request body
 * over stdin (never argv). `timeoutS` (default `DEFAULT_CONTROL_TIMEOUT_S`)
 * wraps curl in `timeout(1)` so a wedged door cannot hang a deploy — the
 * caller distinguishes that case by `exitCode === 124`.
 */
export async function controlCall(
  method: 'GET' | 'POST',
  path: string,
  options: { container?: string; body?: unknown; timeoutS?: number } = {},
): Promise<ControlCallResult> {
  const container = options.container ?? (await backendApiContainer());
  if (container === null) {
    return {
      success: false,
      stdout: '',
      stderr: 'no running backend-api container to address the control door',
    };
  }
  const auth = '-H "Authorization: Bearer $TALE_CONTROL_TOKEN"';
  const url = `http://localhost:${BACKEND_CONTROL_PORT}${path}`;
  const prefix = `timeout ${options.timeoutS ?? DEFAULT_CONTROL_TIMEOUT_S} `;

  if (options.body === undefined) {
    return docker(
      'exec',
      container,
      'sh',
      '-c',
      `${prefix}curl -fsS -X ${method} ${auth} ${url}`,
    );
  }

  // `--data-binary @-` reads the body from the curl process's stdin, which is
  // the `docker exec -i` stream: the payload never appears in argv.
  return exec(
    'docker',
    [
      'exec',
      '-i',
      container,
      'sh',
      '-c',
      `${prefix}curl -fsS -X ${method} ${auth} -H "Content-Type: application/json" --data-binary @- ${url}`,
    ],
    { stdin: JSON.stringify(options.body) },
  );
}
