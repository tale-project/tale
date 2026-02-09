import { clone, forEach, get, has } from 'lodash';

import { isRecord } from '../../../lib/utils/type-guards';

/**
 * Build evaluation context from variables
 * Merges nested variables and adds built-in values like 'now'
 */
export function buildContext(
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const base = clone(variables);
  const nested = get(variables, 'variables');

  // Backward-compat: expose workflow-level variables at top-level
  if (isRecord(nested)) {
    forEach(nested, (v, k) => {
      if (!has(base, k)) {
        base[k] = v;
      }
    });
  }

  base.now = new Date().toISOString();
  base.nowMs = Date.now();

  return base;
}
