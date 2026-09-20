import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@tale/ui/editor';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { DataResidencySettings } from './data-residency-settings';

/**
 * Component coverage for the unified data-residency page — one surface, two
 * access levels: an org admin (`write orgSettings`) edits this organization's
 * knowledge database, embedding model, and object storage; a member without it
 * sees them read-only with a stated reason. There is no deployment-wide store
 * section any more (where the deployment default lives is environment-driven),
 * and the page must not grow one back.
 *
 * Backend behaviour (config validation, SOPS sidecars, the real probes) is
 * covered by the backend tests — here the hooks are stubbed at the module
 * boundary. The org sections save through the settings header's shared
 * Save/Discard cluster; its slot is absent in this harness, so saves are
 * driven through the composed controller captured from `useActiveEditor`
 * (exactly what the cluster does). Test/backfill run via their own inline
 * buttons.
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
  // The org's catalog listing, as the embedding section's model row reads
  // it: only the fields it narrows (name, origin, catalog source, models'
  // id/tags/embedding facts, the per-provider catalog error).
  catalogs: [] as Array<{
    name: string;
    origin: 'shipped' | 'organization';
    catalogSource: 'none' | 'static' | 'openrouter-api' | 'models-endpoint';
    models: Array<{
      id: string;
      tags: string[];
      embedding?: { dimensions: number };
    }>;
    catalogError?: string;
  }>,
}));

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
  useProviderCatalogs: () => ({
    data: fixtures.catalogs,
    isPending: false,
    isError: false,
  }),
}));

// Instant actions (remove/backfill) report through toasts; the editor save
// path must never toast. One spy asserts both.
vi.mock('@tale/ui/use-toast', () => ({
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
    setStorageFixture({ configured: false });
    setKnowledgeFixture({ configured: false });
    setEmbeddingFixture({ configured: false });
    fixtures.embeddingRecommendations = [];
    fixtures.backfill = null;
    fixtures.credentials = [];
    fixtures.catalogs = [];
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

  it('renders exactly the three org sections — no deployment-wide store section', () => {
    render(<DataResidencySettings organizationId="org-1" />);

    const headings = screen
      .getAllByRole('heading')
      .map((h) => h.textContent ?? '');
    const order = [
      'Knowledge database',
      'Embedding model',
      'Object storage',
    ].map((name) => headings.findIndex((text) => text === name));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The retired deployment-wide stores (saved but never read at boot) are
    // gone for good: no store may claim a restart applies it.
    for (const retired of [
      'Knowledge database (RAG)',
      'File storage (uploaded documents)',
      'Application database (advanced)',
      'Save deployment',
    ]) {
      expect(screen.queryByText(retired)).toBeNull();
    }
    expect(screen.queryByText(/TALE_DEPLOYMENT_CONFIG_ADMINS/)).toBeNull();
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

  it("lists a shipped provider's catalog embedding models and fills the width from the pick", async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'openai', name: 'Team key' },
    ];
    fixtures.catalogs = [
      {
        name: 'openai',
        origin: 'shipped',
        catalogSource: 'models-endpoint',
        models: [
          { id: 'gpt-5', tags: ['chat'] },
          {
            id: 'text-embedding-3-small',
            tags: ['embedding'],
            embedding: { dimensions: 1536 },
          },
        ],
      },
    ];
    saveEmbedding.mockResolvedValue(null);

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'openai' }));

    // The tag field gives way to a closed pick over the catalog's embedding
    // models: no chat model among them, and no hand-typed escape either —
    // a shipped catalog is authoritative.
    expect(
      within(section).queryByRole('textbox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        "Embedding models the provider's catalog lists.",
      ),
    ).toBeInTheDocument();
    await user.click(within(section).getByRole('combobox', { name: 'Model' }));
    expect(
      screen.getByRole('option', { name: 'text-embedding-3-small' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'gpt-5' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Other model…' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('option', { name: 'text-embedding-3-small' }),
    );

    // The one fact nobody should look up by hand lands in the width field.
    expect(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
    ).toHaveValue(1536);

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
  });

  it('refuses a shipped provider whose catalog lists no embedding model', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'deepseek', name: 'API key' },
    ];
    fixtures.catalogs = [
      {
        name: 'deepseek',
        origin: 'shipped',
        catalogSource: 'static',
        models: [{ id: 'deepseek-v4', tags: ['chat'] }],
      },
    ];

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'deepseek' }));

    // Nothing to type into: the row says so, and the shared Save stays off.
    // The provider select carries no second line about it.
    expect(
      within(section).queryByRole('textbox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).queryByRole('combobox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(within(section).getByText('No embedding model')).toBeInTheDocument();
    expect(
      within(section).getByText(
        'The deepseek catalog lists no embedding model. Choose a provider that serves one.',
      ),
    ).toBeInTheDocument();
    expect(capture.current?.isDirty).toBe(true);
    expect(capture.current?.isValid).toBe(false);
    expect(
      within(section).getByRole('combobox', { name: 'Provider' }),
    ).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a shipped provider whose catalog could not be loaded', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'vercel-ai-gateway', name: 'Gateway key' },
    ];
    fixtures.catalogs = [
      {
        name: 'vercel-ai-gateway',
        origin: 'shipped',
        catalogSource: 'models-endpoint',
        models: [],
        catalogError: 'fetch failed',
      },
    ];

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'vercel-ai-gateway' }));

    expect(
      within(section).queryByRole('textbox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).getByText('Catalog unavailable'),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(
        'The vercel-ai-gateway catalog could not be loaded. Refresh the catalogs under Settings → AI providers and try again.',
      ),
    ).toBeInTheDocument();
    expect(capture.current?.isValid).toBe(false);
  });

  it('keeps the free tag field for an org-defined provider whose listing carries no embedding model', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'local-embedding', name: 'Local key' },
    ];
    fixtures.catalogs = [
      {
        name: 'local-embedding',
        origin: 'organization',
        catalogSource: 'models-endpoint',
        models: [{ id: 'local-chat', tags: ['chat'] }],
      },
    ];
    saveEmbedding.mockResolvedValue(null);

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'local-embedding' }));

    // A bare listing tags nothing as an embedding model, so it cannot tell;
    // the tag is typed, and the width with it.
    expect(
      within(section).queryByRole('combobox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        'No listing can tell whether this provider serves embeddings, so enter the tag exactly as the provider spells it.',
      ),
    ).toBeInTheDocument();
    await user.type(
      within(section).getByRole('textbox', { name: 'Model' }),
      'example-embedding',
    );
    await user.type(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
      '1024',
    );

    await act(async () => {
      await capture.current?.save();
    });

    expect(saveEmbedding).toHaveBeenCalledWith({
      organizationId: 'org-1',
      providerSlug: 'local-embedding',
      credentialId: undefined,
      model: 'example-embedding',
      dimensions: 1024,
      baseUrl: undefined,
    });
  });

  it('keeps the free tag field for Azure, which has no catalog to consult', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'azure', name: 'Resource key' },
    ];
    fixtures.catalogs = [
      { name: 'azure', origin: 'shipped', catalogSource: 'none', models: [] },
    ];

    const { user } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'azure' }));

    expect(
      within(section).getByRole('textbox', { name: 'Model' }),
    ).toBeInTheDocument();
    expect(
      within(section).queryByText('No embedding model'),
    ).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        'No listing can tell whether this provider serves embeddings, so enter the tag exactly as the provider spells it.',
      ),
    ).toBeInTheDocument();
  });

  it("adds Other model… to an org-defined provider's pick and saves the typed tag", async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'local-embedding', name: 'Local key' },
    ];
    fixtures.catalogs = [
      {
        name: 'local-embedding',
        origin: 'organization',
        catalogSource: 'models-endpoint',
        models: [{ id: 'nomic-embed', tags: ['embedding'] }],
      },
    ];
    saveEmbedding.mockResolvedValue(null);

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'local-embedding' }));
    expect(
      within(section).getByText(
        "Embedding models this provider's listing carries; pick Other model to type a tag it does not list.",
      ),
    ).toBeInTheDocument();
    await user.click(within(section).getByRole('combobox', { name: 'Model' }));
    expect(
      screen.getByRole('option', { name: 'nomic-embed' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Other model…' }));

    // The tag field opens empty and unjudged; the hint turns to spelling.
    const tag = within(section).getByRole('textbox', { name: 'Model tag' });
    expect(tag).toHaveValue('');
    expect(
      within(section).queryByText('Enter the model tag.'),
    ).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        'The model tag exactly as the provider spells it.',
      ),
    ).toBeInTheDocument();
    await user.type(tag, 'nomic-embed-v2');
    await user.type(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
      '768',
    );

    await act(async () => {
      await capture.current?.save();
    });

    expect(saveEmbedding).toHaveBeenCalledWith({
      organizationId: 'org-1',
      providerSlug: 'local-embedding',
      credentialId: undefined,
      model: 'nomic-embed-v2',
      dimensions: 768,
      baseUrl: undefined,
    });
  });

  it('opens a stored tag an org-defined listing does not carry in the Other model state', () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'local-embedding', name: 'Local key' },
    ];
    fixtures.catalogs = [
      {
        name: 'local-embedding',
        origin: 'organization',
        catalogSource: 'models-endpoint',
        models: [{ id: 'nomic-embed', tags: ['embedding'] }],
      },
    ];
    setEmbeddingFixture({
      configured: true,
      providerSlug: 'local-embedding',
      model: 'my-embedder',
      dimensions: 1536,
    });

    renderWithController();

    const section = sectionByHeading('Embedding model');
    expect(
      within(section).getByRole('combobox', { name: 'Model' }),
    ).toHaveTextContent('Other model…');
    expect(
      within(section).getByRole('textbox', { name: 'Model tag' }),
    ).toHaveValue('my-embedder');
  });

  it('shows a stored tag a shipped catalog does not list as its own entry', () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'openai', name: 'Team key' },
    ];
    fixtures.catalogs = [
      {
        name: 'openai',
        origin: 'shipped',
        catalogSource: 'models-endpoint',
        models: [
          {
            id: 'text-embedding-3-small',
            tags: ['embedding'],
            embedding: { dimensions: 1536 },
          },
        ],
      },
    ];
    setEmbeddingFixture({
      configured: true,
      providerSlug: 'openai',
      model: 'text-embedding-3-large',
      dimensions: 3072,
    });

    renderWithController();

    // No escape on a shipped catalog — the stored tag shows as the selected
    // entry so the admin sees what the config names and can move it.
    const section = sectionByHeading('Embedding model');
    expect(
      within(section).getByRole('combobox', { name: 'Model' }),
    ).toHaveTextContent('text-embedding-3-large');
    expect(
      within(section).queryByRole('textbox', { name: 'Model tag' }),
    ).not.toBeInTheDocument();
  });

  it('clears the model pick when the provider changes and keeps the width', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'openai', name: 'Team key' },
      { id: 'cred-2', providerSlug: 'zai', name: 'GLM key' },
    ];
    fixtures.catalogs = [
      {
        name: 'openai',
        origin: 'shipped',
        catalogSource: 'models-endpoint',
        models: [
          {
            id: 'text-embedding-3-small',
            tags: ['embedding'],
            embedding: { dimensions: 1536 },
          },
        ],
      },
      {
        name: 'zai',
        origin: 'shipped',
        catalogSource: 'static',
        models: [
          {
            id: 'embedding-3',
            tags: ['embedding'],
            embedding: { dimensions: 1536 },
          },
        ],
      },
    ];

    const { user } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'openai' }));
    await user.click(within(section).getByRole('combobox', { name: 'Model' }));
    await user.click(
      screen.getByRole('option', { name: 'text-embedding-3-small' }),
    );

    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'zai' }));

    // A tag names one provider's model, so the pick starts over; the width
    // is the corpus's and stays.
    expect(
      within(section).getByRole('combobox', { name: 'Model' }),
    ).toHaveTextContent('Choose a model');
    expect(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
    ).toHaveValue(1536);
  });

  it('leaves the width to the admin when the catalog states none for the pick', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'vercel-ai-gateway', name: 'Gateway key' },
    ];
    fixtures.catalogs = [
      {
        name: 'vercel-ai-gateway',
        origin: 'shipped',
        catalogSource: 'models-endpoint',
        models: [{ id: 'openai/text-embedding-3-large', tags: ['embedding'] }],
      },
    ];

    const { user } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'vercel-ai-gateway' }));
    await user.click(within(section).getByRole('combobox', { name: 'Model' }));
    await user.click(
      screen.getByRole('option', { name: 'openai/text-embedding-3-large' }),
    );

    // No width is guessed: the field stays empty for the admin to state it,
    // as its own row says.
    expect(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
    ).toHaveValue(null);
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
});
