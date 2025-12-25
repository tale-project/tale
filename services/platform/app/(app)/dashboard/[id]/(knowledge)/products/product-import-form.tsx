'use client';

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
import { cn } from '@/lib/utils/cn';
import DocumentIcon from '../../../../../../components/ui/document-icon';
import { Trash2 } from 'lucide-react';
import { Button } from '../../../../../../components/ui/button';
import { useT } from '@/lib/i18n';

interface ProductImportFormProps {
  hideTabs?: boolean;
  organizationId: string;
}

export type DataSource = 'SYNC' | 'FILE_UPLOAD';

export default function ProductImportForm({
  hideTabs: _hideTabs,
  organizationId: _organizationId,
}: ProductImportFormProps) {
  const { setValue, control } = useFormContext();
  const { t } = useT('products');
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
                  aria-label={t('import.dropzoneAriaLabel')}
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
                          {t('import.clickToUpload')}
                        </p>
                      </div>
                      <div className="relative shrink-0">
                        <p className="leading-[1.5] text-nowrap whitespace-pre">{`${t('import.or')} `}</p>
                      </div>
                      <div className="relative shrink-0">
                        <p className="leading-[1.5] text-nowrap whitespace-pre">{`${t('import.dragAndDrop')} `}</p>
                      </div>
                    </div>
                    <div className="min-w-full relative shrink-0 text-[14px] text-center text-muted-foreground">
                      <p className="leading-[1.5]">{t('import.supportedFormats')}</p>
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
                    {t('import.expectedColumns')}
                  </li>
                  <li className="text-blue-600">
                    {t('import.draftStatusNote')}
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
    </div>
  );
}
