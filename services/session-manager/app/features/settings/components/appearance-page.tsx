import { useLocale } from '@tale/ui/i18n/locale-provider';
import { LanguageSwitcher } from '@tale/ui/language-switcher';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';

import { useT } from '@/lib/i18n/client';

import { SettingsRow } from './settings-row';
import { SettingsSection } from './settings-section';

/**
 * Settings > Appearance: the theme and the language. Both belong to this
 * device, not to the app: they are stored here and apply at once, so the page
 * has nothing to save (the header shows no Save and Discard) and says so.
 */
export function AppearancePage() {
  const { t } = useT('settings');
  // The language the page shows, which differs from the one picked only while
  // the picked one loads.
  const { shownLocale, setLocale } = useLocale();

  return (
    <SettingsSection
      title={t('appearance.browser.title')}
      description={t('appearance.browser.description')}
      gap={6}
    >
      <SettingsRow
        label={t('appearance.theme.label')}
        description={t('appearance.theme.description')}
      >
        {/* The control column stretches what it holds; these two are as wide as their options. */}
        <ThemeSwitcher variant="segmented" className="self-start" />
      </SettingsRow>
      <SettingsRow
        label={t('appearance.language.label')}
        description={t('appearance.language.description')}
      >
        <LanguageSwitcher
          value={shownLocale}
          onSelect={setLocale}
          // The menu opens from the trigger's left edge: the trigger sits at
          // the left of its column, where the menu's own right alignment ran
          // off the left edge of a phone. A gap in the library (it has no
          // `align`), reached by selector until it has one.
          className="self-start [&>ul]:right-auto [&>ul]:left-0"
        />
      </SettingsRow>
    </SettingsSection>
  );
}
