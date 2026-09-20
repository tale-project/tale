import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

/**
 * `useT(namespace)` returns the i18next `t` function bound to the given
 * namespace. The namespace type is left open so each app can constrain it
 * with its own message bundle types via a typed wrapper.
 */
export function useT(namespace: string): { t: TFunction } {
  const { t } = useTranslation(namespace);
  return { t };
}
