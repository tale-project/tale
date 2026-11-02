import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@tale/ui/button';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { useForm } from '@tale/ui/use-form';
import { useMemo, useState, type RefObject } from 'react';
import { z } from 'zod';

import { ApiError } from '@/app/lib/api/client';
import type { Proxy, Scheme } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { useParseErrorText } from '../hooks/use-parse-error-text';
import { useAddProxy } from '../hooks/use-proxy-actions';
import { addressOf, hostPortOf } from '../lib/address';
import { existingIdOfRefusal, parseCauseOfRefusal } from '../lib/refusals';
import { SchemeField } from './scheme-field';

export interface AddProxyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The proxy of the pool with this id, if it is loaded: a duplicate names it. */
  findProxy: (id: number) => Proxy | undefined;
  /** Shows a proxy in the table (it narrows the search to it). */
  onShow: (query: string) => void;
  /** A proxy was added: the page may show the pool as it is now. */
  onAdded?: () => void;
  /** Where the focus goes back to when the button that opened the dialog is gone. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

interface FormValues {
  proxy: string;
}

/**
 * Adds one proxy. The form lives in a component of its own that only exists
 * while the dialog is open: it starts empty every time, and its hooks do not
 * run during the closing animation.
 */
export function AddProxyDialog(props: AddProxyDialogProps) {
  if (!props.open) return null;
  return <AddProxyForm {...props} />;
}

function AddProxyForm({
  onOpenChange,
  findProxy,
  onShow,
  onAdded,
  restoreFocusRef,
}: AddProxyDialogProps) {
  const { t } = useT('proxies');
  const { t: tErrors } = useT('errors');
  const parseErrorText = useParseErrorText();
  const add = useAddProxy();
  const [scheme, setScheme] = useState<Scheme>('http');
  // The proxy a `duplicate` refusal says is in the pool already.
  const [existing, setExisting] = useState<Proxy | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        proxy: z.string().trim().min(1, t('add.required')),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    // Not on blur: opened from a menu, the field is blurred once as the menu
    // hands its focus back, which would show "Enter a proxy." on a fresh form.
    mode: 'onSubmit',
    resolver: zodResolver(schema),
    defaultValues: { proxy: '' },
  });

  /** A refusal the dialog words beside its field; `null` for any other. */
  const refusalOf = (
    error: unknown,
  ): { message: string; existing: Proxy | null } | null => {
    if (!(error instanceof ApiError)) return null;
    switch (error.code) {
      case 'invalid_proxy': {
        const cause = parseCauseOfRefusal(error);
        const reason =
          cause === null ? '' : parseErrorText(cause.code, cause.params, '');
        return {
          message: reason === '' ? tErrors('invalid_proxy') : reason,
          existing: null,
        };
      }
      case 'duplicate': {
        const id = existingIdOfRefusal(error);
        const known = id === null ? undefined : findProxy(id);
        return {
          message:
            known === undefined
              ? tErrors('duplicate')
              : t('add.duplicateOf', { proxy: addressOf(known) }),
          existing: known ?? null,
        };
      }
      case 'validation_error':
        return { message: tErrors('validation_error'), existing: null };
      default:
        return null;
    }
  };

  const submit = handleSubmit(async ({ proxy }) => {
    try {
      await add.mutateAsync({ proxy, scheme });
    } catch (error) {
      const refusal = refusalOf(error);
      // Any other failure was told in a toast; the dialog stays for a retry.
      if (refusal === null) {
        console.warn(
          'The proxy was not added',
          error instanceof ApiError ? error.code : error,
        );
        return;
      }
      setExisting(refusal.existing);
      setError(
        'proxy',
        { type: 'server', message: refusal.message },
        { shouldFocus: true },
      );
      return;
    }
    onAdded?.();
    onOpenChange(false);
  });

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      size="lg"
      title={t('add.title')}
      description={t('add.description')}
      submitText={t('add.submit')}
      isSubmitting={add.isPending}
      onSubmit={(event) => void submit(event)}
      restoreFocusRef={restoreFocusRef}
    >
      <Input
        {...register('proxy', {
          onChange: () => {
            clearErrors('proxy');
            setExisting(null);
          },
        })}
        label={t('add.label')}
        placeholder={t('add.placeholder')}
        hint={t('add.hint')}
        errorMessage={errors.proxy?.message}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {existing !== null && (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onShow(hostPortOf(existing))}
          >
            {t('add.show')}
          </Button>
        </div>
      )}
      <SchemeField value={scheme} onChange={setScheme} />
    </FormDialog>
  );
}
