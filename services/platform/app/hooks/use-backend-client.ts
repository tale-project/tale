import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  ACTION_QUERY_ADAPTERS,
  activeOrganizationId,
  READ_ADAPTERS,
  runAdapted,
  WRITE_ADAPTERS,
  type WriteAdapter,
} from '@/app/lib/backend/adapters';
import type {
  ActionName,
  ArgsOf,
  BackendName,
  MutationName,
  QueryName,
  ReturnsOf,
} from '@/app/lib/backend/contract';
import { MissingBackendRowError } from '@/app/lib/backend/missing-row';

/**
 * The imperative escape hatch for one-shot calls outside the hook wrappers
 * (`client.query(...)` behind a button, an upload's URL resolve, a poll).
 * Same adapter registry the hooks consult, addressed by the same contract
 * names — so a call site here and its hook twin cannot diverge.
 */
interface BackendClient {
  query<Name extends QueryName>(
    name: Name,
    args: ArgsOf<Name>,
  ): Promise<ReturnsOf<Name>>;
  action<Name extends BackendName>(
    name: Name,
    args: ArgsOf<Name>,
  ): Promise<ReturnsOf<Name>>;
  mutation<Name extends MutationName>(
    name: Name,
    args: ArgsOf<Name>,
  ): Promise<ReturnsOf<Name>>;
}

/** The org scope every adapter row resolves against (the URL's `$id`). */
function adapterCtx(): { organizationId?: string } {
  const orgId = activeOrganizationId();
  return orgId !== undefined ? { organizationId: orgId } : {};
}

/* oxlint-disable typescript/no-unsafe-type-assertion -- the adapter registry
   is the untyped boundary: a row and the contract entry it serves are keyed by
   the SAME name, so the row's projection IS that name's return shape. The
   assertions below are where that fact is stated once. */

/**
 * Run a write row, then fire the same `invalidate` the hook wrappers run on
 * success. The imperative client is the hook twin — skipping invalidation
 * here left listings stale after Convex reactivity went away (upload
 * succeeded, the automations table stayed on its cached empty page).
 */
async function runWrite(
  write: WriteAdapter,
  args: Record<string, unknown>,
  queryClient: QueryClient | undefined,
): Promise<unknown> {
  const ctx = adapterCtx();
  const result = await runAdapted(() => write.run(args, ctx));
  if (queryClient !== undefined && write.invalidate !== undefined) {
    write.invalidate(queryClient, args, ctx);
  }
  return result;
}

/** Pure client — exported for tests; the hook memoizes it. */
export function makeAdapterAwareClient(
  queryClient?: QueryClient,
): BackendClient {
  return {
    query: <Name extends QueryName>(name: Name, args: ArgsOf<Name>) => {
      const read = READ_ADAPTERS[name];
      if (read !== undefined) {
        const adapted = read(args ?? {}, adapterCtx());
        if (adapted !== null) {
          return runAdapted(adapted.queryFn) as Promise<ReturnsOf<Name>>;
        }
      }
      return Promise.reject(new MissingBackendRowError(name));
    },
    action: <Name extends BackendName>(name: Name, args: ArgsOf<Name>) => {
      const write = WRITE_ADAPTERS[name];
      if (write !== undefined) {
        return runWrite(write, { ...args }, queryClient) as Promise<
          ReturnsOf<Name>
        >;
      }
      const actionQuery = ACTION_QUERY_ADAPTERS[name];
      if (actionQuery !== undefined) {
        const adapted = actionQuery(args ?? {}, adapterCtx());
        if (adapted !== null) {
          return runAdapted(adapted) as Promise<ReturnsOf<Name>>;
        }
      }
      return Promise.reject(new MissingBackendRowError(name));
    },
    mutation: <Name extends MutationName>(name: Name, args: ArgsOf<Name>) => {
      const write = WRITE_ADAPTERS[name];
      if (write !== undefined) {
        return runWrite(write, { ...args }, queryClient) as Promise<
          ReturnsOf<Name>
        >;
      }
      return Promise.reject(new MissingBackendRowError(name));
    },
  };
}

export function useBackendClient(): BackendClient {
  const queryClient = useQueryClient();
  return useMemo(() => makeAdapterAwareClient(queryClient), [queryClient]);
}

export type { ActionName, BackendClient };
