'use client';

import { Badge, type BadgeProps } from '@tale/ui/badge';

import { useT } from '@/lib/i18n/client';

interface ProductStatusBadgeProps {
  status: string;
  className?: string;
}

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'blue',
  draft: 'slate',
  inactive: 'yellow',
  archived: 'slate',
};

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
    <Badge variant={STATUS_VARIANT[status] ?? 'outline'} className={className}>
      {tCommon(`status.${status}`, { defaultValue: status })}
    </Badge>
  );
}
