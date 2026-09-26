'use client';

import { IconButton } from '@tale/ui/icon-button';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * Compact mobile-only back control for the Inbox page chrome — sits left of
 * the Inbox title in `AdaptiveHeaderRoot` while a conversation or the compose
 * pane is open (`?conversation=` / `?compose=`), and leads back to Home. Self-contained (reads the URL)
 * so it still works when `AdaptiveHeaderSlot` remounts the header outside the
 * conversations tree. Uses the dense `sm` icon square so the glyph reads as
 * part of the title cluster rather than a padded toolbar button.
 */
export function InboxMobileBackButton() {
  const { t } = useT('common');
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as {
    id?: string;
    status?: string;
  };
  const search = useSearch({ strict: false }) as {
    conversation?: unknown;
    compose?: unknown;
  };
  const conversationId =
    typeof search.conversation === 'string' ? search.conversation : undefined;
  const isComposing = search.compose !== undefined;
  const showBack = Boolean(conversationId || isComposing);

  // Back to the Home list — the one list a phone keeps every chat, task and
  // conversation in (its Inbox view carries the statuses and bulk verbs).
  const handleBack = useCallback(() => {
    if (!params.id) return;
    void navigate({
      to: '/dashboard/$id/home',
      params: { id: params.id },
    });
  }, [navigate, params.id]);

  if (!showBack || !params.id) return null;

  return (
    <IconButton
      icon={ArrowLeft}
      iconSize={5}
      size="sm"
      aria-label={t('aria.back')}
      onClick={handleBack}
      className="-ml-1.5 shrink-0 md:hidden"
    />
  );
}
