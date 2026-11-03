import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { useForm } from '@tale/ui/use-form';
import { useMemo } from 'react';
import { z } from 'zod';

import { failureText } from '@/app/lib/api/failure';
import type { Session } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';
import { SESSION_NAME_MAX_LENGTH, nameLength } from '@/lib/session-name';

import { useSessionActions } from '../hooks/use-session-actions';
import { isRefusal, settle } from '../lib/settle';

interface RenameForm {
  name: string;
}

interface RenameSessionDialogProps {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A dialog with the session's name to change. The name is only a label, so it
 * works in any status; a name another session has, or one the backend finds
 * invalid, is told beside the field.
 */
export function RenameSessionDialog({
  session,
  open,
  onOpenChange,
}: RenameSessionDialogProps) {
  const { t } = useT('sessions');
  const { t: tErrors } = useT('errors');
  const { rename } = useSessionActions();

  const schema = useMemo(() => {
    const invalid = tErrors('invalid_name');
    return z.object({
      name: z
        .string()
        .trim()
        .min(1, invalid)
        // As the backend counts: an emoji is one character.
        .refine((name) => nameLength(name) <= SESSION_NAME_MAX_LENGTH, invalid),
    });
  }, [tErrors]);
  const { register, handleSubmit, setError, clearErrors, formState } =
    useForm<RenameForm>({
      resolver: zodResolver(schema),
      defaultValues: { name: session.name },
    });

  const submit = handleSubmit(async ({ name }) => {
    if (name === session.name) {
      onOpenChange(false);
      return;
    }
    const result = await settle(rename.mutateAsync({ id: session.id, name }));
    if (result.ok) {
      onOpenChange(false);
    } else if (isRefusal(result.error, 'name_taken', 'invalid_name')) {
      setError(
        'name',
        { message: failureText(result.error, tErrors) },
        // The button that was pressed was off while the server answered, and
        // the keyboard went with it: it comes back to the field.
        { shouldFocus: true },
      );
    }
    // Any other failure was told in a toast; the dialog stays for a retry.
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('rename.title')}
      submitText={t('rename.submit')}
      isSubmitting={rename.isPending}
      onSubmit={submit}
    >
      <Input
        label={t('rename.label')}
        maxLength={SESSION_NAME_MAX_LENGTH}
        autoComplete="off"
        spellCheck={false}
        required
        errorMessage={formState.errors.name?.message}
        {...register('name', { onChange: () => clearErrors('name') })}
      />
    </FormDialog>
  );
}
