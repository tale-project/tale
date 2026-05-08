'use client';

import { I18nProvider as I18nProviderBase } from '@tale/ui/i18n/provider';
import { LocaleSync } from '@tale/ui/i18n/sync';
import type { ReactNode } from 'react';

import { useLocale } from '@/app/hooks/use-locale';

import { i18n } from './i18n';

/** Bridges `useLocale()` (localStorage-driven detection) to the shared
 *  `<LocaleSync>` so the i18n instance and `<html lang>` track the user's
 *  saved/detected preference. Web and docs read locale from the URL and call
 *  `<LocaleSync>` directly from their root route — platform's locale lives
 *  in localStorage and needs the hook to read it. */
function LocalePersistence() {
  const { locale } = useLocale();
  return <LocaleSync locale={locale} />;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  return (
    <I18nProviderBase i18n={i18n}>
      <LocalePersistence />
      {children}
    </I18nProviderBase>
  );
}
