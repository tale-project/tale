'use client';

import { Ban, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import { parseMentionTokens } from '@/convex/tasks/mentions';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMentionTriggerPreview } from '../hooks/queries';

const DEBOUNCE_MS = 400;

/**
 * Live trigger preview under the comment composer: for each @-mentioned
 * agent in the draft, whether posting will put it to work (⚡) or why not
 * (⛔ — automation off, breaker, budget). Tokens that resolve to nothing
 * actionable (human mentions, typos, agents outside this project) render no
 * chip — the server can't tell them apart and the comment mutation drops
 * unresolvable mentions anyway.
 */
export function MentionTriggerChips({
  taskId,
  draft,
}: {
  taskId: Id<'tasks'>;
  draft: string;
}) {
  const { t } = useT('tasks');

  // Parse per keystroke (cheap), query only when the settled token set
  // changes — typing "@mar…" must not refire the query per character.
  const tokensKey = useMemo(() => parseMentionTokens(draft).join(','), [draft]);
  const [debouncedKey, setDebouncedKey] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKey(tokensKey), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [tokensKey]);
  const slugs = useMemo(
    () => (debouncedKey ? debouncedKey.split(',') : []),
    [debouncedKey],
  );

  const { previews } = useMentionTriggerPreview(taskId, slugs);
  const visible = previews.filter((p) => p.reason !== 'not_mentionable');
  if (visible.length === 0) return null;

  const label = (preview: (typeof visible)[number]): string => {
    switch (preview.reason) {
      case 'ok':
        return t('mentionPreview.willRespond', { slug: preview.slug });
      case 'queued_likely':
        return t('mentionPreview.willQueue', { slug: preview.slug });
      case 'pack_disabled':
        return t('mentionPreview.packDisabled', { slug: preview.slug });
      case 'breaker_paused':
        return t('mentionPreview.breakerPaused', { slug: preview.slug });
      case 'budget_paused':
        return t('mentionPreview.budgetPaused', { slug: preview.slug });
      default:
        return preview.slug;
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
