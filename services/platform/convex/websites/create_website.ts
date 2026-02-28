/**
 * Create a new website record in the database.
 * Does NOT register with the crawler — that's handled by the calling action.
 */

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export interface CreateWebsiteArgs {
  organizationId: string;
  domain: string; // Accepts full URL (preferred) or bare domain
  title?: string;
  description?: string;
  scanInterval: string; // e.g., '60m' | '6h' | '12h' | '1d' | '5d' | '7d' | '30d'
  status?: 'idle' | 'scanning' | 'active' | 'error' | 'deleting';
}

export function ensureUrl(s: string) {
  return s.startsWith('http://') || s.startsWith('https://')
    ? s
    : `https://${s}`;
}

export function toWebsiteDomain(input: string): string {
  return new URL(ensureUrl(input)).hostname;
}

export async function createWebsite(
  ctx: MutationCtx,
  args: CreateWebsiteArgs,
): Promise<Id<'websites'>> {
  const websiteDomain = toWebsiteDomain(args.domain);

  // Prevent duplicates by organization + normalized domain
  const existingWebsite = await ctx.db
    .query('websites')
    .withIndex('by_organizationId_and_domain', (q) =>
      q.eq('organizationId', args.organizationId).eq('domain', websiteDomain),
    )
    .first();

  if (existingWebsite) {
    throw new Error(`Website with domain ${websiteDomain} already exists`);
  }

  return await ctx.db.insert('websites', {
    ...args,
    domain: websiteDomain,
  });
}
