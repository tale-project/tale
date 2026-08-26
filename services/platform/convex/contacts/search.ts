/**
 * Contact search for the global ⌘K palette — name, email, and external id.
 */

import type { PaginationResult } from 'convex/server';
import { ConvexError, v } from 'convex/values';

import type { Doc, Id } from '../_generated/dataModel';
import { query, type QueryCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { contactsSearchStrategy, runEntitySearch } from '../lib/search';

const MAX_RESULTS = 25;
const PAGE_SIZE = 50;

function snippetForContact(contact: Doc<'contacts'>): string {
  const parts: string[] = [];
  if (contact.email?.trim()) parts.push(contact.email.trim());
  if (contact.externalId !== undefined && contact.externalId !== '') {
    parts.push(String(contact.externalId));
  }
  return parts.join(' · ');
}

async function collectContactHits(
  ctx: QueryCtx,
  args: { organizationId: string; query: string },
): Promise<
  Array<{
    contactId: Id<'contacts'>;
    name: string;
    snippet: string;
    updatedAt: number;
  }>
> {
  const hits: Array<{
    contactId: Id<'contacts'>;
    name: string;
    snippet: string;
    updatedAt: number;
  }> = [];
  let cursor: string | null = null;

  while (hits.length < MAX_RESULTS) {
    const page: PaginationResult<Doc<'contacts'>> = await runEntitySearch(
      ctx,
      contactsSearchStrategy,
      {
        organizationId: args.organizationId,
        term: args.query,
        paginationOpts: { numItems: PAGE_SIZE, cursor },
      },
    );

    for (const row of page.page) {
      hits.push({
        contactId: row._id,
        name: row.name?.trim() || row.email?.trim() || 'Contact',
        snippet: snippetForContact(row),
        updatedAt: row._creationTime,
      });
      if (hits.length >= MAX_RESULTS) break;
    }

    if (page.isDone) break;
    cursor = page.continueCursor;
    if (page.page.length === 0 && !page.isDone) continue;
  }

  return hits;
}

export const searchContacts = query({
  args: {
    organizationId: v.string(),
    query: v.string(),
  },
  returns: v.array(
    v.object({
      contactId: v.id('contacts'),
      name: v.string(),
      snippet: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const trimmed = args.query.trim();
    if (trimmed.length === 0) return [];

    return collectContactHits(ctx, {
      organizationId: args.organizationId,
      query: trimmed,
    });
  },
});
