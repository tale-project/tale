import { Link } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import { useFormContext } from 'react-hook-form';

import { ShopifyIcon } from '@/app/components/icons/shopify-icon';
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

interface CustomerImportFormProps {
  hideTabs?: boolean;
  organizationId: string;
  mode?: 'manual' | 'upload';
}

export type DataSource = Doc<'customers'>['source'];

export function CustomerImportForm({
  hideTabs,
  organizationId,
  mode,
}: CustomerImportFormProps) {
  const { t } = useT('customers');
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
          onValueChange={(value) =>
            setValue('dataSource', value, { shouldDirty: true })
          }
          className="w-full"
          listClassName="grid w-auto grid-cols-3"
          items={[
            { value: 'circuly', label: t('importForm.circuly') },
            { value: 'manual_import', label: t('importForm.manualEntry') },
            { value: 'file_upload', label: t('importForm.upload') },
          ]}
        />
      )}
      {dataSource === 'circuly' && (
        <Link
          to="/dashboard/$id/settings/integrations"
          params={{ id: organizationId }}
          search={{ tab: 'shopify' }}
          className="bg-background hover:bg-secondary/20 relative box-border flex size-full cursor-pointer content-stretch items-center justify-start gap-[12px] rounded-[8px] p-[12px] text-left transition-colors"
        >
          <div
            aria-hidden="true"
            className="border-border pointer-events-none absolute inset-0 rounded-[8px] border border-solid shadow-xs"
          />
          <div className="bg-background relative size-[40px] shrink-0 rounded-[6px]">
            <div
              aria-hidden="true"
              className="border-border pointer-events-none absolute inset-0 rounded-[6px] border border-solid"
            />
            <div
              className="absolute top-1/2 size-[24px] translate-x-[-50%] translate-y-[-50%] overflow-clip"
              style={{ left: 'calc(50% + 0.5px)' }}
            >
              <ShopifyIcon />
            </div>
          </div>
          <div className="relative shrink-0 items-start justify-start not-italic">
            <Text
              as="div"
              variant="label"
              className="relative w-full shrink-0 text-base"
            >
              {t('importForm.fromShopify')}
            </Text>
            <Text as="div" variant="muted" className="relative w-full shrink-0">
              {t('importForm.syncBusinessData')}
            </Text>
          </div>
        </Link>
      )}
      {dataSource === 'manual_import' && (
        <FormSection>
          <Textarea
            placeholder={
              'customer@example.com,John Doe\ncustomer2@example.com,Jane Smith,en\ncustomer3@example.com,,zh'
            }
            className="min-h-[200px] font-mono text-sm"
            errorMessage={
              typeof errors.customers?.message === 'string'
                ? errors.customers.message
                : undefined
            }
            {...register('customers')}
          />
          <Text as="div" variant="caption" className="leading-relaxed">
            <ul className="list-outside list-disc space-y-2 pl-4">
              <li>{t('importForm.formatHint')}</li>
              <li>{t('importForm.localeHint')}</li>
              <li className="text-yellow-600">{t('importForm.churnedNote')}</li>
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
              inputId="customer-file-upload"
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
              <li className="text-yellow-600">{t('importForm.churnedNote')}</li>
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
