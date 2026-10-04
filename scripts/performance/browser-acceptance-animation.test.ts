import { afterEach, expect, test } from 'bun:test';
import { MessageChannel } from 'node:worker_threads';

import { JSDOM } from 'jsdom';

import {
  checkAcceptanceAnimation,
  observeAcceptanceClose,
} from './browser/acceptance-animation.ts';

const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});
function fixture() {
  const dom = new JSDOM(
    '<body><div class="bg-bg-overlay" data-state="open"></div><div role="dialog" data-state="open"><span>Child</span></div></body>',
    { runScripts: 'outside-only' },
  );
  owned.push(dom);
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  Object.assign(dom.window, {
    MessageChannel,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++next;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
  });
  dom.window.eval(
    `(${observeAcceptanceClose.toString()})(document.querySelector('[role="dialog"]'))`,
  );
  const finish = () =>
    (
      dom.window as unknown as {
        __acceptanceClose: () => { events: unknown[]; overflow: boolean };
      }
    ).__acceptanceClose();
  const fire = (element: Element, type: string) => {
    const event = new dom.window.Event(type, { bubbles: true });
    Object.assign(event, {
      animationName: 'exit',
      elapsedTime: 0.2,
      pseudoElement: '',
    });
    element.dispatchEvent(event);
  };
  const frame = async () => {
    await Promise.resolve();
    const current = [...frames.values()];
    frames.clear();
    for (const callback of current) callback(dom.window.performance.now());
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  const ready = (
    dom.window as unknown as {
      __acceptanceCloseReady: Promise<{
        tDom: number;
        tRaf: number;
        tFrame: number;
      }>;
    }
  ).__acceptanceCloseReady;
  return { dom, finish, fire, frame, ready, frames };
}
test('only original node animation events are retained, and finalization removes listeners', () => {
  const f = fixture();
  const dialog = f.dom.window.document.querySelector('[role="dialog"]')!;
  f.fire(dialog.firstElementChild!, 'animationend');
  f.fire(dialog, 'animationstart');
  const receipt = f.finish();
  expect(receipt.events).toHaveLength(1);
  f.fire(dialog, 'animationend');
  expect(receipt.events).toHaveLength(1);
});
test('overflow is retained as invalid evidence rather than an uncaught event-handler error', () => {
  const f = fixture();
  const dialog = f.dom.window.document.querySelector('[role="dialog"]')!;
  for (let i = 0; i < 65; i += 1) f.fire(dialog, 'animationstart');
  const receipt = f.finish();
  expect(receipt.events).toHaveLength(64);
  expect(receipt.overflow).toBe(true);
  expect(() => checkAcceptanceAnimation(receipt, 100)).toThrow('bounded-out');
});
function completed() {
  return {
    overflow: false,
    reducedMotion: false,
    events: ['content', 'overlay'].flatMap((name) => [
      {
        name,
        state: 'closed',
        type: 'animationstart',
        eventAnimationName: 'exit',
        at: 10,
      },
      {
        name,
        state: 'closed',
        type: 'animationend',
        eventAnimationName: 'exit',
        at: 20,
      },
    ]),
    removals: ['content', 'overlay'].map((name) => ({ name, at: 21 })),
    final: ['content', 'overlay'].map((name) => ({ name, connected: false })),
  };
}
test('original exit completion and DOM removal remain distinct mandatory observations', () => {
  expect(checkAcceptanceAnimation(completed(), 21)).toBeDefined();
  expect(() => checkAcceptanceAnimation(completed(), 19)).toThrow(
    'precedes an original surface removal',
  );
  const cancelled = completed();
  cancelled.events[1]!.type = 'animationcancel';
  expect(() => checkAcceptanceAnimation(cancelled, 21)).toThrow('cancelled');
  const missing = completed();
  missing.events.shift();
  expect(() => checkAcceptanceAnimation(missing, 21)).toThrow('unambiguous');
  expect(() =>
    checkAcceptanceAnimation({ ...completed(), reducedMotion: true }, 21),
  ).toThrow('normal-motion');
  const mounted = completed();
  mounted.final[0]!.connected = true;
  expect(() => checkAcceptanceAnimation(mounted, 21)).toThrow(
    'remains mounted',
  );
});

test('a delayed original overlay cannot be hidden by the earlier content endpoint', async () => {
  const f = fixture();
  const dialog = f.dom.window.document.querySelector('[role="dialog"]')!;
  const overlay = f.dom.window.document.querySelector('.bg-bg-overlay')!;
  let finished = false;
  void f.ready.then(() => {
    finished = true;
    return undefined;
  });
  dialog.setAttribute('data-state', 'closed');
  overlay.setAttribute('data-state', 'closed');
  f.fire(dialog, 'animationstart');
  f.fire(overlay, 'animationstart');
  f.fire(dialog, 'animationend');
  dialog.remove();
  await f.frame();
  expect(finished).toBe(false);
  expect(f.frames.size).toBe(0);
  const earlyContentEndpoint = f.dom.window.performance.now();
  f.fire(overlay, 'animationend');
  overlay.remove();
  await f.frame();
  const full = await f.ready;
  expect(finished).toBe(true);
  expect(full.tDom).toBeGreaterThanOrEqual(earlyContentEndpoint);
  const evidence = f.finish();
  expect(() =>
    checkAcceptanceAnimation(evidence, earlyContentEndpoint),
  ).toThrow('precedes an original surface removal');
  expect(() => checkAcceptanceAnimation(evidence, full.tDom)).not.toThrow();
});
