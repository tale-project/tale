'use client';

import { Button } from '@tale/ui/button';
import { EmptyPlaceholder } from '@tale/ui/empty-placeholder';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { Text } from '@tale/ui/text';
import { ConvexError } from 'convex/values';
import { Eye, FileText, RotateCcw, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog';
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
import { useProject, useProjectDocuments } from '../hooks/queries';

interface ProjectFilesTabProps {
  organizationId: string;
  projectId: Id<'projects'>;
}

export function ProjectFilesTab({
  organizationId,
  projectId,
}: ProjectFilesTabProps) {
  const { t } = useT('projects');
  const { project } = useProject(projectId);
  const { documents, isLoading } = useProjectDocuments(projectId);
  const { mutateAsync: detachDocument } = useDetachDocumentFromProject();
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
  const [previewDoc, setPreviewDoc] = useState<{
    id: Id<'documents'>;
    title: string;
  } | null>(null);

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
      // failed (issue #2546).
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
        folderId: undefined,
        fileSize: file.size,
        projectId,
      });
    },
    [generateUploadUrl, createDocumentFromUpload, organizationId, projectId],
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
            if (code === 'DOCUMENT_SCOPE_CONFLICT') {
              toast({
                title: t('errors.DOCUMENT_SCOPE_CONFLICT'),
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

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        title={t('files.title')}
        description={t('files.emptyDescription')}
      />

      <FormSection>
        {documents.length > 0 ? (
          <div className="divide-y rounded-lg border">
            {documents.map((doc) => {
              const isRetrying = retryingIds.has(String(doc._id));
              const failed = doc.ragStatus === 'failed';
              const displayTitle =
                doc.title ?? doc.extension ?? t('files.unknownTitle');
              // A file can only be opened/downloaded once its bytes have been
              // stored, so gate the preview affordance on the storage id that
              // `listProjectDocuments` returns per row.
              const canPreview = doc.fileId != null;
              const openPreview = () =>
                setPreviewDoc({ id: doc._id, title: displayTitle });
              return (
                <HStack
                  key={doc._id}
                  gap={3}
                  align="center"
                  className="px-4 py-3"
                >
                  <FileText
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <Stack gap={0} className="min-w-0 flex-1">
                    {canPreview ? (
                      <button
                        type="button"
                        onClick={openPreview}
                        className="min-w-0 cursor-pointer text-left hover:underline"
                      >
                        <Text as="span" variant="body" truncate>
                          {displayTitle}
                        </Text>
                      </button>
                    ) : (
                      <Text as="span" variant="body" truncate>
                        {displayTitle}
                      </Text>
                    )}
                    <Text as="span" variant="caption">
                      {statusLabel(doc.ragStatus)}
                    </Text>
                  </Stack>
                  {canPreview ? (
                    <IconButton
                      icon={Eye}
                      variant="ghost"
                      aria-label={t('files.previewAction')}
                      onClick={openPreview}
                    />
                  ) : null}
                  {failed && canEdit ? (
                    <Button
                      variant="ghost"
                      onClick={() => void handleRetryIndexing(doc._id)}
                      disabled={isRetrying}
                      isLoading={isRetrying}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {t('files.indexingRetry')}
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmDetachId(doc._id)}
                    >
                      {t('files.detachAction')}
                    </Button>
                  ) : null}
                </HStack>
              );
            })}
          </div>
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
    </ContentArea>
  );
}
