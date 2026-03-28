import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ContentArea } from '@/app/components/layout/content-area';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  triggeredBy: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/executions',
)({
  head: () => ({
    meta: seo('automationExecutions'),
  }),
  validateSearch: searchSchema,
  component: ExecutionsPage,
});

function ExecutionsPage() {
  const { t } = useT('automations');

  return (
    <ContentArea variant="narrow" gap={4} className="py-8">
      <Text as="p" variant="label">
        {t('executions.title')}
      </Text>
      <Text as="p" variant="caption">
        Execution history will be available here once workflows are triggered.
      </Text>
    </ContentArea>
  );
}
