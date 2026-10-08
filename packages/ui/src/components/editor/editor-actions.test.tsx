// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../overlays/tooltip';
import { EditorActions } from './editor-actions';
import { EditorSaveCancelledError } from './types';
import type { EditorController, EditorTelemetryEvent } from './types';

const toastMock = vi.fn();

vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

function makeController(
  overrides: Partial<EditorController> = {},
): EditorController {
  return {
    isDirty: true,
    isSaving: false,
    isValid: true,
    isLoading: false,
    dirtyKeys: new Set<string>(['field']),
    save: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    ...overrides,
  };
}

function clickSave() {
  fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
}

beforeEach(() => {
  toastMock.mockReset();
});

describe('EditorActions — mobile touch targets (#1980)', () => {
  it('extends the Save and Discard hit areas to 44px on mobile without growing the visual box', () => {
    render(<EditorActions controller={makeController()} />);
    for (const name of ['actions.discard', 'actions.save']) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'relative',
        'max-sm:after:absolute',
        'max-sm:after:-inset-1.5',
        "max-sm:after:content-['']",
      );
    }
  });
});

describe('EditorActions — labeled text', () => {
  it('does not decorate idle Save and Discard with icons', () => {
    render(<EditorActions controller={makeController()} />);
    expect(
      screen
        .getByRole('button', { name: 'actions.discard' })
        .querySelector('svg'),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'actions.save' }).querySelector('svg'),
    ).toBeNull();
  });
});

describe('EditorActions — suppressServerErrorToast', () => {
  it('toasts a server error by default', async () => {
    const controller = makeController({
      save: vi.fn().mockRejectedValue(new Error('Server boom')),
    });
    render(<EditorActions controller={controller} />);
    clickSave();
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Server boom',
        variant: 'destructive',
      }),
    );
  });

  // `AppError.message` is its serialized payload: a controller that rethrew
  // a refusal as-is used to put `{"code":…}` under the Save title.
  it("never shows a structured error's payload", async () => {
    const data = { code: 'UNAUTHORIZED', message: 'Your session has ended.' };
    const controller = makeController({
      save: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error(JSON.stringify(data)), { data }),
        ),
    });
    render(<EditorActions controller={controller} />);
    clickSave();
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'errors.somethingWentWrong',
        variant: 'destructive',
      }),
    );
    expect(toastMock.mock.calls.flat()).not.toContainEqual(
      expect.objectContaining({
        description: expect.stringContaining('"code"'),
      }),
    );
  });

  it('suppresses the generic server-error toast when set (caller toasts its own)', async () => {
    const controller = makeController({
      save: vi.fn().mockRejectedValue(new Error('Server boom')),
    });
    render(<EditorActions controller={controller} suppressServerErrorToast />);
    clickSave();
    await waitFor(() => expect(controller.save).toHaveBeenCalled());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('still toasts validation failures even when suppressed', async () => {
    const controller = makeController({
      save: vi.fn().mockRejectedValue(new Error('VALIDATION_FAILED')),
    });
    render(<EditorActions controller={controller} suppressServerErrorToast />);
    clickSave();
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'editor.fixHighlightedFields',
        variant: 'destructive',
      }),
    );
  });
});

describe('EditorActions — cancelled save', () => {
  it('stays silent when the save is cancelled: no toast, no saved flash', async () => {
    const events: EditorTelemetryEvent[] = [];
    const controller = makeController({
      save: vi.fn().mockRejectedValue(new EditorSaveCancelledError()),
    });
    render(
      <EditorActions
        controller={controller}
        entityKind="project"
        onEvent={(event) => events.push(event)}
      />,
    );
    clickSave();

    await waitFor(() =>
      expect(events.map((e) => e.type)).toEqual([
        'save_attempt',
        'save_cancelled',
      ]),
    );
    expect(toastMock).not.toHaveBeenCalled();
    // The button label is the flash signal — it must still read "Save", never
    // "Saved", for a save the user backed out of.
    expect(
      screen.getByRole('button', { name: 'actions.save' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'actions.saved' }),
    ).not.toBeInTheDocument();
  });
});

describe('EditorActions — invalidReason', () => {
  const REASON = 'Fix 2 errors to save';

  function renderActions(
    overrides: Partial<EditorController>,
    props: { inlineReason?: boolean } = {},
  ) {
    return render(
      <TooltipProvider>
        <EditorActions
          controller={makeController({
            isValid: false,
            invalidReason: REASON,
            ...overrides,
          })}
          {...props}
        />
      </TooltipProvider>,
    );
  }

  it('keeps Save reachable and explains why it is off', async () => {
    renderActions({});
    const save = screen.getByRole('button', { name: 'actions.save' });
    // Soft-disabled: focusable, announced as disabled, inert to clicks.
    expect(save).not.toBeDisabled();
    expect(save).toHaveAttribute('aria-disabled', 'true');
    // Discard, then Save: the reason reaches a keyboard user on focus.
    await userEvent.tab();
    await userEvent.tab();
    expect(save).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(REASON);
    clickSave();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('gives no reason when there is nothing to save', () => {
    renderActions({ isDirty: false });
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeDisabled();
  });

  it('gives no reason while a save or a load is under way', () => {
    renderActions({ isLoading: true });
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeDisabled();
  });

  it('stays a plain disabled Save without a reason', () => {
    renderActions({ invalidReason: undefined });
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeDisabled();
  });

  it('shows the reason inline, describing Save, outside the live region', () => {
    renderActions({}, { inlineReason: true });
    const save = screen.getByRole('button', { name: 'actions.save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(REASON);
    const line = screen.getByText(REASON);
    expect(line).toHaveAttribute('aria-live', 'off');
  });

  it('drops the inline reason once the edits are valid', () => {
    renderActions({ isValid: true }, { inlineReason: true });
    expect(screen.queryByText(REASON)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'actions.save' }),
    ).not.toHaveAttribute('aria-describedby');
  });
});
