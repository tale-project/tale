import type { Doc } from '@/convex/_generated/dataModel';

/**
 * Whether this website's scans are paused — the `metadata.scanPausedAt` flag
 * the crawler writes after repeated failures to reach the organization's
 * knowledge database (see convex/websites/scan_scheduling.ts). Paused rows
 * keep `status: 'error'`; this flag is what distinguishes "failed, will
 * retry" from "gave up, needs a manual resume".
 */
export function isScanPaused(website: Doc<'websites'>): boolean {
  return typeof website.metadata?.scanPausedAt === 'number';
}
