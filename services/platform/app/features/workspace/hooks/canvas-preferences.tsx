'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ViewMode = 'source' | 'preview';

interface CanvasPreferences {
  /** Whether long lines wrap in the code/source view. One shared toggle for
   *  every file, so flipping it on holds as you browse the rest of the files. */
  wrap: boolean;
  toggleWrap: () => void;
  /** The Source/Preview choice, remembered per file path. */
  getViewMode: (path: string, fallback: ViewMode) => ViewMode;
  setViewMode: (path: string, mode: ViewMode) => void;
}

function useCanvasPreferencesState(): CanvasPreferences {
  const [wrap, setWrap] = useState(false);
  const [modeByPath, setModeByPath] = useState<Record<string, ViewMode>>({});

  const toggleWrap = useCallback(() => setWrap((w) => !w), []);
  const getViewMode = useCallback(
    (path: string, fallback: ViewMode) => modeByPath[path] ?? fallback,
    [modeByPath],
  );
  const setViewMode = useCallback(
    (path: string, mode: ViewMode) =>
      setModeByPath((prev) => ({ ...prev, [path]: mode })),
    [],
  );

  return useMemo(
    () => ({ wrap, toggleWrap, getViewMode, setViewMode }),
    [wrap, toggleWrap, getViewMode, setViewMode],
  );
}

const CanvasPreferencesContext = createContext<CanvasPreferences | null>(null);

/**
 * Holds the canvas viewers' UI preferences — line-wrap and the per-file
 * Source/Preview mode — ABOVE the file viewers, so they survive both switching
 * files and switching viewer kinds (code ⇄ markdown remount the viewer subtree,
 * which would otherwise reset state local to a viewer). Session-scoped; not
 * persisted to the backend.
 */
export function CanvasPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useCanvasPreferencesState();
  return (
    <CanvasPreferencesContext.Provider value={value}>
      {children}
    </CanvasPreferencesContext.Provider>
  );
}

/**
 * Read the shared canvas preferences. Falls back to ephemeral local state when
 * no provider is mounted, so a viewer still works standalone (e.g. in a test) —
 * it just won't share or persist the preference across files.
 */
export function useCanvasPreferences(): CanvasPreferences {
  const ctx = useContext(CanvasPreferencesContext);
  const fallback = useCanvasPreferencesState();
  return ctx ?? fallback;
}
