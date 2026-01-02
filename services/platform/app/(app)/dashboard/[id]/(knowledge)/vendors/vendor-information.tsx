import { formatDate } from '@/lib/utils/date/format';
import { Doc } from '@/convex/_generated/dataModel';
import { Stack, HStack } from '@/components/ui/layout';
import { Field, FieldGroup } from '@/components/ui/field';
import { useT } from '@/lib/i18n';

interface VendorInformationProps {
  vendor: Doc<'vendors'>;
}

export function VendorInformation({ vendor }: VendorInformationProps) {
  const { t } = useT('common');

  if (!vendor) return null;

  return (
    <FieldGroup gap={4}>
      <Field label={t('labels.name')}>
        {vendor.name || t('labels.notAvailable')}
      </Field>

      <Field label={t('labels.email')}>
        {vendor.email || t('labels.notAvailable')}
      </Field>

      {vendor.phone && (
        <Field label={t('labels.phone')}>{vendor.phone}</Field>
      )}

      <Field label={t('labels.source')}>
        {vendor.source || t('labels.notAvailable')}
      </Field>

      <Field label={t('labels.locale')}>
        {vendor.locale || t('labels.notAvailable')}
      </Field>

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
              <span key={tag} className="px-2 py-1 text-xs rounded-md bg-muted">
                {tag}
              </span>
            ))}
          </HStack>
        </Field>
      )}

      {vendor.notes && (
        <Field label={t('labels.notes')}>
          <p className="text-sm">{vendor.notes}</p>
        </Field>
      )}

      <Field label={t('labels.created')}>
        {formatDate(new Date(vendor._creationTime), { preset: 'long' })}
      </Field>
    </FieldGroup>
  );
}
