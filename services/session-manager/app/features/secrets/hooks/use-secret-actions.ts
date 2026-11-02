import { useToast } from '@tale/ui/use-toast';

import { useApiMutation } from '@/app/hooks/use-api-mutation';
import { secretsApi } from '@/app/lib/api/endpoints';
import { queryKeys } from '@/app/lib/api/keys';
import type { SecretCreate, SecretUpdate } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { SECRET_LISTS } from './use-secrets';

// A write to a secret changes the lists and the count of secrets in the app's
// state. Nothing else shows a secret.
const AFFECTS = [SECRET_LISTS, queryKeys.meta];

// The mutation cache keeps what a write was called with, and a secret's values
// are what the form sends: the cache lets go of the write as soon as the form
// (or the question) that made it is gone, not minutes later. The form also
// resets the write once it has settled, for as long as it stays on screen.
const FORGET = 0;

/**
 * What the form words itself, beside its fields or on top of them: a value the
 * server refuses, a secret or a session that is gone. Everything else raises
 * the one failure toast.
 */
export const FORM_REFUSALS: readonly string[] = [
  'invalid_secret',
  'validation_error',
  'invalid_kind',
  'invalid_scope',
  'secret_not_found',
  'session_not_found',
];

/**
 * Everything a person does to a secret. A success says so in a brief notice;
 * a failure raises one toast, except the refusals the form words (`quietFor`).
 * The mutations answer with nothing: the secret the server returns holds the
 * hidden values, and the mutation cache would keep it for minutes. What they
 * are called with holds the values too, so they are not kept either (`FORGET`).
 */
export function useSecretActions() {
  const { t } = useT('secrets');
  const { toast } = useToast();

  const create = useApiMutation({
    mutationFn: async (input: SecretCreate) => {
      await secretsApi.create(input);
    },
    errorTitle: t('toasts.createFailed'),
    quietFor: FORM_REFUSALS,
    invalidates: AFFECTS,
    gcTime: FORGET,
    onSuccess: () => {
      toast({ title: t('toasts.created'), variant: 'success' });
    },
  });

  const update = useApiMutation({
    mutationFn: async ({
      id,
      update: changes,
    }: {
      id: number;
      update: SecretUpdate;
    }) => {
      await secretsApi.update(id, changes);
    },
    errorTitle: t('toasts.saveFailed'),
    quietFor: FORM_REFUSALS,
    invalidates: AFFECTS,
    gcTime: FORGET,
    onSuccess: () => {
      toast({ title: t('toasts.saved'), variant: 'success' });
    },
  });

  const remove = useApiMutation({
    mutationFn: ({ id }: { id: number }) => secretsApi.remove(id),
    errorTitle: t('toasts.deleteFailed'),
    invalidates: AFFECTS,
    gcTime: FORGET,
    onSuccess: () => {
      toast({ title: t('toasts.deleted'), variant: 'success' });
    },
  });

  return { create, update, remove };
}
