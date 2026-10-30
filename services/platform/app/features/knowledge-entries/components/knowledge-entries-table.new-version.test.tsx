import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen, waitFor, within } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { KnowledgeEntriesTable } from './knowledge-entries-table';

// #4860: a save gives a knowledge entry a new version id and keeps its
// document id (KENTRY-R3). The table keyed its rows by the version id, so
// when another member's save reached the list, the row was mounted afresh and
// the dialogs its menu held open went with it: an Edit lost its draft without
// a word. The read lane runs for real here — the paginated hook, the adapter
// row and react-query — against a closed synthetic transport, and the
// refresh is the one a live hint starts.

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
// The badge reads and retries indexing through its own doors.
vi.mock('@/app/features/documents/components/rag-status-badge', () => ({
  RagStatusBadge: () => null,
}));

const LIST = /^GET \/api\/app\/knowledge-entries\?limit=/;
const WRITE = /^(POST|DELETE) \/api\/app\/knowledge-entries\//;

/** The version Mia opens, as the door lists it. */
const OPENED = {
  id: 'entry-v1',
  topic: 'Support hours',
  content: 'Monday to Friday, 9 to 17.',
  source: 'manual',
  documentId: 'doc-1',
  createdBy: 'user-1',
  createdAt: 1789450000000,
};
/** Noah's correction: the entry's next version, same document. */
const CORRECTED = {
  ...OPENED,
  id: 'entry-v2',
  content: 'Monday to Friday, 8 to 18.',
  createdBy: 'user-2',
  createdAt: 1789450060000,
};
const DRAFT = 'Monday to Saturday, 9 to 17.';

let backend: SyntheticBackend;
let client: QueryClient;
let listed: (typeof OPENED)[];

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/knowledge-entries');
  backend = syntheticBackend();
  listed = [OPENED];
  backend.on(LIST, () => Response.json({ rows: listed, nextCursor: null }));
  backend.on(/\/knowledge-entries\/count/, () => Response.json({ count: 1 }));
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

function renderTable() {
  return render(
    <QueryClientProvider client={client}>
      <KnowledgeEntriesTable organizationId="org-1" />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'knowledgeEntries' });
const tCommon = (key: string) => i18n.t(key, { ns: 'common' });

/** Noah saves his correction elsewhere, and the list refreshes as a live
 * hint makes it: the entry's row now carries his version. */
async function noahSavesHisCorrection() {
  const reads = backend.count(LIST);
  listed = [CORRECTED];
  void client.invalidateQueries();
  await waitFor(() => expect(backend.count(LIST)).toBe(reads + 1));
  await screen.findByText(CORRECTED.content);
}

// These run the real read lane through a refresh, and two type a draft;
// they need more than the default five seconds on a loaded runner.
describe(
  'KnowledgeEntriesTable when another member saves an entry',
  { timeout: 30_000 },
  () => {
    it('keeps an Edit opened from the row menu, with its draft, and says a newer version was published', async () => {
      const { user } = renderTable();
      await user.click(
        await screen.findByRole('button', {
          name: tCommon('actions.openMenu'),
        }),
      );
      await user.click(
        screen.getByRole('menuitem', { name: tCommon('actions.edit') }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: t('editEntry'),
      });
      const content = within(dialog).getByLabelText(t('content'));
      await user.clear(content);
      await user.type(content, DRAFT);

      await noahSavesHisCorrection();

      // The same dialog, still holding Mia's text, now says what happened.
      expect(screen.getByRole('dialog', { name: t('editEntry') })).toBe(dialog);
      expect(within(dialog).getByLabelText(t('content'))).toHaveValue(DRAFT);
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        t('editDialog.newerVersion'),
      );

      // Closing still asks before the draft is discarded.
      const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      await user.click(
        within(dialog).getByRole('button', { name: tCommon('actions.cancel') }),
      );
      expect(confirm).toHaveBeenCalledWith(tCommon('discardChangesConfirm'));
      expect(screen.getByRole('dialog', { name: t('editEntry') })).toBe(dialog);

      // The draft replaces the version listed now, never the one Mia opened.
      const SAVE = /^POST \/api\/app\/knowledge-entries\/entry-v2\?/;
      let sent: unknown;
      backend.on(SAVE, (_url, init) => {
        sent =
          typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        return Response.json({ id: 'entry-v3' });
      });
      await user.click(
        within(dialog).getByRole('button', { name: tCommon('actions.save') }),
      );
      await waitFor(() => expect(backend.count(SAVE)).toBe(1));
      expect(sent).toEqual({ topic: OPENED.topic, content: DRAFT });
      expect(backend.count(WRITE)).toBe(1);
    });

    it('keeps an Edit opened from the details of the row menu, with its draft', async () => {
      backend.on(/\/versions\?/, () => Response.json({ versions: [] }));
      const { user } = renderTable();
      await user.click(
        await screen.findByRole('button', {
          name: tCommon('actions.openMenu'),
        }),
      );
      await user.click(
        screen.getByRole('menuitem', { name: tCommon('actions.view') }),
      );
      const details = await screen.findByRole('dialog');
      await user.click(
        within(details).getByRole('button', { name: tCommon('actions.edit') }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: t('editEntry'),
      });
      const content = within(dialog).getByLabelText(t('content'));
      await user.clear(content);
      await user.type(content, DRAFT);

      await noahSavesHisCorrection();

      expect(screen.getByRole('dialog', { name: t('editEntry') })).toBe(dialog);
      expect(within(dialog).getByLabelText(t('content'))).toHaveValue(DRAFT);
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        t('editDialog.newerVersion'),
      );
    });

    it('keeps a selected entry selected, and Delete selected deletes the version listed now', async () => {
      const { user } = renderTable();
      await user.click(
        await screen.findByRole('checkbox', {
          name: tCommon('aria.selectRow'),
        }),
      );

      await noahSavesHisCorrection();

      expect(
        screen.getByRole('checkbox', { name: tCommon('aria.selectRow') }),
      ).toBeChecked();
      backend.on(WRITE, () => Response.json({ ok: true }));
      await user.click(
        screen.getByRole('button', { name: tCommon('actions.deleteSelected') }),
      );
      const dialog = await screen.findByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', { name: tCommon('actions.delete') }),
      );
      // The id of the version Noah replaced would delete that version alone
      // and leave the entry standing (KENTRY-R7).
      await waitFor(() => expect(backend.count(WRITE)).toBe(1));
      expect(backend.calls).toContain(
        'DELETE /api/app/knowledge-entries/entry-v2?orgId=org-1',
      );
    });

    it('names an entry whose delete was refused by its topic', async () => {
      // The write hook logs the refusal; the bar is what reports it.
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { user } = renderTable();
      await user.click(
        await screen.findByRole('checkbox', {
          name: tCommon('aria.selectRow'),
        }),
      );
      backend.on(WRITE, () =>
        Response.json(
          { error: 'Not allowed', code: 'FORBIDDEN' },
          { status: 403 },
        ),
      );
      await user.click(
        screen.getByRole('button', { name: tCommon('actions.deleteSelected') }),
      );
      const dialog = await screen.findByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', { name: tCommon('actions.delete') }),
      );

      expect(await within(dialog).findByRole('listitem')).toHaveTextContent(
        OPENED.topic,
      );
      expect(backend.calls).toContain(
        'DELETE /api/app/knowledge-entries/entry-v1?orgId=org-1',
      );
    });
  },
);
