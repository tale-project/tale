import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));

vi.mock('@/app/hooks/use-toast', () => ({ toast: toastSpy }));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { useOAuth2PopupConnect } from './use-oauth2-popup-connect';

function fakePopup() {
  return {
    closed: false,
    close: vi.fn(),
    location: { href: '' },
  } as unknown as Window & { close: ReturnType<typeof vi.fn> };
}

describe('useOAuth2PopupConnect', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('opens a popup and navigates it to the prepared url', async () => {
    const popup = fakePopup();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(popup);
    const { result } = renderHook(() => useOAuth2PopupConnect());

    await act(async () => {
      await result.current.authorize(async () => 'https://provider/authorize');
    });

    expect(openSpy).toHaveBeenCalledWith(
      '',
      'tale-oauth2',
      expect.stringContaining('popup'),
    );
    expect(popup.location.href).toBe('https://provider/authorize');

    act(() => result.current.close());
    expect(popup.close).toHaveBeenCalled();
  });

  it('toasts when the popup is blocked', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useOAuth2PopupConnect());

    await act(async () => {
      await result.current.authorize(async () => 'https://provider/authorize');
    });

    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('closes the popup when the url builder yields nothing', async () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { result } = renderHook(() => useOAuth2PopupConnect());

    await act(async () => {
      await result.current.authorize(async () => null);
    });

    expect(popup.close).toHaveBeenCalled();
  });
});
