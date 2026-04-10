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

import { useBulkCreateProducts } from '../hooks/mutations';
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

  const { mutateAsync: bulkCreateProducts } = useBulkCreateProducts();

  const validateStatus = useCallback(
    (value: unknown): ProductStatus =>
      productMappers.validateStatus(
        value,
        Object.values(PRODUCT_STATUS),
        PRODUCT_STATUS.Draft,
      ),
    [],
  );

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
    (row: string[], index: number): ParsedProduct | null => {
      const result = productMappers.csv(row, index);
      if (!result) return null;

      return {
        ...result,
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

        const result = await bulkCreateProducts({
          organizationId,
          products,
        });

        if (result.success > 0) {
          toast({
            title: t('import.success'),
            description: t('import.successDescription', {
              success: result.success,
              failed: result.failed,
            }),
            variant: 'success',
          });

          if (result.errors.length > 0) {
            console.warn('Import errors:', result.errors);
          }

          onSuccess?.();
          handleClose();
        } else {
          const firstError = result.errors[0];
          const errorCodeKeys: Record<string, string> = {
            unknown: 'import.errorCodes.unknown',
          };
          const errorKey = firstError
            ? (errorCodeKeys[firstError.errorCode] ?? errorCodeKeys['unknown'])
            : undefined;
          toast({
            title: t('noneImported'),
            description: errorKey ? t(errorKey) : undefined,
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
    [parseFile, bulkCreateProducts, organizationId, t, onSuccess, handleClose],
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
