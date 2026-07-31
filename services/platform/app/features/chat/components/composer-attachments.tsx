'use client';

/**
 * The composer's staged attachments — the strip between the quote chip and
 * the text field.
 *
 * An image renders as a small thumbnail (click = zoomable preview, ✕ =
 * remove); an upload still in flight renders as a spinner chip whose ✕
 * aborts it. The strip disappears entirely when nothing is staged, so the
 * composer's resting chrome is unchanged.
 *
 * When the picked model cannot see images (no `vision` catalog tag) the
 * strip says so up front — the alternative is a model politely explaining it
 * is blind, one full turn too late.
 */

import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Loader2, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';

import type { FileAttachment } from '@/app/features/shared/files/types';
import { useFileUrl } from '@/app/features/shared/files/use-file-url';
import { ImagePreviewDialog } from '@/app/features/shared/markdown/image-preview-dialog';
import { useT } from '@/lib/i18n/client';

interface ComposerAttachmentsProps {
  attachments: readonly FileAttachment[];
  /** Per-upload ids still in flight — each renders a spinner chip. */
  uploadingFiles: readonly string[];
  onRemove: (fileId: string) => void;
  onCancelUpload: (fileId: string) => void;
  /** The picked model cannot see images — warn while any are staged. */
  warnModelCannotSee?: boolean;
}

/** One staged image. The object-URL preview serves the common case; a
 * restored attachment (send refused after its preview was revoked) falls
 * back to the server-resolved URL. */
function StagedImage({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: FileAttachment;
  onOpen: (url: string) => void;
  onRemove: () => void;
}) {
  const { t } = useT('chat');
  const { data: serverUrl } = useFileUrl(
    attachment.fileId,
    attachment.previewUrl !== undefined,
  );
  const url = attachment.previewUrl ?? serverUrl ?? undefined;

  return (
    <div className="ring-border group relative size-9 shrink-0 overflow-hidden rounded-lg ring-1">
      <button
        type="button"
        onClick={() => url !== undefined && onOpen(url)}
        aria-label={t('viewImage')}
        className="size-full cursor-pointer border-none bg-transparent p-0"
      >
        {url !== undefined && (
          <img
            src={url}
            alt={attachment.fileName}
            className="size-full object-cover"
          />
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t('removeAttachment')}
        // Always reachable: opacity-only hiding keeps it clickable and
        // focus-visible for keyboard users; hover reveal is cosmetic.
        className="bg-background/90 text-foreground absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X aria-hidden className="size-3" />
      </button>
    </div>
  );
}

export function ComposerAttachments({
  attachments,
  uploadingFiles,
  onRemove,
  onCancelUpload,
  warnModelCannotSee = false,
}: ComposerAttachmentsProps) {
  const { t } = useT('chat');
  const [preview, setPreview] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  if (attachments.length === 0 && uploadingFiles.length === 0) return null;

  return (
    <div>
      <Row gap={2} wrap align="center">
        {attachments.map((attachment) => (
          <StagedImage
            key={attachment.fileId}
            attachment={attachment}
            onOpen={(url) => setPreview({ src: url, alt: attachment.fileName })}
            onRemove={() => onRemove(attachment.fileId)}
          />
        ))}
        {uploadingFiles.map((uploadId) => (
          <Row
            key={uploadId}
            gap={1}
            align="center"
            className="border-border bg-muted/40 h-9 shrink-0 rounded-lg border px-2"
          >
            <Loader2
              aria-hidden
              className="text-muted-foreground size-3.5 animate-spin motion-reduce:animate-none"
            />
            <Text variant="muted" className="text-xs">
              {t('uploadingFile')}
            </Text>
            <button
              type="button"
              onClick={() => onCancelUpload(uploadId)}
              aria-label={t('cancelUpload')}
              className="text-muted-foreground hover:text-foreground flex size-4 items-center justify-center"
            >
              <X aria-hidden className="size-3" />
            </button>
          </Row>
        ))}
      </Row>
      {warnModelCannotSee && attachments.length > 0 && (
        <Row gap={1} align="center" className="mt-1.5">
          <TriangleAlert
            aria-hidden
            className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
          />
          <Text variant="muted" className="text-xs">
            {t('modelCannotSeeImages')}
          </Text>
        </Row>
      )}
      {preview !== null && (
        <ImagePreviewDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPreview(null);
          }}
          src={preview.src}
          alt={preview.alt}
        />
      )}
    </div>
  );
}
