'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  useActiveEditorSetter,
  useRegisterActiveEditor,
} from './active-editor-context';
import { useComposedEditor } from './compose-editors';
import type { EditorController } from './types';

/**
 * Collects the controllers of independently-editable sections mounted beneath
 * it and registers ONE composed controller with the active-editor registry —
 * so a page hosting several sections (e.g. a governance page with three
 * policy editors) still gets a single Save/Discard cluster in the settings
 * header instead of one button row per section.
 *
 * Sections opt in via `useRegisterGroupedEditor`; the group re-composes when
 * any section's status booleans change (same contract as
 * `useRegisterActiveEditor`) and unregisters entirely while no section is
 * mounted, so pages whose sections are all dialog-driven never surface a
 * disabled Save button.
 */
interface EditorGroupRegistry {
  register: (id: string, controller: EditorController) => void;
  unregister: (id: string) => void;
}

const EditorGroupContext = createContext<EditorGroupRegistry | null>(null);

export function EditorGroup({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ReadonlyMap<string, EditorController>>(
    new Map(),
  );

  const register = useCallback((id: string, controller: EditorController) => {
    setEntries((prev) => {
      const next = new Map(prev);
      next.set(id, controller);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setEntries((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const registry = useMemo<EditorGroupRegistry>(
    () => ({ register, unregister }),
    [register, unregister],
  );

  return (
    <EditorGroupContext.Provider value={registry}>
      {entries.size > 0 && (
        <GroupActiveRegistrar controllers={[...entries.values()]} />
      )}
      {children}
    </EditorGroupContext.Provider>
  );
}

/**
 * Mounted only while at least one section is registered — unmounting clears
 * the active editor via `useRegisterActiveEditor`'s own cleanup.
 */
function GroupActiveRegistrar({
  controllers,
}: {
  controllers: ReadonlyArray<EditorController>;
}) {
  const composed = useComposedEditor(...controllers);
  useRegisterActiveEditor(composed);
  return null;
}

/**
 * Registers a section's controller with the nearest {@link EditorGroup} for
 * as long as the section stays mounted. Falls back to registering directly
 * as the page's active editor when no group is present, so a section renders
 * identically whether it is the only editor on a page or one of several.
 *
 * Mirrors `useRegisterActiveEditor`'s update contract: re-registers only when
 * the controller's status booleans change, while `save`/`reset` stay current
 * through the hooks' internal refs.
 */
export function useRegisterGroupedEditor(
  controller: EditorController,
  options?: {
    /**
     * Register only while `true` (default). Flip to `false` for read-only
     * viewers or while a section's form is hidden behind a disabled policy
     * toggle — an unregistered section never surfaces Save/Discard.
     */
    enabled?: boolean;
  },
): void {
  const group = useContext(EditorGroupContext);
  const setActive = useActiveEditorSetter();
  const id = useId();
  const enabled = options?.enabled ?? true;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    if (!enabled) return;
    if (group) {
      group.register(id, controllerRef.current);
      return;
    }
    // No-group fallback: register directly, mirroring
    // `useRegisterActiveEditor` (which cannot be called conditionally).
    setActive?.(controllerRef.current);
  }, [
    enabled,
    group,
    setActive,
    id,
    controller.isDirty,
    controller.isSaving,
    controller.isValid,
    controller.isLoading,
  ]);

  // Cleanup on unmount AND whenever `enabled` flips false — its dep change
  // runs the previous cleanup, deleting the stale registration.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      if (group) {
        group.unregister(id);
        return;
      }
      setActive?.(null);
    };
  }, [enabled, group, setActive, id]);
}
