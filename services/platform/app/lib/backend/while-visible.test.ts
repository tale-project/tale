// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HIDDEN_RELEASE_MS, whileVisible } from './while-visible';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
  // Drop the instance override; the prototype getter answers again.
  Reflect.deleteProperty(document, 'visibilityState');
});

function lane() {
  const calls: string[] = [];
  return {
    calls,
    open: () => {
      calls.push('open');
    },
    release: () => {
      calls.push('release');
    },
  };
}

describe('whileVisible', () => {
  it('opens at once on a visible page', () => {
    const l = lane();
    whileVisible(l);
    expect(l.calls).toEqual(['open']);
  });

  it('releases only once the page has stayed hidden for the whole grace', () => {
    const l = lane();
    whileVisible(l);
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_RELEASE_MS - 1);
    expect(l.calls).toEqual(['open']);
    vi.advanceTimersByTime(1);
    expect(l.calls).toEqual(['open', 'release']);
  });

  it('keeps the connection through a glance shorter than the grace', () => {
    const l = lane();
    whileVisible(l);
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_RELEASE_MS - 1);
    setVisibility('visible');
    vi.advanceTimersByTime(HIDDEN_RELEASE_MS * 2);
    expect(l.calls).toEqual(['open']);
  });

  it('reopens when a released page is shown again, and only then', () => {
    const l = lane();
    whileVisible(l);
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_RELEASE_MS);
    // A second hidden signal while already released schedules nothing.
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_RELEASE_MS);
    setVisibility('visible');
    setVisibility('visible');
    expect(l.calls).toEqual(['open', 'release', 'open']);
  });

  it('starts released on a page opened in the background, and opens when first shown', () => {
    visibility = 'hidden';
    const l = lane();
    whileVisible(l);
    expect(l.calls).toEqual(['release']);
    setVisibility('visible');
    expect(l.calls).toEqual(['release', 'open']);
  });

  it('stops watching: a pending release is dropped and later changes are ignored', () => {
    const l = lane();
    const stop = whileVisible(l);
    setVisibility('hidden');
    stop();
    vi.advanceTimersByTime(HIDDEN_RELEASE_MS);
    setVisibility('visible');
    setVisibility('hidden');
    vi.advanceTimersByTime(HIDDEN_RELEASE_MS);
    expect(l.calls).toEqual(['open']);
  });
});
