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
 *
 * The LANE ITSELF lives in `upload_impl.ts` (host-neutral); this action is
 * the Convex wiring: auth, `_storage`, and the internal store mutations.
 */

import { v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { uploadAutomationImpl, type UploadResult } from './upload_impl';

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

export const uploadAutomation = action({
  args: {
    organizationId: v.string(),
    /** Install target: bind the automation to this project (idempotent —
     * see the impl's binding note). */
    projectId: v.optional(v.id('projects')),
    /** Text lane: the package's text files, as picked in the dialog. */
    files: v.optional(
      v.array(v.object({ name: v.string(), content: v.string() })),
    ),
    /** Zip lane: a staged `_storage` blob recorded via the upload intent. */
    storageId: v.optional(v.id('_storage')),
    /** Zip lane: skill slugs the caller confirmed for overwrite, from a prior
     * `needs_confirm` answer. */
    overwriteSkills: v.optional(v.array(v.string())),
  },
  returns: uploadResultValidator,
  handler: async (ctx, args): Promise<UploadResult> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    return uploadAutomationImpl(
      {
        orgSlug: auth.orgSlug,
        userId: auth.userId,
        isOrgAdmin: defineAbilityFor(auth.member.role).can(
          'write',
          'orgSettings',
        ),
        storeSave: async (saveArgs) =>
          await ctx.runMutation(internal.automations.mutations.storeSave, {
            organizationId: args.organizationId,
            actor: auth.userId,
            automation: saveArgs.automation,
            message: saveArgs.message,
            ...(saveArgs.projectId !== undefined
              ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the impl carries ids as strings; this wiring narrows back
                { projectId: saveArgs.projectId as Id<'projects'> }
              : {}),
            ...(saveArgs.taskContract !== undefined
              ? { taskContract: saveArgs.taskContract }
              : {}),
            ...(saveArgs.settings !== undefined
              ? { settings: saveArgs.settings }
              : {}),
            ...(saveArgs.presentation !== undefined
              ? { presentation: saveArgs.presentation }
              : {}),
          }),
        bindProject: async (automationName, projectId) => {
          await ctx.runMutation(
            internal.automations.mutations.storeBindProject,
            {
              organizationId: args.organizationId,
              actor: auth.userId,
              automationName,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- string id back to the table id at the boundary
              projectId: projectId as Id<'projects'>,
            },
          );
        },
        verifyStagedZip: async (storageId) =>
          await ctx.runMutation(
            internal.automations.upload_mutations.verifyAutomationUploadIntent,
            {
              organizationId: args.organizationId,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- string id back to the storage id at the boundary
              storageId: storageId as Id<'_storage'>,
            },
          ),
        readStagedZip: async (storageId) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- string id back to the storage id at the boundary
          const blob = await ctx.storage.get(storageId as Id<'_storage'>);
          if (blob === null) return null;
          return new Uint8Array(await blob.arrayBuffer());
        },
        cleanupStagedZip: async (storageId) => {
          await ctx.storage
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- string id back to the storage id at the boundary
            .delete(storageId as Id<'_storage'>)
            .catch((error: unknown) => {
              console.warn(
                '[automations] staged upload blob cleanup failed',
                error,
              );
            });
          await ctx
            .runMutation(
              internal.automations.upload_mutations
                .deleteAutomationUploadIntent,
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- string id back to the storage id at the boundary
              { storageId: storageId as Id<'_storage'> },
            )
            .catch((error: unknown) => {
              console.warn('[automations] upload intent cleanup failed', error);
            });
        },
        getViewerContext: async () =>
          await ctx.runQuery(
            internal.skills.viewer_context.getUserSkillViewerContext,
            { organizationId: args.organizationId, userId: auth.userId },
          ),
      },
      {
        ...(args.projectId !== undefined
          ? { projectId: String(args.projectId) }
          : {}),
        ...(args.files !== undefined ? { files: args.files } : {}),
        ...(args.storageId !== undefined
          ? { storageId: String(args.storageId) }
          : {}),
        ...(args.overwriteSkills !== undefined
          ? { overwriteSkills: args.overwriteSkills }
          : {}),
      },
    );
  },
});
