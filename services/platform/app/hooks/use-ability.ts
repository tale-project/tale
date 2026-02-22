import { useContext } from 'react';

import { AbilityContext } from '@/app/context/ability-context';

export function useAbility() {
  return useContext(AbilityContext);
}
