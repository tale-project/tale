import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/**
 * Who this backend process is — the identity a run's lease names, so a lease
 * can be released by the process that holds it and counted per deployment
 * colour while a colour drains.
 *
 * The identity stays in the backend: it names hosts and process ids, and
 * nothing a client reads ever carries it.
 */

/**
 * This replica's deployment colour, or `null` when it runs outside a colour
 * (dev, the pre-blue-green stateful tier, a bare `docker compose up`). An
 * uncoloured replica obeys every drain, coloured or not: it is the only api
 * there is, so "drain the blue one" can only have meant it.
 */
export function replicaColour(): string | null {
  const colour = process.env.TALE_COLOR?.trim();
  return colour !== undefined && colour !== '' ? colour : null;
}

/** The release this process runs — the image's `TALE_VERSION`, `dev` when
 * unset (a source checkout). */
export function engineVersion(): string {
  return process.env.TALE_VERSION?.trim() || 'dev';
}

/** One segment of the identity: never empty, never a `:`, so the colour is
 * always the text after the last `:`. */
function segment(value: string): string {
  const scrubbed = value.trim().replaceAll(':', '-');
  return scrubbed === '' ? 'unknown' : scrubbed;
}

let memoizedInstanceId: string | null = null;

/**
 * `host:pid:nonce:version:colour` of this process, computed once. The host is
 * the container id under Docker and the pid tells two processes of one
 * container apart. Neither is unique on its own: containers on the host's
 * network, or given one fixed `hostname:`, all report the host's name, and
 * each container numbers its own processes from 1. The random nonce keeps
 * two such processes apart, so one that stops never releases the leases of
 * another. The colour comes last so SQL reads it with
 * `substring(lease_owner from '[^:]*$')`.
 */
export function instanceId(): string {
  memoizedInstanceId ??= [
    segment(hostname()),
    segment(String(process.pid)),
    randomUUID().slice(0, 8),
    segment(engineVersion()),
    segment(replicaColour() ?? 'none'),
  ].join(':');
  return memoizedInstanceId;
}

/** Forget the memoized identity, so a test can change the environment it is
 * built from. */
export function resetInstanceIdForTests(): void {
  memoizedInstanceId = null;
}
