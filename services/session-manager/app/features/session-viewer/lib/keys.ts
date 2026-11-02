/** The part of a keyboard event that decides what the page does with it. */
export interface KeyEventLike {
  key: string;
  code: string;
  keyCode: number;
  isComposing: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

export type KeyDecision =
  /** An input method (or a dead key) is composing: its text comes with the composition events. */
  | { kind: 'composing' }
  /** ⌘L / Ctrl+L: the way out of the page, to the address bar. */
  | { kind: 'address' }
  /** A shortcut of this browser (reload, quit, switch tab) stays with this page. */
  | { kind: 'local' }
  /** ⌘C / ⌘X: ask the page for its selection. */
  | { kind: 'copy'; cut: boolean }
  /** ⌘V: the paste event brings the text. */
  | { kind: 'paste' }
  /** Any other key goes to the page as it is. */
  | { kind: 'key'; key: string };

/** Keys that belong to an input method, whatever their `isComposing` says. */
const COMPOSITION_KEYS = new Set([
  'Dead',
  'Process',
  'Unidentified',
  'Compose',
]);

/** Shortcuts of this browser that stay with this page instead of going to the page in the session. */
const LOCAL_SHORTCUTS = new Set(['r', 'q', 'tab']);
const LOCAL_KEYS = new Set(['F5', 'F11', 'F12']);

/**
 * What to do with a key that was pressed while the page has the keyboard.
 * The page gets every key but a few: the way out (⌘L), the copy and paste
 * shortcuts, which go through the clipboard, and the shortcuts of this
 * browser that people rely on to reload or leave.
 */
export function decideKeydown(event: KeyEventLike): KeyDecision {
  // keyCode 229: a key that belongs to an input method (Safari reports the
  // Enter that ends a composition so).
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    COMPOSITION_KEYS.has(event.key)
  ) {
    return { kind: 'composing' };
  }
  const command = event.metaKey || event.ctrlKey;
  const lower = event.key.toLowerCase();
  if (command && lower === 'l') return { kind: 'address' };
  if ((command && LOCAL_SHORTCUTS.has(lower)) || LOCAL_KEYS.has(event.key)) {
    return { kind: 'local' };
  }
  if (command && (lower === 'c' || lower === 'x')) {
    return { kind: 'copy', cut: lower === 'x' };
  }
  if (command && lower === 'v') return { kind: 'paste' };
  return { kind: 'key', key: event.key };
}

/**
 * The keys held down in the page, by the physical key that pressed them. A key
 * is released with the key it pressed even when the layout changed meanwhile:
 * Shift, H, release Shift, release H must release the "H" that was pressed, not
 * an "h".
 */
export class HeldKeys {
  private readonly held = new Map<string, string>();

  get size(): number {
    return this.held.size;
  }

  press(code: string, key: string): void {
    this.held.set(code, key);
  }

  /** The key that `code` pressed, now released; undefined if it pressed none. */
  release(code: string): string | undefined {
    const key = this.held.get(code);
    this.held.delete(code);
    return key;
  }

  /** Every key still held, for the page to release; none stays held. */
  releaseAll(): string[] {
    const keys = [...this.held.values()];
    this.held.clear();
    return keys;
  }

  /** Forgets the keys without releasing them (the page cannot hear it any more). */
  clear(): void {
    this.held.clear();
  }
}
