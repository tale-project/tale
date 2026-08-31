'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useToast } from '@/app/hooks/use-toast';
import type { ItemOf, ReturnsOf } from '@/app/lib/backend/contract';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';

import type { ConnectorSummary } from '../hooks/backend';
import {
  useConnectorOauthApps,
  useEntraSsoSource,
  useOnedriveImportAppStatus,
  useRemoveConnectorOauthApp,
  useReuseSsoOauthApp,
  useUpsertConnectorOauthApp,
} from '../hooks/oauth-apps';

/**
 * The org-level OAuth app registry: for each OAuth2 connector (plus the
 * Knowledge OneDrive import, which has no catalog entry), which vendor app
 * this org's members consent against. An org row overrides the deployment's
 * `CONNECTOR_OAUTH_*` / `CLOUD_IMPORT_*` env vars; with neither, Connect
 * has nowhere to send anyone — that state is shown here instead of being
 * discovered mid-flow on an error page.
 *
 * Admin-only by the same rule as SSO: configuring where consent goes is an
 * org-security decision (`write orgSettings`), not a developer convenience.
 */

type OauthAppRow = ItemOf<'connector_oauth_apps/queries:list'>;
type EntraSsoSource = ReturnsOf<'connector_oauth_apps/queries:entraSsoSource'>;

/** Knowledge cloud-import (OneDrive/SharePoint) — no catalog entry. */
const ONEDRIVE_SLUG = 'onedrive';
/** Slugs whose vendor is Microsoft Entra — they take a directory (tenant)
 * id, because a single-tenant app registration rejects `/common`. */
const MICROSOFT_SLUGS = new Set(['outlook', 'teams', ONEDRIVE_SLUG]);

const CONNECTORS_CALLBACK_PATH = '/api/connectors/oauth2/callback';
const CLOUD_IMPORT_CALLBACK_PATH = '/api/cloud-import/oauth2/callback';

/** The redirect URIs the admin must register on the vendor app. */
function redirectUris(slug: string): string[] {
  const base = `${getEnv('SITE_URL')}${getEnv('BASE_PATH')}`;
  if (slug === ONEDRIVE_SLUG) return [`${base}${CLOUD_IMPORT_CALLBACK_PATH}`];
  if (slug === 'google-drive') {
    // One Google app serves the connector lane AND Knowledge import.
    return [
      `${base}${CONNECTORS_CALLBACK_PATH}`,
      `${base}${CLOUD_IMPORT_CALLBACK_PATH}`,
    ];
  }
  return [`${base}${CONNECTORS_CALLBACK_PATH}`];
}

interface OauthAppTarget {
  slug: string;
  displayName: string;
  /** Where the effective app comes from when the org has no row. */
  envConfigured: boolean;
}

export function OauthAppsCard({
  organizationId,
  connectors,
}: {
  organizationId: string;
  connectors: ConnectorSummary[];
}) {
  const { t } = useT('settings');
  const appsQuery = useConnectorOauthApps(organizationId);
  const onedriveStatus = useOnedriveImportAppStatus(organizationId);
  const entraSso = useEntraSsoSource(organizationId);

  const [editing, setEditing] = useState<OauthAppTarget | null>(null);
  const [removing, setRemoving] = useState<OauthAppTarget | null>(null);
  const [reusingSso, setReusingSso] = useState(false);

  const orgApps = new Map<string, OauthAppRow>(
    (appsQuery.data ?? []).map((row) => [row.slug, row]),
  );

  const targets: OauthAppTarget[] = [
    ...connectors
      .filter(
        (summary) =>
          summary.authMethods.includes('oauth2') && summary.slug !== 'slack',
      )
      .map((summary) => ({
        slug: summary.slug,
        displayName: summary.displayName,
        envConfigured: summary.oauthApp?.source === 'env',
      })),
    {
      slug: ONEDRIVE_SLUG,
      displayName: t('connectors.oauthApps.onedriveTarget'),
      envConfigured: onedriveStatus.data?.source === 'env',
    },
  ];

  return (
    <SettingsSection
      title={t('connectors.oauthApps.title')}
      description={t('connectors.oauthApps.description')}
    >
      {appsQuery.isError && (
        <Alert
          variant="destructive"
          description={mapCredentialError(appsQuery.error)}
        />
      )}
      <Stack
        gap={0}
        className="border-border divide-border divide-y rounded-lg border"
      >
        {targets.map((target) => {
          const orgApp = orgApps.get(target.slug);
          return (
            <div
              key={target.slug}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <Stack gap={1}>
                <Text as="span" className="text-sm font-medium">
                  {target.displayName}
                </Text>
                <Text as="span" variant="muted" className="text-xs">
                  {orgApp
                    ? t('connectors.oauthApps.orgClientId', {
                        clientId: orgApp.clientId,
                      })
                    : target.envConfigured
                      ? t('connectors.oauthApps.statusEnvDetail')
                      : t('connectors.oauthApps.statusNoneDetail')}
                </Text>
              </Stack>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    orgApp ? 'green' : target.envConfigured ? 'blue' : 'slate'
                  }
                >
                  {orgApp
                    ? t('connectors.oauthApps.statusOrg')
                    : target.envConfigured
                      ? t('connectors.oauthApps.statusEnv')
                      : t('connectors.oauthApps.statusNone')}
                </Badge>
                {orgApp && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving(target)}
                  >
                    {t('connectors.oauthApps.remove')}
                  </Button>
                )}
                {target.slug === ONEDRIVE_SLUG &&
                  entraSso.data?.available === true && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setReusingSso(true)}
                    >
                      {t('connectors.oauthApps.reuseSso')}
                    </Button>
                  )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(target)}
                >
                  {t('connectors.oauthApps.configure')}
                </Button>
              </div>
            </div>
          );
        })}
      </Stack>

      {editing && (
        <OauthAppDialog
          organizationId={organizationId}
          target={editing}
          existing={orgApps.get(editing.slug) ?? null}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <RemoveOauthAppDialog
          organizationId={organizationId}
          target={removing}
          onClose={() => setRemoving(null)}
        />
      )}
      {reusingSso && entraSso.data?.available === true && (
        <ReuseSsoDialog
          organizationId={organizationId}
          source={entraSso.data}
          onClose={() => setReusingSso(false)}
        />
      )}
    </SettingsSection>
  );
}

/**
 * Copy the Enterprise SSO (Microsoft Entra ID) app registration into the
 * Microsoft 365 import app — the confirm shows what will be copied and what
 * the admin must still add on that registration in Entra (the copy itself
 * happens server-side; the secret never enters the browser).
 */
function ReuseSsoDialog({
  organizationId,
  source,
  onClose,
}: {
  organizationId: string;
  source: EntraSsoSource;
  onClose: () => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const reuse = useReuseSsoOauthApp();

  // The probe serves the deployment's redirect URI; fall back to the same
  // client-side derivation the configure dialog shows.
  const redirectUri = source.redirectUri ?? redirectUris(ONEDRIVE_SLUG)[0];

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('connectors.oauthApps.reuseSsoTitle')}
      description={t('connectors.oauthApps.reuseSsoBody')}
      confirmText={t('connectors.oauthApps.reuseSsoConfirm')}
      isLoading={reuse.isPending}
      onConfirm={() => {
        reuse.mutate(
          { organizationId, slug: ONEDRIVE_SLUG },
          {
            onSuccess: () => {
              toast({ title: t('connectors.oauthApps.reuseSsoDoneToast') });
              onClose();
            },
            onError: (err) => {
              console.error('connectors: reuse sso oauth app failed', err);
              toast({
                title: mapCredentialError(err),
                variant: 'destructive',
              });
            },
          },
        );
      }}
    >
      <Stack gap={4}>
        <Stack gap={1}>
          <Text as="span" className="text-sm font-medium">
            {t('connectors.oauthApps.clientIdLabel')}
          </Text>
          <code className="bg-muted rounded px-2 py-1 text-xs break-all">
            {source.clientId}
          </code>
        </Stack>
        <Stack gap={1}>
          <Text as="span" className="text-sm font-medium">
            {t('connectors.oauthApps.tenantIdLabel')}
          </Text>
          <code className="bg-muted rounded px-2 py-1 text-xs break-all">
            {source.tenantId}
          </code>
        </Stack>
        <Stack gap={1}>
          <Text as="span" className="text-sm font-medium">
            {t('connectors.oauthApps.reuseSsoChecklist')}
          </Text>
          <Text as="span" variant="muted" className="text-xs">
            {t('connectors.oauthApps.reuseSsoRedirectItem')}
          </Text>
          {redirectUri !== undefined && (
            <code className="bg-muted rounded px-2 py-1 text-xs break-all">
              {redirectUri}
            </code>
          )}
          <Text as="span" variant="muted" className="text-xs">
            {t('connectors.oauthApps.reuseSsoScopesItem')}
          </Text>
          <div className="flex flex-wrap gap-1">
            {(source.scopes ?? []).map((scope) => (
              <code
                key={scope}
                className="bg-muted rounded px-2 py-1 text-xs break-all"
              >
                {scope}
              </code>
            ))}
          </div>
        </Stack>
      </Stack>
    </ConfirmDialog>
  );
}

function OauthAppDialog({
  organizationId,
  target,
  existing,
  onClose,
}: {
  organizationId: string;
  target: OauthAppTarget;
  existing: OauthAppRow | null;
  onClose: () => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const upsert = useUpsertConnectorOauthApp();

  const [clientId, setClientId] = useState(existing?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState(existing?.tenantId ?? '');
  const [error, setError] = useState<string | null>(null);

  const isMicrosoft = MICROSOFT_SLUGS.has(target.slug);
  // A first configure must carry the secret; an update may keep it.
  const isValid =
    clientId.trim().length > 0 &&
    (existing !== null || clientSecret.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (upsert.isPending || !isValid) return;
    setError(null);
    try {
      await upsert.mutateAsync({
        organizationId,
        slug: target.slug,
        clientId: clientId.trim(),
        ...(clientSecret.trim().length > 0
          ? { clientSecret: clientSecret.trim() }
          : {}),
        ...(isMicrosoft && tenantId.trim().length > 0
          ? { tenantId: tenantId.trim() }
          : {}),
      });
      toast({ title: t('connectors.oauthApps.savedToast') });
      onClose();
    } catch (err) {
      console.error('connectors: save oauth app failed', err);
      setError(mapCredentialError(err));
    }
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('connectors.oauthApps.dialogTitle', {
        connector: target.displayName,
      })}
      description={t('connectors.oauthApps.dialogDescription')}
      isSubmitting={upsert.isPending}
      isValid={isValid}
      onSubmit={handleSubmit}
    >
      <Stack gap={4}>
        {error !== null && <Alert variant="destructive" description={error} />}
        <Input
          label={t('connectors.oauthApps.clientIdLabel')}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          autoComplete="off"
          required
        />
        <Input
          label={t('connectors.oauthApps.clientSecretLabel')}
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder={existing ? '••••••••' : undefined}
          description={
            existing ? t('connectors.oauthApps.clientSecretKeep') : undefined
          }
          autoComplete="new-password"
          required={existing === null}
        />
        {isMicrosoft && (
          <Input
            label={t('connectors.oauthApps.tenantIdLabel')}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            description={t('connectors.oauthApps.tenantIdHint')}
            autoComplete="off"
          />
        )}
        <Stack gap={1}>
          <Text as="span" className="text-sm font-medium">
            {t('connectors.oauthApps.redirectUrisLabel')}
          </Text>
          <Text as="span" variant="muted" className="text-xs">
            {t('connectors.oauthApps.redirectUrisHint')}
          </Text>
          {redirectUris(target.slug).map((uri) => (
            <code
              key={uri}
              className="bg-muted rounded px-2 py-1 text-xs break-all"
            >
              {uri}
            </code>
          ))}
        </Stack>
      </Stack>
    </FormDialog>
  );
}

function RemoveOauthAppDialog({
  organizationId,
  target,
  onClose,
}: {
  organizationId: string;
  target: OauthAppTarget;
  onClose: () => void;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();
  const remove = useRemoveConnectorOauthApp();

  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t('connectors.oauthApps.removeTitle', {
        connector: target.displayName,
      })}
      description={t('connectors.oauthApps.removeBody')}
      variant="destructive"
      isLoading={remove.isPending}
      onConfirm={() => {
        remove.mutate(
          { organizationId, slug: target.slug },
          {
            onSuccess: () => {
              toast({ title: t('connectors.oauthApps.removedToast') });
              onClose();
            },
            onError: (err) => {
              console.error('connectors: remove oauth app failed', err);
              toast({
                title: mapCredentialError(err),
                variant: 'destructive',
              });
            },
          },
        );
      }}
    />
  );
}
