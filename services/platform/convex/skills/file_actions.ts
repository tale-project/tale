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
 * All write paths enforce: CAS via `expectedHash`, symlink rejection
 * (via `O_NOFOLLOW` in `readSkillMd`), and traversal guards
 * (`validateAssetRelPath` inside the path resolver). The
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
import { internal } from '../_generated/api';
import { internalAction, action, type ActionCtx } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { type OrgMembershipAuth } from '../lib/auth/require_org_membership';
import { atomicWrite, readFileSafe, readdirSafe, sha256 } from '../lib/file_io';
import {
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

type SkillAuditAction =
  | 'create_skill'
  | 'update_skill'
  | 'delete_skill'
  | 'write_skill_asset'
  | 'delete_skill_asset';

async function logSkillAudit(
  ctx: ActionCtx,
  auth: OrgMembershipAuth,
  auditAction: SkillAuditAction,
  slug: string,
  states: {
    resourceName?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await ctx.runMutation(internal.skills.audit_mutations.logSkillAuditEvent, {
      organizationId: auth.orgId,
      actorId: auth.userId,
      ...(auth.email ? { actorEmail: auth.email } : {}),
      actorRole: auth.member.role,
      action: auditAction,
      resourceId: slug,
      ...(states.resourceName !== undefined && {
        resourceName: states.resourceName,
      }),
      ...(states.previousState !== undefined && {
        previousState: states.previousState,
      }),
      ...(states.newState !== undefined && { newState: states.newState }),
    });
  } catch (err) {
    // Audit logging must never block the user-visible operation. Log and
    // continue — observability is on the SRE side via dashboard alerts on
    // the audit_logs write rate.
    console.warn('[skills.audit] logSkillAuditEvent failed:', err);
  }
}

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
    const { orgSlug } = await requireOrgAdminOrDeveloper(
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
    };
  },
});

export const listSkills = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgAdminOrDeveloper(
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
          recommendedPackages: result.meta.recommendedPackages,
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
    const { orgSlug } = await requireOrgAdminOrDeveloper(
      ctx,
      args.organizationId,
    );
    const dir = resolveSkillDir(orgSlug, args.slug);
    const { assets, totalBytes } = await walkSkillBundle(dir);
    return {
      assets,
      totalBytes,
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
    const { orgSlug } = await requireOrgAdminOrDeveloper(
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
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const filePath = resolveSkillMdPath(auth.orgSlug, args.slug);

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
    await atomicWrite(filePath, newContent);
    await logSkillAudit(ctx, auth, 'create_skill', args.slug, {
      resourceName: meta.name,
      newState: {
        name: meta.name,
        description: meta.description,
        ...(meta.recommendedPackages && {
          recommendedPackages: meta.recommendedPackages,
        }),
      },
    });
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
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const filePath = resolveSkillMdPath(auth.orgSlug, args.slug);

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

    // Capture pre-state capability fields (description + all transitive
    // grants — tool names, integration bindings, workflow bindings) so a
    // reviewer can see exactly what changed. Skill files are org-authored
    // prose; no secrets to redact. Best-effort: skip on parse error since
    // we want the audit row to land regardless.
    let previousCapability:
      | {
          description?: string;
          recommendedPackages?: { python?: string[]; node?: string[] };
        }
      | undefined;
    try {
      const prev = parseSkillMd(existing);
      previousCapability = {
        description: prev.meta.description,
        ...(prev.meta.recommendedPackages && {
          recommendedPackages: prev.meta.recommendedPackages,
        }),
      };
    } catch (err) {
      console.warn(
        `[skills.updateSkill] parseSkillMd failed for previous-state capture on slug=${args.slug}:`,
        err,
      );
    }

    const meta = validateMetaPayload(args.meta);
    if (meta.name !== args.slug) {
      throw new ConvexError({
        code: 'NAME_MISMATCH',
        message: `Frontmatter name "${meta.name}" must match slug "${args.slug}"`,
      });
    }
    const newContent = serializeSkillMd(meta, args.body);
    await atomicWrite(filePath, newContent);
    await logSkillAudit(ctx, auth, 'update_skill', args.slug, {
      resourceName: meta.name,
      ...(previousCapability !== undefined && {
        previousState: previousCapability,
      }),
      newState: {
        description: meta.description,
        ...(meta.recommendedPackages && {
          recommendedPackages: meta.recommendedPackages,
        }),
      },
    });
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
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // SKILL.md must exist before assets land — keep bundle layout coherent.
    const skillMdContent = await readFileSafe(
      resolveSkillMdPath(auth.orgSlug, args.slug),
    );
    if (skillMdContent === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Skill "${args.slug}" does not exist`,
      });
    }

    const filePath = await resolveSkillAssetPathChecked(
      auth.orgSlug,
      args.slug,
      args.assetPath,
    );
    const incomingBytes = Buffer.byteLength(args.content, 'utf-8');
    const current = await readFileSafe(filePath);
    if (args.expectedHash === undefined) {
      // Create mode (no expectedHash supplied). Mirror createSkill's
      // refuse-if-exists guard — otherwise typing an existing asset path
      // in the create dialog silently overwrites it.
      if (current !== null) {
        throw new ConvexError({
          code: 'ALREADY_EXISTS',
          message: `Asset "${args.assetPath}" already exists. Open it from the list to edit, or choose a new path.`,
        });
      }
    } else if (current !== null && sha256(current) !== args.expectedHash) {
      throw new ConvexError({
        code: 'CONFLICT',
        message:
          'Asset was modified externally since it was loaded. Reload and reapply your changes.',
      });
    }
    await atomicWrite(filePath, args.content);
    await logSkillAudit(ctx, auth, 'write_skill_asset', args.slug, {
      resourceName: args.assetPath,
      newState: { assetPath: args.assetPath, bytes: incomingBytes },
    });
    return { hash: sha256(args.content) };
  },
});

export const deleteSkillAsset = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    assetPath: v.string(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const filePath = await resolveSkillAssetPathChecked(
      auth.orgSlug,
      args.slug,
      args.assetPath,
    );
    // CAS on delete: if the caller passes expectedHash, the on-disk content
    // must match. Defends against deleting an asset that changed between
    // load and confirm. Symmetric with writeSkillAsset.
    if (args.expectedHash !== undefined) {
      const current = await readFileSafe(filePath);
      if (current !== null && sha256(current) !== args.expectedHash) {
        throw new ConvexError({
          code: 'CONFLICT',
          message:
            'Asset was modified externally since it was loaded. Reload and reconfirm the delete.',
        });
      }
    }
    try {
      await unlink(filePath);
      await logSkillAudit(ctx, auth, 'delete_skill_asset', args.slug, {
        resourceName: args.assetPath,
        previousState: { assetPath: args.assetPath },
      });
      return { deleted: true };
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? err.code : undefined;
      if (code === 'ENOENT') return { deleted: false };
      throw err;
    }
  },
});

export const duplicateSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({ newSlug: v.string() }),
  handler: async (ctx, args): Promise<{ newSlug: string }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    // Load the source skill so we can re-serialize with a new slug. We
    // intentionally re-derive content from parseSkillMd rather than
    // copying the raw bytes — that catches malformed source files at
    // duplicate-time instead of letting the new skill inherit corrupt
    // frontmatter and fail later at runtime.
    const sourcePath = resolveSkillMdPath(auth.orgSlug, args.slug);
    const sourceContent = await readFileSafe(sourcePath);
    if (sourceContent === null) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Skill "${args.slug}" does not exist`,
      });
    }
    const { meta, body } = parseSkillMd(sourceContent);

    // Find an unused slug — `<slug>-copy`, `<slug>-copy-2`, etc. Mirrors
    // duplicateAgent's naming so the two surfaces feel identical.
    const baseDir = resolveSkillsDir(auth.orgSlug);
    let entries: string[];
    try {
      entries = await readdirSafe(baseDir);
    } catch {
      entries = [];
    }
    const existing = new Set(entries);
    let newSlug = `${args.slug}-copy`;
    let counter = 2;
    while (existing.has(newSlug)) {
      newSlug = `${args.slug}-copy-${counter}`;
      counter += 1;
    }
    if (!validateSkillSlug(newSlug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Generated copy slug "${newSlug}" is not valid`,
      });
    }

    // Update the frontmatter `name` to match the new slug — `createSkill`
    // enforces name == slug, and a skill whose name disagrees with its
    // on-disk directory would silently misbehave anyway.
    const newMeta = { ...meta, name: newSlug };
    const newContent = serializeSkillMd(newMeta, body);
    const newSkillMdPath = resolveSkillMdPath(auth.orgSlug, newSlug);
    await atomicWrite(newSkillMdPath, newContent);

    // Copy bundle assets too. Best-effort: a partial copy is still a
    // valid skill (assets are optional), and the user can re-upload
    // anything that didn't make it through; aborting on first asset
    // failure would leave behind a half-populated duplicate that's
    // harder to recover from.
    const sourceDir = resolveSkillDir(auth.orgSlug, args.slug);
    const { assets } = await walkSkillBundle(sourceDir);
    for (const asset of assets) {
      const sourceAssetPath = path.join(sourceDir, asset.path);
      const content = await readFileSafe(sourceAssetPath);
      if (content === null) continue;
      const targetPath = await resolveSkillAssetPathChecked(
        auth.orgSlug,
        newSlug,
        asset.path,
      );
      await atomicWrite(targetPath, content);
    }

    await logSkillAudit(ctx, auth, 'create_skill', newSlug, {
      resourceName: newSlug,
      newState: {
        sourceSlug: args.slug,
        name: newMeta.name,
        description: newMeta.description,
        ...(newMeta.recommendedPackages && {
          recommendedPackages: newMeta.recommendedPackages,
        }),
      },
    });

    return { newSlug };
  },
});

export const deleteSkill = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!validateSkillSlug(args.slug)) {
      throw new ConvexError({
        code: 'INVALID_SLUG',
        message: `Invalid skill slug: ${args.slug}`,
      });
    }
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const dir = resolveSkillDir(auth.orgSlug, args.slug);
    const skillMdPath = resolveSkillMdPath(auth.orgSlug, args.slug);

    // CAS guard: the caller can pass the SKILL.md hash they last observed.
    // If the file changed between load and confirm, refuse — the operator
    // may be looking at a stale view of the skill they think they're deleting.
    if (args.expectedHash !== undefined) {
      const current = await readFileSafe(skillMdPath);
      if (current !== null && sha256(current) !== args.expectedHash) {
        throw new ConvexError({
          code: 'CONFLICT',
          message:
            'Skill was modified externally since it was loaded. Reload and reconfirm the delete.',
        });
      }
    }

    // Audit BEFORE the destructive rm so a missing audit row implies the
    // delete didn't happen. `rm({force:true})` swallows ENOENT, so the
    // post-rm branch that used to return `{deleted: false}` was unreachable
    // — we now return `deleted: true` unconditionally on a non-throwing rm.
    await logSkillAudit(ctx, auth, 'delete_skill', args.slug);
    await rm(dir, { recursive: true, force: true });
    return { deleted: true };
  },
});

// ---------------------------------------------------------------------------
// Internal actions used by the chat runtime at turn start:
//   - `listSkillsForExecution(orgSlug)` returns every skill slug present
//     in the org's skills directory (passes the slug validator).
//   - `readSkillForExecution(orgSlug, slug)` loads one skill's full bundle
//     into memory (frontmatter + body + every asset's content) with its
//     versionHash for drift detection.
//
// Trust contract: the caller MUST have already authenticated the `orgSlug`
// against the user's session — these internal actions take the already-
// resolved orgSlug verbatim and do NO membership re-check.
// ---------------------------------------------------------------------------

export const listSkillsForExecution = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const dir = resolveSkillsDir(args.orgSlug);
    const entries = await readdirSafe(dir);
    return entries.filter(
      (e) => !e.startsWith('.') && !e.startsWith('@') && validateSkillSlug(e),
    );
  },
});

export const readSkillForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    if (!validateSkillSlug(args.slug)) {
      return { ok: false as const, error: 'invalid_slug' as const };
    }
    const result = await readSkillMd(args.orgSlug, args.slug);
    if (!result.ok) return result;

    const dir = resolveSkillDir(args.orgSlug, args.slug);
    const { assets } = await walkSkillBundle(dir);

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
  if (meta.recommendedPackages !== undefined) {
    wireMeta['recommended-packages'] = meta.recommendedPackages;
  }
  if (typeof meta.license === 'string') wireMeta.license = meta.license;
  if (meta.metadata !== undefined) wireMeta.metadata = meta.metadata;
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
