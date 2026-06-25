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
  /**
   * The Source/Preview choice. A file the user has explicitly toggled keeps its
   * own choice; any file they haven't touched defaults to the LAST mode they
   * picked anywhere (then to `fallback` before any pick). So choosing Preview on
   * one doc carries to the next doc you open — like `wrap` — while still letting
   * individual files override.
   */
  getViewMode: (path: string, fallback: ViewMode) => ViewMode;
  setViewMode: (path: string, mode: ViewMode) => void;
}

function useCanvasPreferencesState(): CanvasPreferences {
  const [wrap, setWrap] = useState(false);
  const [modeByPath, setModeByPath] = useState<Record<string, ViewMode>>({});
  // The last Source/Preview pick, used as the sticky default for files that
  // don't have their own explicit choice yet.
  const [lastMode, setLastMode] = useState<ViewMode | null>(null);

  const toggleWrap = useCallback(() => setWrap((w) => !w), []);
  const getViewMode = useCallback(
    (path: string, fallback: ViewMode) =>
      modeByPath[path] ?? lastMode ?? fallback,
    [modeByPath, lastMode],
  );
  const setViewMode = useCallback((path: string, mode: ViewMode) => {
    setModeByPath((prev) => ({ ...prev, [path]: mode }));
    setLastMode(mode);
  }, []);

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
