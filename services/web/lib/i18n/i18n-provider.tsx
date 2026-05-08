import { I18nProvider as I18nProviderBase } from '@tale/ui/i18n/provider';
import type { ReactNode } from 'react';

import { i18n } from './i18n';

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nProviderBase i18n={i18n}>{children}</I18nProviderBase>;
}
