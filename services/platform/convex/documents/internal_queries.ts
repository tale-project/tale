import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { toId } from '../lib/type_cast_helpers';
import { resolveProjectAccessForUser } from '../projects/resolve_project_access';
import { isActiveDocument } from './_helpers';
import {
  knowledgeAccessScopeValidator,
  type ResolvedKnowledgeAccess,
  resolveKnowledgeAccessForUser,
} from './access';
import { checkMembership } from './check_membership';
import { filterRetrievableRagFileIds as filterRetrievableRagFileIdsHelper } from './filter_retrievable_rag_file_ids';
import { getAccessibleDocumentIds as getAccessibleDocumentIdsHelper } from './get_accessible_document_ids';
import { getAgentScopedFileIds as getAgentScopedFileIdsHelper } from './get_agent_scoped_file_ids';
import * as DocumentsHelpers from './helpers';
import { listDocumentsForAgent as listDocumentsForAgentHelper } from './list_documents_for_agent';
import { listFilesByFolder } from './list_files_by_folder';
import { listIndexedDocumentsForAgent as listIndexedDocumentsForAgentHelper } from './list_indexed_documents_for_agent';
import { listOrphanedExternalDocs as listOrphanedExternalDocsHelper } from './list_orphaned_external_docs';
import { sourceProviderValidator } from './validators';

export const getDocumentByIdRaw = internalQuery({
  args: {
    documentId: v.id('documents'),
    /**
     * Caller's organizationId — closes the cross-tenant read IDOR on
     * REST `GET /api/v1/documents/:id`. Optional for in-process
     * callers (workflow / agent flows that already operate within the
     * caller's org); REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await DocumentsHelpers.getDocumentById(ctx, args.documentId);
    if (!row) return null;
    if (
      args.callerOrgId !== undefined &&
      row.organizationId !== args.callerOrgId
    ) {
      return null;
    }
    return row;
  },
});

export const queryDocuments = internalQuery({
  args: {
    organizationId: v.string(),
    sourceProvider: v.optional(sourceProviderValidator),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.queryDocuments(ctx, args);
  },
});

export const findDocumentByExternalId = internalQuery({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
    // When provided, scopes the lookup to a specific target folder (`null`
    // means the root). Omit to match across all folders (legacy behavior).
    folderId: v.optional(v.union(v.id('folders'), v.null())),
    // When provided, scopes the lookup to docs whose `folderPath` equals the
    // prefix or sits under it. Used by sync workflows to keep the cross-folder
    // fallback confined to a single sync's target subtree.
    folderPathPrefix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByExternalId(ctx, args);
  },
});

/**
 * Every document sharing one external item id — used by the single-file sync
 * reconcile to collapse duplicate rows down to the one canonical doc.
 */
export const findDocumentsByExternalId = internalQuery({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentsByExternalId(ctx, args);
  },
});

export const findDocumentByFileId = internalQuery({
  args: {
    organizationId: v.string(),
    fileId: v.string(),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByFileId(ctx, args);
  },
});

export const listForAgent = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    folderId: v.optional(v.string()),
    /** Owning project of a project-scoped listing (e.g. a task's quarter
     *  folder). Read access is resolved once here; only then does the helper
     *  surface that project's docs (hub listings still exclude them). */
    projectId: v.optional(v.string()),
    folderPath: v.optional(v.string()),
    extension: v.optional(v.string()),
    teamId: v.optional(v.string()),
    dateFrom: v.optional(v.number()),
    dateTo: v.optional(v.number()),
    fileName: v.optional(v.string()),
    sortBy: v.optional(v.union(v.literal('createdAt'), v.literal('name'))),
    sortOrder: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, projectId, ...rest } = args;
    const userTeamIds = await getUserTeamIds(ctx, userId);
    // A project-scoped listing surfaces the project's own docs only after the
    // caller proves read access to it. Denied / absent → fall through to hub
    // rules (project docs stay excluded) — fail-safe, no boundary loosening.
    let allowedProjectId: string | undefined;
    if (projectId) {
      const access = await resolveProjectAccessForUser(
        ctx,
        toId<'projects'>(projectId),
        { userId, organizationId: args.organizationId },
      );
      if (access.canRead) allowedProjectId = projectId;
    }
    return listDocumentsForAgentHelper(ctx, {
      ...rest,
      userTeamIds,
      projectId: allowedProjectId,
    });
  },
});

/**
 * `document_find` for a BINDING-scoped dispatch (a user-less task/automation
 * token): the caller resolved a knowledge scope from what the session proves
 * (`resolveKnowledgeToolAccess`) and lists with it — the scope's teams stand
 * in for a user's teams, its (sole) project surfaces that project's docs.
 * Same helper as the user path (`listForAgent`), so hub visibility rules have
 * exactly one home.
 */
export const listDocumentsForScope = internalQuery({
  args: {
    organizationId: v.string(),
    teamIds: v.array(v.string()),
    projectId: v.optional(v.string()),
    folderPath: v.optional(v.string()),
    extension: v.optional(v.string()),
    fileName: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { teamIds, ...rest } = args;
    return listDocumentsForAgentHelper(ctx, {
      ...rest,
      userTeamIds: teamIds,
    });
  },
});

const projectFileRowValidator = v.object({
  id: v.id('documents'),
  fileName: v.string(),
  folderId: v.optional(v.id('folders')),
  createdAt: v.number(),
  size: v.optional(v.number()),
  ragStatus: v.optional(v.string()),
});

interface ProjectFileRow {
  id: Id<'documents'>;
  fileName: string;
  folderId?: Id<'folders'>;
  createdAt: number;
  size?: number;
  ragStatus?: string;
}

type ListProjectFilesResult =
  | null
  | { status: 'folder_not_found' }
  | {
      status: 'ok';
      page: ProjectFileRow[];
      isDone: boolean;
      continueCursor: string;
    };

/**
 * A project's documents for an explicit user — the backing query of
 * `GET /api/v1/projects/{id}/files`. Project visibility is re-run against
 * `userId`; `null` covers absent, cross-org, garbage-id, AND invisible
 * projects so the REST surface answers all of them with one opaque 404.
 * An optional `folderId` narrows to one folder, which must belong to the
 * project (anything else is `folder_not_found` — same opaque tone as the
 * upload path). Trashed documents are filtered POST-pagination, so a page
 * may run short of `numItems` — the same trade as the hub documents REST
 * list. `size`/`ragStatus` ride along from the fileMetadata row (one
 * indexed point read per row).
 */
export const listProjectFilesForUser = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    projectId: v.string(),
    folderId: v.optional(v.string()),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: v.union(
    v.null(),
    v.object({ status: v.literal('folder_not_found') }),
    v.object({
      status: v.literal('ok'),
      page: v.array(projectFileRowValidator),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<ListProjectFilesResult> => {
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (projectId === null) return null;
    const access = await resolveProjectAccessForUser(ctx, projectId, {
      userId: args.userId,
      organizationId: args.organizationId,
    });
    if (!access.canRead) return null;

    let folderId: Id<'folders'> | undefined;
    if (args.folderId !== undefined) {
      const normalized = ctx.db.normalizeId('folders', args.folderId);
      if (normalized === null) return { status: 'folder_not_found' };
      const folder = await ctx.db.get(normalized);
      if (
        !folder ||
        folder.organizationId !== args.organizationId ||
        folder.projectId !== projectId
      ) {
        return { status: 'folder_not_found' };
      }
      folderId = normalized;
    }

    const narrowedFolderId = folderId;
    const result = narrowedFolderId
      ? await ctx.db
          .query('documents')
          .withIndex('by_organizationId_and_folderId', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('folderId', narrowedFolderId),
          )
          .order('desc')
          .paginate(args.paginationOpts)
      : await ctx.db
          .query('documents')
          .withIndex('by_organizationId_and_projectId', (q) =>
            q
              .eq('organizationId', args.organizationId)
              .eq('projectId', projectId),
          )
          .order('desc')
          .paginate(args.paginationOpts);

    const page: ProjectFileRow[] = [];
    for (const doc of result.page) {
      // The folder lane re-checks the project link (a folder is single-scope,
      // but fail closed); both lanes drop trashed rows post-pagination.
      if (doc.projectId !== projectId || !isActiveDocument(doc)) continue;
      const row: ProjectFileRow = {
        id: doc._id,
        fileName: doc.title ?? '',
        folderId: doc.folderId,
        createdAt: doc._creationTime,
      };
      if (doc.fileId) {
        const docFileId = doc.fileId;
        const meta = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', docFileId))
          .first();
        if (meta) {
          row.size = meta.size;
          row.ragStatus = meta.ragStatus;
        }
      }
      page.push(row);
    }

    return {
      status: 'ok',
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getAccessibleDocumentIds = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getAccessibleDocumentIdsHelper(ctx, args);
  },
});

export const verifyOrganizationMembership = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const member = await checkMembership(ctx, args);
    return member !== null;
  },
});

/**
 * Confirm every storage id belongs to a fileMetadata row in the given
 * org. Used by `compareDocuments` (and any other action that takes
 * client-supplied `_storage` ids) to prevent cross-org reads — Convex
 * `_storage` is a global namespace, so a member of org A can supply
 * org B's storage id and read its blob unless we cross-check
 * fileMetadata.organizationId here.
 */
export const verifyStorageIdsBelongToOrg = internalQuery({
  args: {
    organizationId: v.string(),
    // Accept plain strings since callers (e.g. compareDocuments) take
    // storage ids as v.string() over the wire and we'd otherwise need
    // them to import @convex-dev/id_branding to call this.
    storageIds: v.array(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    for (const storageId of args.storageIds) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- storage id is a wire string; the by_storageId index lookup expects the branded Id<'_storage'>
      const branded = storageId as unknown as Id<'_storage'>;
      const meta = await ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', branded))
        .first();
      if (!meta || meta.organizationId !== args.organizationId) {
        return false;
      }
    }
    return true;
  },
});

export const listIndexedForAgent = internalQuery({
  args: {
    organizationId: v.string(),
    agentTeamId: v.optional(v.string()),
    agentTeamIds: v.optional(v.array(v.string())),
    includeTeamKnowledge: v.optional(v.boolean()),
    includeOrgKnowledge: v.optional(v.boolean()),
    knowledgeFileIds: v.optional(v.array(v.string())),
    agentProjectIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return listIndexedDocumentsForAgentHelper(ctx, args);
  },
});

export const listOrphanedExternalDocs = internalQuery({
  args: {
    organizationId: v.string(),
    sourceProvider: v.string(),
    folderPathPrefix: v.string(),
    presentExternalIds: v.array(v.string()),
    driveId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await listOrphanedExternalDocsHelper(ctx, args);
  },
});

export const getAgentScopedFileIds = internalQuery({
  args: {
    organizationId: v.string(),
    agentTeamId: v.optional(v.string()),
    agentTeamIds: v.optional(v.array(v.string())),
    includeTeamKnowledge: v.optional(v.boolean()),
    includeOrgKnowledge: v.optional(v.boolean()),
    knowledgeFileIds: v.optional(v.array(v.string())),
    /**
     * Projects feature: union the project's RAG-indexed files into
     * the agent's file ID set. See `get_agent_scoped_file_ids.ts`.
     */
    agentProjectIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    return await getAgentScopedFileIdsHelper(ctx, args);
  },
});

/**
 * Files inside one folder — see {@link listFilesByFolder}. Auth-free by
 * design: the caller is the workflow sandbox-staging action, which acts
 * with workflow authority (the org boundary is still enforced via
 * `organizationId` on the index / path lookup). `truncated` marks a listing a
 * cap cut short — consumers must treat it as incomplete, never as the tree.
 */
export const listFilesByFolderInternal = internalQuery({
  args: {
    organizationId: v.string(),
    folderId: v.optional(v.id('folders')),
    folderPath: v.optional(v.string()),
    // Walk subfolders too; file names then carry the subfolder path
    // ("Documentation/Invoice 123.pdf") so writers can recreate the tree.
    recursive: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      files: v.array(
        v.object({
          fileId: blobRefValidator,
          name: v.string(),
        }),
      ),
      truncated: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return await listFilesByFolder(ctx, args);
  },
});

/**
 * A document living DIRECTLY in one folder under a given file name — the
 * workflow `document.create` dedupe probe. Titles are stored with or without
 * their extension depending on the writing lane, so the exact name is tried
 * first and the extension-stripped title second.
 */
export const findDocumentInFolderByTitle = internalQuery({
  args: {
    organizationId: v.string(),
    folderId: v.id('folders'),
    name: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      documentId: v.id('documents'),
      externalItemId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const stripped = args.name.replace(/\.[A-Za-z0-9]+$/, '');
    for (const title of [args.name, stripped]) {
      if (title === '') continue;
      const row = await ctx.db
        .query('documents')
        .withIndex('by_org_title_folder', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('title', title)
            .eq('folderId', args.folderId),
        )
        .first();
      if (
        row &&
        (row.lifecycleStatus === undefined || row.lifecycleStatus === 'active')
      ) {
        return {
          documentId: row._id,
          ...(row.externalItemId !== undefined
            ? { externalItemId: row.externalItemId }
            : {}),
        };
      }
    }
    return null;
  },
});

/**
 * The caller's knowledge-retrieval visibility (teams + projects + hub), for
 * action-side surfaces (the chat tools, the sandbox workspace bridge) that
 * cannot read the db directly. Thin wrapper over
 * `resolveKnowledgeAccessForUser` — the one owner of the scope rules.
 */
export const resolveKnowledgeAccess = internalQuery({
  args: {
    organizationId: v.string(),
    userId: v.string(),
  },
  returns: knowledgeAccessScopeValidator,
  handler: async (ctx, args): Promise<ResolvedKnowledgeAccess> => {
    return await resolveKnowledgeAccessForUser(ctx, args);
  },
});

/**
 * Filter private-corpus refs through the current Convex document projection.
 * Search and direct fetch call this after SQL so stale status/scope snapshots
 * cannot make an old generation readable.
 */
export const filterRetrievableRagFileIds = internalQuery({
  args: {
    organizationId: v.string(),
    fileIds: v.array(blobRefValidator),
    access: v.optional(
      v.object({
        ...knowledgeAccessScopeValidator.fields,
        threadIds: v.optional(v.array(v.string())),
      }),
    ),
    folder: v.optional(v.string()),
    /** The turn user. Required to serve a conversation-scoped row; without it
     *  those rows are denied. */
    userId: v.optional(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    return await filterRetrievableRagFileIdsHelper(ctx, args);
  },
});

/**
 * Scope projection of specific documents, for the corpus scope sync
 * (`syncRagDocumentScopes`): the action re-reads the rows instead of trusting
 * values a mutation staged, so racing scope changes converge on the latest
 * truth. Missing rows are skipped (deleted mid-flight — the delete path purges
 * the corpus row itself).
 */
export const getDocumentScopes = internalQuery({
  args: {
    organizationId: v.string(),
    documentIds: v.array(v.id('documents')),
  },
  returns: v.array(
    v.object({
      fileId: v.string(),
      teamIds: v.array(v.string()),
      teamId: v.union(v.string(), v.null()),
      projectId: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      fileId: string;
      teamIds: string[];
      teamId: string | null;
      projectId: string | null;
    }>
  > => {
    const scopes: Array<{
      fileId: string;
      teamIds: string[];
      teamId: string | null;
      projectId: string | null;
    }> = [];
    for (const documentId of args.documentIds) {
      const doc = await ctx.db.get(documentId);
      if (!doc || doc.organizationId !== args.organizationId) continue;
      if (!doc.fileId) continue;
      scopes.push({
        fileId: String(doc.fileId),
        ...documentTeamScope(doc),
        projectId: doc.projectId ?? null,
      });
    }
    return scopes;
  },
});

/**
 * A document row's team scope for the corpus stamp: the FULL team list
 * (retrieval is "member of ANY of them", like listing's `hasTeamAccess` —
 * `teamTags` wins, the legacy single `teamId` reads as a one-team list) plus
 * the deprecated first-element mirror the corpus keeps in `team_id`.
 */
function documentTeamScope(doc: { teamId?: string; teamTags?: string[] }): {
  teamIds: string[];
  teamId: string | null;
} {
  const teamIds = doc.teamTags ?? (doc.teamId ? [doc.teamId] : []);
  return { teamIds, teamId: teamIds[0] ?? null };
}

/**
 * One page of (fileId, teamIds, projectId) scope stamps for an organization's
 * documents — what the corpus scope BACKFILL migration walks per org. Rows
 * without a blob have no corpus row and are skipped here so the migration
 * never pages them.
 */
export const listDocumentScopePage = internalQuery({
  args: {
    organizationId: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    page: v.array(
      v.object({
        fileId: v.string(),
        teamIds: v.array(v.string()),
        teamId: v.union(v.string(), v.null()),
        projectId: v.union(v.string(), v.null()),
      }),
    ),
    continueCursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    page: Array<{
      fileId: string;
      teamIds: string[];
      teamId: string | null;
      projectId: string | null;
    }>;
    continueCursor: string | null;
    isDone: boolean;
  }> => {
    const result = await ctx.db
      .query('documents')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )
      .paginate({ cursor: args.cursor, numItems: args.numItems });
    const page: Array<{
      fileId: string;
      teamIds: string[];
      teamId: string | null;
      projectId: string | null;
    }> = [];
    for (const doc of result.page) {
      if (!doc.fileId) continue;
      page.push({
        fileId: String(doc.fileId),
        ...documentTeamScope(doc),
        projectId: doc.projectId ?? null,
      });
    }
    return {
      page,
      continueCursor: result.isDone ? null : result.continueCursor,
      isDone: result.isDone,
    };
  },
});
