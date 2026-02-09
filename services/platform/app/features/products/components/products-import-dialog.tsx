'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useCallback } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useFileImport, productMappers } from '@/app/hooks/use-file-import';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import {
  ProductStatus,
  PRODUCT_STATUS,
} from '@/lib/shared/constants/convex-enums';

import { useCreateProduct } from '../hooks/use-create-product';
import { ProductImportForm } from './product-import-form';

type FormValues = {
  file: File;
};

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

export function ProductsImportDialog({
  isOpen,
  onClose,
  organizationId,
  onSuccess,
}: ImportProductsDialogProps) {
  const { t } = useT('products');
  const { t: tCommon } = useT('common');

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

  const validateStatus = useCallback((value: unknown): ProductStatus => {
    // validateStatus returns string — cast required to narrow to ProductStatus enum
    return productMappers.validateStatus(
      value,
      Object.values(PRODUCT_STATUS),
      PRODUCT_STATUS.Draft,
    ) as ProductStatus;
  }, []);

  const excelMapper = useCallback(
    (record: Record<string, unknown>): ParsedProduct | null => {
      const result = productMappers.excel(record);
      if (!result) return null;

      return {
        ...result,
        status: validateStatus(result.status),
      };
    },
    [validateStatus],
  );

  const csvMapper = useCallback(
    (row: string[], _index: number): ParsedProduct | null => {
      const name = row[0]?.trim();
      if (!name) return null;

      return {
        name,
        description: row[1]?.trim() || undefined,
        imageUrl: row[2]?.trim() || undefined,
        stock: row[3] ? parseInt(row[3], 10) : 0,
        price: row[4] ? parseFloat(row[4]) : 0,
        currency: row[5]?.trim() || 'USD',
        category: row[6]?.trim() || undefined,
        status: validateStatus(row[7]),
      };
    },
    [validateStatus],
  );

  const { parseFile } = useFileImport<ParsedProduct>({
    csvMapper,
    excelMapper,
  });

  const resetForm = useCallback(() => {
    formMethods.reset();
  }, [formMethods]);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        if (!values.file) {
          toast({
            title: t('import.uploadFile'),
            variant: 'destructive',
          });
          return;
        }

        const { data: products, errors } = await parseFile(values.file);

        if (errors.length > 0 && products.length === 0) {
          toast({
            title: errors[0],
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

        const successCount = results.filter(
          (r) => r.status === 'fulfilled',
        ).length;
        const failedCount = results.filter(
          (r) => r.status === 'rejected',
        ).length;
        const importErrors = results
          .map((result, index) =>
            result.status === 'rejected'
              ? `Failed to import ${products[index].name}: ${result.reason}`
              : null,
          )
          .filter((error): error is string => error !== null);

        if (successCount > 0) {
          toast({
            title: t('import.success'),
            description: t('import.successDescription', {
              count: successCount,
              failed: failedCount,
            }),
          });

          if (importErrors.length > 0) {
            console.warn('Import errors:', importErrors);
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
    },
    [parseFile, createProduct, organizationId, t, onSuccess, handleClose],
  );

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleClose}
      title={t('import.uploadProducts')}
      submitText={tCommon('actions.import')}
      submittingText={tCommon('actions.importing')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormProvider {...formMethods}>
        <ProductImportForm organizationId={organizationId} hideTabs={true} />
      </FormProvider>
    </FormDialog>
  );
}
