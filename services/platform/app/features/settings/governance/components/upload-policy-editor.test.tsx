import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { UploadPolicyEditor } from './upload-policy-editor';

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => true,
    cannot: () => false,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
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

describe('UploadPolicyEditor', () => {
  describe('loaded state', () => {
    it('renders the enable toggle', () => {
      setLoaded();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    // Query by ROLE + accessible name, not `getByLabelText`: each field is a
    // settings-field row whose own wrapper is `aria-labelledby` the same label
    // span the control names itself from, so a label-text lookup matches both
    // the row and the control.
    it('renders file extension input', () => {
      setLoaded();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('textbox', { name: /allowed file extensions/i }),
      ).toBeDefined();
    });

    it('renders max file size input', () => {
      setLoaded();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('spinbutton', { name: /maximum file size/i }),
      ).toBeDefined();
    });

    it('renders max volume input', () => {
      setLoaded();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('spinbutton', { name: /maximum total volume/i }),
      ).toBeDefined();
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /upload/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('spans the full settings section so Discard/Save share the Edit edge', () => {
      // Regression: max-w-2xl left the form + action cluster narrower than
      // Retention's Edit on the same Policies & limits page. Only a wrapper
      // around the whole form can do that, so the assertion is scoped to the
      // form and its direct children — a settings-field row caps its own label
      // column at max-w-2xl by design, which leaves the form full width.
      setLoaded();
      const { container } = render(
        <UploadPolicyEditor organizationId="org-1" />,
      );
      const form = container.querySelector('form');
      expect(form).not.toBeNull();
      expect(form?.className).not.toContain('max-w-2xl');
      expect(form?.querySelector(':scope > .max-w-2xl')).toBeNull();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the enable toggle (no live switch while loading)', () => {
      setLoading();
      render(<UploadPolicyEditor organizationId="org-1" />);
      // The skeleton-aware Switch renders a masked box instead of the control.
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bars)', () => {
      setLoading();
      render(<UploadPolicyEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /upload/i }),
      ).toBeInTheDocument();
    });
  });
});
