'use client';

import { useT as useTBase } from '@tale/ui/i18n/client';
import type { TFunction } from 'i18next';

import type { Namespace } from './types';

/** Typed wrapper that constrains the namespace to the platform message tree. */
export function useT(namespace: Namespace): { t: TFunction } {
  return useTBase(namespace);
}
