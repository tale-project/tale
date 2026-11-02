import { z } from 'zod';

import { queryParamSchema } from '@/app/lib/query-param';
import {
  idSchema,
  secretKindSchema,
  type SecretKind,
  type SecretSummary,
} from '@/lib/api/schemas';

import {
  matchesScope,
  SCOPE_ALL,
  SCOPE_GLOBAL,
  sessionIdOfScope,
} from './scope';

/**
 * What narrows the list of secrets: one kind or every kind, and who they are
 * for (the values of `scope.ts`: `all`, `global`, or a session's id as text).
 */
export interface SecretsFilters {
  kind: SecretKind | 'all';
  scope: string;
}

export const NO_FILTERS: SecretsFilters = { kind: 'all', scope: SCOPE_ALL };

/**
 * The view as the address of the page holds it:
 * `/secrets?type=note&scope=12&q=shop`. What shows everything is not in the
 * address, so the page as it is keeps a plain `/secrets`, and a session is its
 * number (a number, so the address does not read `scope=%2212%22`).
 */
interface SecretsSearch {
  type?: SecretKind | undefined;
  scope?: typeof SCOPE_GLOBAL | number | undefined;
  /** What is typed in the search box. */
  q?: string | undefined;
}

// Each part is read on its own, and one that makes no sense is dropped: an
// address somebody typed or kept from another version still opens the page.
const searchSchema = z.object({
  type: secretKindSchema.optional().catch(undefined),
  scope: z
    .union([
      z.literal(SCOPE_GLOBAL),
      idSchema,
      z
        .string()
        .regex(/^\d{1,15}$/)
        .transform(Number)
        .pipe(idSchema),
    ])
    .optional()
    .catch(undefined),
  q: queryParamSchema,
});

/**
 * The `validateSearch` of the Secrets route. A part that makes no sense comes
 * back as `undefined`, not left out: the router lays what a route returns over
 * what the address says, so a part left out would keep its raw value.
 */
export function validateSecretsSearch(
  search: Record<string, unknown>,
): SecretsSearch {
  const { type, scope, q } = searchSchema.parse(search);
  return { type, scope, q: q === '' ? undefined : q };
}

export function filtersFromSearch(search: SecretsSearch): SecretsFilters {
  return {
    kind: search.type ?? 'all',
    scope: search.scope === undefined ? SCOPE_ALL : String(search.scope),
  };
}

/** What the search box holds, as the address says it. */
export function queryFromSearch(search: SecretsSearch): string {
  return search.q ?? '';
}

/**
 * The filters as parts of the address. A part that shows everything is
 * `undefined`, not left out: laid over the address as it is, it takes the
 * filter away.
 */
export function searchFromFilters(
  filters: SecretsFilters,
): Pick<SecretsSearch, 'type' | 'scope'> {
  const session = sessionIdOfScope(filters.scope);
  return {
    type: filters.kind === 'all' ? undefined : filters.kind,
    scope:
      filters.scope === SCOPE_GLOBAL ? SCOPE_GLOBAL : (session ?? undefined),
  };
}

/** Whether a secret shows under the filters. */
export function matchesFilters(
  secret: Pick<SecretSummary, 'kind' | 'session'>,
  filters: SecretsFilters,
): boolean {
  return (
    (filters.kind === 'all' || secret.kind === filters.kind) &&
    matchesScope(secret, filters.scope)
  );
}
