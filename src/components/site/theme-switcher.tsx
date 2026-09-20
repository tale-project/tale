import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import { useTheme } from '@tale/ui/theme';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { useDropdownPlacement } from '../../hooks/use-dropdown-placement';

// 3 menu items × ~40px row + ~8px padding ≈ 130px; round up so the flip
// trigger fires a hair early rather than late.
const THEME_MENU_HEIGHT = 144;

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
   *  renders the three options inline as a pill with the active option
   *  highlighted — used by the marketing footer per design. */
  variant?: 'menu' | 'segmented';
}

/**
 * Three-way theme switcher (light / dark / system). Two visual variants
 * sharing the same `useTheme` wiring:
 *  - `menu`: icon button that opens a dropdown of options.
 *  - `segmented`: pill-style segmented control with all three icons
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

// Pill geometry: each option button is 26×26 with a 3px gap and 3px outer
// padding. The sliding indicator translates by (button + gap) per step.
const SEGMENT_STEP_PX = 26 + 3;

function SegmentedThemeSwitcher({ className }: { className?: string }) {
  const { t } = useT('themeSwitcher');
  const { theme, setTheme } = useTheme();
  const activeIndex = Math.max(0, SEGMENTED_ORDER.indexOf(theme));
  return (
    <div
      role="radiogroup"
      aria-label={t('ariaLabel')}
      className={cn(
        'bg-bg-muted relative inline-flex items-center gap-[3px] rounded-full p-[3px]',
        className,
      )}
    >
      <span
        aria-hidden
        className="bg-bg-base pointer-events-none absolute top-[3px] left-[3px] size-[26px] rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none dark:bg-[#404045] dark:shadow-[0_1px_4px_rgba(0,0,0,0.25)]"
        style={{ transform: `translateX(${activeIndex * SEGMENT_STEP_PX}px)` }}
      />
      {SEGMENTED_ORDER.map((option) => {
        const Icon = ICONS[option];
        const isActive = theme === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={t(option)}
            onClick={() => setTheme(option)}
            className={cn(
              'focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-muted relative inline-flex size-[26px] cursor-pointer items-center justify-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none',
              isActive
                ? 'text-fg-base'
                : 'text-fg-muted hover:text-fg-base dark:hover:text-fg-base dark:text-[#6b7280]',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
          </button>
        );
      })}
    </div>
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
        className="border-border-base bg-bg-base text-fg-muted hover:text-fg-base hover:border-border-strong focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base inline-flex size-9 cursor-pointer items-center justify-center rounded-md border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
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
            'border-border-base bg-bg-base absolute right-0 z-30 flex min-w-40 flex-col overflow-hidden rounded-md border py-1 shadow-lg',
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {ORDER.map((option) => {
            const Icon = ICONS[option];
            const isActive = theme === option;
            return (
              <li key={option}>
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
                    'hover:bg-bg-elevated focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                    isActive ? 'text-fg-base font-medium' : 'text-fg-muted',
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
