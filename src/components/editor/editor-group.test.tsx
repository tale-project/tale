// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ActiveEditorProvider, useActiveEditor } from './active-editor-context';
import { EditorGroup, useRegisterGroupedEditor } from './editor-group';
import type { EditorController } from './types';

function makeController(
  overrides: Partial<EditorController> = {},
): EditorController {
  return {
    isDirty: false,
    isSaving: false,
    isValid: true,
    isLoading: false,
    dirtyKeys: new Set<string>(),
    save: vi.fn(async () => {}),
    reset: vi.fn(),
    ...overrides,
  };
}

function Section({ controller }: { controller: EditorController }) {
  useRegisterGroupedEditor(controller);
  return null;
}

/** Captures whatever the settings header slot would render from. */
function ActiveProbe({
  onActive,
}: {
  onActive: (c: EditorController | null) => void;
}) {
  onActive(useActiveEditor());
  return null;
}

function lastActive(
  onActive: ReturnType<typeof vi.fn>,
): EditorController | null {
  const call = onActive.mock.calls.at(-1);
  return call ? (call[0] as EditorController | null) : null;
}

describe('EditorGroup', () => {
  it('composes several sections into one active controller', async () => {
    const onActive = vi.fn();
    const clean = makeController();
    const dirty = makeController({ isDirty: true, dirtyKeys: new Set(['a']) });

    render(
      <ActiveEditorProvider>
        <ActiveProbe onActive={onActive} />
        <EditorGroup>
          <Section controller={clean} />
          <Section controller={dirty} />
        </EditorGroup>
      </ActiveEditorProvider>,
    );

    const active = lastActive(onActive);
    expect(active).not.toBeNull();
    expect(active?.isDirty).toBe(true);
    expect([...(active?.dirtyKeys ?? [])]).toEqual(['a']);

    // Composed save only touches dirty sections.
    await act(async () => {
      await active?.save();
    });
    expect(dirty.save).toHaveBeenCalledTimes(1);
    expect(clean.save).not.toHaveBeenCalled();
  });

  it('clears the active editor when the last section unmounts', () => {
    const onActive = vi.fn();
    const controller = makeController({ isDirty: true });

    const { rerender } = render(
      <ActiveEditorProvider>
        <ActiveProbe onActive={onActive} />
        <EditorGroup>
          <Section controller={controller} />
        </EditorGroup>
      </ActiveEditorProvider>,
    );
    expect(lastActive(onActive)?.isDirty).toBe(true);

    rerender(
      <ActiveEditorProvider>
        <ActiveProbe onActive={onActive} />
        <EditorGroup>{null}</EditorGroup>
      </ActiveEditorProvider>,
    );
    // No mounted sections → no controller → the header shows no disabled
    // Save cluster on pages whose editors are all dialog-driven.
    expect(lastActive(onActive)).toBeNull();
  });

  it('registers directly with the active-editor registry when no group wraps the section', () => {
    const onActive = vi.fn();
    const controller = makeController({ isDirty: true });

    const { rerender } = render(
      <ActiveEditorProvider>
        <ActiveProbe onActive={onActive} />
        <Section controller={controller} />
      </ActiveEditorProvider>,
    );
    expect(lastActive(onActive)?.isDirty).toBe(true);

    rerender(
      <ActiveEditorProvider>
        <ActiveProbe onActive={onActive} />
      </ActiveEditorProvider>,
    );
    expect(lastActive(onActive)).toBeNull();
  });

  it('recomposes when a section turns dirty after mount', () => {
    const onActive = vi.fn();
    const first = makeController();

    const { rerender } = render(
      <ActiveEditorProvider>
        <ActiveProbe onActive={onActive} />
        <EditorGroup>
          <Section controller={first} />
        </EditorGroup>
      </ActiveEditorProvider>,
    );
    expect(lastActive(onActive)?.isDirty).toBe(false);

    rerender(
      <ActiveEditorProvider>
        <ActiveProbe onActive={onActive} />
        <EditorGroup>
          <Section controller={makeController({ isDirty: true })} />
        </EditorGroup>
      </ActiveEditorProvider>,
    );
    expect(lastActive(onActive)?.isDirty).toBe(true);
  });
});
