'use client';

import { IconButton } from '@tale/ui/icon-button';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useCallback } from 'react';

import { useT } from '@/lib/i18n/client';

/**
 * Compact mobile-only back control for the Inbox page chrome — sits left of
 * the Inbox title in `AdaptiveHeaderRoot` while a conversation or the compose
 * pane is open (`?conversation=` / `?compose=`). Self-contained (reads the URL)
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

  const handleBack = useCallback(() => {
    if (!params.id) return;
    void navigate({
      to: '/dashboard/$id/conversations/$status',
      params: { id: params.id, status: params.status ?? 'open' },
      search: (prev) => ({
        ...prev,
        conversation: undefined,
        compose: undefined,
        composeContact: undefined,
      }),
      replace: true,
    });
  }, [navigate, params.id, params.status]);

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
