/**
 * Search contacts by name, email, or external ID (business logic)
 *
 * Uses Convex search index for efficient full-text name search.
 * Email and externalId searches use index-based queries for efficiency.
 */

import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export async function searchContacts(
  ctx: QueryCtx,
  organizationId: string,
  searchTerm: string,
  limit?: number,
): Promise<Array<Doc<'contacts'>>> {
  const resultLimit = limit || 50;
  const searchLower = searchTerm.toLowerCase();

  // Strategy: Use search index for name, then supplement with email index lookup
  // This is more efficient than iterating through all contacts

  // Helper to collect email matches (needs async iteration)
  const collectEmailMatches = async (): Promise<Array<Doc<'contacts'>>> => {
    const matches: Array<Doc<'contacts'>> = [];
    const emailQuery = ctx.db
      .query('contacts')
      .withIndex('by_organizationId_and_email', (q) =>
        q.eq('organizationId', organizationId),
      );

    for await (const contact of emailQuery) {
      if (contact.email?.toLowerCase().includes(searchLower)) {
        matches.push(contact);
        if (matches.length >= resultLimit) break;
      }
    }
    return matches;
  };

  const searchAsNumber = Number(searchTerm);

  // TODO(search-index-disabled): search_contacts .searchIndex was dropped
  // to unblock deploy past SearchIndexBootstrapWorker crash loop. Re-enable
  // once the bootstrap is fixed; until then fall back to a scoped scan.
  const collectNameMatches = async (): Promise<Array<Doc<'contacts'>>> => {
    const matches: Array<Doc<'contacts'>> = [];
    const nameQuery = ctx.db
      .query('contacts')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', organizationId),
      );
    for await (const contact of nameQuery) {
      if (contact.name?.toLowerCase().includes(searchLower)) {
        matches.push(contact);
        if (matches.length >= resultLimit) break;
      }
    }
    return matches;
  };

  // Run all independent searches in parallel
  const [nameResults, emailMatches, externalIdExact, externalIdNumeric] =
    await Promise.all([
      // 1. Search by name via scoped scan (search index disabled, see above)
      collectNameMatches(),

      // 2. Search by email using the email index
      collectEmailMatches(),

      // 3. Search by externalId (exact string match)
      ctx.db
        .query('contacts')
        .withIndex('by_organizationId_and_externalId', (q) =>
          q.eq('organizationId', organizationId).eq('externalId', searchTerm),
        )
        .first(),

      // 4. Search by externalId (numeric match if applicable)
      !isNaN(searchAsNumber)
        ? ctx.db
            .query('contacts')
            .withIndex('by_organizationId_and_externalId', (q) =>
              q
                .eq('organizationId', organizationId)
                .eq('externalId', searchAsNumber),
            )
            .first()
        : Promise.resolve(null),
    ]);

  // Merge results, deduplicating by _id
  const seen = new Set<string>();
  const merged: Array<Doc<'contacts'>> = [];

  // Add name search results first (most relevant for search)
  for (const contact of nameResults) {
    if (!seen.has(contact._id)) {
      seen.add(contact._id);
      merged.push(contact);
    }
  }

  // Add email matches
  for (const contact of emailMatches) {
    if (!seen.has(contact._id)) {
      seen.add(contact._id);
      merged.push(contact);
    }
  }

  // Add externalId matches
  if (externalIdExact && !seen.has(externalIdExact._id)) {
    seen.add(externalIdExact._id);
    merged.push(externalIdExact);
  }
  if (externalIdNumeric && !seen.has(externalIdNumeric._id)) {
    seen.add(externalIdNumeric._id);
    merged.push(externalIdNumeric);
  }

  // Sort by relevance (exact matches first, then partial matches)
  merged.sort((a, b) => {
    const aExact = a.name === searchTerm || a.email === searchTerm;
    const bExact = b.name === searchTerm || b.email === searchTerm;

    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    return b._creationTime - a._creationTime;
  });

  return merged.slice(0, resultLimit);
}
