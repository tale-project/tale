import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { Field } from '@/app/components/ui/forms/field';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface VendorInformationProps {
  vendor: Doc<'vendors'>;
}

export function VendorInformation({ vendor }: VendorInformationProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('common');

  if (!vendor) return null;

  const items: StatGridItem[] = [
    {
      label: t('labels.name'),
      value: <Text>{vendor.name || t('labels.notAvailable')}</Text>,
    },
    {
      label: t('labels.email'),
      value: <Text>{vendor.email || t('labels.notAvailable')}</Text>,
    },
    ...(vendor.phone
      ? [{ label: t('labels.phone'), value: <Text>{vendor.phone}</Text> }]
      : []),
    {
      label: t('labels.source'),
      value: <Text>{vendor.source || t('labels.notAvailable')}</Text>,
    },
    {
      label: t('labels.locale'),
      value: <Text>{vendor.locale || t('labels.notAvailable')}</Text>,
    },
    {
      label: t('labels.created'),
      value: <Text>{formatDate(new Date(vendor._creationTime), 'long')}</Text>,
    },
  ];

  return (
    <Stack gap={4}>
      <StatGrid items={items} />

      {vendor.address && (
        <Field label={t('labels.address')}>
          <Stack gap={1} className="text-sm">
            {vendor.address.street && <p>{vendor.address.street}</p>}
            {(vendor.address.city || vendor.address.state) && (
              <p>
                {vendor.address.city}
                {vendor.address.city && vendor.address.state && ', '}
                {vendor.address.state}
              </p>
            )}
            {vendor.address.postalCode && <p>{vendor.address.postalCode}</p>}
            {vendor.address.country && <p>{vendor.address.country}</p>}
          </Stack>
        </Field>
      )}

      {vendor.tags && vendor.tags.length > 0 && (
        <Field label={t('labels.tags')}>
          <HStack gap={2} className="flex-wrap">
            {vendor.tags.map((tag) => (
              <span key={tag} className="bg-muted rounded-md px-2 py-1 text-xs">
                {tag}
              </span>
            ))}
          </HStack>
        </Field>
      )}

      {vendor.notes && (
        <Field label={t('labels.notes')}>
          <Text>{vendor.notes}</Text>
        </Field>
      )}
    </Stack>
  );
}
