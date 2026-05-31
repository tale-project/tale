import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { VoiceOutputPolicyEditor } from './voice-output-policy-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true } as Record<string, unknown> | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

function setLoaded() {
  state.isLoading = false;
  state.config = { enabled: true };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('VoiceOutputPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the real switch (in the a11y tree)', () => {
      setLoaded();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /voice/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the switch (no live switch while loading)', () => {
      setLoading();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      // The skeleton-aware Switch renders a masked box instead of the control.
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bars)', () => {
      setLoading();
      render(<VoiceOutputPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /voice/i }),
      ).toBeInTheDocument();
    });
  });
});
