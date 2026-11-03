import { describe, expect, it, vi } from 'vitest';

import { showPhone, stubViewport } from './viewport';

const PHONE = '(max-width: 767px)';

describe('stubViewport', () => {
  it('answers yes to the phone query of the shell on a phone, and no to every other query', () => {
    stubViewport('phone');
    expect(window.matchMedia(PHONE).matches).toBe(true);
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(
      false,
    );
  });

  it('answers no on a computer', () => {
    stubViewport('desktop');
    expect(window.matchMedia(PHONE).matches).toBe(false);
  });

  it('tells whoever listens when the window is resized, and no one after they stop', () => {
    const screen = stubViewport('desktop');
    const query = window.matchMedia(PHONE);
    const listener = vi.fn();
    query.addEventListener('change', listener);

    screen.resize('phone');
    expect(listener).toHaveBeenCalledWith({ matches: true });
    expect(query.matches).toBe(true);

    query.removeEventListener('change', listener);
    screen.resize('desktop');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('showPhone', () => {
  it('makes the window a phone for the test that follows, and a computer again', () => {
    showPhone(true);
    expect(window.matchMedia(PHONE).matches).toBe(true);
    showPhone(false);
    expect(window.matchMedia(PHONE).matches).toBe(false);
  });
});
