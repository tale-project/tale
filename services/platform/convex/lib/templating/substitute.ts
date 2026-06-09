/**
 * Shared `{{variable}}` template-substitution engine.
 *
 * This is the ONE substitution engine for agent/system-prompt-style templates.
 * It is intentionally minimal and runtime-agnostic (pure string + regex, no
 * node-only APIs) so it can be imported from both the default Convex runtime
 * and `'use node'` actions, and bundled without issue.
 *
 * Two surfaces share it:
 *  - `resolve_template_variables.ts` (agent system-prompt `{{user.name}}` vars)
 *  - the prompt registry (`lib/prompts/registry`)
 *
 * NOTE: this is distinct from the workflow engine's `lib/variables/replace_variables.ts`
 * (a heavier Mustache + JEXL engine that evaluates expressions and THROWS on
 * unresolved markers). Do not route registry/system-prompt templates through
 * that engine — the semantics differ (this one preserves unknown markers).
 */

/** Matches `{{ anything-but-a-closing-brace }}`. Global so `.replace`/`matchAll` see every marker. */
const TEMPLATE_VARIABLE_PATTERN = /\{\{([^}]+)\}\}/g;

const PLACEHOLDER_MARKER = '{{';

/** Cheap pre-check so callers can skip work when a string has no markers at all. */
export function containsPlaceholder(text: string): boolean {
  return text.includes(PLACEHOLDER_MARKER);
}

/**
 * Distinct, trimmed placeholder names appearing in `text` (without braces).
 * `{{ user.name }}` and `{{user.name}}` collapse to the same `user.name`.
 */
export function extractPlaceholders(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    out.add(match[1].trim());
  }
  return [...out];
}

/**
 * Replace every `{{name}}` via `resolve(trimmedName)`.
 *
 * When `resolve` returns `undefined`, the original `{{...}}` substring is left
 * intact byte-for-byte (matches the legacy default-branch behavior in
 * `resolve_template_variables.ts`). Returning an empty string is a real
 * substitution and removes the marker.
 *
 * `String.prototype.replace` with a global regex resets `lastIndex` to 0 before
 * scanning, so sharing the module-level `TEMPLATE_VARIABLE_PATTERN` is safe.
 */
export function substituteTemplate(
  text: string,
  resolve: (name: string) => string | undefined,
): string {
  if (!containsPlaceholder(text)) return text;
  return text.replace(TEMPLATE_VARIABLE_PATTERN, (whole, inner: string) => {
    const resolved = resolve(inner.trim());
    return resolved === undefined ? whole : resolved;
  });
}
