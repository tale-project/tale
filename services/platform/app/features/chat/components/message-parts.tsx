'use client';

/**
 * One message's content, rendered as the ordered list of parts it was
 * authored as.
 *
 * The order is the record: a tool call, its result, an approval card and an
 * attachment are all things the model saw, in the sequence it saw them, so
 * they render in that sequence rather than being regrouped by kind. Every
 * part kind in `MessagePart` has a branch here; an unknown kind renders
 * nothing rather than leaking a raw object onto the screen.
 */

import { Badge } from '@tale/ui/badge';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Paperclip, ShieldQuestion, UserRoundPen, Wrench } from 'lucide-react';
import { useState, type ComponentType, type ReactNode } from 'react';

import { useFileUrls } from '@/app/features/shared/files/use-file-url';
import { ImagePreviewDialog } from '@/app/features/shared/markdown/image-preview-dialog';
import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useAttachmentPreviews } from '../hooks/attachment-preview-context';
import type { MessagePart } from '../types';

/** An attachment part that can render as pixels: an image with a live blob
 * reference to resolve a URL from. */
function isImageAttachment(
  part: MessagePart,
): part is Extract<MessagePart, { type: 'attachment' }> & { fileId: string } {
  return (
    part.type === 'attachment' &&
    part.fileId !== undefined &&
    part.mediaType.startsWith('image/')
  );
}

/** What a tool was asked, for the chip's detail: the retrieval tools carry
 * exactly one human-meaningful argument each. */
function toolCallDetail(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const key of ['query', 'ref', 'url'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** True when a structured tool result reports anything but success. */
function toolResultFailed(output: unknown): boolean {
  return (
    output !== null &&
    typeof output === 'object' &&
    'status' in output &&
    typeof output.status === 'string' &&
    output.status !== 'ok'
  );
}

/** Row chrome shared by every non-text part: an icon, a label, and detail. */
function PartRow({
  icon: Icon,
  label,
  detail,
  trailing,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="border-border bg-muted/40 flex items-center gap-2 rounded-md border px-2.5 py-1.5">
      <Icon aria-hidden className="text-muted-foreground size-3.5 shrink-0" />
      <span className="text-foreground min-w-0 truncate text-sm">{label}</span>
      {detail && (
        <Text variant="muted" className="min-w-0 truncate text-xs">
          {detail}
        </Text>
      )}
      {trailing && <div className="ml-auto shrink-0">{trailing}</div>}
    </div>
  );
}

export function MessageParts({
  parts,
  markdown = false,
}: {
  parts: readonly MessagePart[];
  /** Render text parts as markdown (assistant answers) instead of the plain
   * pre-wrapped text a user's own words keep. */
  markdown?: boolean;
}) {
  const { t } = useT('chat');
  // Image attachments render as pixels: one batched query resolves every
  // display URL for the message, and one dialog serves them as a gallery.
  // A URL that resolves to null (deleted blob, an unauthenticated shared
  // view) drops the part back to its file chip — never a broken <img>.
  // Locally sent images short-circuit the query: the surface still holds
  // their object-URL previews, so the bubble paints the moment it mounts —
  // the optimistic row and the real row that adopts it use the same pixels.
  const localPreviews = useAttachmentPreviews();
  const imageParts = parts.filter(isImageAttachment);
  const imageUrls = useFileUrls(imageParts.map((part) => part.fileId));
  const urlByFileId = new Map(
    (imageUrls.data ?? []).map((row) => [row.fileId, row.url] as const),
  );
  const displayUrlOf = (fileId: string): string | null | undefined =>
    localPreviews?.get(fileId) ?? urlByFileId.get(fileId);
  const galleryImages = imageParts
    .map((part) => ({
      src: displayUrlOf(part.fileId),
      alt: part.name,
    }))
    .filter(
      (image): image is { src: string; alt: string } =>
        typeof image.src === 'string' && image.src.length > 0,
    );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  return (
    <Stack gap={2} className="min-w-0">
      {parts.map((part, index) => {
        switch (part.type) {
          case 'text':
            return markdown ? (
              <MarkdownContent key={`text:${index}`} content={part.text} />
            ) : (
              <p
                key={`text:${index}`}
                className="text-foreground text-sm leading-relaxed whitespace-pre-wrap"
              >
                {part.text}
              </p>
            );
          case 'attachment': {
            // All of a message's images render as ONE wrapping row, anchored
            // where the first image part sits; the later image parts have
            // rendered there already. Non-image attachments keep their chip.
            if (isImageAttachment(part)) {
              if (parts.findIndex(isImageAttachment) !== index) return null;
              return (
                <Row key={`attachments:${index}`} gap={2} wrap align="center">
                  {imageParts.map((imagePart, imageIndex) => {
                    const url = displayUrlOf(imagePart.fileId);
                    // Still resolving — hold the slot, don't flash the chip.
                    if (url === undefined && imageUrls.data === undefined) {
                      return (
                        <Skeletonize
                          key={`image:${imagePart.fileId}:${imageIndex}`}
                          loading
                        >
                          <SkeletonBox>
                            <div className="size-9 rounded-lg" />
                          </SkeletonBox>
                        </Skeletonize>
                      );
                    }
                    if (typeof url !== 'string' || url.length === 0) {
                      return (
                        <PartRow
                          key={`image:${imagePart.fileId}:${imageIndex}`}
                          icon={Paperclip}
                          label={t('parts.attachment', {
                            name: imagePart.name,
                          })}
                          detail={imagePart.mediaType}
                        />
                      );
                    }
                    const galleryIndex = galleryImages.findIndex(
                      (image) => image.src === url,
                    );
                    return (
                      <button
                        key={`image:${imagePart.fileId}:${imageIndex}`}
                        type="button"
                        onClick={() =>
                          setPreviewIndex(galleryIndex >= 0 ? galleryIndex : 0)
                        }
                        aria-label={t('viewImage')}
                        className="ring-border focus-visible:ring-ring size-9 cursor-pointer overflow-hidden rounded-lg border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <img
                          src={url}
                          alt={imagePart.name}
                          className="size-full object-cover"
                        />
                      </button>
                    );
                  })}
                </Row>
              );
            }
            return (
              <PartRow
                key={`attachment:${part.name}:${index}`}
                icon={Paperclip}
                label={t('parts.attachment', { name: part.name })}
                detail={part.mediaType}
              />
            );
          }
          case 'tool-call': {
            const detail = toolCallDetail(part.input);
            return (
              <PartRow
                key={`call:${part.callId}`}
                icon={Wrench}
                label={t('parts.toolCall', { tool: part.capabilityId })}
                {...(detail !== undefined ? { detail } : {})}
              />
            );
          }
          case 'tool-result': {
            const failed = toolResultFailed(part.output);
            return (
              <PartRow
                key={`result:${part.callId}`}
                icon={Wrench}
                label={t('parts.toolResult', { tool: part.capabilityId })}
                {...(failed
                  ? {
                      trailing: (
                        <Badge variant="outline">
                          {t('parts.toolResultFailed')}
                        </Badge>
                      ),
                    }
                  : {})}
              />
            );
          }
          case 'approval':
            return (
              <PartRow
                key={`approval:${part.approvalId}`}
                icon={ShieldQuestion}
                label={part.question}
                trailing={
                  <Badge variant="outline">
                    {part.decision === 'approved'
                      ? t('parts.approvalApproved')
                      : part.decision === 'rejected'
                        ? t('parts.approvalRejected')
                        : t('parts.approvalPending')}
                  </Badge>
                }
              />
            );
          case 'human-input':
            return (
              <PartRow
                key={`input:${part.requestId}`}
                icon={UserRoundPen}
                label={part.question}
                detail={part.answer}
                trailing={
                  <Badge variant="outline">
                    {part.answer
                      ? t('parts.humanInputAnswered')
                      : t('parts.humanInputPending')}
                  </Badge>
                }
              />
            );
          default:
            return null;
        }
      })}
      {previewIndex !== null && galleryImages.length > 0 && (
        <ImagePreviewDialog
          isOpen
          onOpenChange={(open) => {
            if (!open) setPreviewIndex(null);
          }}
          src={galleryImages[previewIndex]?.src ?? ''}
          alt={galleryImages[previewIndex]?.alt ?? ''}
          images={galleryImages}
          activeIndex={Math.min(previewIndex, galleryImages.length - 1)}
          onActiveIndexChange={setPreviewIndex}
        />
      )}
    </Stack>
  );
}
