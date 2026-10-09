'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useToast } from '@tale/ui/use-toast';
import { useRef, useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import type { ItemOf, ReturnsOf } from '@/app/lib/backend/contract';
import { readStateOf } from '@/app/lib/backend/read-state';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';

import type { ConnectorSummary } from '../hooks/backend';
import {
  useConnectorOauthApps,
  useEntraSsoSource,
  useCloudImportAppStatus,
  useRemoveConnectorOauthApp,
  useReuseSsoOauthApp,
  useUpsertConnectorOauthApp,
} from '../hooks/oauth-apps';

// One row shape for the live rows and their loading stand-ins. The row wraps:
// when the name can't keep 12rem beside the status and its buttons (a phone),
// the cluster takes a line of its own, still on the right, instead of
// pushing the row past the card's edge.
const OAUTH_APP_ROW =
  'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3';
const OAUTH_APP_ROW_TEXT = 'min-w-0 flex-1 basis-48';
const OAUTH_APP_ROW_ACTIONS = 'ml-auto flex items-center gap-2';

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
/** One catalog row, two lanes: the Google Drive connector and Knowledge's
 * Google Drive import consent against the same vendor app. */
const GOOGLE_DRIVE_SLUG = 'google-drive';

type AppSource = 'org' | 'env' | null | undefined;

/**
 * Whether a deployment-wide app stands behind this row.
 *
 * One org row (keyed by slug) serves both of Google Drive's lanes, but their
 * env halves do not: the connector reads `CONNECTOR_OAUTH_GOOGLE_DRIVE_*`
 * and Knowledge's import reads `CLOUD_IMPORT_GOOGLE_DRIVE_*`. Asking only
 * the catalog summary therefore reported "Not configured" on a deployment
 * that had set the import variables and could import from Drive; the row
 * covers both lanes, so either answer configures it.
 */
export function hasDeploymentApp(
  slug: string,
  connectorSource: AppSource,
  driveImportSource: AppSource,
): boolean {
  if (connectorSource === 'env') return true;
  return slug === GOOGLE_DRIVE_SLUG && driveImportSource === 'env';
}
/** Slugs whose vendor is Microsoft Entra — they take a directory (tenant)
 * id, because a single-tenant app registration rejects `/common`. */
const MICROSOFT_SLUGS = new Set(['outlook', 'teams', ONEDRIVE_SLUG]);

const CONNECTORS_CALLBACK_PATH = '/api/connectors/oauth2/callback';
const CLOUD_IMPORT_CALLBACK_PATH = '/api/cloud-import/oauth2/callback';

/**
 * The redirect URIs the admin must register on the vendor app — one set per
 * domain this deployment answers on. A consent flow started on a given domain
 * comes back to that same domain (the session cookie lives there), so on a
 * multi-domain deployment every domain's callback has to be registered.
 * `SITE_ORIGINS` carries the full list, canonical first; the single-domain
 * case is exactly the one-or-two URLs it always was.
 */
function redirectUris(slug: string): string[] {
  const basePath = getEnv('BASE_PATH');
  const origins = window.__ENV__?.SITE_ORIGINS?.length
    ? window.__ENV__.SITE_ORIGINS
    : [getEnv('SITE_URL')];
  return origins.flatMap((origin) => {
    const base = `${origin}${basePath}`;
    if (slug === ONEDRIVE_SLUG) return [`${base}${CLOUD_IMPORT_CALLBACK_PATH}`];
    if (slug === 'google-drive') {
      // One Google app serves the connector lane AND Knowledge import.
      return [
        `${base}${CONNECTORS_CALLBACK_PATH}`,
        `${base}${CLOUD_IMPORT_CALLBACK_PATH}`,
      ];
    }
    return [`${base}${CONNECTORS_CALLBACK_PATH}`];
  });
}

interface OauthAppTarget {
  slug: string;
  displayName: string;
  /** Where the effective app comes from when the org has no row. */
  envConfigured: boolean;
  /** The Knowledge import lane's status read that decides this row failed,
   * and neither the org's apps nor the catalog answer for it: whether an app
   * stands behind the row is unknown, not missing. */
  statusUnavailable: boolean;
}

/**
 * Rows drawn while the catalog is on its way: the shipped catalog's OAuth
 * connectors plus the OneDrive import — five today. A catalog that grows
 * costs a row of movement when it lands, never a wrong claim.
 */
const PLACEHOLDER_ROWS = 5;

export function OauthAppsCard({
  organizationId,
  connectors,
  catalogLoading = false,
}: {
  organizationId: string;
  connectors: ConnectorSummary[];
  /** The connector catalog is still on its way: its rows are masked in
   *  place, not missing. */
  catalogLoading?: boolean;
}) {
  const { t } = useT('settings');
  const appsQuery = useConnectorOauthApps(organizationId);
  const onedriveStatus = useCloudImportAppStatus(organizationId, ONEDRIVE_SLUG);
  const driveImportStatus = useCloudImportAppStatus(
    organizationId,
    GOOGLE_DRIVE_SLUG,
  );
  const entraSso = useEntraSsoSource(organizationId);
  // An import lane's status read that failed is not an app that is missing
  // (#3893): its row says the status is unavailable and offers nothing to
  // configure, and the card names the failure and runs the read again.
  const onedriveRead = readStateOf(onedriveStatus);
  const driveImportRead = readStateOf(driveImportStatus);
  // Until every source has answered, no row can say whether an app stands
  // behind it: its status masks instead of claiming "Not configured". A read
  // that failed holds its row still through a retry instead.
  const loading =
    catalogLoading ||
    appsQuery.isLoading ||
    (onedriveStatus.isLoading && !onedriveRead.unavailable) ||
    (driveImportStatus.isLoading && !driveImportRead.unavailable);

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
      .map((summary) => {
        const envConfigured = hasDeploymentApp(
          summary.slug,
          summary.oauthApp?.source,
          driveImportStatus.data?.source,
        );
        return {
          slug: summary.slug,
          displayName: summary.displayName,
          envConfigured,
          statusUnavailable:
            summary.slug === GOOGLE_DRIVE_SLUG &&
            driveImportRead.unavailable &&
            !envConfigured &&
            !orgApps.has(summary.slug),
        };
      }),
    {
      slug: ONEDRIVE_SLUG,
      displayName: t('connectors.oauthApps.onedriveTarget'),
      envConfigured: onedriveStatus.data?.source === 'env',
      statusUnavailable:
        onedriveRead.unavailable && !orgApps.has(ONEDRIVE_SLUG),
    },
  ];

  // The status reads behind the rows that say so — the ones Try again runs.
  const unavailable = (slug: string) =>
    targets.some((target) => target.slug === slug && target.statusUnavailable);
  const failedReads = [
    ...(unavailable(ONEDRIVE_SLUG)
      ? [{ read: onedriveRead, query: onedriveStatus }]
      : []),
    ...(unavailable(GOOGLE_DRIVE_SLUG)
      ? [{ read: driveImportRead, query: driveImportStatus }]
      : []),
  ];
  const retryStatus = () => {
    for (const { query } of failedReads) void query.refetch();
  };
  // A read that works on retry takes the alert away; a focused Try again
  // hands its focus to the card, not to the page.
  const sectionRef = useRef<HTMLElement>(null);
  const focusSection = () => {
    sectionRef.current?.focus();
  };

  return (
    <SettingsSection
      ref={sectionRef}
      tabIndex={-1}
      className="outline-none"
      title={t('connectors.oauthApps.title')}
      description={t('connectors.oauthApps.description')}
    >
      {appsQuery.isError && (
        <Alert
          variant="destructive"
          description={mapCredentialError(appsQuery.error)}
        />
      )}
      {failedReads.length > 0 && (
        <CatalogLoadError
          // Each failure is announced again; Try again keeps its node, and
          // the focus on it, through a retry that fails again.
          failureKey={failedReads.reduce(
            (count, { read }) => count + read.failureCount,
            0,
          )}
          onFocusLost={focusSection}
          message={t('connectors.oauthApps.statusLoadFailed')}
          onRetry={retryStatus}
          isRetrying={failedReads.some(({ read }) => read.retrying)}
        />
      )}
      <Skeletonize loading={loading} label={t('connectors.oauthApps.title')}>
        <Stack
          gap={0}
          className="border-border divide-border divide-y rounded-lg border"
        >
          {catalogLoading
            ? Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
                <OauthAppRowPlaceholder key={index} seed={index * 2} />
              ))
            : targets.map((target) => {
                const orgApp = orgApps.get(target.slug);
                return (
                  <div key={target.slug} className={OAUTH_APP_ROW}>
                    <Stack gap={1} className={OAUTH_APP_ROW_TEXT}>
                      <Text as="span" className="text-sm font-medium">
                        {target.displayName}
                      </Text>
                      {/* The badge names where the app comes from, and the
                          section says what a connector without one cannot
                          do; only an organization app adds a fact of its own. */}
                      {orgApp && (
                        <Text as="span" variant="muted" className="text-xs">
                          {t('connectors.oauthApps.orgClientId', {
                            clientId: orgApp.clientId,
                          })}
                        </Text>
                      )}
                    </Stack>
                    <div className={OAUTH_APP_ROW_ACTIONS}>
                      <Badge
                        variant={
                          orgApp
                            ? 'green'
                            : target.envConfigured
                              ? 'blue'
                              : target.statusUnavailable
                                ? 'outline'
                                : 'slate'
                        }
                      >
                        {orgApp
                          ? t('connectors.oauthApps.statusOrg')
                          : target.envConfigured
                            ? t('connectors.oauthApps.statusEnv')
                            : target.statusUnavailable
                              ? t('connectors.oauthApps.statusUnavailable')
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
                      {/* An app may already stand behind a row whose
                          status is unknown: configuring one now could
                          override it, so the row waits for an answer. */}
                      {target.slug === ONEDRIVE_SLUG &&
                        !target.statusUnavailable &&
                        entraSso.data?.available === true && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setReusingSso(true)}
                          >
                            {t('connectors.oauthApps.reuseSso')}
                          </Button>
                        )}
                      {!target.statusUnavailable && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditing(target)}
                        >
                          {t('connectors.oauthApps.configure')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
        </Stack>
      </Skeletonize>

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
 * One OAuth app row whose connector is not known yet — the live row's
 * geometry (name, detail line, status badge, Configure) with every value
 * masked, inside the card's `Skeletonize`.
 */
function OauthAppRowPlaceholder({ seed }: { seed: number }) {
  const { t } = useT('settings');
  return (
    <div className={OAUTH_APP_ROW}>
      <Stack gap={1} className={OAUTH_APP_ROW_TEXT}>
        <Text as="span" className="block w-40 max-w-full text-sm font-medium">
          <SkeletonText seed={seed} />
        </Text>
      </Stack>
      <div className={OAUTH_APP_ROW_ACTIONS}>
        <Badge variant="slate">{t('connectors.oauthApps.statusNone')}</Badge>
        <Button variant="secondary" size="sm">
          {t('connectors.oauthApps.configure')}
        </Button>
      </div>
    </div>
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
        void reuse.mutateAsync({ organizationId, slug: ONEDRIVE_SLUG }).then(
          () => {
            toast({ title: t('connectors.oauthApps.reuseSsoDoneToast') });
            onClose();
          },
          (err: unknown) => {
            console.error('connectors: reuse sso oauth app failed', err);
            toast({
              title: mapCredentialError(err),
              variant: 'destructive',
            });
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
        void remove.mutateAsync({ organizationId, slug: target.slug }).then(
          () => {
            toast({ title: t('connectors.oauthApps.removedToast') });
            onClose();
          },
          (err: unknown) => {
            console.error('connectors: remove oauth app failed', err);
            toast({
              title: mapCredentialError(err),
              variant: 'destructive',
            });
          },
        );
      }}
    />
  );
}
