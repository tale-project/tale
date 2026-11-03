import { ApiError } from '@/app/lib/api/client';

/** How a write ended: with its result, or with the error that refused it. */
export type Settled<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/**
 * Waits for a write without throwing, for a flow that goes on depending on how
 * it ended. A write made through `useApiMutation` has told the person about its
 * failure already, except for the refusals its caller words itself (`quietFor`):
 * the flow looks at those with `isRefusal` and leaves the rest alone.
 */
export async function settle<T>(write: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await write };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Whether `error` is the backend refusing with one of `codes`. */
export function isRefusal(
  error: unknown,
  ...codes: readonly string[]
): error is ApiError {
  return error instanceof ApiError && codes.includes(error.code);
}
