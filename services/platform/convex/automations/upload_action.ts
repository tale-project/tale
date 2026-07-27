'use node';

/**
 * Manual package upload — the org (or project) Automations page's file-drop
 * lane onto the store, in two transports:
 *
 * **Text lane** (`files`): the pack format's own files as strings —
 * `workflow.yml` (the v1 engine document, YAML or JSON) plus an optional
 * `automation.yml` manifest whose `subjects.task` block becomes the version's
 * task-surface contract.
 *
 * **Zip lane** (`storageId`): the same pack zipped, optionally CARRYING skill
 * bundles under `skills/<slug>/`. The blob travels through `_storage` behind
 * the presign + single-use-intent handshake in `upload_mutations.ts`; carried
 * skills are validated as real skills by the parser and fanned out into the
 * organization's skills domain BEFORE the version is saved, so the document's
 * slug references resolve from the first test run. A carried skill whose slug
 * already exists is only overwritten when byte-identical (a no-op) or when the
 * caller confirmed that slug via `overwriteSkills` — otherwise the action
 * returns `needs_confirm` and nothing is written.
 *
 * Both lanes validate the document with the ENGINE against the real registered
 * catalog before anything is stored — an upload that would not run is refused
 * with the engine's own issues, not stored broken. Saving pins a NEW name to
 * the chosen project (the store's install semantics); nothing is deployed —
 * the uploaded version is a draft behind the same deploy gate as every save.
 * Skills, however, land at upload: they are org config with a history trail,
 * and a draft's test runs already stage them.
 */

import { ConvexError, v } from 'convex/values';
import { parse as parseYaml } from 'yaml';

import {
  automationPackManifestSchema,
  type AutomationPackManifest,
} from '../../lib/automations/packs';
import { hasCodeRunner, setCodeRunner } from '../../lib/engine/core/runner';
import { validate } from '../../lib/engine/core/validate';
import { nodeVmRunner } from '../../lib/engine/runners/node-vm';
import { registerConnector } from '../../lib/integrations/registry';
import { defineAbilityFor } from '../../lib/permissions/ability';
import { MAX_AUTOMATION_BUNDLE_TOTAL_BYTES } from '../../lib/shared/schemas/automations';
import { readOrgSkill } from '../../lib/skills/listing';
import {
  canEditSkill,
  type UserSkillViewer,
} from '../../lib/skills/visibility';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { loadIntegrationConnectors } from '../integration_credentials/connector_catalog';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import {
  createOrgSkillReader,
  listSkillSlugs,
  readSkillBundleFiles,
  writeSkillBundleFiles,
} from '../skills/file_utils';
import {
  collectSkillReferences,
  parseAutomationPackZip,
  type CarriedSkill,
} from './pack_zip';

/** Pack-loader parity: one file of a pack never exceeds this. */
const MAX_UPLOAD_FILE_BYTES = 256 * 1024;
const MAX_UPLOAD_FILES = 4;

const DOCUMENT_NAMES = new Set([
  'workflow.yml',
  'workflow.yaml',
  'workflow.json',
]);
const MANIFEST_NAMES = new Set(['automation.yml', 'automation.yaml']);

const skillReportValidator = v.object({
  slug: v.string(),
  action: v.union(
    v.literal('created'),
    v.literal('replaced'),
    v.literal('unchanged'),
  ),
});

const uploadResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    name: v.string(),
    version: v.number(),
    warnings: v.array(v.string()),
    /** What happened to each carried skill; empty on the text lane. */
    skills: v.array(skillReportValidator),
  }),
  /** Carried skills collide with existing differing bundles — nothing was
   * written; re-run the whole upload with `overwriteSkills` covering these. */
  v.object({
    ok: v.literal(false),
    status: v.literal('needs_confirm'),
    skillConflicts: v.array(v.string()),
  }),
);

interface SkillReport {
  slug: string;
  action: 'created' | 'replaced' | 'unchanged';
}

type UploadResult =
  | {
      ok: true;
      name: string;
      version: number;
      warnings: string[];
      skills: SkillReport[];
    }
  | { ok: false; status: 'needs_confirm'; skillConflicts: string[] };

function refuse(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

function parseYamlRecord(name: string, text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (error) {
    refuse(
      'AUTOMATION_UPLOAD_INVALID',
      `${name} does not parse as YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value)) {
    refuse(
      'AUTOMATION_UPLOAD_INVALID',
      `${name} must hold a YAML mapping (the v1 automation document)`,
    );
  }
  return value;
}

function parseManifest(name: string, text: string): AutomationPackManifest {
  const manifest = automationPackManifestSchema.safeParse(
    parseYamlRecord(name, text),
  );
  if (!manifest.success) {
    refuse(
      'AUTOMATION_UPLOAD_INVALID',
      `${name}: ${manifest.error.issues
        .slice(0, 3)
        .map(
          (issue) => `${issue.path.join('.') || 'manifest'} ${issue.message}`,
        )
        .join('; ')}`,
    );
  }
  return manifest.data;
}

/**
 * The engine's own validation, against the real registered catalog — the same
 * assembly the node-type listing performs. Errors refuse; warnings return.
 */
async function validateDocument(document: unknown): Promise<string[]> {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  for (const connector of loadIntegrationConnectors()) {
    registerConnector(connector);
  }
  const { errors, warnings } = await validate(document);
  if (errors.length > 0) {
    refuse(
      'AUTOMATION_UPLOAD_REJECTED',
      `the document does not validate: ${errors
        .slice(0, 5)
        .map(
          (issue) => `${issue.nodeId ?? ''} [${issue.code}] ${issue.message}`,
        )
        .join(' | ')}`,
    );
  }
  return warnings.map(
    (issue) => `${issue.nodeId ?? ''} [${issue.code}] ${issue.message}`,
  );
}

/** Sorted-by-path equality between an on-disk bundle and a carried one. */
function bundlesEqual(
  existing: readonly { path: string; contentBase64: string }[],
  carried: readonly { path: string; content: Uint8Array }[],
): boolean {
  if (existing.length !== carried.length) return false;
  for (const [index, file] of carried.entries()) {
    const other = existing[index];
    if (other === undefined || other.path !== file.path) return false;
    if (Buffer.from(file.content).toString('base64') !== other.contentBase64) {
      return false;
    }
  }
  return true;
}

/**
 * Decide what happens to each carried skill: `created` for a new slug,
 * `unchanged` for a byte-identical bundle, `replaced` when the caller
 * confirmed the slug. A differing bundle the caller may not edit refuses
 * outright; differing bundles not yet confirmed are collected for the
 * `needs_confirm` round-trip.
 */
async function planSkillWrites(
  orgSlug: string,
  carried: readonly CarriedSkill[],
  viewer: UserSkillViewer,
  overwriteSkills: readonly string[],
): Promise<
  | {
      kind: 'ok';
      plan: { skill: CarriedSkill; action: SkillReport['action'] }[];
    }
  | { kind: 'needs_confirm'; slugs: string[] }
> {
  const overwrite = new Set(overwriteSkills);
  const plan: { skill: CarriedSkill; action: SkillReport['action'] }[] = [];
  const unconfirmed: string[] = [];
  const forbidden: string[] = [];
  for (const skill of carried) {
    const existing = await readSkillBundleFiles(orgSlug, skill.slug);
    if (existing === null) {
      plan.push({ skill, action: 'created' });
      continue;
    }
    if (bundlesEqual(existing, skill.files)) {
      plan.push({ skill, action: 'unchanged' });
      continue;
    }
    let editable: boolean;
    try {
      const current = await readOrgSkill(
        createOrgSkillReader(orgSlug),
        skill.slug,
      );
      editable =
        current === null
          ? viewer.isOrgAdmin
          : canEditSkill(current.meta, viewer);
    } catch (error) {
      // The existing bundle is malformed — replacing it is a repair, which
      // stays an admin call.
      console.warn(
        `[automations] ${orgSlug}: existing skill "${skill.slug}" unreadable during upload — ${error instanceof Error ? error.message : String(error)}`,
      );
      editable = viewer.isOrgAdmin;
    }
    if (!editable) {
      forbidden.push(skill.slug);
      continue;
    }
    if (!overwrite.has(skill.slug)) {
      unconfirmed.push(skill.slug);
      continue;
    }
    plan.push({ skill, action: 'replaced' });
  }
  if (forbidden.length > 0) {
    refuse(
      'SKILL_CONFLICT_FORBIDDEN',
      `You cannot overwrite the existing skill(s) ${forbidden.sort().join(', ')} — they belong to another member.`,
    );
  }
  if (unconfirmed.length > 0) {
    return { kind: 'needs_confirm', slugs: unconfirmed.sort() };
  }
  return { kind: 'ok', plan };
}

export const uploadAutomation = action({
  args: {
    organizationId: v.string(),
    /** Install target: bind the automation to this project (idempotent —
     * a new name binds on first save, an existing one gains the binding).
     * Absent = no binding change; a brand-new name then lands org-level. */
    projectId: v.optional(v.id('projects')),
    /** Text lane: the package's text files, as picked in the dialog. */
    files: v.optional(
      v.array(v.object({ name: v.string(), content: v.string() })),
    ),
    /** Zip lane: a staged `_storage` blob recorded via the upload intent. */
    storageId: v.optional(v.id('_storage')),
    /** Zip lane: skill slugs the caller confirmed for overwrite, from a prior
     * `needs_confirm` response. Entries that no longer differ are ignored. */
    overwriteSkills: v.optional(v.array(v.string())),
  },
  returns: uploadResultValidator,
  handler: async (ctx, args): Promise<UploadResult> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    if ((args.files === undefined) === (args.storageId === undefined)) {
      refuse(
        'AUTOMATION_UPLOAD_INVALID',
        'upload either text files or one staged zip (storageId) — not both, not neither',
      );
    }

    // ------------------------------------------------------------ text lane
    if (args.files !== undefined) {
      const files = args.files;
      if (files.length === 0 || files.length > MAX_UPLOAD_FILES) {
        refuse(
          'AUTOMATION_UPLOAD_INVALID',
          `upload 1–${MAX_UPLOAD_FILES} files: workflow.yml (required) and automation.yml (optional)`,
        );
      }
      for (const file of files) {
        if (file.content.length > MAX_UPLOAD_FILE_BYTES) {
          refuse(
            'AUTOMATION_UPLOAD_INVALID',
            `${file.name} exceeds the ${MAX_UPLOAD_FILE_BYTES / 1024} KiB per-file cap`,
          );
        }
      }

      const lower = (name: string) =>
        name.toLowerCase().split('/').at(-1) ?? '';
      const documentFile =
        files.find((file) => DOCUMENT_NAMES.has(lower(file.name))) ??
        // A single YAML file IS the document — the one-file upload case.
        (files.length === 1 &&
        /\.(ya?ml|json)$/i.test(lower(files[0]?.name ?? ''))
          ? files[0]
          : undefined);
      if (documentFile === undefined) {
        refuse(
          'AUTOMATION_UPLOAD_INVALID',
          'no workflow document found — include a workflow.yml (or upload a single .yml document)',
        );
      }
      const manifestFile = files.find((file) =>
        MANIFEST_NAMES.has(lower(file.name)),
      );

      const document = parseYamlRecord(documentFile.name, documentFile.content);
      const manifest =
        manifestFile === undefined
          ? undefined
          : parseManifest(manifestFile.name, manifestFile.content);
      if ((manifest?.skills?.length ?? 0) > 0) {
        refuse(
          'PACK_SKILLS_MISMATCH',
          'the manifest declares skills, but the text lane cannot carry them — upload the pack as a zip',
        );
      }
      const warnings = await validateDocument(document);
      const taskContract = manifest?.subjects?.task;
      const settings = manifest?.settings;

      const saved: { name: string; version: number } = await ctx.runMutation(
        internal.automations.mutations.storeSave,
        {
          organizationId: args.organizationId,
          actor: auth.userId,
          automation: document,
          message: `Uploaded package (${documentFile.name})`,
          ...(args.projectId !== undefined
            ? { projectId: args.projectId }
            : {}),
          ...(taskContract !== undefined ? { taskContract } : {}),
          ...(settings !== undefined ? { settings } : {}),
        },
      );
      // Installing an EXISTING automation into a project adds the binding
      // (idempotent; the first save of a new name already bound it).
      if (args.projectId !== undefined) {
        await ctx.runMutation(internal.automations.mutations.storeBindProject, {
          organizationId: args.organizationId,
          actor: auth.userId,
          automationName: saved.name,
          projectId: args.projectId,
        });
      }
      return { ok: true, ...saved, warnings, skills: [] };
    }

    // ------------------------------------------------------------- zip lane
    const storageId = args.storageId;
    if (storageId === undefined) {
      refuse('AUTOMATION_UPLOAD_INVALID', 'no staged zip to read');
    }
    try {
      const intentMatch: boolean = await ctx.runMutation(
        internal.automations.upload_mutations.verifyAutomationUploadIntent,
        { organizationId: args.organizationId, storageId },
      );
      if (!intentMatch) {
        refuse(
          'STORAGE_NOT_OWNED',
          'The staged blob does not belong to an upload of this organization.',
        );
      }
      const blob = await ctx.storage.get(storageId);
      if (blob === null) {
        refuse('STORAGE_NOT_FOUND', 'The staged blob no longer exists.');
      }
      if (blob.size > MAX_AUTOMATION_BUNDLE_TOTAL_BYTES) {
        refuse(
          'PACK_TOO_LARGE',
          `The package is ${blob.size} bytes compressed (max ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES}).`,
        );
      }

      const parsed = await parseAutomationPackZip(
        new Uint8Array(await blob.arrayBuffer()),
      );
      const document = parseYamlRecord(
        parsed.document.name,
        parsed.document.text,
      );
      const manifest =
        parsed.manifest === undefined
          ? undefined
          : parseManifest(parsed.manifest.name, parsed.manifest.text);

      // The declaration is authoritative in BOTH directions: a package can
      // neither smuggle an undeclared bundle nor promise one it doesn't ship.
      const declared = [...(manifest?.skills ?? [])].sort();
      const carriedSlugs = parsed.skills.map((skill) => skill.slug);
      if (declared.join('\n') !== carriedSlugs.join('\n')) {
        refuse(
          'PACK_SKILLS_MISMATCH',
          `the manifest's skills declaration [${declared.join(', ')}] must exactly match the carried skills/ directories [${carriedSlugs.join(', ')}]${manifest === undefined ? ' — carrying skills requires an automation.yml' : ''}`,
        );
      }

      const warnings = await validateDocument(document);

      const carriedSet = new Set(carriedSlugs);
      const orgSkillSlugs = new Set(await listSkillSlugs(auth.orgSlug));
      for (const ref of collectSkillReferences(document)) {
        if (!carriedSet.has(ref) && !orgSkillSlugs.has(ref)) {
          warnings.push(
            `[SKILL_NOT_FOUND] the document references the skill "${ref}", which is neither carried by this package nor present in the organization`,
          );
        }
      }

      const viewerContext = await ctx.runQuery(
        internal.skills.viewer_context.getUserSkillViewerContext,
        { organizationId: args.organizationId, userId: auth.userId },
      );
      const viewer: UserSkillViewer = {
        kind: 'user',
        userId: auth.userId,
        teamIds: viewerContext?.teamIds ?? [],
        isOrgAdmin:
          viewerContext?.isOrgAdmin ??
          defineAbilityFor(auth.member.role).can('write', 'orgSettings'),
      };
      const outcome = await planSkillWrites(
        auth.orgSlug,
        parsed.skills,
        viewer,
        args.overwriteSkills ?? [],
      );
      if (outcome.kind === 'needs_confirm') {
        return {
          ok: false,
          status: 'needs_confirm',
          skillConflicts: outcome.slugs,
        };
      }

      // Skills first: they are org config with their own history trail, and a
      // save refusal after them leaves nothing broken — re-uploading reports
      // them `unchanged`.
      for (const entry of outcome.plan) {
        if (entry.action === 'unchanged') continue;
        try {
          await writeSkillBundleFiles(
            auth.orgSlug,
            entry.skill.slug,
            entry.skill.files.map((file) => ({
              path: file.path,
              content: Buffer.from(file.content),
            })),
          );
        } catch (error) {
          refuse(
            'SKILL_WRITE_FAILED',
            `could not install the carried skill "${entry.skill.slug}": ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      const taskContract = manifest?.subjects?.task;
      const settings = manifest?.settings;
      const saved: { name: string; version: number } = await ctx.runMutation(
        internal.automations.mutations.storeSave,
        {
          organizationId: args.organizationId,
          actor: auth.userId,
          automation: document,
          message: `Uploaded package (${parsed.document.name})`,
          ...(args.projectId !== undefined
            ? { projectId: args.projectId }
            : {}),
          ...(taskContract !== undefined ? { taskContract } : {}),
          ...(settings !== undefined ? { settings } : {}),
        },
      );
      // Installing an EXISTING automation into a project adds the binding
      // (idempotent; the first save of a new name already bound it).
      if (args.projectId !== undefined) {
        await ctx.runMutation(internal.automations.mutations.storeBindProject, {
          organizationId: args.organizationId,
          actor: auth.userId,
          automationName: saved.name,
          projectId: args.projectId,
        });
      }
      return {
        ok: true,
        ...saved,
        warnings,
        skills: outcome.plan.map((entry) => ({
          slug: entry.skill.slug,
          action: entry.action,
        })),
      };
    } finally {
      // Single-use: the blob and its intent die with the attempt, success or
      // not — a `needs_confirm` round-trip re-uploads the zip.
      await ctx.storage.delete(storageId).catch((error: unknown) => {
        console.warn('[automations] staged upload blob cleanup failed', error);
      });
      await ctx
        .runMutation(
          internal.automations.upload_mutations.deleteAutomationUploadIntent,
          { storageId },
        )
        .catch((error: unknown) => {
          console.warn('[automations] upload intent cleanup failed', error);
        });
    }
  },
});
