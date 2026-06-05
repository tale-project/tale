/**
 * Pure feedback-period helpers, kept out of the UI module so the route loader
 * can preload feedback stats without importing the client page component.
 */

export type FeedbackPeriod = '1' | '7' | '30' | '90' | 'all';

export function periodToDays(p: FeedbackPeriod): 1 | 7 | 30 | 90 | undefined {
  if (p === 'all') return undefined;
  if (p === '1') return 1;
  if (p === '7') return 7;
  if (p === '30') return 30;
  return 90;
}
