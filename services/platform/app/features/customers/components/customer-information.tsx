'use client';

import { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';
import type { CustomerInfo } from '@/convex/conversations/types';

import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { Stack } from '@/app/components/ui/layout/layout';
import { Heading } from '@/app/components/ui/typography/heading';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { CustomerStatusBadge } from './customer-status-badge';

type CustomerData = Doc<'customers'> | CustomerInfo;

type CustomerStatus = Doc<'customers'>['status'];
const VALID_STATUSES = new Set<string>(['active', 'churned', 'potential']);

function isValidStatus(status: string | undefined): status is CustomerStatus {
  return status !== undefined && VALID_STATUSES.has(status);
}

function isCustomerDoc(customer: CustomerData): customer is Doc<'customers'> {
  return '_creationTime' in customer;
}

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
