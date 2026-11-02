import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../../lib/live-view.ts';
import { settle } from '../../testing/promises.ts';
import type { Frame } from '../browser/remote.ts';
import { MAX_QUEUED_BYTES, Outbox } from './outbox.ts';

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function frame(text: string, overrides: Partial<Frame> = {}): Frame {
  return { tab: 1, width: 800, height: 600, jpeg: bytes(text), ...overrides };
}

describe('Outbox', () => {
  it('sends the messages in order and only the newest picture', async () => {
    const outbox = new Outbox();
    outbox.send({ t: 'tabs', tabs: [] });
    outbox.picture(frame('one'));
    outbox.picture(frame('two')); // replaces "one": nobody was ready for it
    expect(await outbox.next()).toEqual({ t: 'tabs', tabs: [] });
    expect(await outbox.next()).toEqual({ t: 'view', tab: 1, w: 800, h: 600 });
    expect(await outbox.next()).toEqual(bytes('two'));

    outbox.picture(frame('three'));
    expect(await outbox.next()).toEqual(bytes('three')); // same view: no announcement

    outbox.picture(frame('other tab', { tab: 2 }));
    expect(await outbox.next()).toEqual({ t: 'view', tab: 2, w: 800, h: 600 });
    expect(await outbox.next()).toEqual(bytes('other tab'));

    outbox.send({ t: 'closed' });
    outbox.finish();
    expect(await outbox.next()).toEqual({ t: 'closed' });
    expect(await outbox.next()).toBeNull();
  });

  it('announces a new viewport size before its first picture', async () => {
    const outbox = new Outbox();
    outbox.picture(frame('wide'));
    await outbox.next();
    await outbox.next();

    outbox.picture(frame('narrow', { width: 400 }));
    expect(await outbox.next()).toEqual({ t: 'view', tab: 1, w: 400, h: 600 });
    expect(await outbox.next()).toEqual(bytes('narrow'));

    outbox.picture(frame('taller', { width: 400, height: 900 }));
    expect(await outbox.next()).toEqual({ t: 'view', tab: 1, w: 400, h: 900 });
    expect(await outbox.next()).toEqual(bytes('taller'));
  });

  it('keeps a picture right behind the view message it belongs to', async () => {
    const outbox = new Outbox();
    outbox.picture(frame('first'));
    expect(await outbox.next()).toEqual({ t: 'view', tab: 1, w: 800, h: 600 });
    // The client reads the picture in the space of the view message before it.
    outbox.send({ t: 'closed' });
    expect(await outbox.next()).toEqual(bytes('first'));
    expect(await outbox.next()).toEqual({ t: 'closed' });
  });

  it('puts messages before the picture that is waiting', async () => {
    const outbox = new Outbox();
    outbox.picture(frame('pic'));
    outbox.send({ t: 'selection', text: 'abc', cut: false });
    expect(await outbox.next()).toEqual({
      t: 'selection',
      text: 'abc',
      cut: false,
    });
    expect(await outbox.next()).toEqual({ t: 'view', tab: 1, w: 800, h: 600 });
  });

  it('hands out what comes while the consumer waits', async () => {
    const outbox = new Outbox();
    const waiting = outbox.next();
    let received: unknown = 'nothing yet';
    void (async () => {
      received = await waiting;
    })();
    await settle();
    expect(received).toBe('nothing yet');

    outbox.send({ t: 'closed' });
    expect(await waiting).toEqual({ t: 'closed' });

    const waitingForPicture = outbox.next();
    outbox.picture(frame('late'));
    expect(await waitingForPicture).toEqual({
      t: 'view',
      tab: 1,
      w: 800,
      h: 600,
    });
  });

  it('wakes a waiting consumer when it is finished', async () => {
    const outbox = new Outbox();
    const waiting = outbox.next();
    outbox.finish();
    expect(await waiting).toBeNull();
    expect(await outbox.next()).toBeNull();
  });

  it('still sends the picture that is waiting when it is finished', async () => {
    const outbox = new Outbox();
    outbox.picture(frame('last'));
    outbox.finish();
    expect(await outbox.next()).toEqual({ t: 'view', tab: 1, w: 800, h: 600 });
    expect(await outbox.next()).toEqual(bytes('last'));
    expect(await outbox.next()).toBeNull();
  });
});

function tabs(url: string): ServerMessage {
  return {
    t: 'tabs',
    tabs: [{ id: 1, url, title: 'T', loading: false, active: true }],
  };
}

function selection(size: number): ServerMessage {
  return { t: 'selection', text: 'x'.repeat(size), cut: false };
}

describe('Outbox, the tabs', () => {
  it('keeps only the newest tabs message: an older one says nothing the newest does not', async () => {
    const outbox = new Outbox();
    expect(outbox.send(tabs('https://one.example'))).toBe(true);
    expect(outbox.send(tabs('https://two.example'))).toBe(true);
    expect(outbox.send(tabs('https://three.example'))).toBe(true);
    expect(await outbox.next()).toEqual(tabs('https://three.example'));
    outbox.finish();
    expect(await outbox.next()).toBeNull();
  });

  it('puts the newest after the messages that came before it, so that nothing is told out of order', async () => {
    const outbox = new Outbox();
    outbox.send(tabs('https://one.example'));
    outbox.send({ t: 'dialog_closed', id: 3 });
    outbox.send(tabs('https://two.example'));
    expect(await outbox.next()).toEqual({ t: 'dialog_closed', id: 3 });
    expect(await outbox.next()).toEqual(tabs('https://two.example'));
  });

  it('does not take back a tabs message that was handed out already', async () => {
    const outbox = new Outbox();
    outbox.send(tabs('https://one.example'));
    expect(await outbox.next()).toEqual(tabs('https://one.example'));
    outbox.send(tabs('https://two.example'));
    expect(await outbox.next()).toEqual(tabs('https://two.example'));
  });

  it('counts a message that replaced another once', async () => {
    const outbox = new Outbox({ maxQueuedBytes: 1000 });
    const big = tabs(`https://${'a'.repeat(500)}`);
    // Each replaces the one before: the allowance is never reached.
    for (let n = 0; n < 50; n += 1) expect(outbox.send(big)).toBe(true);
  });
});

describe('Outbox, the allowance', () => {
  it('is a few megabytes', () => {
    expect(MAX_QUEUED_BYTES).toBe(8 * 1024 * 1024);
  });

  it('refuses a message that would make more wait than the allowance, and lets go of what waited', async () => {
    const outbox = new Outbox({ maxQueuedBytes: 1000 });
    expect(outbox.send(selection(400))).toBe(true);
    expect(outbox.send(selection(400))).toBe(true);
    expect(outbox.send(selection(400))).toBe(false);
    // The queue was dropped: nothing more is sent, not even what waited.
    expect(await outbox.next()).toBeNull();
    expect(outbox.send({ t: 'closed' })).toBe(false);
    expect(await outbox.next()).toBeNull();
  });

  it('takes no picture either once it dropped the queue', async () => {
    const outbox = new Outbox({ maxQueuedBytes: 1000 });
    outbox.send(selection(400));
    outbox.send(selection(400));
    expect(outbox.send(selection(400))).toBe(false);
    outbox.picture(frame('late'));
    expect(await outbox.next()).toBeNull();
  });

  it('takes a message of any size when nothing waits for the viewer', async () => {
    const outbox = new Outbox({ maxQueuedBytes: 1000 });
    expect(outbox.send(selection(5000))).toBe(true);
    expect(outbox.send(selection(1))).toBe(false);
  });

  it('gives the room back as the messages go out', async () => {
    const outbox = new Outbox({ maxQueuedBytes: 1000 });
    outbox.send(selection(400));
    outbox.send(selection(400));
    await outbox.next();
    expect(outbox.send(selection(400))).toBe(true);
    await outbox.next();
    await outbox.next();
    expect(outbox.send(selection(900))).toBe(true);
  });

  it('does not count the picture: a slow viewer skips pictures instead', async () => {
    const outbox = new Outbox({ maxQueuedBytes: 1000 });
    for (let n = 0; n < 100; n += 1) {
      outbox.picture(frame('x'.repeat(5000)));
    }
    expect(outbox.send(selection(100))).toBe(true);
  });

  it('weighs a message by the bytes it takes on the wire', async () => {
    const outbox = new Outbox({ maxQueuedBytes: 1000 });
    // 400 characters of three bytes each are 1200 bytes.
    expect(
      outbox.send({ t: 'selection', text: '€'.repeat(400), cut: false }),
    ).toBe(true);
    expect(outbox.send(selection(1))).toBe(false);
  });
});
