'use client';

import { Badge } from '@tale/ui/badge';

import { useT } from '@/lib/i18n/client';

interface ProductStatusBadgeProps {
  status: string;
  className?: string;
}

/**
 * Renders a product status as a localized badge. Maps the stored backend value
 * through the shared `common.status.<key>` keys and falls back to the raw value
 * for any status without a translation.
 */
export function ProductStatusBadge({
  status,
  className,
}: ProductStatusBadgeProps) {
  const { t: tCommon } = useT('common');
  return (
    <Badge
      variant={status === 'active' ? 'blue' : 'outline'}
      className={className}
    >
      {tCommon(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
}
