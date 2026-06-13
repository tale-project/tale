'use client';

import { Heading } from '@tale/ui/heading';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Text } from '@tale/ui/text';
import { ThemeSwitcher } from '@tale/ui/theme-switcher';
import { useRef, type KeyboardEvent } from 'react';

import { WizardStep } from '@/app/components/ui/wizard/wizard';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

// Language names are shown as autonyms (each in its own language), the
// convention for a language picker — so they need no translation namespace.
const LOCALES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
];

/** Base language subtag of the active locale (e.g. `en-US` → `en`). */
function baseLanguage(locale: string): string {
  try {
    return new Intl.Locale(locale).language ?? locale;
  } catch (error) {
    console.warn('Failed to parse locale tag:', locale, error);
    return locale;
  }
}

/**
 * First-run preferences: language + theme. Both persist to localStorage via
 * their respective providers and apply live, so there's nothing to gate — the
 * step is always valid and has no `onBeforeNext`.
 */
export function PreferencesStep() {
  const { t } = useT('onboarding');
  const { locale, setLocale } = useLocale();
  const active = baseLanguage(locale);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIndex = LOCALES.findIndex(({ code }) => code === active);
  // Roving tabindex: the active radio is the group's single tab stop. If the
  // stored locale matches no option, fall back to the first so the group stays
  // keyboard-reachable.
  const tabbableIndex = activeIndex >= 0 ? activeIndex : 0;

  // ARIA radiogroup keyboard model: arrows/Home/End move focus AND selection
  // (radios select on focus), wrapping at the ends.
  const onLanguageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextIndex = tabbableIndex;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (tabbableIndex + 1) % LOCALES.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (tabbableIndex - 1 + LOCALES.length) % LOCALES.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = LOCALES.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setLocale(LOCALES[nextIndex].code);
    radioRefs.current[nextIndex]?.focus();
  };

  return (
    <WizardStep id="preferences">
      <Heading level={2} className="text-base">
        {t('preferences.heading')}
      </Heading>
      <Text variant="muted">{t('preferences.why')}</Text>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-fg-base mb-1 text-sm font-medium">
          {t('preferences.languageLabel')}
        </legend>
        <div
          role="radiogroup"
          aria-label={t('preferences.languageLabel')}
          className="flex flex-wrap gap-2"
          onKeyDown={onLanguageKeyDown}
        >
          {LOCALES.map(({ code, label }, index) => {
            const isActive = active === code;
            return (
              <button
                key={code}
                ref={(el) => {
                  radioRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={isActive}
                tabIndex={index === tabbableIndex ? 0 : -1}
                onClick={() => setLocale(code)}
                className={cn(
                  'focus-visible:ring-ring rounded-md border px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  isActive
                    ? 'border-accent-base bg-accent-base/10 text-fg-base font-medium'
                    : 'border-border-strong text-fg-muted hover:text-fg-base hover:border-border-strong',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-fg-base mb-1 text-sm font-medium">
          {t('preferences.themeLabel')}
        </legend>
        <ThemeSwitcher variant="segmented" />
      </fieldset>
    </WizardStep>
  );
}
