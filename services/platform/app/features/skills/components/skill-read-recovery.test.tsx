/**
 * The dialog's reads through a real react-query client (#3752), with the
 * production retry rule: a first read that fails every attempt, Try again
 * that fails again (focus stays on it), then one that succeeds and shows the
 * saved skill — and a bundle file's read the same way — without reopening.
 */

import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SkillDetailPane } from './skill-detail-pane';

type Answer = 'outage' | 'ok';

const server = vi.hoisted(() => ({
  detail: [] as Answer[],
  asset: [] as Answer[],
  calls: { detail: 0, asset: 0 },
}));

function answer(queue: Answer[], ok: () => unknown) {
  const next = queue.shift() ?? 'outage';
  return next === 'ok'
    ? Promise.resolve(ok())
    : Promise.reject(new BackendApiError(503, 'Service Unavailable'));
}

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
          return answer(server.asset, () => ({
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
  server.asset = [];
  server.calls = { detail: 0, asset: 0 };
});

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
    server.detail = ['ok'];
    const { user } = mount();
    await screen.findByDisplayValue('Saved body');

    server.asset = ['outage', 'outage', 'outage', 'outage'];
    await user.click(
      screen.getByRole('treeitem', { name: 'references/notes.txt' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load this file.",
    );
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();

    server.asset = ['ok'];
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Reference notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
  });
});
