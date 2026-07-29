import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where organization config lives, and how the CLI discovers it.
 *
 * Two distinct things share the same per-domain shape but live in different
 * places and mean different things:
 *
 *  - `default/` at the project root is the **scaffold template** — committed,
 *    editable, seeds every new org. It is NEVER a deployable organization.
 *  - `.tale/orgs/<slug>/` holds **real organizations** — runtime data created
 *    in-app, gitignored (under `.tale/`), backed up by `tale backup`, and
 *    pushed to the container on `tale deploy --override`.
 *
 * Single source of truth for both `tale deploy` (which orgs to push) and the
 * dev compose generator (which host dirs to bind-mount).
 */

/**
 * Real organizations live here, relative to the project root. POSIX literal
 * (not `join`): this is interpolated into Docker Compose bind-mount path
 * strings (generate-dev-compose), which must use forward slashes — a
 * `join('.tale','orgs')` would emit `.tale\orgs` on Windows and break the
 * mount. `path.join(projectDir, ORGS_SUBDIR)` still normalizes correctly for
 * on-disk reads.
 */
export const ORGS_SUBDIR = '.tale/orgs';

/** The committed scaffold template directory at the project root. */
const TEMPLATE_DIR = 'default';

/**
 * Org-slug regex aligned with
 * services/platform/lib/shared/constants/org-slug.ts (64-char cap). Duplicated
 * here because the compiled CLI binary cannot import convex sources at runtime.
 */
const ORG_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Per-domain config dirs each org (and the template) holds. */
export const ORG_DOMAIN_DIRS = [
  'agents',
  'automations',
  'connectors',
  'branding',
  'providers',
  'skills',
] as const;

/** A slug is deployable when it's well-formed and not the `default` template. */
export function isDeployableOrgSlug(name: string): boolean {
  return name !== TEMPLATE_DIR && ORG_SLUG_REGEX.test(name);
}

interface OrgDir {
  slug: string;
  /** Absolute path to the org's config dir on the host. */
  srcDir: string;
}

interface OrgDiscovery {
  /** Deployable real orgs found under `.tale/orgs/<slug>/`. */
  orgs: OrgDir[];
  /**
   * Valid org-shaped dirs at the project root (the pre-`.tale/orgs/` per-org
   * layout). Not pushed; the operator is warned to move them under
   * `.tale/orgs/`.
   */
  staleRootOrgDirs: string[];
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Discover deployable orgs plus diagnostics. Pure aside from reading the
 * filesystem — unit-tested against fixture trees.
 */
export function discoverOrgs(projectDir: string): OrgDiscovery {
  const orgs: OrgDir[] = [];
  const staleRootOrgDirs: string[] = [];

  // Project root: flag any stale per-org-at-root dirs (the pre-`.tale/orgs/`
  // layout). `default/` (the template) and dotfiles are intentionally ignored.
  for (const name of listDirs(projectDir)) {
    if (name.startsWith('.')) continue;
    if (name === TEMPLATE_DIR) continue;
    if (!isDirectory(join(projectDir, name))) continue;
    if (ORG_SLUG_REGEX.test(name)) staleRootOrgDirs.push(name);
  }

  // `.tale/orgs/<slug>/` — the canonical real-org location.
  const orgsRoot = join(projectDir, ORGS_SUBDIR);
  for (const name of listDirs(orgsRoot)) {
    if (!isDeployableOrgSlug(name)) continue;
    if (!isDirectory(join(orgsRoot, name))) continue;
    orgs.push({ slug: name, srcDir: join(orgsRoot, name) });
  }

  return { orgs, staleRootOrgDirs };
}
