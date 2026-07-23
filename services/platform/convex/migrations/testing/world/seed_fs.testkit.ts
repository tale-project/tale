/**
 * Filesystem half of the baseline world corpus: copies the static 0.2.84-shape
 * per-org config trees from `tests/fixtures/migrations-world/config/` into a
 * (temp) `TALE_CONFIG_DIR` root. The trees are plain checked-in fixtures — see
 * `manifest.testkit.ts#baselineDomains` for what each org carries and why.
 *
 * CANONICALIZATION: 0.2.98/01 rewrites two alpha files IN PLACE with
 * `snapshot: 'none'` (exact in-place inverse), so after the chain's up+down
 * they hold `serialize(parse(original))` bytes. The checked-in fixtures are
 * repo-formatter-styled (the format hook collapses short arrays), which is NOT
 * that fixpoint — so the seeded copies are normalized through the SAME
 * parse/serialize helpers the migration uses. The seeded tree (what the
 * harness must diff against after `applyDown`) is therefore a byte-exact
 * fixpoint by construction. Deterministic: pure functions of the fixture
 * bytes.
 *
 * Two-dot basename keeps this out of the Convex push bundle.
 */

import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseProviderJson,
  serializeProviderJson,
} from '../../../legacy/frozen/providers_file_utils';
import { WORLD_ORGS } from './manifest.testkit';

/** Absolute path of the checked-in fixture config root. */
export const WORLD_CONFIG_FIXTURE_DIR = fileURLToPath(
  // testing/world/ → testing → migrations → convex → services/platform
  new URL(
    '../../../../tests/fixtures/migrations-world/config',
    import.meta.url,
  ),
);

/**
 * The rewrite-in-place targets of 0.2.98/01 (claude_code_fable_default):
 * the org's claude-code agent pin and the openrouter provider catalog.
 * Everything else the chain touches on disk is fs-tree snapshot/restored
 * (byte-exact regardless of formatting), so only these two need the
 * fixpoint normalization.
 */
const CANONICALIZED_SEED_FILES: ReadonlyArray<{
  relPath: string;
  canonicalize: (content: string) => string;
}> = [
  // claude-code.json (0.2.98/01's other rewrite target) is not baseline: the
  // external-agent shape was impossible before v0.2.85, so the 0.2.85 fs
  // injection writes it — pre-canonicalized through the same helpers.
  {
    relPath: path.join(WORLD_ORGS.alpha.slug, 'providers/openrouter.json'),
    canonicalize: (content) =>
      serializeProviderJson(parseProviderJson(content)),
  },
];

/**
 * Copy each org's baseline config tree into `<root>/<org-slug>/` (plain
 * recursive copy; `.gitkeep` markers ride along harmlessly — every domain
 * walker skips dotfiles), then canonicalize the rewrite-in-place seed files.
 * `root` is the directory the harness stubs as `TALE_CONFIG_DIR`.
 */
export async function seedWorldFs(root: string): Promise<void> {
  for (const org of Object.values(WORLD_ORGS)) {
    await cp(
      path.join(WORLD_CONFIG_FIXTURE_DIR, org.slug),
      path.join(root, org.slug),
      { recursive: true },
    );
  }
  for (const { relPath, canonicalize } of CANONICALIZED_SEED_FILES) {
    const target = path.join(root, relPath);
    await writeFile(target, canonicalize(await readFile(target, 'utf-8')));
  }
}
