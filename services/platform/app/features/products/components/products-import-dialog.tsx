'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useMemo, useCallback, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';

import {
  type ImportRowError,
  importRowErrorLine,
  mergeImportRowErrors,
} from '@/app/features/shared/import/import-row-errors';
import { ImportRowErrorsAlert } from '@/app/features/shared/import/import-row-errors-alert';
import {
  useFileImport,
  productMappers,
  PRODUCT_REQUIRED_COLUMNS,
} from '@/app/hooks/use-file-import';
import { useT } from '@/lib/i18n/client';
import type { ProductStatus } from '@/lib/shared/constants/product-enums';
import { PRODUCT_STATUS } from '@/lib/shared/constants/product-enums';
import { backendRefusalReason } from '@/lib/utils/backend-error';

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
  // The rows the last attempt could not land, by spreadsheet line; the
  // dialog stays open over them so the user can fix the file and retry.
  const [rowErrors, setRowErrors] = useState<ImportRowError[]>([]);

  const validateStatus = useCallback(
    (value: unknown): ProductStatus =>
      productMappers.validateStatus(
        value,
        Object.values(PRODUCT_STATUS),
        PRODUCT_STATUS.Draft,
      ),
    [],
  );

  const recordMapper = useCallback(
    (record: Record<string, unknown>): ParsedProduct | null => {
      const result = productMappers.record(record);
      if (!result) return null;

      return {
        ...result,
        status: validateStatus(result.status),
      };
    },
    [validateStatus],
  );

  const { parseFile } = useFileImport<ParsedProduct>({
    csvMapper: productMappers.csv,
    excelMapper: recordMapper,
    requiredColumns: PRODUCT_REQUIRED_COLUMNS,
  });

  const resetForm = useCallback(() => {
    formMethods.reset();
    setRowErrors([]);
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

        const parsed = await parseFile(values.file);
        const { data: products, errors } = parsed;

        if (errors.length > 0) {
          toast({
            title: errors[0],
            variant: 'destructive',
          });
          return;
        }

        if (products.length === 0 && parsed.rowErrors.length === 0) {
          toast({
            title: t('noValidData'),
            variant: 'destructive',
          });
          return;
        }

        // The rows the parser refused are listed beside the ones the server
        // refuses; the rest of the file still lands (the REST bulk
        // semantics), so a thousand good rows never wait on one bad one.
        const result =
          products.length > 0
            ? await bulkCreateProducts({ organizationId, products })
            : { success: 0, failed: 0, errors: [] };
        const failedRows = mergeImportRowErrors(parsed, result.errors);
        setRowErrors(failedRows);

        if (result.success > 0) {
          toast({
            title: t('import.success'),
            description: t('import.successDescription', {
              success: result.success,
              failed: failedRows.length,
            }),
            variant: 'success',
          });
          onSuccess?.();
          if (failedRows.length === 0) handleClose();
        } else {
          toast({
            title: t('noneImported'),
            description: failedRows[0]
              ? importRowErrorLine(tCommon, failedRows[0])
              : t('import.errorCodes.unknown'),
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('Error importing products:', err);
        toast({
          title: t('import.error'),
          // A refused file names its row and column ("products.1.price: …").
          description: backendRefusalReason(err),
          variant: 'destructive',
        });
      }
    },
    [
      parseFile,
      bulkCreateProducts,
      organizationId,
      t,
      tCommon,
      onSuccess,
      handleClose,
    ],
  );

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleClose}
      size="entity"
      title={t('import.uploadProducts')}
      submitText={tCommon('actions.import')}
      submittingText={tCommon('actions.importing')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormProvider {...formMethods}>
        <ProductImportForm organizationId={organizationId} hideTabs={true} />
      </FormProvider>
      <ImportRowErrorsAlert errors={rowErrors} />
    </FormDialog>
  );
}
