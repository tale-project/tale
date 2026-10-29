'use client';

import { Languages, Loader2 } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { useT } from '../../i18n/client';
import { SUPPORTED_LOCALES } from '../../i18n/locales';
import { Tabs, type TabItem } from './tabs';

interface LocaleTabsProps {
  /**
   * The source locale: its tab comes first and is labelled "default". The
   * other locales are its translations.
   */
  defaultLocale: string;
  /** The locales to offer, in order. @default SUPPORTED_LOCALES */
  locales?: readonly string[];
  /** Currently-active locale (the tab being edited). */
  editingLocale: string;
  onEditingLocaleChange: (locale: string) => void;
  /**
   * `(locale) => boolean` — returns true when a translation exists for the
   * given locale. When false, the tab shows an "untranslated" pill. Never
   * called for the default locale.
   */
  hasTranslation: (locale: string) => boolean;
  /**
   * `(locale) => boolean` — returns true when that locale's editor holds a
   * validation error. Its tab then carries an error mark, so a problem in a
   * hidden panel stays findable while the save controls refuse to act.
   */
  hasError?: (locale: string) => boolean;
  /**
   * Optional auto-translate button. When `onAutoTranslate` is provided and
   * `editingLocale !== defaultLocale`, renders the button to the right of
   * the tab list.
   */
  onAutoTranslate?: () => void;
  isTranslating?: boolean;
  /** Subtitle rendered below the tab list (e.g. a source length hint). */
  subtitle?: ReactNode;
  /**
   * Render a locale's editor. Each renders inside its own tab panel, which
   * stays mounted while hidden, so form fields keep their registration and
   * drafts across tab switches. Required: a tab must control a real panel —
   * an editor rendered outside the component leaves every tab pointing at a
   * panel that does not exist.
   */
  renderPanel: (locale: string) => ReactNode;
  /** Accessible name for the tab list, when no adjacent heading names it. */
  listAriaLabel?: string;
}

/**
 * Shared "source + translation tabs" scaffold for per-locale fields.
 *
 * Renders a horizontal tab list (one tab per locale), one panel per locale,
 * and an optional auto-translate action. The component stays neutral to the
 * input primitives used (Textarea, Input, reorderable lists, …) and to the
 * domain: the caller supplies each locale's editor through `renderPanel`.
 *
 * Tab values are locale codes, labelled with the language's own name. The
 * default tab (caller-supplied `defaultLocale`) is labelled with a "default"
 * pill; non-default tabs with no translation show an "untranslated" pill.
 */
export function LocaleTabs({
  defaultLocale,
  locales = SUPPORTED_LOCALES,
  editingLocale,
  onEditingLocaleChange,
  hasTranslation,
  hasError,
  onAutoTranslate,
  isTranslating,
  subtitle,
  renderPanel,
  listAriaLabel,
}: LocaleTabsProps) {
  const { t } = useT('common');
  // Language names are locale-invariant ("Deutsch" in every interface).
  const { t: tLanguages } = useT('languageSwitcher');

  const localeTabItems = useMemo((): TabItem[] => {
    const errorMark = (locale: string) =>
      hasError?.(locale) ? (
        <>
          <span aria-hidden className="bg-destructive size-1.5 rounded-full" />
          <span className="sr-only">{t('localeTabs.hasError')}</span>
        </>
      ) : null;
    const tabs: TabItem[] = [
      {
        value: defaultLocale,
        label: (
          <span className="flex items-center gap-1.5">
            {tLanguages(`locales.${defaultLocale}`)}
            <span className="text-muted-foreground text-xs">
              ({t('localeTabs.default')})
            </span>
            {errorMark(defaultLocale)}
          </span>
        ),
        content: renderPanel(defaultLocale),
      },
    ];
    for (const locale of locales) {
      if (locale === defaultLocale) continue;
      tabs.push({
        value: locale,
        label: (
          <span className="flex items-center gap-1.5">
            {tLanguages(`locales.${locale}`)}
            {!hasTranslation(locale) && (
              <span className="bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px] leading-none">
                {t('localeTabs.untranslated')}
              </span>
            )}
            {errorMark(locale)}
          </span>
        ),
        content: renderPanel(locale),
      });
    }
    return tabs;
  }, [
    defaultLocale,
    hasError,
    hasTranslation,
    locales,
    renderPanel,
    t,
    tLanguages,
  ]);

  const showTranslateButton =
    !!onAutoTranslate && editingLocale !== defaultLocale;

  return (
    <Tabs
      variant="underline"
      value={editingLocale}
      onValueChange={onEditingLocaleChange}
      items={localeTabItems}
      keepMounted
      // Language names plus pills can outgrow a phone-width row; a language
      // that no longer fits moves into the menu instead of being clipped.
      overflowMenu
      overflowMenuLabel={t('aria.moreTabs')}
      {...(listAriaLabel !== undefined ? { listAriaLabel } : {})}
      actions={
        showTranslateButton ? (
          <button
            type="button"
            onClick={onAutoTranslate}
            disabled={isTranslating}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto flex shrink-0 items-center gap-1 rounded-sm pb-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            {isTranslating ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Languages aria-hidden className="size-3.5" />
            )}
            {t('localeTabs.autoTranslate')}
          </button>
        ) : undefined
      }
      toolbar={
        subtitle ? (
          <div className="text-muted-foreground text-xs">{subtitle}</div>
        ) : undefined
      }
    />
  );
}
