'use client';

import { Badge } from '@/components/ui/badge';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

// Stub type for customer status - matches Convex schema
type CustomerStatus = Doc<'customers'>['status'];

const getStatusVariant = (status: CustomerStatus) => {
  switch (status) {
    case 'active':
      return 'green' as const;
    case 'churned':
      return 'destructive' as const;
    case 'potential':
      return 'yellow' as const;
    default:
      return 'outline' as const;
  }
};

export function CustomerStatusBadge({ status }: { status?: CustomerStatus }) {
  const { t } = useT('customers');

  const getStatusLabel = (status: CustomerStatus) => {
    switch (status) {
      case 'active':
        return t('filter.status.active');
      case 'churned':
        return t('filter.status.churned');
      case 'potential':
        return t('filter.status.potential');
      default:
        return status;
    }
  };

  return (
    <Badge variant={getStatusVariant(status)} dot>
      {getStatusLabel(status)}
    </Badge>
  );
}
