'use client';

import { useMemo } from 'react';
import { FormModal } from '@/components/ui/modals';
import ProductImportForm from './product-import-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, FormProvider } from 'react-hook-form';
import { toast } from '@/hooks/use-toast';
import { ProductStatus, PRODUCT_STATUS } from '@/constants/convex-enums';
import { useT } from '@/lib/i18n';
import { useCreateProduct } from './hooks';
// Note: xlsx is dynamically imported in parseFileData to reduce initial bundle size

// Type for the form data
type FormValues = {
  file: File;
};

// Parsed product interface
interface ParsedProduct {
  name: string;
  description?: string;
  imageUrl?: string;
  stock?: number;
  price?: number;
  currency?: string;
  category?: string;
  status?: ProductStatus;
}

interface ImportProductsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  onSuccess?: () => void;
}

export default function ImportProductsDialog({
  isOpen,
  onClose,
  organizationId,
  onSuccess,
}: ImportProductsDialogProps) {
  const { t } = useT('products');
  const { t: tCommon } = useT('common');

  // Create Zod schema with translated validation messages
  const formSchema = useMemo(
    () =>
      z.object({
        file: z.instanceof(File, { message: tCommon('validation.uploadFile') }),
      }),
    [tCommon],
  );

  const formMethods = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = formMethods;

  const createProduct = useCreateProduct();

  const resetForm = () => {
    formMethods.reset();
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Helper function to validate product status
  const validateStatus = (value: unknown): ProductStatus => {
    if (typeof value !== 'string') return PRODUCT_STATUS.Draft;

    const lowerValue = value.toLowerCase();
    if (Object.values(PRODUCT_STATUS).includes(lowerValue as ProductStatus)) {
      return lowerValue as ProductStatus;
    }
    return PRODUCT_STATUS.Draft;
  };

  // Helper to safely get string value from unknown data
  const getStringValue = (value: unknown): string | undefined => {
    return typeof value === 'string' ? value : undefined;
  };

  // Helper to safely get number value from unknown data
  const getNumberValue = (value: unknown): number | undefined => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  };

  // Parse uploaded file (Excel/CSV)
  const parseFileData = async (file: File) => {
    return new Promise<ParsedProduct[]>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async (e) => {
        try {
          const data = e.target?.result;
          if (!data) {
            reject(new Error('Failed to read file'));
            return;
          }

          // Dynamically import xlsx to reduce bundle size
          const XLSX = await import('xlsx');

          const products: ParsedProduct[] = [];

          if (file.name.endsWith('.csv')) {
            // Parse CSV using XLSX library which handles quoted fields correctly
            const csvText = data as string;
            const workbook = XLSX.read(csvText, { type: 'string' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            const parsedProducts = (jsonData as Array<Record<string, unknown>>)
              .map((row) => {
                const name =
                  getStringValue(row.name) ?? getStringValue(row.Name);
                const description =
                  getStringValue(row.description) ??
                  getStringValue(row.Description);
                const imageUrl =
                  getStringValue(row.imageUrl) ??
                  getStringValue(row.ImageUrl) ??
                  getStringValue(row.image_url) ??
                  getStringValue(row['image url']);
                const stock =
                  getNumberValue(row.stock) ?? getNumberValue(row.Stock) ?? 0;
                const price =
                  getNumberValue(row.price) ?? getNumberValue(row.Price) ?? 0;
                const currency =
                  getStringValue(row.currency) ??
                  getStringValue(row.Currency) ??
                  'USD';
                const category =
                  getStringValue(row.category) ?? getStringValue(row.Category);
                const status = validateStatus(row.status ?? row.Status);

                return {
                  name: name ?? '',
                  description,
                  imageUrl,
                  stock,
                  price,
                  currency,
                  category,
                  status,
                };
              })
              .filter((product) => product.name);

            products.push(...parsedProducts);
          } else {
            // Parse Excel
            const workbook = XLSX.read(data, { type: 'binary' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            const parsedProducts = (jsonData as Array<Record<string, unknown>>)
              .map((row) => {
                const name =
                  getStringValue(row.name) ?? getStringValue(row.Name);
                const description =
                  getStringValue(row.description) ??
                  getStringValue(row.Description);
                const imageUrl =
                  getStringValue(row.imageUrl) ??
                  getStringValue(row.ImageUrl) ??
                  getStringValue(row.image_url);
                const stock =
                  getNumberValue(row.stock) ?? getNumberValue(row.Stock) ?? 0;
                const price =
                  getNumberValue(row.price) ?? getNumberValue(row.Price) ?? 0;
                const currency =
                  getStringValue(row.currency) ??
                  getStringValue(row.Currency) ??
                  'USD';
                const category =
                  getStringValue(row.category) ?? getStringValue(row.Category);
                const status = validateStatus(row.status ?? row.Status);

                return {
                  name: name ?? '',
                  description,
                  imageUrl,
                  stock,
                  price,
                  currency,
                  category,
                  status,
                };
              })
              .filter((product) => product.name);

            products.push(...parsedProducts);
          }

          resolve(products);
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
      let products: ParsedProduct[] = [];

      // Parse the uploaded file
      if (values.file) {
        products = await parseFileData(values.file);
      } else {
        toast({
          title: t('import.uploadFile'),
          variant: 'destructive',
        });
        return;
      }

      if (products.length === 0) {
        toast({
          title: t('noValidData'),
          variant: 'destructive',
        });
        return;
      }

      // Import products in parallel using Promise.allSettled
      const results = await Promise.allSettled(
        products.map((product) =>
          createProduct({
            organizationId,
            name: product.name,
            description: product.description,
            imageUrl: product.imageUrl,
            stock: product.stock,
            price: product.price,
            currency: product.currency,
            category: product.category,
            status: product.status,
          }),
        ),
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      const errors: string[] = results
        .map((result, index) =>
          result.status === 'rejected'
            ? `Failed to import ${products[index].name}: ${result.reason}`
            : null,
        )
        .filter((error): error is string => error !== null);

      // Show results
      if (successCount > 0) {
        toast({
          title: t('import.success'),
          description: t('import.successDescription', { count: successCount, failed: failedCount }),
        });

        if (errors.length > 0) {
          console.warn('Import errors:', errors);
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
      console.error('Error importing products:', err);
      toast({
        title: t('import.error'),
        variant: 'destructive',
      });
    }
  }

  return (
    <FormModal
      open={isOpen}
      onOpenChange={handleClose}
      title={t('import.uploadProducts')}
      submitText={tCommon('actions.import')}
      submittingText={tCommon('actions.importing')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormProvider {...formMethods}>
        <ProductImportForm
          organizationId={organizationId as string}
          hideTabs={true}
        />
      </FormProvider>
    </FormModal>
  );
}
