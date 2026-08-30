/**
 * Create a new website record in the database.
 * Does NOT register with the crawler — that's handled by the calling action.
 */

import { AppError } from '../../lib/shared/errors/app-error';
import type { MutationCtx } from '../lib/ctx';
import type { Id } from '../lib/rows';

export interface CreateWebsiteArgs {
  organizationId: string;
  domain: string; // Accepts full URL (preferred) or bare domain
  kind?: 'site' | 'list';
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
    // Structured code so the client surfaces the duplicate toast in prod, where
    // Convex redacts raw `Error` messages to "Server Error".
    throw new AppError({
      code: 'WEBSITE_DUPLICATE_DOMAIN',
      domain: websiteDomain,
    });
  }

  return await ctx.db.insert('websites', {
    ...args,
    domain: websiteDomain,
  });
}
