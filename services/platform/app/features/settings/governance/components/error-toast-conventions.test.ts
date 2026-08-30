import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Guardrail (#2669): a governance save/restore failure must never surface a
 * thrown error's raw `.message` — for a `AppError` re-thrown by the
 * Convex client that's a dev-facing `[CONVEX A(...)] {"code":…}` hybrid
 * stacktrace string, never a user-facing message. Every catch block in this
 * directory must route the caught error through `mapGovernanceSaveError` (or
 * this area's other dedicated mapper — `mapLegalHoldError` /
 * `mapDsarPolicyError` — for the sibling subtrees) instead of the
 * `err instanceof Error ? err.message : …` guard that always took the raw
 * branch (see `../governance-save-errors.ts` for the full rationale).
 *
 * Pure source-walk (no DOM), mirroring `skeleton-conventions.test.ts`.
 */
const COMPONENTS_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Files deliberately exempt, with why:
 *
 * - `moderation-test-connection-panel.tsx`: the "Test connection" action is
 *   an intentional diagnostic surface (like a curl error), not a save/restore
 *   toast — its inline `hint` field is SUPPOSED to show the real failure
 *   detail (timeout, DNS, invalid JSON, …) so the admin can debug their
 *   endpoint config. Routing it through a generic localized fallback would
 *   defeat the feature.
 */
const EXEMPT = new Set(['moderation-test-connection-panel.tsx']);

function listEditorSources(): string[] {
  return readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) &&
        !e.name.endsWith('.test.tsx') &&
        !e.name.endsWith('.test.ts') &&
        !e.name.endsWith('.stories.tsx') &&
        !EXEMPT.has(e.name),
    )
    .map((e) => e.name);
}

// `err instanceof Error ? err.message : …` (any catch-variable name, any
// whitespace/newlines in between) — the exact anti-pattern this directory's
// mappers were introduced to replace.
const RAW_ERROR_MESSAGE_GUARD =
  /\b\w+\s+instanceof\s+Error\s*\?\s*\w+\.message\b/;

describe('governance error-toast conventions', () => {
  const files = listEditorSources();

  it('finds the governance editor sources', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)(
    '%s does not surface a raw `err.message` via the `instanceof Error` guard',
    (name) => {
      const src = readFileSync(join(COMPONENTS_DIR, name), 'utf8');
      const matched = RAW_ERROR_MESSAGE_GUARD.test(src);
      expect(
        matched,
        `${name} surfaces a caught error's raw \`.message\` via the ` +
          '`err instanceof Error ? err.message : …` guard. Route it through ' +
          "`mapGovernanceSaveError` (or this subtree's dedicated mapper) instead " +
          '— see governance-save-errors.ts for why the raw branch always fires.',
      ).toBe(false);
    },
  );
});
