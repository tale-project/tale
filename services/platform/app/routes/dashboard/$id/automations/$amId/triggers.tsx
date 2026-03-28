import { createFileRoute } from '@tanstack/react-router';

import { ContentArea } from '@/app/components/layout/content-area';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/triggers',
)({
  head: () => ({
    meta: seo('automationTriggers'),
  }),
  component: TriggersPage,
});

function TriggersPage() {
  const { t } = useT('automations');

  return (
    <ContentArea variant="narrow" gap={4} className="py-8">
      <Text as="p" variant="label">
        {t('triggers.title')}
      </Text>
      <Text as="p" variant="caption">
        Trigger configuration for file-based workflows is coming soon.
      </Text>
    </ContentArea>
  );
}
