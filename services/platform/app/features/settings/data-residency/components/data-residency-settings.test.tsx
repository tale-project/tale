import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@/app/components/ui/editor';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { DataResidencySettings } from './data-residency-settings';

/**
 * Component coverage for the unified data-residency page — the two access
 * levels of the SAME surface:
 *
 *   - A deployment operator (`canEdit` from the read) edits the deployment
 *     stores; a non-operator admin sees them read-only with a stated reason.
 *   - An org admin (`write orgSettings`) edits this organization's knowledge
 *     database, embedding model, and object storage; a member without it sees
 *     them read-only with a stated reason.
 *
 * Backend behaviour (config validation, SOPS sidecars, the real probes) is
 * covered by the convex action tests — here the hooks are stubbed at the
 * module boundary. The org sections save through the settings header's shared
 * Save/Discard cluster; its slot is absent in this harness, so saves are
 * driven through the composed controller captured from `useActiveEditor`
 * (exactly what the cluster does). Deployment editing is asserted via the
 * rendered controls; Test/backfill via their own inline buttons.
 */

const saveStorage = vi.hoisted(() => vi.fn());
const deleteStorage = vi.hoisted(() => vi.fn());
const testStorage = vi.hoisted(() => vi.fn());
const startBackfill = vi.hoisted(() => vi.fn());
const saveKnowledge = vi.hoisted(() => vi.fn());
const deleteKnowledge = vi.hoisted(() => vi.fn());
const testKnowledge = vi.hoisted(() => vi.fn());
const saveEmbedding = vi.hoisted(() => vi.fn());
const deleteEmbedding = vi.hoisted(() => vi.fn());
const pageToast = vi.hoisted(() => vi.fn());

interface StorageFixture {
  configured: boolean;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  bucket?: string;
  prefix?: string;
  hasCredentials?: boolean;
}

interface KnowledgeFixture {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: string;
  hasPassword?: boolean;
}

interface EmbeddingFixture {
  configured: boolean;
  providerSlug?: string;
  credentialId?: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

const fixtures = vi.hoisted(() => ({
  deployment: undefined as unknown,
  deploymentError: false,
  storage: { configured: false } as unknown,
  knowledge: { configured: false } as unknown,
  embedding: { configured: false } as unknown,
  embeddingRecommendations: [] as Array<{
    providerSlug: string;
    model: string;
    dimensions: number;
    recommended: boolean;
  }>,
  backfill: null as unknown,
  credentials: [] as Array<{
    id: string;
    providerSlug: string;
    name: string;
  }>,
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

function setKnowledgeFixture(view: KnowledgeFixture) {
  fixtures.knowledge = view;
}

function setEmbeddingFixture(view: EmbeddingFixture) {
  fixtures.embedding = view;
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
  useOrgKnowledgeConnection: () => ({
    data: fixtures.knowledge,
    isPending: false,
    isError: false,
    error: null,
  }),
  useOrgKnowledgeEmbedding: () => ({
    data: fixtures.embedding,
    isPending: false,
    isError: false,
    error: null,
  }),
  useEmbeddingRecommendations: () => ({
    data: fixtures.embeddingRecommendations,
    isPending: false,
    isError: false,
    error: null,
  }),
  useObjectStorageBackfillStatus: () => ({
    data: fixtures.backfill,
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
  useStartObjectStorageBackfill: () => ({
    mutateAsync: startBackfill,
    isPending: false,
  }),
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
  useSaveOrgKnowledgeEmbedding: () => ({
    mutateAsync: saveEmbedding,
    isPending: false,
  }),
  useDeleteOrgKnowledgeEmbedding: () => ({
    mutateAsync: deleteEmbedding,
    isPending: false,
  }),
}));

// The embedding section's provider/credential selects read the org's stored
// credentials from the providers feature — a separate module boundary.
vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useProviderCredentials: () => ({
    data: fixtures.credentials,
    isPending: false,
  }),
}));

// Instant actions (remove/backfill) report through toasts; the editor save
// path must never toast. One spy asserts both.
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: pageToast }),
  toast: pageToast,
}));

// Two independent capabilities: reading org settings gates viewing the page;
// writing org settings gates editing the org sections.
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

/** Render inside an ActiveEditorProvider and capture the composed controller
 * the settings header's Save/Discard cluster would drive. */
function renderWithController() {
  const capture = { current: null as EditorController | null };
  function ActiveProbe() {
    capture.current = useActiveEditor();
    return null;
  }
  const rendered = render(
    <ActiveEditorProvider>
      <ActiveProbe />
      <DataResidencySettings organizationId="org-1" />
    </ActiveEditorProvider>,
  );
  return { ...rendered, capture };
}

function sectionByHeading(name: string): HTMLElement {
  return screen
    .getByRole('heading', { name })
    .closest('section') as HTMLElement;
}

describe('DataResidencySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canRead = true;
    abilityState.canWrite = true;
    setDeployment(false);
    setStorageFixture({ configured: false });
    setKnowledgeFixture({ configured: false });
    setEmbeddingFixture({ configured: false });
    fixtures.embeddingRecommendations = [];
    fixtures.backfill = null;
    fixtures.credentials = [];
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

  it('keeps the Save cluster registered and inert while every org section is collapsed', async () => {
    // The header Discard/Save pair is a permanent fixture for an org admin —
    // it never pops in and out as toggles flip. At rest it is clean and
    // valid (collapsed empty sections must not veto the shared Save).
    const { capture } = renderWithController();
    expect(capture.current).not.toBeNull();
    expect(capture.current?.isDirty).toBe(false);
    await waitFor(() => expect(capture.current?.isValid).toBe(true));
  });

  it('renders the org sections first and the deployment stores after', () => {
    setDeployment(true);
    render(<DataResidencySettings organizationId="org-1" />);

    const headings = screen
      .getAllByRole('heading')
      .map((h) => h.textContent ?? '');
    const order = [
      'Knowledge database',
      'Embedding model',
      'Object storage',
      'Knowledge database (RAG)',
      'File storage (uploaded documents)',
      'Application database (advanced)',
    ].map((name) => headings.findIndex((text) => text === name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('lets a deployment operator edit the deployment stores (editable state)', async () => {
    setDeployment(true);
    const { container } = render(
      <DataResidencySettings organizationId="org-1" />,
    );

    // Operator sees the enable switches (state as an interactive control) and
    // editable, non-readonly inputs. Three "External Postgres" switches: the
    // two deployment Postgres stores plus the org knowledge section's toggle.
    expect(
      screen.getAllByRole('switch', { name: 'External Postgres' }),
    ).toHaveLength(3);
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
    // there are no enable switches inside the deployment sections at all.
    // (The org knowledge section keeps its own toggle: this caller IS an org
    // admin, just not a deployment operator.)
    expect(
      within(sectionByHeading('Knowledge database (RAG)')).queryByRole(
        'switch',
      ),
    ).toBeNull();
    expect(
      within(sectionByHeading('Application database (advanced)')).queryByRole(
        'switch',
      ),
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

  it('renders the org knowledge section from a loaded config with its stored values', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      hasPassword: true,
    });
    const { container } = render(
      <DataResidencySettings organizationId="org-1" />,
    );

    const section = sectionByHeading('Knowledge database');
    expect(within(section).getByRole('textbox', { name: 'Host' })).toHaveValue(
      'pg.acme.example',
    );
    expect(
      within(section).getByRole('spinbutton', { name: 'Port' }),
    ).toHaveValue(5599);
    expect(
      within(section).getByRole('switch', { name: 'External Postgres' }),
    ).toBeChecked();
    // The stored password never renders — only the presence hint.
    expect(
      within(section).getByText(
        'A value is stored — leave blank to keep it, or enter a new one to replace it.',
      ),
    ).toBeInTheDocument();

    await waitFor(() => checkAccessibility(container));
  });

  it('saves the org knowledge connection through the header controller, keeping the stored password', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      hasPassword: true,
    });
    saveKnowledge.mockResolvedValue(null);

    const { user, capture } = renderWithController();

    const host = within(sectionByHeading('Knowledge database')).getByRole(
      'textbox',
      { name: 'Host' },
    );
    await user.clear(host);
    await user.type(host, 'pg2.acme.example');

    expect(capture.current?.isDirty).toBe(true);
    await act(async () => {
      await capture.current?.save();
    });

    // A blank password field means "keep the stored one" (null), never ''.
    expect(saveKnowledge).toHaveBeenCalledWith({
      organizationId: 'org-1',
      host: 'pg2.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      password: null,
    });
    expect(pageToast).not.toHaveBeenCalled();
  });

  it('probes the org knowledge database and shows the inline result', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      hasPassword: true,
    });
    testKnowledge.mockResolvedValue({ ok: true });

    const { user } = render(<DataResidencySettings organizationId="org-1" />);

    const section = sectionByHeading('Knowledge database');
    await user.click(
      within(section).getByRole('button', { name: 'Test connection' }),
    );

    expect(await within(section).findByText('OK')).toBeInTheDocument();
    expect(testKnowledge).toHaveBeenCalledWith({
      organizationId: 'org-1',
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      password: undefined,
    });
  });

  it('routes the toggle-off of a saved knowledge connection through a confirm, then removes with a toast', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      hasPassword: true,
    });
    deleteKnowledge.mockResolvedValue(null);

    const { user } = render(<DataResidencySettings organizationId="org-1" />);

    const section = sectionByHeading('Knowledge database');
    await user.click(
      within(section).getByRole('switch', { name: 'External Postgres' }),
    );
    // Nothing is deleted until the dialog confirms.
    expect(deleteKnowledge).not.toHaveBeenCalled();
    expect(
      screen.getByText('Remove the knowledge database connection?'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove connection' }));
    await waitFor(() =>
      expect(deleteKnowledge).toHaveBeenCalledWith({
        organizationId: 'org-1',
      }),
    );
    expect(pageToast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('Connection removed'),
      }),
    );
  });

  it('pins a credential rejection under the credential select instead of toasting', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'openai', name: 'Team key' },
    ];
    setEmbeddingFixture({
      configured: true,
      providerSlug: 'openai',
      credentialId: 'cred-1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    saveEmbedding.mockRejectedValue({
      data: { code: 'CREDENTIAL_PROVIDER_MISMATCH', message: 'mismatch' },
    });

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    const model = within(section).getByRole('textbox', { name: 'Model' });
    await user.clear(model);
    await user.type(model, 'text-embedding-3-large');

    await act(async () => {
      await capture.current?.save();
    });

    expect(
      within(section).getByText(
        'The selected credential belongs to a different provider.',
      ),
    ).toBeInTheDocument();
    // Field-level feedback resolves the save quietly — no destructive toast.
    expect(pageToast).not.toHaveBeenCalled();
  });

  it('warns that knowledge search is unavailable until an embedding model is configured', () => {
    render(<DataResidencySettings organizationId="org-1" />);

    const section = sectionByHeading('Embedding model');
    expect(
      within(section).getByText(
        'Knowledge search is unavailable until an embedding model is configured.',
      ),
    ).toBeInTheDocument();
    expect(within(section).getByText('Not configured')).toBeInTheDocument();
  });

  it('offers a curated embedding pick whose click fills the form without saving', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'openrouter', name: 'Org key' },
    ];
    fixtures.embeddingRecommendations = [
      {
        providerSlug: 'openrouter',
        model: 'qwen/qwen3-embedding-8b',
        dimensions: 1536,
        recommended: true,
      },
    ];

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    expect(
      within(section).getByText(
        'Your openrouter credential can serve qwen/qwen3-embedding-8b (1536-dimensional vectors).',
      ),
    ).toBeInTheDocument();

    await user.click(
      within(section).getByRole('button', { name: 'Use this model' }),
    );

    // The click FILLS the form (the vector width nobody should look up by
    // hand); committing stays with the unified Save, which has not run.
    expect(within(section).getByRole('textbox', { name: 'Model' })).toHaveValue(
      'qwen/qwen3-embedding-8b',
    );
    expect(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
    ).toHaveValue(1536);
    expect(capture.current?.isDirty).toBe(true);
    expect(saveEmbedding).not.toHaveBeenCalled();
  });

  it('saves the embedding model with the provider default credential omitted', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'openai', name: 'Team key' },
    ];
    saveEmbedding.mockResolvedValue(null);

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    // The section starts collapsed while unconfigured — its switch reveals
    // the form, exactly like the sibling sections.
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'openai' }));
    await user.type(
      within(section).getByRole('textbox', { name: 'Model' }),
      'text-embedding-3-small',
    );
    await user.type(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
      '1536',
    );

    expect(capture.current?.isDirty).toBe(true);
    await act(async () => {
      await capture.current?.save();
    });

    expect(saveEmbedding).toHaveBeenCalledWith({
      organizationId: 'org-1',
      providerSlug: 'openai',
      credentialId: undefined,
      model: 'text-embedding-3-small',
      dimensions: 1536,
      baseUrl: undefined,
    });
    expect(pageToast).not.toHaveBeenCalled();
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

    const orgSection = sectionByHeading('Object storage');
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

    const orgSection = sectionByHeading('Object storage');
    expect(
      within(orgSection).getByText('Deployment default'),
    ).toBeInTheDocument();
    expect(
      within(orgSection).getByRole('switch', { name: 'External S3' }),
    ).not.toBeChecked();
  });

  it('shows the org sections read-only with a stated reason for a non-admin', async () => {
    abilityState.canWrite = false; // read-only member
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: false,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    setKnowledgeFixture({
      configured: true,
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      hasPassword: true,
    });
    const { container, capture } = renderWithController();

    const orgSection = sectionByHeading('Object storage');
    // No enable switch and no editor registration — the state is a pill, the
    // values are read-only, and the reason is stated.
    expect(
      within(orgSection).queryByRole('switch', { name: 'External S3' }),
    ).toBeNull();
    expect(capture.current).toBeNull();
    expect(
      within(orgSection).getByText(
        "Admin permissions are required to change where this organization's files are stored.",
      ),
    ).toBeInTheDocument();
    expect(
      within(orgSection).getByRole('textbox', { name: 'Bucket' }),
    ).toHaveAttribute('readonly');

    const knowledgeSection = sectionByHeading('Knowledge database');
    expect(
      within(knowledgeSection).queryByRole('switch', {
        name: 'External Postgres',
      }),
    ).toBeNull();
    expect(
      within(knowledgeSection).getByRole('textbox', { name: 'Host' }),
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

    const { user, capture } = renderWithController();

    const bucket = screen.getByRole('textbox', { name: 'Bucket' });
    await user.clear(bucket);
    await user.type(bucket, 'org-blobs-eu');

    expect(capture.current?.isDirty).toBe(true);
    // The untouched, unconfigured embedding section must not veto the shared
    // Save: its empty form counts as valid (the group AND-s validity, and a
    // false here is exactly the "fresh org can never save storage" bug).
    await waitFor(() => expect(capture.current?.isValid).toBe(true));
    await act(async () => {
      await capture.current?.save();
    });

    // Blank endpoint/prefix and untouched credentials are omitted, not sent as
    // empty strings (empty creds would fail the server's pair check).
    expect(saveStorage).toHaveBeenCalledWith({
      organizationId: 'org-1',
      region: 'eu-central-1',
      forcePathStyle: false,
      bucket: 'org-blobs-eu',
    });
    expect(pageToast).not.toHaveBeenCalled();
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
    const orgSection = sectionByHeading('Object storage');
    await user.click(
      within(orgSection).getByRole('button', { name: 'Test connection' }),
    );

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

  it('starts the blob backfill behind a confirm and reflects the running state', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: false,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    startBackfill.mockResolvedValue({ runId: 'run-1' });

    const { user } = render(<DataResidencySettings organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Move existing files' }),
    );
    await user.click(screen.getByRole('button', { name: 'Move files' }));

    await waitFor(() =>
      expect(startBackfill).toHaveBeenCalledWith({ organizationId: 'org-1' }),
    );
  });

  it('shows the latest backfill run status and disables the start button while running', () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: false,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    fixtures.backfill = {
      runId: 'run-1',
      status: 'running',
      dryRun: false,
      migrated: 12,
      failed: 1,
      candidates: 40,
    };

    render(<DataResidencySettings organizationId="org-1" />);

    expect(
      screen.getByText('Moving files… 12 moved, 1 failed so far.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move existing files' }),
    ).toBeDisabled();
  });

  it('hides the backfill control until a bucket connection is saved', () => {
    render(<DataResidencySettings organizationId="org-1" />);
    expect(
      screen.queryByRole('button', { name: 'Move existing files' }),
    ).toBeNull();
  });

  it('surfaces a deployment read failure without hiding the org sections', () => {
    fixtures.deployment = undefined;
    fixtures.deploymentError = true;

    render(<DataResidencySettings organizationId="org-1" />);

    // The deployment group reports its own failure inline...
    expect(
      screen.getByText(/Couldn't load the deployment configuration/),
    ).toBeInTheDocument();
    // ...while the org sections still render.
    expect(
      screen.getByRole('heading', { name: 'Object storage' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Knowledge database' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Embedding model' }),
    ).toBeInTheDocument();
  });
});
