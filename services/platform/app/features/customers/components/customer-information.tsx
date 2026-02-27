'use client';

import { useMemo } from 'react';

import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { Stack } from '@/app/components/ui/layout/layout';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { CustomerStatusBadge } from './customer-status-badge';

interface CustomerInformationProps {
  customer: Doc<'customers'>;
}

export function CustomerInformation({ customer }: CustomerInformationProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('common');

  const items = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('labels.status'),
        value: customer.status ? (
          <CustomerStatusBadge status={customer.status} />
        ) : (
          <Text>{t('labels.notAvailable')}</Text>
        ),
      },
      {
        label: t('labels.source'),
        value: <Text>{customer.source || t('labels.notAvailable')}</Text>,
      },
      {
        label: t('labels.created'),
        value: (
          <Text>
            {customer._creationTime
              ? formatDate(new Date(customer._creationTime), 'long')
              : t('labels.notAvailable')}
          </Text>
        ),
      },
      {
        label: t('labels.locale'),
        value: <Text>{customer.locale || 'en'}</Text>,
      },
    ],
    [customer, t, formatDate],
  );

  if (!customer) return null;

  return (
    <Stack gap={5}>
      <Stack gap={1}>
        <Heading level={3} size="lg" className="leading-none">
          {customer.name || t('labels.notAvailable')}
        </Heading>
        <Text as="div" variant="muted" className="tracking-tight">
          {customer.email || t('labels.notAvailable')}
        </Text>
      </Stack>

      <StatGrid items={items} />
    </Stack>
  );
}
