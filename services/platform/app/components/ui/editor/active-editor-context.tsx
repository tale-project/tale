'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import type { EditorController } from './types';

/**
 * Two-context split. `SetterContext` exposes a stable `setActive` so the
 * `useRegisterActiveEditor` consumer doesn't re-render whenever the active
 * controller changes — without this split, every keystroke that flipped
 * `isDirty` triggered context propagation → child re-render → useFormEditor
 * returned a new controller literal → effect re-fired → setActive → loop,
 * tripping React's "Maximum update depth exceeded" guard. The reader-side
 * consumer (`useActiveEditor` → `EditorActions`) subscribes to
 * `ControllerContext` instead and is allowed to re-render when state
 * changes.
 */
const SetterContext = createContext<Dispatch<
  SetStateAction<EditorController | null>
> | null>(null);
const ControllerContext = createContext<EditorController | null>(null);

interface ActiveEditorProviderProps {
  children: ReactNode;
}

export function ActiveEditorProvider({ children }: ActiveEditorProviderProps) {
  const [active, setActive] = useState<EditorController | null>(null);
  return (
    <SetterContext.Provider value={setActive}>
      <ControllerContext.Provider value={active}>
        {children}
      </ControllerContext.Provider>
    </SetterContext.Provider>
  );
}

export function useActiveEditor(): EditorController | null {
  return useContext(ControllerContext);
}

/**
 * Raw access to the stable setter for registration helpers that need to
 * decide at runtime whether to register (e.g. `useRegisterGroupedEditor`'s
 * no-group fallback). Prefer `useRegisterActiveEditor` everywhere else.
 */
export function useActiveEditorSetter(): Dispatch<
  SetStateAction<EditorController | null>
> | null {
  return useContext(SetterContext);
}

/**
 * Registers the calling component's controller as "active" for as long as
 * it stays mounted. Re-registers only when controller STATE (isDirty,
 * isSaving, isValid, isLoading) actually changes — not on every render —
 * because the controller object literal returned by `useFormEditor` /
 * `useJsonConfigEditor` is fresh on every render and registering on
 * reference inequality would loop infinitely. A ref keeps the registered
 * value pointed at the latest closure so EditorActions reads the
 * most-recent `save` / `reset` callbacks.
 */
export function useRegisterActiveEditor(controller: EditorController): void {
  const setActive = useContext(SetterContext);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    if (!setActive) return;
    setActive(controllerRef.current);
  }, [
    setActive,
    controller.isDirty,
    controller.isSaving,
    controller.isValid,
    controller.isLoading,
  ]);

  useEffect(
    () => () => {
      if (!setActive) return;
      setActive(null);
    },
    [setActive],
  );
}

/**
 * Imperatively clears the active editor — used by the layout when no child
 * has registered (e.g. user is on Files tab which has no form).
 */
export function useClearActiveEditor() {
  const setActive = useContext(SetterContext);
  return useCallback(() => setActive?.(null), [setActive]);
}

/**
 * Memo-friendly wrapper that some consumers use to keep the same registry
 * shape they had before the split (defensive in case a future caller wants
 * an opaque handle). The setter is already stable from `useState`, so we
 * just return a stable object.
 */
export function useActiveEditorRegistry() {
  const setActive = useContext(SetterContext);
  const active = useContext(ControllerContext);
  return useMemo(
    () => ({
      active,
      set: setActive,
    }),
    [active, setActive],
  );
}
