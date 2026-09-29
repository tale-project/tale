import { failureDetail } from '@/app/lib/backend/adapters';

/**
 * Where one of the skill dialog's reads stands — the skill's document, or
 * one bundle file's bytes. The states stay apart because each tells the
 * member something different:
 *
 * - `loading` — the first answer is on its way. That includes Try again
 *   after a failed first read: react-query puts a query with no data back
 *   to `pending` for every new fetch;
 * - `failed` — no answer came and nothing is on screen. A failed read says
 *   nothing about the skill or the file: it is neither missing nor empty;
 * - `ready` — the door answered. `data` is `null` when the skill or file is
 *   genuinely gone (the adapter's 404), and an empty file is a `ready`
 *   answer too. `refreshFailed` marks a shown answer whose last refresh
 *   failed: it stays on screen, drafts included, and may be out of date.
 *   A query with data keeps its error while it is fetched again, so the
 *   notice, and the Try again on it, stay put through a retry.
 */
export type SkillReadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly error: unknown }
  | {
      readonly status: 'ready';
      readonly data: T;
      readonly refreshFailed: boolean;
    };

/** The slice of a react-query result the state is read from. */
export interface SkillReadQuery<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isError: boolean;
}

export function skillReadState<T>(query: SkillReadQuery<T>): SkillReadState<T> {
  if (query.data === undefined) {
    return query.isError
      ? { status: 'failed', error: query.error }
      : { status: 'loading' };
  }
  return { status: 'ready', data: query.data, refreshFailed: query.isError };
}

/**
 * A failed read's sentence: the surface's own words, then what the failure
 * says about itself (`failureDetail` — a refusal's reason, a lost
 * connection; nothing for a fault).
 */
export function readFailureMessage(title: string, error: unknown): string {
  const detail = failureDetail(error);
  return detail === undefined || detail === '' ? title : `${title} ${detail}`;
}
