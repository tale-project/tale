import { describe, expect, it } from 'vitest';

import type { ClientMessage } from '../../../lib/live-view.ts';
import { settle } from '../../testing/promises.ts';
import { Inputs, mergeInputs } from './inputs.ts';

type Mouse = Extract<ClientMessage, { t: 'mouse' }>;
type Wheel = Extract<ClientMessage, { t: 'wheel' }>;

function move(x: number, y: number): Mouse {
  return { t: 'mouse', a: 'move', x, y, b: 'left', n: 1 };
}

function button(a: 'down' | 'up', x = 1, y = 1): Mouse {
  return { t: 'mouse', a, x, y, b: 'left', n: 1 };
}

function wheel(x: number, y: number, dx: number, dy: number): Wheel {
  return { t: 'wheel', x, y, dx, dy };
}

const KEY_A: ClientMessage = { t: 'key', a: 'down', k: 'a' };

/** Everything that is queued, in order. */
async function drain(inputs: Inputs, count: number): Promise<ClientMessage[]> {
  const queued: ClientMessage[] = [];
  for (let index = 0; index < count; index++) {
    const message = await inputs.get();
    if (message === null) break;
    queued.push(message);
  }
  return queued;
}

describe('mergeInputs', () => {
  it('keeps the later of two mouse moves', () => {
    expect(mergeInputs(move(1, 1), move(5, 6))).toEqual(move(5, 6));
  });

  it('does not merge a button press or release with anything', () => {
    expect(mergeInputs(move(1, 1), button('down'))).toBeNull();
    expect(mergeInputs(button('down'), move(1, 1))).toBeNull();
    expect(mergeInputs(button('down'), button('down'))).toBeNull();
    expect(mergeInputs(button('up'), button('up'))).toBeNull();
  });

  it('adds up wheel ticks of one place', () => {
    expect(mergeInputs(wheel(5, 6, 1, 10), wheel(5, 6, 2, 20))).toEqual(
      wheel(5, 6, 3, 30),
    );
  });

  it('keeps wheel ticks of two places apart', () => {
    expect(mergeInputs(wheel(5, 6, 0, 10), wheel(7, 6, 0, 10))).toBeNull();
    expect(mergeInputs(wheel(5, 6, 0, 10), wheel(5, 7, 0, 10))).toBeNull();
  });

  it('keeps wheel ticks apart when their sum is no number a browser can scroll by', () => {
    const huge = Number.MAX_VALUE;
    expect(mergeInputs(wheel(1, 1, 0, huge), wheel(1, 1, 0, huge))).toBeNull();
    expect(mergeInputs(wheel(1, 1, huge, 0), wheel(1, 1, huge, 0))).toBeNull();
  });

  it('does not merge messages of different kinds', () => {
    expect(mergeInputs(move(1, 1), wheel(1, 1, 0, 1))).toBeNull();
    expect(mergeInputs(wheel(1, 1, 0, 1), KEY_A)).toBeNull();
    expect(mergeInputs(KEY_A, KEY_A)).toBeNull();
  });
});

describe('Inputs', () => {
  it('hands out the messages in the order they came', async () => {
    const inputs = new Inputs();
    inputs.put(KEY_A);
    inputs.put({ t: 'tab', a: 'open', url: 'https://two.example' });
    inputs.put({ t: 'key', a: 'down', k: 'b' });
    expect(await drain(inputs, 3)).toEqual([
      KEY_A,
      { t: 'tab', a: 'open', url: 'https://two.example' },
      { t: 'key', a: 'down', k: 'b' },
    ]);
  });

  it('merges the moves and wheel ticks that wait behind each other', async () => {
    const inputs = new Inputs();
    inputs.put(move(1, 1));
    inputs.put(move(2, 2));
    inputs.put(move(3, 3));
    for (const dy of [10, 20, 30]) inputs.put(wheel(5, 6, 1, dy));
    inputs.put(wheel(7, 6, 0, 5)); // over something else: a scroll of its own
    inputs.put(KEY_A);
    inputs.put(wheel(7, 6, 0, 5)); // after a key: it stays after it
    expect(await drain(inputs, 5)).toEqual([
      move(3, 3),
      wheel(5, 6, 3, 60),
      wheel(7, 6, 0, 5),
      KEY_A,
      wheel(7, 6, 0, 5),
    ]);
  });

  it('keeps a click between moves in place', async () => {
    const inputs = new Inputs();
    inputs.put(move(1, 1));
    inputs.put(button('down'));
    inputs.put(button('up'));
    inputs.put(move(2, 2));
    inputs.put(move(3, 3));
    expect(await drain(inputs, 4)).toEqual([
      move(1, 1),
      button('down'),
      button('up'),
      move(3, 3),
    ]);
  });

  it('does not merge into a message that was taken already', async () => {
    const inputs = new Inputs();
    inputs.put(move(1, 1));
    expect(await inputs.get()).toEqual(move(1, 1));
    inputs.put(move(2, 2));
    expect(await inputs.get()).toEqual(move(2, 2));
  });

  it('waits for the next message', async () => {
    const inputs = new Inputs();
    let received: ClientMessage | null | 'nothing yet' = 'nothing yet';
    void (async () => {
      received = await inputs.get();
    })();
    await settle();
    expect(received).toBe('nothing yet');

    inputs.put(KEY_A);
    await settle();
    expect(received).toEqual(KEY_A);
  });

  it('drops what is queued when it is closed, and releases a consumer that waits', async () => {
    const inputs = new Inputs();
    inputs.put(KEY_A);
    inputs.close();
    expect(await inputs.get()).toBeNull();

    const waiting = new Inputs();
    const pending = waiting.get();
    waiting.close();
    expect(await pending).toBeNull();
  });

  it('ignores what is put after it was closed', async () => {
    const inputs = new Inputs();
    inputs.close();
    inputs.put(KEY_A);
    expect(await inputs.get()).toBeNull();
  });
});
