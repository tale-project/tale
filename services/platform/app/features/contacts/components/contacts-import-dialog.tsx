'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useCallback, useMemo, useState } from 'react';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';

import {
  type ImportRowError,
  importRowErrorLine,
  mergeImportRowErrors,
} from '@/app/features/shared/import/import-row-errors';
import { ImportRowErrorsAlert } from '@/app/features/shared/import/import-row-errors-alert';
import {
  CONTACT_REQUIRED_COLUMNS,
  contactMappers,
  useFileImport,
} from '@/app/hooks/use-file-import';
import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';
import { backendRefusalReason } from '@/lib/utils/backend-error';

import { useBulkCreateContacts } from '../hooks/mutations';
import { ContactImportForm } from './contact-import-form';

export interface ParsedContact {
  email: string;
  name?: string;
  // Omitted (not defaulted) when the file doesn't provide one — an explicit
  // absence, not a fabricated 'en' nobody chose (#2642).
  locale?: string;
  source: ContactDoc['source'];
}

// Type for the form data
type FormValues = {
  dataSource: 'file_upload';
  file?: File;
  syncSource?: string;
};

interface ImportContactsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
  onSuccess?: () => void;
}

/**
 * Bulk contact import from a file the user picks — the one import path, the
 * same shape products uses. (Pasting CSV text was a second door onto the same
 * parser and is gone; a spreadsheet or CSV file covers it.)
 */
export function ImportContactsDialog({
  isOpen,
  onClose,
  organizationId,
  onSuccess,
}: ImportContactsDialogProps) {
  const { t: tCommon } = useT('common');
  const { t: tContacts } = useT('contacts');

  const { parseFile } = useFileImport<ParsedContact>({
    csvMapper: contactMappers.csv,
    excelMapper: contactMappers.excel,
    requiredColumns: CONTACT_REQUIRED_COLUMNS,
  });

  // Create Zod schema with translated validation messages
  const formSchema = useMemo(
    () =>
      z
        .object({
          dataSource: z.literal('file_upload'),
          file: z.instanceof(File).optional(),
          syncSource: z.string().optional(),
        })
        .refine((data) => !!data.file, {
          message: tCommon('validation.uploadFile'),
          path: ['file'],
        }),
    [tCommon],
  );

  const formMethods = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { dataSource: 'file_upload' },
  });

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = formMethods;

  const { mutateAsync: bulkCreateContacts } = useBulkCreateContacts();
  // The rows the last attempt could not land, by spreadsheet line; the
  // dialog stays open over them so the user can fix the file and retry.
  const [rowErrors, setRowErrors] = useState<ImportRowError[]>([]);

  const handleClose = useCallback(() => {
    formMethods.reset();
    setRowErrors([]);
    onClose();
  }, [formMethods, onClose]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        if (!values.file) {
          toast({
            title: tContacts('import.provideData'),
            variant: 'destructive',
          });
          return;
        }
        const parsed = await parseFile(values.file);
        const contacts: ParsedContact[] = parsed.data;

        if (contacts.length === 0 && parsed.rowErrors.length === 0) {
          toast({
            title: tContacts('import.noValidData'),
            // Surface the specific parse failure (e.g. a missing required
            // column) instead of a generic message, so the user can fix it.
            description: parsed.errors[0],
            variant: 'destructive',
          });
          return;
        }

        // The rows the parser refused are listed beside the ones the server
        // refuses; the rest of the file still lands (the REST bulk
        // semantics), so a thousand good rows never wait on one bad one.
        const result =
          contacts.length > 0
            ? await bulkCreateContacts({ organizationId, contacts })
            : { success: 0, failed: 0, errors: [] };
        const errorCodeKeys: Record<string, string> = {
          CONTACT_DUPLICATE_EMAIL: 'import.errorCodes.duplicate_email',
          CONTACT_DUPLICATE_EXTERNAL_ID:
            'import.errorCodes.duplicate_external_id',
        };
        const failedRows = mergeImportRowErrors(
          parsed,
          // A duplicate keeps its localized sentence; a refused field its
          // `field: reason` line.
          result.errors.map((entry) => {
            const key = errorCodeKeys[entry.errorCode];
            return key === undefined
              ? entry
              : { ...entry, error: tContacts(key), issues: [] };
          }),
        );
        setRowErrors(failedRows);

        // Show results
        if (result.success > 0) {
          toast({
            title: tContacts('import.success'),
            description: tContacts('import.successDescription', {
              success: result.success,
              failed: failedRows.length,
            }),
            variant: 'success',
          });
          onSuccess?.();
          if (failedRows.length === 0) handleClose();
        } else {
          toast({
            title: tContacts('import.noneImported'),
            description: failedRows[0]
              ? importRowErrorLine(tCommon, failedRows[0])
              : tContacts('import.errorCodes.unknown'),
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('Error importing contacts:', err);
        toast({
          title: tContacts('import.error'),
          // A refused file names its row and column ("contacts.1.email: …").
          description: backendRefusalReason(err),
          variant: 'destructive',
        });
      }
    },
    [
      parseFile,
      bulkCreateContacts,
      organizationId,
      tContacts,
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
      title={tContacts('import.uploadContacts')}
      submitText={tContacts('import.import')}
      submittingText={tCommon('actions.importing')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormProvider {...formMethods}>
        <ContactImportForm organizationId={organizationId} mode="upload" />
      </FormProvider>
      <ImportRowErrorsAlert errors={rowErrors} />
    </FormDialog>
  );
}
