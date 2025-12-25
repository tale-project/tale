import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { useFormContext } from 'react-hook-form';
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { Upload } from 'lucide-react';
import { useState } from 'react';
import { ShopifyIcon } from './ui/icons';
import Link from 'next/link';
import { cn } from '@/lib/utils/cn';
import DocumentIcon from './ui/document-icon';
import { Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';

interface CustomerImportFormProps {
  hideTabs?: boolean;
  organizationId: string;
  mode?: 'manual' | 'upload';
}

export type DataSource = Doc<'customers'>['source'];

export default function CustomerImportForm({
  hideTabs,
  organizationId,
  mode,
}: CustomerImportFormProps) {
  const { t } = useT('customers');
  const { t: tCommon } = useT('common');
  const { setValue, control, watch } = useFormContext();
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

  return (
    <div className="space-y-5 p-4">
      {!hideTabs && !mode && (
        <FormField
          control={control}
          name="dataSource"
          render={({ field }) => (
            <Tabs
              value={field.value}
              onValueChange={field.onChange}
              className="w-full"
            >
              <TabsList className="grid w-auto grid-cols-3">
                <TabsTrigger value="circuly">{t('importForm.circuly')}</TabsTrigger>
                <TabsTrigger value="manual_import">{t('importForm.manualEntry')}</TabsTrigger>
                <TabsTrigger value="file_upload">{t('importForm.upload')}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        />
      )}
      {dataSource === 'circuly' && (
        <FormField
          control={control}
          name="syncSource"
          render={({ field: _field }) => (
            <FormItem>
              <FormControl>
                <div className="space-y-4">
                  <Link
                    href={`/dashboard/${organizationId}/settings/integrations?tab=shopify`}
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
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {dataSource === 'manual_import' && (
        <FormField
          control={control}
          name="customers"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <div className="space-y-4">
                  <Textarea
                    placeholder={
                      'customer@example.com\ncustomer2@example.com,en\ncustomer3@example.com,zh'
                    }
                    {...field}
                    className="min-h-[200px] font-mono text-sm"
                  />
                  <ul className="min-w-full not-italic relative shrink-0 text-muted-foreground tracking-tight text-xs space-y-2 list-disc list-outside pl-4">
                    <li>
                      {t('importForm.localeHint')}
                    </li>
                    <li className="text-yellow-600">
                      {t('importForm.churnedNote')}
                    </li>
                  </ul>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {dataSource === 'file_upload' && (
        <FormField
          control={control}
          name="file"
          render={({ field: { value, onChange, ...field } }) => (
            <FormItem>
              <FormControl>
                <div className="space-y-4">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={tCommon('aria.dropzone')}
                    className={cn(
                      'bg-background box-border content-stretch flex flex-col gap-[16px] h-[160px] items-center justify-center px-[16px] py-[12px] relative rounded-[12px] shrink-0 w-full cursor-pointer transition-colors group',
                      isDragOver
                        ? 'bg-blue-50/50'
                        : 'hover:bg-blue-100/20 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
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
                          ? 'border-blue-300'
                          : 'group-hover:border-blue-300',
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
                        <p className="leading-[1.5]">{tCommon('upload.supportedFormats')}</p>
                      </div>
                    </div>
                    <Input
                      id="file-upload"
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => {
                        handleFileInputChange(e);
                        onChange(e.target.files?.[0]);
                      }}
                      className="hidden"
                      {...field}
                    />
                  </div>
                  <ul className="min-w-full not-italic relative shrink-0 text-muted-foreground tracking-[-0.21px] text-xs space-y-2 list-disc list-outside pl-4">
                    <li>
                      {t('importForm.localeHint')}
                    </li>
                    <li className="text-yellow-600">
                      {t('importForm.churnedNote')}
                    </li>
                  </ul>
                  {value && (
                    <div className="border border-border flex flex-col gap-2 p-3 relative rounded-xl">
                      <div className="flex gap-3 items-center justify-start w-full">
                        <div className="flex gap-2 items-center justify-start flex-1 min-w-0">
                          <DocumentIcon fileName={value.name} />
                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <div className="font-medium text-sm text-foreground truncate">
                              {value.name}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setValue('file', null)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
