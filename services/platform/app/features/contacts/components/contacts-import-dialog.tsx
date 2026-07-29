'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useMemo } from 'react';
import { FormProvider } from 'react-hook-form';
import { z } from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useForm } from '@/app/components/ui/forms/use-form';
import {
  CONTACT_REQUIRED_COLUMNS,
  contactMappers,
  useFileImport,
} from '@/app/hooks/use-file-import';
import { toast } from '@/app/hooks/use-toast';
import type { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useBulkCreateContacts } from '../hooks/mutations';
import { ContactImportForm } from './contact-import-form';

export interface ParsedContact {
  email: string;
  name?: string;
  // Omitted (not defaulted) when the file doesn't provide one — an explicit
  // absence, not a fabricated 'en' nobody chose (#2642).
  locale?: string;
  source: Doc<'contacts'>['source'];
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

  const handleClose = useCallback(() => {
    formMethods.reset();
    onClose();
  }, [formMethods, onClose]);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      try {
        let contacts: ParsedContact[] = [];
        let parseErrors: string[] = [];

        if (values.file) {
          const result = await parseFile(values.file);
          contacts = result.data;
          parseErrors = result.errors;
        } else {
          toast({
            title: tContacts('import.provideData'),
            variant: 'destructive',
          });
          return;
        }

        if (contacts.length === 0) {
          toast({
            title: tContacts('import.noValidData'),
            // Surface the specific parse failure (e.g. a missing required
            // column) instead of a generic message, so the user can fix it.
            description: parseErrors[0],
            variant: 'destructive',
          });
          return;
        }

        // Import contacts using Convex
        const result = await bulkCreateContacts({
          organizationId,
          contacts,
        });

        // Show results
        if (result.success > 0) {
          toast({
            title: tContacts('import.success'),
            description: tContacts('import.successDescription', {
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
            duplicate_email: 'import.errorCodes.duplicate_email',
            duplicate_external_id: 'import.errorCodes.duplicate_external_id',
            unknown: 'import.errorCodes.unknown',
          };
          const errorKey = firstError
            ? (errorCodeKeys[firstError.errorCode] ?? errorCodeKeys['unknown'])
            : undefined;
          toast({
            title: tContacts('import.noneImported'),
            description: errorKey ? tContacts(errorKey) : undefined,
            variant: 'destructive',
          });
        }
      } catch (err) {
        console.error('Error importing contacts:', err);
        toast({
          title: tContacts('import.error'),
          variant: 'destructive',
        });
      }
    },
    [
      parseFile,
      bulkCreateContacts,
      organizationId,
      tContacts,
      onSuccess,
      handleClose,
    ],
  );

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleClose}
      title={tContacts('import.uploadContacts')}
      submitText={tContacts('import.import')}
      submittingText={tCommon('actions.importing')}
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormProvider {...formMethods}>
        <ContactImportForm organizationId={organizationId} mode="upload" />
      </FormProvider>
    </FormDialog>
  );
}
