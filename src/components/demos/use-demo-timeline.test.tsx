import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMotionPreference } from '../../../tests/utils/motion-preference';
import { useDemoTimeline } from './use-demo-timeline';

const BEATS = [0, 1000, 2000] as const;

let now = 0;
let hidden = false;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();

function advanceFrame(time: number) {
  now = time;
  act(() => {
    const pending = [...frames.entries()];
    for (const [id, callback] of pending) {
      frames.delete(id);
      callback(time);
    }
  });
}

function setHidden(value: boolean) {
  hidden = value;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function Timeline() {
  const beat = useDemoTimeline({ beats: BEATS, start: true });
  return <span>{beat}</span>;
}

describe('useDemoTimeline', () => {
  beforeEach(() => {
    now = 0;
    hidden = false;
    frameId = 0;
    frames.clear();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++frameId;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    mockMotionPreference();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('completes immediately when reduced motion is enabled during playback, without replaying', () => {
    const preference = mockMotionPreference();
    const { result } = renderHook(() =>
      useDemoTimeline({ beats: BEATS, start: true }),
    );
    advanceFrame(1100);
    expect(result.current).toBe(1);

    act(() => preference.change(true));
    expect(result.current).toBe(2);
    expect(frames.size).toBe(0);

    act(() => preference.change(false));
    advanceFrame(1500);
    expect(result.current).toBe(2);
    expect(frames.size).toBe(0);
  });

  it('shows the final illustration before an offscreen demo starts when reduced motion is enabled', () => {
    const preference = mockMotionPreference();
    const { result } = renderHook(() =>
      useDemoTimeline({ beats: BEATS, start: false }),
    );
    expect(result.current).toBe(0);
    act(() => preference.change(true));
    expect(result.current).toBe(2);
    expect(frames.size).toBe(0);
  });

  it('does not schedule playback in a tab that mounts hidden', () => {
    hidden = true;
    const { result } = renderHook(() =>
      useDemoTimeline({ beats: BEATS, start: true }),
    );
    expect(frames.size).toBe(0);

    now = 10000;
    setHidden(false);
    advanceFrame(10500);
    expect(result.current).toBe(0);
    advanceFrame(11100);
    expect(result.current).toBe(1);
  });

  it('keeps elapsed playback when the tab is hidden and resumes without skipping beats', () => {
    const { result } = renderHook(() =>
      useDemoTimeline({ beats: BEATS, start: true }),
    );
    advanceFrame(1100);
    setHidden(true);
    expect(frames.size).toBe(0);
    now = 10000;
    setHidden(false);
    advanceFrame(10100);
    expect(result.current).toBe(1);
    advanceFrame(10900);
    expect(result.current).toBe(2);
    expect(frames.size).toBe(0);
  });

  it('renders the final beat on the server', () => {
    vi.stubGlobal('window', undefined);
    expect(renderToString(<Timeline />)).toBe('<span>2</span>');
  });
});
