import { cn } from '@tale/ui/cn';
import { X, type LucideIcon } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

export interface SecretsFilterChip {
  key: string;
  /** The mark of what is filtered by, when it has one (the kind of secret). */
  icon?: LucideIcon;
  /** What the filter is: "Type". */
  filter: string;
  /** What it is set to: "Credentials". */
  value: string;
  onRemove: () => void;
}

interface SecretsFilterChipsProps {
  chips: readonly SecretsFilterChip[];
}

/**
 * The filters in force, each a button that lifts it. They sit under the search
 * and the Filter button, so what narrows the list is read without opening the
 * panel; the panel's own "Clear all" and the toolbar's lift all of them.
 */
export function SecretsFilterChips({ chips }: SecretsFilterChipsProps) {
  const { t } = useT('secrets');
  if (chips.length === 0) return null;

  return (
    <ul
      aria-label={t('filters.active')}
      className="flex w-full min-w-0 flex-wrap items-center gap-2"
    >
      {chips.map(({ key, icon: Icon, filter, value, onRemove }) => {
        const text = t('filters.chip', { filter, value });
        return (
          <li key={key} className="flex max-w-full min-w-0">
            <button
              type="button"
              onClick={onRemove}
              title={text}
              aria-label={t('filters.remove', { chip: text })}
              className={cn(
                'border-border bg-background text-foreground inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium',
                'hover:bg-muted transition-colors duration-[var(--duration-short)] motion-reduce:transition-none',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              )}
            >
              {Icon === undefined ? null : (
                <Icon
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 truncate">{text}</span>
              <X
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden="true"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
