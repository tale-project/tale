import { KNOWLEDGE_CONNECTION_PASSWORD_MAX } from '@tale/shared/schemas/knowledge';
import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@tale/ui/editor';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OBJECT_STORAGE_CONNECTION_MAX } from '@/lib/shared/schemas/object_storage';
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
const refetchRecommendations = vi.hoisted(() => vi.fn());

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
  credentialResolvable?: boolean;
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
  // Each provider's declared embedding support, as the recommendations read
  // reports it beside the picks. A provider missing here reads as unknown.
  embeddingSupport: [] as Array<{
    providerSlug: string;
    support: 'supported' | 'unsupported' | 'unknown';
  }>,
  // How the recommendations read — picks and declarations — stands: answered,
  // still in flight, failed, or retrying after that first failure.
  recommendationsRead: 'answered' as
    | 'answered'
    | 'pending'
    | 'failed'
    | 'retrying',
  // Whether the org's catalog listing answered or failed outright.
  catalogsRead: 'answered' as 'answered' | 'failed',
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
  useEmbeddingRecommendations: () =>
    fixtures.recommendationsRead === 'answered'
      ? {
          data: {
            recommendations: fixtures.embeddingRecommendations,
            providers: fixtures.embeddingSupport,
          },
          isPending: false,
          isError: false,
          isFetching: false,
          isFetched: true,
          error: null,
          refetch: refetchRecommendations,
        }
      : {
          data: undefined,
          isPending: fixtures.recommendationsRead !== 'failed',
          isError: fixtures.recommendationsRead === 'failed',
          isFetching: fixtures.recommendationsRead !== 'failed',
          isFetched: fixtures.recommendationsRead !== 'pending',
          error:
            fixtures.recommendationsRead === 'failed'
              ? new Error('recommendations unavailable')
              : null,
          refetch: refetchRecommendations,
        },
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
  useProviderCatalogs: () =>
    fixtures.catalogsRead === 'answered'
      ? { data: fixtures.catalogs, isPending: false, isError: false }
      : { data: undefined, isPending: false, isError: true },
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
  const page = () => (
    <ActiveEditorProvider>
      <ActiveProbe />
      <DataResidencySettings organizationId="org-1" />
    </ActiveEditorProvider>
  );
  const rendered = render(page());
  return {
    ...rendered,
    capture,
    rerenderPage: () => rendered.rerender(page()),
  };
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
    fixtures.embeddingSupport = [];
    fixtures.recommendationsRead = 'answered';
    fixtures.catalogsRead = 'answered';
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

  it('returns an unsaved reveal toggle to Off when the header Discard runs', async () => {
    // The External Postgres switch is local state, not a form field: the
    // header's Discard used to reset the fields (Host cleared) and leave the
    // switch on with the panel expanded, showing an "external" mode that was
    // never saved (DATA-F10).
    const { capture, user } = renderWithController();
    const section = sectionByHeading('Knowledge database');
    const toggle = within(section).getByRole('switch', {
      name: 'External Postgres',
    });
    await user.click(toggle);
    const host = within(section).getByRole('textbox', { name: 'Host' });
    await user.type(host, 'pg.example.test');
    await waitFor(() => expect(capture.current?.isDirty).toBe(true));

    act(() => capture.current?.reset());

    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(
      within(section).queryByRole('textbox', { name: 'Host' }),
    ).not.toBeInTheDocument();
    expect(capture.current?.isDirty).toBe(false);
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

    await checkAccessibility(container);
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

  it('names what the knowledge probe would refuse instead of sending it', async () => {
    // Test used to send the form unchecked: an empty host came back as a
    // bare `invalid body` on the result line (TALE-103).
    const { user } = render(<DataResidencySettings organizationId="org-1" />);
    const section = sectionByHeading('Knowledge database');
    await user.click(
      within(section).getByRole('switch', { name: 'External Postgres' }),
    );
    await user.click(
      within(section).getByRole('button', { name: 'Test connection' }),
    );

    expect(
      await within(section).findByText('Enter the database host.'),
    ).toBeInTheDocument();
    expect(
      within(section).getByText('Enter the database name.'),
    ).toBeInTheDocument();
    expect(
      within(section).getByText('Enter the database user.'),
    ).toBeInTheDocument();
    expect(
      within(section).getByRole('textbox', { name: 'Host' }),
    ).toHaveFocus();
    expect(testKnowledge).not.toHaveBeenCalled();
  });

  describe.each([
    {
      name: 'knowledge',
      heading: 'Knowledge database',
      field: 'Host',
      payloadField: 'host',
      original: 'original-db.example.test',
      edited: 'new-db.example.test',
      probe: testKnowledge,
      save: saveKnowledge,
      configure: () =>
        setKnowledgeFixture({
          configured: true,
          host: 'original-db.example.test',
          database: 'synthetic_rag',
          user: 'synthetic',
          hasPassword: true,
        }),
    },
    {
      name: 'object storage',
      heading: 'Object storage',
      field: 'Bucket',
      payloadField: 'bucket',
      original: 'original-synthetic-bucket',
      edited: 'new-synthetic-bucket',
      probe: testStorage,
      save: saveStorage,
      configure: () =>
        setStorageFixture({
          configured: true,
          region: 'eu-central-1',
          bucket: 'original-synthetic-bucket',
          hasCredentials: true,
        }),
    },
  ])('$name probe ownership', (connection) => {
    const success = { ok: true, hint: 'Synthetic success' };
    const refusal = { ok: false, error: 'Synthetic refusal' };

    it.each(['success', 'refusal', 'rejection'] as const)(
      'ignores a late %s after an edit and saves the untested draft',
      async (outcome) => {
        connection.configure();
        const pending = Promise.withResolvers<
          typeof success | typeof refusal
        >();
        connection.probe.mockReturnValueOnce(pending.promise);
        connection.save.mockResolvedValue(null);
        const { user, capture } = renderWithController();
        const section = sectionByHeading(connection.heading);
        const field = within(section).getByRole('textbox', {
          name: connection.field,
        });
        await user.click(
          within(section).getByRole('button', { name: 'Test connection' }),
        );
        expect(connection.probe).toHaveBeenCalledWith(
          expect.objectContaining({
            [connection.payloadField]: connection.original,
          }),
        );
        expect(field).toBeEnabled();
        await user.clear(field);
        await user.type(field, connection.edited);
        await act(async () => {
          if (outcome === 'rejection') {
            pending.reject(new Error('Synthetic refusal'));
          } else {
            pending.resolve(outcome === 'success' ? success : refusal);
          }
        });
        expect(
          within(section).queryByText(/OK|Bucket verified|Failed/),
        ).toBeNull();
        expect(within(section).queryByText(/Synthetic/)).toBeNull();
        expect(field).toHaveValue(connection.edited);
        expect(capture.current?.isDirty).toBe(true);
        await act(async () => {
          await capture.current?.save();
        });
        expect(connection.save).toHaveBeenCalledWith(
          expect.objectContaining({
            [connection.payloadField]: connection.edited,
          }),
        );
        expect(pageToast).not.toHaveBeenCalled();
      },
    );

    it('does not revive a pending success after editing and reverting', async () => {
      connection.configure();
      const pending = Promise.withResolvers<typeof success>();
      connection.probe.mockReturnValueOnce(pending.promise);
      const { user } = renderWithController();
      const section = sectionByHeading(connection.heading);
      const field = within(section).getByRole('textbox', {
        name: connection.field,
      });
      await user.click(
        within(section).getByRole('button', { name: 'Test connection' }),
      );
      await user.clear(field);
      await user.type(field, connection.original);
      await act(async () => pending.resolve(success));
      expect(within(section).queryByText(/OK|Bucket verified/)).toBeNull();
    });

    it('clears a completed success on the next edit', async () => {
      connection.configure();
      connection.probe.mockResolvedValueOnce(success);
      const { user } = renderWithController();
      const section = sectionByHeading(connection.heading);
      await user.click(
        within(section).getByRole('button', { name: 'Test connection' }),
      );
      expect(
        await within(section).findByText(/OK|Bucket verified/),
      ).toBeInTheDocument();
      await user.type(
        within(section).getByRole('textbox', { name: connection.field }),
        '-edited',
      );
      expect(within(section).queryByText(/OK|Bucket verified/)).toBeNull();
    });

    it.each(['refusal', 'rejection'] as const)(
      'reports a current %s while preserving the draft',
      async (outcome) => {
        connection.configure();
        const pending = Promise.withResolvers<typeof refusal>();
        connection.probe.mockReturnValueOnce(pending.promise);
        const { user, capture } = renderWithController();
        const section = sectionByHeading(connection.heading);
        const field = within(section).getByRole('textbox', {
          name: connection.field,
        });
        await user.clear(field);
        await user.type(field, connection.edited);
        await user.click(
          within(section).getByRole('button', { name: 'Test connection' }),
        );
        await act(async () => {
          if (outcome === 'rejection') {
            pending.reject(new Error('Synthetic refusal'));
          } else {
            pending.resolve(refusal);
          }
        });
        expect(
          within(section).getByText('Failed — Synthetic refusal'),
        ).toBeInTheDocument();
        expect(field).toHaveValue(connection.edited);
        expect(capture.current?.isDirty).toBe(true);
        expect(connection.save).not.toHaveBeenCalled();
        expect(pageToast).not.toHaveBeenCalled();
      },
    );
  });

  it('refuses a knowledge database of spaces, which the door would get trimmed to nothing', async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      hasPassword: true,
    });
    const { user, capture } = renderWithController();
    const section = sectionByHeading('Knowledge database');

    const database = within(section).getByRole('textbox', {
      name: 'Database',
    });
    await user.clear(database);
    await user.type(database, '   ');
    await act(async () => {
      await expect(capture.current?.save()).rejects.toThrow(
        'VALIDATION_FAILED',
      );
    });
    expect(
      await within(section).findByText('Enter the database name.'),
    ).toBeInTheDocument();

    await user.click(
      within(section).getByRole('button', { name: 'Test connection' }),
    );
    expect(saveKnowledge).not.toHaveBeenCalled();
    expect(testKnowledge).not.toHaveBeenCalled();
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

  // Settings whose credential was deleted are not "Configured": the badge
  // and a warning say the credential is missing and where to fix it.
  it('reports a configured model whose credential is gone as "Credential missing"', () => {
    setEmbeddingFixture({
      configured: true,
      credentialResolvable: false,
      providerSlug: 'openai',
      credentialId: 'cred-gone',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    render(<DataResidencySettings organizationId="org-1" />);

    const section = sectionByHeading('Embedding model');
    expect(within(section).getByText('Credential missing')).toBeInTheDocument();
    expect(within(section).queryByText('Configured')).toBeNull();
    expect(
      within(section).getByText(
        /credential this embedding model resolves no longer exists/i,
      ),
    ).toBeInTheDocument();
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

  it('refuses a provider declared unable to embed, whatever its listing carries', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'anthropic', name: 'API key' },
    ];
    fixtures.embeddingSupport = [
      { providerSlug: 'anthropic', support: 'unsupported' },
    ];
    fixtures.catalogs = [
      {
        name: 'anthropic',
        origin: 'shipped',
        catalogSource: 'static',
        // Even an embedding-tagged entry cannot overrule the declaration: a
        // listing can outlive the vendor's embeddings API.
        models: [
          { id: 'claude-sonnet-5', tags: ['chat'] },
          {
            id: 'stale-embedding',
            tags: ['embedding'],
            embedding: { dimensions: 1536 },
          },
        ],
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
    await user.click(screen.getByRole('option', { name: 'anthropic' }));

    // Nothing to pick or type: the row says the provider cannot embed, and
    // the shared Save stays off. The provider select carries no second line.
    expect(
      within(section).queryByRole('textbox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).queryByRole('combobox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent(
      'Cannot embed',
    );
    expect(
      within(section).getByText(
        'anthropic offers no embedding model. Choose a provider that serves one.',
      ),
    ).toBeInTheDocument();
    expect(capture.current?.isDirty).toBe(true);
    expect(capture.current?.isValid).toBe(false);
    expect(
      within(section).getByRole('combobox', { name: 'Provider' }),
    ).not.toHaveAttribute('aria-invalid', 'true');
  });

  // The declarations come from a second read. Until it answers, the form
  // cannot tell "cannot embed" from "no curated width" — and reading its
  // silence as "nothing is refused" let Anthropic through to a save that
  // failed at index time.
  const anthropicWithoutEmbeddingEntry = () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'anthropic', name: 'API key' },
    ];
    fixtures.embeddingSupport = [
      { providerSlug: 'anthropic', support: 'unsupported' },
    ];
    fixtures.catalogs = [
      {
        name: 'anthropic',
        origin: 'shipped',
        catalogSource: 'static',
        models: [{ id: 'claude-sonnet-5', tags: ['chat'] }],
      },
    ];
  };

  it('keeps the form closed while the declarations read is in flight', async () => {
    anthropicWithoutEmbeddingEntry();
    fixtures.recommendationsRead = 'pending';

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );

    // Nothing can be chosen before the form knows which providers cannot
    // embed: the fields stay disabled, and no row claims "no curated width".
    const provider = within(section).getByRole('combobox', {
      name: 'Provider',
    });
    expect(provider).toBeDisabled();
    await user.click(provider);
    expect(
      screen.queryByRole('option', { name: 'anthropic' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).queryByText(/Tale knows no vector width/),
    ).not.toBeInTheDocument();
    expect(capture.current?.isDirty).toBe(false);
    expect(saveEmbedding).not.toHaveBeenCalled();
  });

  it('refuses every provider while the declarations read has failed, and offers a retry', async () => {
    anthropicWithoutEmbeddingEntry();
    fixtures.recommendationsRead = 'failed';

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    expect(
      within(section).getByText(
        'Tale could not check which providers can embed. No model can be chosen until the check answers.',
      ),
    ).toBeInTheDocument();
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'anthropic' }));

    // The row neither claims "no curated width" nor offers a field: the
    // check could not say whether the provider embeds, so it refuses.
    expect(
      within(section).queryByRole('textbox', { name: 'Model' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).queryByText(/Tale knows no vector width/),
    ).not.toBeInTheDocument();
    expect(within(section).getByRole('status')).toHaveTextContent(
      'Could not check',
    );
    expect(
      within(section).getByText(
        'Tale could not check whether anthropic can embed, so no model can be chosen yet. Use Try again above.',
      ),
    ).toBeInTheDocument();
    expect(capture.current?.isDirty).toBe(true);
    expect(capture.current?.isValid).toBe(false);
    await act(async () => {
      await expect(capture.current?.save()).rejects.toThrow(
        'VALIDATION_FAILED',
      );
    });
    expect(saveEmbedding).not.toHaveBeenCalled();

    await user.click(
      within(section).getByRole('button', { name: 'Try again' }),
    );
    expect(refetchRecommendations).toHaveBeenCalledTimes(1);
  });

  it('keeps an edited draft dirty while the failed declarations read retries', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'deepseek', name: 'API key' },
    ];
    fixtures.recommendationsRead = 'failed';
    const { user, capture, rerenderPage } = renderWithController();
    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'deepseek' }));
    expect(capture.current?.isDirty).toBe(true);

    // With no successful data yet, a real refetch returns to pending. It
    // must not suppress the dirty source while this draft still exists.
    fixtures.recommendationsRead = 'retrying';
    rerenderPage();
    expect(capture.current?.isDirty).toBe(true);
    expect(capture.current?.isValid).toBe(false);
    expect(
      within(section).getByRole('combobox', { name: 'Provider' }),
    ).toHaveTextContent('deepseek');

    fixtures.recommendationsRead = 'answered';
    fixtures.embeddingSupport = [
      { providerSlug: 'deepseek', support: 'unknown' },
    ];
    rerenderPage();
    expect(capture.current?.isDirty).toBe(true);
    expect(
      within(section).getByRole('combobox', { name: 'Provider' }),
    ).toHaveTextContent('deepseek');
    expect(
      within(section).getByRole('textbox', { name: 'Model' }),
    ).toBeEnabled();
    expect(saveEmbedding).not.toHaveBeenCalled();
  });

  it('pins the door refusal of a provider that cannot embed under the model', async () => {
    // The declaration changed after the page read it (or a save raced the
    // read): the write door refuses, and the row names the fix.
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'deepseek', name: 'API key' },
    ];
    fixtures.embeddingSupport = [
      { providerSlug: 'deepseek', support: 'unknown' },
    ];
    saveEmbedding.mockRejectedValue({
      data: {
        code: 'EMBEDDING_PROVIDER_UNSUPPORTED',
        message: 'Provider "deepseek" offers no embedding model',
      },
    });

    const { user, capture } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'deepseek' }));
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

    expect(saveEmbedding).toHaveBeenCalledTimes(1);
    expect(
      within(section).getByText(
        'This provider offers no embedding model — choose a provider that serves one.',
      ),
    ).toBeInTheDocument();
    expect(pageToast).not.toHaveBeenCalled();
  });

  it('asks for the model and its width by hand where no curated width ships', async () => {
    // A shipped catalog that lists no embedding model says nothing about the
    // vendor — only that no width is known here. Refusing it would block a
    // provider that may well embed; the admin enters both instead.
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'deepseek', name: 'API key' },
    ];
    fixtures.embeddingSupport = [
      { providerSlug: 'deepseek', support: 'unknown' },
    ];
    fixtures.catalogs = [
      {
        name: 'deepseek',
        origin: 'shipped',
        catalogSource: 'static',
        models: [{ id: 'deepseek-v4', tags: ['chat'] }],
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
    await user.click(screen.getByRole('option', { name: 'deepseek' }));

    expect(within(section).queryByText('Cannot embed')).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        'Tale knows no vector width for deepseek. Enter the model tag (or your deployment name) and the vector width that model produces.',
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
    expect(capture.current?.isValid).toBe(true);

    await act(async () => {
      await capture.current?.save();
    });

    expect(saveEmbedding).toHaveBeenCalledWith({
      organizationId: 'org-1',
      providerSlug: 'deepseek',
      credentialId: undefined,
      model: 'example-embedding',
      dimensions: 1024,
      baseUrl: undefined,
    });
  });

  // A knowledge database keeps a table per supported width: a width with no
  // table would save and then fail every document at index time, so the
  // form refuses it where it is typed and names the widths that are stored.
  it('refuses a vector width the knowledge database has no table for', async () => {
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'deepseek', name: 'API key' },
    ];
    fixtures.embeddingSupport = [
      { providerSlug: 'deepseek', support: 'unknown' },
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
    await user.type(
      within(section).getByRole('textbox', { name: 'Model' }),
      'example-embedding',
    );
    const width = within(section).getByRole('spinbutton', {
      name: 'Vector width',
    });
    await user.type(width, '1000');

    expect(capture.current?.isValid).toBe(false);
    // The row's hint names the widths before anything is typed wrong.
    expect(
      within(section).getByText(
        /one of 256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096\./,
      ),
    ).toBeInTheDocument();

    await user.clear(width);
    await user.type(width, '1024');
    expect(capture.current?.isValid).toBe(true);
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
        'Tale knows no vector width for local-embedding. Enter the model tag (or your deployment name) and the vector width that model produces.',
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
    expect(within(section).queryByText('Cannot embed')).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        'Tale knows no vector width for azure. Enter the model tag (or your deployment name) and the vector width that model produces.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the neutral hint when the catalog listing itself failed', async () => {
    // A failed listing leaves OpenAI without its catalog, so the row falls
    // back to the free field — but the curated width is only unread, not
    // unknown: the row must not claim Tale knows none.
    fixtures.credentials = [
      { id: 'cred-1', providerSlug: 'openai', name: 'API key' },
    ];
    fixtures.embeddingSupport = [
      { providerSlug: 'openai', support: 'supported' },
    ];
    fixtures.catalogsRead = 'failed';

    const { user } = renderWithController();

    const section = sectionByHeading('Embedding model');
    await user.click(
      within(section).getByRole('switch', { name: 'Embedding model' }),
    );
    await user.click(
      within(section).getByRole('combobox', { name: 'Provider' }),
    );
    await user.click(screen.getByRole('option', { name: 'openai' }));

    expect(
      within(section).getByRole('textbox', { name: 'Model' }),
    ).toBeInTheDocument();
    expect(
      within(section).queryByText(/Tale knows no vector width/),
    ).not.toBeInTheDocument();
    expect(
      within(section).getByText(
        'The model tag exactly as the provider spells it.',
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

    // A tag names one provider's model, so the pick starts over — and the
    // width with it: it is that model's, not the next one's.
    expect(
      within(section).getByRole('combobox', { name: 'Model' }),
    ).toHaveTextContent('Choose a model');
    expect(
      within(section).getByRole('spinbutton', { name: 'Vector width' }),
    ).toHaveValue(null);
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

    await checkAccessibility(container);
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

    await checkAccessibility(container);
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

  it('names what the bucket probe would refuse instead of sending it', async () => {
    // A region of spaces passed the form, was trimmed to nothing on the way
    // out and came back as a bare `invalid body` on the result line.
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    const { user } = render(<DataResidencySettings organizationId="org-1" />);
    const section = sectionByHeading('Object storage');

    const region = within(section).getByRole('textbox', { name: 'Region' });
    await user.clear(region);
    await user.type(region, '   ');
    await user.click(
      within(section).getByRole('button', { name: 'Test connection' }),
    );

    expect(
      await within(section).findByText("Enter the bucket's region."),
    ).toBeInTheDocument();
    expect(region).toHaveFocus();
    expect(testStorage).not.toHaveBeenCalled();
  });

  it('focuses the first refused field in page order on Test, as Save does', async () => {
    // The required checks were listed before the length caps, so a blank
    // Bucket took focus from the over-long Region above it.
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    const { user } = render(<DataResidencySettings organizationId="org-1" />);
    const section = sectionByHeading('Object storage');

    await user.clear(within(section).getByRole('textbox', { name: 'Bucket' }));
    const region = within(section).getByRole('textbox', { name: 'Region' });
    await user.clear(region);
    await user.click(region);
    await user.paste('r'.repeat(101));
    await user.click(
      within(section).getByRole('button', { name: 'Test connection' }),
    );

    expect(
      await within(section).findByText(
        'Region must be 100 characters or fewer',
      ),
    ).toBeInTheDocument();
    expect(
      within(section).getByText('Enter the bucket name.'),
    ).toBeInTheDocument();
    expect(region).toHaveFocus();
    expect(testStorage).not.toHaveBeenCalled();
  });

  it('names an over-long endpoint by its short name', async () => {
    setStorageFixture({
      configured: true,
      region: 'eu-central-1',
      forcePathStyle: true,
      bucket: 'org-blobs',
      hasCredentials: true,
    });
    const { user } = render(<DataResidencySettings organizationId="org-1" />);
    const section = sectionByHeading('Object storage');

    const endpoint = within(section).getByRole('textbox', {
      name: /^Endpoint/,
    });
    await user.click(endpoint);
    await user.paste(`https://minio.example.com/${'e'.repeat(2_000)}`);
    await user.click(
      within(section).getByRole('button', { name: 'Test connection' }),
    );

    expect(
      await within(section).findByText(
        'Endpoint must be 2000 characters or fewer',
      ),
    ).toBeInTheDocument();
    expect(testStorage).not.toHaveBeenCalled();
  });

  // Every capped storage field, by what the admin sees: a key added to the
  // door's caps without a row here (and a check in the form) fails below.
  const storageFieldCaps: Record<
    keyof typeof OBJECT_STORAGE_CONNECTION_MAX,
    { input: () => HTMLElement; label: string; value: (max: number) => string }
  > = {
    region: {
      input: () => screen.getByRole('textbox', { name: 'Region' }),
      label: 'Region',
      value: (max) => 'r'.repeat(max + 1),
    },
    endpoint: {
      input: () => screen.getByRole('textbox', { name: /^Endpoint/ }),
      label: 'Endpoint',
      value: (max) => `https://minio.example.com/${'e'.repeat(max)}`,
    },
    bucket: {
      input: () => screen.getByRole('textbox', { name: 'Bucket' }),
      label: 'Bucket',
      value: (max) => 'b'.repeat(max + 1),
    },
    prefix: {
      input: () => screen.getByRole('textbox', { name: 'Key prefix' }),
      label: 'Key prefix',
      value: (max) => 'p'.repeat(max + 1),
    },
    accessKeyId: {
      input: () => screen.getByRole('textbox', { name: 'Access key ID' }),
      label: 'Access key ID',
      value: (max) => 'k'.repeat(max + 1),
    },
    secretAccessKey: {
      input: () =>
        screen.getByLabelText('Secret access key', { selector: 'input' }),
      label: 'Secret access key',
      value: (max) => 's'.repeat(max + 1),
    },
  };

  it.each(
    Object.entries(OBJECT_STORAGE_CONNECTION_MAX) as [
      keyof typeof OBJECT_STORAGE_CONNECTION_MAX,
      number,
    ][],
  )(
    "holds the storage %s to the door's cap of %i before Save",
    async (field, max) => {
      setStorageFixture({
        configured: true,
        region: 'eu-central-1',
        forcePathStyle: false,
        bucket: 'org-blobs',
        hasCredentials: true,
      });
      const { user, capture } = renderWithController();
      const { input, label, value } = storageFieldCaps[field];

      const element = input();
      await user.clear(element);
      await user.click(element);
      await user.paste(value(max));
      await act(async () => {
        await expect(capture.current?.save()).rejects.toThrow(
          'VALIDATION_FAILED',
        );
      });

      expect(
        await screen.findByText(`${label} must be ${max} characters or fewer`),
      ).toBeInTheDocument();
      expect(element).toHaveAttribute('aria-invalid', 'true');
      expect(saveStorage).not.toHaveBeenCalled();
    },
  );

  it("holds the knowledge password to the door's cap before Save and Test", async () => {
    setKnowledgeFixture({
      configured: true,
      host: 'pg.acme.example',
      port: 5599,
      database: 'acme_rag',
      user: 'acme',
      sslmode: 'disable',
      hasPassword: true,
    });
    const { user, capture } = renderWithController();
    const section = sectionByHeading('Knowledge database');

    const password = within(section).getByLabelText('Password', {
      selector: 'input',
    });
    await user.click(password);
    await user.paste('p'.repeat(KNOWLEDGE_CONNECTION_PASSWORD_MAX + 1));
    await act(async () => {
      await expect(capture.current?.save()).rejects.toThrow(
        'VALIDATION_FAILED',
      );
    });
    expect(
      await within(section).findByText(
        `Password must be ${KNOWLEDGE_CONNECTION_PASSWORD_MAX} characters or fewer`,
      ),
    ).toBeInTheDocument();

    await user.click(
      within(section).getByRole('button', { name: 'Test connection' }),
    );
    expect(saveKnowledge).not.toHaveBeenCalled();
    expect(testKnowledge).not.toHaveBeenCalled();
  });

  it('keeps Save open for a storage edit after a Test on the untouched knowledge form', async () => {
    // The Test named the empty form's fields through `setError`, which marks
    // the (clean) knowledge form invalid; the group AND-ed every section's
    // validity, so the header Save locked on a storage edit the admin had
    // made — until Host was blurred.
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

    const knowledge = sectionByHeading('Knowledge database');
    await user.click(
      within(knowledge).getByRole('switch', { name: 'External Postgres' }),
    );
    await user.click(
      within(knowledge).getByRole('button', { name: 'Test connection' }),
    );
    expect(
      await within(knowledge).findByText('Enter the database host.'),
    ).toBeInTheDocument();
    expect(testKnowledge).not.toHaveBeenCalled();

    expect(capture.current?.isDirty).toBe(true);
    await waitFor(() => expect(capture.current?.isValid).toBe(true));
    await act(async () => {
      await capture.current?.save();
    });
    expect(saveStorage).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'org-blobs-eu' }),
    );
    expect(saveKnowledge).not.toHaveBeenCalled();
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
