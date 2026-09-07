'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { MessageSquare } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Zero-conversations state. The Inbox is only reachable once an installed
 * automation declares it (the nav gate), so there is no "connect your email"
 * onboarding CTA here — connection readiness lives on the automation's own
 * page; this just says the inbox is empty.
 */
export function ConversationsEmptyState() {
  const { t } = useT('conversations');

  return (
    <EmptyState
      icon={MessageSquare}
      title={t('activate.title')}
      description={t('activate.description')}
      headingLevel={2}
      className="m-4 rounded-xl"
    />
  );
}
