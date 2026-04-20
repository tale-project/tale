'use client';

import { AlertTriangle, ChevronDown, Pencil, X } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { Popover } from '@/app/components/ui/overlays/popover';
import { useT } from '@/lib/i18n/client';

import {
  useChatLayout,
  type EditingImageRef,
} from '../context/chat-layout-context';
import type { ThreadImage } from '../hooks/use-thread-images';
import { ImagePreviewDialog } from './message-bubble/image-preview-dialog';
import { ThumbnailPicker } from './thumbnail-picker';

interface EditingBannerProps {
  /** Every image in the current thread, newest first (from useThreadImages). */
  threadImages: ThreadImage[];
  /** Whether the currently selected model supports reference-image edits. */
  currentModelSupportsEdit: boolean;
  /** Current model's display name, shown next to the thumbnail. */
  currentModelLabel?: string;
  /**
   * CTA for "Switch to an edit-capable model". Wired in chat-input so the
   * banner doesn't need to know the full picker. Omit to hide the CTA.
   */
  onSwitchModel?: () => void;
}

export function imageRefToAttachment(ref: EditingImageRef): {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
} | null {
  if (!ref.fileId) return null;
  return {
    fileId: ref.fileId,
    fileName: ref.fileName ?? 'reference-image',
    fileType: ref.mimeType,
    // Size isn't tracked (we reference an existing storage id rather than
    // uploading). Server code tolerates 0 since it reads bytes from storage.
    fileSize: 0,
  };
}

/**
 * Derives the image that should be the active editing target:
 * explicit ref (from ↻ Edit / ThumbnailPicker) > latest thread image.
 * Returns null when nothing to edit OR when user dismissed the current latest.
 */
export function useEffectiveEditingImage(threadImages: ThreadImage[]): {
  active: { ref: EditingImageRef; key: string } | null;
  isDismissed: boolean;
} {
  const { editingImageRef, dismissedImageKey } = useChatLayout();

  return useMemo(() => {
    if (editingImageRef) {
      const explicitKey = `explicit:${editingImageRef.fileId || editingImageRef.url}`;
      return {
        active: { ref: editingImageRef, key: explicitKey },
        isDismissed: false,
      };
    }
    const latest = threadImages[0];
    if (!latest || !latest.fileId) {
      // Latest with no fileId (e.g., a blob preview URL) can't round-trip to
      // the server as an edit reference. Hide the banner for those.
      return { active: null, isDismissed: false };
    }
    if (dismissedImageKey === latest.key) {
      return { active: null, isDismissed: true };
    }
    return {
      active: {
        ref: {
          fileId: latest.fileId,
          url: latest.url,
          mimeType: latest.mimeType,
          fileName: latest.fileName,
        },
        key: latest.key,
      },
      isDismissed: false,
    };
  }, [editingImageRef, dismissedImageKey, threadImages]);
}

export const EditingBanner = memo(function EditingBanner({
  threadImages,
  currentModelSupportsEdit,
  currentModelLabel,
  onSwitchModel,
}: EditingBannerProps) {
  const { t } = useT('chat');
  const { setEditingImageRef, setDismissedImageKey } = useChatLayout();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { active } = useEffectiveEditingImage(threadImages);

  if (!active) return null;

  const { ref, key: activeKey } = active;

  const handleDismiss = () => {
    setEditingImageRef(null);
    setDismissedImageKey(activeKey);
  };

  const handlePick = (img: ThreadImage) => {
    // Accept even when fileId is missing — the banner still updates visually
    // so the user sees their pick take effect. The send path (chat-interface)
    // skips pre-attach when fileId is empty, so those images just render as
    // a reference without round-tripping to the model.
    setEditingImageRef({
      fileId: img.fileId ?? '',
      url: img.url,
      mimeType: img.mimeType,
      fileName: img.fileName,
    });
    setDismissedImageKey(null);
    setPickerOpen(false);
  };

  const refHasUsableId = Boolean(ref.fileId);
  const disabled = !currentModelSupportsEdit || !refHasUsableId;
  // When the selected model can't actually consume the attached image, flip
  // the whole banner into a warning state (amber ring + tinted background)
  // so users notice — the previous muted-grey treatment was too subtle and
  // people sent edit prompts that silently became text-to-image regenerations.
  const containerClass = disabled
    ? 'bg-amber-50 ring-amber-300 text-amber-900 dark:bg-amber-950/40 dark:ring-amber-700/60 dark:text-amber-100'
    : 'bg-muted/60 ring-border';
  return (
    <div
      className={
        'mb-2 flex items-center gap-2 rounded-xl px-2 py-1.5 ring-1 ' +
        containerClass
      }
    >
      {ref.url ? (
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={t('imageEdit.previewReference')}
          className="ring-border focus:ring-ring size-9 shrink-0 cursor-zoom-in overflow-hidden rounded-md border-none bg-transparent p-0 ring-1 transition-opacity hover:opacity-80 focus:ring-2 focus:ring-offset-2 focus:outline-none"
        >
          <img
            src={ref.url}
            alt={ref.fileName ?? ''}
            className="size-full object-cover"
          />
        </button>
      ) : (
        <div className="ring-border size-9 shrink-0 overflow-hidden rounded-md ring-1">
          <div className="bg-muted flex size-full items-center justify-center">
            <Pencil className="text-muted-foreground size-4" />
          </div>
        </div>
      )}
      {ref.url && (
        <ImagePreviewDialog
          isOpen={previewOpen}
          onOpenChange={setPreviewOpen}
          src={ref.url}
          alt={ref.fileName ?? ''}
        />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={
            'truncate text-sm font-medium ' +
            (disabled
              ? 'text-amber-900 dark:text-amber-100'
              : 'text-foreground')
          }
        >
          {t('imageEdit.editingLatest')}
        </p>
        {disabled ? (
          <p className="flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-200">
            <AlertTriangle
              className="mt-0.5 size-3.5 shrink-0"
              strokeWidth={2}
              aria-hidden="true"
            />
            <span>
              {t('imageEdit.modelCannotEdit')}
              {onSwitchModel && (
                <button
                  type="button"
                  onClick={onSwitchModel}
                  className="ml-1 underline underline-offset-2 hover:no-underline"
                >
                  {t('imageEdit.change')}
                </button>
              )}
            </span>
          </p>
        ) : (
          currentModelLabel && (
            <p className="text-muted-foreground truncate text-xs">
              {currentModelLabel}
            </p>
          )
        )}
      </div>
      {threadImages.length > 1 && (
        <Popover
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          align="end"
          side="top"
          trigger={
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-0.5 rounded px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:underline"
              aria-label={t('imageEdit.change')}
            >
              {t('imageEdit.change')}
              <ChevronDown className="size-3" />
            </button>
          }
        >
          <ThumbnailPicker
            images={threadImages}
            activeKey={activeKey}
            onPick={handlePick}
          />
        </Popover>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('imageEdit.dismiss')}
        className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-1"
      >
        <X className="size-4" />
      </button>
    </div>
  );
});
