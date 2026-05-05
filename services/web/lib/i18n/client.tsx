import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

export function useT(namespace: string): { t: TFunction } {
  const { t } = useTranslation(namespace);
  return { t };
}
