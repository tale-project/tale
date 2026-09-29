/**
 * How a backend read stands, for a screen that shows what it read: a failed
 * read is the screen's to name and retry, never a silent empty list or a
 * missing section (#3736, #3777).
 *
 * react-query resets a read that never answered to `pending` the moment a
 * retry starts, so `isError` alone would drop the failure notice — and
 * whatever the screen shows only while the read is unavailable — for the
 * length of the retry, then bring it back if the retry fails too. These
 * flags hold still until the read settles.
 */
export interface ReadState {
  /** The read has never answered and its last attempt failed; a retry may
   * be running. Nothing it would have listed is known. */
  unavailable: boolean;
  /** The read answered before, but its latest refresh failed: what is shown
   * is the last answer, possibly out of date. */
  stale: boolean;
  /** A request is running again while the failure stands. */
  retrying: boolean;
  /** How many times the read has settled in error. A notice keyed on it
   * appears afresh — and is announced again — for each new failure. */
  failureCount: number;
}

/** The part of a react-query result `readStateOf` reads. */
export interface ReadQueryState {
  data: unknown;
  isError: boolean;
  isFetching: boolean;
  errorUpdateCount: number;
}

export function readStateOf(query: ReadQueryState): ReadState {
  const answered = query.data !== undefined;
  // `errorUpdateCount` counts settled failures (after the retry policy gave
  // up) and survives the reset a retry makes, unlike `isError`.
  const unavailable = !answered && query.errorUpdateCount > 0;
  const stale = answered && query.isError;
  return {
    unavailable,
    stale,
    retrying: (unavailable || stale) && query.isFetching,
    failureCount: query.errorUpdateCount,
  };
}
