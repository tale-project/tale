'use client';

import { LinkButton } from '@/components/ui/button';
import { MessageSquare, Plus } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface ActivateConversationsEmptyStateProps {
  organizationId: string;
}

export function ActivateConversationsEmptyState({
  organizationId,
}: ActivateConversationsEmptyStateProps) {
  const { t } = useT('conversations');

  return (
    <div className="flex items-center justify-center flex-1 ring-1 ring-border rounded-xl py-12 px-4">
      <div className="flex flex-col items-center text-center max-w-md">
        <MessageSquare className="size-6 text-muted-foreground mb-5" />
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {t('activate.title')}
        </h2>
        <p className="text-sm text-muted-foreground mb-5">
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
