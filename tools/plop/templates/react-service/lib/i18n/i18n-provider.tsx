import { I18nProvider as I18nProviderBase } from '@tale/ui/i18n/provider';
import type { ReactNode } from 'react';

import { i18n } from './i18n';

/**
 * Wraps the shared base provider with this service's i18n instance. Mount
 * `<LocaleSync locale={...} />` from `@tale/ui/i18n/sync` somewhere inside
 * to keep the i18n instance and `<html lang>` aligned with whatever drives
 * locale in this service (URL param, route loader, saved preference, …).
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nProviderBase i18n={i18n}>{children}</I18nProviderBase>;
}
