import { useContext } from 'react';

import {
  AbilityContext,
  AbilityLoadingContext,
} from '@/app/context/ability-context';

export function useAbility() {
  return useContext(AbilityContext);
}

/** Whether the role backing the ability is still being loaded. */
export function useAbilityLoading() {
  return useContext(AbilityLoadingContext);
}
