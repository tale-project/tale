'use client';

import { RefreshCw } from 'lucide-react';

import { Input } from '@/app/components/ui/forms/input';
import {
  looseMutation,
  noExtras,
  type CredentialAdapter,
  type CredentialVendor,
} from '@/app/features/settings/credentials/adapter';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useT } from '@/lib/i18n/client';
import type { StorableAuthMethodName } from '@/lib/shared/schemas/connectors';

import { goToAuthorization } from './connector-oauth';
import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from './hooks/backend';
import {
  useCreateCredential,
  useDeleteCredential,
  useSetDefaultCredential,
  useUpdateCredential,
} from './hooks/mutations';
import {
  authMethodLabel,
  endpointHelp,
  endpointPlaceholder,
  statusLabel,
} from './labels';

/**
 * How a connector's credentials plug into the shared credential UI.
 *
 * A connector's secret is one token, or a username/password pair, or nothing at
 * all — an OAuth grant arrives from the consent flow, never from a form, which
 * is why `hasFields` is false for it and the row offers Reconnect instead of
 * Replace secret.
 */

export interface SecretDraft {
  token: string;
  username: string;
  password: string;
}

/** The methods a connector credential can actually be stored with. */
const STORABLE_METHODS: readonly StorableAuthMethodName[] = [
  'api-key',
  'bearer',
  'basic',
  'oauth2',
];

const emptySecretDraft = (): SecretDraft => ({
  token: '',
  username: '',
  password: '',
});

/** The vendor projection the shared UI consumes. */
export interface ConnectorVendor extends CredentialVendor {
  summary: ConnectorSummary;
}

export function toConnectorVendor(summary: ConnectorSummary): ConnectorVendor {
  return {
    key: summary.slug,
    displayName: summary.displayName,
    iconUrl: summary.iconUrl,
    // Confluence and Shopify name their own instance per credential; the
    // others talk to one fixed vendor host.
    needsEndpoint: summary.endpointMode === 'per-credential',
    summary,
  };
}

function SecretFields({
  method,
  value,
  onChange,
  disabled,
}: {
  method: StorableAuthMethodName;
  value: SecretDraft;
  onChange: (next: SecretDraft) => void;
  disabled?: boolean;
}) {
  const { t } = useT('settings');

  if (method === 'oauth2') return null;

  if (method === 'basic') {
    return (
      <>
        <Input
          label={t('connectors.dialog.username')}
          value={value.username}
          onChange={(e) => onChange({ ...value, username: e.target.value })}
          autoComplete="off"
          sensitive
          disabled={disabled}
          required
        />
        <Input
          label={t('connectors.dialog.password')}
          type="password"
          value={value.password}
          onChange={(e) => onChange({ ...value, password: e.target.value })}
          disabled={disabled}
          required
        />
      </>
    );
  }

  return (
    <Input
      label={
        method === 'api-key'
          ? t('connectors.dialog.apiKey')
          : t('connectors.dialog.token')
      }
      type="password"
      value={value.token}
      onChange={(e) => onChange({ ...value, token: e.target.value })}
      description={
        method === 'bearer' ? t('connectors.dialog.tokenHelp') : undefined
      }
      disabled={disabled}
      required
    />
  );
}

export const connectorCredentialAdapter: CredentialAdapter<
  ConnectorVendor,
  MaskedConnectorCredential,
  StorableAuthMethodName,
  SecretDraft,
  undefined
> = {
  ns: 'connectors',
  logTag: 'connectors',
  mapError: mapCredentialError,
  methodLabel: authMethodLabel,

  // OAuth leaves the page for consent rather than filling in a form, so it is
  // not a pickable method here. (`platform` never reaches the client at all —
  // the catalog action drops those connectors from the listing.)
  formMethods: (vendor) =>
    vendor.summary.authMethods.filter((method) => method !== 'oauth2'),

  methodOf: (credential) =>
    STORABLE_METHODS.find((method) => method === credential.authMethod) ?? null,

  statusLabel,
  statusTone: (status) => (status === 'needs-reauth' ? 'orange' : 'slate'),

  facts: (credential) => [credential.maskedPreview, credential.endpointUrl],

  detailLine: (t, credential) =>
    credential.status === 'needs-reauth'
      ? credential.statusDetail !== undefined
        ? t('connectors.credential.needsReauthDetail', {
            detail: credential.statusDetail,
          })
        : t('connectors.credential.needsReauthHint')
      : undefined,

  extraActions: ({ t, credential, organizationId, busy }) => [
    {
      key: 'reconnect',
      label: t('connectors.credential.reconnect'),
      icon: RefreshCw,
      // Re-consent is the same hand-off as a first connection; the callback
      // refreshes the grant this credential already holds.
      onClick: () =>
        goToAuthorization(organizationId, credential.connectorSlug),
      visible: credential.authMethod === 'oauth2',
      disabled: busy,
    },
  ],

  endpointField: (t, vendor) => ({
    label: t('connectors.dialog.endpointUrl'),
    placeholder: endpointPlaceholder(vendor.key),
    description: endpointHelp(t, vendor.key),
  }),

  secret: {
    empty: emptySecretDraft,
    isDirty: (draft) =>
      draft.token.length > 0 ||
      draft.username.length > 0 ||
      draft.password.length > 0,
    isComplete: (method, draft) => {
      if (method === 'basic') {
        return (
          draft.username.trim().length > 0 && draft.password.trim().length > 0
        );
      }
      // An OAuth credential is complete by construction: there is nothing to
      // fill in.
      return method === 'oauth2' || draft.token.trim().length > 0;
    },
    // Fields the method doesn't use are omitted rather than sent empty, so the
    // server validates one clean shape.
    buildArgs: (_t, method, draft) => {
      if (method === 'basic') {
        return {
          ok: true,
          args: {
            username: draft.username.trim(),
            password: draft.password.trim(),
          },
        };
      }
      if (method === 'oauth2') return { ok: true, args: {} };
      return { ok: true, args: { token: draft.token.trim() } };
    },
    hasFields: (method) => method !== 'oauth2',
    replaceTitle: (t, method) => {
      switch (method) {
        case 'api-key':
          return t('connectors.replace.apiKeyTitle');
        case 'bearer':
          return t('connectors.replace.tokenTitle');
        case 'basic':
          return t('connectors.replace.basicTitle');
        default:
          return null;
      }
    },
    replaceNote: (t) => t('connectors.replace.note'),
    Fields: SecretFields,
  },

  extra: noExtras<ConnectorVendor, MaskedConnectorCredential>(),

  vendorArg: (vendor) => ({ connectorSlug: vendor.key }),

  mutations: {
    useCreate: () => looseMutation(useCreateCredential()),
    useUpdate: () => looseMutation(useUpdateCredential()),
    useDelete: () => looseMutation(useDeleteCredential()),
    useSetDefault: () => looseMutation(useSetDefaultCredential()),
  },
};
