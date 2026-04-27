import { Languages, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import { Tabs, type TabItem } from '@/app/components/ui/navigation/tabs';
import { useT } from '@/lib/i18n/client';
import { SUPPORTED_AGENT_LOCALES } from '@/lib/shared/constants/agents';

/**
 * Shared "source + translation tabs" scaffold for per-locale agent fields.
 *
 * Renders a horizontal tab list (one tab per supported locale) plus an
 * optional auto-translate action. The caller owns the content area inside
 * each tab via `renderContent` — this keeps the component neutral to input
 * primitives (Textarea, Input, ReorderList, etc.).
 *
 * Tab values are locale codes. The default tab (org's `defaultLocale`) is
 * labeled with a "default" pill; non-default tabs with no override show an
 * "untranslated" pill.
 */
interface LocaleTabsProps {
  /** Supported locales; the org's `defaultLocale` is labeled as "default". */
  defaultLocale: string;
  /** Currently-active locale (the tab being edited). */
  editingLocale: string;
  onEditingLocaleChange: (locale: string) => void;
  /**
   * `(locale) => boolean` — when true, the tab for that locale shows the
   * "untranslated" pill (no override present yet). Never called for the
   * default locale.
   */
  hasTranslation: (locale: string) => boolean;
  /**
   * Optional auto-translate button. When `onAutoTranslate` is provided and
   * `editingLocale !== defaultLocale`, renders the button to the right of
   * the tab list.
   */
  onAutoTranslate?: () => void;
  isTranslating?: boolean;
  /** Subtitle rendered below the tab actions (e.g. source length hint). */
  subtitle?: React.ReactNode;
}

export function LocaleTabs({
  defaultLocale,
  editingLocale,
  onEditingLocaleChange,
  hasTranslation,
  onAutoTranslate,
  isTranslating,
  subtitle,
}: LocaleTabsProps) {
  const { t } = useT('settings');
  const { t: tGlobal } = useT('global');

  const localeTabItems = useMemo((): TabItem[] => {
    const tabs: TabItem[] = [];
    tabs.push({
      value: defaultLocale,
      label: (
        <span className="flex items-center gap-1.5">
          {tGlobal(`languages.${defaultLocale}`)}
          <span className="text-muted-foreground text-xs">
            ({t('agents.conversationStarters.default')})
          </span>
        </span>
      ),
    });
    for (const locale of SUPPORTED_AGENT_LOCALES) {
      if (locale === defaultLocale) continue;
      tabs.push({
        value: locale,
        label: (
          <span className="flex items-center gap-1.5">
            {tGlobal(`languages.${locale}`)}
            {!hasTranslation(locale) && (
              <span className="bg-muted text-muted-foreground rounded px-1 py-0.5 text-[10px] leading-none">
                {t('agents.conversationStarters.untranslated')}
              </span>
            )}
          </span>
        ),
      });
    }
    return tabs;
  }, [defaultLocale, hasTranslation, t, tGlobal]);

  const showTranslateButton =
    !!onAutoTranslate && editingLocale !== defaultLocale;

  return (
    <>
      <Tabs
        variant="underline"
        value={editingLocale}
        onValueChange={onEditingLocaleChange}
        items={localeTabItems}
        actions={
          showTranslateButton ? (
            <button
              type="button"
              onClick={onAutoTranslate}
              disabled={isTranslating}
              className="text-muted-foreground hover:text-foreground ml-auto flex shrink-0 items-center gap-1 pb-2 text-sm transition-colors disabled:opacity-50"
            >
              {isTranslating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Languages className="size-3.5" />
              )}
              {t('agents.conversationStarters.autoTranslate')}
            </button>
          ) : undefined
        }
      />
      {subtitle ? (
        <div className="text-muted-foreground text-xs">{subtitle}</div>
      ) : null}
    </>
  );
}
