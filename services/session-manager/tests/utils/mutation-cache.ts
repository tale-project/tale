import type { QueryClient } from '@tanstack/react-query';

/**
 * Everything the mutation cache holds of the writes made so far, as one text:
 * what each was called with and what it answered. A test that says a value
 * must not linger in memory looks for it here.
 */
export function heldByWrites(queryClient: QueryClient): string {
  return JSON.stringify(
    queryClient
      .getMutationCache()
      .getAll()
      .map(({ state }) => ({ variables: state.variables, data: state.data })),
  );
}

/** How many writes the mutation cache holds (finished ones included). */
export function countWrites(queryClient: QueryClient): number {
  return queryClient.getMutationCache().getAll().length;
}
