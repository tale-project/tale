import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { useTheme } from '@tale/ui/theme';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { useDropdownPlacement } from '../../hooks/use-dropdown-placement';

// Three 44px rows, padding, border and the 8px trigger gap; round up.
const THEME_MENU_HEIGHT = 152;

type Theme = 'light' | 'dark' | 'system';

const ORDER: readonly Theme[] = ['light', 'dark', 'system'];
const SEGMENTED_ORDER: readonly Theme[] = ['system', 'light', 'dark'];

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

interface ThemeSwitcherProps {
  className?: string;
  /** `'menu'` (default) renders an icon button + dropdown picker. `'segmented'`
   *  renders the three options inline with the active option
   *  highlighted — used by the marketing footer per design. */
  variant?: 'menu' | 'segmented';
}

/**
 * Three-way theme switcher (light / dark / system). Two visual variants
 * sharing the same `useTheme` wiring:
 *  - `menu`: icon button that opens a dropdown of options.
 *  - `segmented`: a segmented radio group with all three icons
 *    visible at once.
 *
 * Translatable labels live under the `themeSwitcher` namespace:
 *   { ariaLabel, light, dark, system }.
 */
export function ThemeSwitcher({
  className,
  variant = 'menu',
}: ThemeSwitcherProps) {
  return variant === 'segmented' ? (
    <SegmentedThemeSwitcher className={className} />
  ) : (
    <MenuThemeSwitcher className={className} />
  );
}

function SegmentedThemeSwitcher({ className }: { className?: string }) {
  const { t } = useT('themeSwitcher');
  const { theme, setTheme } = useTheme();
  return (
    <RadioGroupPrimitive.Root
      aria-label={t('ariaLabel')}
      orientation="horizontal"
      loop
      value={theme}
      onValueChange={(value) => {
        const next = SEGMENTED_ORDER.find((option) => option === value);
        if (next) setTheme(next);
      }}
      className={cn(
        'border-border-base bg-bg-muted inline-flex shrink-0 items-center gap-0.5 rounded-xl border p-0.5',
        className,
      )}
    >
      {SEGMENTED_ORDER.map((option) => {
        const Icon = ICONS[option];
        return (
          <RadioGroupPrimitive.Item
            key={option}
            value={option}
            aria-label={t(option)}
            title={t(option)}
            // Selection follows the roving focus even when a quick arrow key
            // is released before Radix's deferred focus movement completes.
            onFocus={() => setTheme(option)}
            className="text-fg-muted hover:text-fg-base focus-visible:outline-fg-base data-[state=checked]:border-border-base data-[state=checked]:bg-bg-base data-[state=checked]:text-fg-base relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent transition-colors duration-150 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 data-[state=checked]:shadow-sm motion-reduce:transition-none pointer-coarse:size-11"
          >
            <Icon aria-hidden className="size-4" strokeWidth={1.75} />
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

function MenuThemeSwitcher({ className }: { className?: string }) {
  const { t } = useT('themeSwitcher');
  const { theme, setTheme } = useTheme();
  const ActiveIcon = ICONS[theme] ?? Monitor;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const menuId = useId();
  const placement = useDropdownPlacement(open, buttonRef, THEME_MENU_HEIGHT);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- DOM event target is always a Node in pointerdown
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // When the menu opens, move focus to the active item so Arrow keys work
  // immediately and screen readers announce the menu.
  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitemradio"]',
    );
    if (!items || items.length === 0) return;
    const activeIndex = ORDER.indexOf(theme);
    const target = items[activeIndex >= 0 ? activeIndex : 0];
    target?.focus();
  }, [open, theme]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitemradio"]',
    );
    if (!items || items.length === 0) return;
    const list = Array.from(items);
    const currentIndex = list.indexOf(
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- list items are HTMLButtonElement; activeElement is one of them or not in list
      document.activeElement as HTMLButtonElement,
    );
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = list[(currentIndex + 1 + list.length) % list.length];
      next?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = list[(currentIndex - 1 + list.length) % list.length];
      prev?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      list[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      list[list.length - 1]?.focus();
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('ariaLabel')}
        onClick={() => setOpen((v) => !v)}
        className="border-border-base bg-bg-base text-fg-muted hover:text-fg-base hover:border-border-strong focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transition-none pointer-coarse:size-11"
      >
        <ActiveIcon aria-hidden className="size-4" />
      </button>
      {open ? (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('ariaLabel')}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'border-border-base bg-bg-base absolute right-0 z-30 flex min-w-40 flex-col rounded-xl border p-1 shadow-lg',
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {ORDER.map((option) => {
            const Icon = ICONS[option];
            const isActive = theme === option;
            return (
              // `role="none"`: see the note in `language-switcher.tsx` —
              // a listitem between `menu` and `menuitemradio` breaks the
              // required parent/child pairing.
              <li key={option} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    setTheme(option);
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
                  className={cn(
                    'hover:bg-bg-elevated focus-visible:bg-bg-muted focus-visible:outline-fg-base flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 motion-reduce:transition-none',
                    isActive
                      ? 'bg-bg-muted text-fg-base font-medium'
                      : 'text-fg-muted',
                  )}
                >
                  <Icon aria-hidden className="size-3.5 shrink-0" />
                  <span className="flex-1">{t(option)}</span>
                  <svg
                    aria-hidden
                    viewBox="0 0 12 12"
                    className={cn(
                      'h-3 w-3 shrink-0 transition-opacity motion-reduce:transition-none',
                      isActive ? 'opacity-100' : 'opacity-0',
                    )}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.5L5 9L9.5 3.5" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
