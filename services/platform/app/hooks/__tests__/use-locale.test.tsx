import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, useLocale } from '../use-locale';

vi.mock('@/lib/utils/date/format', () => ({
  loadDayjsLocale: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
});

describe('useLocale', () => {
  it('throws when used outside LocaleProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress the React error-boundary stack noise during this test.
    });
    expect(() => renderHook(() => useLocale())).toThrow(
      'useLocale must be used within a LocaleProvider',
    );
    consoleError.mockRestore();
  });

  it('detects and persists the initial locale via localStorage', () => {
    localStorage.setItem('user-locale', 'fr-FR');

    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });

    expect(result.current.locale).toBe('fr-FR');
  });

  it('persists setLocale to localStorage', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider>,
    });

    act(() => {
      result.current.setLocale('de-DE');
    });

    expect(result.current.locale).toBe('de-DE');
    expect(localStorage.getItem('user-locale')).toBe('de-DE');
  });

  // Regression: before LocaleProvider, every component calling useLocale()
  // had its own useState, so a setLocale() call in the language picker did
  // not propagate to <LocaleSync> (which triggers i18n.changeLanguage). The
  // bug surfaced as a picker that only "worked" after a page refresh.
  it('shares a single locale across every consumer of the context', async () => {
    const user = userEvent.setup();

    function Reader() {
      const { locale } = useLocale();
      return <span data-testid="reader">{locale}</span>;
    }

    function Picker() {
      const { setLocale } = useLocale();
      return (
        <button type="button" onClick={() => setLocale('de-DE')}>
          switch
        </button>
      );
    }

    render(
      <LocaleProvider>
        <Reader />
        <Picker />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'switch' }));

    expect(screen.getByTestId('reader')).toHaveTextContent('de-DE');
  });
});
