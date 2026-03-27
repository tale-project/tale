'use client';

import { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';
import type { CustomerInfo } from '@/convex/conversations/types';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Popover } from '@/app/components/ui/overlays/popover';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { CustomerStatusBadge } from './customer-status-badge';

export type CustomerData = Doc<'customers'> | CustomerInfo;

function isCustomerDoc(customer: CustomerData): customer is Doc<'customers'> {
  return '_creationTime' in customer;
}

type CustomerStatus = Doc<'customers'>['status'];
const VALID_STATUSES = new Set<string>(['active', 'churned', 'potential']);

function isValidStatus(status: string | undefined): status is CustomerStatus {
  return status !== undefined && VALID_STATUSES.has(status);
}

interface InfoRowProps {
  label: string;
  children: React.ReactNode;
}

function InfoRow({ label, children }: InfoRowProps) {
  return (
    <div className="flex items-center justify-between">
      <Text variant="muted" className="text-[13px]">
        {label}
      </Text>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

export function CustomerInfoCard({ customer }: { customer: CustomerData }) {
  const { formatDate } = useFormatDate();
  const { t } = useT('common');

  const createdAt = useMemo(() => {
    if (isCustomerDoc(customer)) {
      return customer._creationTime
        ? formatDate(new Date(customer._creationTime), 'long')
        : null;
    }
    return customer.created_at
      ? formatDate(new Date(customer.created_at), 'long')
      : null;
  }, [customer, formatDate]);

  return (
    <>
      <div className="border-border space-y-0.5 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <Text className="text-sm font-semibold tracking-tight">
            {customer.name || t('labels.notAvailable')}
          </Text>
          {isValidStatus(customer.status) && (
            <CustomerStatusBadge status={customer.status} />
          )}
        </div>
        <Text variant="muted" className="text-xs tracking-tight">
          {customer.email || t('labels.notAvailable')}
        </Text>
      </div>

      <div className="space-y-3.5 px-5 py-4">
        <InfoRow label={t('labels.created')}>
          <Text className="text-[13px]">
            {createdAt || t('labels.notAvailable')}
          </Text>
        </InfoRow>
        <InfoRow label={t('labels.locale')}>
          <Text className="text-[13px]">{customer.locale || 'en'}</Text>
        </InfoRow>
        <InfoRow label={t('labels.source')}>
          {customer.source ? (
            <Badge variant="outline">
              {customer.source
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase())}
            </Badge>
          ) : (
            <Text className="text-[13px]">{t('labels.notAvailable')}</Text>
          )}
        </InfoRow>
      </div>
    </>
  );
}

interface CustomerInfoPopoverProps {
  customer: CustomerData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
}

export function CustomerInfoPopover({
  customer,
  open,
  onOpenChange,
  trigger,
}: CustomerInfoPopoverProps) {
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      align="start"
      side="bottom"
      sideOffset={8}
      contentClassName="w-80 max-w-none p-0"
      onOpenAutoFocus={(e) => e.preventDefault()}
    >
      <CustomerInfoCard customer={customer} />
    </Popover>
  );
}
