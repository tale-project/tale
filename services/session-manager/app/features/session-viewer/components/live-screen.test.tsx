import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TEXT } from '@/lib/live-view';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  ControlledResizeObserver,
  fakeLive,
  stubDrawing,
  stubLayout,
  stubRoom,
  type Drawing,
  type Room,
} from '@/tests/utils/live-view';
import { renderApp } from '@/tests/utils/render';
import { ToastList, shownToasts } from '@/tests/utils/toast-list';

import type { LiveView } from '../hooks/use-live-view';
import { LONG_PRESS_MS } from '../hooks/use-remote-pointer';
import { KEYBOARD_HINT_MS, LiveScreen } from './live-screen';

let drawing: Drawing;

beforeEach(() => {
  drawing = stubDrawing();
  stubRoom(600, 500);
});

afterEach(() => {
  drawing.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(overrides: Partial<LiveView> = {}, notice?: ReactNode) {
  const fake = fakeLive(overrides);
  const sinkRef = createRef<HTMLTextAreaElement>();
  const focusPage = vi.fn(() => sinkRef.current?.focus());
  const focusAddress = vi.fn();
  // The page the screen is part of has its main landmark.
  const element = () => (
    <main>
      <LiveScreen
        live={fake.live}
        sinkRef={sinkRef}
        focusPage={focusPage}
        focusAddress={focusAddress}
        notice={notice}
      />
      <ToastList />
    </main>
  );
  const view = renderApp(element());
  return {
    ...view,
    ...fake,
    focusPage,
    focusAddress,
    sinkRef,
    /** Draws the screen again, as it does when the live view changed. */
    refresh: () => view.rerender(element()),
  };
}

/** Sends the first picture and waits until it is drawn. */
async function showPicture(fake: { emitFrame: (...bytes: number[]) => void }) {
  act(() => fake.emitFrame(1));
  return screen.findByRole('application', {
    name: 'Session browser',
  });
}

const keyboardField = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Keyboard input for the page',
  });

describe('LiveScreen drawing', () => {
  it('shows no picture until one has been drawn', () => {
    setup();
    expect(screen.queryByRole('application')).toBeNull();
    expect(screen.getByRole('application', { hidden: true })).toHaveAttribute(
      'hidden',
    );
  });

  it('draws the picture on a canvas of the size of the picture, and lets the bitmap go', async () => {
    drawing.restore();
    drawing = stubDrawing({ width: 1283, height: 801 });
    const fake = setup();
    const picture = await showPicture(fake);
    const canvas = picture.querySelector('canvas');
    expect(canvas?.width).toBe(1283);
    expect(canvas?.height).toBe(801);
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(1));
    expect(drawing.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1283 }),
      0,
      0,
    );
    expect(drawing.close).toHaveBeenCalledTimes(1);
  });

  it('decodes a picture as a JPEG', async () => {
    const fake = setup();
    await showPicture(fake);
    const [blob] = drawing.createImageBitmap.mock.calls[0] ?? [];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/jpeg');
  });

  it('keeps only the newest picture while one is being decoded', async () => {
    const decoded: ((bitmap: {
      width: number;
      height: number;
      close: () => void;
    }) => void)[] = [];
    drawing.createImageBitmap.mockImplementation(
      () => new Promise((resolve) => decoded.push(resolve)),
    );
    const fake = setup();
    act(() => {
      fake.emitFrame(1);
      // These two come while the first is still being decoded.
      fake.emitFrame(2, 2);
      fake.emitFrame(3, 3, 3);
    });
    expect(drawing.createImageBitmap).toHaveBeenCalledTimes(1);
    decoded[0]?.({ width: 1280, height: 800, close: drawing.close });
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(decoded).toHaveLength(2));
    decoded[1]?.({ width: 1280, height: 800, close: drawing.close });
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(2));
    // The first picture (5 bytes) and the newest (7), never the one between.
    expect(
      drawing.createImageBitmap.mock.calls.map(([blob]) => blob.size),
    ).toEqual([5, 7]);
  });

  it('draws a picture that comes after one that could not be decoded, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    drawing.createImageBitmap
      .mockRejectedValueOnce(new Error('damaged'))
      .mockRejectedValueOnce(new Error('damaged'));
    const fake = setup();
    act(() => fake.emitFrame(1));
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    act(() => fake.emitFrame(2));
    await waitFor(() =>
      expect(drawing.createImageBitmap).toHaveBeenCalledTimes(2),
    );
    act(() => fake.emitFrame(3));
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('draws nothing more once it is gone', async () => {
    const fake = setup();
    await showPicture(fake);
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalledTimes(1));
    fake.unmount();
    fake.emitFrame(2);
    expect(drawing.createImageBitmap).toHaveBeenCalledTimes(1);
    expect(drawing.drawImage).toHaveBeenCalledTimes(1);
  });
});

describe('LiveScreen fitting', () => {
  it('scales the picture down to the room, whole pixels, centred', async () => {
    const fake = setup();
    const picture = await showPicture(fake);
    // 1280 x 800 in 600 x 500: the width decides, 600 x 375, 62 px from the top.
    expect(picture.style.width).toBe('600px');
    expect(picture.style.height).toBe('375px');
    expect(picture.style.left).toBe('0px');
    expect(picture.style.top).toBe('62px');
  });

  it('never enlarges a page that is smaller than the room, and centres it', async () => {
    const fake = setup({ view: { tab: 1, w: 400, h: 300 } });
    const picture = await showPicture(fake);
    expect(picture.style.width).toBe('400px');
    expect(picture.style.height).toBe('300px');
    expect(picture.style.left).toBe('100px');
    expect(picture.style.top).toBe('100px');
  });

  it('fits the picture again when the room changes', async () => {
    vi.restoreAllMocks();
    ControlledResizeObserver.install();
    let room: Room = { width: 600, height: 500 };
    stubLayout(() => room);
    const fake = setup();
    const picture = await showPicture(fake);
    expect(picture.style.width).toBe('600px');
    room = { width: 320, height: 500 };
    act(() => ControlledResizeObserver.resizeAll());
    expect(picture.style.width).toBe('320px');
    expect(picture.style.height).toBe('200px');
    room = { width: 2000, height: 2000 };
    act(() => ControlledResizeObserver.resizeAll());
    expect(picture.style.width).toBe('1280px');
    expect(picture.style.height).toBe('800px');
  });

  it('follows the size of the page when its viewport changes', async () => {
    const fake = setup();
    const picture = await showPicture(fake);
    expect(picture.style.height).toBe('375px');
    // Another tab, another size: the live view says so.
    fake.live.view = { tab: 2, w: 640, h: 480 };
    fake.refresh();
    expect(picture.style.width).toBe('600px');
    expect(picture.style.height).toBe('450px');
    fake.live.view = { tab: 2, w: 300, h: 200 };
    fake.refresh();
    expect(picture.style.width).toBe('300px');
    expect(picture.style.height).toBe('200px');
  });

  it('draws nothing while the room has no size', async () => {
    stubRoom(0, 0);
    const fake = setup();
    act(() => fake.emitFrame(1));
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalled());
    expect(screen.queryByRole('application')).toBeNull();
  });
});

describe('LiveScreen mouse', () => {
  // The picture is shown at half the size of the page, 100 px from the left of
  // the window and 50 from the top: a position in it is half of the page's.
  const rect = {
    left: 100,
    top: 50,
    width: 640,
    height: 400,
    right: 740,
    bottom: 450,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  };

  async function pictureWithMouse(overrides: Partial<LiveView> = {}) {
    const harness = setup(overrides);
    const picture = await showPicture(harness);
    vi.spyOn(picture, 'getBoundingClientRect').mockReturnValue(rect);
    harness.send.mockClear();
    return { ...harness, picture };
  }

  const point = { clientX: 420, clientY: 250 };

  it('presses a button where the pointer is, in the pixels of the page, with the button and the click count', async () => {
    const { picture, send, focusPage } = await pictureWithMouse();
    const notPrevented = fireEvent.mouseDown(picture, {
      ...point,
      button: 0,
      detail: 1,
    });
    expect(notPrevented).toBe(false);
    expect(focusPage).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([
      [{ t: 'mouse', a: 'move', x: 640, y: 400 }],
      [{ t: 'mouse', a: 'down', x: 640, y: 400, b: 'left', n: 1 }],
    ]);
  });

  it.each([
    [0, 'left'],
    [1, 'middle'],
    [2, 'right'],
  ])('names button %i %s', async (button, name) => {
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseDown(picture, { ...point, button, detail: 1 });
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ a: 'down', b: name });
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 3],
    [0, 1],
  ])('counts %i presses in a row as %i', async (detail, clicks) => {
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseDown(picture, { ...point, button: 0, detail });
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ a: 'down', n: clicks });
  });

  it('releases the button where it was released, even outside the picture', async () => {
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseDown(picture, { ...point, button: 0, detail: 2 });
    send.mockClear();
    fireEvent.mouseUp(window, { clientX: 60, clientY: 500, button: 0 });
    // 60 is 40 px left of the picture, 500 is 50 under it: -80 and 900.
    expect(send.mock.calls).toEqual([
      [{ t: 'mouse', a: 'up', x: -80, y: 900, b: 'left', n: 2 }],
    ]);
  });

  it('lets only the release of the button that was pressed count, and only once', async () => {
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseDown(picture, { ...point, button: 0, detail: 1 });
    send.mockClear();
    fireEvent.mouseUp(window, { ...point, button: 2 });
    expect(send).not.toHaveBeenCalled();
    fireEvent.mouseUp(window, { ...point, button: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    fireEvent.mouseUp(window, { ...point, button: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('follows a drag that leaves the picture', async () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseDown(picture, { ...point, button: 0, detail: 1 });
    send.mockClear();
    fireEvent.mouseMove(window, { clientX: 20, clientY: 20 });
    vi.advanceTimersToNextFrame();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      t: 'mouse',
      a: 'move',
      x: -160,
      y: -60,
    });
  });

  it('stops following the pointer outside the picture once the button is up', async () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseDown(picture, { ...point, button: 0, detail: 1 });
    fireEvent.mouseUp(window, { ...point, button: 0 });
    send.mockClear();
    fireEvent.mouseMove(window, { clientX: 20, clientY: 20 });
    vi.advanceTimersToNextFrame();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the newest position of the pointer once a frame, not every move', async () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseMove(picture, { clientX: 110, clientY: 60 });
    fireEvent.mouseMove(picture, { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(picture, { clientX: 420, clientY: 250 });
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls).toEqual([
      [{ t: 'mouse', a: 'move', x: 640, y: 400 }],
    ]);
    fireEvent.mouseMove(picture, { clientX: 100, clientY: 50 });
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls.at(-1)).toEqual([
      { t: 'mouse', a: 'move', x: 0, y: 0 },
    ]);
  });

  it('turns the side buttons into back and forward when they are released', async () => {
    const { picture, send, focusPage } = await pictureWithMouse();
    expect(fireEvent.mouseDown(picture, { ...point, button: 3 })).toBe(false);
    expect(focusPage).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    fireEvent.mouseUp(picture, { ...point, button: 3 });
    fireEvent.mouseUp(picture, { ...point, button: 4 });
    expect(send.mock.calls).toEqual([
      [{ t: 'go', a: 'back' }],
      [{ t: 'go', a: 'forward' }],
    ]);
  });

  it('leaves the other releases over the picture alone', async () => {
    const { picture, send } = await pictureWithMouse();
    fireEvent.mouseUp(picture, { ...point, button: 2 });
    expect(send).not.toHaveBeenCalled();
  });

  it('adds up the wheel of a frame, at the place it last turned', async () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const { picture, send } = await pictureWithMouse();
    const first = fireEvent.wheel(picture, {
      ...point,
      deltaX: 0,
      deltaY: 100,
    });
    fireEvent.wheel(picture, {
      clientX: 100,
      clientY: 50,
      deltaX: 5,
      deltaY: 50,
    });
    // The picture does not scroll the manager.
    expect(first).toBe(false);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls).toEqual([
      [{ t: 'wheel', x: 0, y: 0, dx: 5, dy: 150 }],
    ]);
    vi.advanceTimersToNextFrame();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('turns a wheel of lines and a wheel of pages into pixels', async () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const { picture, send } = await pictureWithMouse();
    fireEvent.wheel(picture, { ...point, deltaY: 3, deltaMode: 1 });
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ dy: 48 });
    fireEvent.wheel(picture, { ...point, deltaY: -1, deltaMode: 2 });
    vi.advanceTimersToNextFrame();
    // A page is the height of the viewport of the page: 800.
    expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ dy: -800 });
  });

  it('shows no menu of its own and no drop of a file on the picture', async () => {
    const { picture } = await pictureWithMouse();
    expect(fireEvent.contextMenu(picture)).toBe(false);
    expect(fireEvent.dragOver(picture)).toBe(false);
    expect(fireEvent.drop(picture)).toBe(false);
    expect(fireEvent.dragStart(picture)).toBe(false);
  });

  it('sends nothing before it knows the size of the page', async () => {
    const harness = setup({ view: null });
    act(() => harness.emitFrame(1));
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalled());
    const picture = screen.getByRole('application', { hidden: true });
    fireEvent.mouseDown(picture, { ...point, button: 0, detail: 1 });
    fireEvent.mouseUp(window, { ...point, button: 0 });
    fireEvent.wheel(picture, { ...point, deltaY: 10 });
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('lets a button go that is still down when it is gone, without a word', async () => {
    const { picture, send, unmount } = await pictureWithMouse();
    fireEvent.mouseDown(picture, { ...point, button: 0, detail: 1 });
    send.mockClear();
    unmount();
    fireEvent.mouseUp(window, { ...point, button: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('LiveScreen touch', () => {
  // The same place as for the mouse: the picture is shown at half the size of
  // the page, 100 px from the left of the window and 50 from the top.
  const rect = {
    left: 100,
    top: 50,
    width: 640,
    height: 400,
    right: 740,
    bottom: 450,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  };

  async function pictureWithFinger(overrides: Partial<LiveView> = {}) {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    });
    const harness = setup(overrides);
    vi.useRealTimers();
    const picture = await showPicture(harness);
    // From here the time is the test's: the frames, and the wait of a long press.
    vi.useFakeTimers({
      toFake: [
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'setTimeout',
        'clearTimeout',
      ],
    });
    vi.spyOn(picture, 'getBoundingClientRect').mockReturnValue(rect);
    harness.send.mockClear();
    harness.focusPage.mockClear();
    return { ...harness, picture };
  }

  type Kind = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

  /** A finger, or whatever `type` is, at a place of the window. */
  function point(
    picture: Element,
    kind: Kind,
    x: number,
    y: number,
    { type = 'touch', id = 1 }: { type?: string; id?: number } = {},
  ) {
    return fireEvent[kind](picture, {
      pointerType: type,
      pointerId: id,
      isPrimary: id === 1,
      clientX: x,
      clientY: y,
    });
  }

  it('scrolls the page by what the finger drags it: the content follows the finger, in the pixels of the page', async () => {
    const { picture, send } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 150);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    // 100 px up on a picture at half size is 200 px of the page, to see what is below, at the finger.
    expect(send.mock.calls).toEqual([
      [{ t: 'wheel', x: 640, y: 200, dx: 0, dy: 200 }],
    ]);
  });

  it('scrolls sideways when the finger drags sideways', async () => {
    const { picture, send } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 320, 250);
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls).toEqual([
      [{ t: 'wheel', x: 440, y: 400, dx: 200, dy: 0 }],
    ]);
  });

  it('adds up what a frame saw of the drag, and goes on from where the finger was', async () => {
    const { picture, send } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 230);
    point(picture, 'pointerMove', 420, 200);
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls).toEqual([
      [{ t: 'wheel', x: 640, y: 300, dx: 0, dy: 100 }],
    ]);
    point(picture, 'pointerMove', 420, 210);
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls.at(-1)).toEqual([
      { t: 'wheel', x: 640, y: 320, dx: 0, dy: -20 },
    ]);
  });

  it('keeps the wheel of a drag out of the way of the keyboard: it does not give the page the keyboard', async () => {
    const { picture, focusPage } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 150);
    point(picture, 'pointerUp', 420, 150);
    expect(focusPage).not.toHaveBeenCalled();
  });

  it('leaves a touch that stays within a few pixels to what it is, a tap, which the browser makes a click of', async () => {
    const { picture, send, focusPage } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 423, 252);
    point(picture, 'pointerUp', 423, 252);
    vi.advanceTimersToNextFrame();
    expect(send).not.toHaveBeenCalled();
    // The click the browser makes of a tap is the mouse of before.
    fireEvent.mouseDown(picture, {
      clientX: 423,
      clientY: 252,
      button: 0,
      detail: 1,
    });
    expect(focusPage).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([
      [{ t: 'mouse', a: 'move', x: 646, y: 404 }],
      [{ t: 'mouse', a: 'down', x: 646, y: 404, b: 'left', n: 1 }],
    ]);
  });

  it('is not a click when the drag ends: the mouse events some browsers send after it are let go', async () => {
    const { picture, send } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 150);
    vi.advanceTimersToNextFrame();
    point(picture, 'pointerUp', 420, 150);
    send.mockClear();
    fireEvent.mouseMove(picture, { clientX: 420, clientY: 150 });
    fireEvent.mouseDown(picture, {
      clientX: 420,
      clientY: 150,
      button: 0,
      detail: 1,
    });
    fireEvent.mouseUp(window, { clientX: 420, clientY: 150, button: 0 });
    vi.advanceTimersToNextFrame();
    expect(send).not.toHaveBeenCalled();
  });

  it('takes the mouse at once again after a drag', async () => {
    const { picture, send } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 150);
    point(picture, 'pointerUp', 420, 150);
    // Somebody picks up the mouse: its press comes with a pointer event of its own.
    point(picture, 'pointerDown', 420, 250, { type: 'mouse' });
    send.mockClear();
    fireEvent.mouseDown(picture, {
      clientX: 420,
      clientY: 250,
      button: 0,
      detail: 1,
    });
    expect(send.mock.calls.at(-1)).toEqual([
      { t: 'mouse', a: 'down', x: 640, y: 400, b: 'left', n: 1 },
    ]);
  });

  it('does not scroll for a mouse or a pen moving over the picture, which has its own ways', async () => {
    const { picture, send } = await pictureWithFinger();
    for (const type of ['mouse', 'pen']) {
      point(picture, 'pointerDown', 420, 250, { type });
      point(picture, 'pointerMove', 420, 150, { type });
      point(picture, 'pointerUp', 420, 150, { type });
    }
    vi.advanceTimersToNextFrame();
    expect(send).not.toHaveBeenCalled();
  });

  it('follows the first finger only', async () => {
    const { picture, send } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250, { id: 1 });
    point(picture, 'pointerDown', 300, 300, { id: 2 });
    point(picture, 'pointerMove', 300, 100, { id: 2 });
    vi.advanceTimersToNextFrame();
    expect(send).not.toHaveBeenCalled();
    point(picture, 'pointerMove', 420, 200, { id: 1 });
    vi.advanceTimersToNextFrame();
    expect(send.mock.calls).toEqual([
      [{ t: 'wheel', x: 640, y: 300, dx: 0, dy: 100 }],
    ]);
  });

  it('stops following a finger that the browser took back', async () => {
    const { picture, send } = await pictureWithFinger();
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 200);
    point(picture, 'pointerCancel', 420, 200);
    vi.advanceTimersToNextFrame();
    send.mockClear();
    point(picture, 'pointerMove', 420, 100);
    vi.advanceTimersToNextFrame();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing while the connection is not live', async () => {
    const { picture, send } = await pictureWithFinger({ state: 'lost' });
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 150);
    vi.advanceTimersToNextFrame();
    expect(send).not.toHaveBeenCalled();
  });

  describe('a finger that is held still', () => {
    const rightClick = [
      [{ t: 'mouse', a: 'move', x: 640, y: 400 }],
      [{ t: 'mouse', a: 'down', x: 640, y: 400, b: 'right', n: 1 }],
      [{ t: 'mouse', a: 'up', x: 640, y: 400, b: 'right', n: 1 }],
    ];

    it('clicks the right button of the mouse where it rests, as a long press does everywhere', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250);
      vi.advanceTimersByTime(LONG_PRESS_MS - 1);
      expect(send).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(send.mock.calls).toEqual(rightClick);
    });

    it('is not a tap when it is let go: the click the browser may send after it is let go', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      send.mockClear();
      point(picture, 'pointerUp', 420, 250);
      fireEvent.mouseDown(picture, {
        clientX: 420,
        clientY: 250,
        button: 0,
        detail: 1,
      });
      fireEvent.mouseUp(window, { clientX: 420, clientY: 250, button: 0 });
      expect(send).not.toHaveBeenCalled();
    });

    it('does only once, however long the finger stays', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250);
      vi.advanceTimersByTime(LONG_PRESS_MS * 10);
      expect(send.mock.calls).toEqual(rightClick);
    });

    it('is a drag, not a long press, once the finger moves', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250);
      point(picture, 'pointerMove', 420, 200);
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      expect(
        send.mock.calls.filter(([message]) => message.t === 'mouse'),
      ).toEqual([]);
    });

    it('may tremble a little without losing the press', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250);
      point(picture, 'pointerMove', 424, 253);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(send.mock.calls).toEqual(rightClick);
    });

    it('is not a long press when the finger is lifted in time, which is a tap', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250);
      vi.advanceTimersByTime(LONG_PRESS_MS - 100);
      point(picture, 'pointerUp', 420, 250);
      vi.advanceTimersByTime(LONG_PRESS_MS);
      expect(send).not.toHaveBeenCalled();
    });

    it('is not a long press when the browser took the finger back', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250);
      point(picture, 'pointerCancel', 420, 250);
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      expect(send).not.toHaveBeenCalled();
    });

    it('is not a long press for a mouse that is held down: that is a drag of its own', async () => {
      const { picture, send } = await pictureWithFinger();
      point(picture, 'pointerDown', 420, 250, { type: 'mouse' });
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      expect(send).not.toHaveBeenCalled();
    });

    it('does nothing while the connection is not live', async () => {
      const { picture, send } = await pictureWithFinger({ state: 'lost' });
      point(picture, 'pointerDown', 420, 250);
      vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      expect(send).not.toHaveBeenCalled();
    });
  });

  it('sends nothing before it knows the size of the page', async () => {
    const harness = setup({ view: null });
    act(() => harness.emitFrame(1));
    await waitFor(() => expect(drawing.drawImage).toHaveBeenCalled());
    const picture = screen.getByRole('application', { hidden: true });
    point(picture, 'pointerDown', 420, 250);
    point(picture, 'pointerMove', 420, 150);
    expect(harness.send).not.toHaveBeenCalled();
  });
});

describe('LiveScreen losing the connection', () => {
  const rect = {
    left: 100,
    top: 50,
    width: 640,
    height: 400,
    right: 740,
    bottom: 450,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  };

  it('forgets a button that was pressed on the connection that is gone: its release is not sent to the next one', async () => {
    const harness = setup();
    const picture = await showPicture(harness);
    vi.spyOn(picture, 'getBoundingClientRect').mockReturnValue(rect);
    fireEvent.mouseDown(picture, {
      clientX: 420,
      clientY: 250,
      button: 0,
      detail: 1,
    });
    harness.live.state = 'lost';
    harness.refresh();
    harness.live.state = 'live';
    harness.refresh();
    harness.send.mockClear();
    // The server let go of the button when the old connection ended.
    fireEvent.mouseUp(window, { clientX: 420, clientY: 250, button: 0 });
    expect(harness.send).not.toHaveBeenCalled();
  });

  it('still lets a button go that was pressed on the connection that is live', async () => {
    const harness = setup();
    const picture = await showPicture(harness);
    vi.spyOn(picture, 'getBoundingClientRect').mockReturnValue(rect);
    fireEvent.mouseDown(picture, {
      clientX: 420,
      clientY: 250,
      button: 0,
      detail: 1,
    });
    harness.send.mockClear();
    fireEvent.mouseUp(window, { clientX: 420, clientY: 250, button: 0 });
    expect(harness.send).toHaveBeenCalledTimes(1);
  });
});

describe('LiveScreen keyboard', () => {
  async function pictureWithKeyboard(overrides: Partial<LiveView> = {}) {
    const harness = setup(overrides);
    await showPicture(harness);
    harness.send.mockClear();
    return { ...harness, field: keyboardField() };
  }

  it('hands the keyboard to the page when the picture is entered with the tab key', async () => {
    const { user, field, focusPage } = await pictureWithKeyboard();
    await user.tab();
    expect(focusPage).toHaveBeenCalledTimes(1);
    expect(field).toHaveFocus();
  });

  it('describes the way out of the page to a screen reader', async () => {
    await pictureWithKeyboard();
    const picture = screen.getByRole('application');
    expect(picture).toHaveAccessibleDescription(
      'Everything you type goes to the page. To go to the address bar, press Control+L.',
    );
  });

  it('describes it on the field that keeps the keyboard, which is what a screen reader is left with', async () => {
    const { field } = await pictureWithKeyboard();
    expect(field).toHaveAccessibleDescription(
      'Everything you type goes to the page. To go to the address bar, press Control+L.',
    );
  });

  it('names the shortcut on the field that takes it', async () => {
    const { field } = await pictureWithKeyboard();
    expect(field).toHaveAttribute('aria-keyshortcuts', 'Control+L');
  });

  describe('the hint that shows how to leave', () => {
    const hint =
      'Everything you type goes to the page. To go to the address bar, press Control+L.';

    /** Says whether the browser would draw a focus ring on what has the focus (it does for a key, not for a click). */
    function focusRingFor(visible: boolean) {
      vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (
        this: HTMLElement,
        selector: string,
      ) {
        // Anything else is asked as the browser would answer it.
        return selector === ':focus-visible'
          ? visible
          : this.closest(selector) === this;
      });
    }

    it('shows on the screen, where the eyes are, when the picture is entered with the tab key', async () => {
      const { user } = await pictureWithKeyboard();
      focusRingFor(true);
      await user.tab();
      expect(screen.getByRole('status')).toHaveTextContent(hint);
    });

    it('does not show when the picture is entered with the mouse', async () => {
      const { user } = await pictureWithKeyboard();
      focusRingFor(false);
      await user.tab();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('goes at the first key', async () => {
      const { user, field } = await pictureWithKeyboard();
      focusRingFor(true);
      await user.tab();
      expect(screen.getByRole('status')).toHaveTextContent(hint);
      fireEvent.keyDown(field, { key: 'a', code: 'KeyA' });
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('goes when the keyboard leaves the page', async () => {
      const { user, field } = await pictureWithKeyboard();
      focusRingFor(true);
      await user.tab();
      fireEvent.blur(field);
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('goes by itself after a few seconds', async () => {
      const { field } = await pictureWithKeyboard();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      focusRingFor(true);
      const picture = screen.getByRole('application');
      act(() => picture.focus());
      expect(screen.getByRole('status')).toHaveTextContent(hint);
      act(() => {
        vi.advanceTimersByTime(KEYBOARD_HINT_MS - 100);
      });
      expect(screen.getByRole('status')).toHaveTextContent(hint);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(field).toBeInTheDocument();
    });
  });

  it('sends a key as it goes down and as it comes up, and keeps it from the manager', async () => {
    const { field, send } = await pictureWithKeyboard();
    expect(fireEvent.keyDown(field, { key: 'a', code: 'KeyA' })).toBe(false);
    expect(fireEvent.keyUp(field, { key: 'a', code: 'KeyA' })).toBe(false);
    expect(send.mock.calls).toEqual([
      [{ t: 'key', a: 'down', k: 'a' }],
      [{ t: 'key', a: 'up', k: 'a' }],
    ]);
  });

  it('sends the keys a page gets: Tab, Escape and the arrows too', async () => {
    const { user, field, send } = await pictureWithKeyboard();
    field.focus();
    await user.keyboard('{Tab}{Escape}{ArrowLeft}');
    expect(
      send.mock.calls
        .map(([message]) => message)
        .filter((message) => message.t === 'key' && message.a === 'down')
        .map((message) => (message.t === 'key' ? message.k : '')),
    ).toEqual(['Tab', 'Escape', 'ArrowLeft']);
    // Tab did not move the keyboard on: the page has it.
    expect(field).toHaveFocus();
  });

  it('lets go of a key with the key it pressed, whatever the layout says by then', async () => {
    const { field, send } = await pictureWithKeyboard();
    fireEvent.keyDown(field, { key: 'Shift', code: 'ShiftLeft' });
    fireEvent.keyDown(field, { key: 'H', code: 'KeyH' });
    fireEvent.keyUp(field, { key: 'Shift', code: 'ShiftLeft' });
    // Shift is up: the key now reads "h", but "H" is what went down.
    fireEvent.keyUp(field, { key: 'h', code: 'KeyH' });
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { t: 'key', a: 'down', k: 'Shift' },
      { t: 'key', a: 'down', k: 'H' },
      { t: 'key', a: 'up', k: 'Shift' },
      { t: 'key', a: 'up', k: 'H' },
    ]);
  });

  it('knows nothing of a key that went down before the page had the keyboard', async () => {
    const { field, send } = await pictureWithKeyboard();
    expect(fireEvent.keyUp(field, { key: 'a', code: 'KeyA' })).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['ctrlKey', 'c', false],
    ['metaKey', 'c', false],
    ['ctrlKey', 'x', true],
    ['metaKey', 'x', true],
  ] as const)(
    'asks the page for its selection on %s + %s',
    async (modifier, key, cut) => {
      const { field, send } = await pictureWithKeyboard();
      expect(
        fireEvent.keyDown(field, {
          key,
          code: `Key${key.toUpperCase()}`,
          [modifier]: true,
        }),
      ).toBe(false);
      expect(send.mock.calls).toEqual([[{ t: 'copy', cut }]]);
    },
  );

  it('types what is pasted, as text, not as keys', async () => {
    const { field, send } = await pictureWithKeyboard();
    // The paste shortcut itself is left to the browser: it fires a paste event.
    expect(
      fireEvent.keyDown(field, { key: 'v', code: 'KeyV', metaKey: true }),
    ).toBe(true);
    expect(send).not.toHaveBeenCalled();
    const notPrevented = fireEvent.paste(field, {
      clipboardData: { getData: () => 'a secret\nin two lines' },
    });
    expect(notPrevented).toBe(false);
    expect(send.mock.calls).toEqual([
      [{ t: 'text', text: 'a secret\nin two lines' }],
    ]);
  });

  it('pastes nothing when the clipboard has no text', async () => {
    const { field, send } = await pictureWithKeyboard();
    fireEvent.paste(field, { clipboardData: { getData: () => '' } });
    expect(send).not.toHaveBeenCalled();
    expect(shownToasts()).toEqual([]);
  });

  it('types a paste of the most the protocol takes, and says nothing about it', async () => {
    const { field, send } = await pictureWithKeyboard();
    const text = 'abcdefghij'.repeat(MAX_TEXT / 10);
    fireEvent.paste(field, { clipboardData: { getData: () => text } });
    expect(send.mock.calls).toEqual([[{ t: 'text', text }]]);
    expect(shownToasts()).toEqual([]);
  });

  it('types the beginning of a paste that is longer, not a message the server would close the connection on, and says what was left out', async () => {
    const { field, send } = await pictureWithKeyboard();
    // More than a megabyte of text: the socket would be closed for a message of that size.
    const text = 'abcdefghij'.repeat(120_000);
    fireEvent.paste(field, { clipboardData: { getData: () => text } });
    expect(send.mock.calls).toEqual([
      [{ t: 'text', text: text.slice(0, MAX_TEXT) }],
    ]);
    expect(shownToasts()).toEqual([
      {
        title: "Couldn't paste all of the text",
        description:
          'You can paste up to 100,000 characters at once. The rest was left out.',
      },
    ]);
  });

  it('does not cut a character of the paste in two', async () => {
    const { field, send } = await pictureWithKeyboard();
    const text = `${'b'.repeat(MAX_TEXT - 1)}😀 and the rest`;
    fireEvent.paste(field, { clipboardData: { getData: () => text } });
    const [[message]] = send.mock.calls;
    expect(message).toEqual({ t: 'text', text: 'b'.repeat(MAX_TEXT - 1) });
  });

  it('takes ⌘L / Ctrl+L as the way out, to the address bar', async () => {
    const { field, send, focusAddress } = await pictureWithKeyboard();
    expect(
      fireEvent.keyDown(field, { key: 'l', code: 'KeyL', ctrlKey: true }),
    ).toBe(false);
    expect(
      fireEvent.keyDown(field, { key: 'L', code: 'KeyL', metaKey: true }),
    ).toBe(false);
    expect(focusAddress).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    [{ key: 'r', code: 'KeyR', metaKey: true }],
    [{ key: 'q', code: 'KeyQ', ctrlKey: true }],
    [{ key: 'Tab', code: 'Tab', ctrlKey: true }],
    [{ key: 'F5', code: 'F5' }],
    [{ key: 'F11', code: 'F11' }],
    [{ key: 'F12', code: 'F12' }],
  ])('leaves the shortcut %j to this browser', async (init) => {
    const { field, send } = await pictureWithKeyboard();
    expect(fireEvent.keyDown(field, init)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves the keys of an input method to its composition', async () => {
    const { field, send } = await pictureWithKeyboard();
    expect(fireEvent.keyDown(field, { key: 'Dead', code: 'Quote' })).toBe(true);
    expect(
      fireEvent.keyDown(field, { key: 'a', code: 'KeyA', isComposing: true }),
    ).toBe(true);
    expect(
      fireEvent.keyDown(field, { key: 'Enter', code: 'Enter', keyCode: 229 }),
    ).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('types the text a composition ends with, and empties the field', async () => {
    const { field, send } = await pictureWithKeyboard();
    field.value = 'é';
    fireEvent.compositionEnd(field, { data: 'é' });
    expect(send.mock.calls).toEqual([[{ t: 'text', text: 'é' }]]);
    expect(field.value).toBe('');
  });

  it('types text that no key made (an emoji picker, dictation)', async () => {
    const { field, send } = await pictureWithKeyboard();
    field.value = '😀';
    fireEvent.input(field, { data: '😀', isComposing: false });
    expect(send.mock.calls).toEqual([[{ t: 'text', text: '😀' }]]);
    expect(field.value).toBe('');
  });

  it('waits for the end of a composition before it types', async () => {
    const { field, send } = await pictureWithKeyboard();
    field.value = 'に';
    fireEvent.input(field, { data: 'に', isComposing: true });
    expect(send).not.toHaveBeenCalled();
    expect(field.value).toBe('に');
  });

  it('lets go of the keys held down when the page loses the keyboard', async () => {
    const { field, send } = await pictureWithKeyboard();
    fireEvent.keyDown(field, { key: 'Control', code: 'ControlLeft' });
    fireEvent.keyDown(field, { key: 'a', code: 'KeyA' });
    send.mockClear();
    fireEvent.blur(field);
    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { t: 'key', a: 'up', k: 'Control' },
      { t: 'key', a: 'up', k: 'a' },
    ]);
    fireEvent.blur(field);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('lets go of the keys held down when the window is left or hidden', async () => {
    const { field, send } = await pictureWithKeyboard();
    fireEvent.keyDown(field, { key: 'Shift', code: 'ShiftLeft' });
    send.mockClear();
    fireEvent(window, new Event('pagehide'));
    expect(send.mock.calls).toEqual([[{ t: 'key', a: 'up', k: 'Shift' }]]);

    fireEvent.keyDown(field, { key: 'Alt', code: 'AltLeft' });
    send.mockClear();
    // A page that merely loses visibility to the other window is not hidden.
    fireEvent(document, new Event('visibilitychange'));
    expect(send).not.toHaveBeenCalled();
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    try {
      fireEvent(document, new Event('visibilitychange'));
    } finally {
      Reflect.deleteProperty(document, 'hidden');
    }
    expect(send.mock.calls).toEqual([[{ t: 'key', a: 'up', k: 'Alt' }]]);
  });
});

describe('LiveScreen states', () => {
  it('marks the picture as unavailable while the connection is not live', async () => {
    const fake = setup({ state: 'lost' });
    const picture = await showPicture(fake);
    expect(picture).toHaveAttribute('aria-disabled', 'true');
  });

  it('is available while live', async () => {
    const fake = setup();
    const picture = await showPicture(fake);
    expect(picture).not.toHaveAttribute('aria-disabled');
  });

  it('says what is the matter over the picture', () => {
    setup({}, <p>Connection lost. Reconnecting…</p>);
    expect(screen.getByText('Connection lost. Reconnecting…')).toBeVisible();
  });

  it('opens the list of a select of the page over the picture, and answers it', async () => {
    const live = fakeLive({
      selectMenu: {
        token: 4,
        x: 100,
        y: 100,
        width: 200,
        height: 40,
        options: [
          { label: 'One', selected: true, disabled: false, group: null },
          { label: 'Two', selected: false, disabled: false, group: null },
        ],
      },
    });
    const sinkRef = createRef<HTMLTextAreaElement>();
    const focusPage = vi.fn();
    const { user } = renderApp(
      <main>
        <LiveScreen
          live={live.live}
          sinkRef={sinkRef}
          focusPage={focusPage}
          focusAddress={vi.fn()}
        />
      </main>,
    );
    await showPicture(live);
    await user.click(screen.getByRole('option', { name: 'Two' }));
    expect(live.live.pickOption).toHaveBeenCalledExactlyOnceWith(4, 1);
    expect(focusPage).toHaveBeenCalled();
  });

  it('shows no list while the page has no size yet', () => {
    setup({
      view: null,
      selectMenu: {
        token: 4,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        options: [
          { label: 'One', selected: false, disabled: false, group: null },
        ],
      },
    });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('has no accessibility violations with a picture', async () => {
    const fake = setup();
    await showPicture(fake);
    await checkAccessibility(document.body);
  });

  it('has no accessibility violations with a message over it', async () => {
    const fake = setup({ state: 'lost' }, <p>Connection lost.</p>);
    await showPicture(fake);
    await checkAccessibility(document.body);
  });
});
