/**
 * Resolve the first bundled view id from an install preflight's entries.
 * Preview entries include `kind: 'view'` with `path: 'views/<stem>.json'`; the
 * stem matches the view id `listAutomations` / the automation page use as the
 * `?tab=` value. Returns undefined when the automation ships no views.
 */
import { viewIdFromFilename } from '@/convex/automations/view_parse';

export function firstViewIdFromPreviewEntries(
  entries: readonly { kind: string; path: string }[],
): string | undefined {
  const view = entries.find((e) => e.kind === 'view');
  if (!view) return undefined;
  return viewIdFromFilename(view.path);
}

/** First view id from an installed automation's `views` array (list / detail). */
export function firstViewIdFromViews(
  views: readonly { id?: string }[] | undefined,
): string | undefined {
  const id = views?.[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}
