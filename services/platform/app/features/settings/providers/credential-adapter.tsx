'use client';

import {
  providerBaseUrlSchema,
  SECRETS_ENV_PREFIX,
  type ProviderDefinition,
} from '@tale/shared/schemas/providers';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { RadioGroup } from '@tale/ui/radio-group';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  looseMutation,
  type CredentialAdapter,
  type CredentialExtraModule,
  type CredentialVendor,
} from '@/app/features/settings/credentials/adapter';
import { useT } from '@/lib/i18n/client';

import {
  BrokerFormFields,
  buildBrokerDocument,
  emptyBrokerDraft,
  isBrokerDraftComplete,
  type BrokerDraft,
} from './components/broker-form';
import {
  ModelAllowlistField,
  sameList,
} from './components/model-allowlist-field';
import {
  buildCustomProviderDefinition,
  catalogFailureText,
  CUSTOM_VENDOR_KEY,
  emptyCustomProviderFacts,
  mapProviderDefinitionError,
  type CustomProviderFacts,
} from './components/provider-definition-form';
import { SubscriptionScopeNotice } from './components/subscription-scope-notice';
import {
  useCreateProviderCredential,
  useUpdateProviderCredential,
  type ReviewedVersions,
} from './hooks/custom-provider-mutations';
import {
  useCheckProviderDefinitionCatalog,
  useDeleteCredential,
  useListProviderCatalogWithKey,
  useSetDefaultCredential,
} from './hooks/mutations';
import {
  type CatalogModel,
  type MaskedCredential,
  type ProviderCatalog,
  useCredentialDependents,
} from './hooks/queries';
import {
  settingLeftBehindLabel,
  useSettingsLeftBehind,
} from './hooks/settings-left-behind';
import {
  apiFormatLabel,
  authMethodLabel,
  isKnownAuthMethod,
  type KnownAuthMethod,
} from './labels';

/**
 * The AI-providers surface's half of the shared credential UI: the secret
 * shapes a provider credential takes (an API key, an env-var name, a broker
 * document), the model allowlist, and the organization's own CUSTOM
 * providers — the picker's pinned entry whose setup step collects the
 * provider's wire format and base URL beside the key, and whose credentials
 * edit those facts and carry the provider away with the last of them.
 */

export interface ProviderSecretDraft {
  secret: string;
  accountId: string;
  envSuffix: string;
  broker: BrokerDraft;
}

const emptyProviderSecretDraft = (): ProviderSecretDraft => ({
  secret: '',
  accountId: '',
  envSuffix: '',
  broker: emptyBrokerDraft(),
});

/** Host of a provider's base URL, for the catalog's wire-facts line. Absent for
 *  per-credential-endpoint providers, whose credentials carry their own URL. */
function baseUrlHost(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch (err) {
    console.warn('providers: unparsable provider baseUrl', baseUrl, err);
    return baseUrl;
  }
}

/** Methods whose material is a single opaque string. */
const isSecretLike = (method: KnownAuthMethod) =>
  method === 'api-key' || method === 'subscription-key';

export interface ProviderVendor extends CredentialVendor {
  catalog: ProviderCatalog;
}

export function toProviderVendor(catalog: ProviderCatalog): ProviderVendor {
  return {
    key: catalog.name,
    displayName: catalog.displayName,
    iconUrl: catalog.iconUrl,
    // Azure-style providers have no fixed baseUrl — every credential carries
    // its own resource endpoint.
    needsEndpoint: catalog.endpointMode === 'per-credential',
    catalog,
  };
}

/** The picker's pinned entry: not a provider yet, the way to define one. */
const isCustomEntry = (vendor: ProviderVendor): boolean =>
  vendor.key === CUSTOM_VENDOR_KEY;

/** A provider this organization defined (from the entry above, or from its
 * config tree) — its credentials own the provider's facts. */
const isOrgDefined = (vendor: ProviderVendor | null | undefined): boolean =>
  vendor !== null &&
  vendor !== undefined &&
  vendor.catalog.origin === 'organization';

/** The versions an organization-defined provider's credential and its facts
 * are read at: the credential listing's row hash, and the hash the catalog
 * listing gives the definition beside those facts. Absent while the listing
 * carries no hash, which the save refuses rather than guess. */
function reviewedOf(
  credential: MaskedCredential,
  vendor: ProviderVendor,
): { reviewed?: ReviewedVersions } {
  const definitionHash = vendor.catalog.definitionHash;
  return definitionHash === undefined
    ? {}
    : { reviewed: { credentialHash: credential.hash, definitionHash } };
}

/** The facts an organization-defined provider's credential edits — read off
 * the catalog listing, which is the definition's public shape. */
function factsOf(vendor: ProviderVendor): CustomProviderFacts {
  return {
    providerSlug: vendor.key,
    apiFormat: vendor.catalog.apiFormat,
    baseUrl: vendor.catalog.baseUrl ?? '',
    catalogSource:
      vendor.catalog.catalogSource === 'none' ? 'none' : 'models-endpoint',
  };
}

function SecretFields({
  method,
  value,
  onChange,
  disabled,
  replacing,
  vendor,
}: {
  method: KnownAuthMethod;
  value: ProviderSecretDraft;
  onChange: (next: ProviderSecretDraft) => void;
  disabled?: boolean;
  replacing?: boolean;
  vendor?: ProviderVendor;
}) {
  const { t } = useT('settings');

  if (method === 'api-key') {
    return (
      <Input
        label={
          replacing
            ? t('providers.replace.apiKeyLabel')
            : t('providers.dialog.secret')
        }
        type="password"
        value={value.secret}
        onChange={(e) => onChange({ ...value, secret: e.target.value })}
        disabled={disabled}
        required
      />
    );
  }

  if (method === 'subscription-key') {
    return (
      <>
        {/* A subscription key is handed to the vendor's own harness in a
            sandbox, never called directly — so it serves tasks and
            automations and never chat. Say so before the field, not after. */}
        {!replacing && <SubscriptionScopeNotice />}
        <Input
          label={
            replacing
              ? t('providers.replace.subscriptionKeyLabel')
              : t('providers.dialog.subscriptionSecret')
          }
          type="password"
          value={value.secret}
          onChange={(e) => onChange({ ...value, secret: e.target.value })}
          disabled={disabled}
          required
        />
        {vendor?.catalog.authMethods.includes('subscription-key') &&
          vendor.catalog.subscriptionAccountIdVar !== undefined && (
            <Input
              label={t('providers.dialog.subscriptionAccountId')}
              value={value.accountId}
              onChange={(e) =>
                onChange({ ...value, accountId: e.target.value })
              }
              description={
                replacing ? t('providers.replace.accountIdKeep') : undefined
              }
              disabled={disabled}
              required={!replacing}
            />
          )}
      </>
    );
  }

  if (method === 'env') {
    return (
      <Input
        label={t('providers.dialog.envName')}
        prefix={SECRETS_ENV_PREFIX}
        value={value.envSuffix}
        onChange={(e) => onChange({ ...value, envSuffix: e.target.value })}
        description={t('providers.dialog.envNameHelp')}
        disabled={disabled}
        required
      />
    );
  }

  return (
    <>
      {!replacing && <SubscriptionScopeNotice />}
      <BrokerFormFields
        value={value.broker}
        onChange={(broker) => onChange({ ...value, broker })}
        disabled={disabled}
      />
    </>
  );
}

/**
 * The non-secret half of a provider credential: the model allowlist every
 * provider has, plus — for the custom entry and for a credential of an
 * organization-defined provider — the provider's own facts.
 */
export interface ProviderCredentialExtras {
  allowlist: string[];
  /** Present while the setup step is the custom entry, or the credential
   * belongs to an organization-defined provider. Absent for a shipped one. */
  custom?: CustomProviderFacts;
  /** For an organization-defined provider's credential: the versions the
   * form was seeded at, which its Save names. Never edited. */
  reviewed?: ReviewedVersions;
  /** For an organization-defined provider's credential: the credential its
   * model listing uses, and the provider facts as saved — the listing goes
   * to the saved endpoint only, never to one the form has not saved yet.
   * Never edited. */
  saved?: { credentialId: string; facts: CustomProviderFacts };
}

const sameFacts = (a: CustomProviderFacts, b: CustomProviderFacts) =>
  a.apiFormat === b.apiFormat &&
  a.baseUrl === b.baseUrl &&
  a.catalogSource === b.catalogSource;

/** The slug a provider being set up lists under: it is not saved, so it
 * names nothing — no shipped provider carries it. */
const DRAFT_PROVIDER_SLUG = 'custom-provider-draft';

/** What a listing from the dialog goes out with: the provider being set up
 * and the key typed beside it, or a saved provider and its credential.
 * `null` while there is nothing to list yet — a base URL the schema refuses,
 * or an edit whose endpoint differs from the saved one. */
function listingArgs(
  facts: CustomProviderFacts,
  value: ProviderCredentialExtras,
  secretArgs: Record<string, unknown> | undefined,
): {
  definition?: ProviderDefinition;
  name?: string;
  secret?: string;
  credentialId?: string;
} | null {
  if (value.saved !== undefined) {
    return sameFacts(facts, value.saved.facts)
      ? {
          name: value.saved.facts.providerSlug,
          credentialId: value.saved.credentialId,
        }
      : null;
  }
  const built = buildCustomProviderDefinition({
    name: DRAFT_PROVIDER_SLUG,
    displayName: DRAFT_PROVIDER_SLUG,
    apiFormat: facts.apiFormat,
    baseUrl: facts.baseUrl,
    catalogSource: 'models-endpoint',
  });
  if (!built.ok) return null;
  const secret = secretArgs?.secret;
  return {
    definition: built.config,
    ...(typeof secret === 'string' && secret !== '' ? { secret } : {}),
  };
}

/** How long the add dialog waits after the last keystroke in the base URL or
 * the key before it lists by itself: a listing goes when the typing stops,
 * never per keystroke. */
export const AUTO_LIST_DELAY_MS = 1000;

/** What one listing is asked of: the endpoint and the key it goes with. A
 * listing the dialog already ran for these is not run again by itself. */
const listingKeyOf = (
  args: NonNullable<ReturnType<typeof listingArgs>>,
): string =>
  JSON.stringify([
    args.definition?.apiFormat,
    args.definition?.baseUrl,
    args.name,
    args.secret,
    args.credentialId,
  ]);

/**
 * **List models** under a custom provider's facts: the endpoint's `/models`
 * read with the key this dialog holds — typed beside the facts while the
 * provider is being added, the credential's own in an edit — before
 * anything is saved, so a key-gated gateway lists its models here instead
 * of refusing the organization's default key, or none. The result fills the
 * allowlist picker; a failure says, inline, whether a key went.
 *
 * While a provider is being added, the listing runs by itself once a base
 * URL the schema takes and a typed key are both there: after the typing
 * stops ({@link AUTO_LIST_DELAY_MS}), once per endpoint and key — a change
 * of either before it goes cancels it, and an answer to an endpoint or key
 * the form has moved on from is dropped. The button stays, for a retry.
 */
function ModelListing({
  organizationId,
  facts,
  value,
  secretArgs,
  disabled,
  onListed,
}: {
  organizationId: string;
  facts: CustomProviderFacts;
  value: ProviderCredentialExtras;
  secretArgs: Record<string, unknown> | undefined;
  disabled?: boolean;
  onListed: (models: CatalogModel[] | null) => void;
}) {
  const { t } = useT('settings');
  const list = useListProviderCatalogWithKey();
  const [outcome, setOutcome] = useState<
    { ok: true; count: number } | { ok: false; message: string } | null
  >(null);
  const args = listingArgs(facts, value, secretArgs);
  const listingKey = args === null ? null : listingKeyOf(args);
  // The endpoint and key the form holds now — an answer counts only for
  // these — and every endpoint and key already listed, so the automatic run
  // asks each once.
  const current = useRef(listingKey);
  current.current = listingKey;
  const listed = useRef(new Set<string>());
  // The latest render's closure, for the timer to call.
  const run = useRef<() => void>(() => {});

  // An answer for an endpoint or key the form has moved on from is dropped,
  // and those count as not listed: back on them, the listing runs again.
  const stale = (asked: string): boolean => {
    if (current.current === asked) return false;
    listed.current.delete(asked);
    return true;
  };

  const handleList = () => {
    if (args === null || listingKey === null) return;
    const asked = listingKey;
    listed.current.add(asked);
    setOutcome(null);
    list.mutateAsync({ organizationId, ...args }).then(
      (models) => {
        if (stale(asked)) return;
        onListed(models);
        setOutcome({ ok: true, count: models.length });
      },
      (err: unknown) => {
        console.error(
          'providers: model listing with the dialog key failed',
          err,
        );
        if (stale(asked)) return;
        onListed(null);
        setOutcome({
          ok: false,
          message: t('providers.custom.listModelsFailed', {
            error: mapProviderDefinitionError(t, err),
          }),
        });
      },
    );
  };
  run.current = handleList;

  // Only while adding (an edit lists the saved credential's key on a
  // click), and only with a typed key: a keyless listing of a key-gated
  // endpoint is a refusal the reader did not ask for.
  const autoKey =
    value.saved === undefined && disabled !== true && args?.secret !== undefined
      ? listingKey
      : null;
  useEffect(() => {
    if (autoKey === null || listed.current.has(autoKey)) return undefined;
    // A click in the meantime listed these already.
    const timer = setTimeout(() => {
      if (!listed.current.has(autoKey)) run.current();
    }, AUTO_LIST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoKey]);

  return (
    <Stack gap={2}>
      <div>
        <Button
          type="button"
          variant="secondary"
          icon={RefreshCw}
          onClick={handleList}
          disabled={disabled === true || args === null}
          isLoading={list.isPending}
        >
          {t('providers.custom.listModels')}
        </Button>
      </div>
      <Text as="p" variant="muted" className="text-sm">
        {t('providers.custom.listModelsHelp')}
      </Text>
      <div aria-live="polite">
        {outcome?.ok === true && (
          <Text as="p" className="text-sm">
            {t('providers.custom.listModelsOk', { count: outcome.count })}
          </Text>
        )}
      </div>
      {outcome?.ok === false && (
        <Alert variant="destructive" description={outcome.message} />
      )}
    </Stack>
  );
}

function ProviderExtraFields({
  vendor,
  value,
  onChange,
  disabled,
  organizationId,
  secretArgs,
}: {
  vendor: ProviderVendor;
  value: ProviderCredentialExtras;
  onChange: (next: ProviderCredentialExtras) => void;
  disabled?: boolean;
  organizationId?: string;
  secretArgs?: Record<string, unknown>;
}) {
  const { t } = useT('settings');
  const showsFacts = isCustomEntry(vendor) || value.custom !== undefined;
  // What the dialog's own listing answered, and for which endpoint: a
  // changed base URL or format shows the provider's listing again.
  const [listed, setListed] = useState<{
    facts: CustomProviderFacts;
    models: CatalogModel[];
  } | null>(null);

  // The custom entry starts from blank facts. Seeded here rather than in
  // `empty`, so a shipped vendor's extras never carry facts it has no say in.
  useEffect(() => {
    if (isCustomEntry(vendor) && value.custom === undefined) {
      onChange({ ...value, custom: emptyCustomProviderFacts() });
    }
  }, [onChange, value, vendor]);

  const setAllowlist = (allowlist: string[]) =>
    onChange({ ...value, allowlist });

  if (!showsFacts) {
    // Without a catalog there is nothing to pick from, so the field becomes
    // free entry (on Azure the ids are the resource's deployment names).
    const freeText = vendor.catalog.catalogSource === 'none';
    if (
      vendor.catalog.models.length === 0 &&
      !freeText &&
      value.allowlist.length === 0
    ) {
      return null;
    }
    return (
      <ModelAllowlistField
        models={vendor.catalog.models}
        freeText={freeText}
        value={value.allowlist}
        onValueChange={setAllowlist}
        disabled={disabled}
      />
    );
  }

  const facts = value.custom ?? emptyCustomProviderFacts();
  const setFacts = (patch: Partial<CustomProviderFacts>) =>
    onChange({ ...value, custom: { ...facts, ...patch } });
  const listedModels =
    listed !== null && sameFacts(listed.facts, facts)
      ? listed.models
      : vendor.catalog.models;

  return (
    <Stack gap={4}>
      <RadioGroup
        label={t('providers.custom.apiFormat')}
        value={facts.apiFormat}
        onValueChange={(next) =>
          setFacts({ apiFormat: next === 'anthropic' ? 'anthropic' : 'openai' })
        }
        options={[
          {
            value: 'openai',
            label: apiFormatLabel(t, 'openai'),
            description: t('providers.custom.apiFormatOpenaiHelp'),
          },
          {
            value: 'anthropic',
            label: apiFormatLabel(t, 'anthropic'),
            description: t('providers.custom.apiFormatAnthropicHelp'),
          },
        ]}
        disabled={disabled}
      />
      <Input
        label={t('providers.custom.baseUrl')}
        placeholder="https://models.example.com/v1"
        inputMode="url"
        autoComplete="off"
        value={facts.baseUrl}
        onChange={(e) => setFacts({ baseUrl: e.target.value })}
        description={t('providers.custom.baseUrlHelp')}
        disabled={disabled}
        required
      />
      <RadioGroup
        label={t('providers.custom.models')}
        value={facts.catalogSource}
        onValueChange={(next) =>
          setFacts({
            catalogSource: next === 'none' ? 'none' : 'models-endpoint',
          })
        }
        options={[
          {
            value: 'models-endpoint',
            label: t('providers.custom.modelsDiscover'),
            description: t('providers.custom.modelsDiscoverHelp'),
          },
          {
            value: 'none',
            label: t('providers.custom.modelsManual'),
            description: t('providers.custom.modelsManualHelp'),
          },
        ]}
        disabled={disabled}
      />
      {facts.catalogSource === 'none' ? (
        <ModelAllowlistField
          models={[]}
          freeText
          value={value.allowlist}
          onValueChange={setAllowlist}
          disabled={disabled}
        />
      ) : (
        <>
          {organizationId !== undefined && (
            <ModelListing
              organizationId={organizationId}
              facts={facts}
              value={value}
              secretArgs={secretArgs}
              disabled={disabled}
              onListed={(models) =>
                setListed(models === null ? null : { facts, models })
              }
            />
          )}
          {listedModels.length > 0 || value.allowlist.length > 0 ? (
            <ModelAllowlistField
              models={listedModels}
              value={value.allowlist}
              onValueChange={setAllowlist}
              disabled={disabled}
            />
          ) : null}
        </>
      )}
    </Stack>
  );
}

const providerExtras: CredentialExtraModule<
  ProviderVendor,
  MaskedCredential,
  ProviderCredentialExtras
> = {
  empty: () => ({ allowlist: [] }),
  fromCredential: (credential, vendor) => ({
    allowlist: credential.modelAllowlist ?? [],
    ...(vendor !== undefined && isOrgDefined(vendor)
      ? {
          custom: factsOf(vendor),
          ...reviewedOf(credential, vendor),
          saved: { credentialId: credential.id, facts: factsOf(vendor) },
        }
      : {}),
  }),
  // Blank facts count as the untouched baseline: the custom entry seeds
  // them on open, and an unfilled form is nothing to warn about discarding.
  isDirty: (value, baseline) =>
    !sameList(value.allowlist, baseline.allowlist) ||
    !sameFacts(
      value.custom ?? emptyCustomProviderFacts(),
      baseline.custom ?? emptyCustomProviderFacts(),
    ),
  createArgs: (value) => ({
    ...(value.allowlist.length > 0 ? { modelAllowlist: value.allowlist } : {}),
    ...(value.custom !== undefined ? { customProvider: value.custom } : {}),
  }),
  // The allowlist is sent even when empty, and as an explicit `null`: that is
  // how the server is told to CLEAR the restriction rather than leave the
  // stored list in place.
  editArgs: (value) => ({
    modelAllowlist: value.allowlist.length > 0 ? value.allowlist : null,
    ...(value.custom !== undefined ? { customProvider: value.custom } : {}),
    ...(value.reviewed !== undefined ? { reviewed: value.reviewed } : {}),
  }),
  isComplete: (value, vendor) => {
    if (!isCustomEntry(vendor) && value.custom === undefined) return true;
    const facts = value.custom;
    if (facts === undefined) return false;
    if (!providerBaseUrlSchema.safeParse(facts.baseUrl.trim()).success)
      return false;
    // Without a listing the allowlist IS the model set — an empty one would
    // define a provider that can serve nothing.
    return facts.catalogSource !== 'none' || value.allowlist.length > 0;
  },
  Fields: ProviderExtraFields,
};

export const providerCredentialAdapter: CredentialAdapter<
  ProviderVendor,
  MaskedCredential,
  KnownAuthMethod,
  ProviderSecretDraft,
  ProviderCredentialExtras
> = {
  logTag: 'providers',
  mapError: (err, t) => mapProviderDefinitionError(t, err),
  methodLabel: authMethodLabel,

  // A provider may declare methods this page has no form for (a vendor
  // subscription bound to a harness); offer only what the dialog can build.
  formMethods: (vendor) => vendor.catalog.authMethods.filter(isKnownAuthMethod),

  methodOf: (credential) =>
    isKnownAuthMethod(credential.authMethod) ? credential.authMethod : null,

  vendorKeyOf: (credential) => credential.providerSlug,

  // What tells two providers apart in the picker: the wire dialect a call takes,
  // the host it goes to, and how many models are reachable through it. A
  // provider ships no description of its own, so these facts ARE its summary.
  vendorMeta: (t, vendor) => {
    if (isCustomEntry(vendor)) return t('providers.custom.pickerDescription');
    const format = apiFormatLabel(t, vendor.catalog.apiFormat);
    const host = baseUrlHost(vendor.catalog.baseUrl);
    const facts =
      host !== undefined
        ? t('providers.card.facts', { format, host })
        : vendor.catalog.endpointMode === 'per-credential'
          ? t('providers.card.factsPerCredential', { format })
          : format;
    // A count only where there is a catalog to count.
    return vendor.catalog.catalogSource === 'none'
      ? facts
      : `${facts} · ${t('providers.card.modelCount', {
          count: vendor.catalog.models.length,
        })}`;
  },

  // The organization's own providers sit among the shipped vendors in the
  // picker and the table; the tag is what says which is which.
  vendorTag: (t, vendor) =>
    isOrgDefined(vendor) ? t('providers.custom.badge') : null,

  // The pinned entry under the catalog: an endpoint the organization runs or
  // subscribes to that no shipped vendor is. Its setup step names the
  // provider and collects its facts beside the key.
  customVendor: {
    key: CUSTOM_VENDOR_KEY,
    make: (t) =>
      toProviderVendor({
        name: CUSTOM_VENDOR_KEY,
        displayName: t('providers.custom.pickerTitle'),
        apiFormat: 'openai',
        catalogSource: 'models-endpoint',
        authMethods: ['api-key', 'env'],
        models: [],
      }),
  },

  // The name of a custom provider's credential names the provider too.
  nameField: (t, vendor) =>
    isCustomEntry(vendor) || isOrgDefined(vendor)
      ? {
          label: t('providers.custom.nameLabel'),
          placeholder: t('providers.custom.namePlaceholder'),
          description: t('providers.custom.nameHelp'),
        }
      : {},

  statusLabel: (t, status) =>
    status === 'disabled' ? t('providers.credential.disabled') : null,
  statusTone: () => 'slate',

  // A provider with two working keys and no model list still cannot serve a
  // request, so the catalog failure belongs on every row that depends on it.
  // Otherwise a subscription row says where it runs: chat never offers its
  // models, and the row is where an admin looks for why.
  detailLine: (t, credential, vendor) =>
    vendor?.catalog.catalogError !== undefined
      ? t('providers.card.catalogUnavailable', {
          error: catalogFailureText(
            t,
            vendor.catalog.catalogError,
            vendor.catalog.catalogErrorCode,
          ),
        })
      : credential.authMethod === 'subscription-key' ||
          credential.authMethod === 'subscription-broker'
        ? t('providers.credential.tasksOnly')
        : undefined,

  // A custom provider lives and dies with its credentials: the last one going
  // retires the definition, and the delete dialog says so.
  deleteArgs: (_credential, vendor) =>
    isOrgDefined(vendor) ? { retireUnusedCustomProvider: true } : {},
  deleteWarning: (t, _credential, vendor, siblingCount) =>
    vendor !== null && isOrgDefined(vendor) && siblingCount === 0
      ? t('providers.custom.deleteRetires', { provider: vendor.displayName })
      : undefined,

  // The embedding model resolves its key through a credential: deleting
  // that one takes knowledge indexing and search down, so the dialog says
  // so up front (the server refuses the delete with `CREDENTIAL_IN_USE`).
  // The provider's last active credential also takes its models away from
  // the settings that name them: the dialog names those too, and the delete
  // leaves them as they are (PCRED-R7).
  useDeleteWarning: ({ t, credential, vendor, organizationId, open }) => {
    const { locale } = useLocale();
    const dependents = useCredentialDependents(organizationId, credential.id, {
      enabled: open,
    });
    const settings = useSettingsLeftBehind({
      organizationId,
      credential,
      open,
      serverSettings: dependents.data?.settings,
    });
    return (
      [
        dependents.data?.usedBy.includes('embedding')
          ? t('providers.credential.deleteEmbeddingWarning')
          : undefined,
        settings.length > 0
          ? t('providers.credential.deleteSettingsWarning', {
              provider: vendor?.displayName ?? credential.providerSlug,
              settings: new Intl.ListFormat(locale, {
                type: 'conjunction',
              }).format(
                settings.map((item) => settingLeftBehindLabel(t, item)),
              ),
            })
          : undefined,
      ]
        .filter((line) => line !== undefined)
        .join(' ') || undefined
    );
  },

  // "Check models" on a custom provider's row: list its endpoint afresh with
  // THIS row's key, and say how many models answered. The default's check
  // refreshes the listing every reader shares; another credential's is
  // asked with its own key and answers this row alone.
  useExtraActions: ({ t, credential, vendor, organizationId, busy }) => {
    const { toast } = useToast();
    const check = useCheckProviderDefinitionCatalog(organizationId);
    const listWithKey = useListProviderCatalogWithKey();
    if (
      vendor === null ||
      !isOrgDefined(vendor) ||
      vendor.catalog.catalogSource === 'none'
    ) {
      return [];
    }
    const handleCheck = async () => {
      try {
        const models =
          credential.isDefault && credential.status === 'active'
            ? await check.mutateAsync({ organizationId, name: vendor.key })
            : await listWithKey.mutateAsync({
                organizationId,
                name: vendor.key,
                credentialId: credential.id,
              });
        toast({
          title: t('providers.custom.checkOk', {
            name: vendor.displayName,
            count: models.length,
          }),
        });
      } catch (err) {
        console.error('providers: custom provider catalog check failed', err);
        toast({
          title: t('providers.custom.checkFailed', {
            name: vendor.displayName,
            error: mapProviderDefinitionError(t, err),
          }),
          variant: 'destructive',
        });
      }
    };
    return [
      {
        key: 'check-models',
        label: t('providers.custom.check'),
        icon: RefreshCw,
        onClick: () => void handleCheck(),
        disabled: busy || check.isPending || listWithKey.isPending,
      },
    ];
  },

  endpointField: (t) => ({
    label: t('providers.dialog.endpointUrl'),
    placeholder: 'https://your-resource.openai.azure.com/openai/v1',
    description: t('providers.dialog.endpointUrlHelp'),
  }),

  secret: {
    empty: emptyProviderSecretDraft,
    isDirty: (draft) =>
      draft.secret.length > 0 ||
      draft.accountId.length > 0 ||
      draft.envSuffix.length > 0 ||
      JSON.stringify(draft.broker) !== JSON.stringify(emptyBrokerDraft()),
    isComplete: (method, draft, vendor, replacing) => {
      if (isSecretLike(method)) {
        return (
          draft.secret.trim().length > 0 &&
          (method !== 'subscription-key' ||
            // A replacement that names no account ID keeps the stored one.
            replacing === true ||
            !vendor?.catalog.authMethods.includes('subscription-key') ||
            vendor.catalog.subscriptionAccountIdVar === undefined ||
            draft.accountId.trim().length > 0)
        );
      }
      if (method === 'env') return draft.envSuffix.trim().length > 0;
      return isBrokerDraftComplete(draft.broker);
    },
    buildArgs: (t, method, draft) => {
      if (isSecretLike(method)) {
        // Only a subscription key carries an account ID. The draft outlives a
        // method change, and the server refuses one on any other method.
        const accountId =
          method === 'subscription-key' ? draft.accountId.trim() : '';
        return {
          ok: true,
          args: {
            secret: draft.secret.trim(),
            ...(accountId !== '' ? { accountId } : {}),
          },
        };
      }
      if (method === 'env') {
        return {
          ok: true,
          args: { envName: `${SECRETS_ENV_PREFIX}${draft.envSuffix.trim()}` },
        };
      }
      const built = buildBrokerDocument(draft.broker);
      if (!built.ok) {
        // Wrapped, not raw: `buildBrokerDocument` reports which field is wrong,
        // and the frame says what that failure was an attempt at.
        return {
          ok: false,
          message: t('providers.broker.invalid', { error: built.message }),
        };
      }
      return { ok: true, args: { broker: built.document } };
    },
    hasFields: () => true,
    replaceTitle: (t, method) => {
      switch (method) {
        case 'api-key':
          return t('providers.replace.apiKeyTitle');
        case 'env':
          return t('providers.replace.envTitle');
        case 'subscription-key':
          return t('providers.replace.subscriptionKeyTitle');
        case 'subscription-broker':
          return t('providers.replace.brokerTitle');
        default:
          return null;
      }
    },
    replaceNote: (t, method) =>
      method === 'subscription-broker'
        ? t('providers.replace.brokerNote')
        : undefined,
    Fields: SecretFields,
  },

  extra: providerExtras,

  vendorArg: (vendor) => ({ providerSlug: vendor.key }),

  mutations: {
    useCreate: () => looseMutation(useCreateProviderCredential()),
    useUpdate: () => looseMutation(useUpdateProviderCredential()),
    useDelete: () => looseMutation(useDeleteCredential()),
    useSetDefault: () => looseMutation(useSetDefaultCredential()),
  },
};
