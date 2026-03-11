'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';

import { ZoomPanViewer } from '@/app/components/ui/data-display/zoom-pan-viewer';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

export interface GalleryImage {
  src: string;
  alt: string;
}

interface ImagePreviewDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  /** Gallery images for prev/next navigation. When provided, src/alt are ignored in favor of images[activeIndex]. */
  images?: GalleryImage[];
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
}

export const ImagePreviewDialog = memo(function ImagePreviewDialog({
  isOpen,
  onOpenChange,
  src,
  alt,
  images,
  activeIndex = 0,
  onActiveIndexChange,
}: ImagePreviewDialogProps) {
  const { t } = useT('chat');

  const isGallery = Boolean(images && images.length > 1 && onActiveIndexChange);
  const safeIndex = useMemo(
    () =>
      images?.length
        ? Math.min(Math.max(activeIndex, 0), images.length - 1)
        : 0,
    [images?.length, activeIndex],
  );
  const currentSrc = images ? (images[safeIndex]?.src ?? src) : src;
  const currentAlt = images ? (images[safeIndex]?.alt ?? alt) : alt;

  const goToPrevious = useCallback(() => {
    if (!images || !onActiveIndexChange) return;
    onActiveIndexChange((activeIndex - 1 + images.length) % images.length);
  }, [images, activeIndex, onActiveIndexChange]);

  const goToNext = useCallback(() => {
    if (!images || !onActiveIndexChange) return;
    onActiveIndexChange((activeIndex + 1) % images.length);
  }, [images, activeIndex, onActiveIndexChange]);

  useEffect(() => {
    if (!isOpen || !isGallery) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevious();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isGallery, goToPrevious, goToNext]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t('imagePreview')}
      size="wide"
      hideClose
      customHeader={<></>}
      className="bg-muted flex flex-col border-0 p-0 ring-0 sm:p-0"
    >
      <ZoomPanViewer
        src={currentSrc}
        alt={currentAlt}
        toolbarPosition="overlay"
        headerContent={
          <div className="flex min-w-0 items-center gap-2">
            <Text as="span" truncate className="text-foreground/80 max-w-[60%]">
              {currentAlt}
            </Text>
            {isGallery && (
              <Text as="span" className="text-foreground/50 text-xs">
                {t('imageCounter', {
                  current: safeIndex + 1,
                  total: images?.length ?? 0,
                })}
              </Text>
            )}
          </div>
        }
        className="flex-1 p-8 pt-16"
        resetTrigger={currentSrc}
      />
      {isGallery && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="bg-background/80 hover:bg-background absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full shadow-md"
            onClick={goToPrevious}
            aria-label={t('previousImage')}
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="bg-background/80 hover:bg-background absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full shadow-md"
            onClick={goToNext}
            aria-label={t('nextImage')}
          >
            <ChevronRight className="size-5" />
          </Button>
        </>
      )}
    </Dialog>
  );
});
