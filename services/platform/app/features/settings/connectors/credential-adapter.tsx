'use client';

import type { StorableAuthMethodName } from '@tale/shared/schemas/connectors';
import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { Switch } from '@tale/ui/switch';
import { Text } from '@tale/ui/text';
import { Link2, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import {
  looseMutation,
  type CredentialAdapter,
  type CredentialConsentProps,
  type CredentialVendor,
} from '@/app/features/settings/credentials/adapter';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useAbility } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import {
  connectorConfigComplete,
  ConnectorConfigFields,
  connectorConfigExtras,
  pruneBlank,
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
import {
  oauthAppMissingExplainer,
  type OauthAppMissingExplainer,
} from './oauth-app-missing';

/**
 * How a connector's credentials plug into the shared credential UI.
 *
 * A connector's secret is one token, or a username/password pair, or an app's
 * own registration (directory, client ID and secret — the app signs in as
 * itself), or nothing at all — an OAuth grant arrives from the consent flow,
 * never from a form, which is why `hasFields` is false for it and the row
 * offers Reconnect instead of Replace secret.
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
  /** `client-credentials`: the app's directory, ID and secret. */
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** The methods a connector credential can actually be stored with. */
const STORABLE_METHODS: readonly StorableAuthMethodName[] = [
  'api-key',
  'bearer',
  'basic',
  'oauth2',
  'client-credentials',
];

const emptySecretDraft = (): SecretDraft => ({
  token: '',
  username: '',
  password: '',
  smtpSeparate: false,
  smtpUsername: '',
  smtpPassword: '',
  tenantId: '',
  clientId: '',
  clientSecret: '',
});

/** Whether an app signing in to this vendor names its directory (tenant) —
 * unknown (no vendor at hand) counts as yes, the shipped case. */
function needsTenant(vendor: ConnectorVendor | undefined): boolean {
  return vendor?.summary.clientCredentialsTenant !== false;
}

/** The vendor projection the shared UI consumes. */
export interface ConnectorVendor extends CredentialVendor {
  summary: ConnectorSummary;
}

export function toConnectorVendor(summary: ConnectorSummary): ConnectorVendor {
  return {
    key: summary.slug,
    displayName: summary.displayName,
    iconUrl: summary.iconUrl,
    // Confluence, GlitchTip and Shopify name their own instance per
    // credential; the others talk to one fixed vendor host.
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
  vendor?: ConnectorVendor;
}) {
  const { t } = useT('settings');

  if (method === 'oauth2') return null;

  if (method === 'client-credentials') {
    return (
      <>
        {needsTenant(vendor) && (
          <Input
            label={t('connectors.dialog.tenantId')}
            description={t('connectors.dialog.tenantIdHelp')}
            value={value.tenantId}
            onChange={(e) => onChange({ ...value, tenantId: e.target.value })}
            autoComplete="off"
            disabled={disabled}
            required
          />
        )}
        <Input
          label={t('connectors.dialog.clientId')}
          value={value.clientId}
          onChange={(e) => onChange({ ...value, clientId: e.target.value })}
          autoComplete="off"
          disabled={disabled}
          required
        />
        <Input
          label={t('connectors.dialog.clientSecret')}
          type="password"
          value={value.clientSecret}
          onChange={(e) => onChange({ ...value, clientSecret: e.target.value })}
          description={t('connectors.dialog.clientSecretHelp')}
          disabled={disabled}
          required
        />
      </>
    );
  }

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
 * Step two for a connector joined through OAuth: an explainer, the settings
 * the new credential is born with, and the hand-off.
 *
 * The settings travel with the consent (Outlook's mailbox decides the
 * permissions it asks for, and is fixed once the credential exists), so
 * they are entered here, beside Connect — never on the credential after it
 * was stored for the account's own mailbox.
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
  // The connector's declared settings, with the credential form's fields,
  // checks and pruning.
  const [config, setConfig] = useState<ConnectorConfigValue>({});
  // Literal keys per case, so the catalog guard sees every string in use.
  const oauthAppMissingCopy = (explainer: OauthAppMissingExplainer) => {
    const values = { connector: vendor.displayName };
    if (explainer === 'deployment') {
      return t('connectors.card.oauthAppMissingDeployment', values);
    }
    if (explainer === 'admin') {
      return t('connectors.card.oauthAppMissingAdmin', values);
    }
    return t('connectors.card.oauthAppMissing', values);
  };
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
          {oauthAppMissingCopy(
            oauthAppMissingExplainer({
              orgConfigurable: vendor.summary.oauthApp.orgConfigurable,
              canManageOrgSettings: ability.can('write', 'orgSettings'),
            }),
          )}
        </Text>
      </Stack>
    );
  }
  return (
    // A group of its own: its settings carry the same labels as the
    // credential form's below it, and belong to the connection.
    <Stack
      gap={3}
      className="border-border rounded-lg border p-4"
      role="group"
      aria-label={t('connectors.card.connectGroup', {
        connector: vendor.displayName,
      })}
    >
      <Text as="p" variant="muted" className="text-sm">
        {t('connectors.card.emptyBodyOauth', {
          connector: vendor.displayName,
        })}
      </Text>
      <ConnectorConfigFields
        vendor={vendor}
        value={config}
        onChange={setConfig}
        method="oauth2"
      />
      <div>
        <Button
          icon={Link2}
          size="sm"
          disabled={!connectorConfigComplete(config, vendor, 'oauth2')}
          onClick={() => {
            const settings = pruneBlank(config);
            goToAuthorization(organizationId, vendor.key, {
              kind: 'add',
              ...(Object.keys(settings).length > 0 && { config: settings }),
            });
          }}
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

  detailLine: (t, credential) => {
    if (credential.status === 'needs-reauth') {
      return credential.statusDetail !== undefined
        ? t('connectors.credential.needsReauthDetail', {
            detail: credential.statusDetail,
          })
        : t('connectors.credential.needsReauthHint');
    }
    // Which app an app sign-in uses — the two values its refusal says to
    // check, and neither is secret.
    const app = credential.clientApp;
    if (app === undefined) return undefined;
    return app.tenantId === undefined
      ? t('connectors.credential.clientApp', { clientId: app.clientId })
      : t('connectors.credential.clientAppInTenant', {
          clientId: app.clientId,
          tenantId: app.tenantId,
        });
  },

  // Rotating an app's client secret keeps its directory and application ID,
  // which the row shows; only the secret is typed again.
  replaceDraft: (credential) => ({
    ...emptySecretDraft(),
    tenantId: credential.clientApp?.tenantId ?? '',
    clientId: credential.clientApp?.clientId ?? '',
  }),

  // Deleting a connector's default hands it to the oldest active credential
  // left (the server's `defaultSuccessor`), which the listing names on the
  // default's row — so the confirm says who takes over, not the AI
  // providers' "no default remains".
  deleteWarning: (t, credential) => {
    if (!credential.isDefault) return undefined;
    const successor = credential.defaultSuccessor;
    if (successor === undefined) {
      return t('connectors.credential.deleteDefaultHandsOnOldest');
    }
    return successor === null
      ? t('connectors.credential.deleteDefaultLeavesNone')
      : t('connectors.credential.deleteDefaultHandsOn', {
          name: successor.name,
        });
  },

  // Nothing resolves its key through a connector credential by reference.
  useDeleteWarning: () => undefined,

  useExtraActions: ({ t, credential, organizationId, busy }) => [
    {
      key: 'reconnect',
      label: t('connectors.credential.reconnect'),
      icon: RefreshCw,
      // Re-consent names THIS credential: the callback renews exactly it —
      // name, default and references kept — or saves nothing.
      onClick: () =>
        goToAuthorization(organizationId, credential.connectorSlug, {
          kind: 'reconnect',
          credentialId: credential.id,
        }),
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
      draft.smtpPassword.length > 0 ||
      draft.tenantId.length > 0 ||
      draft.clientId.length > 0 ||
      draft.clientSecret.length > 0,
    isComplete: (method, draft, vendor) => {
      if (method === 'client-credentials') {
        return (
          (!needsTenant(vendor) || draft.tenantId.trim().length > 0) &&
          draft.clientId.trim().length > 0 &&
          draft.clientSecret.trim().length > 0
        );
      }
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
      if (method === 'client-credentials') {
        return {
          ok: true,
          args: {
            ...(draft.tenantId.trim().length > 0 && {
              tenantId: draft.tenantId.trim(),
            }),
            clientId: draft.clientId.trim(),
            clientSecret: draft.clientSecret.trim(),
          },
        };
      }
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
        case 'client-credentials':
          return t('connectors.replace.clientCredentialsTitle');
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
