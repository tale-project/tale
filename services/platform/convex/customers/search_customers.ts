/**
 * Search customers by name, email, or external ID (business logic)
 *
 * Uses Convex search index for efficient full-text name search.
 * Email and externalId searches use index-based queries for efficiency.
 */

import type { QueryCtx } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';

export async function searchCustomers(
  ctx: QueryCtx,
  organizationId: string,
  searchTerm: string,
  limit?: number,
): Promise<Array<Doc<'customers'>>> {
  const resultLimit = limit || 50;
  const searchLower = searchTerm.toLowerCase();

  // Strategy: Use search index for name, then supplement with email index lookup
  // This is more efficient than iterating through all customers

  // Helper to collect email matches (needs async iteration)
  const collectEmailMatches = async (): Promise<Array<Doc<'customers'>>> => {
    const matches: Array<Doc<'customers'>> = [];
    const emailQuery = ctx.db
      .query('customers')
      .withIndex('by_organizationId_and_email', (q) =>
        q.eq('organizationId', organizationId),
      );

    for await (const customer of emailQuery) {
      if (customer.email?.toLowerCase().includes(searchLower)) {
        matches.push(customer);
        if (matches.length >= resultLimit) break;
      }
    }
    return matches;
  };

  const searchAsNumber = Number(searchTerm);

  // Run all independent searches in parallel
  const [nameResults, emailMatches, externalIdExact, externalIdNumeric] =
    await Promise.all([
      // 1. Search by name using full-text search index
      ctx.db
        .query('customers')
        .withSearchIndex('search_customers', (q) =>
          q.search('name', searchTerm).eq('organizationId', organizationId),
        )
        .take(resultLimit),

      // 2. Search by email using the email index
      collectEmailMatches(),

      // 3. Search by externalId (exact string match)
      ctx.db
        .query('customers')
        .withIndex('by_organizationId_and_externalId', (q) =>
          q.eq('organizationId', organizationId).eq('externalId', searchTerm),
        )
        .first(),

      // 4. Search by externalId (numeric match if applicable)
      !isNaN(searchAsNumber)
        ? ctx.db
            .query('customers')
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
  const merged: Array<Doc<'customers'>> = [];

  // Add name search results first (most relevant for search)
  for (const customer of nameResults) {
    if (!seen.has(customer._id)) {
      seen.add(customer._id);
      merged.push(customer);
    }
  }

  // Add email matches
  for (const customer of emailMatches) {
    if (!seen.has(customer._id)) {
      seen.add(customer._id);
      merged.push(customer);
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
