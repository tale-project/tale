import type { DeploymentColor } from '../compose/types';

export function getNextColor(current: DeploymentColor | null): DeploymentColor {
  if (current === 'blue') {
    return 'green';
  }
  return 'blue';
}
