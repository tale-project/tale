import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/app/components/ui/navigation/tabs';
import { Input } from '@/app/components/ui/forms/input';
import { useFormContext } from 'react-hook-form';
import { Form } from '@/app/components/ui/forms/form';
import { Description } from '@/app/components/ui/forms/description';
import { Stack, HStack, VStack } from '@/app/components/ui/layout/layout';
import { Upload, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Button } from '@/app/components/ui/primitives/button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

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
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFileChange = (file: File) => {
    if (file) {
      setValue('file', file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileChange(selectedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const file = files[0];

    if (file && (file.type.includes('sheet') || file.name.endsWith('.csv'))) {
      handleFileChange(file);
    }
  };

  const handleClick = () => {
    const input = document.getElementById('file-upload') as HTMLInputElement;
    input?.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const fileValue = watch('file') as File | null;

  return (
    <Form className="p-4">
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
          <div
            role="button"
            tabIndex={0}
            aria-label={tCommon('aria.dropzone')}
            className={cn(
              'bg-background box-border content-stretch flex flex-col gap-[16px] h-[160px] items-center justify-center px-[16px] py-[12px] relative rounded-[12px] shrink-0 w-full cursor-pointer transition-colors group',
              isDragOver
                ? 'bg-info'
                : 'hover:bg-info/50 focus:outline-none focus:ring-2 focus:ring-info-foreground focus:ring-offset-2',
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
          >
            <div
              aria-hidden="true"
              className={cn(
                'absolute border border-dashed border-border inset-0 pointer-events-none rounded-xl',
                isDragOver
                  ? 'border-info-foreground'
                  : 'group-hover:border-info-foreground',
              )}
            />
            <div className="overflow-clip relative shrink-0 size-[40px]">
              <div className="absolute inset-[12.5%]">
                <div className="absolute inset-[-5%]">
                  <Upload
                    className="size-8 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>
              </div>
            </div>
            <div className="content-stretch flex flex-col items-center justify-start leading-[0] not-italic relative shrink-0">
              <div className="content-stretch flex font-['Inter:Medium',_sans-serif] font-medium gap-[4px] items-center justify-start relative shrink-0 text-[16px] text-foreground text-nowrap">
                <div className="relative shrink-0">
                  <p className="leading-[1.5] text-nowrap whitespace-pre">
                    {tCommon('upload.clickToUpload')}
                  </p>
                </div>
                <div className="relative shrink-0">
                  <p className="leading-[1.5] text-nowrap whitespace-pre">{`${tCommon('upload.or')} `}</p>
                </div>
                <div className="relative shrink-0">
                  <p className="leading-[1.5] text-nowrap whitespace-pre">{`${tCommon('upload.dragAndDrop')} `}</p>
                </div>
              </div>
              <div className="min-w-full relative shrink-0 text-[14px] text-center text-muted-foreground">
                <p className="leading-[1.5]">
                  {tCommon('upload.supportedFormats')}
                </p>
              </div>
            </div>
            <Input
              id="file-upload"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
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
