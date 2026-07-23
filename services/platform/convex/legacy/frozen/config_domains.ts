/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * `v0_3_4/33_workflows_become_automations/migration.ts` looks up the
 * `'automations'` config domain via `getConfigDomain('automations')` and
 * passes the descriptor to `seedDomain` (`convex/organizations/scaffold.ts`).
 * The LIVE registry (`lib/shared/config/registry.ts`) is interim-minimal —
 * only `governance` + `sso` are registered (the domains live non-AI features
 * still read) — so `getConfigDomain('automations')` against it throws
 * `Unknown config domain: automations`, which would misfire on every
 * genuinely-old deployment running this migration, not just the very-old
 * ones `seedDomain` itself is expected to refuse: `scaffold.ts`'s own interim
 * doc comment confirms it implements only `scaffoldKind: 'flat'` and throws
 * `domain kind '${domain.scaffoldKind}' is not seedable until the …` for
 * `bundle`/`tree` (which `'automations'` is) — the "will throw on very old
 * deployments by design" the task brief calls out.
 *
 * This module exports the single `'automations'` entry, with its VALUES
 * copied faithfully from
 * the pre-rewrite registry's own entry (`name: 'automations'`,
 * `readContext: 'node-direct'`, `dataModel: 'runtime-state'`,
 * `scaffoldKind: 'bundle'`) — but typed against the LIVE, narrower
 * `ConfigDomain` (imported from `lib/shared/config/registry.ts`, read-only,
 * same as `organizations/scaffold.ts` itself does) rather than a redeclared
 * old-shaped interface, so it type-checks as an argument to the real
 * `seedDomain`. The old entry's richer `layout: 'bundle'` and
 * `nestedBundles: { markers: [AUTOMATION_MANIFEST_FILENAME,
 * BUNDLE_MANIFEST_FILENAME], maxDepth: MAX_AUTOMATION_SLUG_DEPTH }` fields
 * have no home on the live type (interim `seedDomain` never reads them — it
 * only reads `.name` and `.scaffoldKind`) and are dropped rather than
 * force-fitted; when Phase-1 re-expands the live registry with the
 * bundle/tree scaffoldKind branches (see the note in `scaffold.ts`),
 * whoever lands that work re-derives them from
 * the pre-rewrite registry's `'automations'` entry directly. The
 * migration's `import { getConfigDomain } from …` is repointed here — an
 * IMPORT PATH change only; the call site (`getConfigDomain('automations')`)
 * is untouched.
 */

import type { ConfigDomain } from '../../../lib/shared/config/registry';

/**
 * First-class automations: each `automations/<slug>/` is a bundle (manifest
 * with the inline workflow + views/scripts + the automation's own scoped
 * agents), copied whole into every org at create. Read directly from disk,
 * so it is NOT mirrored into `configCache`. The DB `automationInstallations`
 * row is the authoritative "installed" signal; the seeded files are the
 * install SOURCE. Value-faithful copy of the pre-rewrite registry's
 * `'automations'` entry, minus the fields
 * the live `ConfigDomain` has no place for (see module header).
 */
const AUTOMATIONS_DOMAIN: ConfigDomain = {
  name: 'automations',
  readContext: 'node-direct',
  dataModel: 'runtime-state',
  scaffoldKind: 'bundle',
};

const CONFIG_DOMAINS_BY_NAME: ReadonlyMap<string, ConfigDomain> = new Map([
  [AUTOMATIONS_DOMAIN.name, AUTOMATIONS_DOMAIN],
]);

/** Look up a domain by name, throwing if it is not registered. */
export function getConfigDomain(name: string): ConfigDomain {
  const domain = CONFIG_DOMAINS_BY_NAME.get(name);
  if (!domain) {
    throw new Error(`Unknown config domain: ${name}`);
  }
  return domain;
}
