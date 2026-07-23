'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Loader, Paperclip, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { FileAttachmentDisplay } from '@/app/features/shared/files/file-displays';
import type { FileAttachment } from '@/app/features/shared/files/use-convex-file-upload';
import { useFileUrls } from '@/app/features/shared/files/use-file-url';
import {
  ImagePreviewDialog,
  type GalleryImage,
} from '@/app/features/shared/markdown/image-preview-dialog';
import { useT } from '@/lib/i18n/client';
import { DOCUMENT_UPLOAD_ACCEPT, isImage } from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';

/**
 * Task image/document attachments — shared by the create draft and the saved
 * detail view. Purely presentational: the parent owns the list and wires upload
 * + remove (create accumulates in `useConvexFileUpload`; edit persists each
 * change through `updateTask`). Reuses the chat {@link FileAttachmentDisplay}
 * renderer (image thumbnail / file chip) and the {@link FileUpload} drop-zone
 * primitive. Read-only callers with no attachments render nothing.
 */
export function TaskAttachments({
  attachments,
  uploadingFiles,
  canEdit,
  disabled,
  organizationId,
  onUpload,
  onRemove,
}: {
  attachments: FileAttachment[];
  uploadingFiles: string[];
  canEdit: boolean;
  disabled?: boolean;
  organizationId: string;
  onUpload: (files: File[]) => void;
  onRemove: (fileId: string) => void;
}) {
  const { t } = useT('tasks');
  const inputId = useId();

  const hasContent = attachments.length > 0 || uploadingFiles.length > 0;

  // Image lightbox — mirrors chat's own attachment gallery
  // (`useMessageGallery` in message-bubble.tsx): resolve a URL per image
  // attachment (client-side `previewUrl` first, else a batched server
  // lookup), then let a click open the same `ImagePreviewDialog` chat uses.
  // Before this, images had no `onImageClick` at all — the thumbnail button
  // rendered but its click was a no-op (#2664). Non-image attachments
  // already get an open-in-new-tab link from `FileAttachmentDisplay` itself.
  const imageAttachments = useMemo(
    () => attachments.filter((a) => isImage(a.fileType)),
    [attachments],
  );
  const imageFileIdsToResolve = useMemo(
    () => imageAttachments.filter((a) => !a.previewUrl).map((a) => a.fileId),
    [imageAttachments],
  );
  const { data: resolvedUrls } = useFileUrls(imageFileIdsToResolve);
  const galleryEntries = useMemo(() => {
    const entries: Array<{ fileId: string; image: GalleryImage }> = [];
    for (const attachment of imageAttachments) {
      const url =
        attachment.previewUrl ??
        resolvedUrls?.find((r) => r.fileId === attachment.fileId)?.url ??
        undefined;
      if (url) {
        entries.push({
          fileId: attachment.fileId,
          image: { src: url, alt: attachment.fileName },
        });
      }
    }
    return entries;
  }, [imageAttachments, resolvedUrls]);
  const galleryImages = useMemo(
    () => galleryEntries.map((entry) => entry.image),
    [galleryEntries],
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const activePreview =
    previewIndex !== null ? galleryImages[previewIndex] : undefined;

  if (!canEdit && !hasContent) return null;

  return (
    <Stack as="section" gap={2}>
      <Text as="h3" variant="label">
        {t('attachments.label')}
      </Text>

      {hasContent && (
        <Row gap={2} wrap align="start">
          {attachments.map((attachment) => {
            const galleryIdx = isImage(attachment.fileType)
              ? galleryEntries.findIndex(
                  (entry) => entry.fileId === attachment.fileId,
                )
              : -1;
            return (
              <div key={attachment.fileId} className="group relative">
                <FileAttachmentDisplay
                  attachment={attachment}
                  organizationId={organizationId}
                  onImageClick={
                    galleryIdx >= 0
                      ? () => setPreviewIndex(galleryIdx)
                      : undefined
                  }
                />
                {canEdit && (
                  <button
                    type="button"
                    aria-label={t('attachments.remove')}
                    onClick={() => onRemove(attachment.fileId)}
                    disabled={disabled}
                    className="bg-background text-muted-foreground hover:text-foreground ring-border absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full opacity-0 ring-1 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
          {uploadingFiles.map((name) => (
            <Row
              key={name}
              gap={2}
              align="center"
              className="bg-muted text-muted-foreground h-9 rounded-lg px-3"
            >
              <Loader className="size-4 animate-spin" aria-hidden="true" />
              <Text as="span" variant="caption">
                {t('attachments.uploading')}
              </Text>
            </Row>
          ))}
        </Row>
      )}

      {canEdit && (
        <FileUpload.Root>
          <FileUpload.DropZone
            inputId={inputId}
            onFilesSelected={onUpload}
            accept={DOCUMENT_UPLOAD_ACCEPT}
            multiple
            disabled={disabled}
            aria-label={t('attachments.add')}
            className={cn(
              'border-border hover:border-muted-foreground/40 hover:bg-muted/40 relative flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2.5 transition-colors',
              disabled && 'pointer-events-none opacity-60',
            )}
          >
            <Paperclip
              className="text-muted-foreground size-4"
              aria-hidden="true"
            />
            <Text as="span" variant="muted">
              {t('attachments.dropHint')}
            </Text>
            <FileUpload.Overlay label={t('attachments.dropHint')} />
          </FileUpload.DropZone>
        </FileUpload.Root>
      )}

      {activePreview && (
        <ImagePreviewDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPreviewIndex(null);
          }}
          src={activePreview.src}
          alt={activePreview.alt}
          images={galleryImages}
          activeIndex={previewIndex ?? 0}
          onActiveIndexChange={setPreviewIndex}
        />
      )}
    </Stack>
  );
}
