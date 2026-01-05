'use client';

import { useMemo, useCallback } from 'react';
import { FormDialog } from '@/components/ui/dialog';
import { CustomerImportForm } from './customer-import-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, FormProvider } from 'react-hook-form';
import { toast } from '@/hooks/use-toast';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n';
import { useBulkCreateCustomers } from '../hooks/use-bulk-create-customers';
import { useFileImport, customerMappers } from '@/hooks/use-file-import';

export interface ParsedCustomer {
  email: string;
  locale: string;
  status: 'churned';
  source: Doc<'customers'>['source'];
}

// Type for the form data
type FormValues = {
  dataSource: 'circuly' | 'manual_import' | 'file_upload';
  customers?: string;
  file?: File;
  syncSource?: string;
};

interface ImportCustomersDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  onSuccess?: () => void;
  mode?: 'manual' | 'upload';
}

export function ImportCustomersDialog({
  isOpen,
  onClose,
  organizationId,
  onSuccess,
  mode = 'manual',
}: ImportCustomersDialogProps) {
  const { t: tCommon } = useT('common');
  const { t: tCustomers } = useT('customers');

  // Use shared file import hook
  const { parseFile, parseCSV } = useFileImport<ParsedCustomer>({
    csvMapper: customerMappers.csv,
    excelMapper: customerMappers.excel,
  });

  // Create Zod schema with translated validation messages
  const formSchema = useMemo(
    () =>
      z
        .object({
          dataSource: z.enum(['circuly', 'manual_import', 'file_upload'], {
            message: tCustomers('import.selectDataSource'),
          }),
          customers: z.string().optional(),
          file: z.instanceof(File).optional(),
          syncSource: z.string().optional(),
        })
        .refine(
          (data) => {
            if (data.dataSource === 'manual_import') {
              return !!data.customers;
            }
            return true;
          },
          {
            message: tCustomers('import.provideData'),
            path: ['customers'],
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
    [tCustomers, tCommon],
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

  const bulkCreateCustomers = useBulkCreateCustomers();

  const handleClose = useCallback(() => {
    formMethods.reset();
    onClose();
  }, [formMethods, onClose]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        let customers: ParsedCustomer[] = [];

        // Handle different data sources
        if (values.dataSource === 'circuly') {
          toast({
            title: tCustomers('import.syncFeature'),
            description: tCustomers('import.syncNotImplemented'),
            variant: 'destructive',
          });
          return;
        } else if (values.dataSource === 'manual_import' && values.customers) {
          const result = parseCSV(values.customers);
          customers = result.data;
        } else if (values.dataSource === 'file_upload' && values.file) {
          const result = await parseFile(values.file);
          customers = result.data;
        } else {
          toast({
            title: tCustomers('import.provideData'),
            variant: 'destructive',
          });
          return;
        }

        if (customers.length === 0) {
          toast({
            title: tCustomers('import.noValidData'),
            variant: 'destructive',
          });
          return;
        }

        // Import customers using Convex
        const result = await bulkCreateCustomers({
          organizationId,
          customers,
        });

        // Show results
        if (result.success > 0) {
          toast({
            title: tCustomers('import.success'),
            description: tCustomers('import.successDescription', {
              success: result.success,
              failed:
                result.failed > 0
                  ? `, ${result.failed} ${tCustomers('import.failed')}`
                  : '',
            }),
          });

          if (result.errors.length > 0) {
            console.warn('Import errors:', result.errors);
          }

          onSuccess?.();
          handleClose();
        } else {
          toast({
            title: tCustomers('import.failed'),
            description: tCustomers('import.noneImported'),
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('Error importing customers:', err);
        toast({
          title: tCustomers('import.error'),
          variant: 'destructive',
        });
      }
    },
    [
      parseCSV,
      parseFile,
      bulkCreateCustomers,
      organizationId,
      tCustomers,
      onSuccess,
      handleClose,
    ]
  );

  const dialogTitle =
    mode === 'manual'
      ? tCustomers('import.addCustomers')
      : tCustomers('import.uploadCustomers');

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleClose}
      title={dialogTitle}
      submitText={tCustomers('import.import')}
      submittingText={tCommon('actions.importing')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormProvider {...formMethods}>
        <CustomerImportForm organizationId={organizationId} mode={mode} />
      </FormProvider>
    </FormDialog>
  );
}
