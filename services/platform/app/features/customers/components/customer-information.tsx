'use client';

import { Heading } from '@tale/ui/heading';
import { Stack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import {
  type CustomerData,
  isCustomerDoc,
  isValidStatus,
} from '../lib/customer-data';
import { CustomerStatusBadge } from './customer-status-badge';

interface CustomerInformationProps {
  customer: CustomerData;
}

export function CustomerInformation({ customer }: CustomerInformationProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('common');

  const createdAt = isCustomerDoc(customer)
    ? customer._creationTime
      ? formatDate(new Date(customer._creationTime), 'long')
      : null
    : customer.created_at
      ? formatDate(new Date(customer.created_at), 'long')
      : null;

  const items = useMemo<StatGridItem[]>(
    () => [
      {
        label: t('labels.status'),
        value: isValidStatus(customer.status) ? (
          <CustomerStatusBadge status={customer.status} />
        ) : (
          <Text>{customer.status || t('labels.notAvailable')}</Text>
        ),
      },
      {
        label: t('labels.source'),
        value: <Text>{customer.source || t('labels.notAvailable')}</Text>,
      },
      {
        label: t('labels.created'),
        value: <Text>{createdAt || t('labels.notAvailable')}</Text>,
      },
      {
        label: t('labels.locale'),
        value: <Text>{customer.locale || 'en'}</Text>,
      },
    ],
    [customer, createdAt, t],
  );

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
