import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { SUPPORTED_LOCALES } from '@tale/ui/i18n/locales';
import { Select } from '@tale/ui/select';
import { Text } from '@tale/ui/text';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

import { useT } from '@/lib/i18n/client';

/**
 * The panel's title strip.
 *
 * Deliberately not the platform's `AdaptiveHeader`: that machinery exists to
 * portal a page's chrome into a shared shell across breakpoints, and this
 * service is one screen with no shell. The language picker is the
 * client-locale counterpart of the URL-driven `LanguageSwitcher` — this panel
 * is served as one untranslated tree, so it carries no locale in its paths
 * and the choice is a preference rather than a destination.
 */
export function PanelHeader() {
  const { t } = useT('panel');
  const { t: tGlobal } = useT('global');
  const { locale, setLocale } = useLocale();
  const languages = SUPPORTED_LOCALES.map((code) => ({
    value: code,
    label: tGlobal(`languages.${code}`),
  }));
  // A regional variant (`de-CH`) is a message override, not a pickable
  // language, so the control shows its base locale as the selection.
  const selected = languages.find((language) => language.value === locale);

  return (
    <div className="border-border-base flex items-end gap-4 border-b px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <Heading level={1} size="base">
          {t('title')}
        </Heading>
        <Text className="truncate" variant="caption">
          {t('subtitle')}
        </Text>
      </div>
      <div className="ml-auto flex shrink-0 items-end gap-3">
        <Select
          className="w-36"
          label={t('languageLabel')}
          onValueChange={setLocale}
          options={languages}
          value={selected?.value ?? 'en'}
        />
        <ThemeSwitcher />
      </div>
    </div>
  );
}
