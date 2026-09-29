/**
 * The dialog's reads through a real react-query client (#3752), with the
 * production retry rule: a first read that fails every attempt, Try again
 * that fails again (focus stays on it), then one that succeeds and shows the
 * saved skill — and a bundle file's read the same way — without reopening.
 *
 * A held answer stands in for a slow network, so the member can act while a
 * retry is pending (PR #3894 review): focus returns to Try again only when
 * removing it stranded focus, never away from a tree row they moved to, and
 * never for another file's read.
 */

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { SkillDetailPane } from './skill-detail-pane';

type Settled = 'outage' | 'ok';
/** An answer the test releases later, as either outcome. */
interface Held {
  readonly held: Promise<Settled>;
  readonly release: (to: Settled) => void;
}
type Answer = Settled | Held;

const server = vi.hoisted(() => ({
  detail: [] as Answer[],
  /** Per bundle path. */
  asset: {} as Record<string, Answer[]>,
  calls: { detail: 0, asset: 0 },
}));

function hold(): Held {
  let release: (to: Settled) => void = () => undefined;
  const held = new Promise<Settled>((resolve) => {
    release = resolve;
  });
  return { held, release: (to) => release(to) };
}

function answer(queue: Answer[], ok: () => unknown): Promise<unknown> {
  const next = queue.shift() ?? 'outage';
  if (typeof next === 'object') {
    return next.held.then((to) => answer([to], ok));
  }
  return next === 'ok'
    ? Promise.resolve(ok())
    : Promise.reject(new BackendApiError(503, 'Service Unavailable'));
}

const OUTAGE: Settled[] = ['outage', 'outage', 'outage', 'outage'];

const DOC = {
  slug: 'alpha',
  description: 'alpha description',
  labels: [],
  visibility: 'org',
  teams: [],
  body: 'Saved body',
  canEdit: true,
  origin: 'builtin',
  files: [
    { path: 'SKILL.md', size: 10 },
    { path: 'references/notes.txt', size: 16 },
    { path: 'references/other.txt', size: 16 },
  ],
};

vi.mock('../hooks/queries', async () => {
  const { useQuery: useRealQuery } = await import('@tanstack/react-query');
  // The production rule (`useActionQuery`): a fault retries three times.
  const retry = (count: number) => count < 3;
  return {
    useSkill: (_org: string, slug: string) =>
      useRealQuery({
        queryKey: ['skill', slug],
        queryFn: () => {
          server.calls.detail += 1;
          return answer(server.detail, () => DOC);
        },
        retry,
        retryDelay: 0,
        staleTime: Infinity,
      }),
    useSkillAsset: (_org: string, slug: string, path: string | null) =>
      useRealQuery({
        queryKey: ['skill', slug, 'asset', path],
        queryFn: () => {
          server.calls.asset += 1;
          server.asset[path ?? ''] ??= [];
          return answer(server.asset[path ?? ''], () => ({
            path,
            contentBase64: btoa('Reference notes\n'),
          }));
        },
        retry,
        retryDelay: 0,
        staleTime: Infinity,
        enabled: path !== null,
      }),
    useSkillPublishing: () => ({ mode: 'everyone', allowed: true }),
  };
});
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  isSkillPublishRefusal: () => false,
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [], isLoading: false }),
}));

// Keep the import the mock factory relies on in the module graph.
void useQuery;

function mount() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <SkillDetailPane
        organizationId="org_1"
        slug="alpha"
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server.detail = [];
  server.asset = {};
  server.calls = { detail: 0, asset: 0 };
  // The bundle tree remembers collapsed folders in this browser.
  localStorage.clear();
});

const tryAgain = () => screen.getByRole('button', { name: 'Try again' });

/** Let a settled answer's render and its effects run. */
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

/** The saved skill, then a first read of `references/notes.txt` that fails. */
async function failedNotes(user: ReturnType<typeof mount>['user']) {
  server.detail = ['ok'];
  server.asset['references/notes.txt'] = [...OUTAGE];
  await screen.findByDisplayValue('Saved body');
  await user.click(
    screen.getByRole('treeitem', { name: 'references/notes.txt' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't load this file.",
  );
}

/** Try again from the keyboard, its first attempt held. */
async function retryHeld(user: ReturnType<typeof mount>['user']) {
  const pending = hold();
  server.asset['references/notes.txt'] = [
    pending,
    'outage',
    'outage',
    'outage',
  ];
  tryAgain().focus();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument(),
  );
  return pending;
}

describe('skill dialog reads through react-query', () => {
  it('recovers a failed first read with Try again, keeping focus on it while it fails', async () => {
    server.detail = ['outage', 'outage', 'outage', 'outage'];
    const { user } = mount();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this skill.");
    expect(server.calls.detail).toBe(4);
    expect(screen.queryByText('Skill not found')).not.toBeInTheDocument();

    // A retry that fails again: the control comes back focused.
    server.detail = ['outage', 'outage', 'outage', 'outage'];
    screen.getByRole('button', { name: 'Try again' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(server.calls.detail).toBe(8));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus(),
    );

    // One that succeeds shows the saved skill, no reopening needed.
    server.detail = ['ok'];
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByDisplayValue('Saved body')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers a failed file read the same way', async () => {
    const { user } = mount();
    await failedNotes(user);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();

    server.asset['references/notes.txt'] = ['ok'];
    await user.click(tryAgain());
    expect(await screen.findByText('Reference notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it('puts focus back on Try again when a held file retry fails and nothing took focus', async () => {
    const { user } = mount();
    await failedNotes(user);
    const pending = await retryHeld(user);

    pending.release('outage');

    await waitFor(() => expect(tryAgain()).toHaveFocus());
  });

  it('leaves focus on the tree row the member moved to while the retry was held', async () => {
    const { user } = mount();
    await failedNotes(user);
    const pending = await retryHeld(user);
    const folder = screen.getByRole('treeitem', { name: 'references/' });
    await user.click(folder);
    expect(folder).toHaveFocus();

    pending.release('outage');

    await waitFor(() => expect(server.calls.asset).toBe(8));
    await waitFor(() => expect(tryAgain()).toBeInTheDocument());
    await settle();
    expect(folder).toBeInTheDocument();
    expect(folder).toHaveFocus();
  });

  it('never moves focus for another file the member opened while the retry was held', async () => {
    const { user } = mount();
    await failedNotes(user);
    const pending = await retryHeld(user);

    // Open the other file; its own first read fails.
    server.asset['references/other.txt'] = [...OUTAGE];
    const other = screen.getByRole('treeitem', {
      name: 'references/other.txt',
    });
    await user.click(other);
    await waitFor(() => expect(tryAgain()).toBeInTheDocument());
    await settle();
    expect(other).toHaveFocus();

    // The first file's held retry answers late.
    pending.release('outage');
    await settle();
    expect(other).toHaveFocus();
    expect(tryAgain()).not.toHaveFocus();
  });
});
