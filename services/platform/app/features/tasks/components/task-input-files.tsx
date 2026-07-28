'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { ChevronRight, FileText, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
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

import { splitFolderFiles } from '../lib/folder-files';

/**
 * The FILES zone of an automation-owned task bound to a project folder: the
 * bound folder's contents, and the drop zone that uploads straight into it —
 * the same folder the owning run reads — so the whole subject (drop files,
 * start, approve, review) completes inside the task modal. Replaces the
 * Attachments zone for these tasks; attachments would land where no run ever
 * looks.
 *
 * Everything the Outcome zone promotes is left to it, and everything else stays
 * here — a run's working material is folded away, never hidden. The body starts
 * open while the folder is empty (uploading IS the next step) and collapsed once
 * files exist (the deliverables are what a reviewer came for); a manual toggle
 * always wins, so the zone never folds itself away under the operator when an
 * upload lands. Long folders list the first `MAX_LISTED` and expand on "+N
 * more", and every row opens the file — the same card behaviour the pre-rewrite
 * desk had.
 */

/** Rows listed before the "+N more" toggle. */
const MAX_LISTED = 8;
export function TaskInputFilesCard({
  organizationId,
  projectId,
  folderId,
  contract,
  canEdit,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  folderId: Id<'folders'>;
  contract: TaskSubjectContract;
  canEdit: boolean;
}) {
  const { t } = useT('tasks');
  const documentsQuery = useConvexQuery(
    api.projects.queries.listProjectDocuments,
    { organizationId, projectId },
  );
  const { mutateAsync: generateUploadUrl } = useConvexMutation(
    api.files.mutations.generateUploadUrl,
  );
  const { mutateAsync: createDocumentFromUpload } = useConvexMutation(
    api.documents.mutations.createDocumentFromUpload,
  );
  const [uploading, setUploading] = useState(false);
  // null = follow the data (open while the folder is empty); a toggle pins it.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(
    null,
  );

  const files = useMemo(
    () => splitFolderFiles(documentsQuery.data ?? [], folderId, contract).rest,
    [documentsQuery.data, folderId, contract],
  );
  const open = openOverride ?? files.length === 0;
  const listed = showAll ? files : files.slice(0, MAX_LISTED);

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
    <Stack as="section" gap={0} className="border-border rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpenOverride(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <FileText
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <Text as="span" variant="label">
          {t('inputFiles.titleWithCount', { count: files.length })}
        </Text>
        <ChevronRight
          className={`text-muted-foreground ml-auto size-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <Stack gap={2} className="px-3 pt-1 pb-3">
          {files.length === 0 ? (
            <Text as="p" variant="muted">
              {t('inputFiles.empty')}
            </Text>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {listed.map((document) => {
                const name = document.title ?? t('inputFiles.untitled');
                return (
                  <li key={document._id} className="flex min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        setPreview({ id: String(document._id), name })
                      }
                      className="hover:bg-muted/50 focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
                      aria-label={t('inputFiles.open', { name })}
                    >
                      <FileText
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{name}</span>
                    </button>
                  </li>
                );
              })}
              {files.length > MAX_LISTED && (
                <li>
                  <button
                    type="button"
                    aria-expanded={showAll}
                    onClick={() => setShowAll((value) => !value)}
                    className="focus-visible:ring-ring text-muted-foreground rounded-md px-2 py-1 text-left text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
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
              <FileUpload.DropZone
                onFilesSelected={(picked) => void uploadFiles(picked)}
                accept={DOCUMENT_UPLOAD_ACCEPT}
                multiple
                disabled={uploading}
                inputId="task-input-files-upload"
                aria-label={t('inputFiles.title')}
                className="hover:border-primary/50 relative flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-4 transition-colors"
              >
                <Upload className="text-muted-foreground size-5" aria-hidden />
                <Text as="p" variant="muted" className="text-xs">
                  {uploading
                    ? t('inputFiles.uploading')
                    : t('inputFiles.dropHint')}
                </Text>
                <FileUpload.Overlay />
              </FileUpload.DropZone>
            </FileUpload.Root>
          )}
        </Stack>
      )}
      <DocumentPreviewDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
        documentId={preview?.id}
        fileName={preview?.name}
      />
    </Stack>
  );
}
