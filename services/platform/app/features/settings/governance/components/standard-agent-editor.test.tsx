import {
  ActiveEditorProvider,
  DirtyBlockerProvider,
  EditorActions,
  EditorGroup,
  useActiveEditor,
} from '@tale/ui/editor';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { render, screen, waitFor } from '@/tests/utils/render';

import { StandardAgentEditor } from './standard-agent-editor';

type Availability = ReturnsOf<'projects/queries:getStandardAgent'>;

const { state, saved, refetch } = vi.hoisted(() => ({
  saved: vi.fn(),
  refetch: vi.fn(),
  state: {
    config: {} as unknown,
    hasPolicy: true,
    policyError: undefined as unknown,
    canEdit: true,
    availability: undefined as Availability | undefined,
  },
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.canEdit }),
}));
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: saved, isPending: false }),
}));
vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data:
      state.policyError !== undefined
        ? undefined
        : state.hasPolicy
          ? { config: state.config }
          : null,
    error: state.policyError,
    isLoading: false,
    isError: state.policyError !== undefined,
    isFetching: false,
    refetch,
  }),
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectHarnesses: () => ({
    data: {
      harnesses: [
        { harness: 'claude-code', label: 'Claude Code' },
        { harness: 'codex', label: 'Codex' },
      ],
      models: [
        {
          id: 'claude-sonnet-5',
          label: 'Claude Sonnet 5',
          providerSlug: 'anthropic',
          providerLabel: 'Anthropic',
          credential: { authMethod: 'api-key' },
        },
        {
          id: 'gpt-5.5',
          label: 'GPT-5.5',
          providerSlug: 'openai',
          providerLabel: 'OpenAI',
          credential: { authMethod: 'api-key' },
        },
      ],
    },
  }),
  useStandardAgent: () => state.availability,
}));

const TOGGLE = 'Provide a standard agent';
const HARNESS = 'Agent type';
const MODEL = 'Model';

function HeaderActions() {
  const editor = useActiveEditor();
  return editor ? <EditorActions controller={editor} /> : null;
}

async function renderEditor() {
  const root = createRootRoute({ component: Outlet });
  const route = createRoute({
    getParentRoute: () => root,
    path: '/dashboard/$id/settings/governance/content-models',
    component: () => (
      <DirtyBlockerProvider>
        <ActiveEditorProvider>
          <HeaderActions />
          <EditorGroup>
            <StandardAgentEditor organizationId="org-standard" />
          </EditorGroup>
        </ActiveEditorProvider>
      </DirtyBlockerProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [
        '/dashboard/org-standard/settings/governance/content-models',
      ],
    }),
  });
  const result = render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Standard agent' });
  return result;
}

beforeEach(() => {
  saved.mockReset().mockResolvedValue(null);
  refetch.mockReset();
  state.config = {};
  state.hasPolicy = true;
  state.policyError = undefined;
  state.canEdit = true;
  state.availability = {
    enabled: true,
    available: true,
    harness: 'claude-code',
    harnessLabel: 'Claude Code',
    model: 'claude-sonnet-5',
    modelLabel: 'Claude Sonnet 5',
    modelProvider: 'anthropic',
    source: 'preferred',
  };
});

describe('standard agent settings', () => {
  it('is on without a policy file, everything automatic, and says what it runs on for you', async () => {
    state.hasPolicy = false;
    await renderEditor();

    expect(screen.getByRole('switch', { name: TOGGLE })).toBeChecked();
    expect(screen.getByRole('button', { name: HARNESS })).toHaveTextContent(
      'Automatic',
    );
    expect(screen.getByRole('button', { name: MODEL })).toHaveTextContent(
      'Automatic',
    );
    expect(
      screen.getByText('For you, it runs on Claude Code with Claude Sonnet 5.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches off at once, keeping its saved choices', async () => {
    state.config = {
      enabled: true,
      harness: 'codex',
      providerSlug: 'openai',
      modelId: 'gpt-5.5',
    };
    const { user } = await renderEditor();

    await user.click(screen.getByRole('switch', { name: TOGGLE }));

    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-standard',
        policyType: 'standard_agent',
        config: {
          enabled: false,
          harness: 'codex',
          providerSlug: 'openai',
          modelId: 'gpt-5.5',
        },
      }),
    );
  });

  it('pins an agent type, a model and instructions through Save', async () => {
    state.config = { enabled: true };
    const { user } = await renderEditor();

    await user.click(screen.getByRole('button', { name: HARNESS }));
    await user.click(screen.getByRole('option', { name: 'Codex' }));
    await user.click(screen.getByRole('button', { name: MODEL }));
    await user.click(screen.getByRole('option', { name: 'OpenAI · GPT-5.5' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Instructions' }),
      'Write in the house style.',
    );
    expect(
      screen.getByText('Save to apply these settings.'),
    ).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-standard',
        policyType: 'standard_agent',
        config: {
          enabled: true,
          harness: 'codex',
          providerSlug: 'openai',
          modelId: 'gpt-5.5',
          instructions: 'Write in the house style.',
        },
      }),
    );
  });

  it('says why it cannot run for you, with the way to AI providers', async () => {
    state.config = { enabled: true };
    state.availability = {
      enabled: true,
      available: false,
      refusal: 'no-model',
    };
    await renderEditor();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No model you can use can run the standard agent.',
    );
    expect(screen.getByRole('link', { name: 'AI providers' })).toHaveAttribute(
      'href',
      '/dashboard/org-standard/settings/providers',
    );
  });

  it('offers to repair a malformed file instead of locking the section', async () => {
    state.policyError = new BackendApiError(
      400,
      'invalid',
      'GOVERNANCE_POLICY_INVALID',
    );
    await renderEditor();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The saved standard agent settings are invalid.',
    );
    expect(screen.getByRole('switch', { name: TOGGLE })).toBeEnabled();
  });

  it('explains what switching it off means while it is off', async () => {
    state.config = { enabled: false };
    await renderEditor();

    expect(screen.getByRole('switch', { name: TOGGLE })).not.toBeChecked();
    expect(
      screen.getByText(/projects without agents of their own offer no agent/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: MODEL }),
    ).not.toBeInTheDocument();
  });
});
