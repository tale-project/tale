'use client';

import { BrandIcon } from '@tale/ui/brand-icon';
import { ConfigIcon } from '@tale/ui/catalog/config-icon';
import { cn } from '@tale/ui/cn';

/** The prefix a manifest names a product's logo with (`brand:gmail`). */
const BRAND_PREFIX = 'brand:';

/**
 * An automation's or a template's icon, as its manifest names it: the
 * product's own logo for `brand:<slug>` (Gmail, GitHub, …), otherwise its
 * lucide glyph, and the neutral fallback for none. Decorative either way —
 * the name always sits beside it.
 */
export function AutomationIcon({
  icon,
  className,
}: {
  /** `brand:<slug>`, a lucide name, or nothing. */
  icon: string | undefined;
  className?: string;
}) {
  if (icon !== undefined && icon.startsWith(BRAND_PREFIX)) {
    return (
      <BrandIcon
        brand={icon.slice(BRAND_PREFIX.length)}
        className={className}
      />
    );
  }
  return (
    <ConfigIcon
      {...(icon !== undefined && { icon: `lucide:${icon}` })}
      className={cn('text-muted-foreground shrink-0', className)}
    />
  );
}
