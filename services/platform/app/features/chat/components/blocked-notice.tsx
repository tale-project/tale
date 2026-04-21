'use client';

import { ShieldAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

export interface BlockedReasonProps {
  code: 'pii.blocked' | 'chat_filter.blocked' | 'moderation_provider.blocked';
  direction: 'input' | 'output';
  categoryIds: readonly string[];
}

/**
 * Replaces the entire content region of an assistant message when the
 * guardrails pipeline blocked the response. We intentionally do NOT
 * expose raw `categoryIds` to end users (that's org-internal taxonomy,
 * and exposing it teaches evasion). Admins see full detail in the
 * governance event feed; the user just sees the policy tripped.
 */
export function BlockedNotice(_props: BlockedReasonProps) {
  const { t } = useT('chat');
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-muted-foreground flex items-start gap-2 text-sm"
    >
      <ShieldAlert
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden
      />
      <span>{t('blockedNotice.body')}</span>
    </div>
  );
}
