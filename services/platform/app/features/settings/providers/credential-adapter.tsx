'use client';

import {
  providerBaseUrlSchema,
  SECRETS_ENV_PREFIX,
} from '@tale/shared/schemas/providers';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { RadioGroup } from '@tale/ui/radio-group';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import { RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

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
import { ModelAllowlistField } from './components/model-allowlist-field';
import {
  CUSTOM_VENDOR_KEY,
  emptyCustomProviderFacts,
  mapProviderDefinitionError,
  type CustomProviderFacts,
} from './components/provider-definition-form';
import {
  useCreateProviderCredential,
  useUpdateProviderCredential,
} from './hooks/custom-provider-mutations';
import {
  useCheckProviderDefinitionCatalog,
  useDeleteCredential,
  useSetDefaultCredential,
} from './hooks/mutations';
import type { MaskedCredential, ProviderCatalog } from './hooks/queries';
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
  envSuffix: string;
  broker: BrokerDraft;
}

const emptyProviderSecretDraft = (): ProviderSecretDraft => ({
  secret: '',
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
}: {
  method: KnownAuthMethod;
  value: ProviderSecretDraft;
  onChange: (next: ProviderSecretDraft) => void;
  disabled?: boolean;
  replacing?: boolean;
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
        {/* A subscription key is handed to a sandboxed harness rather than
            called directly, which changes where it can leak — say so before
            the field, not after. */}
        {!replacing && (
          <Text as="p" variant="muted" className="text-sm">
            {t('providers.dialog.sandboxedExplainer')}
          </Text>
        )}
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
    <BrokerFormFields
      value={value.broker}
      onChange={(broker) => onChange({ ...value, broker })}
      disabled={disabled}
    />
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
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const sameFacts = (a: CustomProviderFacts, b: CustomProviderFacts) =>
  a.apiFormat === b.apiFormat &&
  a.baseUrl === b.baseUrl &&
  a.catalogSource === b.catalogSource;

function ProviderExtraFields({
  vendor,
  value,
  onChange,
  disabled,
}: {
  vendor: ProviderVendor;
  value: ProviderCredentialExtras;
  onChange: (next: ProviderCredentialExtras) => void;
  disabled?: boolean;
}) {
  const { t } = useT('settings');
  const showsFacts = isCustomEntry(vendor) || value.custom !== undefined;

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
      ) : vendor.catalog.models.length > 0 || value.allowlist.length > 0 ? (
        <ModelAllowlistField
          models={vendor.catalog.models}
          value={value.allowlist}
          onValueChange={setAllowlist}
          disabled={disabled}
        />
      ) : null}
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
      ? { custom: factsOf(vendor) }
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
  detailLine: (t, _credential, vendor) =>
    vendor?.catalog.catalogError !== undefined
      ? t('providers.card.catalogUnavailable', {
          error: vendor.catalog.catalogError,
        })
      : undefined,

  // A custom provider lives and dies with its credentials: the last one going
  // retires the definition, and the delete dialog says so.
  deleteArgs: (_credential, vendor) =>
    isOrgDefined(vendor) ? { retireUnusedCustomProvider: true } : {},
  deleteWarning: (t, _credential, vendor, siblingCount) =>
    vendor !== null && isOrgDefined(vendor) && siblingCount === 0
      ? t('providers.custom.deleteRetires', { provider: vendor.displayName })
      : undefined,

  // "Check models" on a custom provider's row: list its endpoint afresh, with
  // this organization's key, and say how many models answered.
  useExtraActions: ({ t, vendor, organizationId, busy }) => {
    const { toast } = useToast();
    const check = useCheckProviderDefinitionCatalog(organizationId);
    if (
      vendor === null ||
      !isOrgDefined(vendor) ||
      vendor.catalog.catalogSource === 'none'
    ) {
      return [];
    }
    const handleCheck = async () => {
      try {
        const models = await check.mutateAsync({
          organizationId,
          name: vendor.key,
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
        disabled: busy || check.isPending,
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
      draft.envSuffix.length > 0 ||
      JSON.stringify(draft.broker) !== JSON.stringify(emptyBrokerDraft()),
    isComplete: (method, draft) => {
      if (isSecretLike(method)) return draft.secret.trim().length > 0;
      if (method === 'env') return draft.envSuffix.trim().length > 0;
      return isBrokerDraftComplete(draft.broker);
    },
    buildArgs: (t, method, draft) => {
      if (isSecretLike(method)) {
        return { ok: true, args: { secret: draft.secret.trim() } };
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
