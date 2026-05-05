import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Namespace } from './types';

export function useT<N extends Namespace>(namespace: N): { t: TFunction } {
  const { t } = useTranslation(namespace);
  return { t };
}
