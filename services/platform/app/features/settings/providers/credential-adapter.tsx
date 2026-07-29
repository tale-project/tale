'use client';

import { Text } from '@tale/ui/text';

import { Input } from '@/app/components/ui/forms/input';
import {
  looseMutation,
  type CredentialAdapter,
  type CredentialExtraModule,
  type CredentialVendor,
} from '@/app/features/settings/credentials/adapter';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useT } from '@/lib/i18n/client';
import { SECRETS_ENV_PREFIX } from '@/lib/shared/schemas/providers';

import {
  BrokerFormFields,
  buildBrokerDocument,
  emptyBrokerDraft,
  isBrokerDraftComplete,
  type BrokerDraft,
} from './components/broker-form';
import { ModelAllowlistField } from './components/model-allowlist-field';
import {
  useCreateCredential,
  useDeleteCredential,
  useSetDefaultCredential,
  useUpdateCredential,
} from './hooks/mutations';
import type { MaskedCredential, ProviderCatalog } from './hooks/queries';
import {
  authMethodLabel,
  isKnownAuthMethod,
  type KnownAuthMethod,
} from './labels';

/**
 * How an AI provider's credentials plug into the shared credential UI.
 *
 * Four methods, four different shapes of material: an API key, a subscription
 * key destined for a sandboxed harness, the NAME of a deployment env var (no
 * secret reaches the database at all), or a whole broker document that is
 * validated client-side before any request goes out. That last one is why the
 * shared contract types `buildArgs` as a Result.
 *
 * The model allowlist rides along as the typed `extra` module — it is the one
 * non-secret field only this surface has.
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

/** The model allowlist: the one non-secret field only providers have. */
const modelAllowlistExtras: CredentialExtraModule<
  ProviderVendor,
  MaskedCredential,
  string[]
> = {
  empty: () => [],
  fromCredential: (credential) => credential.modelAllowlist ?? [],
  isDirty: (value, baseline) =>
    value.length !== baseline.length ||
    value.some((id, index) => id !== baseline[index]),
  createArgs: (value) => (value.length > 0 ? { modelAllowlist: value } : {}),
  // Sent even when empty, and as an explicit `null`: that is how the server is
  // told to CLEAR the restriction rather than leave the stored list in place.
  editArgs: (value) => ({ modelAllowlist: value.length > 0 ? value : null }),
  Fields: function AllowlistFields({ vendor, value, onChange, disabled }) {
    // Without a catalog there is nothing to pick from, so the field becomes
    // free entry (on Azure the ids are the resource's deployment names).
    const freeText = vendor.catalog.catalogSource === 'none';
    if (vendor.catalog.models.length === 0 && !freeText && value.length === 0) {
      return null;
    }
    return (
      <ModelAllowlistField
        models={vendor.catalog.models}
        freeText={freeText}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
      />
    );
  },
};

export const providerCredentialAdapter: CredentialAdapter<
  ProviderVendor,
  MaskedCredential,
  KnownAuthMethod,
  ProviderSecretDraft,
  string[]
> = {
  ns: 'providers',
  logTag: 'providers',
  mapError: mapCredentialError,
  methodLabel: authMethodLabel,

  // A provider may declare methods this page has no form for (a vendor
  // subscription bound to a harness); offer only what the dialog can build.
  formMethods: (vendor) => vendor.catalog.authMethods.filter(isKnownAuthMethod),

  methodOf: (credential) =>
    isKnownAuthMethod(credential.authMethod) ? credential.authMethod : null,

  statusLabel: (t, status) =>
    status === 'disabled' ? t('providers.credential.disabled') : null,
  statusTone: () => 'slate',

  facts: (credential) => [
    // An `env` credential stores no secret at all — the env var's NAME is the
    // honest thing to show, and it is not sensitive.
    credential.authMethod === 'env'
      ? credential.envName
      : credential.maskedPreview,
    credential.endpointUrl,
  ],

  factNote: (t, credential) =>
    credential.modelAllowlist !== undefined &&
    credential.modelAllowlist.length > 0 ? (
      <span className="text-muted-foreground text-xs">
        {t('providers.credential.allowlistCount', {
          count: credential.modelAllowlist.length,
        })}
      </span>
    ) : undefined,

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

  extra: modelAllowlistExtras,

  vendorArg: (vendor) => ({ providerSlug: vendor.key }),

  mutations: {
    useCreate: () => looseMutation(useCreateCredential()),
    useUpdate: () => looseMutation(useUpdateCredential()),
    useDelete: () => looseMutation(useDeleteCredential()),
    useSetDefault: () => looseMutation(useSetDefaultCredential()),
  },
};
