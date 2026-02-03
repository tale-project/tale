import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/app/components/ui/navigation/tabs';
import { useFormContext } from 'react-hook-form';
import { Form } from '@/app/components/ui/forms/form';
import { Description } from '@/app/components/ui/forms/description';
import { Stack, HStack, VStack } from '@/app/components/ui/layout/layout';
import { Upload, Trash2 } from 'lucide-react';
import { ShopifyIcon } from '@/app/components/icons/shopify-icon';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils/cn';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Button } from '@/app/components/ui/primitives/button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { toast } from '@/app/hooks/use-toast';

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

    if (file.type.includes('sheet') || file.name.endsWith('.csv')) {
      setValue('file', file);
    } else {
      toast({
        title: tCommon('validation.unsupportedFileType'),
        description: tCommon('upload.supportedFormats'),
        variant: 'destructive',
      });
    }
  };

  const fileValue = watch('file') as File | null;

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
          className="bg-background box-border content-stretch flex gap-[12px] items-center justify-start p-[12px] relative rounded-[8px] size-full cursor-pointer transition-colors hover:bg-secondary/20 text-left"
        >
          <div
            aria-hidden="true"
            className="absolute border border-border border-solid inset-0 pointer-events-none rounded-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]"
          />
          <div className="bg-background relative rounded-[6px] shrink-0 size-[40px]">
            <div
              aria-hidden="true"
              className="absolute border border-border border-solid inset-0 pointer-events-none rounded-[6px]"
            />
            <div
              className="absolute overflow-clip size-[24px] top-1/2 translate-x-[-50%] translate-y-[-50%]"
              style={{ left: 'calc(50% + 0.5px)' }}
            >
              <ShopifyIcon />
            </div>
          </div>
          <div className="items-start justify-start not-italic relative shrink-0">
            <div className="font-medium relative shrink-0 text-base text-foreground w-full">
              <p>{t('importForm.fromShopify')}</p>
            </div>
            <div className="relative shrink-0 text-sm text-muted-foreground w-full">
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
            errorMessage={errors.customers?.message as string}
            {...register('customers')}
          />
          <Description className="text-xs">
            <Stack gap={2} className="list-disc list-outside pl-4">
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
              accept=".xlsx,.xls,.csv"
              inputId="customer-file-upload"
              className={cn(
                'relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                'hover:border-primary hover:bg-accent/50',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              )}
            >
              <FileUpload.Overlay className="rounded-lg" />
              <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">
                {tCommon('upload.clickToUpload')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {tCommon('upload.supportedFormats')}
              </p>
            </FileUpload.DropZone>
          </FileUpload.Root>
          <Description className="text-xs">
            <Stack gap={2} className="list-disc list-outside pl-4">
              <li>{t('importForm.localeHint')}</li>
              <li className="text-yellow-600">{t('importForm.churnedNote')}</li>
            </Stack>
          </Description>
          {errors.file?.message && (
            <p className="text-sm text-destructive">
              {errors.file.message as string}
            </p>
          )}
          {fileValue && (
            <VStack
              gap={2}
              className="border border-border p-3 relative rounded-xl"
            >
              <HStack gap={3} className="w-full">
                <HStack gap={2} className="flex-1 min-w-0">
                  <DocumentIcon fileName={fileValue.name} />
                  <VStack gap={0} className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground truncate">
                      {fileValue.name}
                    </div>
                  </VStack>
                </HStack>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setValue('file', null)}
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
