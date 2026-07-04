import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Entry point is exported as `ModerationProviderConfigView` (the guardrails
// route imports that name); it is the container that owns data + Skeletonize.
import { ModerationProviderConfigView } from './moderation-provider-config';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Hoisted so the save spy is inspectable across renders (each render must see
// the SAME `mutateAsync`, not a fresh `vi.fn()`).
const { saveMutateAsync } = vi.hoisted(() => ({
  saveMutateAsync: vi.fn().mockResolvedValue(null),
}));

// `ApiKeyPanel` / `TestConnectionPanel` only mount once enabled, so their
// secret/test hooks are never called in these fixtures — stubbed so the module
// mock stays complete.
vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: saveMutateAsync,
    isPending: false,
  }),
  useSaveModerationSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestModerationProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// Mutable, hoisted so the mock factory can read it. The conditional sections
// only render once `enabled`, so the loaded fixture keeps the provider off —
// the enable Switch is the data-bearing control under test.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    policy: { enabled: false, config: { enabled: false } } as
      | Record<string, unknown>
      | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : state.policy,
    isLoading: state.isLoading,
  }),
  useModerationSecretStatus: () => ({ data: null, isLoading: false }),
}));

function setLoaded() {
  state.isLoading = false;
  state.policy = { enabled: false, config: { enabled: false } };
}
function setLoading() {
  state.isLoading = true;
  state.policy = undefined;
}

describe('ModerationProviderConfig', () => {
  beforeEach(() => {
    saveMutateAsync.mockClear();
  });

  // #2344: enabling the provider before an endpoint URL is configured used to
  // autosave, fail the server-side Zod gate (`endpoint.url` must be a valid
  // URL), and silently revert with a raw ConvexError toast. The toggle must now
  // defer the save and surface an inline hint instead.
  describe('enable without a configured endpoint (#2344)', () => {
    it('does not autosave the enable when the endpoint URL is missing', async () => {
      setLoaded();
      const { user } = render(
        <ModerationProviderConfigView organizationId="org-1" />,
      );
      await user.click(screen.getByRole('switch'));
      expect(saveMutateAsync).not.toHaveBeenCalled();
    });

    it('expands the config with an inline endpoint hint', async () => {
      setLoaded();
      const { user } = render(
        <ModerationProviderConfigView organizationId="org-1" />,
      );
      await user.click(screen.getByRole('switch'));
      expect(screen.getByText(/set an endpoint first/i)).toBeInTheDocument();
    });
  });

  describe('loaded state', () => {
    it('renders the real enable switch (in the a11y tree)', () => {
      setLoaded();
      render(<ModerationProviderConfigView organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<ModerationProviderConfigView organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /moderation provider/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<ModerationProviderConfigView organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<ModerationProviderConfigView organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch while loading)', () => {
      setLoading();
      render(<ModerationProviderConfigView organizationId="org-1" />);
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<ModerationProviderConfigView organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /moderation provider/i }),
      ).toBeInTheDocument();
    });
  });
});
