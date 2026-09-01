import type { Sql } from 'postgres';

import { defineAbilityFor } from '../../../lib/permissions/ability.ts';
import {
  uploadAutomationImpl,
  type UploadArgs,
  type UploadResult,
} from '../../core/automations/upload_impl.ts';
import {
  parseBlobRef,
  s3KeyBelongsToOrg,
} from '../../core/lib/storage/blob_ref.ts';
import {
  s3DeleteObject,
  s3GetObjectBytes,
} from '../../core/lib/storage/object_store.ts';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { bindProject, saveVersion } from './store.ts';

/**
 * The pg wiring of the shared upload lane (`upload_impl.ts`): the staged
 * zip is an ORG BLOB from the byte-lane `POST /files/upload` (the 0.4
 * `_storage` + single-use-intent handshake collapses into the org-prefixed
 * key — ownership IS the prefix), the store effects hit the pg store, and
 * the viewer context reads team memberships straight from the tables.
 */
export async function uploadAutomationPg(
  sql: Sql,
  auth: {
    organizationId: string;
    orgSlug: string;
    userId: string;
    role: string;
  },
  args: UploadArgs,
): Promise<UploadResult> {
  const stagedKeyOf = (storageId: string): string | null => {
    try {
      const parsed = parseBlobRef(storageId);
      if (parsed.backend !== 's3') return null;
      return s3KeyBelongsToOrg(parsed.key, auth.orgSlug) ? parsed.key : null;
    } catch {
      return null;
    }
  };

  return uploadAutomationImpl(
    {
      orgSlug: auth.orgSlug,
      userId: auth.userId,
      isOrgAdmin: defineAbilityFor(auth.role).can('write', 'orgSettings'),
      storeSave: async (saveArgs) =>
        await saveVersion(sql, {
          organizationId: auth.organizationId,
          name: nameOfDocument(saveArgs.automation),
          document: saveArgs.automation,
          actor: auth.userId,
          message: saveArgs.message,
          ...(saveArgs.projectId !== undefined
            ? { projectId: saveArgs.projectId }
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
        await bindProject(sql, {
          organizationId: auth.organizationId,
          name: automationName,
          projectId,
          actor: auth.userId,
        });
      },
      verifyStagedZip: async (storageId) => stagedKeyOf(storageId) !== null,
      readStagedZip: async (storageId) => {
        const key = stagedKeyOf(storageId);
        if (key === null) return null;
        try {
          const store = await resolveObjectStore(auth.orgSlug);
          return await s3GetObjectBytes(store, key);
        } catch (error) {
          console.warn('[automations] staged zip read failed:', error);
          return null;
        }
      },
      cleanupStagedZip: async (storageId) => {
        const key = stagedKeyOf(storageId);
        if (key === null) return;
        try {
          const store = await resolveObjectStore(auth.orgSlug);
          await s3DeleteObject(store, key);
        } catch (error) {
          console.warn(
            '[automations] staged upload blob cleanup failed',
            error,
          );
        }
      },
      getViewerContext: async () => {
        const teams = await sql<{ teamId: string }[]>`
          SELECT tm."teamId" FROM "teamMember" tm
          JOIN "team" t ON t."id" = tm."teamId"
          WHERE tm."userId" = ${auth.userId}
            AND t."organizationId" = ${auth.organizationId}
        `;
        return {
          teamIds: teams.map((row) => row.teamId),
          isOrgAdmin: defineAbilityFor(auth.role).can('write', 'orgSettings'),
        };
      },
    },
    args,
  );
}

/** The document's own `name` — the store derives identity from it (mirrors
 * the 0.4 `store.save`, which reads the automation's name field). */
function nameOfDocument(document: Record<string, unknown>): string {
  const name = document.name;
  if (typeof name !== 'string' || name.length === 0) {
    return '';
  }
  return name;
}
