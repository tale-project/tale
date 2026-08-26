'use client';

import { IconButton } from '@tale/ui/icon-button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FolderInput, Trash2, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
import { useDeleteDocument } from '@/app/features/documents/hooks/mutations';
import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import {
  DOCUMENT_UPLOAD_ACCEPT,
  resolveFileType,
} from '@/lib/shared/file-types';
import type { TaskSubjectContract } from '@/lib/shared/schemas/task_contract';

import { folderSubtreeIds, splitFolderFiles } from '../lib/folder-files';
import { FileOpenButton } from './file-open-button';

/**
 * The FILES zone of an automation-owned task bound to a project folder: the
 * bound folder's contents, and the drop zone that uploads straight into it —
 * the same folder the owning run reads — so the whole subject (drop files,
 * start, approve, review) completes inside the task modal. Replaces the
 * Attachments zone for these tasks; attachments would land where no run ever
 * looks.
 *
 * Everything the Outcome zone promotes is left to it, and everything else stays
 * here — a run's working material is shortened, never hidden.
 *
 * ALWAYS OPEN, like the Outcome zone it sits beside: a heading with the count,
 * the first `MAX_LISTED` names, "+N more" for the rest, then the drop target. A
 * disclosure that collapsed itself as soon as files existed hid the count's own
 * subject AND the place to put more input behind a click, and made two adjacent
 * lists of the same folder's files look like two different kinds of thing.
 *
 * Every file owns a LINE, and only its NAME is the target ({@link
 * FileOpenButton}) — a full-width row painted a hover band across the column for
 * a target three words wide. Which few names show is {@link splitFolderFiles}'s
 * preview order: the operator's uploads before the run's derived material, so
 * the zone answers "did my upload land?" instead of listing `.ocr.json`.
 */

/**
 * Names listed before the "+N more" toggle. A few, deliberately: every file owns
 * a line, and a busy folder runs to two dozen, so a preview that showed
 * eight pushed the deliverables below the fold to list working material.
 */
const MAX_LISTED = 5;
export function TaskInputFilesCard({
  organizationId,
  projectId,
  folderId,
  contract,
  automationName,
  canEdit,
  canRemove,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  folderId: Id<'folders'>;
  contract: TaskSubjectContract;
  /** The owning automation as it names itself — the empty zone says whose
   *  input this is instead of naming the machinery ("the run"). */
  automationName: string;
  canEdit: boolean;
  /** Per-file removal, allowed only while the task is still being prepared
   *  or worked (backlog/todo/in progress). From In review on, the folder is
   *  the delivered return's evidence base and must not shrink — reviewers
   *  decide on what the run actually read. A UX affordance, not a security
   *  boundary: Knowledge remains the project's full file manager. */
  canRemove: boolean;
}) {
  const { t } = useT('tasks');
  const documentsQuery = useConvexQuery(
    api.projects.queries.listProjectDocuments,
    { organizationId, projectId },
  );
  const foldersQuery = useConvexQuery(api.projects.queries.listProjectFolders, {
    organizationId,
    projectId,
  });
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );
  const { mutateAsync: deleteDocument, isPending: isDeletingDocument } =
    useDeleteDocument();
  const [uploading, setUploading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<{
    id: Id<'documents'>;
    title: string;
  } | null>(null);

  const files = useMemo(
    () =>
      splitFolderFiles(
        documentsQuery.data ?? [],
        folderSubtreeIds(foldersQuery.data ?? [], folderId),
        contract,
      ).rest,
    [documentsQuery.data, foldersQuery.data, folderId, contract],
  );
  const listed = showAll ? files : files.slice(0, MAX_LISTED);

  const handleDelete = async () => {
    if (confirmDelete === null || isDeletingDocument) return;
    try {
      await deleteDocument({ documentId: confirmDelete.id });
    } catch (error) {
      console.error('[tasks] input-file delete failed', error);
      toast({ title: t('inputFiles.removeFailed'), variant: 'destructive' });
    } finally {
      setConfirmDelete(null);
    }
  };

  const uploadFiles = async (picked: File[]) => {
    setUploading(true);
    try {
      for (const file of picked) {
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
        await createDocumentFromUpload({
          organizationId,
          fileId: toId<'_storage'>(uploadJson.storageId),
          fileName: file.name,
          contentType: resolvedType,
          metadata: {
            size: file.size,
            sourceProvider: 'upload',
            sourceMode: 'manual',
            lastModified: file.lastModified,
          },
          teamId: undefined,
          folderId,
          fileSize: file.size,
          projectId,
        });
      }
    } catch (error) {
      console.error('[tasks] input-file upload failed', error);
      toast({ title: t('inputFiles.uploadFailed'), variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Stack as="section" gap={2}>
      <Row gap={2}>
        {/* A folder, not a document: this zone IS the project folder the run
            reads, and the arrow into it says which way input travels. */}
        <FolderInput
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        {/* Semibold: the two file zones are what an automation-owned task is
            FOR, so they title themselves a step louder than the task-admin
            sections below them (Subtasks, Comments, Activity). */}
        <Text as="h3" variant="label" className="font-semibold">
          {t('inputFiles.titleWithCount', { count: files.length })}
        </Text>
      </Row>
      {files.length === 0 ? (
        <Text as="p" variant="muted">
          {t('inputFiles.empty', { name: automationName })}
        </Text>
      ) : (
        <ul className="flex min-w-0 flex-col items-start gap-2">
          {listed.map((document) => {
            const name = document.title ?? t('inputFiles.untitled');
            return (
              <li
                key={document._id}
                className="flex max-w-full min-w-0 items-center gap-1"
              >
                <FileOpenButton
                  name={name}
                  label={t('inputFiles.open', { name })}
                  onOpen={() => setPreview({ id: String(document._id), name })}
                />
                {canRemove && (
                  <IconButton
                    icon={Trash2}
                    variant="ghost"
                    size="sm"
                    aria-label={t('inputFiles.remove', { name })}
                    disabled={uploading}
                    onClick={() =>
                      setConfirmDelete({ id: document._id, title: name })
                    }
                  />
                )}
              </li>
            );
          })}
          {/* Its own line under the list, not trailing the last name: it acts on
              the WHOLE list, and inline it read as a sibling of the file beside
              it. Underlined at rest for the same reason — a toggle among file
              names has to look unlike a file name. */}
          {files.length > MAX_LISTED && (
            <li>
              <button
                type="button"
                aria-expanded={showAll}
                onClick={() => setShowAll((value) => !value)}
                className="focus-visible:ring-ring text-muted-foreground rounded-md px-1.5 py-0.5 text-left text-sm underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                {showAll
                  ? t('inputFiles.showLess')
                  : t('inputFiles.more', {
                      count: files.length - MAX_LISTED,
                    })}
              </button>
            </li>
          )}
        </ul>
      )}
      {canEdit && (
        <FileUpload.Root>
          {/* One compact drop row, whatever the folder holds. The zone is
              always open now, so a 90px dashed box would sit on every task
              forever; a single line is target enough to drop onto and to
              click. */}
          <FileUpload.DropZone
            onFilesSelected={(picked) => void uploadFiles(picked)}
            accept={DOCUMENT_UPLOAD_ACCEPT}
            multiple
            disabled={uploading}
            inputId="task-input-files-upload"
            aria-label={t('inputFiles.title')}
            className="hover:border-primary/50 relative flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 transition-colors"
          >
            <Upload className="text-muted-foreground size-4" aria-hidden />
            <Text as="p" variant="muted" className="text-xs">
              {uploading ? t('inputFiles.uploading') : t('inputFiles.dropHint')}
            </Text>
            <FileUpload.Overlay />
          </FileUpload.DropZone>
        </FileUpload.Root>
      )}
      <DocumentPreviewDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
        documentId={preview?.id}
        fileName={preview?.name}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingDocument) setConfirmDelete(null);
        }}
        title={t('inputFiles.removeTitle')}
        description={t('inputFiles.removeDescription', {
          name: confirmDelete?.title ?? t('inputFiles.untitled'),
        })}
        confirmText={t('inputFiles.removeConfirm')}
        variant="destructive"
        isLoading={isDeletingDocument}
        onConfirm={() => void handleDelete()}
      />
    </Stack>
  );
}
