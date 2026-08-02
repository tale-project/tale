'use client';

import { Alert } from '@tale/ui/alert';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';

/**
 * Replace the secret material of one credential, with the fields the method
 * actually uses.
 *
 * Stored secrets are never read back, so the fields always start blank — there
 * is no "current value" to show and nothing to diff against. That is also why
 * this is a separate dialog from Edit: everything here is write-only.
 */
export function ReplaceSecretDialog<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  credential,
  vendor,
  adapter,
  open,
  onOpenChange,
}: {
  organizationId: string;
  credential: Cred;
  /** Null when the catalog no longer ships this credential's vendor. */
  vendor: V | null;
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const update = adapter.mutations.useUpdate();
  const { secret } = adapter;

  const method = adapter.methodOf(credential);
  const [draft, setDraft] = useState<Draft>(secret.empty);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setDraft(secret.empty());
    setError(null);
  };

  const title = method === null ? null : secret.replaceTitle(t, method);
  const note = method === null ? undefined : secret.replaceNote?.(t, method);
  const isValid = method !== null && secret.isComplete(method, draft);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (update.isPending || !isValid) return;
    setError(null);

    if (method === null) return;
    const built = secret.buildArgs(t, method, draft);
    if (!built.ok) {
      setError(built.message);
      return;
    }

    try {
      await update.mutateAsync({
        organizationId,
        credentialId: credential.id,
        ...built.args,
      });
      toast({ title: t('credentials.savedToast') });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error(`${adapter.logTag}: replace credential secret failed`, err);
      setError(adapter.mapError(err));
    }
  };

  // No replacement form for this method — the row never offers the action, and
  // this guard keeps the two from disagreeing if it ever did.
  if (method === null || title === null) return null;

  const SecretFields = secret.Fields;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={title}
      description={credential.name}
      isSubmitting={update.isPending}
      isDirty={secret.isDirty(draft)}
      isValid={isValid}
      onSubmit={(e) => void handleSubmit(e)}
    >
      {error !== null && <Alert variant="destructive" description={error} />}
      {note !== undefined && (
        <Text as="p" variant="muted" className="text-sm">
          {note}
        </Text>
      )}
      <SecretFields
        method={method}
        value={draft}
        onChange={setDraft}
        disabled={update.isPending}
        replacing
        {...(vendor !== null && { vendor })}
      />
    </FormDialog>
  );
}
