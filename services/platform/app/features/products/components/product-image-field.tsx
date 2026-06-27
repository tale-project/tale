'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Spinner } from '@tale/ui/spinner';
import { ImagePlus, X } from 'lucide-react';
import { useRef } from 'react';

import { Image } from '@/app/components/ui/data-display/image';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

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

/**
 * Product image field: paste a URL or upload a file. Uploads go to Convex
 * storage and resolve to a stable public URL stored in `imageUrl`, so the
 * rest of the product UI (which renders `imageUrl` directly) is unchanged.
 */
export function ProductImageField({
  value,
  onChange,
  disabled,
  errorMessage,
}: ProductImageFieldProps) {
  const { t: tProducts } = useT('products');
  const { uploadImage, isUploading } = useProductImageUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const isDisabled = disabled || isUploading;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so selecting the same file again still fires onChange.
    e.target.value = '';
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
      <Input
        id="imageUrl"
        type="url"
        label={tProducts('edit.labels.imageUrl')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={tProducts('edit.imageUrlPlaceholder')}
        disabled={isDisabled}
        errorMessage={errorMessage}
      />
      <Row gap={3}>
        {value && (
          <Image
            src={value}
            alt=""
            className="border-border size-12 shrink-0 rounded-md border object-cover"
          />
        )}
        <input
          ref={inputRef}
          type="file"
          accept={PRODUCT_IMAGE_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={isDisabled}
          onClick={() => inputRef.current?.click()}
          className="gap-1.5"
        >
          {isUploading ? (
            <Spinner size="sm" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {tProducts('edit.uploadImage')}
        </Button>
        {value && !isUploading && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange('')}
            aria-label={tProducts('edit.removeImage')}
          >
            <X className="size-4" />
          </Button>
        )}
      </Row>
    </Stack>
  );
}
