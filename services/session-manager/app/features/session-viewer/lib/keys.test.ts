import { describe, expect, it } from 'vitest';

import { decideKeydown, HeldKeys, type KeyEventLike } from './keys';

function press(init: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    code: '',
    keyCode: 0,
    isComposing: false,
    metaKey: false,
    ctrlKey: false,
    ...init,
  };
}

describe('decideKeydown', () => {
  it('sends a plain key to the page', () => {
    expect(decideKeydown(press({ key: 'a' }))).toEqual({
      kind: 'key',
      key: 'a',
    });
    expect(decideKeydown(press({ key: 'Enter' }))).toEqual({
      kind: 'key',
      key: 'Enter',
    });
    expect(decideKeydown(press({ key: 'Shift' }))).toEqual({
      kind: 'key',
      key: 'Shift',
    });
  });

  it('sends Tab and Escape to the page too: a page that has the keyboard gets every key', () => {
    expect(decideKeydown(press({ key: 'Tab' }))).toEqual({
      kind: 'key',
      key: 'Tab',
    });
    expect(decideKeydown(press({ key: 'Escape' }))).toEqual({
      kind: 'key',
      key: 'Escape',
    });
  });

  it('sends a key with a modifier that is no shortcut of the browser', () => {
    expect(decideKeydown(press({ key: 'a', ctrlKey: true }))).toEqual({
      kind: 'key',
      key: 'a',
    });
    expect(decideKeydown(press({ key: 'z', metaKey: true }))).toEqual({
      kind: 'key',
      key: 'z',
    });
  });

  it.each([
    ['ctrlKey', 'l'],
    ['metaKey', 'l'],
    ['ctrlKey', 'L'],
  ] as const)('goes to the address bar on %s + %s', (modifier, key) => {
    expect(decideKeydown(press({ key, [modifier]: true }))).toEqual({
      kind: 'address',
    });
  });

  it('copies and cuts with the command key', () => {
    expect(decideKeydown(press({ key: 'c', metaKey: true }))).toEqual({
      kind: 'copy',
      cut: false,
    });
    expect(decideKeydown(press({ key: 'C', ctrlKey: true }))).toEqual({
      kind: 'copy',
      cut: false,
    });
    expect(decideKeydown(press({ key: 'x', ctrlKey: true }))).toEqual({
      kind: 'copy',
      cut: true,
    });
  });

  it('leaves pasting to the paste event', () => {
    expect(decideKeydown(press({ key: 'v', metaKey: true }))).toEqual({
      kind: 'paste',
    });
    expect(decideKeydown(press({ key: 'V', ctrlKey: true }))).toEqual({
      kind: 'paste',
    });
  });

  it('is plain typing without the command key', () => {
    expect(decideKeydown(press({ key: 'c' }))).toEqual({
      kind: 'key',
      key: 'c',
    });
    expect(decideKeydown(press({ key: 'v' }))).toEqual({
      kind: 'key',
      key: 'v',
    });
  });

  it.each([
    [{ key: 'r', metaKey: true }],
    [{ key: 'R', ctrlKey: true }],
    [{ key: 'q', metaKey: true }],
    [{ key: 'Tab', ctrlKey: true }],
    [{ key: 'F5' }],
    [{ key: 'F11' }],
    [{ key: 'F12' }],
  ])('keeps the shortcut %j with this browser', (init) => {
    expect(decideKeydown(press(init))).toEqual({ kind: 'local' });
  });

  it.each([
    [{ key: 'a', isComposing: true }],
    [{ key: 'Enter', keyCode: 229 }],
    [{ key: 'Dead' }],
    [{ key: 'Process' }],
    [{ key: 'Unidentified' }],
    [{ key: 'Compose' }],
  ])('leaves %j to the input method', (init) => {
    expect(decideKeydown(press(init))).toEqual({ kind: 'composing' });
  });

  it('leaves a key that ends a composition to the input method even with a command key', () => {
    expect(
      decideKeydown(press({ key: 'l', ctrlKey: true, isComposing: true })),
    ).toEqual({ kind: 'composing' });
  });
});

describe('HeldKeys', () => {
  it('releases a key with the key it pressed, whatever the layout says now', () => {
    const held = new HeldKeys();
    held.press('ShiftLeft', 'Shift');
    held.press('KeyH', 'H');
    // The Shift key goes up first: the "h" key now means an "h".
    expect(held.release('ShiftLeft')).toBe('Shift');
    expect(held.release('KeyH')).toBe('H');
    expect(held.size).toBe(0);
  });

  it('knows nothing of a key that was never pressed', () => {
    const held = new HeldKeys();
    expect(held.release('KeyA')).toBeUndefined();
  });

  it('forgets a key once it is released', () => {
    const held = new HeldKeys();
    held.press('KeyA', 'a');
    held.release('KeyA');
    expect(held.release('KeyA')).toBeUndefined();
  });

  it('keeps the key a held key was pressed with when it repeats', () => {
    const held = new HeldKeys();
    held.press('KeyA', 'a');
    held.press('KeyA', 'a');
    expect(held.size).toBe(1);
  });

  it('hands out every key still held, once', () => {
    const held = new HeldKeys();
    held.press('ControlLeft', 'Control');
    held.press('KeyC', 'c');
    expect(held.releaseAll().sort()).toEqual(['Control', 'c']);
    expect(held.releaseAll()).toEqual([]);
    expect(held.size).toBe(0);
  });

  it('forgets the keys it cannot release any more', () => {
    const held = new HeldKeys();
    held.press('KeyA', 'a');
    held.clear();
    expect(held.size).toBe(0);
    expect(held.release('KeyA')).toBeUndefined();
  });
});
