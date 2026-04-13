'use client';

import { type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { useLocale } from '@/app/hooks/use-locale';

import { i18n } from './i18n';

interface I18nProviderProps {
  children: ReactNode;
}

function LocaleSync() {
  useLocale();
  return null;
}

export function I18nProvider({ children }: I18nProviderProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <LocaleSync />
      {children}
    </I18nextProvider>
  );
}
