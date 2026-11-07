import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { useIsMac } from '@tale/ui/use-is-mac';
import { useToast } from '@tale/ui/use-toast';
import { FileUp } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { z } from 'zod';

import { ApiError } from '@/app/lib/api/client';
import type { ImportResult, Scheme } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useImportProxies } from '../hooks/use-proxy-actions';
import { countLines } from '../lib/count-lines';
import { ImportResultView } from './import-result-view';
import { SchemeField } from './scheme-field';

/** What an import says when it was opened for an action that needs a proxy. */
interface ImportPurpose {
  /** The name of the dialog. */
  title: string;
  /** Why it opened, and what happens once proxies are there. */
  intro: string;
  /** The button that imports. */
  submitText: string;
}

export interface ImportProxiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Shows a proxy in the table (it narrows the search to it). An import made
   * away from the table has none to show: its report then lists the
   * duplicates without that link.
   */
  onShow?: (query: string) => void;
  /** Where the focus goes back to when the button that opened the dialog is gone. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Opened because an action needs a proxy (a session to add, start or give
   * another proxy). The dialog says so, and closes as soon as one proxy was
   * added, whatever else the list held: the action goes on from there.
   */
  purpose?: ImportPurpose;
  /**
   * Proxies were added. The dialog then closes, or keeps its report when a line
   * repeated or failed (an import made for an action closes in both cases).
   */
  onAdded?: (result: ImportResult) => void;
}

interface FormValues {
  text: string;
}

/**
 * Imports a list of proxies, pasted or read from a `.txt` file. The form is the
 * list and the type of the lines that name none; choosing a file and the
 * shortcut that imports sit in the footer, beside Cancel, so nothing stands
 * between the list and what it needs. An import that added every line closes
 * with a notice; one that repeated or refused a line, or added nothing, shows
 * its report in place of the form, so what was refused can be read and
 * corrected; going back to the form keeps the list. The dialog only exists
 * while it is open, so every visit starts with an empty list.
 */
export function ImportProxiesDialog(props: ImportProxiesDialogProps) {
  if (!props.open) return null;
  return <ImportProxiesForm {...props} />;
}

function ImportProxiesForm({
  onOpenChange,
  onShow,
  restoreFocusRef,
  purpose,
  onAdded,
}: ImportProxiesDialogProps) {
  const { t } = useT('proxies');
  const { toast } = useToast();
  const isMac = useIsMac();
  const shortcutId = useId();
  const importProxies = useImportProxies();
  const [scheme, setScheme] = useState<Scheme>('http');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [file, setFile] = useState<{ name: string; lines: number } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const schema = useMemo(
    () => z.object({ text: z.string().trim().min(1, t('import.required')) }),
    [t],
  );
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    setFocus,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    // Not on blur: see the add dialog.
    mode: 'onSubmit',
    resolver: zodResolver(schema),
    defaultValues: { text: '' },
  });

  const typed = watch('text');

  // Back from the report, the list is the next thing to work on.
  const showedResult = useRef(false);
  useEffect(() => {
    if (result === null && showedResult.current) setFocus('text');
    showedResult.current = result !== null;
  }, [result, setFocus]);

  // What the import did decides whether there is anything left to read: a
  // clean one is told in a notice and closes; so does any that added a proxy
  // for an action that waits for one. Else the report stays.
  const finish = (imported: ImportResult) => {
    const counts = {
      added: imported.added.length,
      duplicates: imported.duplicates.length,
      errors: imported.errors.length,
    };
    // The pool changed, whether or not the report stays to be read.
    if (counts.added > 0) onAdded?.(imported);
    const clean = counts.duplicates === 0 && counts.errors === 0;
    if (counts.added === 0 || !(clean || purpose !== undefined)) {
      setResult(imported);
      return;
    }
    if (clean) {
      toast({
        variant: 'success',
        title: t('toasts.imported', { count: counts.added }),
        description: t('toasts.importedDetail', { count: counts.added }),
      });
    } else {
      // Part of the list went in and part did not: a warning, which says what.
      toast({ variant: 'warning', title: t('result.summary', counts) });
    }
    onOpenChange(false);
  };

  const submit = handleSubmit(async ({ text }) => {
    let imported: ImportResult;
    try {
      imported = await importProxies.mutateAsync({ text, scheme });
    } catch (error) {
      // Told in a toast already; the list stays, to try again.
      console.warn(
        'The proxies were not imported',
        error instanceof ApiError ? error.code : error,
      );
      return;
    }
    finish(imported);
  });

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const [chosen] = input.files ?? [];
    if (chosen === undefined) return;
    try {
      const text = await chosen.text();
      setValue('text', text, { shouldDirty: true });
      clearErrors('text');
      setFile({ name: chosen.name, lines: countLines(text) });
    } catch (error) {
      console.warn(`Could not read ${chosen.name}`, error);
      setFile(null);
      setError('text', {
        type: 'file',
        message: t('import.fileFailed', { name: chosen.name }),
      });
    }
    // Choosing the same file again must load it again.
    input.value = '';
  };

  const submitWithShortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      size="xl"
      title={purpose?.title ?? t('import.title')}
      // The list's label says one per line and the footer offers a file: only
      // an import opened for an action has something to explain.
      description={result === null ? purpose?.intro : undefined}
      submitText={purpose?.submitText ?? t('import.submit')}
      isSubmitting={importProxies.isPending}
      onSubmit={(event) => void submit(event)}
      restoreFocusRef={restoreFocusRef}
      // A report of hundreds of lines scrolls in a box of its own, with Edit
      // list and Done under it, not at the end of it.
      stickyFooter
      // A pasted list is work: Escape, a click outside and Cancel ask before
      // they throw it away. The report that follows an import is not.
      confirmDiscardOnDirty={result === null && typed.trim() !== ''}
      footerStart={
        result === null ? (
          <>
            <Button
              type="button"
              variant="ghost"
              icon={FileUp}
              onClick={() => fileInput.current?.click()}
            >
              {t('import.chooseFile')}
            </Button>
            {/* For a keyboard: a touch screen has no such keys. The hint and its
                hiding are those of the platform's task dialog (`task-modal.tsx`). */}
            <Text
              as="span"
              variant="caption"
              id={shortcutId}
              className="ml-auto max-md:hidden pointer-coarse:hidden"
            >
              {t('import.shortcut', {
                shortcut: isMac ? '⌘ Enter' : 'Ctrl + Enter',
              })}
            </Text>
          </>
        ) : undefined
      }
      customFooter={
        result === null ? undefined : (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setResult(null)}
            >
              {t('result.back')}
            </Button>
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t('result.done')}
            </Button>
          </>
        )
      }
    >
      {result === null ? (
        <>
          <Textarea
            {...register('text', { onChange: () => clearErrors('text') })}
            label={t('import.label')}
            placeholder={t('import.placeholder')}
            rows={8}
            errorMessage={errors.text?.message}
            onKeyDown={submitWithShortcut}
            aria-describedby={shortcutId}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <input
            ref={fileInput}
            type="file"
            accept=".txt,text/plain"
            hidden
            aria-label={t('import.fileInput')}
            onChange={(event) => void chooseFile(event)}
          />
          {file !== null && (
            // The name wraps, never cut: the number of lines is at its end.
            <Text
              as="span"
              variant="muted"
              role="status"
              className="-mt-2 min-w-0 wrap-anywhere"
            >
              {t('import.fileLoaded', { name: file.name, count: file.lines })}
            </Text>
          )}
          <SchemeField value={scheme} onChange={setScheme} />
        </>
      ) : (
        <ImportResultView result={result} onShow={onShow} />
      )}
    </FormDialog>
  );
}
