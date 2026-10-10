import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileEvents } from '@/app/hooks/use-file-events';
import { libraryWriteAdapters } from '@/app/lib/backend/library';
import { projectCapabilityCatalogKey } from '@/app/lib/backend/query-keys';
import { settingsWriteAdapters } from '@/app/lib/backend/settings';
import {
  HINT_BATCH_MS,
  useBackendHints,
} from '@/app/lib/backend/use-backend-hints';
import { act, render, screen, waitFor, within } from '@/tests/utils/render';

import { useProjectCapabilityCatalog } from '../hooks/queries';
import { ProjectAgentCreateDialog } from './project-agent-create-dialog';
import { ProjectSharingSection } from './project-sharing-section';
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
}));
vi.mock('@/app/hooks/use-session-probe', () => ({
  useSessionProbeSignedIn: () => true,
}));
vi.mock('@/app/features/organization/hooks/queries', () => ({
  useUserOrganizationsWithDetails: () => ({
    organizations: [{ slug: 'synthetic', organizationId: 'org-1' }],
  }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({
    teams: [{ id: 'team-1', name: 'Synthetic team' }],
    isLoading: false,
  }),
  useTeamNames: () => ({ nameOf: () => 'Synthetic team' }),
}));
vi.mock('./agent-secrets-field', () => ({ AgentSecretsField: () => null }));
vi.mock('../hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: undefined }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
/** Fixture transport; actual hint listeners, hooks, adapters and components run. */
class FixtureEventSource extends EventTarget {
  static sources: FixtureEventSource[] = [];
  constructor(readonly url: string) {
    super();
    FixtureEventSource.sources.push(this);
  }
  close() {}
  emit(type: string, data: object = {}) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
let client: QueryClient;
let teamVisible = false;
const reads = new Map<string, number>();
const skill = {
  slug: 'synthetic-team-skill',
  label: 'Synthetic team skill',
  origin: 'member',
};
function Harness() {
  useBackendHints('org-1');
  useFileEvents();
  useProjectCapabilityCatalog('org-1', 'p-other');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>New agent</button>
      <ProjectSharingSection
        projectId="p-1"
        organizationId="org-1"
        teamIds={[]}
        canAdminister
      />
      {open && (
        <ProjectAgentCreateDialog
          open
          projectId="p-1"
          organizationId="org-1"
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  reads.clear();
  teamVisible = false;
  FixtureEventSource.sources = [];
  window.history.replaceState({}, '', '/dashboard/org-1/projects/p-1');
  window.__ENV__ = { FILE_EVENTS_ENABLED: true };
  vi.stubGlobal('EventSource', FixtureEventSource);
  vi.spyOn(window, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      window.location.origin,
    );
    const match = /\/project\/([^/]+)\/capabilities$/.exec(url.pathname);
    let body: unknown;
    if (match) {
      const id = match[1] ?? '';
      reads.set(id, (reads.get(id) ?? 0) + 1);
      body = {
        skills: id === 'p-1' && teamVisible ? [skill] : [],
        connectors: [],
      };
    } else if (url.pathname.endsWith('/projects/p-1/sharing')) {
      expect(options?.method).toBe('POST');
      if (typeof options?.body !== 'string')
        throw new Error('Expected JSON body');
      expect(JSON.parse(options.body)).toEqual({
        teamIds: ['team-1'],
      });
      teamVisible = true;
      body = {};
    } else if (url.pathname.endsWith('/chat/composer/models')) {
      body = {
        harnesses: [{ harness: 'claude-code', label: 'Claude Code' }],
        models: [],
      };
    } else {
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
});
afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__ENV__;
});
async function warmPicker() {
  client.setQueryData(projectCapabilityCatalogKey('org-other', 'p-1'), {
    skills: [],
    connectors: [],
  });
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  await view.user.click(screen.getByRole('button', { name: 'New agent' }));
  await waitFor(() => expect(reads.get('p-1')).toBe(1));
  await view.user.click(screen.getByRole('button', { name: /skills/i }));
  expect(
    screen.queryByRole('menuitemcheckbox', { name: /Synthetic team skill/ }),
  ).toBeNull();
  await view.user.keyboard('{Escape}');
  await view.user.click(screen.getByRole('button', { name: 'Cancel' }));
  return view;
}
async function reopen(view: Awaited<ReturnType<typeof warmPicker>>) {
  await view.user.click(screen.getByRole('button', { name: 'New agent' }));
  await view.user.click(screen.getByRole('button', { name: /skills/i }));
  expect(
    await screen.findByRole('menuitemcheckbox', {
      name: /Synthetic team skill/,
    }),
  ).toBeInTheDocument();
  expect(reads.get('p-1')).toBe(2);
  expect(
    client.getQueryState(projectCapabilityCatalogKey('org-other', 'p-1'))
      ?.isInvalidated,
  ).toBe(false);
}
async function invalidated() {
  await waitFor(() =>
    expect(
      client.getQueryState(projectCapabilityCatalogKey('org-1', 'p-1'))
        ?.isInvalidated,
    ).toBe(true),
  );
}
describe('project capability catalog invalidation', () => {
  it('shows the new team skill after saving Audience and reopening New agent', async () => {
    const view = await warmPicker();
    await view.user.click(screen.getByRole('combobox', { name: 'Audience' }));
    await view.user.click(
      await screen.findByRole('option', { name: 'Synthetic team' }),
    );
    await view.user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Confirm',
      }),
    );
    await invalidated();
    await view.user.keyboard('{Escape}');
    await reopen(view);
    expect(reads.get('p-other')).toBe(1);
  });
  it('refreshes the hinted project and leaves another project cached', async () => {
    const view = await warmPicker();
    teamVisible = true;
    act(() =>
      FixtureEventSource.sources
        .find((s) => s.url !== '/events/file')
        ?.emit('hint', { entity: 'project', entityId: 'p-1' }),
    );
    await invalidated();
    await reopen(view);
    expect(reads.get('p-other')).toBe(1);
  });
  it.each(['resync', 'connector_credential'])(
    'refreshes catalogs after %s',
    async (kind) => {
      const view = await warmPicker();
      teamVisible = true;
      act(() =>
        FixtureEventSource.sources
          .find((s) => s.url !== '/events/file')
          ?.emit(kind === 'resync' ? 'resync' : 'hint', { entity: kind }),
      );
      await invalidated();
      await reopen(view);
      expect(reads.get('p-other')).toBe(2);
    },
  );
  it.each(['skills', 'connectors'])(
    'refreshes catalogs when %s files change',
    async (type) => {
      const view = await warmPicker();
      teamVisible = true;
      act(() =>
        FixtureEventSource.sources
          .find((s) => s.url === '/events/file')
          ?.emit('message', { type, orgSlug: 'synthetic' }),
      );
      await invalidated();
      await reopen(view);
      expect(reads.get('p-other')).toBe(2);
    },
  );
  it('coalesces distinct skill and connector events across tasks into one catalog refetch', async () => {
    const view = await warmPicker();
    teamVisible = true;
    const source = FixtureEventSource.sources.find(
      (s) => s.url === '/events/file',
    );
    expect(source).toBeDefined();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 100; i += 1) {
        act(() =>
          source?.emit('message', {
            type: i % 2 === 0 ? 'skills' : 'connectors',
            orgSlug: 'synthetic',
            slug: `skill-${i}`,
          }),
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      }
      expect(reads.get('p-other')).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
      });
      expect(reads.get('p-other')).toBe(2);
      expect(
        invalidate.mock.calls.filter(
          ([filters]) =>
            JSON.stringify(filters?.queryKey) ===
            JSON.stringify(projectCapabilityCatalogKey('org-1')),
        ),
      ).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
      });
      expect(reads.get('p-other')).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    await reopen(view);
  });
  it('cancels queued catalog invalidations on unmount', async () => {
    const view = await warmPicker();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.useFakeTimers();
    try {
      act(() =>
        FixtureEventSource.sources
          .find((s) => s.url === '/events/file')
          ?.emit('message', { type: 'skills', orgSlug: 'synthetic' }),
      );
      view.unmount();
      await vi.advanceTimersByTimeAsync(HINT_BATCH_MS);
      expect(
        invalidate.mock.calls.filter(
          ([filters]) =>
            JSON.stringify(filters?.queryKey) ===
            JSON.stringify(projectCapabilityCatalogKey('org-1')),
        ),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('ignores catalog file events for an unrelated org', async () => {
    await warmPicker();
    act(() =>
      FixtureEventSource.sources
        .find((s) => s.url === '/events/file')
        ?.emit('message', { type: 'skills', orgSlug: 'other' }),
    );
    expect(
      client.getQueryState(projectCapabilityCatalogKey('org-1', 'p-1'))
        ?.isInvalidated,
    ).toBe(false);
    expect(reads.get('p-other')).toBe(1);
  });
  it.each(['saveSkill', 'deleteSkill', 'uploadSkillBundle'])(
    'refreshes catalogs after %s',
    async (name) => {
      const view = await warmPicker();
      teamVisible = true;
      act(() =>
        libraryWriteAdapters[`skills/actions:${name}`]?.invalidate?.(
          client,
          { organizationId: 'org-1' },
          {},
        ),
      );
      await reopen(view);
    },
  );
  it('refreshes capabilities after a local connector credential write', async () => {
    const view = await warmPicker();
    teamVisible = true;
    act(() =>
      settingsWriteAdapters[
        'connector_credentials/actions:createCredential'
      ]?.invalidate?.(client, { organizationId: 'org-1' }, {}),
    );
    await reopen(view);
  });
});
