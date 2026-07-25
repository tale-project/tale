'use node';

/**
 * The "Duplicate integration" automation-rebind sub-routine. When an integration
 * is duplicated under a new slug, every automation BOUND to the source
 * integration is cloned into the org under a fresh automation slug with all its
 * integration references rewritten to the new slug (see
 * {@link rebindManifestIntegration}), so the duplicate gets its own sync + its
 * own inbox. General to any integration with a bundled automation; a no-op for
 * integrations without one (REST / SQL). The reverse — {@link
 * cleanupReboundAutomations} — powers the duplicate action's failure teardown.
 */

import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  AUTOMATION_MANIFEST_FILENAME,
  automationManifestSchema,
  isValidAutomationSlug,
} from '../../lib/shared/schemas/automations';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { deriveNextSlug } from '../integrations/file_utils';
import {
  atomicWrite,
  atomicWriteBuffer,
  errnoCode,
  readFileBufferSafe,
} from '../lib/file_io';
import {
  listAutomationSlugs,
  resolveAutomationDir,
  resolveAutomationsDir,
  resolveCatalogAutomationsDir,
} from './file_utils';
import { resolveAutomationBundleSourceDir } from './install_fs';
import { rebindManifestIntegration } from './rebind_manifest';

/** Skip guards mirroring the automation install copy (dotfiles + secrets). */
function skipBundleEntry(name: string): boolean {
  return name.startsWith('.') || name.endsWith('.secrets.json');
}

/**
 * Copy a source automation bundle tree into `destDir`, writing the rebound
 * `automation.json` at the root and every other file (icon.svg, and any
 * agents/ views/ scripts/ a richer bundle carries) verbatim. Mirrors the
 * install copy's dotfile/secret/symlink skips so the same guards apply.
 */
async function copyBundleWithReboundManifest(
  sourceDir: string,
  destDir: string,
  reboundManifest: Record<string, unknown>,
): Promise<void> {
  const walk = async (
    src: string,
    dst: string,
    isRoot: boolean,
  ): Promise<void> => {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (skipBundleEntry(entry.name) || entry.isSymbolicLink()) continue;
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        await walk(srcPath, dstPath, false);
      } else if (entry.isFile()) {
        if (isRoot && entry.name === AUTOMATION_MANIFEST_FILENAME) {
          await atomicWrite(
            dstPath,
            `${JSON.stringify(reboundManifest, null, 2)}\n`,
          );
        } else {
          const buf = await readFileBufferSafe(srcPath);
          if (buf) await atomicWriteBuffer(dstPath, buf);
        }
      }
    }
  };
  await walk(sourceDir, destDir, true);
}

/**
 * Clone + rebind every automation bound to `sourceIntegrationSlug` onto
 * `newIntegrationSlug`, installing each under a fresh automation slug. Returns
 * the source→new automation slug pairs (empty when the integration has no
 * bundled automation).
 */
export async function rebindBundledAutomations(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    orgSlug: string;
    sourceIntegrationSlug: string;
    newIntegrationSlug: string;
    installedBy: string;
  },
): Promise<Array<{ sourceSlug: string; newSlug: string }>> {
  const {
    organizationId,
    orgSlug,
    sourceIntegrationSlug,
    newIntegrationSlug,
    installedBy,
  } = args;

  // (a) Discover installed automations bound to the source integration.
  const bound = await ctx.runQuery(
    internal.automations.install_mutations
      .listInstallationsRequiringIntegrationInternal,
    { organizationId, integrationSlug: sourceIntegrationSlug },
  );
  if (bound.length === 0) return [];

  // Collision universe for the new automation slug: org-dir slugs, install-row
  // slugs, AND builtin-catalog slugs — the last is essential, since
  // `resolveAutomationBundleSourceDir` resolves the builtin first and would
  // shadow our org-dir copy on a catalog collision.
  const takenAutomationSlugs = new Set<string>([
    ...(await listAutomationSlugs(
      resolveAutomationsDir(orgSlug),
      'dup-integration',
    )),
    ...(await listAutomationSlugs(
      resolveCatalogAutomationsDir(),
      'dup-integration',
    )),
    ...(await ctx.runQuery(
      internal.automations.install_mutations
        .listAutomationInstallationsInternal,
      { organizationId },
    )),
  ]);

  const rebound: Array<{ sourceSlug: string; newSlug: string }> = [];
  // Bundle dirs written but not yet installed. `cleanupReboundAutomations`
  // finds automations by INSTALL ROW, so a dir whose install threw would
  // otherwise be invisible to the teardown and left littering the org's
  // automations dir. Tracked here and swept on the way out.
  const uninstalledDirs: string[] = [];
  try {
    for (const { automationSlug: sourceAutomationSlug } of bound) {
      // (b) Read the source manifest (builtin catalog for a first-party
      // automation, else the org's own copy — resolveAutomationBundleSourceDir).
      const sourceDir = await resolveAutomationBundleSourceDir(
        orgSlug,
        sourceAutomationSlug,
      );
      const rawManifest: unknown = JSON.parse(
        await readFile(
          path.join(sourceDir, AUTOMATION_MANIFEST_FILENAME),
          'utf-8',
        ),
      );
      if (!isRecord(rawManifest)) {
        throw new Error(
          `Automation "${sourceAutomationSlug}" manifest is not a JSON object`,
        );
      }

      // (c) Rewrite integration refs, then sanity-check the result still parses.
      const reboundManifest = rebindManifestIntegration(
        rawManifest,
        sourceIntegrationSlug,
        newIntegrationSlug,
      );
      const parsed = automationManifestSchema.safeParse(reboundManifest);
      if (!parsed.success) {
        throw new Error(
          zodErrorMessage(
            `Rebound automation "${sourceAutomationSlug}" is invalid`,
            parsed.error,
          ),
        );
      }

      // (d) Derive a fresh, non-colliding automation slug and reserve it so two
      // bound automations in one duplicate can't collide.
      const newAutomationSlug = deriveNextSlug(
        sourceAutomationSlug,
        takenAutomationSlugs,
      );
      if (!isValidAutomationSlug(newAutomationSlug)) {
        throw new Error(
          `Derived automation slug is invalid: ${newAutomationSlug}`,
        );
      }
      takenAutomationSlugs.add(newAutomationSlug);

      // (e) Write the rebound bundle into the org dir.
      const newDir = resolveAutomationDir(orgSlug, newAutomationSlug);
      uninstalledDirs.push(newDir);
      await copyBundleWithReboundManifest(sourceDir, newDir, reboundManifest);

      // (f) Install in place. The new slug is absent from the catalog, so it
      // resolves to the org dir (the self-copy is skipped); ensureOrgResources
      // registers the inline workflow and writes the install row
      // (requiredIntegrations = [newIntegrationSlug]).
      //
      // NO schedule yet: the duplicate's credential is blank until an operator
      // enters this instance's login, and a cron provisioned now would fire a
      // guaranteed-failing run on every tick until then — forever, if the
      // duplicate is abandoned. The integration's reconnect cascade
      // (`integrations/cascade.ts`) reconciles the schedule from this manifest the
      // moment the instance first connects.
      await ctx.runAction(
        internal.automations.install_actions.installAutomationInternal,
        {
          organizationId,
          automationSlug: newAutomationSlug,
          installedBy,
          skipSchedules: true,
        },
      );

      // Installed — the install row now makes it findable by the teardown.
      uninstalledDirs.pop();
      rebound.push({
        sourceSlug: sourceAutomationSlug,
        newSlug: newAutomationSlug,
      });
    }
  } catch (error) {
    // Sweep any bundle dir written without a matching install row, so a failed
    // duplicate leaves nothing behind for the teardown to miss.
    for (const dir of uninstalledDirs) {
      await rm(dir, { recursive: true, force: true }).catch(
        (rmError: unknown) => {
          console.error(
            `[duplicateIntegration] failed to remove uninstalled rebound bundle "${dir}":`,
            rmError,
          );
        },
      );
    }
    throw error;
  }

  return rebound;
}

/**
 * Reverse {@link rebindBundledAutomations} for the duplicate action's failure
 * teardown: uninstall + remove every automation whose install row is bound to
 * `integrationSlug` (the DUPLICATE's new slug). Best-effort — logs and continues
 * past any single failure so the rest of the cleanup still runs. Finds whatever
 * was installed regardless of where a mid-rebind failure stopped.
 */
export async function cleanupReboundAutomations(
  ctx: ActionCtx,
  args: { organizationId: string; orgSlug: string; integrationSlug: string },
): Promise<void> {
  const { organizationId, orgSlug, integrationSlug } = args;
  const rebound = await ctx.runQuery(
    internal.automations.install_mutations
      .listInstallationsRequiringIntegrationInternal,
    { organizationId, integrationSlug },
  );
  for (const { automationSlug } of rebound) {
    try {
      await ctx.runAction(
        internal.automations.install_actions.uninstallAutomationInternal,
        { organizationId, automationSlug },
      );
    } catch (error) {
      console.error(
        `[duplicateIntegration] failed to uninstall rebound automation "${automationSlug}":`,
        error,
      );
    }
    // Uninstall leaves the org-dir bundle in place (a private/org-dir automation
    // is never removed by uninstall), so drop the dir explicitly.
    await rm(resolveAutomationDir(orgSlug, automationSlug), {
      recursive: true,
      force: true,
    }).catch((error: unknown) => {
      if (errnoCode(error) !== 'ENOENT') {
        console.error(
          `[duplicateIntegration] failed to remove rebound automation dir "${automationSlug}":`,
          error,
        );
      }
    });
  }
}
