import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import * as logger from '../../utils/logger';
import type { ExecResult } from '../docker/exec';

/** The org config store inside every backend container (`TALE_CONFIG_DIR`).
 * The image ships it owned by the account the entrypoint drops to, and the
 * backend-local phases (`deploy provision`, `deploy export-client-native`)
 * keep their private state beneath it (`provision-state.ts`). */
const BACKEND_DATA_DIRECTORY = '/app/data';

/** One docker invocation against the deployment, as the callers wrap it:
 * `docker <args>` with an optional private stdin. */
export type BackendExecute = (
  args: string[],
  stdin?: string,
  allowFailure?: boolean,
) => Promise<ExecResult>;

/**
 * The account a backend-local CLI phase runs as, as `uid:gid`: the owner of
 * the backend's data directory.
 *
 * `docker exec` runs as the image's configured user, and the platform image
 * keeps that at root so its entrypoint can fix volume ownership before it
 * drops to the app user. The backend-local CLI refuses any state directory
 * the current account does not own (`nativeDeploymentStateDirectory`), so as
 * root it never got past `/app/data` — which the entrypoint hands to the app
 * user on every boot. The owner is read from the container rather than
 * assumed, the rule `ensure-config-mountpoints.ts` already follows: the image
 * decides, and a uid written here would rot the moment the image changed.
 */
export async function backendDataOwner(
  execute: BackendExecute,
  container: string,
): Promise<string> {
  const result = await execute([
    'exec',
    container,
    'stat',
    '-c',
    '%u:%g',
    BACKEND_DATA_DIRECTORY,
  ]);
  const owner = result.stdout.trim();
  if (!/^\d{1,10}:\d{1,10}$/.test(owner))
    throw preconditionError(
      'The backend data directory owner could not be read.',
    );
  return owner;
}

const innerSummarySchema = z.object({
  ok: z.literal(false),
  error: z.object({
    summary: z.string().min(1).max(512),
    code: z.number().int().optional(),
  }),
});

/**
 * The host-side message for a backend-local phase that exited non-zero.
 *
 * In `--json` mode the inner CLI answers on stdout with its own summary, the
 * one channel designed to carry no secrets, so that summary is repeated and
 * nothing else is: stderr may hold anything the inner process printed while
 * failing, and it never leaves the host-side error.
 */
export function backendCliFailure(
  base: string,
  result: Pick<ExecResult, 'stdout'>,
): string {
  const output = result.stdout.trim();
  if (!output.startsWith('{') || output.length > 65_536) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    logger.debug(
      `Backend-local CLI output was not a JSON summary: ${error instanceof Error ? error.message : String(error)}`,
    );
    return base;
  }
  const summary = innerSummarySchema.safeParse(parsed);
  if (!summary.success) return base;
  const { summary: detail, code } = summary.data.error;
  const clean = detail.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();
  return `${base} It reported: ${clean}${code === undefined ? '' : ` (exit ${code})`}`;
}
