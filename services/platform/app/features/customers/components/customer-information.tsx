'use client';

import { Stack, HStack } from '@/app/components/ui/layout/layout';
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
  if (!customer) return null;

  return (
    <>
      {/* Customer Info Section */}
      <Stack gap={5}>
        {/* Customer Name & Email */}
        <Stack gap={1}>
          <Heading level={3} size="lg" className="leading-none">
            {customer.name || t('labels.notAvailable')}
          </Heading>
          <Text as="div" variant="muted" className="tracking-tight">
            {customer.email || t('labels.notAvailable')}
          </Text>
        </Stack>

        {/* Customer Details Grid */}
        <Stack gap={3}>
          <HStack>
            <Text
              as="div"
              variant="caption"
              className="w-[5.625rem] tracking-tight"
            >
              {t('labels.status')}
            </Text>
            {customer.status && (
              <CustomerStatusBadge status={customer.status} />
            )}
          </HStack>

          <HStack>
            <Text
              as="div"
              variant="caption"
              className="w-[5.625rem] tracking-tight"
            >
              {t('labels.source')}
            </Text>
            <Text as="div" variant="label" className="tracking-tight">
              {customer.source || t('labels.notAvailable')}
            </Text>
          </HStack>

          <HStack>
            <Text
              as="div"
              variant="caption"
              className="w-[5.625rem] tracking-tight"
            >
              {t('labels.created')}
            </Text>
            <Text as="div" variant="label" className="tracking-tight">
              {customer._creationTime
                ? formatDate(new Date(customer._creationTime), 'long')
                : t('labels.notAvailable')}
            </Text>
          </HStack>

          <HStack>
            <Text
              as="div"
              variant="caption"
              className="w-[5.625rem] tracking-tight"
            >
              {t('labels.locale')}
            </Text>
            <Text as="div" variant="label" className="text-base tracking-tight">
              {customer.locale || 'en'}
            </Text>
          </HStack>
        </Stack>
      </Stack>
    </>
  );
}
