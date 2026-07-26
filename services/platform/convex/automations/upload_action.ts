'use node';

/**
 * Manual package upload — the org (or project) Automations page's file-drop
 * lane onto the store.
 *
 * A package is the pack format's own files: `workflow.yml` (the v1 engine
 * document — YAML or JSON) plus an optional `automation.yml` manifest whose
 * `subjects.task` block becomes the version's task-surface contract. The
 * document is validated by the ENGINE against the real registered catalog
 * before anything is stored — an upload that would not run is refused with
 * the engine's own issues, not stored broken. Saving pins a NEW name to the
 * chosen project (the store's install semantics); nothing is deployed — the
 * uploaded version is a draft behind the same deploy gate as every save.
 */

import { ConvexError, v } from 'convex/values';
import { parse as parseYaml } from 'yaml';

import { automationPackManifestSchema } from '../../lib/automations/packs';
import { hasCodeRunner, setCodeRunner } from '../../lib/engine/core/runner';
import { validate } from '../../lib/engine/core/validate';
import { nodeVmRunner } from '../../lib/engine/runners/node-vm';
import { registerConnector } from '../../lib/integrations/registry';
import { isRecord } from '../../lib/utils/type-utils';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { loadIntegrationConnectors } from '../integration_credentials/connector_catalog';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';

/** Pack-loader parity: one file of a pack never exceeds this. */
const MAX_UPLOAD_FILE_BYTES = 256 * 1024;
const MAX_UPLOAD_FILES = 4;

const DOCUMENT_NAMES = new Set([
  'workflow.yml',
  'workflow.yaml',
  'workflow.json',
]);
const MANIFEST_NAMES = new Set(['automation.yml', 'automation.yaml']);

function refuse(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export const uploadAutomation = action({
  args: {
    organizationId: v.string(),
    /** Bind a NEW automation to this project (the store pins the name to it
     * forever); absent = org-level. */
    projectId: v.optional(v.id('projects')),
    /** The package's text files, as picked in the dialog. */
    files: v.array(v.object({ name: v.string(), content: v.string() })),
  },
  returns: v.object({
    name: v.string(),
    version: v.number(),
    warnings: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);

    if (args.files.length === 0 || args.files.length > MAX_UPLOAD_FILES) {
      refuse(
        'AUTOMATION_UPLOAD_INVALID',
        `upload 1–${MAX_UPLOAD_FILES} files: workflow.yml (required) and automation.yml (optional)`,
      );
    }
    for (const file of args.files) {
      if (file.content.length > MAX_UPLOAD_FILE_BYTES) {
        refuse(
          'AUTOMATION_UPLOAD_INVALID',
          `${file.name} exceeds the ${MAX_UPLOAD_FILE_BYTES / 1024} KiB per-file cap`,
        );
      }
    }

    const lower = (name: string) => name.toLowerCase().split('/').at(-1) ?? '';
    const documentFile =
      args.files.find((file) => DOCUMENT_NAMES.has(lower(file.name))) ??
      // A single YAML file IS the document — the one-file upload case.
      (args.files.length === 1 &&
      /\.(ya?ml|json)$/i.test(lower(args.files[0]?.name ?? ''))
        ? args.files[0]
        : undefined);
    if (documentFile === undefined) {
      refuse(
        'AUTOMATION_UPLOAD_INVALID',
        'no workflow document found — include a workflow.yml (or upload a single .yml document)',
      );
    }
    const manifestFile = args.files.find((file) =>
      MANIFEST_NAMES.has(lower(file.name)),
    );

    let document: unknown;
    try {
      document = parseYaml(documentFile.content);
    } catch (error) {
      refuse(
        'AUTOMATION_UPLOAD_INVALID',
        `${documentFile.name} does not parse as YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isRecord(document)) {
      refuse(
        'AUTOMATION_UPLOAD_INVALID',
        `${documentFile.name} must hold a YAML mapping (the v1 automation document)`,
      );
    }

    let taskContract: unknown;
    if (manifestFile !== undefined) {
      let manifestRaw: unknown;
      try {
        manifestRaw = parseYaml(manifestFile.content);
      } catch (error) {
        refuse(
          'AUTOMATION_UPLOAD_INVALID',
          `${manifestFile.name} does not parse as YAML: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const manifest = automationPackManifestSchema.safeParse(manifestRaw);
      if (!manifest.success) {
        refuse(
          'AUTOMATION_UPLOAD_INVALID',
          `${manifestFile.name}: ${manifest.error.issues
            .slice(0, 3)
            .map(
              (issue) =>
                `${issue.path.join('.') || 'manifest'} ${issue.message}`,
            )
            .join('; ')}`,
        );
      }
      taskContract = manifest.data.subjects?.task;
    }

    // The engine's own validation, against the real registered catalog — the
    // same assembly the node-type listing performs.
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

    const saved: { name: string; version: number } = await ctx.runMutation(
      internal.automations.mutations.storeSave,
      {
        organizationId: args.organizationId,
        actor: auth.userId,
        automation: document,
        message: `Uploaded package (${documentFile.name})`,
        ...(args.projectId !== undefined ? { projectId: args.projectId } : {}),
        ...(taskContract !== undefined ? { taskContract } : {}),
      },
    );
    return {
      name: saved.name,
      version: saved.version,
      warnings: warnings.map(
        (issue) => `${issue.nodeId ?? ''} [${issue.code}] ${issue.message}`,
      ),
    };
  },
});
