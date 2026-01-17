/**
 * Create a new website and auto-attach a scheduled Website Scan workflow
 */

import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';

export interface CreateWebsiteArgs {
  organizationId: string;
  domain: string; // Accepts full URL (preferred) or bare domain
  title?: string;
  description?: string;
  scanInterval: string; // e.g., '60m' | '6h' | '12h' | '1d' | '5d' | '7d' | '30d'
  status?: 'active' | 'inactive' | 'error';
  metadata?: unknown;
}

function toUrlAndDomain(input: string): {
  websiteUrl: string;
  websiteDomain: string;
} {
  const ensureUrl = (s: string) =>
    s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`;
  try {
    const u = new URL(ensureUrl(input));
    const url = `${u.protocol}//${u.host}${u.pathname || ''}`;
    return { websiteUrl: url, websiteDomain: u.hostname };
  } catch {
    // Fallback: treat as bare domain
    const u = new URL(ensureUrl(input));
    return { websiteUrl: u.toString(), websiteDomain: u.hostname };
  }
}

function _scanIntervalToCron(interval: string): {
  schedule: string;
  timezone: string;
} {
  // Default timezone to UTC; can be made configurable later
  const timezone = 'UTC';
  switch (interval) {
    case '60m':
      return { schedule: '0 * * * *', timezone };
    case '6h':
      return { schedule: '0 */6 * * *', timezone };
    case '12h':
      return { schedule: '0 */12 * * *', timezone };
    case '1d':
      return { schedule: '0 2 * * *', timezone }; // Daily at 02:00 UTC
    case '5d':
      return { schedule: '0 2 */5 * *', timezone }; // Every 5 days at 02:00 UTC
    case '7d':
      return { schedule: '0 2 */7 * *', timezone }; // Every 7 days at 02:00 UTC
    case '30d':
      return { schedule: '0 2 1 * *', timezone }; // Monthly on the 1st at 02:00 UTC
    default:
      // Fallback to daily at 02:00 UTC
      return { schedule: '0 2 * * *', timezone };
  }
}

/**
 * Create a new website and automatically create + publish its scan workflow
 */
export async function createWebsite(
  ctx: MutationCtx,
  args: CreateWebsiteArgs,
): Promise<Id<'websites'>> {
  // Normalize domain to bare hostname to avoid duplicates like "https://domain" vs "domain"
  const { websiteDomain } = toUrlAndDomain(args.domain);

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

  // Create website with normalized domain stored
  const websiteId = await ctx.db.insert('websites', {
    ...args,
    domain: websiteDomain,
  });

  // Provision the workflow asynchronously to avoid coupling errors here
  await ctx.scheduler.runAfter(
    0,
    internal.websites.mutations.provisionWebsiteScanWorkflow,
    {
      organizationId: args.organizationId,
      websiteId,
      domain: websiteDomain,
      scanInterval: args.scanInterval,
      autoTriggerInitialScan: true,
    },
  );

  return websiteId;
}
