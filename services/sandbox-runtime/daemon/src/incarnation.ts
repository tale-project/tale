// The session incarnation this daemon serves: the creation stamp the spawner
// records on the backend object (Docker's `tale.created` label) and passes in
// at launch. Answers name it, so the spawner proves which incarnation answered
// without asking its backend; an activity request meant for another one is
// refused before it changes anything.

import { RUNNERD_INCARNATION_ENV } from './protocol.ts';

/** A creation stamp is a millisecond epoch, written as a decimal integer. */
const STAMP_RE = /^[0-9]{1,16}$/;

/** The stamp from the launch environment, or undefined when there is none. A
 * malformed value proves nothing about the incarnation, so it is never named. */
export function readIncarnation(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (STAMP_RE.test(raw)) return raw;
  console.warn(
    `[runnerd] ${RUNNERD_INCARNATION_ENV} is not a creation stamp; answers name no incarnation`,
  );
  return undefined;
}

/** Does a request name an incarnation other than the one served? A request
 * naming none, or a daemon launched without a stamp, cannot tell. */
export function namesOtherIncarnation(
  served: string | undefined,
  named: string | string[] | undefined,
): boolean {
  const value = Array.isArray(named) ? named[0] : named;
  return (
    served !== undefined &&
    value !== undefined &&
    value !== '' &&
    value !== served
  );
}
