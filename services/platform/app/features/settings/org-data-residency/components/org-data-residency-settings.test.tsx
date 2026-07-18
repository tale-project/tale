import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { OrgDataResidencySettings } from './org-data-residency-settings';

/**
 * Component coverage for the org-level data-residency panel: the two sections
 * render from a loaded (masked) config, Save forwards the form values to the
 * per-org admin action, the test-connection probe result renders inline, and
 * a non-admin gets the AccessDenied screen instead of the form. Backend
 * behaviour (validation, SOPS sidecars, the real S3 probe) is covered by the
 * convex action tests — here the hooks are stubbed at the module boundary.
 */

const saveKnowledge = vi.hoisted(() => vi.fn());
const deleteKnowledge = vi.hoisted(() => vi.fn());
const testKnowledge = vi.hoisted(() => vi.fn());
const saveStorage = vi.hoisted(() => vi.fn());
const deleteStorage = vi.hoisted(() => vi.fn());
const testStorage = vi.hoisted(() => vi.fn());

interface KnowledgeFixture {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  hasPassword?: boolean;
}
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
  knowledge: { configured: false } as unknown,
  storage: { configured: false } as unknown,
}));

function setKnowledgeFixture(view: KnowledgeFixture) {
  fixtures.knowledge = view;
}
function setStorageFixture(view: StorageFixture) {
  fixtures.storage = view;
}

vi.mock('../hooks/queries', () => ({
  useOrgKnowledgeConnection: () => ({
    data: fixtures.knowledge,
    isPending: false,
    isError: false,
    error: null,
  }),
  useOrgObjectStorageConnection: () => ({
    data: fixtures.storage,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useSaveOrgKnowledgeConnection: () => ({
    mutateAsync: saveKnowledge,
    isPending: false,
  }),
  useDeleteOrgKnowledgeConnection: () => ({
    mutateAsync: deleteKnowledge,
    isPending: false,
  }),
  useTestOrgKnowledgeConnection: () => ({
    mutateAsync: testKnowledge,
    isPending: false,
  }),
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

// Admin by default; a single test flips the write capability off to assert
// the AccessDenied gate.
const abilityState = vi.hoisted(() => ({ canWrite: true }));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => abilityState.canWrite,
    cannot: () => !abilityState.canWrite,
  }),
  useAbilityLoading: () => false,
}));

describe('OrgDataResidencySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canWrite = true;
    setKnowledgeFixture({ configured: false });
    setStorageFixture({ configured: false });
  });

  it('renders both sections from a loaded config with the stored values', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'kb.example.org',
      port: 5433,
      database: 'tale_knowledge',
      user: 'tale',
      sslmode: 'require',
      hasPassword: true,
    });
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
      <OrgDataResidencySettings organizationId="org-1" />,
    );

    // Knowledge section shows the stored connection.
    expect(screen.getByRole('textbox', { name: 'Host' })).toHaveValue(
      'kb.example.org',
    );
    expect(screen.getByRole('spinbutton', { name: 'Port' })).toHaveValue(5433);
    expect(screen.getByRole('textbox', { name: 'Database' })).toHaveValue(
      'tale_knowledge',
    );
    // Object-storage section shows the stored bucket coordinates.
    expect(screen.getByRole('textbox', { name: 'Region' })).toHaveValue(
      'eu-central-1',
    );
    expect(screen.getByRole('textbox', { name: 'Bucket' })).toHaveValue(
      'org-blobs',
    );
    expect(screen.getByRole('textbox', { name: 'Key prefix' })).toHaveValue(
      'tale/',
    );
    // Both enable switches read as ON.
    expect(
      screen.getByRole('switch', { name: 'External Postgres' }),
    ).toBeChecked();
    expect(screen.getByRole('switch', { name: 'External S3' })).toBeChecked();

    await waitFor(() => checkAccessibility(container));
  });

  it('shows the deployment-default state when nothing is configured', () => {
    render(<OrgDataResidencySettings organizationId="org-1" />);

    expect(screen.getAllByText('Deployment default')).toHaveLength(2);
    expect(
      screen.getByRole('switch', { name: 'External Postgres' }),
    ).not.toBeChecked();
    // Collapsed sections render no connection fields.
    expect(screen.queryByRole('textbox', { name: 'Host' })).toBeNull();
  });

  it('saves the knowledge connection with the edited form values', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'kb.example.org',
      port: 5433,
      database: 'tale_knowledge',
      user: 'tale',
      sslmode: 'require',
      hasPassword: false,
    });
    saveKnowledge.mockResolvedValue(null);

    const { user } = render(
      <OrgDataResidencySettings organizationId="org-1" />,
    );

    const host = screen.getByRole('textbox', { name: 'Host' });
    await user.clear(host);
    await user.type(host, 'kb2.example.org');
    await user.type(
      screen.getByLabelText('Password', { selector: 'input' }),
      's3cret',
    );
    await user.click(screen.getAllByRole('button', { name: 'Save' })[0]);

    await waitFor(() =>
      expect(saveKnowledge).toHaveBeenCalledWith({
        organizationId: 'org-1',
        host: 'kb2.example.org',
        port: 5433,
        database: 'tale_knowledge',
        user: 'tale',
        sslmode: 'require',
        password: 's3cret',
      }),
    );
  });

  it('shows the saved note once the form matches the stored config again', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'kb.example.org',
      port: 5433,
      database: 'tale_knowledge',
      user: 'tale',
      sslmode: 'require',
      hasPassword: true,
    });
    saveKnowledge.mockResolvedValue(null);

    const { user } = render(
      <OrgDataResidencySettings organizationId="org-1" />,
    );

    // A password-only rotation: the write-only field clears on success, so
    // the form drops back to its baseline and the saved note renders.
    await user.type(
      screen.getByLabelText('Password', { selector: 'input' }),
      'rotated',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(/knowledge now lives in your database/),
    ).toBeInTheDocument();
  });

  it('saves the object-storage connection and omits blank optional fields', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: false,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    saveStorage.mockResolvedValue(null);

    const { user } = render(
      <OrgDataResidencySettings organizationId="org-1" />,
    );

    const bucket = screen.getByRole('textbox', { name: 'Bucket' });
    await user.clear(bucket);
    await user.type(bucket, 'org-blobs-eu');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Blank endpoint/prefix and untouched credentials are omitted, not sent
    // as empty strings (empty creds would fail the server's pair check).
    await waitFor(() =>
      expect(saveStorage).toHaveBeenCalledWith({
        organizationId: 'org-1',
        region: 'eu-central-1',
        forcePathStyle: false,
        bucket: 'org-blobs-eu',
      }),
    );
  });

  it('renders the probe outcome for a failed knowledge connection test', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'kb.example.org',
      port: 5433,
      database: 'tale_knowledge',
      user: 'tale',
      sslmode: 'require',
    });
    testKnowledge.mockResolvedValue({
      ok: false,
      error: 'connection refused',
    });

    const { user } = render(
      <OrgDataResidencySettings organizationId="org-1" />,
    );

    await user.click(screen.getByRole('button', { name: 'Test connection' }));

    expect(
      await screen.findByText('Failed — connection refused'),
    ).toBeInTheDocument();
    expect(testKnowledge).toHaveBeenCalledWith({
      organizationId: 'org-1',
      host: 'kb.example.org',
      port: 5433,
      database: 'tale_knowledge',
      user: 'tale',
      sslmode: 'require',
    });
  });

  it('probes with a typed key pair, then shows the verified line', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    testStorage.mockResolvedValue({ ok: true });

    const { user } = render(
      <OrgDataResidencySettings organizationId="org-1" />,
    );

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

  it('tests a stored connection with blank key fields (reuses the stored keys)', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    testStorage.mockResolvedValue({ ok: true });

    const { user } = render(
      <OrgDataResidencySettings organizationId="org-1" />,
    );

    // Stored credentials → Test is enabled with the write-only fields blank,
    // so a saved connection can be re-tested (Save clears the key fields). The
    // probe carries no keys; the server reuses the org's stored sidecar.
    const testButton = screen.getByRole('button', { name: 'Test connection' });
    expect(testButton).toBeEnabled();
    await user.click(testButton);

    expect(
      await screen.findByText(/Bucket verified \(upload, read, delete\)/),
    ).toBeInTheDocument();
    expect(testStorage).toHaveBeenCalledWith({
      organizationId: 'org-1',
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
    });
    const call = testStorage.mock.calls[0]?.[0] ?? {};
    expect(call).not.toHaveProperty('accessKeyId');
    expect(call).not.toHaveProperty('secretAccessKey');
  });

  it('explains the bucket CORS requirement next to the storage form', () => {
    setStorageFixture({
      configured: true,
      region: 'auto',
      endpoint: 'https://acc.r2.cloudflarestorage.com',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });

    render(<OrgDataResidencySettings organizationId="org-1" />);

    // Browser-direct presigned PUT/GET needs a CORS policy on the org's
    // bucket, and the server-side probe cannot detect a missing one — the
    // panel has to say so, with the exact origin to allow.
    expect(
      screen.getByText(/must accept cross-origin \(CORS\) requests from/),
    ).toBeInTheDocument();
  });

  it('keeps the bucket probe disabled with blank fields when NO keys are stored', () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: false,
    });

    render(<OrgDataResidencySettings organizationId="org-1" />);

    // First-time config (no stored sidecar): a blank-field probe has nothing to
    // authenticate with, so Test stays off until both keys are entered.
    expect(
      screen.getByRole('button', { name: 'Test connection' }),
    ).toBeDisabled();
  });

  it('asks for confirmation before removing a stored connection', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'kb.example.org',
      port: 5433,
      database: 'tale_knowledge',
      user: 'tale',
      sslmode: 'require',
    });
    deleteKnowledge.mockResolvedValue(null);

    const { user } = render(
      <OrgDataResidencySettings organizationId="org-1" />,
    );

    await user.click(screen.getByRole('switch', { name: 'External Postgres' }));

    expect(
      await screen.findByText('Remove the knowledge database connection?'),
    ).toBeInTheDocument();
    expect(deleteKnowledge).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Remove connection' }));

    await waitFor(() =>
      expect(deleteKnowledge).toHaveBeenCalledWith({
        organizationId: 'org-1',
      }),
    );
  });

  it('shows AccessDenied to a member without the orgSettings write capability', () => {
    abilityState.canWrite = false;

    render(<OrgDataResidencySettings organizationId="org-1" />);

    expect(
      screen.getByText(
        "You need Admin permissions to manage the organization's data residency.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
