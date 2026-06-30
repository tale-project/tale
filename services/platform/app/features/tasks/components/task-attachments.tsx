'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Loader, Paperclip, X } from 'lucide-react';
import { useId } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { FileAttachmentDisplay } from '@/app/features/chat/components/message-bubble/file-displays';
import type { FileAttachment } from '@/app/features/chat/hooks/use-convex-file-upload';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { DOCUMENT_UPLOAD_ACCEPT } from '@/lib/shared/file-types';
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
  onRemove: (fileId: Id<'_storage'>) => void;
}) {
  const { t } = useT('tasks');
  const inputId = useId();

  const hasContent = attachments.length > 0 || uploadingFiles.length > 0;
  if (!canEdit && !hasContent) return null;

  return (
    <Stack as="section" gap={2}>
      <Text as="h3" variant="label">
        {t('attachments.label')}
      </Text>

      {hasContent && (
        <Row gap={2} wrap align="start">
          {attachments.map((attachment) => (
            <div key={attachment.fileId} className="group relative">
              <FileAttachmentDisplay
                attachment={attachment}
                organizationId={organizationId}
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
          ))}
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
    </Stack>
  );
}
