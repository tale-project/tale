import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { projectCapabilityCatalogKey } from '@/app/lib/backend/query-keys';
import {
  HINT_BATCH_MS,
  useBackendHints,
} from '@/app/lib/backend/use-backend-hints';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { useUpdateProjectSharing } from '../hooks/mutations';
import { useProjectCapabilityCatalog } from '../hooks/queries';
import { ProjectAgentCreateDialog } from './project-agent-create-dialog';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
}));
vi.mock('@/app/hooks/use-session-probe', () => ({
  useSessionProbeSignedIn: () => true,
}));
vi.mock('./agent-secrets-field', () => ({ AgentSecretsField: () => null }));
vi.mock('../hooks/use-unpinned-serving-preview', () => ({
  useUnpinnedServingPreview: () => ({ data: undefined }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

/** Fixture stream: each session's actual hint listener opens its own. */
class FixtureEventSource extends EventTarget {
  static sources: FixtureEventSource[] = [];
  readyState = 1;
  constructor(readonly url: string) {
    super();
    FixtureEventSource.sources.push(this);
  }
  close() {}
  emit(type: string, data: object = {}) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

const KEY = projectCapabilityCatalogKey('org-1', 'p-1');
const SKILL = /Synthetic team skill/;
let audience: string[] = [];
let save: ReturnType<typeof useUpdateProjectSharing>['mutateAsync'];
const clients: QueryClient[] = [];

/** Session A: the administrator saving Audience on General — the actual
 * sharing write with its adapter, and this session's own catalog read. */
function WriterSession() {
  useBackendHints('org-1');
  useProjectCapabilityCatalog('org-1', 'p-1');
  const { mutateAsync } = useUpdateProjectSharing();
  useEffect(() => {
    save = mutateAsync;
  }, [mutateAsync]);
  return null;
}

/** Session B: another member with New agent open. */
function PickerSession() {
  useBackendHints('org-1');
  return (
    <ProjectAgentCreateDialog
      open
      projectId="p-1"
      organizationId="org-1"
      onOpenChange={() => {}}
    />
  );
}

function session(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const stream = FixtureEventSource.sources.length;
  const view = render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  );
  const source = FixtureEventSource.sources[stream];
  if (source === undefined) throw new Error('Expected a hint stream');
  return { client, view, source };
}

const answers = (client: QueryClient) =>
  client.getQueryState(KEY)?.dataUpdateCount ?? 0;

async function deliverProjectHint(source: FixtureEventSource) {
  act(() => source.emit('hint', { entity: 'project', entityId: 'p-1' }));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, HINT_BATCH_MS + 10));
  });
}

beforeEach(() => {
  audience = [];
  FixtureEventSource.sources = [];
  window.history.replaceState({}, '', '/dashboard/org-1/projects/p-1');
  window.__ENV__ = {};
  vi.stubGlobal('EventSource', FixtureEventSource);
  vi.spyOn(window, 'fetch').mockImplementation(async (input, options) => {
    const url = new URL(
      input instanceof Request ? input.url : input,
      window.location.origin,
    );
    let body: unknown;
    if (url.pathname.endsWith('/project/p-1/capabilities')) {
      body = {
        skills: audience.includes('team-1')
          ? [
              {
                slug: 'synthetic-team-skill',
                label: 'Synthetic team skill',
                origin: 'member',
              },
            ]
          : [],
        connectors: [],
      };
    } else if (url.pathname.endsWith('/projects/p-1/sharing')) {
      expect(options?.method).toBe('POST');
      if (typeof options?.body !== 'string')
        throw new Error('Expected JSON body');
      const parsed: unknown = JSON.parse(options.body);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        !('teamIds' in parsed) ||
        !Array.isArray(parsed.teamIds)
      )
        throw new Error('Expected teamIds');
      audience = parsed.teamIds.map(String);
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
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.__ENV__;
});

describe('project capability catalog across sessions', () => {
  it("updates another session's open Skills menu when the audience hint arrives, both ways", async () => {
    const picker = session(<PickerSession />);
    await waitFor(() => expect(answers(picker.client)).toBe(1));
    await picker.view.user.click(
      screen.getByRole('button', { name: /skills/i }),
    );
    const menu = await screen.findByRole('menu');
    expect(screen.queryByRole('menuitemcheckbox', { name: SKILL })).toBeNull();

    const writer = session(<WriterSession />);
    await waitFor(() => expect(answers(writer.client)).toBe(1));
    await act(async () => {
      await save({ projectId: 'p-1', teamIds: ['team-1'] });
    });
    // The writer's own write refreshes its catalog at once; the other
    // session has no local signal and keeps its answer until the server's
    // hint reaches its stream.
    await waitFor(() => expect(answers(writer.client)).toBe(2));
    expect(answers(picker.client)).toBe(1);
    expect(screen.queryByRole('menuitemcheckbox', { name: SKILL })).toBeNull();

    await deliverProjectHint(picker.source);
    expect(
      await screen.findByRole('menuitemcheckbox', { name: SKILL }),
    ).toBeInTheDocument();
    expect(menu).toBeInTheDocument();
    expect(answers(picker.client)).toBe(2);

    // The team leaves the audience: the still-open menu drops its skill.
    await act(async () => {
      await save({ projectId: 'p-1', teamIds: [] });
    });
    await waitFor(() => expect(answers(writer.client)).toBe(3));
    await deliverProjectHint(picker.source);
    await waitFor(() =>
      expect(
        screen.queryByRole('menuitemcheckbox', { name: SKILL }),
      ).toBeNull(),
    );
    expect(menu).toBeInTheDocument();
    expect(answers(picker.client)).toBe(3);
  });

  it('ignores a hint for another project, then refreshes the reopened menu once its own hint arrives', async () => {
    const picker = session(<PickerSession />);
    await waitFor(() => expect(answers(picker.client)).toBe(1));
    audience = ['team-1'];
    act(() =>
      picker.source.emit('hint', { entity: 'project', entityId: 'p-other' }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, HINT_BATCH_MS + 10));
    });
    expect(answers(picker.client)).toBe(1);
    expect(picker.client.getQueryState(KEY)?.isInvalidated).toBe(false);

    await deliverProjectHint(picker.source);
    await waitFor(() => expect(answers(picker.client)).toBe(2));
    await picker.view.user.click(
      screen.getByRole('button', { name: /skills/i }),
    );
    expect(
      await screen.findByRole('menuitemcheckbox', { name: SKILL }),
    ).toBeInTheDocument();
  });
});
