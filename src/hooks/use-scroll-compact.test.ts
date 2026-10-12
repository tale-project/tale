import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useScrollCompact } from './use-scroll-compact';

let shell: HTMLDivElement;
let pane: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('matchMedia', () =>
    Object.assign(new EventTarget(), { matches: true }),
  );
  shell = document.createElement('div');
  shell.className = 'mobile-nav-shell';
  pane = document.createElement('div');
  Object.defineProperties(pane, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 400 },
  });
  shell.append(pane);
  document.body.append(shell);
});
afterEach(() => {
  cleanup();
  shell.remove();
  vi.unstubAllGlobals();
});
function scroll(top: number) {
  act(() => {
    pane.scrollTop = top;
    pane.dispatchEvent(new Event('scroll'));
  });
}
it('compacts nested scrolling, ignores jitter, and restores on upward travel and top', () => {
  const { result } = renderHook(() => useScrollCompact('/home'));
  scroll(80);
  expect(result.current.compact).toBe(true);
  scroll(78);
  scroll(81);
  expect(result.current.compact).toBe(true);
  scroll(70);
  scroll(68);
  expect(result.current.compact).toBe(false);
  scroll(120);
  expect(result.current.compact).toBe(true);
  scroll(-20);
  expect(result.current.compact).toBe(false);
});
it('does not reverse on bottom rubber-banding and ignores horizontal events', () => {
  const { result } = renderHook(() => useScrollCompact('/home'));
  scroll(600);
  scroll(640);
  scroll(600);
  expect(result.current.compact).toBe(true);
  scroll(590);
  scroll(590);
  expect(result.current.compact).toBe(true);
});
it('ignores dialog scrolling and restores for navigation and keyboard changes', () => {
  const { result, rerender } = renderHook(
    ({ route, disabled }) => useScrollCompact(route, disabled),
    { initialProps: { route: '/home', disabled: false } },
  );
  pane.setAttribute('role', 'dialog');
  scroll(80);
  expect(result.current.compact).toBe(false);
  pane.removeAttribute('role');
  scroll(120);
  expect(result.current.compact).toBe(true);
  rerender({ route: '/settings', disabled: false });
  expect(result.current.compact).toBe(false);
  scroll(180);
  expect(result.current.compact).toBe(true);
  rerender({ route: '/settings', disabled: true });
  expect(result.current.compact).toBe(false);
  scroll(240);
  expect(result.current.compact).toBe(false);
});

it('tracks panes mounted after the navigation effect', () => {
  pane.remove();
  const { result } = renderHook(() => useScrollCompact('/settings'));
  shell.append(pane);
  scroll(80);
  expect(result.current.compact).toBe(true);
  scroll(120);
  expect(result.current.compact).toBe(true);
  scroll(90);
  expect(result.current.compact).toBe(false);
});

it('forces compact for the route floor: scroll, expand and breakpoint changes cannot lift it, leaving does', () => {
  const { result, rerender } = renderHook(
    ({ route, forceCompact }) => useScrollCompact(route, false, forceCompact),
    { initialProps: { route: '/automation/editor', forceCompact: true } },
  );
  expect(result.current.compact).toBe(true);
  // The bar's own tap-to-expand affordance must not win against the page's
  // floor — an automation canvas that expanded on tap would crowd its own
  // floating Deploy/Test actions right after the tap that triggered it.
  act(() => result.current.expand());
  expect(result.current.compact).toBe(true);
  scroll(-20);
  expect(result.current.compact).toBe(true);
  rerender({ route: '/automation/versions', forceCompact: true });
  expect(result.current.compact).toBe(true);
  rerender({ route: '/automations', forceCompact: false });
  expect(result.current.compact).toBe(false);
});
