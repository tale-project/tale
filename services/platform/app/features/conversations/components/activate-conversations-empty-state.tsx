'use client';

import { LinkButton } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { MessageSquare } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface ActivateConversationsEmptyStateProps {
  organizationId: string;
}

export function ActivateConversationsEmptyState({
  organizationId,
}: ActivateConversationsEmptyStateProps) {
  const { t } = useT('conversations');

  return (
    <Row gap={0} justify="center" className="m-4 flex-1 rounded-xl px-4 py-12">
      <Stack gap={0} align="center" className="max-w-md text-center">
        <MessageSquare className="text-muted-foreground mb-4 size-6" />
        <Heading level={2} size="lg" className="mb-1">
          {t('activate.title')}
        </Heading>
        <Text variant="muted" className="mb-4">
          {t('activate.description')}
        </Text>
        <LinkButton
          href={`/dashboard/${organizationId}/settings/integrations?tab=all`}
        >
          {t('activate.connectEmail')}
        </LinkButton>
      </Stack>
    </Row>
  );
}
