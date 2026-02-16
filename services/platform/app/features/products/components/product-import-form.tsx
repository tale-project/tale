'use client';

import { Upload, Trash2 } from 'lucide-react';
import { useFormContext } from 'react-hook-form';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Stack, HStack, VStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
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

type _DataSource = 'SYNC' | 'FILE_UPLOAD';

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
      setValue('file', file);
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
    <div className="space-y-5">
      <Stack gap={4}>
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
              'relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
              'hover:border-primary hover:bg-accent/50',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            )}
          >
            <FileUpload.Overlay className="rounded-lg" />
            <Upload className="text-muted-foreground mx-auto mb-2 size-8" />
            <p className="text-sm font-medium">{t('import.clickToUpload')}</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('import.supportedFormats')}
            </p>
          </FileUpload.DropZone>
        </FileUpload.Root>
        <div className="text-muted-foreground text-xs leading-relaxed">
          <ul className="list-outside list-disc space-y-2 pl-4">
            <li>{t('import.expectedColumns')}</li>
            <li className="text-blue-600">{t('import.draftStatusNote')}</li>
          </ul>
        </div>
        {fileValue && (
          <VStack gap={2} className="border-border rounded-xl border p-3">
            <HStack gap={3} className="w-full">
              <HStack gap={2} className="min-w-0 flex-1">
                <DocumentIcon fileName={fileValue.name} />
                <VStack gap={0} className="min-w-0 flex-1">
                  <div className="text-foreground truncate text-sm font-medium">
                    {fileValue.name}
                  </div>
                </VStack>
              </HStack>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => setValue('file', null)}
              >
                <Trash2 className="size-4" />
              </Button>
            </HStack>
          </VStack>
        )}
      </Stack>
    </div>
  );
}
