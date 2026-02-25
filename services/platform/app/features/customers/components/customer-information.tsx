'use client';

import { Field, FieldGroup } from '@/app/components/ui/forms/field';
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
  if (!customer) return null;

  return (
    <>
      <Stack gap={5}>
        <Stack gap={1}>
          <Heading level={3} size="lg" className="leading-none">
            {customer.name || t('labels.notAvailable')}
          </Heading>
          <Text as="div" variant="muted" className="tracking-tight">
            {customer.email || t('labels.notAvailable')}
          </Text>
        </Stack>

        <FieldGroup gap={3}>
          <Field label={t('labels.status')}>
            {customer.status ? (
              <CustomerStatusBadge status={customer.status} />
            ) : (
              t('labels.notAvailable')
            )}
          </Field>

          <Field label={t('labels.source')}>
            <Text as="div" variant="label" className="tracking-tight">
              {customer.source || t('labels.notAvailable')}
            </Text>
          </Field>

          <Field label={t('labels.created')}>
            <Text as="div" variant="label" className="tracking-tight">
              {customer._creationTime
                ? formatDate(new Date(customer._creationTime), 'long')
                : t('labels.notAvailable')}
            </Text>
          </Field>

          <Field label={t('labels.locale')}>
            <Text as="div" variant="label" className="text-base tracking-tight">
              {customer.locale || 'en'}
            </Text>
          </Field>
        </FieldGroup>
      </Stack>
    </>
  );
}
