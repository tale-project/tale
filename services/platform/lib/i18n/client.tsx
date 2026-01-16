'use client';

import { useTranslation } from 'react-i18next';
import type { Namespace } from './types';

export function useT<N extends Namespace>(namespace: N) {
  const { t } = useTranslation(namespace);
  return { t };
}

export function useLocale() {
  const { i18n } = useTranslation();
  return i18n.language;
}
