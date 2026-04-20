'use client';

import { memo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useFileUrls } from '../hooks/queries';
import type { ThreadImage } from '../hooks/use-thread-images';

interface ThumbnailPickerProps {
  images: ThreadImage[];
  activeKey?: string;
  onPick: (image: ThreadImage) => void;
}

/**
 * Grid of every image in the current thread, used inside the EditingBanner's
 * "Change ▾" popover. User-uploaded attachments lack a URL at derive time;
 * we resolve those here via useFileUrls and thread them back into the items.
 */
export const ThumbnailPicker = memo(function ThumbnailPicker({
  images,
  activeKey,
  onPick,
}: ThumbnailPickerProps) {
  const { t } = useT('chat');

  const unresolvedFileIds = images
    .filter((img) => !img.url && img.fileId)
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex Id<'_storage'> is a branded string; runtime value is the same
    .map((img) => img.fileId as Id<'_storage'>);
  const { data: resolvedUrls } = useFileUrls(unresolvedFileIds);

  const urlByFileId = new Map<string, string>();
  if (resolvedUrls) {
    for (const r of resolvedUrls) {
      if (r.url) urlByFileId.set(r.fileId, r.url);
    }
  }

  const displayable = images
    .map((img) => {
      if (img.url) return img;
      const resolved = img.fileId ? urlByFileId.get(img.fileId) : undefined;
      if (resolved) {
        return { ...img, url: resolved };
      }
      return null;
    })
    .filter((img): img is ThreadImage => img !== null);

  if (displayable.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-center text-sm">
        {t('imageEdit.noOtherImages')}
      </p>
    );
  }

  return (
    <div className="max-h-64 w-64 overflow-y-auto">
      <p className="text-muted-foreground mb-2 text-xs font-medium">
        {t('imageEdit.pickAnImage')}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {displayable.map((img) => {
          const isActive = img.key === activeKey;
          return (
            <button
              key={img.key}
              type="button"
              onClick={() => onPick(img)}
              className={
                'ring-border hover:ring-primary focus:ring-primary size-16 cursor-pointer overflow-hidden rounded-md border-none bg-transparent p-0 ring-1 transition-all focus:outline-none' +
                (isActive ? ' ring-primary ring-2' : '')
              }
              title={img.fileName ?? ''}
            >
              <img
                src={img.url}
                alt={img.fileName ?? ''}
                className="size-full object-cover"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
});
