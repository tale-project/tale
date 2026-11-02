import { EditorSaveCancelledError, useFormEditor } from '@tale/ui/editor';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

import { ApiError } from '@/app/lib/api/client';
import { settingsApi } from '@/app/lib/api/endpoints';
import { failureText } from '@/app/lib/api/failure';
import { queryKeys } from '@/app/lib/api/keys';
import type { Settings } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

export interface StartPageValues {
  startPage: string;
}

/** The backend's refusal of an address that is not a web address. */
const REFUSED = 'invalid_start_page';

function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === REFUSED;
}

/**
 * The start page as a draft with Save and Discard. The saved value is the
 * server's, and the draft stays the person's until they save or discard it.
 */
export function useStartPageEditor(settings: Settings | undefined) {
  const { t: tErrors } = useT('errors');
  const queryClient = useQueryClient();
  const saved = settings?.startPage;

  const data = useMemo<StartPageValues | undefined>(
    () => (saved === undefined ? undefined : { startPage: saved }),
    [saved],
  );

  // The last save that went through, with the draft it sent. The server
  // completes what it is given ("duckduckgo.com" is saved as
  // "https://duckduckgo.com"; blank, as the default), but the editor makes what
  // was typed the baseline, so the field would go on showing the draft instead
  // of the saved address. Each save is its own object, so a repeat is seen.
  const [lastSave, setLastSave] = useState<{ draft: string } | null>(null);
  const adopted = useRef<object | null>(null);

  // The form is made from `save`, and `save` shows a refusal on the form.
  const formRef = useRef<UseFormReturn<StartPageValues> | null>(null);

  const save = useCallback(
    async ({ startPage }: StartPageValues) => {
      try {
        const answer = await settingsApi.update({
          startPage: startPage.trim(),
        });
        queryClient.setQueryData(queryKeys.settings, answer);
        setLastSave({ draft: startPage });
      } catch (error) {
        if (isRefusal(error)) {
          // The field says it, so the save cluster neither toasts nor claims
          // the save worked: a save that resolves flashes "Saved", this one
          // did not happen, which is what the cancel signal tells it. The
          // draft stays, with its error, for the person to repair. The button
          // that was pressed was off while the server answered, and the
          // keyboard went with it: it comes back to the field.
          formRef.current?.setError(
            'startPage',
            { type: 'server', message: failureText(error, tErrors) },
            { shouldFocus: true },
          );
          throw new EditorSaveCancelledError();
        }
        // Any other failure is the one toast of the save cluster, in the
        // person's language (the cluster prints what the thrown error says).
        throw new Error(failureText(error, tErrors), { cause: error });
      }
    },
    [queryClient, tErrors],
  );

  const editor = useFormEditor<StartPageValues>({
    data,
    defaultValues: { startPage: '' },
    save,
  });

  const { form } = editor;
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const { isSaving, reset } = editor;
  useEffect(() => {
    if (lastSave === null || isSaving || adopted.current === lastSave) return;
    adopted.current = lastSave;
    // What was typed while the save ran is the person's: leave it be.
    if (form.getValues('startPage') === lastSave.draft) reset();
  }, [form, isSaving, lastSave, reset]);

  return editor;
}
