/**
 * Query contacts with flexible filtering and pagination support (business logic)
 *
 * Uses cursor-based pagination optimized for infinite scroll / load more patterns.
 * Selects the most specific index based on provided filters, then applies
 * remaining filters in memory via paginateWithFilter.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  paginateWithFilter,
  type CursorPaginatedResult,
} from '../lib/pagination';
import type { ContactSource } from './types';

export interface QueryContactsArgs {
  organizationId: string;
  externalId?: string | number;
  source?: ContactSource | ContactSource[];
  locale?: string[];
  searchTerm?: string;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

function buildQuery(ctx: QueryCtx, args: QueryContactsArgs) {
  const { organizationId } = args;

  return {
    query: ctx.db
      .query('contacts')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      )
      .order('desc'),
    indexedFields: {} as const,
  };
}

export async function queryContacts(
  ctx: QueryCtx,
  args: QueryContactsArgs,
): Promise<CursorPaginatedResult<Doc<'contacts'>>> {
  const { query, indexedFields } = buildQuery(ctx, args);

  // Pre-compute filter sets for O(1) lookups (only for non-indexed fields)
  const sourceSet =
    !('source' in indexedFields) && args.source
      ? new Set(Array.isArray(args.source) ? args.source : [args.source])
      : null;
  const localeSet =
    !('locale' in indexedFields) && args.locale && args.locale.length > 0
      ? new Set(args.locale)
      : null;
  const needsExternalIdFilter =
    !('externalId' in indexedFields) && args.externalId !== undefined;
  const searchLower = args.searchTerm?.toLowerCase();

  const needsFilter =
    sourceSet || localeSet || needsExternalIdFilter || searchLower;

  const filter = needsFilter
    ? (contact: Doc<'contacts'>): boolean => {
        if (needsExternalIdFilter && contact.externalId !== args.externalId) {
          return false;
        }

        if (sourceSet && sourceSet.size > 0) {
          if (!contact.source || !sourceSet.has(contact.source)) {
            return false;
          }
        }

        if (localeSet) {
          if (!contact.locale || !localeSet.has(contact.locale)) {
            return false;
          }
        }

        if (searchLower) {
          const nameMatch = contact.name?.toLowerCase().includes(searchLower);
          const emailMatch = contact.email?.toLowerCase().includes(searchLower);
          const externalIdMatch = contact.externalId
            ? String(contact.externalId).toLowerCase().includes(searchLower)
            : false;
          if (!nameMatch && !emailMatch && !externalIdMatch) {
            return false;
          }
        }

        return true;
      }
    : undefined;

  return paginateWithFilter(query, {
    numItems: args.paginationOpts.numItems,
    cursor: args.paginationOpts.cursor,
    filter,
  });
}
