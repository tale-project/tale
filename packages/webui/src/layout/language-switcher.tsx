import { cn } from '@tale/ui/cn';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { useT } from '../i18n/client';
import { isUrlPrefixedLocale, type SupportedLocale } from '../i18n/locales';
import { LocaleFlag } from '../icons/flags';

const BASE_LOCALES = [
  'en',
  'de',
  'fr',
] as const satisfies readonly SupportedLocale[];

function appendHashAndSearch(
  url: string,
  search: string | undefined,
  hash: string | undefined,
): string {
  let out = url;
  if (search && search.length > 0 && search !== '?') {
    out += search.startsWith('?') ? search : `?${search}`;
  }
  if (hash && hash.length > 0 && hash !== '#') {
    out += hash.startsWith('#') ? hash : `#${hash}`;
  }
  return out;
}

interface LanguageSwitcherProps {
  /** Compute the destination URL when the user picks a different locale.
   *  Receives the current pathname so each app can apply its own routing
   *  conventions (web uses canonical marketing routes; docs uses the
   *  splat with optional `/de`, `/fr` prefix). Defaults to a prefix-based
   *  resolver that matches both `services/web` and `services/docs`: drop
   *  the existing locale segment and re-prefix non-English. */
  resolveLocaleUrl?: (
    target: SupportedLocale,
    currentPathname: string,
  ) => string;
  /** Optional className passthrough for the trigger button. */
  className?: string;
}

function defaultResolveLocaleUrl(
  target: SupportedLocale,
  pathname: string,
): string {
  const canonical = stripLocalePrefix(pathname);
  if (target === 'en') return canonical;
  return canonical === '/' ? `/${target}` : `/${target}${canonical}`;
}

function stripLocalePrefix(pathname: string): string {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments.length > 0 && isUrlPrefixedLocale(segments[0])) {
    const rest = segments.slice(1).join('/');
    return rest.length > 0 ? `/${rest}` : '/';
  }
  return pathname.length > 0 ? pathname : '/';
}

export { stripLocalePrefix };

function readCurrentLocale(pathname: string): SupportedLocale {
  const first = pathname.split('/').find((s) => s.length > 0);
  if (first && isUrlPrefixedLocale(first)) return first;
  return 'en';
}

/**
 * Cross-app language switcher. The visual + state machinery lives here;
 * each consumer supplies a `resolveLocaleUrl` callback that turns a
 * (target, pathname) pair into the URL to navigate to.
 */
export function LanguageSwitcher({
  resolveLocaleUrl = defaultResolveLocaleUrl,
  className,
}: LanguageSwitcherProps) {
  const { t } = useT('languageSwitcher');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const navigate = useNavigate();
  const currentLocale = readCurrentLocale(pathname);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => {
          const next = (i + 1) % BASE_LOCALES.length;
          itemRefs.current[next]?.focus();
          return next;
        });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => {
          const next = (i - 1 + BASE_LOCALES.length) % BASE_LOCALES.length;
          itemRefs.current[next]?.focus();
          return next;
        });
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = BASE_LOCALES.indexOf(currentLocale);
    const start = idx >= 0 ? idx : 0;
    setActiveIndex(start);
    // Focus the active item once the menu mounts.
    queueMicrotask(() => itemRefs.current[start]?.focus());
  }, [open, currentLocale]);

  const handleSelect = (target: SupportedLocale) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (target === currentLocale) return;
    const base = resolveLocaleUrl(target, pathname);
    const url = appendHashAndSearch(base, searchStr, hash);
    // oxlint-disable-next-line typescript/no-explicit-any -- runtime-typed router target
    void navigate({ to: url } as any);
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
        className="border-border-base bg-bg-base text-fg-muted hover:text-fg-base hover:border-border-strong focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        <LocaleFlag
          locale={currentLocale}
          className="block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
        />
        <span className="text-fg-base">{t(`locales.${currentLocale}`)}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'h-3 w-3 shrink-0 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <ul
          id={menuId}
          role="menu"
          aria-label={t('ariaLabel')}
          className="border-border-base bg-bg-base absolute right-0 z-30 mt-2 flex min-w-[180px] flex-col overflow-hidden rounded-md border py-1 shadow-lg"
        >
          {BASE_LOCALES.map((code, index) => {
            const isActive = code === currentLocale;
            return (
              <li key={code}>
                <button
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => handleSelect(code)}
                  className={cn(
                    'hover:bg-bg-elevated focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                    isActive ? 'text-fg-base font-medium' : 'text-fg-muted',
                  )}
                >
                  <LocaleFlag
                    locale={code}
                    className="block h-3.5 w-5 shrink-0 overflow-hidden rounded-xs shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
                  />
                  <span className="flex-1">{t(`locales.${code}`)}</span>
                  <svg
                    aria-hidden
                    viewBox="0 0 12 12"
                    className={cn(
                      'h-3 w-3 shrink-0 text-current transition-opacity',
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
