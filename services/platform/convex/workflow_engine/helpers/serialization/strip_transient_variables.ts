/**
 * Strip transient keys from workflow variables on execution completion.
 *
 * `lastOutput` and `steps` are intermediate execution state that duplicate
 * data already stored in the execution `output` field and step audit logs.
 * Removing them prevents unbounded variable growth across long-running
 * or frequently-triggered workflows.
 */

const TRANSIENT_KEYS = new Set(['lastOutput', 'steps']);

export function stripTransientVariables(
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const key of Object.keys(variables)) {
    if (!TRANSIENT_KEYS.has(key)) {
      stripped[key] = variables[key];
    }
  }
  return stripped;
}
