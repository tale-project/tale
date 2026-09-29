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

import { ImageGenerationEditor } from './image-generation-editor';

type ImageState =
  ReturnsOf<'lib/providers/image_generation_actions:getImageGenerationState'>;

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
    image: { enabled: false, models: [], pick: null } as ImageState,
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
  useImageGenerationState: () => ({
    data: state.loading ? undefined : state.image,
    isLoading: state.loading,
    isError: state.readFailed,
    isFetching: false,
    refetch,
  }),
}));

const TOGGLE = 'Let agents generate images';
const PICKER = 'Image model';

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
            <ImageGenerationEditor organizationId="org-images" />
          </EditorGroup>
        </ActiveEditorProvider>
      </DirtyBlockerProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: [
        '/dashboard/org-images/settings/governance/content-models',
      ],
    }),
  });
  const result = render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Image generation' });
  return result;
}

const MODELS: ImageState['models'] = [
  {
    providerSlug: 'openrouter',
    providerDisplayName: 'OpenRouter',
    modelId: 'google/gemini-2.5-flash-image',
  },
  {
    providerSlug: 'openai',
    providerDisplayName: 'OpenAI',
    modelId: 'gpt-image-1',
  },
];

beforeEach(() => {
  saved.mockReset().mockResolvedValue(null);
  refetch.mockReset();
  state.config = {};
  state.hasPolicy = true;
  state.loading = false;
  state.readFailed = false;
  state.policyReadFailed = false;
  state.canEdit = true;
  state.image = {
    enabled: false,
    models: MODELS,
    pick: {
      providerSlug: 'openrouter',
      modelId: 'google/gemini-2.5-flash-image',
      source: 'preferred',
    },
  };
});

describe('image generation settings', () => {
  it('is off without a policy file, with no model row and no warning', async () => {
    state.hasPolicy = false;
    await renderEditor();
    expect(screen.getByRole('switch', { name: TOGGLE })).not.toBeChecked();
    expect(
      screen.queryByRole('button', { name: PICKER }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Chat never creates images/)).toBeInTheDocument();
  });

  it('turns image generation on at once, keeping a saved model choice', async () => {
    state.config = {
      enabled: false,
      providerSlug: 'openai',
      modelId: 'gpt-image-1',
    };
    const { user } = await renderEditor();
    await user.click(screen.getByRole('switch', { name: TOGGLE }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-images',
        policyType: 'image_generation',
        config: {
          enabled: true,
          providerSlug: 'openai',
          modelId: 'gpt-image-1',
        },
      }),
    );
  });

  it('shows Automatic and what a turn would use while on', async () => {
    state.config = { enabled: true };
    state.image = { ...state.image, enabled: true };
    await renderEditor();
    expect(screen.getByRole('switch', { name: TOGGLE })).toBeChecked();
    expect(screen.getByRole('button', { name: PICKER })).toHaveTextContent(
      'Automatic',
    );
    expect(
      screen.getByText(
        'Agents currently generate images with openrouter · google/gemini-2.5-flash-image, the recommended choice.',
      ),
    ).toBeInTheDocument();
  });

  it('pins a listed model through Save, keeping the policy on', async () => {
    state.config = { enabled: true };
    state.image = { ...state.image, enabled: true };
    const { user } = await renderEditor();
    await user.click(screen.getByRole('button', { name: PICKER }));
    await user.click(
      screen.getByRole('option', { name: 'OpenAI · gpt-image-1' }),
    );
    expect(
      screen.getByText('Save to apply this selection.'),
    ).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-images',
        policyType: 'image_generation',
        config: {
          enabled: true,
          providerSlug: 'openai',
          modelId: 'gpt-image-1',
        },
      }),
    );
  });

  it('keeps an unavailable pin visible and says agents get no image tool', async () => {
    state.config = {
      enabled: true,
      providerSlug: 'removed-provider',
      modelId: 'old-image-model',
    };
    state.image = {
      enabled: true,
      models: MODELS,
      pick: null,
      error: { code: 'IMAGE_GENERATION_MODEL_UNAVAILABLE' },
    };
    const { user } = await renderEditor();
    const picker = screen.getByRole('button', { name: PICKER });
    expect(picker).toHaveTextContent('removed-provider · old-image-model');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'agents get no image tool',
    );
    expect(screen.getByRole('link', { name: 'AI providers' })).toHaveAttribute(
      'href',
      '/dashboard/org-images/settings/providers',
    );
    await user.click(picker);
    expect(
      screen.getByRole('option', {
        name: /removed-provider · old-image-model/,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('explains that no recommended model is reachable only while on', async () => {
    state.image = {
      enabled: false,
      models: [],
      pick: null,
      error: { code: 'NO_IMAGE_GENERATION_MODEL' },
    };
    await renderEditor();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    [
      'NO_IMAGE_GENERATION_MODEL',
      'None of the recommended image models is available',
    ],
    [
      'IMAGE_GENERATION_RESOLUTION_FAILED',
      'Tale could not check the image model.',
    ],
  ])('explains %s while on', async (code, message) => {
    state.config = { enabled: true };
    state.image = { enabled: true, models: [], pick: null, error: { code } };
    await renderEditor();
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('offers the repair of a malformed file the strict policy read refuses', async () => {
    state.policyReadFailed = true;
    state.image = {
      enabled: false,
      models: MODELS,
      pick: null,
      error: { code: 'IMAGE_GENERATION_POLICY_INVALID' },
    };
    const { user } = await renderEditor();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Switch image generation off and on',
    );
    const toggle = screen.getByRole('switch', { name: TOGGLE });
    expect(toggle).toBeEnabled();
    await user.click(toggle);
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        organizationId: 'org-images',
        policyType: 'image_generation',
        config: { enabled: true },
      }),
    );
  });

  it('does not let a switch flip over a policy that cannot be read', async () => {
    state.hasPolicy = false;
    state.image = {
      enabled: false,
      models: [],
      pick: null,
      error: { code: 'IMAGE_GENERATION_POLICY_UNAVAILABLE' },
    };
    await renderEditor();
    expect(screen.getByRole('switch', { name: TOGGLE })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Retry before changing it.',
    );
  });

  it('shows read-only viewers the state without a switch they can use', async () => {
    state.canEdit = false;
    state.config = { enabled: true };
    state.image = { ...state.image, enabled: true };
    await renderEditor();
    expect(screen.getByRole('switch', { name: TOGGLE })).toBeDisabled();
    expect(screen.getByRole('button', { name: PICKER })).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Save' }),
    ).not.toBeInTheDocument();
  });

  it('uses one busy region while the policy or the models load', async () => {
    state.loading = true;
    await renderEditor();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
