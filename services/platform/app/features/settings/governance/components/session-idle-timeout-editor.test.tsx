import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { SessionIdleTimeoutEditor } from './session-idle-timeout-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true, idleTimeoutMinutes: 30 } as
      | Record<string, unknown>
      | undefined,
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
  state.config = { enabled: true, idleTimeoutMinutes: 30 };
}
function setDisabled() {
  state.isLoading = false;
  state.config = { enabled: false, idleTimeoutMinutes: 30 };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('SessionIdleTimeoutEditor', () => {
  describe('loaded state', () => {
    it('renders the enable switch and the batched minutes input', () => {
      setLoaded();
      render(<SessionIdleTimeoutEditor organizationId="org-1" />);
      // Header enable switch.
      expect(screen.getAllByRole('switch')).toHaveLength(1);
      // The single idleTimeoutMinutes number field.
      expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<SessionIdleTimeoutEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /session idle timeout/i }),
      ).toBeInTheDocument();
    });

    it('hides the minutes field while the policy is disabled', () => {
      setDisabled();
      render(<SessionIdleTimeoutEditor organizationId="org-1" />);
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<SessionIdleTimeoutEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch/input while loading)', () => {
      setLoading();
      render(<SessionIdleTimeoutEditor organizationId="org-1" />);
      // The header switch masks to a SkeletonBox (no role=switch); the gated
      // minutes field is not rendered while `enabled` is false during loading.
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<SessionIdleTimeoutEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /session idle timeout/i }),
      ).toBeInTheDocument();
    });
  });
});
