import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

// The banners read async Convex data and the drawer mounts a Sheet — neither
// is the subject here, so stub them. Both banners self-hide when their reads
// return no data (the real loading behaviour), so a null stub matches the
// initial skeleton pass.
vi.mock('./retention-bounds-proposal-banner', () => ({
  RetentionBoundsProposalBanner: () => null,
}));
vi.mock('./retention-pending-banner', () => ({
  RetentionPendingBanner: () => null,
}));
vi.mock('./retention-edit-drawer', () => ({
  RetentionEditDrawer: () => null,
}));

// Mutable, hoisted so the mock factories can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { documentsRetentionDays: 90 } as
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

vi.mock('../hooks/use-retention-bounds', () => ({
  useRetentionBounds: () => ({
    bounds: new Map(),
    retentionDisabled: false,
    isLoading: state.isLoading,
  }),
}));

const { RetentionEditor } = await import('./retention-editor');

function setLoaded() {
  state.isLoading = false;
  state.config = { documentsRetentionDays: 90 };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('RetentionEditor', () => {
  describe('loaded state', () => {
    it('renders the real summary definition list', () => {
      setLoaded();
      const { container } = render(<RetentionEditor organizationId="org-1" />);
      // The real summary renders a <dl>; the masked stand-in also uses a <dl>,
      // so assert the live timeline (role=img) which only the real summary has.
      expect(container.querySelector('dl')).toBeInTheDocument();
      expect(screen.getByRole('img')).toBeInTheDocument();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<RetentionEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /retention policy/i }),
      ).toBeInTheDocument();
    });

    it('exposes a real Edit action button once loaded', () => {
      setLoaded();
      render(<RetentionEditor organizationId="org-1" />);
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<RetentionEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<RetentionEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('keeps the real section heading while loading (no gray bars)', () => {
      setLoading();
      render(<RetentionEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /retention policy/i }),
      ).toBeInTheDocument();
    });

    it('masks the summary (no live timeline) while loading', () => {
      setLoading();
      render(<RetentionEditor organizationId="org-1" />);
      // The masked summary stand-in does not render the timeline image.
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('masks the Edit action button while loading', () => {
      setLoading();
      render(<RetentionEditor organizationId="org-1" />);
      // The masked button is aria-hidden, so it leaves the a11y tree.
      expect(
        screen.queryByRole('button', { name: /edit/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('structural parity (masked summary mirrors real one)', () => {
    it('renders the same number of definition-list rows in both states', () => {
      setLoaded();
      const loaded = render(<RetentionEditor organizationId="org-1" />);
      const loadedRows = loaded.container.querySelectorAll('dl > div').length;
      loaded.unmount();

      setLoading();
      const loading = render(<RetentionEditor organizationId="org-1" />);
      const loadingRows = loading.container.querySelectorAll('dl > div').length;

      expect(loadingRows).toBe(loadedRows);
      expect(loadedRows).toBeGreaterThan(0);
    });
  });
});
