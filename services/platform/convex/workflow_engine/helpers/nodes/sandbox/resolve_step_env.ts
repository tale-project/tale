/**
 * Resolve a sandbox step's declared `env` map against the live execution
 * variables, returning a plain `{ name: value }` map of strings ready to inject
 * into the run's sandbox. Each value is run through the engine's `{{...}}`
 * templating (`replaceVariables`), so an author can reference a decrypted
 * workflow secret (`{{secrets.MY_KEY}}`) or a runtime value (`{{input.task._id}}`)
 * — the same vocabulary every other step config uses. A value that fails to
 * resolve (e.g. an unconfigured secret) is skipped with a warning rather than
 * killing the whole run; non-string results are coerced to strings (env is
 * string-only). Pure (no I/O) so it is unit-testable in isolation.
 */
import { replaceVariables } from '../../../../lib/variables/replace_variables';

export function resolveStepEnv(
  env: Record<string, string> | undefined,
  variables: Record<string, unknown>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  if (!env) return resolved;
  for (const [name, template] of Object.entries(env)) {
    try {
      const value = replaceVariables(template, variables);
      if (value === undefined || value === null) continue;
      resolved[name] = typeof value === 'string' ? value : String(value);
    } catch (err) {
      // A bad/unresolved template (e.g. a missing secret) skips just that var
      // — log, never silently swallow, and never inject a half-rendered value.
      console.warn(
        `[sandbox-env] skipping env "${name}": failed to resolve template`,
        err,
      );
    }
  }
  return resolved;
}
