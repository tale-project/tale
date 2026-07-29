'use client';

import { Alert } from '@tale/ui/alert';
import { useState } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';

/**
 * "Add credential" for one vendor. The method picker offers exactly the methods
 * that vendor declares — nothing else is offered, because nothing else would
 * authenticate — and the secret fields below switch with the picked method. A
 * vendor whose endpoint is per credential also requires the instance origin.
 *
 * Server refusals (a name already taken, a method the vendor doesn't accept, an
 * endpoint that isn't an https origin) render inline with the server's own
 * message, which already names the fix.
 */
export function CredentialCreateDialog<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  vendor,
  adapter,
  open,
  onOpenChange,
}: {
  organizationId: string;
  vendor: V;
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const create = adapter.mutations.useCreate();
  const { secret, extra } = adapter;

  const methods = adapter.formMethods(vendor);
  const fallbackMethod = methods[0];
  const endpoint = adapter.endpointField(t, vendor);

  const [method, setMethod] = useState<Method | null>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Draft>(secret.empty);
  const [extraValue, setExtraValue] = useState<Extra>(extra.empty);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeMethod = method ?? fallbackMethod;

  const reset = () => {
    setMethod(null);
    setName('');
    setDraft(secret.empty());
    setExtraValue(extra.empty());
    setEndpointUrl('');
    setError(null);
  };

  // A vendor that declares no method this surface can author cannot be added
  // to by hand at all; the card offers consent (or nothing) instead.
  if (activeMethod === undefined) return null;

  const isDirty =
    name.trim().length > 0 ||
    endpointUrl.length > 0 ||
    secret.isDirty(draft) ||
    extra.isDirty(extraValue, extra.empty());

  const isValid =
    name.trim().length > 0 &&
    secret.isComplete(activeMethod, draft) &&
    (!vendor.needsEndpoint || endpointUrl.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending || !isValid) return;
    setError(null);

    // Client-validated material (the provider broker document) can fail to
    // build; say so inline rather than sending known-bad input.
    const built = secret.buildArgs(activeMethod, draft);
    if (!built.ok) {
      setError(built.message);
      return;
    }

    try {
      await create.mutateAsync({
        organizationId,
        ...adapter.vendorArg(vendor),
        authMethod: activeMethod,
        name: name.trim(),
        ...built.args,
        ...(vendor.needsEndpoint && { endpointUrl: endpointUrl.trim() }),
        ...extra.createArgs(extraValue),
      });
      toast({ title: t('credentials.createdToast') });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error(`${adapter.logTag}: create credential failed`, err);
      setError(adapter.mapError(err));
    }
  };

  const SecretFields = secret.Fields;
  const ExtraFields = extra.Fields;

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('credentials.addTitle')}
      description={t('credentials.addDescription', {
        vendor: vendor.displayName,
      })}
      submitText={t('credentials.create')}
      isSubmitting={create.isPending}
      isDirty={isDirty}
      isValid={isValid}
      confirmDiscardOnDirty
      onSubmit={(e) => void handleSubmit(e)}
    >
      {error !== null && <Alert variant="destructive" description={error} />}
      {/* One offered method needs no picker — the field would be a control with
          a single choice. */}
      {methods.length > 1 && (
        <Select
          label={t('credentials.method')}
          value={activeMethod}
          onValueChange={(next) => {
            const picked = methods.find((entry) => entry === next);
            if (picked === undefined) return;
            setMethod(picked);
            setError(null);
          }}
          options={methods.map((entry) => ({
            value: entry,
            label: adapter.methodLabel(t, entry),
          }))}
          disabled={create.isPending}
        />
      )}
      <Input
        label={t('credentials.name')}
        placeholder={t('credentials.namePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        description={t('credentials.nameHelp')}
        maxLength={100}
        disabled={create.isPending}
        required
      />
      <SecretFields
        method={activeMethod}
        value={draft}
        onChange={setDraft}
        disabled={create.isPending}
      />
      {vendor.needsEndpoint && (
        <Input
          label={endpoint.label}
          placeholder={endpoint.placeholder}
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          description={endpoint.description}
          disabled={create.isPending}
          required
        />
      )}
      {ExtraFields !== null && (
        <ExtraFields
          vendor={vendor}
          value={extraValue}
          onChange={setExtraValue}
          disabled={create.isPending}
        />
      )}
    </FormDialog>
  );
}
