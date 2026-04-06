'use client';

import { type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export interface LocaleTab {
  locale: string;
  isDefault: boolean;
}

interface LocaleTabsProps {
  tabs: LocaleTab[];
  activeLocale: string | null;
  onLocaleChange: (locale: string | null) => void;
  disabled?: boolean;
  hasContent?: (locale: string) => boolean;
  defaultLabel?: string;
  untranslatedLabel?: string;
  actions?: ReactNode;
  className?: string;
}

export function LocaleTabs({
  tabs,
  activeLocale,
  onLocaleChange,
  disabled,
  hasContent,
  defaultLabel,
  untranslatedLabel,
  actions,
  className,
}: LocaleTabsProps) {
  const { t: tGlobal } = useT('global');

  return (
    <div
      role="tablist"
      className={cn(
        'scrollbar-hide border-border flex items-center gap-4 overflow-x-auto border-b',
        className,
      )}
    >
      {tabs.map(({ locale, isDefault }) => {
        const active = isDefault
          ? activeLocale === null
          : activeLocale === locale;
        return (
          <button
            key={locale}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onLocaleChange(isDefault ? null : locale)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 whitespace-nowrap pb-2 text-sm font-medium transition-colors',
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tGlobal(`languages.${locale}`)}
            {isDefault && defaultLabel && (
              <span className="text-muted-foreground text-xs">
                ({defaultLabel})
              </span>
            )}
            {!isDefault &&
              untranslatedLabel &&
              hasContent &&
              !hasContent(locale) && (
                <span className="bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px] leading-none">
                  {untranslatedLabel}
                </span>
              )}
            {active && (
              <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
            )}
          </button>
        );
      })}

      {actions}
    </div>
  );
}
