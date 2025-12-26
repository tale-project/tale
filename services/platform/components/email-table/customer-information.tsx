'use client';

import { CustomerStatusBadge } from '../customers/customer-status-badge';
import { Stack, HStack } from '@/components/ui/layout';
import { formatDate } from '@/lib/utils/date/format';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface CustomerInformationProps {
  customer: Doc<'customers'>;
}

export function CustomerInformation({ customer }: CustomerInformationProps) {
  const { t } = useT('common');
  if (!customer) return null;

  return (
    <>
      {/* Customer Info Section */}
      <Stack gap={5}>
        {/* Customer Name & Email */}
        <Stack gap={1}>
          <div className="text-lg font-semibold text-foreground leading-none">
            {customer.name || t('labels.notAvailable')}
          </div>
          <div className="text-sm text-muted-foreground tracking-tight">
            {customer.email || t('labels.notAvailable')}
          </div>
        </Stack>

        {/* Customer Details Grid */}
        <Stack gap={3}>
          <HStack>
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              {t('labels.status')}
            </div>
            {customer.status && (
              <CustomerStatusBadge status={customer.status} />
            )}
          </HStack>

          <HStack>
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              {t('labels.source')}
            </div>
            <div className="text-sm font-medium text-foreground tracking-tight">
              {customer.source || t('labels.notAvailable')}
            </div>
          </HStack>

          <HStack>
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              {t('labels.created')}
            </div>
            <div className="text-sm font-medium text-foreground tracking-tight">
              {customer._creationTime
                ? formatDate(new Date(customer._creationTime), {
                    preset: 'long',
                  })
                : t('labels.notAvailable')}
            </div>
          </HStack>

          <HStack>
            <div className="text-xs text-muted-foreground tracking-tight w-[5.625rem]">
              {t('labels.locale')}
            </div>
            <div className="text-base font-medium text-foreground tracking-tight">
              {customer.locale || 'en'}
            </div>
          </HStack>
        </Stack>
      </Stack>
    </>
  );
}
