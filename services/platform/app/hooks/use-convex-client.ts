import type { ConvexReactClient } from 'convex/react';
import { useConvex } from 'convex/react';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';
import { getFunctionName } from 'convex/server';
import { useMemo } from 'react';

import {
  ACTION_QUERY_ADAPTERS,
  activeOrganizationId,
  READ_ADAPTERS,
  runAdapted,
  WRITE_ADAPTERS,
} from '@/app/lib/backend/convex-adapters';

/**
 * The imperative escape hatch for one-shot calls outside the hook wrappers
 * (`client.query(...)` behind a button, an upload's URL resolve, a poll).
 * ADAPTER-AWARE: a family migrated to the 0.5 backend serves the call over
 * HTTP exactly like the hook lanes do; everything else passes through to the
 * Convex client untouched. Without this seam, every `useConvexClient()`
 * call site silently kept the dead-WS lane after its family migrated.
 */
interface AdapterAwareClient {
  query<Query extends FunctionReference<'query'>>(
    query: Query,
    args: FunctionArgs<Query>,
  ): Promise<FunctionReturnType<Query>>;
  action<Action extends FunctionReference<'action'>>(
    action: Action,
    args: FunctionArgs<Action>,
  ): Promise<FunctionReturnType<Action>>;
  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
  ): Promise<FunctionReturnType<Mutation>>;
}

type ImperativeConvex = Pick<
  ConvexReactClient,
  'query' | 'action' | 'mutation'
>;

/** Pure client wrapper — exported for tests; the hook memoizes it. */
export function makeAdapterAwareClient(
  convex: ImperativeConvex,
): AdapterAwareClient {
  return {
    query: (query, args) => {
      const read = READ_ADAPTERS[getFunctionName(query)];
      if (read !== undefined) {
        const orgId = activeOrganizationId();
        const adapted = read(
          args ?? {},
          orgId !== undefined ? { organizationId: orgId } : {},
        );
        if (adapted !== null) return runAdapted(adapted.queryFn);
      }
      return convex.query(query, args);
    },
    action: (action, args) => {
      const name = getFunctionName(action);
      const write = WRITE_ADAPTERS[name];
      const orgId = activeOrganizationId();
      const ctx = orgId !== undefined ? { organizationId: orgId } : {};
      if (write !== undefined) {
        return runAdapted(() => write.run(args ?? {}, ctx));
      }
      const actionQuery = ACTION_QUERY_ADAPTERS[name];
      if (actionQuery !== undefined) {
        const adapted = actionQuery(args ?? {}, ctx);
        if (adapted !== null) return runAdapted(adapted);
      }
      return convex.action(action, args);
    },
    mutation: (mutation, args) => {
      const write = WRITE_ADAPTERS[getFunctionName(mutation)];
      if (write !== undefined) {
        const orgId = activeOrganizationId();
        return runAdapted(() =>
          write.run(
            args ?? {},
            orgId !== undefined ? { organizationId: orgId } : {},
          ),
        );
      }
      return convex.mutation(mutation, args);
    },
  };
}

export function useConvexClient(): AdapterAwareClient {
  const convex = useConvex();
  return useMemo(() => makeAdapterAwareClient(convex), [convex]);
}
