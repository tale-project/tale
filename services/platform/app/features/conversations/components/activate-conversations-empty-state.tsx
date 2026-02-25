'use client';

import { MessageSquare, Plus } from 'lucide-react';

import { LinkButton } from '@/app/components/ui/primitives/button';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
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
        <Heading level={2} size="lg" className="mb-1">
          {t('activate.title')}
        </Heading>
        <Text variant="muted" className="mb-4">
          {t('activate.description')}
        </Text>
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
