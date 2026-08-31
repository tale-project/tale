'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link2, RefreshCw } from 'lucide-react';

import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  looseMutation,
  type CredentialAdapter,
  type CredentialConsentProps,
  type CredentialVendor,
} from '@/app/features/settings/credentials/adapter';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import type { StorableAuthMethodName } from '@/lib/shared/schemas/connectors';

import {
  connectorConfigExtras,
  type ConnectorConfigValue,
} from './config-fields';
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
  /**
   * imap-smtp only: send through a different SMTP login than the mailbox
   * (Resend / SendGrid / SES). Mirrors 0.3's "Use a separate SMTP provider".
   */
  smtpSeparate: boolean;
  smtpUsername: string;
  smtpPassword: string;
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
  smtpSeparate: false,
  smtpUsername: '',
  smtpPassword: '',
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
  vendor,
}: {
  method: StorableAuthMethodName;
  value: SecretDraft;
  onChange: (next: SecretDraft) => void;
  disabled?: boolean;
  vendor?: CredentialVendor;
}) {
  const { t } = useT('settings');

  if (method === 'oauth2') return null;

  if (method === 'basic') {
    // Only imap-smtp offers a second login: IMAP stays on the mailbox pair,
    // SMTP may relay through a separate provider (the 0.3 split-auth path).
    const offersSeparateSmtp = vendor?.key === 'imap-smtp';
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
        {offersSeparateSmtp && (
          <>
            <Switch
              label={t('connectors.dialog.smtpSeparateToggle')}
              description={t('connectors.dialog.smtpSeparateHint')}
              checked={value.smtpSeparate}
              onCheckedChange={(next) =>
                onChange({
                  ...value,
                  smtpSeparate: next,
                  ...(!next && { smtpUsername: '', smtpPassword: '' }),
                })
              }
              disabled={disabled}
            />
            {value.smtpSeparate && (
              <>
                <Input
                  label={t('connectors.dialog.smtpUsername')}
                  value={value.smtpUsername}
                  onChange={(e) =>
                    onChange({ ...value, smtpUsername: e.target.value })
                  }
                  autoComplete="off"
                  sensitive
                  disabled={disabled}
                  required
                />
                <Input
                  label={t('connectors.dialog.smtpPassword')}
                  type="password"
                  value={value.smtpPassword}
                  onChange={(e) =>
                    onChange({ ...value, smtpPassword: e.target.value })
                  }
                  description={t('connectors.dialog.smtpHint')}
                  disabled={disabled}
                  required
                />
              </>
            )}
          </>
        )}
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

/**
 * Step two for a connector joined through OAuth: an explainer and the hand-off.
 *
 * Renders nothing for a connector that offers no grant, so it can sit
 * unconditionally above the credential form — a connector declaring BOTH an
 * OAuth grant and a token gets both affordances, in the order an operator
 * should prefer them.
 */
function ConnectorConsent({
  organizationId,
  vendor,
}: CredentialConsentProps<ConnectorVendor>) {
  const { t } = useT('settings');
  const ability = useAbility();
  if (!vendor.summary.authMethods.includes('oauth2')) return null;
  // No app to consent against — say so here instead of sending the browser
  // to the not-configured error page. Admins get pointed at the registry.
  if (
    vendor.summary.oauthApp !== undefined &&
    !vendor.summary.oauthApp.configured
  ) {
    return (
      <Stack gap={3} className="border-border rounded-lg border p-4">
        <Text as="p" variant="muted" className="text-sm">
          {ability.can('write', 'orgSettings')
            ? t('connectors.card.oauthAppMissingAdmin', {
                connector: vendor.displayName,
              })
            : t('connectors.card.oauthAppMissing', {
                connector: vendor.displayName,
              })}
        </Text>
      </Stack>
    );
  }
  return (
    <Stack gap={3} className="border-border rounded-lg border p-4">
      <Text as="p" variant="muted" className="text-sm">
        {t('connectors.card.emptyBodyOauth', {
          connector: vendor.displayName,
        })}
      </Text>
      <div>
        <Button
          icon={Link2}
          size="sm"
          onClick={() => goToAuthorization(organizationId, vendor.key)}
        >
          {t('connectors.card.connect')}
        </Button>
      </div>
    </Stack>
  );
}

export const connectorCredentialAdapter: CredentialAdapter<
  ConnectorVendor,
  MaskedConnectorCredential,
  StorableAuthMethodName,
  SecretDraft,
  ConnectorConfigValue
> = {
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

  vendorKeyOf: (credential) => credential.connectorSlug,

  // What tells two connectors apart in the picker: what they are for, and how
  // much they can do once connected.
  vendorMeta: (t, vendor) => {
    const actions = t('connectors.card.actionCount', {
      count: vendor.summary.actionCount,
    });
    const tags = vendor.summary.tags.join(' · ');
    return tags.length > 0 ? `${tags} · ${actions}` : actions;
  },

  offersConsent: (vendor) => vendor.summary.authMethods.includes('oauth2'),
  Consent: ConnectorConsent,

  statusLabel,
  statusTone: (status) => (status === 'needs-reauth' ? 'orange' : 'slate'),

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
      draft.password.length > 0 ||
      draft.smtpSeparate ||
      draft.smtpUsername.length > 0 ||
      draft.smtpPassword.length > 0,
    isComplete: (method, draft) => {
      if (method === 'basic') {
        const mailbox =
          draft.username.trim().length > 0 && draft.password.trim().length > 0;
        if (!mailbox) return false;
        // A separate SMTP relay needs both halves — the server refuses a
        // half pair the same way.
        if (!draft.smtpSeparate) return true;
        return (
          draft.smtpUsername.trim().length > 0 &&
          draft.smtpPassword.trim().length > 0
        );
      }
      // An OAuth credential is complete by construction: there is nothing to
      // fill in.
      return method === 'oauth2' || draft.token.trim().length > 0;
    },
    // Fields the method doesn't use are omitted rather than sent empty, so the
    // server validates one clean shape. Omitting the SMTP pair on replace also
    // clears a previously stored relay login (payload is rewritten whole).
    buildArgs: (_t, method, draft) => {
      if (method === 'basic') {
        return {
          ok: true,
          args: {
            username: draft.username.trim(),
            password: draft.password.trim(),
            ...(draft.smtpSeparate && {
              smtpUsername: draft.smtpUsername.trim(),
              smtpPassword: draft.smtpPassword.trim(),
            }),
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

  // Not noExtras: a connector's declared configFields are per-credential
  // settings the server REQUIRES, so the form has to collect them.
  extra: connectorConfigExtras<ConnectorVendor, MaskedConnectorCredential>(),

  vendorArg: (vendor) => ({ connectorSlug: vendor.key }),

  mutations: {
    useCreate: () => looseMutation(useCreateCredential()),
    useUpdate: () => looseMutation(useUpdateCredential()),
    useDelete: () => looseMutation(useDeleteCredential()),
    useSetDefault: () => looseMutation(useSetDefaultCredential()),
  },
};
