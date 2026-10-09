import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'tale-theme';

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
});

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system'
    ? stored
    : 'system';
}

function applyDocumentClass(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (
    root.classList.contains('dark') === (resolved === 'dark') &&
    root.style.colorScheme === resolved
  ) {
    return;
  }
  // Flipping the root class swaps every color CSS variable at once. Elements
  // that snap to the new palette and elements with `transition-colors` (which
  // lerp over ~150ms) would otherwise change at different speeds, which reads
  // as a flicker on hover-highlighted rows, active nav tiles, etc. Suppress
  // all transitions for the flip, force a style flush so the new colors are
  // committed while suppressed, then re-enable on the next frame.
  const css = document.createElement('style');
  css.appendChild(
    document.createTextNode('*,*::before,*::after{transition:none!important}'),
  );
  document.head.appendChild(css);

  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;

  // Reading a computed style forces the recalc to happen now, while
  // transitions are disabled.
  void window.getComputedStyle(root).transition;
  requestAnimationFrame(() => {
    css.remove();
  });
}

export interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: ThemeProviderProps) {
  // Lazy initializer reads localStorage on the very first render in the
  // browser so React's first paint matches the pre-hydration inline script
  // in index.html. On the server we fall back to `defaultTheme`.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme;
    return readStoredTheme();
  });
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    getSystemTheme(),
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    applyDocumentClass(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
