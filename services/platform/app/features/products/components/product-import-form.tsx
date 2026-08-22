'use client';

import { Alert } from '@tale/ui/alert';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Info, Upload } from 'lucide-react';
import { useFormContext } from 'react-hook-form';

import { FilePreviewCard } from '@/app/components/ui/data-display/file-preview-card';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  isSpreadsheet,
  SPREADSHEET_IMPORT_ACCEPT,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';

interface ProductImportFormProps {
  hideTabs?: boolean;
  organizationId: string;
}

export function ProductImportForm({
  hideTabs: _hideTabs,
  organizationId: _organizationId,
}: ProductImportFormProps) {
  const {
    setValue,
    watch,
    formState: { errors },
  } = useFormContext();
  const { t } = useT('products');
  const { t: tCommon } = useT('common');

  const handleFilesSelected = (files: File[]) => {
    const file = files[0];
    if (!file) return;

    if (isSpreadsheet(file.name)) {
      setValue('file', file, { shouldDirty: true });
    } else {
      toast({
        title: tCommon('validation.unsupportedFileType'),
        description: tCommon('upload.supportedFormats'),
        variant: 'destructive',
      });
    }
  };

  const fileValue: File | null = watch('file');

  return (
    <Stack gap={5}>
      <FormSection>
        <FileUpload.Root
          errorMessage={
            typeof errors.file?.message === 'string'
              ? errors.file.message
              : undefined
          }
        >
          <FileUpload.DropZone
            onFilesSelected={handleFilesSelected}
            accept={SPREADSHEET_IMPORT_ACCEPT}
            inputId="product-file-upload"
            className={cn(
              'relative cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors',
              'hover:border-primary hover:bg-accent/50',
              'focus-visible:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />
            <Upload className="text-muted-foreground mx-auto mb-2 size-8" />
            <Text variant="label">{t('import.clickToUpload')}</Text>
            <Text variant="caption" className="mt-1">
              {t('import.supportedFormats')}
            </Text>
          </FileUpload.DropZone>
        </FileUpload.Root>
        <Alert
          variant="info"
          icon={Info}
          description={t('import.draftStatusNote')}
        />
        <Text as="div" variant="caption" className="leading-relaxed">
          <ul className="list-outside list-disc space-y-2 pl-4">
            <li>{t('import.expectedColumns')}</li>
          </ul>
        </Text>
        {fileValue && (
          <FilePreviewCard
            fileName={fileValue.name}
            onRemove={() => setValue('file', null, { shouldDirty: true })}
          />
        )}
      </FormSection>
    </Stack>
  );
}
