import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ConnectorSummary } from '../hooks/backend';
import { hasDeploymentApp, OauthAppsCard } from './oauth-apps-card';

const reads = vi.hoisted(() => ({ loading: false }));

vi.mock('../hooks/oauth-apps', () => ({
  useConnectorOauthApps: () => ({
    data: reads.loading ? undefined : [],
    isLoading: reads.loading,
    isError: false,
    error: null,
  }),
  useCloudImportAppStatus: () => ({
    data: reads.loading ? undefined : { configured: false, source: null },
    isLoading: reads.loading,
    isError: false,
    error: null,
  }),
  useEntraSsoSource: () => ({
    data: { available: false, reason: 'no_sso' },
    isLoading: false,
  }),
  useUpsertConnectorOauthApp: () => ({ mutateAsync: vi.fn() }),
  useRemoveConnectorOauthApp: () => ({ mutate: vi.fn() }),
  useReuseSsoOauthApp: () => ({ mutate: vi.fn() }),
}));

const gmail: ConnectorSummary = {
  slug: 'gmail',
  displayName: 'Gmail',
  description: 'Read and send mail.',
  tags: ['Email'],
  endpointMode: 'fixed',
  authMethods: ['oauth2'],
  configFields: [],
  actionCount: 4,
  iconUrl: '/api/connectors/gmail/icon.svg',
};

const NOT_CONFIGURED = 'Not configured';

/** A row's status claim is only made once it is no longer masked. */
function claimedStatuses(): HTMLElement[] {
  return screen
    .queryAllByText(NOT_CONFIGURED)
    .filter((badge) => badge.closest('[aria-hidden="true"]') === null);
}

/**
 * The card's status column answers one question per row: is there an app
 * underneath when the org has no row of its own? Every row but Google Drive
 * gets that from the catalog summary. Google Drive's row stands for two
 * lanes — the connector and Knowledge's import — whose deployment variables
 * are spelled differently, so the row has to consult both.
 */
describe('hasDeploymentApp', () => {
  it('reports a deployment app for any connector whose catalog summary says env', () => {
    expect(hasDeploymentApp('outlook', 'env', null)).toBe(true);
  });

  it('reports none when the summary says the app is the org row', () => {
    expect(hasDeploymentApp('outlook', 'org', null)).toBe(false);
  });

  it('reports none when nothing answers', () => {
    expect(hasDeploymentApp('outlook', null, null)).toBe(false);
    expect(hasDeploymentApp('outlook', undefined, undefined)).toBe(false);
  });

  it('reports a deployment app for Google Drive when only the IMPORT lane is set', () => {
    // CLOUD_IMPORT_GOOGLE_DRIVE_* set, CONNECTOR_OAUTH_GOOGLE_DRIVE_* not:
    // Drive import works, so the row must not read "Not configured".
    expect(hasDeploymentApp('google-drive', null, 'env')).toBe(true);
  });

  it('reports a deployment app for Google Drive when only the CONNECTOR lane is set', () => {
    expect(hasDeploymentApp('google-drive', 'env', null)).toBe(true);
  });

  it('does not let the Drive import lane answer for another connector', () => {
    expect(hasDeploymentApp('outlook', null, 'env')).toBe(false);
    expect(hasDeploymentApp('gmail', null, 'env')).toBe(false);
  });

  it('reports none for Google Drive when neither lane is set', () => {
    expect(hasDeploymentApp('google-drive', null, null)).toBe(false);
    expect(hasDeploymentApp('google-drive', 'org', 'org')).toBe(false);
  });
});

/**
 * While the catalog or an app's status is on its way, the card cannot know
 * whether an app stands behind a row — it masks the row in place instead of
 * printing "Not configured" and correcting itself a moment later.
 */
describe('OauthAppsCard while loading', () => {
  beforeEach(() => {
    reads.loading = false;
  });

  it('masks a row per expected app while the catalog is on its way', () => {
    render(
      <OauthAppsCard organizationId="org-1" connectors={[]} catalogLoading />,
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    // No OneDrive row alone that the catalog's rows then push down.
    expect(
      screen.queryByText('OneDrive / SharePoint (Knowledge import)'),
    ).toBeNull();
    expect(claimedStatuses()).toHaveLength(0);
    const configures = screen.getAllByText('Configure');
    expect(configures).toHaveLength(5);
    for (const configure of configures) {
      expect(configure.closest('[inert]')).not.toBeNull();
    }
  });

  it('names the rows but masks their status until each source answers', () => {
    reads.loading = true;
    render(<OauthAppsCard organizationId="org-1" connectors={[gmail]} />);

    expect(screen.getByText('Gmail')).toBeInTheDocument();
    expect(claimedStatuses()).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });

  it('states each status once every source has answered', () => {
    render(<OauthAppsCard organizationId="org-1" connectors={[gmail]} />);

    expect(screen.queryByRole('status')).toBeNull();
    expect(claimedStatuses()).toHaveLength(2);
    // What an unconfigured row costs is said once, by the section, not
    // repeated under every row that has no app.
    expect(
      screen.getAllByText(/a connector with neither can't be connected/),
    ).toHaveLength(1);
  });
});
