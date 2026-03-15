import { clone } from 'lodash';

/**
 * Build evaluation context from variables
 * Adds built-in values like 'now'
 */
export function buildContext(
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const base = clone(variables);

  base.now = new Date().toISOString();
  base.nowMs = Date.now();

  return base;
}
