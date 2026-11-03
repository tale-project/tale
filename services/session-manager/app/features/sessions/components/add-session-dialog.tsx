import { Alert } from '@tale/ui/alert';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Select } from '@tale/ui/select';
import { useForm } from '@tale/ui/use-form';
import { useLayoutEffect, useState, type RefObject } from 'react';

import { useMeta } from '@/app/hooks/use-meta';
import { failureText } from '@/app/lib/api/failure';
import { OS_CHOICES, osChoiceSchema, type OsChoice } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';
import { SESSION_NAME_MAX_LENGTH } from '@/lib/session-name';

import { useBrowserBlock } from '../hooks/use-browser-block';
import { useProxyFlow } from '../hooks/use-proxy-flow';
import { isRefusal } from '../lib/settle';

interface AddForm {
  name: string;
  os: OsChoice;
}

interface AddSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the keyboard goes back to when the control that opened the dialog cannot take it (a click that did not focus it). */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The dialog that adds a session: an optional name (without one, the next free
 * number) and the system its fingerprint is for. The session starts right away
 * and opens. A name another session has, or one the backend finds invalid, is
 * told beside the field. A session needs a proxy of its own: when none is free
 * the dialog gives way to the one that adds some (see `useProxyFlow`), and the
 * session is added with this name and system once there are.
 */
export function AddSessionDialog({
  open,
  onOpenChange,
  restoreFocusRef,
}: AddSessionDialogProps) {
  const { t } = useT('sessions');
  const { t: tErrors } = useT('errors');
  const meta = useMeta();
  const browserBlock = useBrowserBlock();
  const flow = useProxyFlow();
  // What had the keyboard when the dialog opened. When no proxy is free this
  // dialog closes for the one that adds some, which cannot know the button
  // behind them both: it is told, so that giving it up returns the keyboard
  // there, as a start from a row returns it to the row's button.
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Noted once: in development the effect is set up twice as the dialog
    // mounts, and the second time the dialog has the keyboard already.
    setOpener((noted) => {
      if (noted !== null) return noted;
      const active = document.activeElement;
      return active instanceof HTMLElement && active !== document.body
        ? active
        : (restoreFocusRef?.current ?? null);
    });
  }, [restoreFocusRef]);
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    watch,
    formState,
  } = useForm<AddForm>({ defaultValues: { name: '', os: 'random' } });

  const osLabels: Record<OsChoice, string> = {
    random: t('add.os.random'),
    windows: t('add.os.windows'),
    macos: t('add.os.macos'),
    linux: t('add.os.linux'),
  };
  const offered = meta.data?.osOptions ?? OS_CHOICES;
  const osOptions = OS_CHOICES.filter((choice) => offered.includes(choice)).map(
    (value) => ({ value, label: osLabels[value] }),
  );

  const submit = handleSubmit(async ({ name, os }) => {
    const trimmed = name.trim();
    const attempt = await flow.create(
      trimmed === '' ? { os } : { name: trimmed, os },
      { returnFocusTo: opener },
    );
    if (attempt.kind === 'refused') {
      // A name is told here, beside its field; anything else was told as a
      // toast, and the dialog stays to try again.
      if (isRefusal(attempt.error, 'name_taken', 'invalid_name')) {
        setError(
          'name',
          { message: failureText(attempt.error, tErrors) },
          // The button that was pressed was off while the server answered, and
          // the keyboard went with it: it comes back to the field to change.
          { shouldFocus: true },
        );
      }
      return;
    }
    // Added, and its page opens; or no proxy is free and the dialog that adds
    // some has taken over. This one is done either way.
    onOpenChange(false);
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('add.title')}
      description={t('add.description')}
      submitText={t('add.submit')}
      isSubmitting={formState.isSubmitting}
      isValid={browserBlock === null}
      onSubmit={submit}
      {...(restoreFocusRef === undefined ? {} : { restoreFocusRef })}
    >
      {browserBlock !== null && (
        <Alert variant="info" description={browserBlock} live="off" />
      )}
      <Input
        label={t('add.name')}
        // The number it gets when left empty is the example; the rule is the hint.
        hint={t('add.nameHint')}
        placeholder={meta.data?.nextSessionName}
        maxLength={SESSION_NAME_MAX_LENGTH}
        autoComplete="off"
        spellCheck={false}
        errorMessage={formState.errors.name?.message}
        {...register('name', { onChange: () => clearErrors('name') })}
      />
      <Select
        label={t('add.system')}
        options={osOptions}
        value={watch('os')}
        onValueChange={(value) => {
          const os = osChoiceSchema.safeParse(value);
          if (os.success) setValue('os', os.data);
        }}
      />
    </FormDialog>
  );
}
