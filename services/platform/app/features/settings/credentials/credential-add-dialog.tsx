'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { Dialog } from '@tale/ui/dialog/dialog';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useId, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { uniqueCredentialName } from '@/lib/shared/utils/credential-name';

import {
  type CredentialAdapter,
  type CredentialLike,
  type CredentialVendor,
} from './adapter';
import { VendorPickerPane } from './vendor-picker-pane';

/**
 * Adding a credential, in two steps inside ONE dialog: pick the vendor from the
 * full catalog, then set it up.
 *
 * One `Dialog` rather than two that hand off to each other — swapping Radix
 * roots mid-flow flashes the backdrop between steps, and a wizard whose frame
 * blinks reads as two unrelated dialogs. The header's back control is what makes
 * step two feel like a step rather than a new surface.
 *
 * Step two is either the credential form or, for a vendor whose only auth method
 * is an OAuth grant, the surface's own consent hand-off: there is no secret to
 * type, so there is no form to show.
 */
export function CredentialAddDialog<
  V extends CredentialVendor,
  Cred extends CredentialLike,
  Method extends string,
  Draft,
  Extra,
>({
  organizationId,
  vendors,
  credentials,
  adapter,
  open,
  onOpenChange,
  searchPlaceholder,
  catalogEmpty,
}: {
  organizationId: string;
  /** The whole shipped catalog, in any order — step one sorts it. */
  vendors: readonly V[];
  /**
   * The credentials the organization already holds on this surface: their
   * vendors lead the picker, and their names are what a new credential's
   * suggested name numbers past.
   */
  credentials: readonly Cred[];
  adapter: CredentialAdapter<V, Cred, Method, Draft, Extra>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchPlaceholder: string;
  /** Operator-facing copy for a deployment that ships no vendors at all. */
  catalogEmpty: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();
  const create = adapter.mutations.useCreate();
  const { secret, extra } = adapter;
  const formId = useId();

  const [vendor, setVendor] = useState<V | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  // The name step two opened with, kept beside what the field holds now: an
  // untouched suggestion is nothing the reader typed, so closing over it has
  // nothing to discard.
  const [suggestedName, setSuggestedName] = useState('');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Draft>(secret.empty);
  const [extraValue, setExtraValue] = useState<Extra>(extra.empty);
  const [endpointUrl, setEndpointUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inUseKeys = useMemo(
    () =>
      new Set(credentials.map((credential) => adapter.vendorKeyOf(credential))),
    [adapter, credentials],
  );

  const methods = useMemo(
    () => (vendor === null ? [] : adapter.formMethods(vendor)),
    [adapter, vendor],
  );
  const activeMethod = method ?? methods[0];

  const isDirty =
    name.trim() !== suggestedName.trim() ||
    endpointUrl.length > 0 ||
    secret.isDirty(draft) ||
    extra.isDirty(extraValue, extra.empty());

  const clearSetup = useCallback(() => {
    setMethod(null);
    setSuggestedName('');
    setName('');
    setDraft(secret.empty());
    setExtraValue(extra.empty());
    setEndpointUrl('');
    setError(null);
  }, [extra, secret]);

  const backToPicker = useCallback(() => {
    setVendor(null);
    clearSetup();
  }, [clearSetup]);

  // Step two opens already named after the vendor, numbered past the names
  // its credentials hold ("OpenRouter", then "OpenRouter 2"), so keeping the
  // suggestion can never collide with a sibling. Taken once, on the pick: the
  // credential list is live, and a derived suggestion would renumber under
  // the reader whenever it moved — the credential being saved included.
  const selectVendor = (next: V) => {
    const suggestion = uniqueCredentialName(
      credentials
        .filter((credential) => adapter.vendorKeyOf(credential) === next.key)
        .map((credential) => credential.name),
      next.displayName,
    );
    setVendor(next);
    setSuggestedName(suggestion);
    setName(suggestion);
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (create.isPending) return;
    // Same guard `FormDialog` applies: typed-but-unsaved secret material is
    // worth one prompt before it is thrown away.
    if (isDirty && !globalThis.confirm(tCommon('discardChangesConfirm')))
      return;
    backToPicker();
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (vendor === null || activeMethod === undefined) return;
    if (create.isPending) return;
    setError(null);

    // Client-validated material (the provider broker document) can fail to
    // build; say so inline rather than sending known-bad input.
    const built = secret.buildArgs(t, activeMethod, draft);
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
      backToPicker();
      onOpenChange(false);
    } catch (err) {
      console.error(`${adapter.logTag}: create credential failed`, err);
      setError(adapter.mapError(err));
    }
  };

  const isValid =
    vendor !== null &&
    activeMethod !== undefined &&
    name.trim().length > 0 &&
    secret.isComplete(activeMethod, draft) &&
    (!vendor.needsEndpoint || endpointUrl.trim().length > 0) &&
    // A required extra field (a connector's configFields) is as mandatory as
    // the secret — without this the form submits and the server refuses with
    // "needs <label>", naming a field the user was never asked for.
    (extra.isComplete?.(extraValue, vendor) ?? true);

  const SecretFields = secret.Fields;
  const ExtraFields = extra.Fields;
  const Consent = adapter.Consent;
  const endpoint =
    vendor === null ? undefined : adapter.endpointField(t, vendor);

  // A vendor can offer BOTH a grant and a hand-entered secret (GitHub takes
  // either), so these are two independent affordances on one step, not a
  // branch. Consent leads: it is the safer join where a vendor supports it.
  const setupIsForm = vendor !== null && activeMethod !== undefined;
  const setupHasConsent =
    vendor !== null &&
    Consent !== undefined &&
    adapter.offersConsent?.(vendor) === true;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={
        vendor === null
          ? t('credentials.catalog.title')
          : t('credentials.addTitle')
      }
      description={
        vendor === null
          ? t('credentials.catalog.description')
          : t('credentials.addDescription', { vendor: vendor.displayName })
      }
      // Fixed height on the picker only: the catalog scrolls inside a stable
      // frame instead of the dialog growing to a dozen vendors, while the form
      // keeps sizing to its own fields.
      className={vendor === null ? 'md:h-[70dvh] md:max-h-[70dvh]' : undefined}
      {...(vendor !== null
        ? { onBack: backToPicker, backLabel: tCommon('actions.back') }
        : {})}
      footer={
        setupIsForm ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOpenChange(false)}
              disabled={create.isPending}
            >
              {tCommon('actions.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              disabled={!isValid}
              isLoading={create.isPending}
            >
              {t('credentials.create')}
            </Button>
          </>
        ) : undefined
      }
    >
      {vendor === null && (
        <VendorPickerPane
          vendors={vendors}
          inUseKeys={inUseKeys}
          adapter={adapter}
          onSelect={selectVendor}
          searchPlaceholder={searchPlaceholder}
          catalogEmpty={catalogEmpty}
        />
      )}

      {vendor !== null && (
        <Stack gap={4}>
          {setupHasConsent && Consent !== undefined && (
            <Consent
              organizationId={organizationId}
              vendor={vendor}
              onBack={backToPicker}
              onClose={() => {
                backToPicker();
                onOpenChange(false);
              }}
            />
          )}

          {setupIsForm && endpoint !== undefined && (
            <form id={formId} onSubmit={(e) => void handleSubmit(e)}>
              <Stack>
                {error !== null && (
                  <Alert variant="destructive" description={error} />
                )}
                {/* One offered method needs no picker — the field would be a control
                with a single choice. */}
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
                  vendor={vendor}
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
              </Stack>
            </form>
          )}
        </Stack>
      )}
    </Dialog>
  );
}
