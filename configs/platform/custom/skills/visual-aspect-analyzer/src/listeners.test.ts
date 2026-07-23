import { describe, expect, test } from 'bun:test';

import { installListenerRegistry, nullListenerRegistry } from './listeners';

describe('installListenerRegistry', () => {
  test('records boundary events and ignores non-boundary ones', () => {
    class T extends EventTarget {}
    const { registry, uninstall } = installListenerRegistry(T.prototype);
    const target = new T();
    target.addEventListener('click', () => {});
    target.addEventListener('mouseover', () => {}); // not a boundary type
    expect(registry.has(target)).toBe(true);
    expect([...registry.typesFor(target)]).toEqual(['click']);
    uninstall();
  });

  test('is faithful: the wrapped listener still fires', () => {
    class T extends EventTarget {}
    const { registry, uninstall } = installListenerRegistry(T.prototype);
    const target = new T();
    let fired = 0;
    target.addEventListener('click', () => {
      fired++;
    });
    target.dispatchEvent(new Event('click'));
    expect(fired).toBe(1);
    expect(registry.has(target)).toBe(true);
    uninstall();
  });

  test('drainPending flags a boundary add then resets (lazy-hydration signal)', () => {
    class T extends EventTarget {}
    const { registry, uninstall } = installListenerRegistry(T.prototype);
    expect(registry.drainPending()).toBe(false); // nothing registered yet
    const target = new T();
    target.addEventListener('mouseover', () => {}); // non-boundary: no signal
    expect(registry.drainPending()).toBe(false);
    target.addEventListener('click', () => {}); // boundary: raises the flag
    expect(registry.drainPending()).toBe(true);
    expect(registry.drainPending()).toBe(false); // drained on read
    // A duplicate of an already-recorded type does not re-flag.
    target.addEventListener('click', () => {});
    expect(registry.drainPending()).toBe(false);
    uninstall();
  });

  test('removeEventListener clears the recorded type', () => {
    class T extends EventTarget {}
    const { registry, uninstall } = installListenerRegistry(T.prototype);
    const target = new T();
    const fn = (): void => {};
    target.addEventListener('click', fn);
    expect(registry.has(target)).toBe(true);
    target.removeEventListener('click', fn);
    expect(registry.has(target)).toBe(false);
    uninstall();
  });

  test('uninstall restores the original methods', () => {
    class T extends EventTarget {}
    const original = T.prototype.addEventListener;
    const { uninstall } = installListenerRegistry(T.prototype);
    expect(T.prototype.addEventListener).not.toBe(original);
    uninstall();
    expect(T.prototype.addEventListener).toBe(original);
  });

  test('add bookkeeping failure is logged once, and the real call still rejects it', () => {
    // A primitive `this` reaches the bookkeeping's `map.set(this, ...)`, which a
    // WeakMap cannot key on a non-object — the catch swallows and logs it. The
    // faithful pass-through then calls the genuine native addEventListener with
    // that same invalid `this`, which legitimately rejects it.
    class T extends EventTarget {}
    const { uninstall } = installListenerRegistry(T.prototype);

    const origWarn = console.warn;
    let warned = 0;
    let loggedMessage = '';
    console.warn = (message: string): void => {
      warned++;
      loggedMessage = message;
    };

    let threwTypeError = false;
    try {
      const patched = T.prototype.addEventListener;
      patched.call(7, 'click', () => {});
    } catch (err) {
      threwTypeError = err instanceof TypeError;
    } finally {
      console.warn = origWarn;
      uninstall();
    }

    expect(warned).toBe(1);
    expect(loggedMessage).toContain('listener-registry add bookkeeping failed');
    expect(threwTypeError).toBe(true);
  });

  test('remove bookkeeping failure is logged once, and the real call still runs', () => {
    class T extends EventTarget {}
    const { registry, uninstall } = installListenerRegistry(T.prototype);
    const target = new T();
    // Seed a recorded boundary type so map.get(target) returns a real Set whose
    // delete() is what we then poison.
    const handler = (): void => {};
    target.addEventListener('click', handler);
    expect(registry.has(target)).toBe(true);

    const origWarn = console.warn;
    let warned = 0;
    let loggedMessage = '';
    console.warn = (message: string): void => {
      warned++;
      loggedMessage = message;
    };

    // Poison Set.prototype.delete so the bookkeeping `set.delete(type)` throws,
    // exercising the remove catch while leaving the real target a valid
    // EventTarget for the faithful pass-through.
    const origDelete = Set.prototype.delete;
    // eslint-disable-next-line no-extend-native -- temporary fault injection; restored in finally
    Set.prototype.delete = function (): boolean {
      throw new Error('poisoned delete');
    };

    let removeThrew = false;
    try {
      target.removeEventListener('click', handler);
    } catch {
      removeThrew = true;
    } finally {
      // eslint-disable-next-line no-extend-native -- restoring the original after the fault injection above
      Set.prototype.delete = origDelete;
      console.warn = origWarn;
      uninstall();
    }

    expect(warned).toBe(1);
    expect(loggedMessage).toContain(
      'listener-registry remove bookkeeping failed',
    );
    expect(removeThrew).toBe(false);
  });
});

describe('nullListenerRegistry', () => {
  test('records nothing', () => {
    const registry = nullListenerRegistry();
    const target = new EventTarget();
    expect(registry.has(target)).toBe(false);
    expect([...registry.typesFor(target)]).toEqual([]);
    expect(registry.drainPending()).toBe(false);
  });
});
