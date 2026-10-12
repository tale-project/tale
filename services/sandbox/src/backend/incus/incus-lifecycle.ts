// Reading an instance's lifecycle: where it can be reached, whether it ended,
// whether a start is long overdue. Pure functions, shared by the session
// backend and the host backend's orphan sweep.

import { isIpv4Address } from '../../network-address.ts';
import {
  INCUS_STATUS,
  type IncusInstance,
  type IncusInstanceState,
} from './incus-api.ts';
import { label, LABEL, stampOf } from './incus-naming.ts';

/** Past a create's whole budget, how long its instance may still sit
 * unstarted before it counts as abandoned. */
export const STARTUP_SLACK_MS = 60_000;

/** The NIC the profile gives a session. */
const SESSION_NIC = 'eth0';

/**
 * The IPv4 address the instance holds on its session NIC, once DHCP gave it
 * one; undefined while it has none (or is not running). Sessions are
 * IPv4-only, so an IPv6 address never counts.
 */
export function instanceAddress(
  state: IncusInstanceState | undefined,
): string | undefined {
  if (state === undefined) return undefined;
  const names = Object.keys(state.network).filter((name) => name !== 'lo');
  names.sort((a, b) => Number(b === SESSION_NIC) - Number(a === SESSION_NIC));
  for (const name of names) {
    for (const entry of state.network[name] ?? []) {
      if (
        entry.family === 'inet' &&
        entry.scope === 'global' &&
        isIpv4Address(entry.address)
      ) {
        return entry.address;
      }
    }
  }
  return undefined;
}

export function isRunning(instance: IncusInstance): boolean {
  return instance.statusCode === INCUS_STATUS.running;
}

/** Nothing runs or will run in it: stopped or in error. A session instance
 * that has ended is debris the spawner removes (it is not ephemeral, so that
 * its console log survives a start that failed). */
export function hasEnded(instance: IncusInstance): boolean {
  return (
    instance.statusCode === INCUS_STATUS.stopped ||
    instance.statusCode === INCUS_STATUS.error
  );
}

/** Has it ever started? Incus keeps the time of the last start, and the epoch
 * for an instance that has none: what an instance is between its creation and
 * its start. A server that does not say reads as started, so that nothing is
 * held back on a guess. */
export function hasStarted(instance: IncusInstance): boolean {
  if (instance.lastUsedAt === '') return true;
  const at = Date.parse(instance.lastUsedAt);
  return !Number.isFinite(at) || at > Date.UTC(2000, 0, 1);
}

/** Running, or on its way to it: a start another create is still making. */
export function isStartingOrRunning(instance: IncusInstance): boolean {
  return (
    instance.statusCode === INCUS_STATUS.running ||
    instance.statusCode === INCUS_STATUS.starting
  );
}

/**
 * Has the create that made this instance long given up? Its creator wrote
 * the deadline it works to into the instance (a peer with a shorter timeout
 * never reaps a healthy start), and Incus's own creation time keeps an
 * instance created just now safe whatever stamp it carries.
 */
export function startupExpired(
  instance: IncusInstance,
  nowMs: number,
  createTimeoutMs: number,
): boolean {
  const stamp = stampOf(instance.config) ?? 0;
  const createdAt = Date.parse(instance.createdAt);
  if (!Number.isFinite(createdAt)) return false;
  const declared = Number(label(instance.config, LABEL.startupDeadline));
  const born = Math.max(createdAt, stamp);
  const deadline =
    Number.isSafeInteger(declared) && declared >= born
      ? declared
      : born + createTimeoutMs;
  return nowMs > deadline + STARTUP_SLACK_MS;
}
