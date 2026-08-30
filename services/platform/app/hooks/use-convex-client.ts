import { useMemo } from 'react';

import type {
  ActionName,
  ArgsOf,
  BackendName,
  MutationName,
  QueryName,
  ReturnsOf,
} from '@/app/lib/backend/contract';
import {
  ACTION_QUERY_ADAPTERS,
  activeOrganizationId,
  READ_ADAPTERS,
  runAdapted,
  WRITE_ADAPTERS,
} from '@/app/lib/backend/convex-adapters';
import { ConvexRetiredError } from '@/app/lib/backend/retired-convex';

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

/** Pure client — exported for tests; the hook memoizes it. */
export function makeAdapterAwareClient(): BackendClient {
  return {
    query: <Name extends QueryName>(name: Name, args: ArgsOf<Name>) => {
      const read = READ_ADAPTERS[name];
      if (read !== undefined) {
        const adapted = read(args ?? {}, adapterCtx());
        if (adapted !== null) {
          return runAdapted(adapted.queryFn) as Promise<ReturnsOf<Name>>;
        }
      }
      return Promise.reject(new ConvexRetiredError(name));
    },
    action: <Name extends BackendName>(name: Name, args: ArgsOf<Name>) => {
      const ctx = adapterCtx();
      const write = WRITE_ADAPTERS[name];
      if (write !== undefined) {
        return runAdapted(() =>
          write.run((args ?? {}) as Record<string, unknown>, ctx),
        ) as Promise<ReturnsOf<Name>>;
      }
      const actionQuery = ACTION_QUERY_ADAPTERS[name];
      if (actionQuery !== undefined) {
        const adapted = actionQuery(args ?? {}, ctx);
        if (adapted !== null) {
          return runAdapted(adapted) as Promise<ReturnsOf<Name>>;
        }
      }
      return Promise.reject(new ConvexRetiredError(name));
    },
    mutation: <Name extends MutationName>(name: Name, args: ArgsOf<Name>) => {
      const write = WRITE_ADAPTERS[name];
      if (write !== undefined) {
        return runAdapted(() =>
          write.run((args ?? {}) as Record<string, unknown>, adapterCtx()),
        ) as Promise<ReturnsOf<Name>>;
      }
      return Promise.reject(new ConvexRetiredError(name));
    },
  };
}

export function useConvexClient(): BackendClient {
  return useMemo(() => makeAdapterAwareClient(), []);
}

export type { ActionName, BackendClient };
