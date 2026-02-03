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
import { cn } from '@/lib/utils/cn';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Button } from '@/app/components/ui/primitives/button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { toast } from '@/app/hooks/use-toast';

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
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual_import">
              {t('importForm.manualEntry')}
            </TabsTrigger>
            <TabsTrigger value="file_upload">
              {t('importForm.upload')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {dataSource === 'manual_import' && (
        <Stack gap={4}>
          <Textarea
            placeholder={
              'vendor@example.com\nvendor2@example.com,en\nvendor3@example.com,es'
            }
            className="min-h-[200px] font-mono text-sm"
            errorMessage={errors.vendors?.message as string}
            {...register('vendors')}
          />
          <Description className="text-xs">
            <ul className="list-disc list-outside pl-4 space-y-2">
              <li>{t('importForm.localeHint')}</li>
            </ul>
          </Description>
        </Stack>
      )}
      {dataSource === 'file_upload' && (
        <Stack gap={4}>
          <FileUpload.Root>
            <FileUpload.DropZone
              onFilesSelected={handleFilesSelected}
              accept=".xlsx,.xls,.csv"
              inputId="vendor-file-upload"
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
            <ul className="list-disc list-outside pl-4 space-y-2">
              <li>{t('importForm.localeHint')}</li>
            </ul>
          </Description>
          {errors.file?.message && (
            <p className="text-sm text-destructive">
              {errors.file.message as string}
            </p>
          )}
          {fileValue && (
            <VStack gap={2} className="border border-border p-3 rounded-xl">
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
