'use client';

import { Stack, HStack } from '@/app/components/ui/layout/layout';
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
  if (!customer) return null;

  return (
    <>
      {/* Customer Info Section */}
      <Stack gap={5}>
        {/* Customer Name & Email */}
        <Stack gap={1}>
          <div className="text-foreground text-lg leading-none font-semibold">
            {customer.name || t('labels.notAvailable')}
          </div>
          <div className="text-muted-foreground text-sm tracking-tight">
            {customer.email || t('labels.notAvailable')}
          </div>
        </Stack>

        {/* Customer Details Grid */}
        <Stack gap={3}>
          <HStack>
            <div className="text-muted-foreground w-[5.625rem] text-xs tracking-tight">
              {t('labels.status')}
            </div>
            {customer.status && (
              <CustomerStatusBadge status={customer.status} />
            )}
          </HStack>

          <HStack>
            <div className="text-muted-foreground w-[5.625rem] text-xs tracking-tight">
              {t('labels.source')}
            </div>
            <div className="text-foreground text-sm font-medium tracking-tight">
              {customer.source || t('labels.notAvailable')}
            </div>
          </HStack>

          <HStack>
            <div className="text-muted-foreground w-[5.625rem] text-xs tracking-tight">
              {t('labels.created')}
            </div>
            <div className="text-foreground text-sm font-medium tracking-tight">
              {customer._creationTime
                ? formatDate(new Date(customer._creationTime), 'long')
                : t('labels.notAvailable')}
            </div>
          </HStack>

          <HStack>
            <div className="text-muted-foreground w-[5.625rem] text-xs tracking-tight">
              {t('labels.locale')}
            </div>
            <div className="text-foreground text-base font-medium tracking-tight">
              {customer.locale || 'en'}
            </div>
          </HStack>
        </Stack>
      </Stack>
    </>
  );
}
