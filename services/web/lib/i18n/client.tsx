import { useT as useTBase } from '@tale/webui/i18n/client';
import type { TFunction } from 'i18next';

import type { Namespace } from './types';

/** Typed wrapper that constrains the namespace to the marketing message tree. */
export function useT<N extends Namespace>(namespace: N): { t: TFunction } {
  return useTBase(namespace);
}
