'use node';

/**
 * The manual package-upload lane, host-neutral: everything
 * `upload_action.ts` documents — the text and zip transports, engine
 * validation, the carried-skill plan/confirm/write protocol, and the store
 * save + project binding — with the host's storage and store reached
 * through the injected {@link UploadHost}. The 0.4 action and the 0.5
 * backend route both wire this one implementation, so the lanes cannot
 * drift.
 */

import { parse as parseYaml } from 'yaml';

import {
  automationPackManifestSchema,
  type AutomationPackManifest,
} from '../../../lib/automations/packs';
import { registerConnector } from '../../../lib/connectors/registry';
import { hasCodeRunner, setCodeRunner } from '../../../lib/engine/core/runner';
import { validate } from '../../../lib/engine/core/validate';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import { AppError } from '../../../lib/shared/errors/app-error';
import { MAX_AUTOMATION_BUNDLE_TOTAL_BYTES } from '../../../lib/shared/schemas/automations';
import { readOrgSkill } from '../../../lib/skills/listing';
import {
  canEditSkill,
  type UserSkillViewer,
} from '../../../lib/skills/visibility';
import { isRecord } from '../../../lib/utils/type-utils';
import { loadConnectorDefinitions } from '../connector_credentials/connector_catalog';
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

export interface SkillReport {
  slug: string;
  action: 'created' | 'replaced' | 'unchanged';
}

export type UploadResult =
  | {
      ok: true;
      name: string;
      version: number;
      warnings: string[];
      skills: SkillReport[];
    }
  | { ok: false; status: 'needs_confirm'; skillConflicts: string[] };

export interface UploadArgs {
  projectId?: string;
  files?: { name: string; content: string }[];
  storageId?: string;
  overwriteSkills?: string[];
}

/** The host half of the lane — auth already checked by the caller. */
export interface UploadHost {
  orgSlug: string;
  userId: string;
  /** Fallback when {@link getViewerContext} answers null. */
  isOrgAdmin: boolean;
  storeSave(args: {
    automation: Record<string, unknown>;
    message: string;
    projectId?: string;
    taskContract?: unknown;
    settings?: unknown;
    presentation?: Record<string, unknown>;
  }): Promise<{ name: string; version: number }>;
  /** Idempotent add of one project binding. */
  bindProject(automationName: string, projectId: string): Promise<void>;
  /** True when the staged blob belongs to an upload of this organization. */
  verifyStagedZip(storageId: string): Promise<boolean>;
  /** The staged bytes, or null when the blob no longer exists. */
  readStagedZip(storageId: string): Promise<Uint8Array | null>;
  /** Best-effort single-use cleanup (blob + intent), success or failure. */
  cleanupStagedZip(storageId: string): Promise<void>;
  getViewerContext(): Promise<{
    teamIds: string[];
    isOrgAdmin: boolean;
  } | null>;
}

function refuse(code: string, message: string): never {
  throw new AppError({ code, message });
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

/**
 * The manifest's display half, for the version row — the name a surface shows
 * instead of the slug. Kept beside the parse so both upload lanes read the same
 * fields; the store validates the shape.
 */
function presentationOf(
  manifest: AutomationPackManifest | undefined,
): Record<string, unknown> | undefined {
  if (manifest === undefined) return undefined;
  return {
    name: manifest.name,
    ...(manifest.description !== undefined && {
      description: manifest.description,
    }),
    ...(manifest.icon !== undefined && { icon: manifest.icon }),
    ...(manifest.labels !== undefined && { labels: manifest.labels }),
    ...(manifest.i18n !== undefined && { i18n: manifest.i18n }),
    ...(manifest.builtinViews !== undefined && {
      builtinViews: manifest.builtinViews,
    }),
    ...(manifest.requires?.connectors !== undefined && {
      requiredConnectors: manifest.requires.connectors,
    }),
  };
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
 * The manifest's `scope` declaration is enforced at install time: a pack that
 * says `scope: project` exists to serve one board, so installing it org-wide
 * is refused before anything is written. Packs declaring `scope: org` — or
 * nothing — install anywhere.
 */
function assertScopeTarget(
  manifest: AutomationPackManifest | undefined,
  projectId: string | undefined,
): void {
  if (manifest?.scope === 'project' && projectId === undefined) {
    refuse(
      'AUTOMATION_PROJECT_REQUIRED',
      'the pack declares scope: project — choose a project under "Install into" and upload again',
    );
  }
}

/**
 * The engine's own validation, against the real registered catalog — the same
 * assembly the node-type listing performs. Errors refuse; warnings return.
 */
async function validateDocument(document: unknown): Promise<string[]> {
  if (!hasCodeRunner()) setCodeRunner(nodeVmRunner());
  for (const connector of loadConnectorDefinitions()) {
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

export async function uploadAutomationImpl(
  host: UploadHost,
  args: UploadArgs,
): Promise<UploadResult> {
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

    const lower = (name: string) => name.toLowerCase().split('/').at(-1) ?? '';
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
    assertScopeTarget(manifest, args.projectId);
    if ((manifest?.skills?.length ?? 0) > 0) {
      refuse(
        'PACK_SKILLS_MISMATCH',
        'the manifest declares skills, but the text lane cannot carry them — upload the pack as a zip',
      );
    }
    const warnings = await validateDocument(document);
    const taskContract = manifest?.subjects?.task;
    const settings = manifest?.settings;
    const presentation = presentationOf(manifest);

    const saved = await host.storeSave({
      automation: document,
      message: `Uploaded package (${documentFile.name})`,
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      ...(taskContract !== undefined ? { taskContract } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(presentation !== undefined ? { presentation } : {}),
    });
    // Installing an EXISTING automation into a project adds the binding
    // (idempotent; the first save of a new name already bound it).
    if (args.projectId !== undefined) {
      await host.bindProject(saved.name, args.projectId);
    }
    return { ok: true, ...saved, warnings, skills: [] };
  }

  // ------------------------------------------------------------- zip lane
  const storageId = args.storageId;
  if (storageId === undefined) {
    refuse('AUTOMATION_UPLOAD_INVALID', 'no staged zip to read');
  }
  try {
    const intentMatch = await host.verifyStagedZip(storageId);
    if (!intentMatch) {
      refuse(
        'STORAGE_NOT_OWNED',
        'The staged blob does not belong to an upload of this organization.',
      );
    }
    const bytes = await host.readStagedZip(storageId);
    if (bytes === null) {
      refuse('STORAGE_NOT_FOUND', 'The staged blob no longer exists.');
    }
    if (bytes.byteLength > MAX_AUTOMATION_BUNDLE_TOTAL_BYTES) {
      refuse(
        'PACK_TOO_LARGE',
        `The package is ${bytes.byteLength} bytes compressed (max ${MAX_AUTOMATION_BUNDLE_TOTAL_BYTES}).`,
      );
    }

    const parsed = await parseAutomationPackZip(bytes);
    const document = parseYamlRecord(
      parsed.document.name,
      parsed.document.text,
    );
    const manifest =
      parsed.manifest === undefined
        ? undefined
        : parseManifest(parsed.manifest.name, parsed.manifest.text);
    assertScopeTarget(manifest, args.projectId);

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
    const orgSkillSlugs = new Set(await listSkillSlugs(host.orgSlug));
    for (const ref of collectSkillReferences(document)) {
      if (!carriedSet.has(ref) && !orgSkillSlugs.has(ref)) {
        warnings.push(
          `[SKILL_NOT_FOUND] the document references the skill "${ref}", which is neither carried by this package nor present in the organization`,
        );
      }
    }

    const viewerContext = await host.getViewerContext();
    const viewer: UserSkillViewer = {
      kind: 'user',
      userId: host.userId,
      teamIds: viewerContext?.teamIds ?? [],
      isOrgAdmin: viewerContext?.isOrgAdmin ?? host.isOrgAdmin,
    };
    const outcome = await planSkillWrites(
      host.orgSlug,
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
          host.orgSlug,
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
    const presentation = presentationOf(manifest);
    const saved = await host.storeSave({
      automation: document,
      message: `Uploaded package (${parsed.document.name})`,
      ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
      ...(taskContract !== undefined ? { taskContract } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(presentation !== undefined ? { presentation } : {}),
    });
    // Installing an EXISTING automation into a project adds the binding
    // (idempotent; the first save of a new name already bound it).
    if (args.projectId !== undefined) {
      await host.bindProject(saved.name, args.projectId);
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
    await host.cleanupStagedZip(storageId);
  }
}
