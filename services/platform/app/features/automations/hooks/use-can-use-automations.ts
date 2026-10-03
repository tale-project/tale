import { useAbility } from '@/app/hooks/use-ability';

import { canUseAutomations } from '../lib/access';

/** The viewer's side of {@link canUseAutomations}. */
export function useCanUseAutomations(): boolean {
  return canUseAutomations(useAbility());
}
