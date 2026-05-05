import {
  type ComponentType,
  type SVGProps,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  ChevronDownIcon,
  FlagDE,
  FlagEN,
  FlagFR,
} from '@/app/components/icons/marketing-icons';
import { useT } from '@/lib/i18n/client';

const BASE_LOCALES = ['en', 'de', 'fr'] as const;
type BaseLocale = (typeof BASE_LOCALES)[number];

const LOCALE_FLAGS: Record<
  BaseLocale,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  en: FlagEN,
  de: FlagDE,
  fr: FlagFR,
};

const REGIONAL_OVERRIDES: ReadonlySet<string> = new Set([
  'de-CH',
  'de-AT',
  'fr-CH',
]);

function getBrowserRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const tag = navigator.language;
  const dash = tag.indexOf('-');
  return dash >= 0 ? tag.slice(dash + 1).toUpperCase() : null;
}

function resolveLocale(base: BaseLocale): string {
  const region = getBrowserRegion();
  if (!region) return base;
  const candidate = `${base}-${region}`;
  return REGIONAL_OVERRIDES.has(candidate) ? candidate : base;
}

function toBaseLocale(language: string): BaseLocale {
  const dash = language.indexOf('-');
  const base = (dash >= 0 ? language.slice(0, dash) : language) as BaseLocale;
  return (BASE_LOCALES as readonly string[]).includes(base) ? base : 'en';
}

interface LanguageSwitcherProps {
  className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
  const { t } = useT('languageSwitcher');
  const { i18n } = useTranslation();
  const currentBase = toBaseLocale(i18n.language);

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

  const handleSelect = (base: BaseLocale) => {
    void i18n.changeLanguage(resolveLocale(base));
    setOpen(false);
    buttonRef.current?.focus();
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
          const Flag = LOCALE_FLAGS[currentBase];
          return (
            <Flag
              className="block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
              aria-hidden
            />
          );
        })()}
        <span className="text-fg-base">{t(`locales.${currentBase}`)}</span>
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
            const isActive = code === currentBase;
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
