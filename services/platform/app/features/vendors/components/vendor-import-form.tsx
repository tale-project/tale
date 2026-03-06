import { Upload } from 'lucide-react';
import { useFormContext } from 'react-hook-form';

import { FilePreviewCard } from '@/app/components/ui/data-display/file-preview-card';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack } from '@/app/components/ui/layout/layout';
import { Tabs } from '@/app/components/ui/navigation/tabs';
import { Text } from '@/app/components/ui/typography/text';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  isSpreadsheet,
  SPREADSHEET_IMPORT_ACCEPT,
} from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';

interface VendorImportFormProps {
  hideTabs?: boolean;
  organizationId: string;
  mode?: 'manual' | 'upload';
}

export type DataSource = Doc<'vendors'>['source'];

export function VendorImportForm({
  hideTabs,
  organizationId: _organizationId,
  mode,
}: VendorImportFormProps) {
  const { t } = useT('vendors');
  const { t: tCommon } = useT('common');
  const {
    setValue,
    watch,
    register,
    formState: { errors },
  } = useFormContext();
  const dataSource: DataSource = mode
    ? mode === 'manual'
      ? 'manual_import'
      : 'file_upload'
    : watch('dataSource');

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
      {!hideTabs && !mode && (
        <Tabs
          value={dataSource}
          onValueChange={(value) => setValue('dataSource', value, { shouldDirty: true })}
          className="w-full"
          listClassName="grid w-full grid-cols-2"
          items={[
            { value: 'manual_import', label: t('importForm.manualEntry') },
            { value: 'file_upload', label: t('importForm.upload') },
          ]}
        />
      )}
      {dataSource === 'manual_import' && (
        <FormSection>
          <Textarea
            placeholder={
              'vendor@example.com\nvendor2@example.com,en\nvendor3@example.com,es'
            }
            className="min-h-[200px] font-mono text-sm"
            errorMessage={
              typeof errors.vendors?.message === 'string'
                ? errors.vendors.message
                : undefined
            }
            {...register('vendors')}
          />
          <Text as="div" variant="caption" className="leading-relaxed">
            <ul className="list-outside list-disc space-y-2 pl-4">
              <li>{t('importForm.localeHint')}</li>
            </ul>
          </Text>
        </FormSection>
      )}
      {dataSource === 'file_upload' && (
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
              inputId="vendor-file-upload"
              className={cn(
                'relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                'hover:border-primary hover:bg-accent/50',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              <FileUpload.Overlay className="rounded-lg" />
              <Upload className="text-muted-foreground mx-auto mb-2 size-8" />
              <Text variant="label">{tCommon('upload.clickToUpload')}</Text>
              <Text variant="caption" className="mt-1">
                {tCommon('upload.supportedFormats')}
              </Text>
            </FileUpload.DropZone>
          </FileUpload.Root>
          <Text as="div" variant="caption" className="leading-relaxed">
            <ul className="list-outside list-disc space-y-2 pl-4">
              <li>{t('importForm.localeHint')}</li>
            </ul>
          </Text>
          {fileValue && (
            <FilePreviewCard
              fileName={fileValue.name}
              onRemove={() => setValue('file', null, { shouldDirty: true })}
            />
          )}
        </FormSection>
      )}
    </Stack>
  );
}
