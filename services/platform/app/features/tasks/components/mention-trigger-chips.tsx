'use client';

import { Ban, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { parseMentionTokens } from '@/convex/tasks/mentions';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMentionTriggerPreview } from '../hooks/queries';
import { useActorDirectory } from '../hooks/use-actor-directory';

const DEBOUNCE_MS = 400;

/**
 * Live trigger preview under a mention-aware composer (comment OR task
 * description): for each @-mentioned agent in the draft, whether saving will
 * put it to work (⚡) or why not (⛔ — automation off, breaker, budget).
 * Only tokens that name a real org agent are queried — human mentions and
 * typos render no chip (the server can't verify slug existence itself; the
 * file-based roster is enumerable only client-side and at run admission).
 * Create mode (no task yet) passes `projectId` instead of `taskId`.
 */
export function MentionTriggerChips({
  organizationId,
  target,
  draft,
  baseline,
}: {
  organizationId: string;
  target: { taskId: string } | { projectId: string };
  draft: string;
  /** Saved text the draft edits (description edit mode): tokens already in
   *  it won't re-trigger on save, so they get no chip — mirrors the server's
   *  newly-added-mentions diff. */
  baseline?: string;
}) {
  const { t } = useT('tasks');
  const { agents } = useActorDirectory(organizationId);

  // Parse per keystroke (cheap), query only when the settled token set
  // changes — typing "@mar…" must not refire the query per character.
  const tokensKey = useMemo(() => {
    const agentSlugs = new Set(agents.map((a) => a.id.toLowerCase()));
    const existing = new Set(baseline ? parseMentionTokens(baseline) : []);
    return parseMentionTokens(draft)
      .filter((token) => agentSlugs.has(token) && !existing.has(token))
      .join(',');
  }, [draft, baseline, agents]);
  const [debouncedKey, setDebouncedKey] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(tokensKey), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tokensKey]);
  const slugs = useMemo(
    () => (debouncedKey ? debouncedKey.split(',') : []),
    [debouncedKey],
  );

  const { previews } = useMentionTriggerPreview(target, slugs);
  const visible = previews.filter((p) => p.reason !== 'not_mentionable');
  if (visible.length === 0) return null;

  const label = (preview: (typeof visible)[number]): string => {
    // The chip names the agent by its display name, not the raw slug.
    const name =
      agents.find((a) => a.id.toLowerCase() === preview.slug)?.name ??
      preview.slug;
    switch (preview.reason) {
      case 'ok':
        return t('mentionPreview.willRespond', { slug: name });
      case 'queued_likely':
        return t('mentionPreview.willQueue', { slug: name });
      case 'pack_disabled':
        return t('mentionPreview.packDisabled', { slug: name });
      case 'breaker_paused':
        return t('mentionPreview.breakerPaused', { slug: name });
      case 'budget_paused':
        return t('mentionPreview.budgetPaused', { slug: name });
      case 'agent_not_live':
        return t('mentionPreview.agentNotLive', { slug: name });
      default:
        return name;
    }
  };

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {visible.map((preview) => (
        <li
          key={preview.slug}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
            preview.willTrigger
              ? 'border-primary/40 text-primary'
              : 'border-border text-muted-foreground',
          )}
        >
          {preview.willTrigger ? (
            <Zap className="size-3" aria-hidden />
          ) : (
            <Ban className="size-3" aria-hidden />
          )}
          {label(preview)}
        </li>
      ))}
    </ul>
  );
}
