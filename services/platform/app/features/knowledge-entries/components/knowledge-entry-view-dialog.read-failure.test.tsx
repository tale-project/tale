import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { KnowledgeEntryItem } from '../hooks/queries';
import { KnowledgeEntryViewDialog } from './knowledge-entry-view-dialog';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3777: an entry whose version history failed to load showed no history at
// all — the same as an entry never edited. The history read runs for real
// here (hook, adapter row, `backendFetch`, the four-attempt retry policy)
// against a closed synthetic transport.

vi.mock('@/app/hooks/use-session-user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-session-user')>()),
  useSessionUser: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/features/documents/components/rag-status-badge', () => ({
  RagStatusBadge: () => null,
}));

const versionsOf = (id: string) =>
  new RegExp(`^GET /api/app/knowledge-entries/${id}/versions\\?orgId=org-1$`);

function entry(id: string, topic: string, content: string): KnowledgeEntryItem {
  return {
    _id: id as never,
    _creationTime: 1789455000000,
    organizationId: 'org-1',
    topic,
    topicKey: topic.toLowerCase(),
    content,
    status: 'active',
    source: 'manual',
    createdBy: 'user-1',
    createdAt: 1789455000000,
    ragStatus: 'not_indexed',
  };
}

const CURRENT = entry(
  'entry-v2',
  'Support hours',
  'Support answers 8–6 on weekdays.',
);
const OTHER = entry('entry-other', 'Refunds', 'Refunds take five days.');

/** The door's chain for `CURRENT`: itself, then the version it replaced. */
const CHAIN = {
  versions: [
    {
      id: 'entry-v2',
      topic: 'Support hours',
      content: 'Support answers 8–6 on weekdays.',
      status: 'active',
      source: 'manual',
      documentId: 'doc-1',
      createdBy: 'user-1',
      createdAt: 1789455000000,
      supersededBy: null,
      supersededAt: null,
    },
    {
      id: 'entry-v1',
      topic: 'Support hours',
      content: 'Support answers 9–5 on weekdays.',
      status: 'superseded',
      source: 'manual',
      documentId: 'doc-1',
      createdBy: 'user-1',
      createdAt: 1789450000000,
      supersededBy: 'entry-v2',
      supersededAt: 1789455000000,
    },
  ],
};
/** An entry never edited: its chain is itself alone. */
const SINGLE = {
  versions: [
    {
      ...CHAIN.versions[0],
      id: 'entry-other',
      topic: 'Refunds',
      content: 'Refunds take five days.',
    },
  ],
};

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/knowledge-entries');
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderDialog(shown: KnowledgeEntryItem) {
  const view = (current: KnowledgeEntryItem) => (
    <QueryClientProvider client={client}>
      <KnowledgeEntryViewDialog isOpen onClose={vi.fn()} entry={current} />
    </QueryClientProvider>
  );
  const rendered = render(view(shown));
  return {
    ...rendered,
    show: (next: KnowledgeEntryItem) => rendered.rerender(view(next)),
  };
}

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'knowledgeEntries', ...options });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const history = () =>
  screen.getByRole('region', { name: t('viewDialog.history') });

describe(
  'KnowledgeEntryViewDialog when the version history read fails',
  { timeout: 30_000 },
  () => {
    it('lists the version a two-version chain replaced', async () => {
      backend.on(versionsOf('entry-v2'), () => Response.json(CHAIN));
      renderDialog(CURRENT);

      expect(
        await within(history()).findByText(
          t('viewDialog.versionCount', { count: 1 }),
        ),
      ).toBeInTheDocument();
      expect(
        within(history()).getByText(t('viewDialog.superseded')),
      ).toBeVisible();
    });

    it('says so when the history cannot load, keeps the entry, and recovers on Retry', async () => {
      backend.on(versionsOf('entry-v2'), () => serviceUnavailable());
      const { user } = renderDialog(CURRENT);

      const alert = await within(history()).findByRole('alert');
      expect(alert).toHaveTextContent(t('viewDialog.historyLoadFailed'));
      expect(backend.count(versionsOf('entry-v2'))).toBe(4);
      // Unavailable is not "never edited", and the current version stays.
      expect(
        within(history()).queryByText(t('viewDialog.historyEmpty')),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText('Support answers 8–6 on weekdays.'),
      ).toBeVisible();
      // The failed read shows no toast; the section says it.
      expect(document.querySelector('li[data-swipe-direction]')).toBeNull();

      backend.on(versionsOf('entry-v2'), () => Response.json(CHAIN));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      expect(
        await within(history()).findByText(
          t('viewDialog.versionCount', { count: 1 }),
        ),
      ).toBeInTheDocument();
      expect(within(history()).queryByRole('alert')).not.toBeInTheDocument();
      // Retry kept focus inside the dialog, on the section it restored.
      expect(history()).toHaveFocus();
    });

    it('says an entry that was never edited has no earlier versions', async () => {
      backend.on(versionsOf('entry-other'), () => Response.json(SINGLE));
      renderDialog(OTHER);

      expect(
        await within(history()).findByText(t('viewDialog.historyEmpty')),
      ).toBeInTheDocument();
      expect(within(history()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says the history is loading while the first read is in flight', async () => {
      backend.on(versionsOf('entry-v2'), () => new Promise<Response>(() => {}));
      renderDialog(CURRENT);

      expect(within(history()).getByRole('status')).toHaveTextContent(
        t('viewDialog.historyLoading'),
      );
    });

    it('keeps loaded versions through a failed refresh, with a retry', async () => {
      backend.on(versionsOf('entry-v2'), () => Response.json(CHAIN));
      const { user } = renderDialog(CURRENT);
      await within(history()).findByText(
        t('viewDialog.versionCount', { count: 1 }),
      );

      backend.on(versionsOf('entry-v2'), () => serviceUnavailable());
      void client.invalidateQueries();
      const alert = await within(history()).findByRole('alert');
      expect(alert).toHaveTextContent(t('viewDialog.historyRefreshFailed'));
      expect(
        within(history()).getByText(t('viewDialog.superseded')),
      ).toBeVisible();

      backend.on(versionsOf('entry-v2'), () => Response.json(CHAIN));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() =>
        expect(within(history()).queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(
        within(history()).getByText(t('viewDialog.superseded')),
      ).toBeVisible();
    });

    it("keeps a retry's answer to its own entry when the dialog moves on", async () => {
      backend.on(versionsOf('entry-v2'), () => serviceUnavailable());
      backend.on(versionsOf('entry-other'), () => Response.json(SINGLE));
      const { user, show } = renderDialog(CURRENT);
      const alert = await within(history()).findByRole('alert');

      // The retry is still in flight when the dialog shows another entry.
      let answer: (response: Response) => void = () => {};
      backend.on(
        versionsOf('entry-v2'),
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      show(OTHER);
      expect(
        await within(history()).findByText(t('viewDialog.historyEmpty')),
      ).toBeInTheDocument();

      answer(Response.json(CHAIN));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        within(history()).getByText(t('viewDialog.historyEmpty')),
      ).toBeVisible();
      expect(
        within(history()).queryByText(t('viewDialog.superseded')),
      ).not.toBeInTheDocument();
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed history and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(versionsOf('entry-v2'), () => serviceUnavailable());
        renderDialog(CURRENT);

        const alert = await within(history()).findByRole('alert');
        expect(alert).toHaveTextContent(t('viewDialog.historyLoadFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        expect(t('viewDialog.historyLoadFailed')).not.toBe(
          'viewDialog.historyLoadFailed',
        );
      });
    });
  },
);
