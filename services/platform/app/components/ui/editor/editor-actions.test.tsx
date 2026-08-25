// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorActions } from './editor-actions';
import { EditorSaveCancelledError } from './types';
import type { EditorController, EditorTelemetryEvent } from './types';

const toastMock = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock('@/lib/i18n/client', () => ({
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
