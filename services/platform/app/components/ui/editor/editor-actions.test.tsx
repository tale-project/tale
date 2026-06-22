// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorActions } from './editor-actions';
import type { EditorController } from './types';

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
