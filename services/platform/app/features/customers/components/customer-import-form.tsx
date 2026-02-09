import { Link } from '@tanstack/react-router';
import { Upload, Trash2 } from 'lucide-react';
import { useFormContext } from 'react-hook-form';

import { ShopifyIcon } from '@/app/components/icons/shopify-icon';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Description } from '@/app/components/ui/forms/description';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Form } from '@/app/components/ui/forms/form';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Stack, HStack, VStack } from '@/app/components/ui/layout/layout';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/app/components/ui/navigation/tabs';
import { Button } from '@/app/components/ui/primitives/button';
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
    <Form>
      {!hideTabs && !mode && (
        <Tabs
          value={dataSource}
          onValueChange={(value) => setValue('dataSource', value)}
          className="w-full"
        >
          <TabsList className="grid w-auto grid-cols-3">
            <TabsTrigger value="circuly">{t('importForm.circuly')}</TabsTrigger>
            <TabsTrigger value="manual_import">
              {t('importForm.manualEntry')}
            </TabsTrigger>
            <TabsTrigger value="file_upload">
              {t('importForm.upload')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
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
            className="border-border pointer-events-none absolute inset-0 rounded-[8px] border border-solid shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
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
            <div className="text-foreground relative w-full shrink-0 text-base font-medium">
              <p>{t('importForm.fromShopify')}</p>
            </div>
            <div className="text-muted-foreground relative w-full shrink-0 text-sm">
              <p>{t('importForm.syncBusinessData')}</p>
            </div>
          </div>
        </Link>
      )}
      {dataSource === 'manual_import' && (
        <Stack gap={4}>
          <Textarea
            placeholder={
              'customer@example.com\ncustomer2@example.com,en\ncustomer3@example.com,zh'
            }
            className="min-h-[200px] font-mono text-sm"
            errorMessage={
              typeof errors.customers?.message === 'string'
                ? errors.customers.message
                : undefined
            }
            {...register('customers')}
          />
          <Description className="text-xs">
            <Stack gap={2} className="list-outside list-disc pl-4">
              <li>{t('importForm.localeHint')}</li>
              <li className="text-yellow-600">{t('importForm.churnedNote')}</li>
            </Stack>
          </Description>
        </Stack>
      )}
      {dataSource === 'file_upload' && (
        <Stack gap={4}>
          <FileUpload.Root>
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
              <p className="text-sm font-medium">
                {tCommon('upload.clickToUpload')}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {tCommon('upload.supportedFormats')}
              </p>
            </FileUpload.DropZone>
          </FileUpload.Root>
          <Description className="text-xs">
            <Stack gap={2} className="list-outside list-disc pl-4">
              <li>{t('importForm.localeHint')}</li>
              <li className="text-yellow-600">{t('importForm.churnedNote')}</li>
            </Stack>
          </Description>
          {typeof errors.file?.message === 'string' && (
            <p className="text-destructive text-sm">{errors.file.message}</p>
          )}
          {fileValue && (
            <VStack
              gap={2}
              className="border-border relative rounded-xl border p-3"
            >
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
                  variant="outline"
                  size="icon"
                  onClick={() => setValue('file', null)}
                  aria-label={tCommon('actions.remove')}
                >
                  <Trash2 className="size-4" />
                </Button>
              </HStack>
            </VStack>
          )}
        </Stack>
      )}
    </Form>
  );
}
