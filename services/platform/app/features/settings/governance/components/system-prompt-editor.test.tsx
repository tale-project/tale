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
  toast: vi.fn(),
}));

const { state, mutateAsync } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: { enabled: true, mandatoryInstructions: '' } as
      | Record<string, unknown>
      | undefined,
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
  config: Record<string, unknown> = {
    enabled: true,
    mandatoryInstructions: '',
  },
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
  describe('while the section is on', () => {
    it('renders a single custom-instructions textarea', () => {
      setLoaded();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
    });

    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /custom instructions/i }),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('saves the flag together with the unified field', async () => {
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
        config: {
          enabled: true,
          mandatoryInstructions: 'Always cite sources.',
        },
      });
    });
  });

  /**
   * The flag is optional, so an org that configured instructions before it
   * existed must keep them: the section reads its state from the text when the
   * flag is absent. A fresh org — no flag, no text — reads off.
   */
  describe('when the stored policy carries no flag', () => {
    it('reads on, and shows the text, when instructions exist', () => {
      setLoaded({
        mandatoryPrefixPrompt: 'Prefix rules.',
        mandatorySuffixPrompt: 'Suffix rules.',
      });
      render(<SystemPromptEditor organizationId="org-1" />);

      expect(
        screen.getByRole('switch', { name: /custom instructions/i }),
      ).toBeChecked();
      expect(screen.getByRole('textbox')).toHaveValue(
        'Prefix rules.\n\nSuffix rules.',
      );
    });

    it('reads off, and hides the field, on a fresh policy', () => {
      setLoaded({});
      render(<SystemPromptEditor organizationId="org-1" />);

      expect(
        screen.getByRole('switch', { name: /custom instructions/i }),
      ).not.toBeChecked();
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  describe('while the section is off', () => {
    it('hides the field rather than showing one nothing would read', () => {
      setLoaded({ enabled: false, mandatoryInstructions: 'Kept draft.' });
      render(<SystemPromptEditor organizationId="org-1" />);

      expect(screen.queryByRole('textbox')).toBeNull();
      // The heading and its toggle stay, so turning the section back on is
      // one click — and the stored draft is still there.
      expect(
        screen.getByRole('switch', { name: /custom instructions/i }),
      ).not.toBeChecked();
    });

    it('keeps the stored text when the toggle is flipped off', async () => {
      setLoaded({ enabled: true, mandatoryInstructions: 'Kept draft.' });
      const { user } = render(<SystemPromptEditor organizationId="org-1" />);

      await user.click(
        screen.getByRole('switch', { name: /custom instructions/i }),
      );

      expect(mutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'system_prompt',
        config: { enabled: false, mandatoryInstructions: 'Kept draft.' },
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

    it('keeps the real section heading while loading (no gray bars)', () => {
      setLoading();
      render(<SystemPromptEditor organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /custom instructions/i }),
      ).toBeInTheDocument();
    });
  });

  describe('structural parity (skeleton matches content)', () => {
    it('holds the field slot in both states, so the reveal is a mask swap', () => {
      setLoaded();
      const loaded = render(<SystemPromptEditor organizationId="org-1" />);
      const loadedForms = loaded.container.querySelectorAll('form').length;
      loaded.unmount();

      setLoading();
      const loading = render(<SystemPromptEditor organizationId="org-1" />);
      const loadingForms = loading.container.querySelectorAll('form').length;

      expect(loadedForms).toBe(1);
      expect(loadingForms).toBe(loadedForms);
    });
  });
});
