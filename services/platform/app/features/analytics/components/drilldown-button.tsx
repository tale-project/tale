'use client';

import { cn } from '@tale/ui/cn';
import { Text } from '@tale/ui/text';
import type { MouseEvent } from 'react';

import { useT } from '@/lib/i18n/client';

interface DrilldownButtonProps {
  /** The row's name — the button's text and the object of its accessible name. */
  name: string;
  /** Applies the row's drill-down filter. */
  onSelect: () => void;
  className?: string;
  /** Overrides the label's single-line truncation (e.g. `break-all`). */
  labelClassName?: string;
}

/**
 * The named, keyboard-reachable action a metrics drill-down row carries.
 *
 * `DataTable`'s `onRowClick` is a pointer convenience only — a `<tr>` takes
 * no focus — so a row whose click narrows the page's filter must also offer
 * the same action as a real control ("Keep a named keyboard-accessible link or
 * action in the row", the design system's data-table guide). The button is
 * the row's lead label; activating it stops at the button so the row's own
 * click handler does not apply the filter a second time.
 */
export function DrilldownButton({
  name,
  onSelect,
  className,
  labelClassName,
}: DrilldownButtonProps) {
  const { t } = useT('analytics');
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onSelect();
  };
  return (
    <button
      type="button"
      aria-label={t('aria.filterBy', { name })}
      title={name}
      onClick={handleClick}
      // `min-w-0` lets the flex item shrink so the inner truncation engages
      // instead of pushing into the next column.
      className={cn(
        'focus-visible:ring-ring min-w-0 cursor-pointer rounded-sm text-left hover:underline focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      <Text
        as="span"
        variant="label"
        className={cn('block text-sm', labelClassName ?? 'truncate')}
      >
        {name}
      </Text>
    </button>
  );
}
