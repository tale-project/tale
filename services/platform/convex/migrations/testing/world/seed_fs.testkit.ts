/**
 * Filesystem half of the baseline world corpus. A fresh 0.4.0 org's config
 * tree IS the shipped per-org catalog, so the corpus copies straight from
 * `configs/platform/custom/` instead of maintaining a fixture snapshot:
 *
 *  - `baseline-alpha` — the full catalog (every shipped domain file);
 *  - `baseline-beta`  — the `governance/` domain only (the small second
 *    datapoint for per-org fs migrations);
 *  - `baseline-empty` — the domain directories, all empty (the per-org
 *    no-op path).
 *
 * When the shipped catalog changes shape, the corpus follows automatically —
 * exactly the "the baseline admits the current schemas" property the suite
 * exists to prove (config drift is guarded separately by
 * `check-config-snapshot`). Deterministic: a pure copy of checked-in bytes.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_ORGS, baselineDomains } from './manifest.testkit';

/** Absolute path of the shipped per-org catalog. */
export const WORLD_CONFIG_CATALOG_DIR = fileURLToPath(
  // world/ → testing → migrations → convex → platform → services → repo root
  new URL('../../../../../../configs/platform/custom', import.meta.url),
);

/**
 * Lay down each org's baseline config tree under `<root>/<org-slug>/`.
 * `.gitkeep` markers ride along harmlessly — every domain walker skips
 * dotfiles. `root` is the directory the harness stubs as `TALE_CONFIG_DIR`.
 */
export async function seedWorldFs(root: string): Promise<void> {
  // alpha: the full shipped catalog.
  await cp(WORLD_CONFIG_CATALOG_DIR, path.join(root, WORLD_ORGS.alpha.slug), {
    recursive: true,
  });
  // beta: governance only.
  await cp(
    path.join(WORLD_CONFIG_CATALOG_DIR, 'governance'),
    path.join(root, WORLD_ORGS.beta.slug, 'governance'),
    { recursive: true },
  );
  // empty: bare domain dirs.
  for (const domain of baselineDomains) {
    await mkdir(path.join(root, WORLD_ORGS.empty.slug, domain), {
      recursive: true,
    });
  }
}
