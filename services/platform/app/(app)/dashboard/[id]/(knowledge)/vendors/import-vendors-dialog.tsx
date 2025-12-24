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
import VendorImportForm from '@/components/vendor-import-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, FormProvider } from 'react-hook-form';
import { toast } from '@/hooks/use-toast';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { useEffect } from 'react';
// Note: xlsx is dynamically imported in parseFileData to reduce initial bundle size

// Validation schema for the form
const formSchema = z
  .object({
    dataSource: z.enum(['manual_import', 'file_upload'], {
      message: 'Please select a data source',
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
      message: 'Please provide vendor data',
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
      message: 'Please upload a file',
      path: ['file'],
    },
  );

type FormValues = z.infer<typeof formSchema>;

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

export default function ImportVendorsDialog({
  isOpen,
  onClose,
  organizationId,
  onSuccess,
  mode = 'manual',
}: ImportVendorsDialogProps) {
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

  const bulkCreateVendors = useMutation(api.vendors.bulkCreateVendors);

  // Reset form when mode changes to ensure defaultValues are current
  useEffect(() => {
    formMethods.reset({
      dataSource: mode === 'manual' ? 'manual_import' : 'file_upload',
    });
  }, [mode, formMethods]);

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
    const vendors = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const [email, locale] = trimmedLine.split(',').map((item) => item.trim());

      if (!email) continue;

      vendors.push({
        email,
        locale: locale || 'en',
        source: 'manual_import' as const,
      });
    }

    return vendors;
  };

  // Parse uploaded file (Excel/CSV)
  const parseFileData = async (file: File) => {
    return new Promise<ParsedVendor[]>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error('Failed to read file'));
            return;
          }

          const vendors: ParsedVendor[] = [];

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

              vendors.push({
                email,
                locale: locale || 'en',
                source: 'file_upload' as const,
              });
            }
          } else {
            // Dynamically import xlsx to reduce bundle size
            const XLSX = await import('xlsx');
            // Parse Excel
            const workbook = XLSX.read(data, { type: 'binary' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            vendors.push(
              ...(jsonData as Array<Record<string, unknown>>)
                .map((row) => ({
                  email: (row.email as string) || (row.Email as string),
                  locale:
                    (row.locale as string) || (row.Locale as string) || 'en',
                  source: 'file_upload' as const,
                }))
                .filter((vendor) => vendor.email),
            );
          }

          resolve(vendors);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));

      if (file.name.endsWith('.csv')) {
        reader.readAsText(file);
      } else {
        reader.readAsBinaryString(file);
      }
    });
  };

  async function onSubmit(values: FormValues) {
    try {
      let vendors: ParsedVendor[] = [];

      // Handle different data sources
      if (values.dataSource === 'manual_import' && values.vendors) {
        vendors = parseCSVData(values.vendors);
      } else if (values.dataSource === 'file_upload' && values.file) {
        vendors = await parseFileData(values.file);
      } else {
        toast({
          title: 'Please provide vendor data',
          variant: 'destructive',
        });
        return;
      }

      if (vendors.length === 0) {
        toast({
          title: 'No valid vendor data found',
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
          title: 'Import successful',
          description: `Successfully imported ${result.success} vendors${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        });

        if (result.errors.length > 0) {
          console.warn('Import errors:', result.errors);
        }

        onSuccess?.();
        handleClose();
      } else {
        toast({
          title: 'Import failed',
          description: 'No vendors were imported',
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error('Error importing vendors:', err);
      toast({
        title: err instanceof Error ? err.message : 'Failed to import vendors',
        variant: 'destructive',
      });
    }
  }

  const dialogTitle = mode === 'manual' ? 'Add vendors' : 'Upload vendors';

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="p-0 gap-0">
        <DialogHeader className="px-4 py-6 border-b border-border">
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>
        <FormProvider {...formMethods}>
          <form onSubmit={handleSubmit(onSubmit)}>
            <VendorImportForm organizationId={organizationId} mode={mode} />
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
