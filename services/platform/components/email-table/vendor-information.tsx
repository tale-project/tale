import { formatDate } from '@/lib/utils/date/format';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface VendorInformationProps {
  vendor: Doc<'vendors'>;
}

export function VendorInformation({ vendor }: VendorInformationProps) {
  const { t } = useT('common');

  if (!vendor) return null;

  return (
    <div className="space-y-4">
      {/* Vendor Details */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-1">{t('labels.name')}</h4>
        <p>{vendor.name || t('labels.notAvailable')}</p>
      </div>

      {/* Vendor Email */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-1">
          {t('labels.email')}
        </h4>
        <p>{vendor.email || t('labels.notAvailable')}</p>
      </div>

      {/* Vendor Phone */}
      {vendor.phone && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">
            {t('labels.phone')}
          </h4>
          <p>{vendor.phone}</p>
        </div>
      )}

      {/* Vendor Source */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-1">
          {t('labels.source')}
        </h4>
        <p>{vendor.source || t('labels.notAvailable')}</p>
      </div>

      {/* Vendor Locale */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-1">
          {t('labels.locale')}
        </h4>
        <p>{vendor.locale || t('labels.notAvailable')}</p>
      </div>

      {/* Vendor Address */}
      {vendor.address && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">
            {t('labels.address')}
          </h4>
          <div className="text-sm space-y-1">
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
          </div>
        </div>
      )}

      {/* Vendor Tags */}
      {vendor.tags && vendor.tags.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">
            {t('labels.tags')}
          </h4>
          <div className="flex flex-wrap gap-2">
            {vendor.tags.map((tag) => (
              <span key={tag} className="px-2 py-1 text-xs rounded-md bg-muted">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Vendor Notes */}
      {vendor.notes && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-1">
            {t('labels.notes')}
          </h4>
          <p className="text-sm">{vendor.notes}</p>
        </div>
      )}

      {/* Created Date */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground mb-1">
          {t('labels.created')}
        </h4>
        <p>{formatDate(new Date(vendor._creationTime), { preset: 'long' })}</p>
      </div>
    </div>
  );
}
