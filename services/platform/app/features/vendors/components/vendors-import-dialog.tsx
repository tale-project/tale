'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useCallback } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useFileImport, vendorMappers } from '@/app/hooks/use-file-import';
import { toast } from '@/app/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useBulkCreateVendors } from '../hooks/actions';
import { VendorImportForm } from './vendor-import-form';

// Type for the form data
type FormValues = {
  dataSource: 'manual_import' | 'file_upload';
  vendors?: string;
  file?: File;
};

interface ParsedVendor {
  email: string;
  locale: string;
  source: Doc<'vendors'>['source'];
}

interface ImportVendorsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  onSuccess?: () => void;
  mode?: 'manual' | 'upload';
}

export function ImportVendorsDialog({
  isOpen,
  onClose,
  organizationId,
  onSuccess,
  mode = 'manual',
}: ImportVendorsDialogProps) {
  const { t } = useT('vendors');
  const { t: tCommon } = useT('common');

  // Use shared file import hook
  const { parseFile, parseCSV } = useFileImport<ParsedVendor>({
    csvMapper: vendorMappers.csv,
    excelMapper: vendorMappers.excel,
  });

  // Create Zod schema with translated validation messages
  const formSchema = useMemo(
    () =>
      z
        .object({
          dataSource: z.enum(['manual_import', 'file_upload'], {
            message: t('import.selectDataSource'),
          }),
          vendors: z.string().optional(),
          file: z.instanceof(File).optional(),
        })
        .refine(
          (data) => {
            if (data.dataSource === 'manual_import') {
              return !!data.vendors;
            }
            return true;
          },
          {
            message: t('import.provideData'),
            path: ['vendors'],
          },
        )
        .refine(
          (data) => {
            if (data.dataSource === 'file_upload') {
              return !!data.file;
            }
            return true;
          },
          {
            message: tCommon('validation.uploadFile'),
            path: ['file'],
          },
        ),
    [t, tCommon],
  );

  const formMethods = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      dataSource: mode === 'manual' ? 'manual_import' : 'file_upload',
    },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = formMethods;

  const bulkCreateVendors = useBulkCreateVendors();

  // Reset form when mode changes to ensure defaultValues are current
  useEffect(() => {
    formMethods.reset({
      dataSource: mode === 'manual' ? 'manual_import' : 'file_upload',
    });
  }, [mode, formMethods]);

  const handleClose = useCallback(() => {
    formMethods.reset();
    onClose();
  }, [formMethods, onClose]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        let vendors: ParsedVendor[] = [];

        // Handle different data sources using shared utilities
        if (values.dataSource === 'manual_import' && values.vendors) {
          const result = parseCSV(values.vendors);
          vendors = result.data;
        } else if (values.dataSource === 'file_upload' && values.file) {
          const result = await parseFile(values.file);
          vendors = result.data;
        } else {
          toast({
            title: t('import.provideData'),
            variant: 'destructive',
          });
          return;
        }

        if (vendors.length === 0) {
          toast({
            title: t('noValidData'),
            variant: 'destructive',
          });
          return;
        }

        // Import vendors using Convex
        const result = await bulkCreateVendors({
          organizationId,
          vendors: vendors,
        });

        // Show results
        if (result.success > 0) {
          toast({
            title: t('import.success'),
            description: t('import.successDescription', {
              success: result.success,
              failed: result.failed,
            }),
          });

          if (result.errors.length > 0) {
            console.warn('Import errors:', result.errors);
          }

          onSuccess?.();
          handleClose();
        } else {
          toast({
            title: t('import.failed'),
            description: t('noneImported'),
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('Error importing vendors:', err);
        toast({
          title: err instanceof Error ? err.message : t('import.error'),
          variant: 'destructive',
        });
      }
    },
    [
      parseCSV,
      parseFile,
      bulkCreateVendors,
      organizationId,
      t,
      onSuccess,
      handleClose,
    ],
  );

  const dialogTitle = mode === 'manual' ? t('addVendors') : t('uploadVendors');

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleClose}
      title={dialogTitle}
      submitText={tCommon('actions.import')}
      submittingText={tCommon('actions.importing')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormProvider {...formMethods}>
        <VendorImportForm organizationId={organizationId} mode={mode} />
      </FormProvider>
    </FormDialog>
  );
}
