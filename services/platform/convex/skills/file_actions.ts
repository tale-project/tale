'use node';

/**
 * Skill file I/O actions (Convex action surface for the `/skills` page and
 * for the runtime engine's snapshot read).
 *
 * Storage model mirrors agents/integrations: SKILL.md + bundle assets on
 * disk under `${SKILLS_DIR}/<orgSlug-prefix>/<slug>/`. There is NO Convex
 * DB table for skills — the file is the source of truth, team scoping and
 * role restriction live in YAML frontmatter, author/timestamps come from
 * audit_logs (see Phase 5c follow-up).
 *
 * All write paths enforce: CAS via `expectedHash`, bundle size caps,
 * symlink rejection (via `O_NOFOLLOW` in `readSkillMd`), and traversal
 * guards (`validateAssetRelPath` inside the path resolver). The
 * `readSkillForExecution` internal action reads the full bundle into
 * memory and is the only entrypoint the runtime engine uses — it returns
 * the SKILL.md content hash so the runtime snapshot can detect drift.
 */

import { readdir, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import {
  parseSkillMd,
  SkillFrontmatterError,
} from '../../lib/shared/schemas/skills';
import { internalAction, action } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { atomicWrite, readFileSafe, readdirSafe, sha256 } from '../lib/file_io';
import {
  MAX_SKILL_ASSETS,
  MAX_SKILL_MD_BYTES,
  MAX_TOTAL_BUNDLE_BYTES,
  readSkillMd,
  resolveSkillAssetPathChecked,
  resolveSkillDir,
  resolveSkillMdPath,
  resolveSkillsDir,
  serializeSkillMd,
  validateSkillSlug,
  type SkillFrontmatter,
} from './file_utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AssetEntry {
  path: string;
  size: number;
}

/**
 * Walk a skill bundle directory, returning every regular file relative to
 * the skill root, excluding `SKILL.md`. Skips symlinks (defense-in-depth)
 * and dotfiles. Used by the listing UI and the runtime bundle loader.
 */
async function walkSkillBundle(
  skillDir: string,
): Promise<{ assets: AssetEntry[]; totalBytes: number }> {
  const assets: AssetEntry[] = [];
  let totalBytes = 0;

  async function walk(currentDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true }).catch(
      () => [] as never[],
    );
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = relPrefix === '' ? e.name : `${relPrefix}/${e.name}`;
      const abs = path.join(currentDir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue;
      if (rel === 'SKILL.md') continue;
      const st = await stat(abs).catch(() => null);
      if (!st) continue;
      assets.push({ path: rel, size: st.size });
      totalBytes += st.size;
    }
  }

  await walk(skillDir, '');
  assets.sort((a, b) => a.path.localeCompare(b.path));
  return { assets, totalBytes };
}

/**
 * Detect script files in a skill bundle (anything matching `*.py|*.js|*.cjs|*.mjs`).
 * Used by `expand_skill` to advertise executable entry points to the model.
 */
function detectExecutables(
  assets: AssetEntry[],
): Array<{ path: string; language: 'python' | 'node' }> {
  const out: Array<{ path: string; language: 'python' | 'node' }> = [];
  for (const a of assets) {
    if (a.path.endsWith('.py')) {
      out.push({ path: a.path, language: 'python' });
    } else if (
      a.path.endsWith('.js') ||
      a.path.endsWith('.cjs') ||
      a.path.endsWith('.mjs')
    ) {
      out.push({ path: a.path, language: 'node' });
    }
  }
  return out;
}

async function ensureBundleAllowsWrite(
  skillDir: string,
  incomingPath: string,
  incomingBytes: number,
): Promise<void> {
  const { assets, totalBytes } = await walkSkillBundle(skillDir);
  const incomingExisting = assets.find((a) => a.path === incomingPath);
  const newAssetCount = incomingExisting ? assets.length : assets.length + 1;
  if (newAssetCount > MAX_SKILL_ASSETS) {
    throw new ConvexError({
      code: 'BUNDLE_TOO_MANY_FILES',
      message: `Skill bundle would exceed ${MAX_SKILL_ASSETS} files`,
    });
  }
  const replacedSize = incomingExisting?.size ?? 0;
  const projected = totalBytes - replacedSize + incomingBytes;
  if (projected > MAX_TOTAL_BUNDLE_BYTES) {
    throw new ConvexError({
      code: 'BUNDLE_TOO_LARGE',
      message: `Skill bundle would exceed ${MAX_TOTAL_BUNDLE_BYTES} bytes`,
    });
  }
}

// ---------------------------------------------------------------------------
// Public actions (called from frontend)
// ---------------------------------------------------------------------------

export const readSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const result = await readSkillMd(orgSlug, args.slug);
    if (!result.ok) return result;
    const skillDir = resolveSkillDir(orgSlug, args.slug);
    const { assets, totalBytes } = await walkSkillBundle(skillDir);
    return {
      ok: true as const,
      slug: args.slug,
      meta: result.meta,
      body: result.body,
      hash: result.versionHash,
      assets,
      totalBytes,
      executableFiles: detectExecutables(assets),
    };
  },
});

export const listSkills = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const dir = resolveSkillsDir(orgSlug);
    const entries = await readdirSafe(dir);
    const slugs = entries.filter(
      (e) => !e.startsWith('.') && !e.startsWith('@') && validateSkillSlug(e),
    );

    const results = await Promise.all(
      slugs.map(async (slug) => {
        const result = await readSkillMd(orgSlug, slug);
        if (!result.ok) {
          return {
            slug,
            status: result.error,
            message: result.message,
          };
        }
        return {
          slug,
          name: result.meta.name,
          description: result.meta.description,
          toolNames: result.meta.toolNames ?? [],
          integrationBindings: result.meta.integrationBindings ?? [],
          workflowBindings: result.meta.workflowBindings ?? [],
          packages: result.meta.packages,
          roleRestriction: result.meta.roleRestriction,
          sharedWithTeamIds: result.meta.sharedWithTeamIds ?? [],
          license: result.meta.license,
          hash: result.versionHash,
        };
      }),
    );
    return results;
  },
});

export const listSkillFiles = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const dir = resolveSkillDir(orgSlug, args.slug);
    const { assets, totalBytes } = await walkSkillBundle(dir);
    return {
      assets,
      totalBytes,
      maxAssets: MAX_SKILL_ASSETS,
      maxTotalBytes: MAX_TOTAL_BUNDLE_BYTES,
    };
  },
});

export const readSkillAsset = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    assetPath: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const filePath = await resolveSkillAssetPathChecked(
      orgSlug,
      args.slug,
      args.assetPath,
    );
    const content = await readFileSafe(filePath);
    if (content === null) {
      return { ok: false as const, error: 'not_found' as const };
    }
    if (content.length > MAX_SKILL_MD_BYTES) {
      return { ok: false as const, error: 'too_large' as const };
    }
    return {
      ok: true as const,
      content,
      hash: sha256(content),
    };
  },
});

export const createSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    meta: v.any(),
    body: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const filePath = resolveSkillMdPath(orgSlug, args.slug);

    const existing = await readFileSafe(filePath);
    if (existing !== null) {
      throw new ConvexError({
        code: 'ALREADY_EXISTS',
        message: `Skill "${args.slug}" already exists`,
      });
    }

    const meta = validateMetaPayload(args.meta);
    if (meta.name !== args.slug) {
      throw new ConvexError({
        code: 'NAME_MISMATCH',
        message: `Frontmatter name "${meta.name}" must match slug "${args.slug}"`,
      });
    }
    const newContent = serializeSkillMd(meta, args.body);
    if (Buffer.byteLength(newContent, 'utf-8') > MAX_SKILL_MD_BYTES) {
      throw new ConvexError({
        code: 'TOO_LARGE',
        message: `SKILL.md exceeds ${MAX_SKILL_MD_BYTES} bytes`,
      });
    }
    await atomicWrite(filePath, newContent);
    return { hash: sha256(newContent) };
  },
});

export const updateSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    meta: v.any(),
    body: v.string(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const filePath = resolveSkillMdPath(orgSlug, args.slug);

    const existing = await readFileSafe(filePath);
    if (existing === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Skill "${args.slug}" does not exist`,
      });
    }
    if (args.expectedHash !== undefined) {
      const currentHash = sha256(existing);
      if (currentHash !== args.expectedHash) {
        throw new ConvexError({
          code: 'CONFLICT',
          message:
            'Skill was modified externally since it was loaded. Reload and reapply your changes.',
        });
      }
    }

    const meta = validateMetaPayload(args.meta);
    if (meta.name !== args.slug) {
      throw new ConvexError({
        code: 'NAME_MISMATCH',
        message: `Frontmatter name "${meta.name}" must match slug "${args.slug}"`,
      });
    }
    const newContent = serializeSkillMd(meta, args.body);
    if (Buffer.byteLength(newContent, 'utf-8') > MAX_SKILL_MD_BYTES) {
      throw new ConvexError({
        code: 'TOO_LARGE',
        message: `SKILL.md exceeds ${MAX_SKILL_MD_BYTES} bytes`,
      });
    }
    await atomicWrite(filePath, newContent);
    return { hash: sha256(newContent) };
  },
});

export const writeSkillAsset = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    assetPath: v.string(),
    content: v.string(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const skillDir = resolveSkillDir(orgSlug, args.slug);

    // SKILL.md must exist before assets land — keep bundle layout coherent.
    const skillMdContent = await readFileSafe(
      resolveSkillMdPath(orgSlug, args.slug),
    );
    if (skillMdContent === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Skill "${args.slug}" does not exist`,
      });
    }

    const filePath = await resolveSkillAssetPathChecked(
      orgSlug,
      args.slug,
      args.assetPath,
    );
    const incomingBytes = Buffer.byteLength(args.content, 'utf-8');
    if (incomingBytes > MAX_SKILL_MD_BYTES) {
      throw new ConvexError({
        code: 'TOO_LARGE',
        message: `Asset exceeds per-file cap of ${MAX_SKILL_MD_BYTES} bytes`,
      });
    }
    if (args.expectedHash !== undefined) {
      const current = await readFileSafe(filePath);
      if (current !== null && sha256(current) !== args.expectedHash) {
        throw new ConvexError({
          code: 'CONFLICT',
          message:
            'Asset was modified externally since it was loaded. Reload and reapply your changes.',
        });
      }
    }
    await ensureBundleAllowsWrite(skillDir, args.assetPath, incomingBytes);
    await atomicWrite(filePath, args.content);
    return { hash: sha256(args.content) };
  },
});

export const deleteSkillAsset = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    assetPath: v.string(),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const filePath = await resolveSkillAssetPathChecked(
      orgSlug,
      args.slug,
      args.assetPath,
    );
    try {
      await unlink(filePath);
      return { deleted: true };
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? err.code : undefined;
      if (code === 'ENOENT') return { deleted: false };
      throw err;
    }
  },
});

export const deleteSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const dir = resolveSkillDir(orgSlug, args.slug);
    try {
      await rm(dir, { recursive: true, force: true });
      return { deleted: true };
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? err.code : undefined;
      if (code === 'ENOENT') return { deleted: false };
      throw err;
    }
  },
});

// ---------------------------------------------------------------------------
// Internal action used by the runtime engine to load a skill bundle into
// memory at turn start. Returns the full bundle (frontmatter + body + every
// asset's content) PLUS the SKILL.md version hash so the runtime snapshot
// can detect drift against the agent's `skillBindingsResolved` snapshot.
//
// Trust contract: the caller MUST have already authenticated the
// `orgSlug` against the user's session — this internal action takes the
// already-resolved orgSlug verbatim and does NO membership re-check.
// See `agents/file_actions.ts::readAgentForChat` for the matching pattern.
// ---------------------------------------------------------------------------

export const readSkillForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      return { ok: false as const, error: 'invalid_slug' as const };
    }
    const result = await readSkillMd(args.orgSlug, args.slug);
    if (!result.ok) return result;

    const dir = resolveSkillDir(args.orgSlug, args.slug);
    const { assets, totalBytes } = await walkSkillBundle(dir);
    if (totalBytes > MAX_TOTAL_BUNDLE_BYTES) {
      return {
        ok: false as const,
        error: 'too_large' as const,
        message: `Skill bundle exceeds ${MAX_TOTAL_BUNDLE_BYTES} bytes (was ${totalBytes})`,
      };
    }

    // Load every asset into memory. The bundle is bounded by
    // MAX_TOTAL_BUNDLE_BYTES (1 MB) so this is safe.
    const files = await Promise.all(
      assets.map(async (a) => {
        const abs = await resolveSkillAssetPathChecked(
          args.orgSlug,
          args.slug,
          a.path,
        );
        const content = await readFileSafe(abs);
        return content === null
          ? null
          : { path: a.path, content, size: a.size };
      }),
    );

    return {
      ok: true as const,
      slug: args.slug,
      meta: result.meta,
      body: result.body,
      versionHash: result.versionHash,
      files: files.filter((f): f is NonNullable<typeof f> => f !== null),
      executableFiles: detectExecutables(assets),
    };
  },
});

// ---------------------------------------------------------------------------
// Frontmatter validation for incoming UI payloads. The UI sends a
// camelCase normalized shape; we re-serialize through `serializeSkillMd`
// which writes the kebab-case wire format back to disk.
// ---------------------------------------------------------------------------

function validateMetaPayload(rawMeta: unknown): SkillFrontmatter {
  if (
    rawMeta === null ||
    typeof rawMeta !== 'object' ||
    Array.isArray(rawMeta)
  ) {
    throw new ConvexError({
      code: 'INVALID_FRONTMATTER',
      message: 'meta must be an object',
    });
  }
  // Round-trip through parseSkillMd so the UI payload follows the exact
  // same validation path as on-disk content. We embed it in a temporary
  // SKILL.md and let parseSkillMd do the work.
  const meta: Record<string, unknown> = { ...rawMeta };
  const wireMeta: Record<string, unknown> = {};
  if (typeof meta.name === 'string') wireMeta.name = meta.name;
  if (typeof meta.description === 'string') {
    wireMeta.description = meta.description;
  }
  if (Array.isArray(meta.toolNames)) wireMeta['tool-names'] = meta.toolNames;
  if (Array.isArray(meta.integrationBindings)) {
    wireMeta['integration-bindings'] = meta.integrationBindings;
  }
  if (Array.isArray(meta.workflowBindings)) {
    wireMeta['workflow-bindings'] = meta.workflowBindings;
  }
  if (meta.packages !== undefined) wireMeta.packages = meta.packages;
  if (typeof meta.roleRestriction === 'string') {
    wireMeta['role-restriction'] = meta.roleRestriction;
  }
  if (Array.isArray(meta.sharedWithTeamIds)) {
    wireMeta['shared-with-team-ids'] = meta.sharedWithTeamIds;
  }
  if (typeof meta.license === 'string') wireMeta.license = meta.license;
  if (meta.metadata !== undefined) wireMeta.metadata = meta.metadata;
  if (meta.i18n !== undefined) wireMeta.i18n = meta.i18n;
  const unknownContainer = meta.unknown;
  if (
    unknownContainer !== null &&
    typeof unknownContainer === 'object' &&
    !Array.isArray(unknownContainer)
  ) {
    for (const unknownKey of Object.keys(unknownContainer)) {
      if (!(unknownKey in wireMeta)) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- typeof===object check above narrows but TS lint wants the explicit record type
        const dict = unknownContainer as Record<string, unknown>;
        wireMeta[unknownKey] = dict[unknownKey];
      }
    }
  }

  const yamlText = formatYamlForValidation(wireMeta);
  const synthetic = `---\n${yamlText}---\n`;
  try {
    return parseSkillMd(synthetic).meta;
  } catch (err) {
    if (err instanceof SkillFrontmatterError) {
      throw new ConvexError({
        code: 'INVALID_FRONTMATTER',
        message: err.message,
      });
    }
    throw err;
  }
}

function formatYamlForValidation(obj: Record<string, unknown>): string {
  // Conservative literal dump: parseSkillMd does the strict validation.
  return JSON.stringify(obj) + '\n';
}
