'use client';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import CustomerImportForm from '@/components/customer-import-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, FormProvider } from 'react-hook-form';
import { toast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
// Note: xlsx is dynamically imported in parseFileData to reduce initial bundle size

export interface ParsedCustomer {
  email: string;
  locale: string;
  status: 'churned';
  source: Doc<'customers'>['source'];
}

// Validation schema for the form
const formSchema = z
  .object({
    dataSource: z.enum(['circuly', 'manual_import', 'file_upload'], {
      message: 'Please select a data source',
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
      message: 'Please provide customer data',
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
      message: 'Please upload a file',
      path: ['file'],
    },
  );

type FormValues = z.infer<typeof formSchema>;

interface ImportCustomersDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  onSuccess?: () => void;
  mode?: 'manual' | 'upload';
}

export default function ImportCustomersDialog({
  isOpen,
  onClose,
  organizationId,
  onSuccess,
  mode = 'manual',
}: ImportCustomersDialogProps) {
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

  const bulkCreateCustomers = useMutation(api.customers.bulkCreateCustomers);

  const resetForm = () => {
    formMethods.reset();
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Parse CSV data from manual input
  const parseCSVData = (csvData: string) => {
    const lines = csvData.trim().split('\n');
    const customers = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const [email, locale] = trimmedLine.split(',').map((item) => item.trim());

      if (!email) continue;

      customers.push({
        email,
        locale: locale || 'en',
        status: 'churned' as const,
        source: 'manual_import' as const,
      });
    }

    return customers;
  };

  // Parse uploaded file (Excel/CSV)
  const parseFileData = async (file: File) => {
    return new Promise<ParsedCustomer[]>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error('Failed to read file'));
            return;
          }

          const customers: ParsedCustomer[] = [];

          if (file.name.endsWith('.csv')) {
            // Parse CSV
            const csvText = data as string;
            const lines = csvText.trim().split('\n');

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine) continue;

              const [email, locale] = trimmedLine
                .split(',')
                .map((item) => item.trim());

              if (!email) continue;

              customers.push({
                email,
                locale: locale || 'en',
                status: 'churned' as const,
                source: 'file_upload' as const,
              });
            }
            resolve(customers);
          } else {
            // Parse Excel - dynamically import xlsx to reduce bundle size
            const XLSX = await import('xlsx');
            const workbook = XLSX.read(data as ArrayBuffer, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            customers.push(
              ...(jsonData as Array<Record<string, unknown>>)
                .map((row) => ({
                  email: (row.email as string) || (row.Email as string),
                  locale:
                    (row.locale as string) || (row.Locale as string) || 'en',
                  status: 'churned' as const,
                  source: 'file_upload' as const,
                }))
                .filter((customer) => customer.email),
            );
            resolve(customers);
          }
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));

      if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  };

  async function onSubmit(values: FormValues) {
    try {
      let customers: ParsedCustomer[] = [];

      // Handle different data sources
      if (values.dataSource === 'circuly') {
        toast({
          title: 'Sync feature',
          description:
            'Circuly sync is not yet implemented. Please use manual import or file upload.',
          variant: 'destructive',
        });
        return;
      } else if (values.dataSource === 'manual_import' && values.customers) {
        customers = parseCSVData(values.customers);
      } else if (values.dataSource === 'file_upload' && values.file) {
        customers = await parseFileData(values.file);
      } else {
        toast({
          title: 'Please provide customer data',
          variant: 'destructive',
        });
        return;
      }

      if (customers.length === 0) {
        toast({
          title: 'No valid customer data found',
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
          title: 'Import successful',
          description: `Successfully imported ${result.success} customers${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        });

        if (result.errors.length > 0) {
          console.warn('Import errors:', result.errors);
        }

        onSuccess?.();
        handleClose();
      } else {
        toast({
          title: 'Import failed',
          description: 'No customers were imported',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Error importing customers:', err);
      toast({
        title: 'Failed to import customers',
        variant: 'destructive',
      });
    }
  }

  const dialogTitle = mode === 'manual' ? 'Add customers' : 'Upload customers';

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="p-0 gap-0">
        <DialogHeader className="px-4 py-6 border-b border-border">
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <FormProvider {...formMethods}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <CustomerImportForm organizationId={organizationId} mode={mode} />
            <DialogFooter className="grid grid-cols-2 justify-items-stretch p-4 border-t border-border">
              <DialogClose asChild>
                <Button variant="outline" disabled={isSubmitting}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Importing...' : 'Import'}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
