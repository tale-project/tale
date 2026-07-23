import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { DataResidencySettings } from './data-residency-settings';

/**
 * Component coverage for the unified data-residency page — the two access
 * levels of the SAME surface:
 *
 *   - A deployment operator (`canEdit` from the read) edits the deployment
 *     stores; a non-operator admin sees them read-only with a stated reason.
 *   - An org admin (`write orgSettings`) edits this organization's object
 *     storage; a member without it sees it read-only with a stated reason.
 *
 * Backend behaviour (config validation, SOPS sidecars, the real S3 probe) is
 * covered by the convex action tests — here the hooks are stubbed at the module
 * boundary. The header Save/Apply actions register into the settings header
 * slot (absent in this harness), so deployment editing is asserted via the
 * rendered controls, and the org section via its own inline Save/Test buttons.
 */

const saveStorage = vi.hoisted(() => vi.fn());
const deleteStorage = vi.hoisted(() => vi.fn());
const testStorage = vi.hoisted(() => vi.fn());

interface StorageFixture {
  configured: boolean;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  bucket?: string;
  prefix?: string;
  hasCredentials?: boolean;
}

const fixtures = vi.hoisted(() => ({
  deployment: undefined as unknown,
  deploymentError: false,
  storage: { configured: false } as unknown,
}));

/** A deployment config with all three stores populated. */
function deploymentConfig(canEdit: boolean) {
  return {
    config: {
      version: 1,
      dataStores: {
        knowledgePostgres: {
          host: 'kb.example.org',
          port: 5432,
          database: 'knowledge',
          user: 'tale',
          sslmode: 'require',
        },
        convexStorage: {
          mode: 's3',
          region: 'eu-central-1',
          endpoint: 'https://minio.example.org',
          forcePathStyle: true,
          buckets: {
            files: 'files-b',
            exports: 'exports-b',
            snapshotImports: 'snap-b',
            modules: 'mods-b',
            search: 'search-b',
          },
        },
        appPostgres: {
          host: 'app.example.org',
          port: 5432,
          database: 'appdb',
          user: 'tale',
        },
      },
    },
    hash: 'h1',
    secrets: {},
    canEdit,
    email: canEdit ? 'op@example.org' : 'viewer@example.org',
  };
}

function setDeployment(canEdit: boolean) {
  fixtures.deployment = deploymentConfig(canEdit);
  fixtures.deploymentError = false;
}

function setStorageFixture(view: StorageFixture) {
  fixtures.storage = view;
}

vi.mock('../hooks/queries', () => ({
  useReadDeploymentConfig: () => ({
    data: fixtures.deployment,
    isPending: false,
    isError: fixtures.deploymentError,
    error: fixtures.deploymentError
      ? { data: { code: 'DEPLOYMENT_CONFIG_UNREADABLE', message: 'boom' } }
      : null,
  }),
  useOrgObjectStorageConnection: () => ({
    data: fixtures.storage,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useSaveDeploymentConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveDeploymentSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestDeploymentConnection: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRequestRestart: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveOrgObjectStorageConnection: () => ({
    mutateAsync: saveStorage,
    isPending: false,
  }),
  useDeleteOrgObjectStorageConnection: () => ({
    mutateAsync: deleteStorage,
    isPending: false,
  }),
  useTestOrgObjectStorageConnection: () => ({
    mutateAsync: testStorage,
    isPending: false,
  }),
}));

// Two independent capabilities: reading org settings gates viewing the page;
// writing org settings gates editing the org storage section.
const abilityState = vi.hoisted(() => ({ canRead: true, canWrite: true }));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: (action: string, subject: string) => {
      if (subject !== 'orgSettings') return false;
      return action === 'write' ? abilityState.canWrite : abilityState.canRead;
    },
    cannot: (action: string, subject: string) => {
      if (subject !== 'orgSettings') return true;
      return action === 'write'
        ? !abilityState.canWrite
        : !abilityState.canRead;
    },
  }),
  useAbilityLoading: () => false,
}));

describe('DataResidencySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canRead = true;
    abilityState.canWrite = true;
    setDeployment(false);
    setStorageFixture({ configured: false });
  });

  it('shows AccessDenied to a member who cannot read org settings', () => {
    abilityState.canRead = false;
    abilityState.canWrite = false;

    render(<DataResidencySettings organizationId="org-1" />);

    expect(
      screen.getByText(
        'You need Admin permissions to access data residency settings.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('renders both the deployment stores and the organization storage section', () => {
    setDeployment(true);
    render(<DataResidencySettings organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'Knowledge database (RAG)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'File storage (uploaded documents)',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Application database (advanced)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Object storage' }),
    ).toBeInTheDocument();
  });

  it('lets a deployment operator edit the deployment stores (editable state)', async () => {
    setDeployment(true);
    const { container } = render(
      <DataResidencySettings organizationId="org-1" />,
    );

    // Operator sees the enable switches (state as an interactive control) and
    // editable, non-readonly inputs.
    expect(
      screen.getAllByRole('switch', { name: 'External Postgres' }),
    ).toHaveLength(2);
    const hosts = screen.getAllByRole('textbox', { name: 'Host' });
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toHaveValue('kb.example.org');
    expect(hosts[0]).not.toHaveAttribute('readonly');

    await waitFor(() => checkAccessibility(container));
  });

  it('shows the deployment stores read-only, with the operator-allowlist reason', async () => {
    setDeployment(false); // caller is not in TALE_DEPLOYMENT_CONFIG_ADMINS
    const { container } = render(
      <DataResidencySettings organizationId="org-1" />,
    );

    // State is conveyed as text (a status pill), never a bare disabled switch —
    // there are no deployment enable switches at all.
    expect(
      screen.queryByRole('switch', { name: 'External Postgres' }),
    ).toBeNull();
    // The stored coordinates render as native read-only fields.
    const hosts = screen.getAllByRole('textbox', { name: 'Host' });
    expect(hosts[0]).toHaveValue('kb.example.org');
    expect(hosts[0]).toHaveAttribute('readonly');
    // The reason is stated, not left as a silent disabled control.
    expect(screen.getAllByText('Read-only access').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/TALE_DEPLOYMENT_CONFIG_ADMINS/),
    ).toBeInTheDocument();

    await waitFor(() => checkAccessibility(container));
  });

  it('renders the org storage section from a loaded config with its stored values', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      endpoint: 'https://minio.example.org',
      forcePathStyle: true,
      bucket: 'org-blobs',
      prefix: 'tale/',
      hasCredentials: true,
    });
    const { container } = render(
      <DataResidencySettings organizationId="org-1" />,
    );

    const orgSection = screen
      .getByRole('heading', { name: 'Object storage' })
      .closest('section') as HTMLElement;
    expect(
      within(orgSection).getByRole('textbox', { name: 'Bucket' }),
    ).toHaveValue('org-blobs');
    expect(
      within(orgSection).getByRole('textbox', { name: 'Key prefix' }),
    ).toHaveValue('tale/');
    expect(
      within(orgSection).getByRole('switch', { name: 'External S3' }),
    ).toBeChecked();

    await waitFor(() => checkAccessibility(container));
  });

  it('shows the org storage default state when nothing is configured', () => {
    render(<DataResidencySettings organizationId="org-1" />);

    const orgSection = screen
      .getByRole('heading', { name: 'Object storage' })
      .closest('section') as HTMLElement;
    expect(
      within(orgSection).getByText('Deployment default'),
    ).toBeInTheDocument();
    expect(
      within(orgSection).getByRole('switch', { name: 'External S3' }),
    ).not.toBeChecked();
  });

  it('shows the org storage section read-only with a stated reason for a non-admin', async () => {
    abilityState.canWrite = false; // read-only member
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: false,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    const { container } = render(
      <DataResidencySettings organizationId="org-1" />,
    );

    const orgSection = screen
      .getByRole('heading', { name: 'Object storage' })
      .closest('section') as HTMLElement;
    // No enable switch and no Save button — the state is a pill, the values are
    // read-only, and the reason is stated.
    expect(
      within(orgSection).queryByRole('switch', { name: 'External S3' }),
    ).toBeNull();
    expect(
      within(orgSection).queryByRole('button', { name: 'Save' }),
    ).toBeNull();
    expect(
      within(orgSection).getByText(
        "Admin permissions are required to change where this organization's files are stored.",
      ),
    ).toBeInTheDocument();
    expect(
      within(orgSection).getByRole('textbox', { name: 'Bucket' }),
    ).toHaveAttribute('readonly');

    await waitFor(() => checkAccessibility(container));
  });

  it('saves the org storage connection and omits blank optional fields', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: false,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    saveStorage.mockResolvedValue(null);

    const { user } = render(<DataResidencySettings organizationId="org-1" />);

    const bucket = screen.getByRole('textbox', { name: 'Bucket' });
    await user.clear(bucket);
    await user.type(bucket, 'org-blobs-eu');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Blank endpoint/prefix and untouched credentials are omitted, not sent as
    // empty strings (empty creds would fail the server's pair check).
    await waitFor(() =>
      expect(saveStorage).toHaveBeenCalledWith({
        organizationId: 'org-1',
        region: 'eu-central-1',
        forcePathStyle: false,
        bucket: 'org-blobs-eu',
      }),
    );
  });

  it('probes the org bucket with a typed key pair, then shows the verified line', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    testStorage.mockResolvedValue({ ok: true });

    const { user } = render(<DataResidencySettings organizationId="org-1" />);

    await user.type(
      screen.getByRole('textbox', { name: 'Access key ID' }),
      'AKIA123',
    );
    await user.type(
      screen.getByLabelText('Secret access key', { selector: 'input' }),
      'shhh',
    );
    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText(/Bucket verified \(upload, read, delete\)/),
    ).toBeInTheDocument();
    expect(testStorage).toHaveBeenCalledWith({
      organizationId: 'org-1',
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      accessKeyId: 'AKIA123',
      secretAccessKey: 'shhh',
    });
  });

  it('explains the bucket CORS requirement next to the org storage form', () => {
    setStorageFixture({
      configured: true,
      region: 'auto',
      endpoint: 'https://acc.r2.cloudflarestorage.com',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    render(<DataResidencySettings organizationId="org-1" />);

    expect(
      screen.getByText(/must accept cross-origin \(CORS\) requests from/),
    ).toBeInTheDocument();
  });

  it('surfaces a deployment read failure without hiding the org storage section', () => {
    fixtures.deployment = undefined;
    fixtures.deploymentError = true;

    render(<DataResidencySettings organizationId="org-1" />);

    // The deployment group reports its own failure inline...
    expect(
      screen.getByText(/Couldn't load the deployment configuration/),
    ).toBeInTheDocument();
    // ...while the org storage section still renders.
    expect(
      screen.getByRole('heading', { name: 'Object storage' }),
    ).toBeInTheDocument();
  });
});
