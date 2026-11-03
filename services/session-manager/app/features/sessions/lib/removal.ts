import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError } from '@/app/lib/api/client';
import { queryKeys } from '@/app/lib/api/keys';
import {
  secretSummarySchema,
  sessionSchema,
  type SecretSummary,
  type Session,
} from '@/lib/api/schemas';
import { isRecord } from '@/lib/is-record';

/** Names the deletion of a session in the mutation cache, so that what reads the session can tell. */
export const REMOVE_SESSION_KEY = ['sessions', 'remove'] as const;

/** How the deletion of a session stands: none asked, under way, or done. */
export type Removal = 'none' | 'pending' | 'done';

function removedId(variables: unknown): number | null {
  return isRecord(variables) && typeof variables.id === 'number'
    ? variables.id
    : null;
}

/**
 * Whether the session is being deleted, or was. Read from the mutation cache,
 * so that any reader of the session (its page, the list, a dialog) knows at
 * the moment it asks, whoever started the deletion and whenever React renders.
 * The ids of sessions are never used again, so a deletion that worked stays
 * true of its id for as long as the cache keeps it.
 */
export function removalOf(queryClient: QueryClient, id: number): Removal {
  let removal: Removal = 'none';
  for (const mutation of queryClient
    .getMutationCache()
    .findAll({ mutationKey: REMOVE_SESSION_KEY })) {
    if (removedId(mutation.state.variables) !== id) continue;
    if (mutation.state.status === 'pending') return 'pending';
    if (mutation.state.status === 'success') removal = 'done';
  }
  return removal;
}

/** What a read of a session that does not exist says: the backend's own answer. */
export function sessionGone(): ApiError {
  return new ApiError(404, 'session_not_found', 'This session does not exist.');
}

/**
 * Reads one session. Nothing is asked of a session that is going away or has
 * gone: asking is a request the backend can only refuse with a 404, which the
 * browser logs as an error though nothing went wrong. While the deletion is
 * under way the page keeps what it read before; once it is done the session is
 * gone, which is what a read of it would have said.
 */
export async function readSession(
  queryClient: QueryClient,
  id: number,
  ask: () => Promise<Session>,
): Promise<Session> {
  const removal = removalOf(queryClient, id);
  if (removal === 'none') return ask();
  const known = sessionSchema.safeParse(
    queryClient.getQueryData(queryKeys.session(id)),
  );
  if (removal === 'pending' && known.success) return known.data;
  throw sessionGone();
}

const secretsSchema = z.array(secretSummarySchema);

/**
 * Reads the secrets that belong to one session (the count a delete dialog
 * shows). The same as `readSession`: the secrets go with the session, and
 * asking for those of a session that is going away can only be refused, so the
 * count read before stands.
 */
export async function readSecretsOfSession(
  queryClient: QueryClient,
  id: number,
  ask: () => Promise<SecretSummary[]>,
): Promise<SecretSummary[]> {
  if (removalOf(queryClient, id) === 'none') return ask();
  const known = secretsSchema.safeParse(
    queryClient.getQueryData(queryKeys.secretList({ scope: String(id) })),
  );
  return known.success ? known.data : [];
}
