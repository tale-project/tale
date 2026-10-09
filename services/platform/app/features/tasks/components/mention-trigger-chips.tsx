'use client';

import { cn } from '@tale/ui/cn';
import { Ban, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { findTaskMentions } from '@/backend/core/tasks/mentions';
import { useT } from '@/lib/i18n/client';
import type { MentionHandleIndex } from '@/lib/shared/mention-handles';

import { useMentionTriggerPreview } from '../hooks/queries';
import {
  useTaskMentionActors,
  withTaskActorDirectory,
} from '../hooks/task-actor-directory-context';

const DEBOUNCE_MS = 400;

/** The agents a text mentions, by id: a stored mention names its agent, and
 * a typed `@handle` names whom the server would resolve it to. */
function mentionedAgents(text: string, mentions: MentionHandleIndex): string[] {
  const ids: string[] = [];
  for (const occurrence of findTaskMentions(text)) {
    let agentId: string | undefined;
    if (occurrence.type === 'token') {
      if (occurrence.ref.kind === 'agent') agentId = occurrence.ref.id;
    } else {
      const entry = mentions.resolve(occurrence.handle);
      if (entry?.kind === 'agent') agentId = entry.id;
    }
    if (agentId !== undefined && !ids.includes(agentId)) ids.push(agentId);
  }
  return ids;
}

/**
 * Live trigger preview under a mention-aware composer (comment OR task
 * description): for each @-mentioned agent in the draft, whether saving will
 * put it to work (⚡) or why not (⛔ — automation off, breaker, budget, or a
 * task the viewer may comment on but not work).
 * Only mentions of the project's agents are queried, by id — human mentions
 * and typos render no chip. Create mode (no task yet) targets the project
 * instead of the task.
 */
export const MentionTriggerChips = withTaskActorDirectory(
  MentionTriggerChipsContent,
);

function MentionTriggerChipsContent({
  organizationId,
  projectId,
  target,
  draft,
  baseline,
}: {
  organizationId: string;
  /** The project whose agents the draft can mention. */
  projectId: string;
  target: { taskId: string } | { projectId: string };
  draft: string;
  /** Saved text the draft edits (description edit mode): tokens already in
   *  it won't re-trigger on save, so they get no chip — mirrors the server's
   *  newly-added-mentions diff. */
  baseline?: string;
}) {
  const { t } = useT('tasks');
  const mentions = useTaskMentionActors(organizationId, projectId);

  // Parse per keystroke (cheap), query only when the settled set of
  // mentioned agents changes — typing "@mar…" must not refire the query per
  // character. One chip per agent, however the text named it.
  const tokensKey = useMemo(() => {
    const existing = new Set(
      baseline ? mentionedAgents(baseline, mentions) : [],
    );
    return mentionedAgents(draft, mentions)
      .filter((id) => !existing.has(id))
      .join(',');
  }, [draft, baseline, mentions]);
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
  if (previews.length === 0) return null;

  const label = (preview: (typeof previews)[number]): string => {
    // The chip names the agent by its display name, not the raw id.
    const name =
      mentions.byRef({ kind: 'agent', id: preview.slug })?.name ?? preview.slug;
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
      case 'not_permitted':
        return t('mentionPreview.notPermitted', { slug: name });
      case 'standard_agent_unavailable':
        return t('mentionPreview.standardAgentUnavailable', { slug: name });
      default:
        return name;
    }
  };

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {previews.map((preview) => (
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
