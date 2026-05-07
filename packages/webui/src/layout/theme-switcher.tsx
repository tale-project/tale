import { cn } from '@tale/ui/cn';
import { useTheme } from '@tale/ui/theme';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { useT } from '../i18n/client';

type Theme = 'light' | 'dark' | 'system';

const ORDER: readonly Theme[] = ['light', 'dark', 'system'];

const ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const;

interface ThemeSwitcherProps {
  className?: string;
}

/**
 * Three-way theme switcher (light / dark / system). Renders an icon-only
 * trigger that mirrors the active theme; clicking opens a small menu so
 * the user can pick explicitly. Reads `useTheme` from `@tale/ui/theme`,
 * so the surrounding `<ThemeProvider>` owns persistence.
 *
 * Translatable labels live under the `themeSwitcher` namespace:
 *   { ariaLabel, light, dark, system }.
 */
export function ThemeSwitcher({ className }: ThemeSwitcherProps) {
  const { t } = useT('themeSwitcher');
  const { theme, setTheme } = useTheme();
  const ActiveIcon = ICONS[theme as Theme] ?? Monitor;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
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
    const activeIndex = ORDER.indexOf(theme as Theme);
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
          className="border-border-base bg-bg-base absolute right-0 z-30 mt-2 flex min-w-[160px] flex-col overflow-hidden rounded-md border py-1 shadow-lg"
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
                      'h-3 w-3 shrink-0 transition-opacity',
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
