'use client';

import { MessageSquare, Plus } from 'lucide-react';

import { LinkButton } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface ActivateConversationsEmptyStateProps {
  organizationId: string;
}

export function ActivateConversationsEmptyState({
  organizationId,
}: ActivateConversationsEmptyStateProps) {
  const { t } = useT('conversations');

  return (
    <div className="ring-border m-4 flex flex-1 items-center justify-center rounded-xl px-4 py-12 ring-1">
      <div className="flex max-w-md flex-col items-center text-center">
        <MessageSquare className="text-muted-foreground mb-4 size-6" />
        <h2 className="text-foreground mb-1 text-lg font-semibold">
          {t('activate.title')}
        </h2>
        <p className="text-muted-foreground mb-4 text-sm">
          {t('activate.description')}
        </p>
        <LinkButton
          href={`/dashboard/${organizationId}/settings/integrations?tab=email`}
          icon={Plus}
        >
          {t('activate.connectEmail')}
        </LinkButton>
      </div>
    </div>
  );
}
