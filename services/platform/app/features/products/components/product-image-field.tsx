'use client';

import { Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { Text } from '@tale/ui/text';
import { ImagePlus, Pencil, X } from 'lucide-react';
import { useState } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_MAX_BYTES,
  useProductImageUpload,
} from '../hooks/use-product-image-upload';

interface ProductImageFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  errorMessage?: string;
}

const DROP_ZONE_ID = 'product-image-upload';

/**
 * Product image field: a clickable/droppable zone that shows the image when
 * set, with a hover overlay to change it and a corner button to remove it.
 * A "paste a URL" toggle below reveals a URL input as a secondary option.
 */
export function ProductImageField({
  value,
  onChange,
  disabled,
  errorMessage,
}: ProductImageFieldProps) {
  const { t: tProducts } = useT('products');
  const { t: tCommon } = useT('common');
  const { uploadImage, isUploading } = useProductImageUpload();
  const [showUrlInput, setShowUrlInput] = useState(false);
  const isDisabled = disabled || isUploading;

  const handleFilesSelected = async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      toast({
        title: tProducts('edit.imageTooLarge'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const url = await uploadImage(file);
      if (url) {
        onChange(url);
      } else {
        toast({
          title: tProducts('edit.imageUploadFailed'),
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Product image upload failed:', err);
      toast({
        title: tProducts('edit.imageUploadFailed'),
        variant: 'destructive',
      });
    }
  };

  return (
    <Stack gap={2}>
      <FileUpload.Root
        id={DROP_ZONE_ID}
        label={tProducts('edit.labels.image')}
        errorMessage={errorMessage}
      >
        {/* Wrapper is relative so the × button can overlay the zone as a sibling,
            keeping its click out of the DropZone's event path. */}
        <div className="relative">
          <FileUpload.DropZone
            inputId={DROP_ZONE_ID}
            onFilesSelected={handleFilesSelected}
            accept={PRODUCT_IMAGE_ACCEPT}
            disabled={isDisabled}
            aria-label={tProducts('edit.labels.image')}
            className={cn(
              'relative h-40 w-full overflow-hidden rounded-lg transition-colors',
              value
                ? 'border-border cursor-pointer border'
                : 'border-border hover:border-primary hover:bg-accent/30 cursor-pointer border-2 border-dashed',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />

            {isUploading ? (
              <div className="flex h-full items-center justify-center">
                <Spinner size="md" />
              </div>
            ) : value ? (
              <div className="group h-full w-full">
                <Image
                  src={value}
                  alt=""
                  className="h-full w-full object-cover object-center"
                />
                {/* Hover overlay signals that clicking will change the image */}
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Pencil className="size-4" aria-hidden />
                  <span className="text-sm font-medium">
                    {tCommon('actions.edit')}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <ImagePlus
                  className="text-muted-foreground size-8"
                  aria-hidden
                />
                <div>
                  <Text variant="label" className="text-sm">
                    {tProducts('edit.uploadImage')}
                  </Text>
                  <Text variant="caption" className="mt-0.5">
                    {tCommon('upload.dropFilesHere')}
                  </Text>
                </div>
              </div>
            )}
          </FileUpload.DropZone>

          {/* Remove button — outside the DropZone so clicking it does not open
              the file picker. Absolutely positioned to sit in the zone's corner. */}
          {value && !isUploading && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange('')}
              aria-label={tProducts('edit.removeImage')}
              className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </FileUpload.Root>

      {showUrlInput ? (
        <Input
          id="product-image-url-input"
          type="url"
          label={tProducts('edit.labels.imageUrl')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={tProducts('edit.imageUrlPlaceholder')}
          disabled={isDisabled}
        />
      ) : (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground self-start text-sm underline-offset-2 hover:underline"
          onClick={() => setShowUrlInput(true)}
        >
          {tProducts('edit.pasteUrl')}
        </button>
      )}
    </Stack>
  );
}
