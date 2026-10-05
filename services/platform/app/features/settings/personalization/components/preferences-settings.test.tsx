// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  ActiveEditorProvider,
  EditorActions,
  useActiveEditor,
  type EditorController,
} from '@tale/ui/editor';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  forgetSavedLocale,
  saveLocale,
  SHIPPED_LOCALES,
} from '@/tests/utils/lapsed-session';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/tests/utils/render';

// Per-test preference row: `undefined` means the user has made no explicit
// choice and follows the org default.
let preferences: {
  customInstructions?: string;
  customInstructionsEnabled?: boolean;
} | null = null;
let policyEnabled = false;

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: preferences, isLoading: false }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useGovernancePolicy: () => ({
    data: { config: { enabled: policyEnabled } },
    isLoading: false,
  }),
}));

const setCustomInstructionsEnabled = vi.fn().mockResolvedValue(undefined);
const upsert = vi.fn().mockResolvedValue(undefined);

vi.mock('../hooks/mutations', () => ({
  useSetCustomInstructionsEnabled: () => ({
    mutateAsync: setCustomInstructionsEnabled,
    isPending: false,
  }),
  useUpsertMyPreferences: () => ({ mutateAsync: upsert, isPending: false }),
}));

import { PreferencesSettings } from './preferences-settings';

function renderPage() {
  return render(<PreferencesSettings organizationId="org-1" />);
}

function renderEditor() {
  const capture = { current: null as EditorController | null };
  function ActiveProbe() {
    const controller = useActiveEditor();
    capture.current = controller;
    return controller ? <EditorActions controller={controller} /> : null;
  }
  return {
    capture,
    ...render(
      <ActiveEditorProvider>
        <ActiveProbe />
        <PreferencesSettings organizationId="org-1" />
      </ActiveEditorProvider>,
    ),
  };
}

beforeEach(() => {
  preferences = null;
  policyEnabled = false;
  vi.clearAllMocks();
});

afterEach(async () => {
  cleanup();
  await forgetSavedLocale();
});

describe('PreferencesSettings', () => {
  it.each(SHIPPED_LOCALES)(
    'refuses 3201 characters accessibly before save and allows repair to 3200 (%s)',
    async (locale) => {
      saveLocale(locale);
      preferences = {
        customInstructionsEnabled: true,
        customInstructions: 'Saved.',
      };
      const { capture, user, container } = renderEditor();
      const field = screen.getByRole('textbox');
      await waitFor(() => expect(i18n.resolvedLanguage).toBe(locale));
      const error = i18n.t('errors.tooLong', {
        ns: 'personalization',
        max: 3200,
      });
      const saveLabel = i18n.t('actions.save', { ns: 'common' });

      fireEvent.change(field, { target: { value: 'a'.repeat(3201) } });

      expect(await screen.findByRole('alert')).toHaveTextContent(error);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAccessibleDescription(expect.stringContaining(error));
      const format = new Intl.NumberFormat(locale);
      expect(
        screen.getByText(
          (_content, element) =>
            element?.textContent ===
            `${format.format(3201)} / ${format.format(3200)}`,
        ),
      ).toBeVisible();
      await waitFor(() => expect(capture.current?.isValid).toBe(false));
      expect(screen.getByRole('button', { name: saveLabel })).toBeDisabled();
      expect(upsert).not.toHaveBeenCalled();
      expect(field).toHaveValue('a'.repeat(3201));
      await checkAccessibility(container);

      fireEvent.change(field, { target: { value: 'a'.repeat(3200) } });
      await waitFor(() => expect(capture.current?.isValid).toBe(true));
      expect(screen.queryByRole('alert')).toBeNull();
      await user.click(screen.getByRole('button', { name: saveLabel }));
      await waitFor(() =>
        expect(upsert).toHaveBeenCalledWith({
          organizationId: 'org-1',
          customInstructions: 'a'.repeat(3200),
        }),
      );
      await waitFor(() => expect(capture.current?.isDirty).toBe(false));
    },
  );

  it('preserves the server refusal instead of replacing it with a generic save error', async () => {
    preferences = {
      customInstructionsEnabled: true,
      customInstructions: 'Saved.',
    };
    const refusal = 'Custom instructions exceed 3200 characters.';
    upsert.mockRejectedValueOnce(
      new AppError({ code: 'too_long', message: refusal }),
    );
    const { capture } = renderEditor();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Draft.' },
    });
    await waitFor(() => expect(capture.current?.isValid).toBe(true));
    await act(async () => {
      await expect(capture.current?.save()).rejects.toThrow(refusal);
    });
    expect(screen.getByRole('textbox')).toHaveValue('Draft.');
    expect(capture.current?.isDirty).toBe(true);
  });

  it('uses the translated fallback for an unexpected fault without showing its payload', async () => {
    preferences = { customInstructionsEnabled: true };
    upsert.mockRejectedValueOnce(new TypeError('internal failure payload'));
    const { capture } = renderEditor();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Draft.' },
    });
    await waitFor(() => expect(capture.current?.isValid).toBe(true));
    await act(async () => {
      await expect(capture.current?.save()).rejects.toThrow(
        i18n.t('errors.saveFailed', { ns: 'personalization' }),
      );
    });
  });

  it('offers exactly one switch — no voice output (a composer mode), no memories (removed)', () => {
    preferences = { customInstructionsEnabled: true };
    renderPage();

    expect(screen.queryByText(/voice output/i)).toBeNull();
    expect(screen.queryByText(/memor/i)).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });

  it('renders the custom-instructions field inline under its own section', () => {
    preferences = {
      customInstructionsEnabled: true,
      customInstructions: 'Be terse.',
    };
    renderPage();

    const field = screen.getByRole('textbox', {
      name: 'Custom instructions',
    });
    expect(field).toHaveValue('Be terse.');
    expect(field).toBeEnabled();
  });

  it('hides the field while the feature is off — a section toggle removes its content', () => {
    preferences = {
      customInstructionsEnabled: false,
      customInstructions: 'Be terse.',
    };
    renderPage();

    expect(
      screen.queryByRole('textbox', { name: 'Custom instructions' }),
    ).toBeNull();
    // The switch still says what the stored state is, so turning the feature
    // back on brings the saved text with it.
    expect(
      screen.getByRole('switch', { name: 'Custom instructions' }),
    ).not.toBeChecked();
  });

  it('follows the org default when the user has made no choice', () => {
    preferences = null;
    policyEnabled = true;
    renderPage();

    expect(
      screen.getByRole('switch', { name: 'Custom instructions' }),
    ).toBeChecked();
    expect(
      screen.getAllByText(/Following organization default/).length,
    ).toBeGreaterThan(0);
  });

  it('says it is overriding the org default once the user chooses', () => {
    preferences = { customInstructionsEnabled: false };
    policyEnabled = true;
    renderPage();

    expect(
      screen.getByRole('switch', { name: 'Custom instructions' }),
    ).not.toBeChecked();
    expect(
      screen.getAllByText(/Overriding organization default/).length,
    ).toBeGreaterThan(0);
  });

  it('turns the feature on through its section switch', async () => {
    preferences = { customInstructionsEnabled: false };
    const { user } = renderPage();

    await user.click(
      screen.getByRole('switch', { name: 'Custom instructions' }),
    );

    expect(setCustomInstructionsEnabled).toHaveBeenCalledWith({
      organizationId: 'org-1',
      enabled: true,
    });
  });

  it('saves the custom instructions the user typed through the global save bar', async () => {
    preferences = { customInstructionsEnabled: true, customInstructions: '' };
    const capture = { current: null as EditorController | null };
    function ActiveProbe() {
      capture.current = useActiveEditor();
      return null;
    }
    const { user } = render(
      <ActiveEditorProvider>
        <ActiveProbe />
        <PreferencesSettings organizationId="org-1" />
      </ActiveEditorProvider>,
    );

    await user.type(
      screen.getByRole('textbox', { name: 'Custom instructions' }),
      'Reply in French.',
    );

    expect(capture.current?.isDirty).toBe(true);
    await act(async () => {
      await capture.current?.save();
    });

    expect(upsert).toHaveBeenCalledWith({
      organizationId: 'org-1',
      customInstructions: 'Reply in French.',
    });
  });

  it('passes an axe audit', async () => {
    preferences = {
      customInstructionsEnabled: true,
      customInstructions: 'Be terse.',
    };
    const { container } = renderPage();
    await waitFor(() => checkAccessibility(container));
  });
});
