import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@/app/components/ui/editor';
import { render, screen } from '@/tests/utils/render';

import { SystemPromptEditor } from './system-prompt-editor';

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { state, mutateAsync } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { mandatoryInstructions: '' } as Record<string, string> | undefined,
  },
  mutateAsync: vi.fn(async () => {}),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

function setLoaded(
  config: Record<string, string> = { mandatoryInstructions: '' },
) {
  state.isLoading = false;
  state.config = config;
}
function setLoading() {
  state.isLoading = true;
  state.config = undefined;
}

/** Captures the controller the editor registers with the global save bar. */
function ActiveProbe({
  capture,
}: {
  capture: { current: EditorController | null };
}) {
  capture.current = useActiveEditor();
  return null;
}

describe('SystemPromptEditor', () => {
  describe('loaded state', () => {
    it('renders a single custom-instructions textarea', () => {
      setLoaded();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
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

    it('resolves a legacy prefix/suffix policy into the single field', () => {
      setLoaded({
        mandatoryPrefixPrompt: 'Prefix rules.',
        mandatorySuffixPrompt: 'Suffix rules.',
      });
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(screen.getByRole('textbox')).toHaveValue(
        'Prefix rules.\n\nSuffix rules.',
      );
    });

    it('saves through the globally registered controller with the unified field', async () => {
      setLoaded();
      const capture = { current: null as EditorController | null };
      render(
        <ActiveEditorProvider>
          <ActiveProbe capture={capture} />
          <SystemPromptEditor organizationId="org-1" />
        </ActiveEditorProvider>,
      );

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Always cite sources.' },
      });
      expect(capture.current?.isDirty).toBe(true);

      await act(async () => {
        await capture.current?.save();
      });
      expect(mutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'system_prompt',
        config: { mandatoryInstructions: 'Always cite sources.' },
      });
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
