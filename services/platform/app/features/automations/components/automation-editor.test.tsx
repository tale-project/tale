import { ActiveEditorProvider } from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen, waitFor, within } from '@/tests/utils/render';

import { AutomationVersionPicker } from './automation-version-picker';
import { AutomationVersionPickerTarget } from './automation-version-picker-target';

/**
 * The automation page is an editor: its draft lives in the browser and a save
 * APPENDS a version, so these tests hold it to the unified editor contract —
 * editing arms the shared Save/Discard cluster, discarding restores the stored
 * version, and nothing is written until the save-version dialog is confirmed.
 * Backing out of that dialog is a deliberate no-op, which is why the "no toast,
 * draft intact" case is pinned here: a cancelled save that reported a failure
 * would teach authors to distrust the cluster.
 */

const {
  state,
  projectsData,
  runsData,
  saveMutation,
  startRun,
  deploy,
  toastSpy,
  refetch,
  validationMock,
  invalidateValidation,
} = vi.hoisted(() => ({
  state: {
    document: {
      name: 'billing/dunning',
      description: 'Chases unpaid invoices.',
      nodes: [{ id: 'summary', type: 'llm', prompt: 'One sentence, please.' }],
    } as unknown,
    /** The pack manifest's display half, when the test wants one. */
    presentation: undefined as unknown,
    settings: undefined as unknown,
    taskContract: undefined as unknown,
    deployedDocument: undefined as unknown,
    version: 3,
    deployedVersion: 2 as number | undefined,
    /** Agent nodes of the DEPLOYED version without a provider pin. */
    deployedUnpinnedAgentNodes: undefined as string[] | undefined,
    /** A `?version=` the read refuses with `AUTOMATION_VERSION_UNKNOWN`. */
    missingVersion: undefined as number | undefined,
    detailError: undefined as Error | undefined,
    deployedDetailError: undefined as Error | undefined,
    realDetailRead: false,
  },
  /** The org's projects and the automation's bindings — the run-scope picker
   * appears only when two or more projects are bound. */
  projectsData: {
    list: [] as Array<{ _id: string; name: string }>,
    bound: [] as string[],
  },
  /** Newest-first run log. Empty unless a test is pinning last-run chrome. */
  runsData: [] as Array<{
    id: string;
    name: string;
    version: number;
    status: string;
    mode: string;
    startedBy: string;
    startedAt: number;
    checkpoints?: unknown;
  }>,
  saveMutation: { mutateAsync: vi.fn(), isPending: false },
  startRun: { mutate: vi.fn(), isPending: false },
  deploy: { mutate: vi.fn(), isPending: false, variables: undefined },
  toastSpy: vi.fn(),
  refetch: vi.fn(),
  /** What the draft check answers. Arrays are set whole per test, so their
   * identity is stable across renders the way a settled query's is. */
  validationMock: {
    status: 'ready' as 'idle' | 'checking' | 'ready' | 'failed',
    errors: [] as Array<Record<string, unknown> & { id: string }>,
    warnings: [] as Array<Record<string, unknown> & { id: string }>,
    calls: [] as Array<{
      document: unknown;
      isDraft: boolean;
      enabled: boolean;
    }>,
    /** The developer capability; a member's editor checks nothing. */
    canAuthor: true,
  },
  invalidateValidation: vi.fn(),
}));

// The draft check is a server round trip; the page's handling of its answer
// is what these tests hold, so the hook answers from `validationMock`.
vi.mock('../hooks/use-automation-validation', () => ({
  useAutomationValidation: ({
    document,
    isDraft,
    enabled,
  }: {
    document: unknown;
    isDraft: boolean;
    enabled: boolean;
  }) => {
    validationMock.calls.push({ document, isDraft, enabled });
    const currentHash = document === null ? null : JSON.stringify(document);
    if (!enabled || currentHash === null) {
      return {
        status: 'idle',
        errors: [],
        warnings: [],
        settledFor: null,
        currentHash,
      };
    }
    return {
      status: validationMock.status,
      errors: validationMock.errors,
      warnings: validationMock.warnings,
      settledFor:
        validationMock.status === 'ready' ? currentHash : 'an older draft',
      currentHash,
    };
  },
  useInvalidateAutomationValidation: () => invalidateValidation,
  VALIDATION_DEBOUNCE_MS: 400,
}));

// `EditorActions` owns every piece of save feedback and reaches for the
// module-level toast to do it.
vi.mock('@tale/ui/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy }),
}));

// The page hides its authoring surface (inspector edits, the save cluster,
// live runs) from members; these tests exercise that surface, so they run
// with the developer capability granted.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => validationMock.canAuthor,
    cannot: () => !validationMock.canAuthor,
  }),
  useAbilityLoading: () => false,
}));

// The run-scope picker resolves project names through this hook; each test
// sets the roster it needs on `projectsData`.
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: projectsData.list, isLoading: false }),
  // The llm node's Model picker reads the served-model roster; the editor
  // tests select llm nodes but never pick a model.
  useProjectHarnesses: () => ({ data: { harnesses: [], models: [] } }),
}));

vi.mock('../hooks/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/queries')>();
  return {
    useAutomation: (
      _organizationId: string,
      _name: string,
      version?: number,
    ) =>
      state.realDetailRead
        ? actual.useAutomation(_organizationId, _name, version)
        : version === undefined && state.detailError !== undefined
          ? {
              data: undefined,
              isPending: false,
              isError: true,
              error: state.detailError,
              isFetching: false,
              errorUpdateCount: 1,
              refetch,
            }
          : version !== undefined && state.deployedDetailError !== undefined
            ? {
                data: undefined,
                isPending: false,
                isError: true,
                error: state.deployedDetailError,
                isFetching: false,
                errorUpdateCount: 1,
                refetch,
              }
            : version !== undefined && version === state.missingVersion
              ? {
                  data: undefined,
                  isPending: false,
                  isError: true,
                  isFetching: false,
                  errorUpdateCount: 1,
                  error: {
                    data: {
                      code: 'AUTOMATION_VERSION_UNKNOWN',
                      message: `version ${version} does not exist`,
                      latestVersion: state.version,
                    },
                  },
                  refetch,
                }
              : {
                  data: {
                    document:
                      version === state.deployedVersion &&
                      state.deployedDocument !== undefined
                        ? state.deployedDocument
                        : state.document,
                    version: version ?? state.version,
                    deployedVersion: state.deployedVersion,
                    ...(state.presentation !== undefined
                      ? { presentation: state.presentation }
                      : {}),
                    settings: state.settings,
                    taskContract: state.taskContract,
                    ...(state.deployedUnpinnedAgentNodes !== undefined
                      ? {
                          deployedUnpinnedAgentNodes:
                            state.deployedUnpinnedAgentNodes,
                        }
                      : {}),
                  },
                  isPending: false,
                  isError: false,
                  isFetching: false,
                  errorUpdateCount: 0,
                  error: null,
                  refetch,
                },
    useAutomationVersions: () => ({
      data: [
        {
          version: 3,
          message: 'tightened the prompt',
          createdBy: 'user:a',
          createdAt: 1_700_000_100_000,
        },
        {
          version: 2,
          message: 'first cut',
          createdBy: 'user:a',
          createdAt: 1_700_000_000_000,
        },
      ],
    }),
    useAutomationRuns: () => ({ data: runsData }),
    useAutomationProjects: () => ({ data: projectsData.bound }),
    useNodeTypeCatalog: () => ({ data: undefined, isError: false }),
    useAutomationTriggers: () => ({ data: [] }),
  };
});

vi.mock('../hooks/mutations', () => ({
  useSaveAutomation: () => saveMutation,
  useStartAutomationRun: () => startRun,
  useDeployAutomation: () => deploy,
}));

interface MockLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to?: string;
  params?: Record<string, string>;
}

vi.mock('@tanstack/react-router', async () => {
  // Package imports can reach this hoisted factory before the test's React
  // import initializes. Resolve its dependency inside the factory itself.
  const { forwardRef } = await import('react');
  return {
    useNavigate: () => vi.fn(),
    Link: forwardRef<HTMLAnchorElement, MockLinkProps>(function Link(
      { to, params: _params, children, ...rest },
      ref,
    ) {
      return (
        <a ref={ref} href={to ?? '#'} {...rest}>
          {children}
        </a>
      );
    }),
  };
});

// The canvas is a laid-out chart and jsdom performs no layout; the page only
// needs it to hand a box to the inspector and to carry the page's own
// controls in its corners, so the stub offers that.
vi.mock('./automation-canvas', () => ({
  AutomationCanvas: ({
    automation,
    layoutKey,
    onSelect,
    inspectorId,
    run,
    changed,
    view,
    topStart,
    topEnd,
    toolbar,
  }: {
    automation: { nodes: readonly { id: string; when?: string }[] };
    layoutKey: string;
    onSelect: (id: string | null) => void;
    inspectorId: string;
    run?: { statusByNode: ReadonlyMap<string, string> };
    changed?: { ids: ReadonlySet<string>; key: string | number };
    view?: string;
    topStart?: React.ReactNode;
    topEnd?: React.ReactNode;
    toolbar?: React.ReactNode;
  }) => (
    <div
      data-testid="canvas"
      data-inspector-id={inspectorId}
      data-layout-key={layoutKey}
      data-view={view}
      data-changed={
        changed === undefined ? undefined : [...changed.ids].sort().join(',')
      }
    >
      <div data-testid="canvas-top-start">{topStart}</div>
      <div data-testid="canvas-top-end">{topEnd}</div>
      {automation.nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={() => {
            onSelect(node.id);
          }}
          data-run-status={run?.statusByNode.get(node.id)}
        >
          {`select ${node.id}`}
        </button>
      ))}
      {automation.nodes
        .filter((node) => node.when !== undefined)
        .map((node) => (
          <button
            key={`gate-${node.id}`}
            type="button"
            onClick={() => {
              onSelect(`__gate:${node.id}`);
            }}
          >
            {`select the condition of ${node.id}`}
          </button>
        ))}
      <button type="button" onClick={() => onSelect(null)}>
        deselect
      </button>
      {toolbar}
    </div>
  ),
}));

vi.mock('@tale/ui/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre data-testid="json">{JSON.stringify(data)}</pre>
  ),
}));

import { withIssueIds } from '../lib/issues';
import { AutomationEditor } from './automation-editor';

const onSelectVersion = vi.fn();

type EditorProps = Partial<Parameters<typeof AutomationEditor>[0]>;

/**
 * Mirrors the route: the version on the canvas comes from the URL, and a pick
 * travels back through `onSelectVersion` — here into local state, so the page
 * re-renders on the chosen version exactly as it does after the route's
 * search update.
 */
function EditorHarness(props: EditorProps) {
  const [version, setVersion] = useState<number | undefined>(undefined);
  return (
    <AutomationEditor
      organizationId="org-1"
      automationSlug="billing/dunning"
      {...props}
      {...(version !== undefined && { version })}
      onSelectVersion={(next) => {
        onSelectVersion(next);
        setVersion(next);
      }}
    />
  );
}

/**
 * Mirrors the shell: a provider around the page, no cluster of its own. The
 * harness is keyed on the identity props the way a URL's search belongs to
 * that URL — another automation starts on its latest version.
 */
function VersionPickerHost({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  return (
    <AutomationVersionPickerTarget value={target}>
      <div ref={setTarget} />
      {children}
    </AutomationVersionPickerTarget>
  );
}

function page(props: EditorProps = {}) {
  return (
    <ActiveEditorProvider>
      <VersionPickerHost>
        <EditorHarness
          key={JSON.stringify([
            props.organizationId ?? 'org-1',
            props.automationSlug ?? 'billing/dunning',
            props.projectId ?? null,
          ])}
          {...props}
        />
      </VersionPickerHost>
    </ActiveEditorProvider>
  );
}

function renderPage(props: EditorProps = {}) {
  return render(page(props));
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });
const discardButton = () => screen.getByRole('button', { name: 'Discard' });
const whenField = () => screen.getByRole('textbox', { name: 'When' });
const versionPicker = () => screen.getByRole('button', { name: 'Version' });
/** The live region that counts problems; the canvas has one of its own. */
const issueAnnouncer = () => {
  const region = screen
    .getAllByRole('status')
    .find((element) => element.dataset.slot === 'issue-announcer');
  if (region === undefined) throw new Error('No problems announcer');
  return region;
};
/** The live region that says what changed on the canvas. */
const canvasAnnouncer = () => {
  const region = screen
    .getAllByRole('status')
    .find((element) => element.dataset.slot === 'canvas-announcer');
  if (region === undefined) throw new Error('No canvas announcer');
  return region;
};

/** Select the one node and edit a field every node type accepts. */
async function editTheNode(user: ReturnType<typeof renderPage>['user']) {
  await user.click(screen.getByRole('button', { name: 'select summary' }));
  await user.type(whenField(), 'x');
}

beforeEach(() => {
  saveMutation.mutateAsync = vi.fn().mockResolvedValue({
    name: 'billing/dunning',
    version: 4,
  });
  saveMutation.isPending = false;
  toastSpy.mockClear();
  onSelectVersion.mockClear();
  startRun.mutate.mockReset();
  startRun.mutate.mockImplementation(
    (_args: unknown, callbacks: { onSuccess?: () => void }) =>
      callbacks.onSuccess?.(),
  );
  deploy.mutate.mockReset();
  projectsData.list = [];
  projectsData.bound = [];
  runsData.length = 0;
  state.document = {
    name: 'billing/dunning',
    description: 'Chases unpaid invoices.',
    nodes: [{ id: 'summary', type: 'llm', prompt: 'One sentence, please.' }],
  };
  state.presentation = undefined;
  state.settings = undefined;
  state.taskContract = undefined;
  state.deployedDocument = undefined;
  state.version = 3;
  state.deployedVersion = 2;
  state.deployedUnpinnedAgentNodes = undefined;
  state.missingVersion = undefined;
  state.detailError = undefined;
  state.deployedDetailError = undefined;
  state.realDetailRead = false;
  refetch.mockClear();
  validationMock.status = 'ready';
  validationMock.errors = [];
  validationMock.warnings = [];
  validationMock.calls = [];
  validationMock.canAuthor = true;
  invalidateValidation.mockClear();
});

const detailQueryKey = [
  'backend',
  'org-1',
  'automation',
  'detail',
  'billing/dunning',
  'latest',
];

function realReadPage() {
  state.realDetailRead = true;
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <button type="button">Outside editor</button>
      {page()}
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function automationResponse() {
  return Response.json({
    document: state.document,
    version: state.version,
    deployedVersion: state.deployedVersion,
  });
}

function failedReadResponse() {
  return Response.json({ message: 'Service unavailable' }, { status: 503 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AutomationEditor real detail read recovery', () => {
  it.each(['retry', 'outside'] as const)(
    'keeps keyboard retry stable and respects %s focus on recovery',
    async (recoveryFocus) => {
      let recovering = false;
      let finishRead: ((response: Response) => void) | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (
            new URL(url, window.location.origin).searchParams.has('version')
          ) {
            return Promise.resolve(automationResponse());
          }
          if (!recovering) return Promise.resolve(failedReadResponse());
          return new Promise<Response>((resolve) => {
            finishRead = resolve;
          });
        }),
      );
      const { user } = realReadPage();
      const retryButton = await screen.findByRole(
        'button',
        { name: 'Try again' },
        { timeout: 15000 },
      );
      await user.click(screen.getByRole('button', { name: 'Outside editor' }));
      await user.tab();
      expect(retryButton).toHaveFocus();
      recovering = true;
      await user.keyboard('{Enter}');
      await waitFor(() => expect(finishRead).toBeDefined());
      expect(retryButton).toHaveFocus();
      // A server fault has no words for the reader: the generic sentence,
      // never the body it answered with.
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong — try again',
      );
      expect(screen.queryByText('Loading the automation…')).toBeNull();
      expect(retryButton).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        finishRead?.(
          Response.json({ message: 'Still unavailable' }, { status: 400 }),
        );
      });
      await waitFor(() => expect(retryButton).not.toHaveAttribute('aria-busy'));
      expect(screen.getByRole('button', { name: 'Try again' })).toBe(
        retryButton,
      );
      expect(retryButton).toHaveFocus();
      expect(screen.getByRole('alert')).toHaveTextContent('Still unavailable');
      finishRead = undefined;
      await user.keyboard('{Enter}');
      await waitFor(() => expect(finishRead).toBeDefined());
      if (recoveryFocus === 'outside') {
        await user.click(
          screen.getByRole('button', { name: 'Outside editor' }),
        );
      }
      await act(async () => {
        finishRead?.(automationResponse());
      });
      await screen.findByTestId('canvas');
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      await waitFor(() => {
        const target =
          recoveryFocus === 'retry'
            ? screen.getByRole('region', { name: 'Editor' })
            : screen.getByRole('button', { name: 'Outside editor' });
        expect(target).toHaveFocus();
      });
    },
    30000,
  );

  it('keeps the canvas, inspector and dirty draft after a failed background read', async () => {
    let failRefresh = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const deployed = new URL(url, window.location.origin).searchParams.has(
          'version',
        );
        return Promise.resolve(
          failRefresh && !deployed
            ? failedReadResponse()
            : automationResponse(),
        );
      }),
    );
    const { user, client } = realReadPage();
    await screen.findByTestId('canvas');
    await editTheNode(user);
    const canvas = screen.getByTestId('canvas');
    const draftField = whenField();
    expect(draftField).toHaveValue('x');
    failRefresh = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: detailQueryKey });
    });
    await waitFor(
      () => expect(client.getQueryState(detailQueryKey)?.status).toBe('error'),
      { timeout: 15000 },
    );
    expect(screen.getByTestId('canvas')).toBe(canvas);
    expect(whenField()).toBe(draftField);
    expect(draftField).toHaveValue('x');
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  }, 30000);

  it('does not steal outside focus when the initial failure settles', async () => {
    let finishRead: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finishRead = resolve;
          }),
      ),
    );
    const { user } = realReadPage();
    await user.click(screen.getByRole('button', { name: 'Outside editor' }));
    await act(async () => {
      finishRead?.(
        Response.json({ message: 'Service unavailable' }, { status: 400 }),
      );
    });
    await screen.findByRole('alert', {}, { timeout: 15000 });
    expect(
      screen.getByRole('button', { name: 'Outside editor' }),
    ).toHaveFocus();
  }, 30000);
});

describe('AutomationEditor detail read failure', () => {
  it('names the error and retries instead of staying loading', async () => {
    state.detailError = new Error('Request failed with status 503');
    const { user } = renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the automation: Request failed with status 503",
    );
    const retryButton = screen.getByRole('button', { name: 'Try again' });
    expect(retryButton).not.toHaveFocus();
    expect(screen.queryByText('Loading the automation…')).toBeNull();

    await user.click(retryButton);
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe('AutomationEditor deployed read failure', () => {
  it('reports the read error and offers retry with an accurate live reason', async () => {
    state.deployedDetailError = new Error('Request failed with status 503');
    const { user } = renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the deployed version: Request failed with status 503",
    );
    const liveRun = screen.getByRole('button', { name: 'Run live' });
    expect(liveRun).toHaveAttribute('aria-disabled', 'true');
    act(() => liveRun.focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "Couldn't load the deployed version — try again.",
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
  it.each([400, 503])(
    'keeps the secondary %s failure visible during a real retry and recovers live runs',
    async (status) => {
      let recovering = false;
      let finishRead: ((response: Response) => void) | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string) => {
          if (
            !new URL(url, window.location.origin).searchParams.has('version')
          ) {
            return Promise.resolve(automationResponse());
          }
          if (!recovering)
            return Promise.resolve(
              Response.json(
                {
                  error: 'AUTOMATION_READ_REFUSED',
                  message: 'Version unavailable',
                },
                { status },
              ),
            );
          return new Promise<Response>((resolve) => {
            finishRead = resolve;
          });
        }),
      );
      const { user } = realReadPage();
      const retryButton = await screen.findByRole(
        'button',
        { name: 'Try again' },
        { timeout: 15000 },
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        status === 400
          ? "Couldn't load the deployed version: Version unavailable"
          : "Couldn't load the deployed version",
      );
      if (status === 503)
        expect(screen.getByRole('alert')).not.toHaveTextContent(
          'Version unavailable',
        );
      recovering = true;
      await user.click(retryButton);
      await waitFor(() => expect(finishRead).toBeDefined());
      expect(retryButton).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't load the deployed version",
      );
      expect(screen.getByRole('alert')).not.toHaveTextContent(/null|undefined/);
      expect(screen.getByRole('button', { name: 'Run live' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      await act(async () => {
        finishRead?.(automationResponse());
      });
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(
        screen.getByRole('button', { name: 'Run live' }),
      ).not.toHaveAttribute('aria-disabled', 'true');
    },
    30000,
  );

  it.each([new TypeError('runtime internals'), { message: 'private payload' }])(
    'omits unsafe failure detail (%s)',
    (error) => {
      state.deployedDetailError = error as Error;
      renderPage();
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't load the deployed version",
      );
      expect(screen.getByRole('alert')).not.toHaveTextContent(
        /runtime internals|private payload|\[object Object\]/,
      );
    },
  );
});

/**
 * A `?version=` the automation never saved is a missing VERSION, not a
 * missing automation (2026-09-26 evaluation, D-04): the page says which
 * version is missing and offers the latest, instead of the automation-level
 * not-found state under the automation's own tabs.
 */
describe('AutomationEditor missing version', () => {
  it('names the missing version and opens the latest on request', async () => {
    state.missingVersion = 99;
    const { user } = renderPage({ version: 99 });
    expect(
      screen.getByRole('heading', { name: "Version 99 doesn't exist" }),
    ).toBeVisible();
    expect(screen.queryByText('Automation not found')).toBeNull();
    // "Open latest" asks the route to drop `?version=`; the route's search
    // update is what redraws the latest, so the ask is what is pinned here.
    await user.click(screen.getByRole('button', { name: 'Open latest' }));
    expect(onSelectVersion).toHaveBeenCalledWith(undefined);
  });
});

/** The node inspector — on the page only while a node is picked. */
function inspector(): HTMLElement | null {
  const id = screen.getByTestId('canvas').dataset.inspectorId;
  return id === undefined ? null : document.getElementById(id);
}

describe('AutomationEditor', () => {
  it('never falls back into the editor when the version tab target is absent', () => {
    render(
      <AutomationVersionPicker
        portal
        organizationId="org-1"
        automationSlug="billing/dunning"
        currentVersion={2}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Version' }),
    ).not.toBeInTheDocument();
  });

  it('omits the pack description from the workbench header', () => {
    state.presentation = {
      name: 'Chase overdue invoices',
      description: 'Sends the dunning ladder.',
      i18n: { de: { name: 'Offene Rechnungen anmahnen' } },
    };
    renderPage();
    expect(screen.queryByText('Sends the dunning ladder.')).toBeNull();
    expect(screen.queryByText('Chases unpaid invoices.')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'select summary' }),
    ).toBeVisible();
  });

  it("leaves the automation's own settings to the General tab", () => {
    renderPage();
    // With nothing picked the canvas has the row to itself; the trigger and
    // the project bindings are not on the workbench any more.
    expect(inspector()).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Trigger' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Projects' })).toBeNull();
  });

  it('opens the inspector for a picked node and closes it again', async () => {
    const { user } = renderPage();
    expect(inspector()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    expect(inspector()).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'deselect' }));
    expect(inspector()).toBeNull();
  });

  it('closes the inspector from Close and Escape', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(inspector()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    await user.keyboard('{Escape}');
    expect(inspector()).toBeNull();
  });

  it('keeps the node inspector open on Escape while typing', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    await user.click(screen.getByRole('textbox', { name: 'Prompt' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
  });

  it('does not put a standing banner over pinless agents on the live version', () => {
    state.deployedUnpinnedAgentNodes = ['agent'];
    renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(
      screen.queryByText(/The live version \(v2\) has an agent node/),
    ).toBeNull();
  });

  it('deploys the canvas version from the header when it is not live', async () => {
    const { user } = renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(screen.queryByText('Live: v2')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^Deploy$/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deploy v3' }));
    expect(deploy.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        version: 3,
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("surfaces the deploy gate's own refusal, not a generic error", async () => {
    deploy.mutate.mockImplementation(
      (
        _args: unknown,
        handlers: { onError: (error: unknown) => void } | undefined,
      ) => {
        handlers?.onError({
          data: {
            code: 'AUTOMATION_DEPLOY_REJECTED',
            message:
              'deploy gate: billing/dunning@3 was saved with failing tests — fix them and save a new version',
          },
        });
      },
    );
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Deploy v3' }));
    expect(
      screen.getByText(
        'deploy gate: billing/dunning@3 was saved with failing tests — fix them and save a new version',
      ),
    ).toBeVisible();
  });

  it('offers no header deploy when the canvas version is already live', () => {
    state.deployedVersion = 3;
    renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(versionPicker()).not.toHaveTextContent('Live');
    // The one Live badge beside the name — the history is its own tab now.
    expect(screen.getByText('Live')).toBeVisible();
    expect(screen.queryByText(/^Live:/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: /^Deploy v\d/ }),
    ).not.toBeInTheDocument();
  });

  it('still offers header deploy when nothing is live yet', () => {
    state.deployedVersion = undefined;
    renderPage();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deploy v3' })).toBeVisible();
  });

  it('drops the header deploy after switching to the live version', async () => {
    const { user } = renderPage();
    await user.click(versionPicker());
    await user.click(screen.getByRole('radio', { name: /^v2/ }));
    expect(versionPicker()).toHaveTextContent('v2');
    expect(versionPicker()).not.toHaveTextContent('Live');
    // The one Live badge beside the name — the history is its own tab now.
    expect(screen.getByText('Live')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /^Deploy v\d/ }),
    ).not.toBeInTheDocument();
  });

  it('switches the canvas from the header version picker', async () => {
    const { user } = renderPage();
    expect(versionPicker()).toHaveTextContent('v3');
    expect(screen.getByRole('button', { name: 'Deploy v3' })).toBeVisible();

    await user.click(versionPicker());
    await user.click(screen.getByRole('radio', { name: /^v2/ }));

    expect(versionPicker()).toHaveTextContent('v2');
    expect(versionPicker()).not.toHaveTextContent('Live');
    // The one Live badge beside the name — the history is its own tab now.
    expect(screen.getByText('Live')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /^Deploy v\d/ }),
    ).not.toBeInTheDocument();
  });

  it.each([undefined, 'project_a'])(
    'opens the latest version when switching automation in project scope %s',
    async (projectId) => {
      const props = projectId === undefined ? {} : { projectId };
      const { user, rerender } = renderPage(props);
      await user.click(versionPicker());
      await user.click(screen.getByRole('radio', { name: /^v2/ }));
      expect(versionPicker()).toHaveTextContent('v2');

      // A sibling may have fewer versions. Keeping v2 would ask for a version
      // that does not exist and leave the new workbench loading; the new URL
      // carries no ?version=, so the sibling opens on its latest.
      state.version = 1;
      state.document = {
        name: 'billing/reminders',
        nodes: [
          { id: 'reminder', type: 'llm', prompt: 'Remind the customer.' },
        ],
      };
      rerender(page({ ...props, automationSlug: 'billing/reminders' }));

      expect(versionPicker()).toHaveTextContent('v1');
      expect(
        screen.getByRole('button', { name: 'select reminder' }),
      ).toBeVisible();
      expect(saveButton()).toBeDisabled();
    },
  );

  it.each([
    { automationSlug: 'billing/reminders' },
    { organizationId: 'org-2' },
    { projectId: 'project_b' },
  ])('drops the previous draft after navigation to %j', async (destination) => {
    const props = { projectId: 'project_a' };
    const { user, rerender } = renderPage(props);
    await editTheNode(user);
    expect(saveButton()).toBeEnabled();

    // A live query refresh is still the same editor: retain unsaved work.
    rerender(page(props));
    expect(whenField()).toHaveValue('x');
    expect(saveButton()).toBeEnabled();

    // The router changes these props only after the shared dirty guard has
    // accepted leaving. The destination must never inherit the old draft.
    state.document = {
      name: destination.automationSlug ?? 'billing/dunning',
      nodes: [{ id: 'destination', type: 'llm', prompt: 'The new workflow.' }],
    };
    rerender(page({ ...props, ...destination }));

    expect(screen.queryByRole('button', { name: 'select summary' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'select destination' }),
    ).toBeVisible();
    expect(inspector()).toBeNull();
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();
    expect(saveMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('reports a picked version to the route and lands on the latest after a save', async () => {
    const { user } = renderPage();
    await user.click(versionPicker());
    await user.click(screen.getByRole('radio', { name: /^v2/ }));
    expect(onSelectVersion).toHaveBeenLastCalledWith(2);
    expect(versionPicker()).toHaveTextContent('v2');

    // A save appends a version, so the page asks the route for the latest
    // again rather than staying pinned to the one it was reading.
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => {
      expect(onSelectVersion).toHaveBeenLastCalledWith(undefined);
    });
    expect(versionPicker()).toHaveTextContent('v3');
  });

  it('toggles the last-run overlay from a canvas control', async () => {
    runsData.push({
      id: 'run_1',
      name: 'billing/dunning',
      version: 3,
      status: 'success',
      mode: 'mock',
      startedBy: 'user:a',
      startedAt: 1_700_000_200_000,
    });
    const { user } = renderPage();
    // Among the canvas's own verbs, in its top-right corner.
    const hide = within(screen.getByTestId('canvas-top-end')).getByRole(
      'button',
      { name: 'Hide last run' },
    );
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.queryByRole('link', { name: 'Open the last run' }),
    ).toBeNull();

    await user.click(hide);
    expect(
      screen.getByRole('button', { name: 'Show last run' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks a waiting run cursor as running in the last-run overlay', () => {
    runsData.push({
      id: 'run_1',
      name: 'billing/dunning',
      version: 3,
      status: 'waiting',
      mode: 'mock',
      startedBy: 'user:a',
      startedAt: 1_700_000_200_000,
      checkpoints: { cursor: { node: 'summary' } },
    });
    renderPage();
    expect(
      screen.getByRole('button', { name: 'select summary' }),
    ).toHaveAttribute('data-run-status', 'running');
  });

  it('stays quiet when the deployed version has no pinless agent node', () => {
    renderPage();
    expect(
      screen.queryByText(/without a pinned provider/, { exact: false }),
    ).toBeNull();
  });

  it('test-runs the version on screen, not the deployed one', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Test run' }));
    // The page shows v3 while v2 is deployed; without the explicit version the
    // server falls back to the deployment and an undeployed draft cannot be
    // tested at all.
    expect(startRun.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        mode: 'mock',
        version: 3,
      },
      expect.any(Object),
    );
  });

  it('collects schema-valid input before scheduling the selected test version', async () => {
    const previous = state.document;
    state.document = {
      name: 'billing/dunning',
      inputs: {
        type: 'object',
        properties: { owner: { type: 'string', minLength: 1 } },
        required: ['owner'],
        additionalProperties: false,
      },
      nodes: [{ id: 'summary', type: 'transform', code: 'return input;' }],
    };
    try {
      const { user } = renderPage();
      await user.click(screen.getByRole('button', { name: 'Test run' }));
      expect(startRun.mutate).not.toHaveBeenCalled();
      const dialog = screen.getByRole('dialog', { name: 'Test run' });
      const input = within(dialog).getByRole('textbox', {
        name: 'Run input (JSON)',
      });
      const confirm = within(dialog).getByRole('button', { name: 'Test run' });
      expect(confirm).toBeDisabled();
      await user.clear(input);
      await user.paste('{');
      expect(confirm).toBeDisabled();
      await user.clear(input);
      await user.paste('{"owner":42}');
      expect(confirm).toBeDisabled();
      await user.clear(input);
      await user.paste('{"owner":"docs-proof"}');
      await user.click(confirm);
      expect(startRun.mutate).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          name: 'billing/dunning',
          mode: 'mock',
          version: 3,
          input: { owner: 'docs-proof' },
        },
        expect.any(Object),
      );
      expect(screen.queryByRole('dialog', { name: 'Test run' })).toBeNull();
    } finally {
      state.document = previous;
    }
  });

  it('validates the deployed schema for live input and keeps confirmation explicit', async () => {
    state.deployedDocument = {
      name: 'billing/dunning',
      inputs: {
        type: 'object',
        properties: { target: { type: 'string' } },
        required: ['target'],
        additionalProperties: false,
      },
      nodes: [{ id: 'summary', type: 'transform', code: 'return input;' }],
    };
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Run live' }));
    const dialog = screen.getByRole('dialog', { name: 'Run live?' });
    expect(
      within(dialog).getByText(/emails send, records change/),
    ).toBeVisible();
    const input = within(dialog).getByRole('textbox', {
      name: 'Run input (JSON)',
    });
    const confirm = within(dialog).getByRole('button', { name: 'Run live' });
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.paste('{"target":"reviewed-destination"}');
    expect(startRun.mutate).not.toHaveBeenCalled();
    await user.click(confirm);
    expect(startRun.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        mode: 'live',
        version: 2,
        input: { target: 'reviewed-destination' },
      },
      expect.any(Object),
    );
  });

  it('closes the Run live confirm as soon as the run is started', async () => {
    // An accepted start closes the dialog; later execution failures belong
    // to the run. A start refusal instead keeps the editable input below.
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Run live' }));
    const dialog = screen.getByRole('dialog', { name: 'Run live?' });
    expect(dialog).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Run live' }));
    expect(startRun.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        mode: 'live',
        version: 2,
      },
      expect.any(Object),
    );
    expect(screen.queryByRole('dialog', { name: 'Run live?' })).toBeNull();
  });

  it('keeps run input and the refusal visible when scheduling fails', async () => {
    state.document = {
      name: 'billing/dunning',
      inputs: { type: 'object' },
      nodes: [{ id: 'summary', type: 'transform', code: 'return input;' }],
    };
    startRun.mutate.mockImplementation(
      (_args: unknown, callbacks: { onError: (error: Error) => void }) =>
        callbacks.onError(new Error('Connection unavailable')),
    );
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Test run' }));
    const dialog = screen.getByRole('dialog', { name: 'Test run' });
    const input = within(dialog).getByRole('textbox', {
      name: 'Run input (JSON)',
    });
    await user.clear(input);
    await user.paste('{"owner":"example"}');
    await user.click(within(dialog).getByRole('button', { name: 'Test run' }));
    expect(dialog).toBeVisible();
    expect(input).toHaveValue('{"owner":"example"}');
    expect(within(dialog).getByText('Connection unavailable')).toBeVisible();
  });

  it('offers no run-scope picker unless the automation is multi-bound', () => {
    // One binding is auto-applied server-side; none is org-wide already —
    // neither is a choice worth surfacing.
    projectsData.list = [{ _id: 'project_a', name: 'Acme' }];
    projectsData.bound = ['project_a'];
    renderPage();
    expect(
      screen.queryByRole('combobox', { name: 'Project scope' }),
    ).toBeNull();
  });

  it('names the sole bound project in the Run live dialog', async () => {
    // No picker for a sole binding, but the live dialog still states where the
    // run will act — the project the server pins it to.
    projectsData.list = [{ _id: 'project_a', name: 'Acme' }];
    projectsData.bound = ['project_a'];
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Run live' }));
    const dialog = screen.getByRole('dialog', { name: 'Run live?' });
    expect(
      within(dialog).getByText(/operates in the Acme project/),
    ).toBeVisible();
  });

  it('scopes a run to a chosen project when the automation is multi-bound', async () => {
    projectsData.list = [
      { _id: 'project_a', name: 'Acme' },
      { _id: 'project_b', name: 'Globex' },
    ];
    projectsData.bound = ['project_a', 'project_b'];
    const { user } = renderPage();

    // The default is organization-wide — a run carries no projectId until the
    // author narrows it.
    const scope = screen.getByRole('combobox', { name: 'Project scope' });
    expect(scope).toHaveTextContent('Organization-wide');

    await user.click(scope);
    await user.click(screen.getByRole('option', { name: 'Globex' }));
    await user.click(screen.getByRole('button', { name: 'Test run' }));

    expect(startRun.mutate).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'billing/dunning',
        mode: 'mock',
        version: 3,
        projectId: 'project_b',
      },
      expect.any(Object),
    );
  });

  it('arms the shared cluster as soon as a node is edited', async () => {
    const { user } = renderPage();
    expect(saveButton()).toBeDisabled();
    expect(discardButton()).toBeDisabled();

    await editTheNode(user);

    expect(whenField()).toHaveValue('x');
    expect(saveButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
  });

  it('discards the draft back to the stored version', async () => {
    const { user } = renderPage();
    await editTheNode(user);

    await user.click(discardButton());

    expect(whenField()).toHaveValue('');
    expect(saveButton()).toBeDisabled();
  });

  it('asks for a version message and writes nothing until it is confirmed', async () => {
    const { user } = renderPage();
    await editTheNode(user);

    await user.click(saveButton());

    expect(screen.getByText('Save a new version')).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Version message' }),
    ).toBeVisible();
    expect(saveMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps the draft and stays silent when the dialog is dismissed', async () => {
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Save a new version')).toBeNull();
    });
    expect(saveMutation.mutateAsync).not.toHaveBeenCalled();
    // A cancelled save is not a failure: no toast, and the edit survives.
    expect(toastSpy).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
    expect(whenField()).toHaveValue('x');
  });

  it('appends the version with the typed message and clears the draft', async () => {
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());

    await user.type(
      screen.getByRole('textbox', { name: 'Version message' }),
      'tighten the prompt',
    );
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    await waitFor(() => {
      expect(saveMutation.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(saveMutation.mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      message: 'tighten the prompt',
      // The version the draft was built on rides along.
      baseVersion: 3,
      automation: expect.objectContaining({
        name: 'billing/dunning',
        nodes: [expect.objectContaining({ id: 'summary', when: 'x' })],
      }),
    });
    // The draft is gone: the page reads the stored version again, and the
    // cluster disarms (Save itself is mid "Saved" flash, so Discard is the
    // stable dirty signal to assert).
    await waitFor(() => {
      expect(discardButton()).toBeDisabled();
    });
    expect(whenField()).toHaveValue('');
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('keeps the edited version’s package metadata when saving a node change', async () => {
    state.presentation = { name: 'Pack title' };
    state.settings = { folder: 'Setup', forms: [] };
    state.taskContract = { kind: 'task' };
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() =>
      expect(saveMutation.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          presentation: state.presentation,
          settings: state.settings,
          taskContract: state.taskContract,
        }),
      ),
    );
    state.settings = undefined;
    state.taskContract = undefined;
  });

  it("surfaces the store's own refusal in one toast", async () => {
    saveMutation.mutateAsync = vi.fn().mockRejectedValue({
      data: {
        code: 'AUTOMATION_NAME_INVALID',
        message:
          'billing/Dunning is not a valid name — use lower-case segments',
      },
    });
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledTimes(1);
    });
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description:
          'billing/Dunning is not a valid name — use lower-case segments',
      }),
    );
    // The refusal leaves the draft in place so it can be corrected and re-saved.
    expect(saveButton()).toBeEnabled();
  });

  it('sends the version the draft started from, pinned before another tab moves it', async () => {
    const { user } = renderPage();
    await editTheNode(user);
    // Another tab saved v4 while the draft was open: the detail read now
    // answers v4, but the draft was built on v3 and says so.
    state.version = 4;
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    await waitFor(() => {
      expect(saveMutation.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(saveMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ baseVersion: 3 }),
    );
  });

  it('offers reload or save-anyway when the store refuses a stale draft, and never a silent revert', async () => {
    saveMutation.mutateAsync = vi
      .fn()
      .mockRejectedValueOnce({
        data: {
          code: 'AUTOMATION_VERSION_STALE',
          message:
            'v4 of "billing/dunning" was saved after your draft started from v3.',
          latestVersion: 4,
          baseVersion: 3,
        },
      })
      .mockResolvedValue({ name: 'billing/dunning', version: 5 });
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    // The refusal is a decision, not a failure toast; the draft is kept.
    await waitFor(() => {
      expect(
        screen.getByText('This automation changed while you were editing'),
      ).toBeVisible();
    });
    expect(toastSpy).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'v4 of "billing/dunning" was saved after your draft started from v3.',
      ),
    ).toBeVisible();

    // Save anyway appends on top of the version that landed.
    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => {
      expect(saveMutation.mutateAsync).toHaveBeenCalledTimes(2);
    });
    expect(saveMutation.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseVersion: 4 }),
    );
    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
  });

  it.each([false, true])(
    'keeps later edits dirty after Save anyway succeeds (query refreshed: %s)',
    async (refreshQuery) => {
      const append = Promise.withResolvers<{ name: string; version: number }>();
      saveMutation.mutateAsync = vi
        .fn()
        .mockRejectedValueOnce({
          data: {
            code: 'AUTOMATION_VERSION_STALE',
            message: 'v4 landed.',
            latestVersion: 4,
            baseVersion: 3,
          },
        })
        .mockImplementationOnce(() => append.promise)
        .mockResolvedValue({ name: 'billing/dunning', version: 6 });
      const { user, rerender } = renderPage();
      await user.click(screen.getByRole('button', { name: 'select summary' }));
      const prompt = () => screen.getByRole('textbox', { name: 'Prompt' });
      await user.clear(prompt());
      await user.paste('Submitted draft');
      await user.click(saveButton());
      await user.click(screen.getByRole('button', { name: 'Save version' }));
      await screen.findByText('v4 landed.');
      await user.click(screen.getByRole('button', { name: 'Save anyway' }));

      saveMutation.isPending = true;
      rerender(page());
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(prompt()).not.toHaveAttribute('readonly');
      expect(saveButton()).toBeDisabled();
      expect(discardButton()).toBeDisabled();
      expect(saveMutation.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseVersion: 4,
          automation: expect.objectContaining({
            nodes: [expect.objectContaining({ prompt: 'Submitted draft' })],
          }),
        }),
      );

      await user.clear(prompt());
      await user.paste('Later unsaved draft');
      expect(prompt()).toHaveValue('Later unsaved draft');
      const submitted = saveMutation.mutateAsync.mock.calls[1]?.[0].automation;
      expect(submitted.nodes[0].prompt).toBe('Submitted draft');
      if (refreshQuery) {
        state.document = submitted;
        state.version = 5;
        rerender(page());
      }
      await act(async () => {
        saveMutation.isPending = false;
        append.resolve({ name: 'billing/dunning', version: 5 });
      });
      rerender(page());

      expect(prompt()).toHaveValue('Later unsaved draft');
      expect(saveButton()).toBeEnabled();
      expect(discardButton()).toBeEnabled();
      expect(toastSpy).not.toHaveBeenCalled();
      expect(onSelectVersion).toHaveBeenCalledWith(undefined);

      await user.click(saveButton());
      await user.click(screen.getByRole('button', { name: 'Save version' }));
      await waitFor(() => expect(discardButton()).toBeDisabled());
      expect(saveMutation.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseVersion: 5,
          automation: expect.objectContaining({
            nodes: [expect.objectContaining({ prompt: 'Later unsaved draft' })],
          }),
        }),
      );
    },
    30_000,
  );

  it.each([true, false])(
    'settles only its own draft after a pending append is discarded (replacement edited while pending: %s)',
    async (editWhilePending) => {
      state.deployedDocument = {
        name: 'billing/dunning',
        description: 'The v2 document.',
        nodes: [{ id: 'summary', type: 'llm', prompt: 'Stored on v2' }],
      };
      const append = Promise.withResolvers<{ name: string; version: number }>();
      saveMutation.mutateAsync = vi
        .fn()
        .mockRejectedValueOnce({
          data: {
            code: 'AUTOMATION_VERSION_STALE',
            message: 'v4 landed.',
            latestVersion: 4,
            baseVersion: 3,
          },
        })
        .mockImplementationOnce(() => append.promise)
        .mockRejectedValueOnce({
          data: {
            code: 'AUTOMATION_VERSION_STALE',
            message: 'v5 landed after v2.',
            latestVersion: 5,
            baseVersion: 2,
          },
        });
      const { user, rerender } = renderPage();
      const prompt = () => screen.getByRole('textbox', { name: 'Prompt' });
      const editReplacement = async () => {
        await user.clear(prompt());
        await user.paste('Edited on v2');
      };
      await user.click(screen.getByRole('button', { name: 'select summary' }));
      await user.clear(prompt());
      await user.paste('Submitted draft');
      await user.click(saveButton());
      await user.click(screen.getByRole('button', { name: 'Save version' }));
      await screen.findByText('v4 landed.');
      await user.click(screen.getByRole('button', { name: 'Save anyway' }));
      saveMutation.isPending = true;
      rerender(page());

      expect(saveMutation.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseVersion: 4,
          automation: expect.objectContaining({
            nodes: [expect.objectContaining({ prompt: 'Submitted draft' })],
          }),
        }),
      );
      const submitted = saveMutation.mutateAsync.mock.calls[1]?.[0].automation;
      await user.click(versionPicker());
      await user.click(screen.getByRole('radio', { name: /^v2/ }));
      await user.click(
        screen.getByRole('button', { name: 'Discard and switch' }),
      );
      expect(prompt()).toHaveValue('Stored on v2');
      if (editWhilePending) await editReplacement();
      expect(versionPicker()).toHaveTextContent('v2');
      onSelectVersion.mockClear();

      state.document = submitted;
      state.version = 5;
      rerender(page());
      await act(async () => {
        saveMutation.isPending = false;
        append.resolve({ name: 'billing/dunning', version: 5 });
      });
      rerender(page());

      expect(versionPicker()).toHaveTextContent('v2');
      expect(onSelectVersion).not.toHaveBeenCalled();
      expect(prompt()).toHaveValue(
        editWhilePending ? 'Edited on v2' : 'Stored on v2',
      );
      expect(submitted.nodes[0].prompt).toBe('Submitted draft');
      if (!editWhilePending) {
        expect(discardButton()).toBeDisabled();
        await editReplacement();
      }
      expect(saveButton()).toBeEnabled();
      expect(discardButton()).toBeEnabled();
      await user.click(saveButton());
      await user.click(screen.getByRole('button', { name: 'Save version' }));
      await screen.findByText('v5 landed after v2.');
      expect(saveMutation.mutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          baseVersion: 2,
          automation: expect.objectContaining({
            description: 'The v2 document.',
            nodes: [expect.objectContaining({ prompt: 'Edited on v2' })],
          }),
        }),
      );
      expect(toastSpy).not.toHaveBeenCalled();
    },
    30_000,
  );

  it('keeps the draft when the stale-version decision is cancelled', async () => {
    saveMutation.mutateAsync = vi.fn().mockRejectedValue({
      data: {
        code: 'AUTOMATION_VERSION_STALE',
        message: 'v4 landed.',
        latestVersion: 4,
        baseVersion: 3,
      },
    });
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await screen.findByText('v4 landed.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(whenField()).toHaveValue('x');
    expect(saveButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
    expect(saveMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('drops the draft and shows the newer version on reload after a stale refusal', async () => {
    saveMutation.mutateAsync = vi.fn().mockRejectedValue({
      data: {
        code: 'AUTOMATION_VERSION_STALE',
        message: 'v4 landed.',
        latestVersion: 4,
        baseVersion: 3,
      },
    });
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => {
      expect(screen.getByText('v4 landed.')).toBeVisible();
    });

    await user.click(
      screen.getByRole('button', { name: 'Discard my changes and reload' }),
    );
    await waitFor(() => {
      expect(saveButton()).toBeDisabled();
    });
    expect(onSelectVersion).toHaveBeenCalledWith(undefined);
    expect(saveMutation.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('confirms before a version switch drops the draft', async () => {
    const { user } = renderPage();
    await editTheNode(user);

    await user.click(versionPicker());
    await user.click(screen.getByRole('radio', { name: /^v2/ }));
    expect(screen.getByText('Show another version?')).toBeVisible();

    // Backing out of the question leaves the draft exactly where it was.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByText('Show another version?')).toBeNull();
    });
    expect(whenField()).toHaveValue('x');

    await user.click(versionPicker());
    await user.click(screen.getByRole('radio', { name: /^v2/ }));
    await user.click(
      screen.getByRole('button', { name: 'Discard and switch' }),
    );

    await waitFor(() => {
      expect(whenField()).toHaveValue('');
    });
    expect(saveButton()).toBeDisabled();
  });

  it('does not put delete beside the save cluster', () => {
    renderPage();
    expect(
      screen.queryByRole('button', { name: 'Delete automation' }),
    ).toBeNull();
  });

  it('passes an axe audit', async () => {
    const { container } = renderPage();
    await checkAccessibility(container);
  });
});

describe('AutomationEditor problems', () => {
  /** The draft's prompt reads a node that does not exist. */
  const promptError = {
    level: 'error' as const,
    code: 'REF_UNKNOWN_NODE',
    message: 'nodes.nope does not exist',
    hint: 'reference an existing node',
    at: { pointer: '/nodes/0/prompt', range: [4, 9] as [number, number] },
    params: { node: 'summary', field: 'prompt', ref: 'nope', available: [] },
  };

  function refusal() {
    return {
      data: {
        code: 'AUTOMATION_INVALID',
        message: 'automation failed validation — fix errors before saving',
        errors: [promptError],
        warnings: [],
      },
    };
  }

  const problemsButton = () =>
    screen.getByRole('button', { name: /^(Problems|No problems)/ });

  it('counts what the check found and keeps Save disabled with the reason', async () => {
    validationMock.errors = withIssueIds([promptError]);
    const { user } = renderPage();
    expect(problemsButton()).toHaveAccessibleName('Problems: 1 error');
    await editTheNode(user);
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    act(() => saveButton().focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Fix 1 error to save',
    );
  });

  it('keeps Save waiting while a fix is checked, and lets it act once the check settles clean', async () => {
    validationMock.errors = withIssueIds([promptError]);
    validationMock.status = 'checking';
    const { user, rerender } = renderPage();
    await editTheNode(user);
    act(() => saveButton().focus());
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Checking your changes…',
    );
    validationMock.errors = [];
    validationMock.status = 'ready';
    rerender(page());
    expect(saveButton()).toBeEnabled();
    expect(problemsButton()).toHaveAccessibleName('No problems');
  });

  it('never blocks Save on a check that failed', async () => {
    validationMock.errors = withIssueIds([promptError]);
    validationMock.status = 'failed';
    const { user } = renderPage();
    await editTheNode(user);
    expect(saveButton()).toBeEnabled();
    expect(problemsButton()).toHaveAccessibleName("Problems: couldn't check");
  });

  it('opens the list under the canvas and goes to the field with the text selected', async () => {
    validationMock.errors = withIssueIds([promptError]);
    const { user } = renderPage();
    await user.click(problemsButton());
    expect(problemsButton()).toHaveAttribute('aria-expanded', 'true');
    const dock = screen.getByRole('region', { name: 'Problems' });
    expect(problemsButton()).toHaveAttribute('aria-controls', dock.id);
    const row = within(dock).getByRole('button', {
      name: /Error: .*summary › Prompt/,
    });
    await waitFor(() => expect(row).toHaveFocus());
    await user.keyboard('{Enter}');
    const prompt = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Prompt',
    });
    await waitFor(() => expect(prompt).toHaveFocus());
    expect([prompt.selectionStart, prompt.selectionEnd]).toEqual([4, 9]);
    // The field carries its own problem, and the row stays marked current.
    expect(prompt).toHaveAttribute('aria-invalid', 'true');
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('closes the list on Escape and returns focus to the Problems button', async () => {
    validationMock.errors = withIssueIds([promptError]);
    const { user } = renderPage();
    await user.click(problemsButton());
    const dock = screen.getByRole('region', { name: 'Problems' });
    await waitFor(() =>
      expect(within(dock).getAllByRole('button')[0]).toBeDefined(),
    );
    act(() =>
      within(dock)
        .getByRole('button', { name: /Error:/ })
        .focus(),
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Problems' })).toBeNull();
    expect(problemsButton()).toHaveFocus();
  });

  it('lands a refused save in Problems on its first error, with no toast [AUTO-R23]', async () => {
    saveMutation.mutateAsync = vi.fn().mockRejectedValue(refusal());
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    const dock = await screen.findByRole('region', { name: 'Problems' });
    const row = within(dock).getByRole('button', { name: /Error:/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect(toastSpy).not.toHaveBeenCalled();
    expect(problemsButton()).toHaveAccessibleName('Problems: 1 error');
    // The server's errors hold Save until the draft changes.
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
    await waitFor(() =>
      expect(issueAnnouncer()).toHaveTextContent('Saving was refused. 1 error'),
    );
  });

  it('points a refused deploy at Problems', async () => {
    deploy.mutate.mockImplementation(
      (
        _args: unknown,
        handlers: { onError: (error: unknown) => void } | undefined,
      ) => {
        handlers?.onError(refusal());
      },
    );
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Deploy v3' }));
    expect(
      screen.getByText(
        'This version has problems that block deploying it. Problems lists them.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Problems' })).toBeVisible();
  });

  it('says a draft check only when its counts change', async () => {
    const { user } = renderPage();
    const status = issueAnnouncer;
    // The stored version had no problems: a clean draft is no news.
    await editTheNode(user);
    await user.type(whenField(), 'y');
    expect(status()).toBeEmptyDOMElement();
    validationMock.errors = withIssueIds([promptError]);
    await user.type(whenField(), 'z');
    await waitFor(() => expect(status()).toHaveTextContent('1 error'));
    const spoken = status().firstElementChild;
    // The same count after the next pause in typing is not said again.
    await user.type(whenField(), 'w');
    expect(status().firstElementChild).toBe(spoken);
    validationMock.errors = [];
    await user.type(whenField(), 'v');
    await waitFor(() => expect(status()).toHaveTextContent('No problems'));
  });

  it('shows every problem again on a refusal, whatever the list was filtered to', async () => {
    saveMutation.mutateAsync = vi.fn().mockRejectedValue(refusal());
    const { user } = renderPage();
    await user.click(problemsButton());
    const dock = screen.getByRole('region', { name: 'Problems' });
    await user.click(within(dock).getByRole('radio', { name: 'Warnings' }));
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));

    const row = await within(dock).findByRole('button', { name: /Error:/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect(within(dock).getByRole('radio', { name: 'All' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('says "Checking…" above an empty list while the first check runs', async () => {
    validationMock.status = 'checking';
    const { user } = renderPage();
    await user.click(problemsButton());
    const dock = screen.getByRole('region', { name: 'Problems' });
    expect(within(dock).getAllByText('Checking…')).toHaveLength(2);
    expect(within(dock).queryByText('No problems')).toBeNull();
  });

  it('says a refused deploy once: the alert names it, the announcer counts', async () => {
    deploy.mutate.mockImplementation(
      (
        _args: unknown,
        handlers: { onError: (error: unknown) => void } | undefined,
      ) => {
        handlers?.onError(refusal());
      },
    );
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Deploy v3' }));
    await waitFor(() =>
      expect(issueAnnouncer()).toHaveTextContent(/^1 error$/),
    );
  });

  it('words a refused deploy with a draft on screen in the reader’s language', async () => {
    deploy.mutate.mockImplementation(
      (
        _args: unknown,
        handlers: { onError: (error: unknown) => void } | undefined,
      ) => {
        handlers?.onError(refusal());
      },
    );
    const { user } = renderPage();
    await editTheNode(user);
    await user.click(screen.getByRole('button', { name: 'Deploy v3' }));
    expect(
      screen.getByText(
        'This version has problems that block deploying it. Discard your draft to see them in Problems.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/automation failed validation/)).toBeNull();
  });

  it("says why a problem outside the nodes can't be gone to", async () => {
    validationMock.errors = withIssueIds([
      {
        level: 'error' as const,
        code: 'OUTPUT_MISSING',
        message: 'the automation has no output',
        at: { pointer: '/output', subject: 'missing' },
        params: {},
      },
    ]);
    const { user } = renderPage();
    await user.click(problemsButton());
    const row = within(
      screen.getByRole('region', { name: 'Problems' }),
    ).getByRole('button', { name: /Error:/ });
    expect(row).toHaveAttribute('aria-disabled', 'true');
    expect(row).toHaveAccessibleDescription(/with your coding agent/);
  });

  it('checks nothing and shows no Problems for a member', () => {
    validationMock.canAuthor = false;
    renderPage();
    expect(screen.queryByRole('button', { name: /^Problems/ })).toBeNull();
    expect(validationMock.calls.every((call) => !call.enabled)).toBe(true);
  });

  it('passes an axe audit with the Problems list open', async () => {
    validationMock.errors = withIssueIds([promptError]);
    const { user, container } = renderPage();
    await user.click(problemsButton());
    await checkAccessibility(container);
  });
});

describe('AutomationEditor canvas', () => {
  const twoNodes = {
    name: 'billing/dunning',
    nodes: [
      { id: 'summary', type: 'llm', prompt: 'One sentence, please.' },
      {
        id: 'notify',
        type: 'transform',
        when: '{{ nodes.summary.output !== null }}',
        input: { text: '{{ nodes.summary.output }}' },
        code: 'return input.text;',
      },
    ],
  };

  it('follows a version saved elsewhere, rings what changed and says so', async () => {
    const { user, rerender } = renderPage();
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute(
      'data-layout-key',
      'billing/dunning:latest',
    );

    // A coding agent saves v4: Summary changed, Notify is new.
    state.version = 4;
    state.document = {
      ...twoNodes,
      nodes: [
        { id: 'summary', type: 'llm', prompt: 'Two sentences, please.' },
        ...twoNodes.nodes.slice(1),
      ],
    };
    rerender(page());

    await waitFor(() =>
      expect(canvasAnnouncer()).toHaveTextContent('Now showing v4.'),
    );
    const canvas = screen.getByTestId('canvas');
    // The same picture, glided to: the key stays, the changed nodes ring.
    expect(canvas).toHaveAttribute('data-layout-key', 'billing/dunning:latest');
    expect(canvas).toHaveAttribute('data-changed', 'notify,summary');
    // The open node is still there, so it stays open.
    expect(inspector()).not.toBeNull();
  });

  it('closes the open node when the newer version no longer has it', async () => {
    state.document = twoNodes;
    const { user, rerender } = renderPage();
    await user.click(screen.getByRole('button', { name: 'select notify' }));
    expect(inspector()).not.toBeNull();

    state.version = 4;
    state.document = { ...twoNodes, nodes: twoNodes.nodes.slice(0, 1) };
    rerender(page());

    await waitFor(() =>
      expect(canvasAnnouncer()).toHaveTextContent(
        'Now showing v4. Notify is no longer in this version.',
      ),
    );
    expect(inspector()).toBeNull();
  });

  it('says nothing new about the version this tab saved', async () => {
    const { user, rerender } = renderPage();
    await editTheNode(user);
    await user.click(saveButton());
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(saveMutation.mutateAsync).toHaveBeenCalled());

    state.version = 4;
    rerender(page());
    expect(canvasAnnouncer()).toHaveTextContent('');
    expect(
      screen.queryByRole('button', { name: /discard my draft/ }),
    ).toBeNull();
  });

  it('leaves a draft where it is and offers the newer version', async () => {
    const { user, rerender } = renderPage();
    await editTheNode(user);

    state.version = 4;
    state.document = twoNodes;
    rerender(page());

    expect(screen.getByText('A newer version was saved')).toBeVisible();
    expect(
      screen.getByText(
        'v4 was saved while you were editing. Your draft is based on v3.',
      ),
    ).toBeVisible();
    // Nothing on the canvas moved: the draft is still what it shows.
    expect(screen.queryByRole('button', { name: 'select notify' })).toBeNull();
    expect(screen.getByTestId('canvas')).not.toHaveAttribute('data-changed');
    expect(whenField()).toHaveValue('x');

    await user.click(
      screen.getByRole('button', { name: 'Show v4 and discard my draft' }),
    );
    expect(
      await screen.findByRole('button', { name: 'select notify' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('A newer version was saved')).toBeNull();
    expect(saveButton()).toBeDisabled();
  });

  it('opens the node a link names, and keeps the open node in the link', async () => {
    const onSearchChange = vi.fn();
    const { user } = renderPage({ node: 'summary', onSearchChange });
    expect(inspector()).not.toBeNull();
    expect(onSearchChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'deselect' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ node: null });
    await user.click(screen.getByRole('button', { name: 'select summary' }));
    expect(onSearchChange).toHaveBeenLastCalledWith({ node: 'summary' });
  });

  it('opens a node at its condition when the condition is picked', async () => {
    state.document = twoNodes;
    const { user } = renderPage();
    await user.click(
      screen.getByRole('button', { name: 'select the condition of notify' }),
    );
    expect(inspector()).not.toBeNull();
    await waitFor(() => expect(whenField()).toHaveFocus());
  });

  it('switches between the chart and the List view and keeps it in the link', async () => {
    const onSearchChange = vi.fn();
    const { user } = renderPage({ view: 'list', onSearchChange });
    const canvas = screen.getByTestId('canvas');
    expect(canvas).toHaveAttribute('data-view', 'list');

    const views = within(screen.getByTestId('canvas-top-start')).getByRole(
      'radiogroup',
      { name: 'View' },
    );
    await user.click(within(views).getByRole('radio', { name: 'Canvas' }));
    expect(canvas).toHaveAttribute('data-view', 'chart');
    expect(onSearchChange).toHaveBeenLastCalledWith({ view: 'canvas' });
  });

  it('puts the coding-agent entry among the canvas verbs for an author', () => {
    renderPage();
    expect(
      within(screen.getByTestId('canvas-top-end')).getByRole('button', {
        name: 'Edit with your coding agent',
      }),
    ).toBeInTheDocument();
  });

  it('offers no coding-agent entry to a member', () => {
    validationMock.canAuthor = false;
    renderPage();
    expect(
      screen.queryByRole('button', { name: 'Edit with your coding agent' }),
    ).toBeNull();
  });
});
