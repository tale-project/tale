import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { VisionModelEditor } from './vision-model-editor';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mutable + hoisted so the mock factories can read it (vi.mock hoists above
// imports). `state` drives the policy row, the provider catalog, and the
// resolved pick the editor renders next to Automatic.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: {} as Record<string, unknown> | undefined,
    resolved: {
      providerSlug: 'openrouter',
      modelId: 'qwen/qwen3-vl-32b-instruct',
      source: 'preferred',
    } as Record<string, unknown> | null | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
  useResolvedVisionModel: () => ({ data: state.resolved }),
}));

vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useProviderCatalogs: () => ({
    data: [
      {
        name: 'openrouter',
        displayName: 'OpenRouter',
        models: [
          {
            id: 'qwen/qwen3-vl-32b-instruct',
            tags: ['chat', 'vision'],
            supportsVision: true,
          },
          // Ineligible: a media generator would reproduce the very outage the
          // pin exists to prevent, so it must not be offerable.
          {
            id: 'google/lyria-3-clip-preview',
            tags: ['chat', 'vision'],
            supportsVision: true,
            outputsMedia: true,
          },
          // Ineligible: text-only.
          { id: 'deepseek/deepseek-v4', tags: ['chat'], supportsVision: false },
        ],
      },
    ],
  }),
}));

function setLoaded(config: Record<string, unknown> = {}) {
  state.isLoading = false;
  state.config = config;
}

describe('VisionModelEditor', () => {
  it('renders the section heading and the picker once loaded', () => {
    setLoaded();
    render(<VisionModelEditor organizationId="org-1" />);
    expect(
      screen.getByRole('heading', { name: /vision model/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains what Automatic currently resolves to, and why', () => {
    // Automatic without this line reads as a shrug — the pick is invisible
    // everywhere else in the product.
    setLoaded();
    render(<VisionModelEditor organizationId="org-1" />);
    expect(
      screen.getByText(/openrouter · qwen\/qwen3-vl-32b-instruct/),
    ).toBeInTheDocument();
    expect(screen.getByText(/recommended choice/i)).toBeInTheDocument();
  });

  it('says so plainly when nothing reachable can read images', () => {
    setLoaded();
    state.resolved = null;
    render(<VisionModelEditor organizationId="org-1" />);
    expect(
      screen.getByText(/No model your credentials reach/i),
    ).toBeInTheDocument();
    state.resolved = {
      providerSlug: 'openrouter',
      modelId: 'qwen/qwen3-vl-32b-instruct',
      source: 'preferred',
    };
  });

  it('shows the pinned model instead of the Automatic explanation', () => {
    setLoaded({
      providerSlug: 'openrouter',
      modelId: 'qwen/qwen3-vl-32b-instruct',
    });
    render(<VisionModelEditor organizationId="org-1" />);
    // A reader who pinned the model does not need to be told what Auto would
    // have done.
    expect(screen.queryByText(/recommended choice/i)).not.toBeInTheDocument();
  });

  it('offers only models that can actually transcribe', async () => {
    setLoaded();
    const { user } = render(<VisionModelEditor organizationId="org-1" />);
    // The trigger is a button labelled by the value it shows; the popover's
    // search input is the combobox.
    await user.click(screen.getByRole('button', { name: 'Automatic' }));
    expect(
      screen.getByRole('option', { name: /qwen3-vl-32b-instruct/ }),
    ).toBeInTheDocument();
    // The media generator and the text-only model are filtered out.
    expect(screen.queryByText(/lyria/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deepseek-v4/)).not.toBeInTheDocument();
  });

  it('exposes one busy region while the policy loads', () => {
    state.isLoading = true;
    state.config = undefined;
    render(<VisionModelEditor organizationId="org-1" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    setLoaded();
  });
});
