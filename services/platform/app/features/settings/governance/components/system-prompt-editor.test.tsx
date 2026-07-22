import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SystemPromptEditor } from './system-prompt-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Mutable, hoisted so the mock factory can read it (vi.mock is hoisted above
// imports). Toggling `state` flips the editor between loading and loaded.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { mandatoryPrefixPrompt: '', mandatorySuffixPrompt: '' } as
      | Record<string, string>
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
  state.config = { mandatoryPrefixPrompt: '', mandatorySuffixPrompt: '' };
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

describe('SystemPromptEditor', () => {
  describe('loaded state', () => {
    it('renders the real textareas (in the a11y tree)', () => {
      setLoaded();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(screen.getAllByRole('textbox')).toHaveLength(2);
    });

    it('renders the section headings (static text, always real)', () => {
      setLoaded();
      render(<SystemPromptEditor organizationId="org-1" />);
      // PageSection title renders as a heading regardless of state.
      expect(
        screen.getByRole('heading', { name: /system prompt/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('spans the full settings section so Discard/Save share the Add-rule edge', () => {
      // Regression: a max-w-2xl wrap left the textareas and action cluster
      // narrower than Default Models (+ Add rule) on the same Content & models
      // page, so the right edges didn't line up.
      setLoaded();
      const { container } = render(
        <SystemPromptEditor organizationId="org-1" />,
      );
      const form = container.querySelector('form');
      expect(form).not.toBeNull();
      expect(form?.querySelector('.max-w-2xl')).toBeNull();
      // The cluster is right-aligned by its `HStack justify="end"` wrapper
      // (EditorActions no longer carries its own `ml-auto`), so Save/Discard
      // still sit at the section's right edge — level with Add rule.
      expect(
        screen
          .getByRole('button', { name: /discard/i })
          .closest('.justify-end'),
      ).not.toBeNull();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a single busy/status region', () => {
      setLoading();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    });

    it('masks the data-bearing controls (no live textboxes while loading)', () => {
      setLoading();
      render(<SystemPromptEditor organizationId="org-1" />);
      // Masked textareas are aria-hidden/disabled → excluded from the a11y tree.
      expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    });

    it('keeps the real section headings while loading (no gray bars)', () => {
      setLoading();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /system prompt/i }),
      ).toBeInTheDocument();
    });
  });

  describe('structural parity (skeleton matches content)', () => {
    it('renders the same number of FormSection groups in both states', () => {
      setLoaded();
      const loaded = render(<SystemPromptEditor organizationId="org-1" />);
      const loadedGroups =
        loaded.container.querySelectorAll('[role="group"]').length;
      loaded.unmount();

      setLoading();
      const loading = render(<SystemPromptEditor organizationId="org-1" />);
      const loadingGroups =
        loading.container.querySelectorAll('[role="group"]').length;

      expect(loadingGroups).toBe(loadedGroups);
      expect(loadedGroups).toBeGreaterThan(0);
    });
  });
});
