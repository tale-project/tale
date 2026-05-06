import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  type ComponentType,
  type SVGProps,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  ChevronDownIcon,
  FlagDE,
  FlagEN,
  FlagFR,
} from '@/app/components/icons/marketing-icons';
import { useT } from '@/lib/i18n/client';
import { isUrlPrefixedLocale, type SupportedLocale } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

const BASE_LOCALES = [
  'en',
  'de',
  'fr',
] as const satisfies readonly SupportedLocale[];

const LOCALE_FLAGS: Record<
  SupportedLocale,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  en: FlagEN,
  de: FlagDE,
  fr: FlagFR,
};

/**
 * Strip the leading `/de` or `/fr` segment from a pathname, leaving the
 * canonical (English) path. Returns `'/'` for the language root itself.
 */
function stripLocalePrefix(pathname: string): string {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments.length > 0 && isUrlPrefixedLocale(segments[0])) {
    const rest = segments.slice(1).join('/');
    return rest.length > 0 ? `/${rest}` : '/';
  }
  return pathname.length > 0 ? pathname : '/';
}

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { t } = useT('languageSwitcher');
  const currentLocale = useCurrentLocale();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search });
  const hash = useRouterState({ select: (s) => s.location.hash });

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
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

  const handleSelect = (target: SupportedLocale) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (target === currentLocale) return;

    const canonical = stripLocalePrefix(pathname);

    // The navigate options have to be assembled outside Tanstack's typed
    // builder: at runtime we're targeting different file-based routes
    // (`/pricing` vs `/$lang/pricing`) depending on the chosen locale,
    // and the `to`/`params`/`search` types are intersected per-route in
    // a way that erases under runtime branching. We forward the current
    // search and hash unchanged so deep-linked filters survive a switch.
    // oxlint-disable-next-line typescript/no-explicit-any -- runtime-built navigation target; see comment above
    const options: any = { hash, search };
    if (target === 'en') {
      options.to = canonical;
    } else {
      options.to = canonical === '/' ? '/$lang' : `/$lang${canonical}`;
      options.params = { lang: target };
    }
    void navigate(options);
  };

  return (
    <div
      ref={containerRef}
      className={`relative${className ? ` ${className}` : ''}`}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('ariaLabel')}
        onClick={() => setOpen((v) => !v)}
        className="border-border-base bg-bg-base text-fg-muted hover:text-fg-base hover:border-border-strong inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-current/20"
      >
        {(() => {
          const Flag = LOCALE_FLAGS[currentLocale];
          return (
            <Flag
              className="block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
              aria-hidden
            />
          );
        })()}
        <span className="text-fg-base">{t(`locales.${currentLocale}`)}</span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          id={menuId}
          aria-label={t('ariaLabel')}
          className="border-border-base bg-bg-base absolute right-0 bottom-full z-20 mb-2 flex min-w-[180px] flex-col overflow-hidden rounded-md border py-1 shadow-lg"
        >
          {BASE_LOCALES.map((code) => {
            const isActive = code === currentLocale;
            const Flag = LOCALE_FLAGS[code];
            return (
              <li key={code}>
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => handleSelect(code)}
                  className={`hover:bg-bg-elevated flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                    isActive ? 'text-fg-base font-medium' : 'text-fg-muted'
                  }`}
                >
                  <Flag
                    className="block h-3.5 w-5 shrink-0 overflow-hidden rounded-xs shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
                    aria-hidden
                  />
                  <span className="flex-1">{t(`locales.${code}`)}</span>
                  <svg
                    aria-hidden
                    viewBox="0 0 12 12"
                    className={`h-3 w-3 shrink-0 text-current transition-opacity ${
                      isActive ? 'opacity-100' : 'opacity-0'
                    }`}
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
