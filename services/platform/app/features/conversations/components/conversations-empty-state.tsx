'use client';

import { Heading } from '@tale/ui/heading';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
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
    <Row gap={0} justify="center" className="m-4 flex-1 rounded-xl px-4 py-12">
      <Stack gap={0} align="center" className="max-w-sm text-center">
        <MessageSquare className="text-muted-foreground mb-4 size-6" />
        <Heading level={2} size="lg" className="mb-1">
          {t('activate.title')}
        </Heading>
        {/* `text-balance` keeps the two description lines even — without it
            `max-w-md` stranded "here." alone on the second line. */}
        <Text variant="muted" className="text-balance">
          {t('activate.description')}
        </Text>
      </Stack>
    </Row>
  );
}
