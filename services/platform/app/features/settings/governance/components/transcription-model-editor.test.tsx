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

import type { ReturnsOf } from '@/app/lib/backend/contract';
import { render, screen, waitFor } from '@/tests/utils/render';

import { TranscriptionModelEditor } from './transcription-model-editor';

type ModelState =
  ReturnsOf<'lib/providers/transcription_actions:getTranscriptionModelState'>;

const { state, saved, refetch } = vi.hoisted(() => ({
  saved: vi.fn(),
  refetch: vi.fn(),
  state: {
    config: {} as unknown,
    hasPolicy: true,
    loading: false,
    readFailed: false,
    policyReadFailed: false,
    canEdit: true,
    models: { models: [], pick: null } as ModelState,
  },
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.canEdit }),
}));
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: saved }),
}));
vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data:
      state.loading || state.policyReadFailed
        ? undefined
        : state.hasPolicy
          ? { config: state.config }
          : null,
    isLoading: state.loading,
    isError: state.policyReadFailed,
    isFetching: false,
    refetch,
  }),
  useTranscriptionModelState: () => ({
    data: state.loading ? undefined : state.models,
    isLoading: state.loading,
    isError: state.readFailed,
    isFetching: false,
    refetch,
  }),
}));

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
            <TranscriptionModelEditor organizationId="org-audio" />
          </EditorGroup>
        </ActiveEditorProvider>
      </DirtyBlockerProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [
        '/dashboard/org-audio/settings/governance/content-models',
      ],
    }),
  });
  const result = render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Audio transcription model' });
  return result;
}

beforeEach(() => {
  saved.mockReset().mockResolvedValue(null);
  refetch.mockReset();
  state.config = {};
  state.hasPolicy = true;
  state.loading = false;
  state.readFailed = false;
  state.policyReadFailed = false;
  state.canEdit = true;
  state.models = {
    models: [
      {
        providerSlug: 'local-audio',
        providerDisplayName: 'Local audio',
        modelId: 'opaque-model-id',
      },
    ],
    pick: {
      providerSlug: 'local-audio',
      modelId: 'opaque-model-id',
      source: 'automatic',
    },
  };
});

describe('audio model settings', () => {
  it.each([true, false])(
    'shows Automatic and its real pick with policy present=%s',
    async (hasPolicy) => {
      state.hasPolicy = hasPolicy;
      await renderEditor();
      expect(
        screen.getByRole('button', { name: 'Model that transcribes audio' }),
      ).toBeEnabled();
      expect(
        screen.getByText(
          'Currently transcribing audio with local-audio · opaque-model-id.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Browser speech recognition uses its own model/),
      ).toBeInTheDocument();
    },
  );

  it('offers the server candidates without assuming a vendor, model name or vision catalog', async () => {
    const { user } = await renderEditor();
    await user.click(
      screen.getByRole('button', { name: 'Model that transcribes audio' }),
    );
    await user.click(
      screen.getByRole('option', { name: 'Local audio · opaque-model-id' }),
    );
    expect(
      screen.getByText('Save to apply this selection.'),
    ).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(
      screen.getByRole('button', { name: 'Model that transcribes audio' }),
    ).toBeEnabled();
  });

  it('keeps an unavailable saved pin visible and offers a repair route', async () => {
    state.config = { providerSlug: 'removed-provider', modelId: 'old-audio' };
    state.models = {
      models: [],
      pick: null,
      error: { code: 'TRANSCRIPTION_MODEL_UNAVAILABLE' },
    };
    const { user } = await renderEditor();
    const picker = screen.getByRole('button', {
      name: 'Model that transcribes audio',
    });
    expect(picker).toBeEnabled();
    expect(picker).toHaveTextContent('removed-provider · old-audio');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tale will not switch to another model',
    );
    expect(screen.getByRole('link', { name: 'AI providers' })).toHaveAttribute(
      'href',
      '/dashboard/org-audio/settings/providers',
    );
    await user.click(picker);
    expect(
      screen.getByRole('option', { name: /removed-provider · old-audio/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: /^Automatic/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-audio',
        policyType: 'transcription_model',
        config: {},
      }),
    );
  });

  it('does not present malformed saved config as Automatic', async () => {
    state.config = { providerSlug: 'local-audio' };
    state.models = {
      models: [],
      pick: null,
      error: { code: 'TRANSCRIPTION_MODEL_POLICY_INVALID' },
    };
    await renderEditor();
    expect(
      screen.getByRole('button', { name: 'Model that transcribes audio' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Model that transcribes audio' }),
    ).toHaveTextContent('Invalid saved configuration');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose a model or Automatic and save to repair it.',
    );
  });

  it('does not assume Automatic while the saved policy cannot be read', async () => {
    state.hasPolicy = false;
    state.models = {
      models: [],
      pick: null,
      error: { code: 'TRANSCRIPTION_MODEL_POLICY_UNAVAILABLE' },
    };
    const { user } = await renderEditor();
    expect(
      screen.getByRole('button', { name: 'Model that transcribes audio' }),
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Retry before changing it.',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('can explicitly repair a malformed file after the strict policy GET refuses it', async () => {
    state.policyReadFailed = true;
    state.models = {
      models: [],
      pick: null,
      error: { code: 'TRANSCRIPTION_MODEL_POLICY_INVALID' },
    };
    const { user } = await renderEditor();
    const picker = screen.getByRole('button', {
      name: 'Model that transcribes audio',
    });
    expect(picker).toHaveTextContent('Invalid saved configuration');
    await user.click(picker);
    await user.click(screen.getByRole('option', { name: /^Automatic/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-audio',
        policyType: 'transcription_model',
        config: {},
      }),
    );
  });

  it('distinguishes a failed read from no available model, hiding stale resolved details', async () => {
    state.readFailed = true;
    await renderEditor();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the audio model settings.",
    );
    expect(
      screen.queryByText(/Currently transcribing audio/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/No audio transcription model is available/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Model that transcribes audio' }),
    ).toBeDisabled();
  });

  it.each([
    ['NO_TRANSCRIPTION_MODEL', 'No audio transcription model is available.'],
    [
      'TRANSCRIPTION_MODEL_RESOLUTION_FAILED',
      'Tale could not check the audio transcription model.',
    ],
  ])('explains %s separately', async (code, message) => {
    state.models = { models: [], pick: null, error: { code } };
    await renderEditor();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('shows readonly viewers the saved state without registering Save or Discard', async () => {
    state.canEdit = false;
    await renderEditor();
    expect(
      screen.getByRole('button', { name: 'Model that transcribes audio' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Discard' }),
    ).not.toBeInTheDocument();
  });

  it('uses one busy region while the policy or candidates load', async () => {
    state.loading = true;
    await renderEditor();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
