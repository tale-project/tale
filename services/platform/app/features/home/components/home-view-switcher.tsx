'use client';

import { cn } from '@tale/ui/cn';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { useRef, type KeyboardEvent } from 'react';

import { useT } from '@/lib/i18n/client';

import type { HomeView } from '../lib/home-items';

export interface HomeViewOption {
  readonly view: HomeView;
  /** Items in this view waiting on the caller — shown as a quiet dot. */
  readonly attention: number;
}

/**
 * All · Chats · Tasks · Inbox — which kind of work the Home stream shows.
 * A radio group in a pill track: the selected option's pill glides under the
 * label instead of blinking between positions, and arrow keys move between
 * options the way a native radio group does.
 */
export function HomeViewSwitcher({
  value,
  options,
  onChange,
}: {
  value: HomeView;
  options: readonly HomeViewOption[];
  onChange: (view: HomeView) => void;
}) {
  const { t } = useT('home');
  const indicator = useSlidingIndicator<HTMLDivElement>(value, options.length);
  const buttonsRef = useRef<Map<HomeView, HTMLButtonElement>>(new Map());

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.view === value);
    const next = options[(index + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.view);
    buttonsRef.current.get(next.view)?.focus();
  };

  return (
    <div
      ref={indicator.containerRef}
      role="radiogroup"
      aria-label={t('views.label')}
      onKeyDown={moveFocus}
      className="bg-muted/70 relative flex h-8 items-center rounded-lg p-0.5"
    >
      <span
        aria-hidden
        style={indicator.style}
        className={cn(
          'bg-background ring-border/60 pointer-events-none absolute top-0 left-0 rounded-md shadow-xs ring-1',
          indicator.animated &&
            '[transition:transform_260ms_var(--ease-out-quint),width_260ms_var(--ease-out-quint),opacity_150ms] motion-reduce:transition-none',
        )}
      />
      {options.map((option) => {
        const selected = option.view === value;
        return (
          <button
            key={option.view}
            ref={(node) => {
              if (node === null) buttonsRef.current.delete(option.view);
              else buttonsRef.current.set(option.view, node);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-indicator-key={option.view}
            onClick={() => onChange(option.view)}
            className={cn(
              'focus-visible:ring-ring relative z-10 flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none',
              selected
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="truncate">{t(`views.${option.view}`)}</span>
            {option.attention > 0 && (
              <span
                aria-label={t('aria.attention', { count: option.attention })}
                className="animate-in zoom-in-50 size-1.5 shrink-0 rounded-full bg-blue-500 duration-300"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
