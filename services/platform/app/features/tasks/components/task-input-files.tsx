'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { FileText, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
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

/**
 * The INPUT surface of an automation-owned task bound to a project folder:
 * lists the bound folder's documents and uploads straight into it — the same
 * folder the owning run reads — so the whole subject (drop files, start,
 * approve, review) completes inside the task modal. Replaces the Attachments
 * zone for these tasks; attachments would land where no run ever looks.
 */
export function TaskInputFilesCard({
  organizationId,
  projectId,
  folderId,
  canEdit,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  folderId: Id<'folders'>;
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

  const files = useMemo(
    () =>
      (documentsQuery.data ?? []).filter(
        (document) => document.folderId === folderId,
      ),
    [documentsQuery.data, folderId],
  );

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
        <Text as="h3" variant="label">
          {t('inputFiles.title')}
        </Text>
        {files.length > 0 && (
          <Text as="span" variant="muted" className="text-xs">
            {files.length}
          </Text>
        )}
      </Row>
      {files.length === 0 ? (
        <Text as="p" variant="muted">
          {t('inputFiles.empty')}
        </Text>
      ) : (
        <ul className="flex flex-col gap-1">
          {files.map((document) => (
            <li
              key={document._id}
              className="text-foreground flex min-w-0 items-center gap-2 text-sm"
            >
              <FileText
                className="text-muted-foreground size-4 shrink-0"
                aria-hidden
              />
              <span className="truncate">
                {document.title ?? t('inputFiles.untitled')}
              </span>
            </li>
          ))}
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
              {uploading ? t('inputFiles.uploading') : t('inputFiles.dropHint')}
            </Text>
            <FileUpload.Overlay />
          </FileUpload.DropZone>
        </FileUpload.Root>
      )}
    </Stack>
  );
}
