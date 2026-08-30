'use node';

import {
  loadAutomationPacks,
  type AutomationTrigger,
  type LoadPacksOptions,
} from '../../lib/automations/packs';
import type { Automation } from '../../lib/engine/core/types';
import { resolveBuiltinCatalogRoot } from '../lib/config_store/builtin_catalog';

/** What one pack contributes to the seed batch. */
export interface SeedablePack {
  document: Automation;
  trigger?: AutomationTrigger;
  /** The manifest's `subjects.task` block, when declared. */
  taskContract?: unknown;
  /** The manifest's `settings` block, when declared. */
  settings?: unknown;
  /** The manifest's display half — the name every surface shows. */
  presentation?: unknown;
}

/**
 * The packs a provisioning run may seed: org-scope only (a project-scope pack
 * has no target project at provision time, so it is skipped with a log line
 * rather than guessed at), `hidden` packs excluded, first declared trigger
 * only — the store binds one trigger per automation.
 *
 * `null` means the catalog itself could not be read — a misconfiguration to
 * surface as a failure, unlike an absent catalog root, which degrades to an
 * empty batch the same graceful way the org scaffold treats a not-yet-rebuilt
 * catalog.
 */
export function loadSeedablePacks(
  options: LoadPacksOptions = {},
): SeedablePack[] | null {
  const root = options.root ?? resolveBuiltinCatalogRoot();
  if (root === null) {
    console.warn(
      '[AutomationProvision] no builtin catalog root (TALE_CONFIG_BUILTIN_DIR unset, no repo checkout) — nothing to seed',
    );
    return [];
  }
  let packs;
  try {
    packs = loadAutomationPacks({ root });
  } catch (error) {
    console.error(
      '[AutomationProvision] failed to read the pack catalog',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
  const seedable: SeedablePack[] = [];
  for (const pack of packs) {
    if (pack.manifest.scope === 'project') {
      console.log(
        `[AutomationProvision] pack "${pack.slug}" is project-scoped — not an org default, skipping`,
      );
      continue;
    }
    if (pack.manifest.hidden === true) continue;
    const triggers = pack.manifest.triggers ?? [];
    if (triggers.length > 1) {
      console.warn(
        `[AutomationProvision] pack "${pack.slug}" declares ${triggers.length} triggers — the store binds one per automation, seeding the first`,
      );
    }
    seedable.push({
      document: pack.automation,
      ...(triggers[0] !== undefined && { trigger: triggers[0] }),
      ...(pack.manifest.subjects?.task !== undefined && {
        taskContract: pack.manifest.subjects.task,
      }),
      ...(pack.manifest.settings !== undefined && {
        settings: pack.manifest.settings,
      }),
      presentation: {
        name: pack.manifest.name,
        ...(pack.manifest.description !== undefined && {
          description: pack.manifest.description,
        }),
        ...(pack.manifest.icon !== undefined && { icon: pack.manifest.icon }),
        ...(pack.manifest.labels !== undefined && {
          labels: pack.manifest.labels,
        }),
        ...(pack.manifest.i18n !== undefined && { i18n: pack.manifest.i18n }),
        ...(pack.manifest.builtinViews !== undefined && {
          builtinViews: pack.manifest.builtinViews,
        }),
        ...(pack.manifest.requires?.connectors !== undefined && {
          requiredConnectors: pack.manifest.requires.connectors,
        }),
      },
    });
  }
  return seedable;
}
