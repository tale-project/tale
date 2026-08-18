'use client';

import { Button } from '@tale/ui/button';
import { EmptyPlaceholder } from '@tale/ui/empty-placeholder';
import { IconButton } from '@tale/ui/icon-button';
import { HStack } from '@tale/ui/layout';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import { ConvexError } from 'convex/values';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  History,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  iconForPath,
  TreeRowButton,
  treeNavigationKeyDown,
} from '@/app/components/ui/data-display/file-tree-primitives';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { EntityRowActions } from '@/app/components/ui/entity/entity-row-actions';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { DocumentDeleteDialog } from '@/app/features/documents/components/document-delete-dialog';
import { DocumentHistoryDialog } from '@/app/features/documents/components/document-history-dialog';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { DocumentRecordBadge } from '@/app/features/documents/components/document-record-badge';
import {
  useDeleteDocument,
  useDeleteFolder,
} from '@/app/features/documents/hooks/mutations';
import { useDocumentByExternalItemId } from '@/app/features/documents/hooks/queries';
import { useDocumentRecordActions } from '@/app/features/documents/hooks/use-document-record-actions';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_MAX_FILE_SIZE,
  DOCUMENT_UPLOAD_ACCEPT,
  resolveFileType,
} from '@/lib/shared/file-types';

import { useDetachDocumentFromProject } from '../hooks/mutations';
import {
  useProject,
  useProjectDocuments,
  useProjectFolders,
} from '../hooks/queries';
import { ProjectCreateFolderDialog } from './project-create-folder-dialog';

interface ProjectFilesTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
  /** Deep-link from automation navigate / shareable URL (`?folderId=`). */
  initialFolderId?: string;
  /** Deep-link to open the create-folder dialog once (`?createFolder=1`). */
  openCreateFolder?: boolean;
  /**
   * Deep-link to open version history for a document resolved by
   * `externalItemId` (e.g. `acme:{projectId}:transform.py`).
   */
  historyExternalItemId?: string;
  /**
   * Deep-link to open a document's preview by id (`?doc=`) — review
   * notifications land the reviewer here, on the frozen artifact.
   */
  previewDocumentId?: string;
}

type ProjectDocumentRow = ReturnType<
  typeof useProjectDocuments
>['documents'][number];
type ProjectFolderRow = ReturnType<typeof useProjectFolders>['folders'][number];

/**
 * Controlled-record lifecycle menu for one project file row — the same
 * actions and dialogs the Knowledge Hub row menu offers
 * (`useDocumentRecordActions`), gated on the caller's project edit access
 * instead of org `knowledgeWrite`; the server re-enforces the real rule
 * either way. Hides itself when no lifecycle action applies to the row.
 */
function ProjectFileRecordMenu({
  doc,
  displayTitle,
  canEdit,
}: {
  doc: ProjectDocumentRow;
  displayTitle: string;
  canEdit: boolean;
}) {
  const { t: tCommon } = useT('common');
  const { t: tDocuments } = useT('documents');
  const { t: tGovernance } = useT('governance');
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { mutate: deleteDocument, isPending: isDeleting } = useDeleteDocument();
  const { actions, dialogs, isHeld, isRecordProtected } =
    useDocumentRecordActions({
      documentId: String(doc._id),
      documentName: displayTitle,
      mimeType: doc.mimeType,
      extension: doc.extension,
      sourceProvider: doc.sourceProvider,
      record: doc.record,
      canWrite: canEdit,
      // Records are file-backed (approval snapshots the blob) — a row whose
      // bytes are not stored yet gets no lifecycle entry, mirroring the
      // server's DOCUMENT_RECORD_NEEDS_FILE refusal.
      enabled: doc.fileId != null,
      restoreFocusRef: menuTriggerRef,
    });

  const handleDeleteConfirm = useCallback(() => {
    deleteDocument(
      { documentId: doc._id },
      {
        onSuccess: () => setConfirmDelete(false),
        onError: (error) => {
          console.error('Failed to delete project document:', error);
          toast({
            title: tDocuments('actions.deleteFileFailed'),
            variant: 'destructive',
          });
        },
      },
    );
  }, [deleteDocument, doc._id, tDocuments]);

  // Delete belongs on THIS row, not only in the Knowledge Hub. Without it the
  // only route to removing a project file was Remove from project — which
  // detaches to the ORGANISATION (`destination: 'organization'`, restoring no
  // team scope), so the file became org-wide readable until someone found it in
  // the hub and deleted it there. The server has always supported the direct
  // path: `deleteDocument` gates a project-scoped row on project edit access
  // and refuses with PROJECT_FORBIDDEN.
  //
  // Same shape as the hub row: `useDocumentRecordActions` supplies the
  // hold/frozen signals, and the label says WHY it is disabled rather than
  // vanishing, so a blocked delete is explained instead of absent.
  // Provenance gate, mirroring the hub's intent: deleting a connector-synced
  // file just invites the next sync to restore it. NARROWER than the hub's
  // `sourceMode === 'manual' || isDirectlySelected` on purpose —
  // `listProjectDocuments` returns neither field, so a directly-selected
  // connector row that the hub WOULD let you delete is refused here. That
  // errs toward not offering a delete that re-syncs; widening it means adding
  // those two fields to the query.
  const isConnectorSourced =
    doc.sourceProvider !== undefined &&
    doc.sourceProvider !== '' &&
    doc.sourceProvider !== 'upload';

  const rowActions = [
    ...actions,
    {
      key: 'delete',
      label: isHeld
        ? tGovernance('legalHold.badges.blockedByHold')
        : isRecordProtected
          ? tDocuments('record.blockedByRecord')
          : tCommon('actions.delete'),
      icon: Trash2,
      onClick: () => setConfirmDelete(true),
      destructive: true,
      visible: canEdit && !isConnectorSourced,
      disabled: isHeld || isRecordProtected,
    },
  ];

  return (
    <>
      <EntityRowActions actions={rowActions} triggerRef={menuTriggerRef} />
      {dialogs}
      <DocumentDeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirmDelete={handleDeleteConfirm}
        isLoading={isDeleting}
        fileName={displayTitle}
      />
    </>
  );
}

/** Client-side tree assembly: projects hold at most a few hundred rows. */
function buildTree(folders: ProjectFolderRow[], docs: ProjectDocumentRow[]) {
  const childFolders = new Map<string, ProjectFolderRow[]>();
  for (const folder of folders) {
    const key = folder.parentId ? String(folder.parentId) : '';
    const list = childFolders.get(key) ?? [];
    list.push(folder);
    childFolders.set(key, list);
  }
  for (const list of childFolders.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const filesByFolder = new Map<string, ProjectDocumentRow[]>();
  for (const doc of docs) {
    const key = doc.folderId ? String(doc.folderId) : '';
    const list = filesByFolder.get(key) ?? [];
    list.push(doc); // listProjectDocuments is already newest-first
    filesByFolder.set(key, list);
  }
  return { childFolders, filesByFolder };
}

export function ProjectFilesTab({
  organizationId,
  projectId,
  initialFolderId,
  openCreateFolder,
  historyExternalItemId,
  previewDocumentId,
}: ProjectFilesTabProps) {
  const { t } = useT('projects');
  const { t: tDocuments } = useT('documents');
  const navigate = useNavigate();
  const { project } = useProject(projectId);
  const { documents, isLoading } = useProjectDocuments(projectId);
  const { folders } = useProjectFolders(projectId);
  const { mutateAsync: detachDocument } = useDetachDocumentFromProject();
  const { mutateAsync: deleteFolder } = useDeleteFolder();
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );
  const { mutateAsync: retryRagIndexing } = useConvexAction(
    api.documents.actions.retryRagIndexing,
  );

  const [uploading, setUploading] = useState(false);
  const [retryingIds, setRetryingIds] = useState(new Set<string>());
  const [confirmDetachId, setConfirmDetachId] =
    useState<Id<'documents'> | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] =
    useState<ProjectFolderRow | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{
    id: Id<'documents'>;
    title: string;
  } | null>(null);
  const [historyDoc, setHistoryDoc] = useState<{
    id: Id<'documents'>;
    title: string;
  } | null>(null);
  // Expanded folder ids; the selected folder is the upload target.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedFolderId, setSelectedFolderId] =
    useState<Id<'folders'> | null>(null);
  const [createFolderParent, setCreateFolderParent] = useState<{
    parentId?: Id<'folders'>;
  } | null>(null);
  const treeRef = useRef<HTMLUListElement | null>(null);
  const hydratedFolderIdRef = useRef<string | null>(null);
  const hydratedCreateFolderRef = useRef(false);
  const hydratedHistoryRef = useRef<string | null>(null);
  const hydratedPreviewRef = useRef<string | null>(null);

  const historyLookup = useDocumentByExternalItemId(historyExternalItemId, {
    projectId: String(projectId),
    enabled: Boolean(historyExternalItemId),
  });

  const syncFolderSearch = useCallback(
    (folderId: Id<'folders'> | null) => {
      void navigate({
        to: '/dashboard/$id/projects/$projectId/files',
        params: { id: organizationId, projectId: String(projectId) },
        search: folderId ? { folderId: String(folderId) } : {},
        replace: true,
      });
    },
    [navigate, organizationId, projectId],
  );

  const selectFolder = useCallback(
    (folderId: Id<'folders'> | null) => {
      setSelectedFolderId(folderId);
      syncFolderSearch(folderId);
    },
    [syncFolderSearch],
  );

  // One-shot deep-link hydrate: select + expand the folder (and ancestors)
  // once folders have loaded and `initialFolderId` matches a real row.
  useEffect(() => {
    if (!initialFolderId || folders.length === 0) return;
    if (hydratedFolderIdRef.current === initialFolderId) return;
    const match = folders.find((f) => String(f._id) === initialFolderId);
    if (!match) return;
    hydratedFolderIdRef.current = initialFolderId;
    setSelectedFolderId(match._id);
    const toExpand = new Set<string>();
    let cursor: ProjectFolderRow | undefined = match;
    while (cursor) {
      toExpand.add(String(cursor._id));
      const parentId: Id<'folders'> | undefined = cursor.parentId;
      cursor = parentId ? folders.find((f) => f._id === parentId) : undefined;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of toExpand) next.add(id);
      return next;
    });
  }, [folders, initialFolderId]);

  // One-shot deep-link: open the create-folder dialog at project root, then
  // strip `createFolder` from the URL so refresh does not re-open it.
  useEffect(() => {
    if (!openCreateFolder || hydratedCreateFolderRef.current) return;
    hydratedCreateFolderRef.current = true;
    setCreateFolderParent({});
    void navigate({
      to: '/dashboard/$id/projects/$projectId/files',
      params: { id: organizationId, projectId: String(projectId) },
      search: initialFolderId ? { folderId: initialFolderId } : {},
      replace: true,
    });
  }, [openCreateFolder, navigate, organizationId, projectId, initialFolderId]);

  // One-shot deep-link: open History for a document resolved by externalItemId
  // (Case Setup transform.py), then strip the search param.
  useEffect(() => {
    if (!historyExternalItemId) return;
    if (hydratedHistoryRef.current === historyExternalItemId) return;
    if (historyLookup.isLoading) return;

    hydratedHistoryRef.current = historyExternalItemId;
    const resolved = historyLookup.data;
    if (resolved) {
      setHistoryDoc({
        id: resolved.documentId,
        title: resolved.title ?? t('files.unknownTitle'),
      });
      if (resolved.folderId) {
        setSelectedFolderId(resolved.folderId);
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(String(resolved.folderId));
          return next;
        });
      }
    } else {
      toast({
        title: tDocuments('history.notFound'),
        variant: 'destructive',
      });
    }

    void navigate({
      to: '/dashboard/$id/projects/$projectId/files',
      params: { id: organizationId, projectId: String(projectId) },
      search: initialFolderId
        ? { folderId: initialFolderId }
        : resolved?.folderId
          ? { folderId: String(resolved.folderId) }
          : {},
      replace: true,
    });
  }, [
    historyExternalItemId,
    historyLookup.isLoading,
    historyLookup.data,
    navigate,
    organizationId,
    projectId,
    initialFolderId,
    t,
    tDocuments,
  ]);

  // One-shot deep-link: `?doc=` opens the document preview (review
  // notifications land the reviewer here, on the frozen artifact), reveals
  // its folder, then strips the param. An id the list cannot resolve still
  // opens the dialog — it self-fetches and owns the not-found state, the
  // same semantics as the knowledge library's `?doc=`.
  useEffect(() => {
    if (!previewDocumentId) return;
    if (hydratedPreviewRef.current === previewDocumentId) return;
    if (isLoading) return;

    hydratedPreviewRef.current = previewDocumentId;
    const match = documents.find((d) => String(d._id) === previewDocumentId);
    setPreviewDoc({
      id: match?._id ?? toId<'documents'>(previewDocumentId),
      title: match?.title ?? match?.extension ?? t('files.unknownTitle'),
    });
    if (match?.folderId) {
      const matchFolderId = match.folderId;
      setSelectedFolderId(matchFolderId);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(String(matchFolderId));
        return next;
      });
    }

    void navigate({
      to: '/dashboard/$id/projects/$projectId/files',
      params: { id: organizationId, projectId: String(projectId) },
      search: initialFolderId
        ? { folderId: initialFolderId }
        : match?.folderId
          ? { folderId: String(match.folderId) }
          : {},
      replace: true,
    });
  }, [
    previewDocumentId,
    isLoading,
    documents,
    navigate,
    organizationId,
    projectId,
    initialFolderId,
    t,
  ]);

  const { childFolders, filesByFolder } = useMemo(
    () => buildTree(folders, documents),
    [folders, documents],
  );

  const selectedFolderName = useMemo(() => {
    if (!selectedFolderId) return null;
    return folders.find((f) => f._id === selectedFolderId)?.name ?? null;
  }, [folders, selectedFolderId]);

  const toggleFolder = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const uploadOne = useCallback(
    async (file: File): Promise<void> => {
      const resolvedType =
        resolveFileType(file.name, file.type) || 'application/octet-stream';
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': resolvedType },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`upload failed: ${response.status}`);
      }
      const uploadJson: unknown = await response.json();
      if (
        typeof uploadJson !== 'object' ||
        uploadJson === null ||
        !('storageId' in uploadJson) ||
        typeof uploadJson.storageId !== 'string'
      ) {
        throw new Error('upload response missing storageId');
      }
      const { storageId } = uploadJson;
      // One mutation, scoped at insert: the former create-then-attach pair
      // left the file org-wide in the Knowledge Hub whenever the attach half
      // failed (issue #2546). The selected folder is the upload target.
      await createDocumentFromUpload({
        organizationId,
        fileId: toId<'_storage'>(storageId),
        fileName: file.name,
        contentType: resolvedType,
        metadata: {
          size: file.size,
          sourceProvider: 'upload',
          sourceMode: 'manual',
          lastModified: file.lastModified,
        },
        teamId: undefined,
        folderId: selectedFolderId ?? undefined,
        fileSize: file.size,
        projectId,
      });
    },
    [
      generateUploadUrl,
      createDocumentFromUpload,
      organizationId,
      projectId,
      selectedFolderId,
    ],
  );

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || uploading) return;

      // Reuse the agent-knowledge size cap (10 MB) so the project upload
      // ceiling matches the rest of the platform's document-upload flow.
      for (const file of files) {
        if (file.size > DOCUMENT_MAX_FILE_SIZE) {
          const maxSizeMB = DOCUMENT_MAX_FILE_SIZE / (1024 * 1024);
          toast({
            title: t('files.uploadFailedTitle', {
              defaultValue: 'Upload failed',
            }),
            description: `${file.name} exceeds ${maxSizeMB} MB limit.`,
            variant: 'destructive',
          });
          return;
        }
      }

      setUploading(true);
      let okCount = 0;
      for (const file of files) {
        try {
          await uploadOne(file);
          okCount++;
        } catch (error) {
          console.error('project file upload failed', file.name, error);
          if (error instanceof ConvexError) {
            const code = error.data?.code;
            if (
              code === 'DOCUMENT_SCOPE_CONFLICT' ||
              code === 'FOLDER_NOT_FOUND'
            ) {
              toast({
                title: t(
                  code === 'FOLDER_NOT_FOUND'
                    ? 'files.folderGone'
                    : 'errors.DOCUMENT_SCOPE_CONFLICT',
                  {
                    defaultValue:
                      code === 'FOLDER_NOT_FOUND'
                        ? 'That folder no longer exists.'
                        : undefined,
                  },
                ),
                description: file.name,
                variant: 'destructive',
              });
              continue;
            }
            if (code === 'RBAC_FORBIDDEN' || code === 'PROJECT_FORBIDDEN') {
              toast({
                title: t('errors.' + code, {
                  defaultValue: t('files.attachError'),
                }),
                description: file.name,
                variant: 'destructive',
              });
              continue;
            }
          }
          toast({
            title: t('files.attachError'),
            description: file.name,
            variant: 'destructive',
          });
        }
      }
      setUploading(false);
      if (okCount > 0) {
        toast({
          title: t('files.attachSuccess'),
          description: `${okCount} / ${files.length}`,
          variant: 'success',
        });
      }
    },
    [uploadOne, uploading, t],
  );

  const handleDetach = useCallback(
    async (documentId: Id<'documents'>) => {
      try {
        await detachDocument({ documentId, destination: 'organization' });
        toast({ title: t('files.detachSuccess'), variant: 'success' });
      } catch (error) {
        if (error instanceof ConvexError) {
          const code = error.data?.code;
          if (code === 'PROJECT_FORBIDDEN' || code === 'RBAC_FORBIDDEN') {
            toast({
              title: t('errors.' + code, {
                defaultValue: t('files.detachError'),
              }),
              variant: 'destructive',
            });
            return;
          }
        }
        console.error('detachDocument failed', error);
        toast({ title: t('files.detachError'), variant: 'destructive' });
      }
    },
    [detachDocument, t],
  );

  const handleDeleteFolder = useCallback(
    async (folderId: Id<'folders'>) => {
      try {
        await deleteFolder({ folderId });
        if (selectedFolderId === folderId) selectFolder(null);
        toast({
          title: t('files.folderDeleted', { defaultValue: 'Folder deleted' }),
          variant: 'success',
        });
      } catch (error) {
        console.error('deleteFolder failed', error);
        const code =
          error instanceof ConvexError ? error.data?.code : undefined;
        toast({
          title:
            code === 'LEGAL_HOLD_ACTIVE'
              ? t('files.folderDeleteHeld', {
                  defaultValue:
                    'A file in this folder is on legal hold — release it first.',
                })
              : t('files.folderDeleteFailed', {
                  defaultValue: "Couldn't delete the folder",
                }),
          variant: 'destructive',
        });
      }
    },
    [deleteFolder, selectFolder, selectedFolderId, t],
  );

  const handleRetryIndexing = useCallback(
    async (documentId: Id<'documents'>) => {
      if (retryingIds.has(String(documentId))) return;
      setRetryingIds((prev) => new Set(prev).add(String(documentId)));
      try {
        await retryRagIndexing({ documentId });
        toast({ title: t('files.indexingRetryQueued'), variant: 'success' });
      } catch (error) {
        console.error('retryRagIndexing failed', error);
        toast({
          title: t('files.indexingRetryFailed'),
          variant: 'destructive',
        });
      } finally {
        setRetryingIds((prev) => {
          const next = new Set(prev);
          next.delete(String(documentId));
          return next;
        });
      }
    },
    [retryRagIndexing, t, retryingIds],
  );

  if (!project) return null;
  const canEdit = project.canEdit;

  const statusLabel = (status: string | null) => {
    if (status === 'queued') return t('files.ragStatusQueued');
    if (status === 'running') return t('files.ragStatusRunning');
    if (status === 'completed') return t('files.ragStatusCompleted');
    if (status === 'failed') return t('files.ragStatusFailed');
    return '';
  };
  const statusHint = (status: string | null) => {
    if (status === 'queued') return t('files.ragStatusQueuedHint');
    if (status === 'running') return t('files.ragStatusRunningHint');
    return undefined;
  };

  const renderFileRow = (doc: ProjectDocumentRow, depth: number) => {
    const isRetrying = retryingIds.has(String(doc._id));
    const failed = doc.ragStatus === 'failed';
    const displayTitle = doc.title ?? doc.extension ?? t('files.unknownTitle');
    // A file can only be opened/downloaded once its bytes have been stored,
    // so gate the preview affordance on the storage id per row.
    const canPreview = doc.fileId != null;
    const FileIcon = iconForPath(displayTitle);
    const openPreview = () =>
      setPreviewDoc({ id: doc._id, title: displayTitle });
    return (
      <li key={doc._id} role="none">
        <HStack gap={1} align="center" className="group">
          <div className="min-w-0 flex-1">
            {canPreview ? (
              <TreeRowButton
                isActive={previewDoc?.id === doc._id}
                depth={depth}
                onClick={openPreview}
                title={displayTitle}
                ariaLabel={displayTitle}
                dataParentPath={doc.folderId ? String(doc.folderId) : null}
              >
                <FileIcon
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                <DocumentRecordBadge record={doc.record} />
                <Text
                  as="span"
                  variant="caption"
                  className="shrink-0"
                  title={statusHint(doc.ragStatus)}
                >
                  {statusLabel(doc.ragStatus)}
                </Text>
              </TreeRowButton>
            ) : (
              // No stored bytes yet — nothing to open, so no treeitem
              // affordance; a plain row mirrors the pre-tree behaviour.
              <div
                className="text-muted-foreground flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs"
                style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
              >
                <FileIcon
                  className="text-muted-foreground size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{displayTitle}</span>
                <DocumentRecordBadge record={doc.record} />
                <Text
                  as="span"
                  variant="caption"
                  className="shrink-0"
                  title={statusHint(doc.ragStatus)}
                >
                  {statusLabel(doc.ragStatus)}
                </Text>
              </div>
            )}
          </div>
          {canPreview ? (
            <IconButton
              icon={Eye}
              variant="ghost"
              size="sm"
              aria-label={t('files.previewAction')}
              onClick={openPreview}
            />
          ) : null}
          {canPreview ? (
            <IconButton
              icon={History}
              variant="ghost"
              size="sm"
              aria-label={t('files.historyAction')}
              onClick={() =>
                setHistoryDoc({ id: doc._id, title: displayTitle })
              }
            />
          ) : null}
          {failed && canEdit ? (
            <IconButton
              icon={RotateCcw}
              variant="ghost"
              size="sm"
              aria-label={t('files.indexingRetry')}
              onClick={() => void handleRetryIndexing(doc._id)}
              disabled={isRetrying}
            />
          ) : null}
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setConfirmDetachId(doc._id)}
            >
              {t('files.detachAction')}
            </Button>
          ) : null}
          {/* Editors only: skipping the mount for viewers also skips the
              per-row legal-hold subscription the menu carries. */}
          {canEdit ? (
            <ProjectFileRecordMenu
              doc={doc}
              displayTitle={displayTitle}
              canEdit={canEdit}
            />
          ) : null}
        </HStack>
      </li>
    );
  };

  const renderFolder = (folder: ProjectFolderRow, depth: number) => {
    const id = String(folder._id);
    const isExpanded = expanded.has(id);
    const isSelected = selectedFolderId === folder._id;
    const FolderIcon = isExpanded ? FolderOpen : Folder;
    const subFolders = childFolders.get(id) ?? [];
    const files = filesByFolder.get(id) ?? [];
    return (
      <li key={folder._id} role="none">
        <HStack gap={1} align="center" className="group">
          <div className="min-w-0 flex-1">
            <TreeRowButton
              isActive={isSelected}
              depth={depth}
              onClick={() => {
                // Click = select as upload target; toggles expansion too so
                // the target is always visible.
                const next = isSelected ? null : folder._id;
                selectFolder(next);
                if (!isExpanded) toggleFolder(id);
                else if (isSelected) toggleFolder(id);
              }}
              title={folder.name}
              ariaLabel={folder.name}
              ariaExpanded={isExpanded}
              dataDirPath={id}
              dataParentPath={folder.parentId ? String(folder.parentId) : null}
            >
              {isExpanded ? (
                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight
                  className="size-3.5 shrink-0"
                  aria-hidden="true"
                />
              )}
              <FolderIcon
                className="text-muted-foreground size-3.5 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            </TreeRowButton>
          </div>
          {canEdit ? (
            <>
              <IconButton
                icon={FolderPlus}
                variant="ghost"
                size="sm"
                aria-label={t('files.newSubfolderAction', {
                  defaultValue: 'New folder inside',
                })}
                onClick={() => setCreateFolderParent({ parentId: folder._id })}
              />
              <IconButton
                icon={Trash2}
                variant="ghost"
                size="sm"
                aria-label={t('files.folderDeleteAction', {
                  defaultValue: 'Delete folder',
                })}
                onClick={() => setConfirmDeleteFolder(folder)}
              />
            </>
          ) : null}
        </HStack>
        {isExpanded ? (
          <ul role="group">
            {subFolders.map((sub) => renderFolder(sub, depth + 1))}
            {files.map((doc) => renderFileRow(doc, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  const rootFolders = childFolders.get('') ?? [];
  const rootFiles = filesByFolder.get('') ?? [];
  const isEmpty = rootFolders.length === 0 && documents.length === 0;

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('files.title')}
        description={t('files.emptyDescription')}
        action={
          canEdit ? (
            <Button
              variant="secondary"
              size="sm"
              className="gap-2"
              onClick={() => setCreateFolderParent({})}
            >
              <FolderPlus className="size-4" aria-hidden="true" />
              {tDocuments('folder.newFolder')}
            </Button>
          ) : undefined
        }
      />

      <FormSection>
        {!isEmpty ? (
          <ul
            ref={treeRef}
            role="tree"
            aria-label={t('files.treeLabel', { defaultValue: 'Project files' })}
            className="rounded-lg border p-2"
            onKeyDown={(event) =>
              treeNavigationKeyDown(event, treeRef.current, expanded, (id) =>
                toggleFolder(id),
              )
            }
          >
            {rootFolders.map((folder) => renderFolder(folder, 0))}
            {rootFiles.map((doc) => renderFileRow(doc, 0))}
          </ul>
        ) : !isLoading ? (
          <EmptyPlaceholder icon={FileText}>
            {t('files.emptyTitle')}
          </EmptyPlaceholder>
        ) : null}

        {canEdit ? (
          <FileUpload.Root>
            <FileUpload.DropZone
              onFilesSelected={(files) => void handleFilesSelected(files)}
              accept={DOCUMENT_UPLOAD_ACCEPT}
              multiple
              disabled={uploading}
              inputId="project-files-upload"
              aria-label={t('files.addButton')}
              className="hover:border-primary/50 relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors"
            >
              <Upload
                className="text-muted-foreground size-6"
                aria-hidden="true"
              />
              <Text as="span" variant="muted">
                {uploading
                  ? t('files.uploadingIndicator', {
                      defaultValue: 'Uploading…',
                    })
                  : selectedFolderName
                    ? t('files.addToFolder', {
                        defaultValue: 'Add file to "{folder}"',
                        folder: selectedFolderName,
                      })
                    : t('files.addButton')}
              </Text>
              <FileUpload.Overlay />
            </FileUpload.DropZone>
          </FileUpload.Root>
        ) : null}
      </FormSection>

      <DocumentPreviewDialog
        open={previewDoc !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewDoc(null);
        }}
        documentId={previewDoc?.id}
        fileName={previewDoc?.title}
      />

      <DocumentHistoryDialog
        open={historyDoc !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryDoc(null);
        }}
        organizationId={organizationId}
        documentId={historyDoc?.id ?? null}
        title={historyDoc?.title}
      />

      <ProjectCreateFolderDialog
        organizationId={organizationId}
        projectId={projectId}
        parentFolderId={createFolderParent?.parentId}
        open={createFolderParent !== null}
        onOpenChange={(open) => {
          if (!open) setCreateFolderParent(null);
        }}
      />

      <ConfirmDialog
        open={confirmDetachId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDetachId(null);
        }}
        title={t('files.detachAction')}
        description={t('files.detachConfirm', {
          defaultValue:
            'Remove this file from the project? It moves to Knowledge and becomes visible to everyone in the organization.',
        })}
        variant="destructive"
        confirmText={t('files.detachAction')}
        onConfirm={() => {
          if (confirmDetachId !== null) {
            void handleDetach(confirmDetachId);
          }
          setConfirmDetachId(null);
        }}
      />

      <ConfirmDialog
        open={confirmDeleteFolder !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteFolder(null);
        }}
        title={t('files.folderDeleteAction', {
          defaultValue: 'Delete folder',
        })}
        description={t('files.folderDeleteConfirm', {
          defaultValue:
            'Delete "{folder}" and everything inside it? The files are removed from the project and from the knowledge index. This cannot be undone.',
          folder: confirmDeleteFolder?.name ?? '',
        })}
        variant="destructive"
        confirmText={t('files.folderDeleteAction', {
          defaultValue: 'Delete folder',
        })}
        onConfirm={() => {
          if (confirmDeleteFolder !== null) {
            void handleDeleteFolder(confirmDeleteFolder._id);
          }
          setConfirmDeleteFolder(null);
        }}
      />
    </ContentArea>
  );
}
