import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { PiiConfig } from './pii-config';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Hoisted so the save spy is inspectable across renders (each render must see
// the SAME `mutateAsync`, not a fresh `vi.fn()`) — mirrors
// `moderation-provider-config.test.tsx`.
const { saveMutateAsync } = vi.hoisted(() => ({
  saveMutateAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({
    mutateAsync: saveMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded. The
// PII panel only mounts once `enabled`, so the loaded fixture keeps it off —
// the enable Switch is the data-bearing control under test.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    policy: {
      enabled: false,
      config: { mode: 'tokenize', enabledPatterns: [], customPatterns: [] },
    } as Record<string, unknown> | undefined,
  },
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : state.policy,
    isLoading: state.isLoading,
  }),
}));

function setLoaded() {
  state.isLoading = false;
  state.policy = {
    enabled: false,
    config: { mode: 'tokenize', enabledPatterns: [], customPatterns: [] },
  };
}
function setLoading() {
  state.isLoading = true;
  state.policy = undefined;
}
function setConfigured() {
  state.isLoading = false;
  state.policy = {
    enabled: false,
    config: {
      mode: 'block',
      enabledPatterns: ['email'],
      customPatterns: [],
    },
  };
}

describe('PiiConfig', () => {
  // #2656: enabling with nothing configured yet used to persist
  // `enabledPatterns: []` — a silent no-op. First enable must now seed the
  // universal pattern set and the documented `mask` default.
  describe('seed universal patterns on first enable (#2656)', () => {
    it('seeds the default pattern set + mask mode when enabling with no patterns configured', async () => {
      setLoaded();
      saveMutateAsync.mockClear();
      const { user } = render(<PiiConfig organizationId="org-1" />);
      await user.click(screen.getByRole('switch'));
      expect(saveMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          policyType: 'pii_config',
          config: expect.objectContaining({
            enabled: true,
            mode: 'mask',
            enabledPatterns: [
              'email',
              'phone',
              'creditCard',
              'cvc',
              'iban',
              'ssn',
              'nationalId',
            ],
          }),
        }),
      );
    });

    it('does not override an already-configured pattern set/mode when enabling', async () => {
      setConfigured();
      saveMutateAsync.mockClear();
      const { user } = render(<PiiConfig organizationId="org-1" />);
      await user.click(screen.getByRole('switch'));
      expect(saveMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          policyType: 'pii_config',
          config: expect.objectContaining({
            enabled: true,
            mode: 'block',
            enabledPatterns: ['email'],
          }),
        }),
      );
    });
  });

  describe('loaded state', () => {
    it('renders the real enable switch (in the a11y tree)', () => {
      setLoaded();
      render(<PiiConfig organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<PiiConfig organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /pii protection/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<PiiConfig organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<PiiConfig organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live switch while loading)', () => {
      setLoading();
      render(<PiiConfig organizationId="org-1" />);
      // The masked switch renders as an aria-hidden box → out of the a11y tree.
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<PiiConfig organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /pii protection/i }),
      ).toBeInTheDocument();
    });
  });
});
