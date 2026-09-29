/**
 * Where one of the board's reads stands, told apart the way the reader must
 * see it (#3747): a failed read is an unknown result — never an empty board,
 * and never the rows of another search.
 *
 * - `loading` — its first answer is on the way (the skeleton).
 * - `ready` — the rows are its answer. `updating`: they are the same board's
 *   rows for the previous search or filter, kept while the new one loads.
 * - `stale` — a refresh failed; the rows are its last answer.
 * - `failed` — it failed with nothing to show. `retrying` holds through the
 *   next attempt, so the failure stays on screen until an answer replaces it.
 */
export type BoardReadState =
  | { kind: 'loading' }
  | { kind: 'ready'; updating: boolean }
  | { kind: 'stale'; retrying: boolean }
  | { kind: 'failed'; retrying: boolean };

/** The react-query result fields the state is read from. */
export interface ReadResultLike {
  status: 'pending' | 'error' | 'success';
  data: unknown;
  isPlaceholderData: boolean;
  isFetching: boolean;
  /** How often this query's reads have failed, kept across a retry. */
  errorUpdateCount: number;
}

export function boardReadState(read: ReadResultLike): BoardReadState {
  const answered = !read.isPlaceholderData && read.data !== undefined;
  if (read.status === 'error') {
    return answered
      ? { kind: 'stale', retrying: read.isFetching }
      : { kind: 'failed', retrying: read.isFetching };
  }
  if (answered) return { kind: 'ready', updating: false };
  // A retry of a read that never answered starts over as pending, error
  // cleared: it is still the failure being retried, not a first load.
  if (read.errorUpdateCount > 0 && read.isFetching) {
    return { kind: 'failed', retrying: true };
  }
  if (read.isPlaceholderData) return { kind: 'ready', updating: true };
  return { kind: 'loading' };
}

/** The read failed and its latest answer is missing or out of date. */
export function readFailed(state: BoardReadState): boolean {
  return state.kind === 'failed' || state.kind === 'stale';
}

/** A retry of the failed read is under way. */
export function readRetrying(state: BoardReadState): boolean {
  return (state.kind === 'failed' || state.kind === 'stale') && state.retrying;
}
