import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@tale/ui/editor';
import { act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { DataNoticePolicyEditor } from './data-notice-policy-editor';

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
  toast: vi.fn(),
}));

const { state, mutateAsync } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    config: undefined as Record<string, unknown> | undefined,
    canWrite: true,
  },
  mutateAsync: vi.fn(async (_args: unknown) => {}),
}));

vi.mock('../hooks/mutations', () => ({
  useUpsertGovernancePolicy: () => ({ mutateAsync, isPending: false }),
}));

vi.mock('../hooks/queries', () => ({
  useGovernancePolicy: () => ({
    // `null` is a resolved read with no policy file.
    data: state.isLoading
      ? undefined
      : state.config === undefined
        ? null
        : { config: state.config },
    isLoading: state.isLoading,
  }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => state.canWrite,
    cannot: () => !state.canWrite,
  }),
}));

const DEFAULT_EN =
  'AI can make mistakes—verify responses and do not share sensitive data.';
const DEFAULT_DE =
  'KI kann Fehler machen – prüfe Antworten und teile keine sensiblen Daten.';

/** Captures the controller the editor registers with the global save bar. */
function ActiveProbe({
  capture,
}: {
  capture: { current: EditorController | null };
}) {
  capture.current = useActiveEditor();
  return null;
}

function renderWithSaveBar() {
  const capture = { current: null as EditorController | null };
  const utils = render(
    <ActiveEditorProvider>
      <ActiveProbe capture={capture} />
      <DataNoticePolicyEditor organizationId="org-1" />
    </ActiveEditorProvider>,
  );
  return { ...utils, capture };
}

/** The text field for one language, named by its tab's language. */
function noticeText(language: 'English' | 'Deutsch' | 'Français') {
  return screen.getByRole('textbox', { name: `Notice text (${language})` });
}

function languageTab(language: 'English' | 'Deutsch' | 'Français') {
  return screen.getByRole('tab', { name: new RegExp(language) });
}

function noticeSwitch() {
  return screen.getByRole('switch', {
    name: 'Show the confidentiality notice in chat',
  });
}

beforeEach(() => {
  state.isLoading = false;
  state.config = undefined;
  state.canWrite = true;
  mutateAsync.mockClear();
});

describe('DataNoticePolicyEditor', () => {
  it('reads off, with no text fields, for an org without a policy file', () => {
    render(<DataNoticePolicyEditor organizationId="org-1" />);

    expect(
      screen.getByRole('heading', { name: 'Confidentiality notice' }),
    ).toBeInTheDocument();
    expect(noticeSwitch()).not.toBeChecked();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('turns the notice on instantly, keeping everything else in the file', async () => {
    state.config = {
      enabled: false,
      version: 3,
      messages: { en: 'Mind the client data.', 'de-CH': 'Achtung' },
    };
    const { user } = render(<DataNoticePolicyEditor organizationId="org-1" />);

    await user.click(noticeSwitch());

    expect(mutateAsync).toHaveBeenCalledWith({
      organizationId: 'org-1',
      policyType: 'data_classification_notice',
      config: {
        enabled: true,
        version: 3,
        messages: { en: 'Mind the client data.', 'de-CH': 'Achtung' },
      },
    });
  });

  describe('while the notice is on', () => {
    beforeEach(() => {
      state.config = { enabled: true, version: 1 };
    });

    it('edits one language at a time in the shared language tabs, English first', async () => {
      const { user } = render(
        <DataNoticePolicyEditor organizationId="org-1" />,
      );

      expect(noticeSwitch()).toBeChecked();
      expect(
        screen.getByRole('tablist', { name: 'Notice languages' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'English(default)',
        'Deutschuntranslated',
        'Françaisuntranslated',
      ]);
      expect(languageTab('English')).toHaveAttribute('aria-selected', 'true');

      await user.click(languageTab('Deutsch'));

      expect(languageTab('Deutsch')).toHaveAttribute('aria-selected', 'true');
      expect(noticeText('Deutsch')).toBeInTheDocument();
    });

    it('drops the untranslated mark once a language has its own text', () => {
      render(<DataNoticePolicyEditor organizationId="org-1" />);

      fireEvent.change(noticeText('Deutsch'), {
        target: { value: 'Füge keine Kundennamen ein.' },
      });

      expect(languageTab('Deutsch')).toHaveTextContent(/^Deutsch$/);
      expect(languageTab('Français')).toHaveTextContent('untranslated');
    });

    it("previews each language's default notice while its field is empty", () => {
      render(<DataNoticePolicyEditor organizationId="org-1" />);

      expect(noticeText('English')).toHaveAttribute('placeholder', DEFAULT_EN);
      expect(noticeText('Deutsch')).toHaveAttribute('placeholder', DEFAULT_DE);
    });

    it('previews the English text in the empty languages once there is one', () => {
      render(<DataNoticePolicyEditor organizationId="org-1" />);

      fireEvent.change(noticeText('English'), {
        target: { value: 'Mind the client data.' },
      });

      expect(noticeText('Deutsch')).toHaveAttribute(
        'placeholder',
        'Mind the client data.',
      );
    });

    it('saves the texts, trimmed, and drops a language left empty', async () => {
      state.config = {
        enabled: true,
        version: 1,
        messages: { fr: 'Ancien texte', 'de-CH': 'Achtung' },
      };
      const { capture } = renderWithSaveBar();

      fireEvent.change(noticeText('English'), {
        target: { value: '  Mind the client data.  ' },
      });
      fireEvent.change(noticeText('Français'), {
        target: { value: '' },
      });
      expect(capture.current?.isDirty).toBe(true);

      await act(async () => {
        await capture.current?.save();
      });

      expect(mutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        policyType: 'data_classification_notice',
        config: {
          enabled: true,
          version: 1,
          messages: { en: 'Mind the client data.', 'de-CH': 'Achtung' },
        },
      });
    });

    it('refuses a text over the 280-character cap and marks its language', async () => {
      const { capture } = renderWithSaveBar();

      // Over the cap in a tab that is not the one on screen.
      fireEvent.change(noticeText('Français'), {
        target: { value: 'x'.repeat(281) },
      });

      expect(capture.current?.isValid).toBe(false);
      expect(
        screen.getByRole('tab', { name: /Français.*has an error/ }),
      ).toBeInTheDocument();
      expect(languageTab('English')).not.toHaveTextContent('has an error');

      await act(async () => {
        // The save bar reports a refused validation as a rejected save.
        await expect(capture.current?.save()).rejects.toThrow(
          'VALIDATION_FAILED',
        );
      });
      expect(mutateAsync).not.toHaveBeenCalled();
    });
  });

  it('shows but does not let a read-only viewer change anything', () => {
    state.canWrite = false;
    state.config = { enabled: true };
    const { capture } = renderWithSaveBar();

    expect(noticeSwitch()).toBeDisabled();
    expect(noticeText('English')).toBeDisabled();
    expect(capture.current).toBeNull();
  });

  it('masks its controls while the policy loads', () => {
    state.isLoading = true;
    render(<DataNoticePolicyEditor organizationId="org-1" />);

    expect(
      screen.getByRole('status', { name: 'Confidentiality notice' }),
    ).toBeInTheDocument();
  });
});
