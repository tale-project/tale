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
import { docker } from './docker';
import { exec } from './exec';
import { isContainerRunning } from './is-container-running';

/** The api container's in-container port (compose sets PORT=3005). */
export const BACKEND_CONTROL_PORT = '3005';

export function backendApiContainer(): string {
  return `${getProjectId()}-backend-api`;
}

/** Is the backend api container up? Every control call degrades on `false`
 *  rather than failing the command that wraps it. */
export async function isBackendTierRunning(): Promise<boolean> {
  return isContainerRunning(backendApiContainer());
}

export interface ControlCallResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
}

/**
 * One control-door call. `body`, when given, is sent as a JSON request body
 * over stdin (never argv). `timeoutS` wraps curl in `timeout(1)` so a wedged
 * door cannot hang a deploy — the caller distinguishes that case by
 * `exitCode === 124`.
 */
export async function controlCall(
  method: 'GET' | 'POST',
  path: string,
  options: { container?: string; body?: unknown; timeoutS?: number } = {},
): Promise<ControlCallResult> {
  const container = options.container ?? backendApiContainer();
  const auth = '-H "Authorization: Bearer $TALE_CONTROL_TOKEN"';
  const url = `http://localhost:${BACKEND_CONTROL_PORT}${path}`;
  const prefix =
    options.timeoutS === undefined ? '' : `timeout ${options.timeoutS} `;

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
