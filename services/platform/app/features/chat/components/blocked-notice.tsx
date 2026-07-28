'use client';

import { Row } from '@tale/ui/layout';
import { ShieldAlert } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Replaces the entire content region of an assistant message the guardrails
 * blocked. The stored `blockedReason` is deliberately NOT rendered here —
 * that's org-internal taxonomy, and exposing it teaches evasion. The owner
 * can still read it in the message info dialog; the transcript just says the
 * policy tripped.
 */
export function BlockedNotice() {
  const { t } = useT('chat');
  return (
    <Row
      role="status"
      aria-live="polite"
      gap={2}
      align="start"
      className="text-muted-foreground text-sm"
    >
      <ShieldAlert
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden
      />
      <span>{t('blockedNotice.body')}</span>
    </Row>
  );
}
