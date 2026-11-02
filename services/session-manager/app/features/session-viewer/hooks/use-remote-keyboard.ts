import {
  useCallback,
  useEffect,
  type ClipboardEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { clampText } from '@/lib/live-view';

import { decideKeydown, type HeldKeys } from '../lib/keys';
import type { ClientMessageInput } from './use-live-view';

interface RemoteKeyboardOptions {
  send: (message: ClientMessageInput) => boolean;
  heldKeys: HeldKeys;
  /** ⌘L / Ctrl+L: the way out of the page. */
  onAddress: () => void;
  /** A paste was longer than the protocol takes at once: only its beginning was sent. */
  onPasteCut?: () => void;
}

/** What an `input` event says about composition and text, whatever the browser calls it. */
function inputDetails(event: Event): {
  composing: boolean;
  data: string | null;
} {
  return {
    composing: 'isComposing' in event && event.isComposing === true,
    data: 'data' in event && typeof event.data === 'string' ? event.data : null,
  };
}

/**
 * The keyboard of a page that has it: every key goes to the page in the
 * session, but the way out (⌘L), copy and paste, and the browser's own
 * shortcuts. The keys are typed into a hidden text field, which is what makes
 * composed text work (dead keys, input methods); its handlers are returned
 * for the field.
 *
 * A key is released with the key it pressed: the layout can change between
 * the press and the release (Shift, H, release Shift, release H). Keys still
 * held when the field loses the keyboard, or the page is hidden, are let go,
 * or they would stay down in the page. A paste is cut to what one message may
 * hold (`MAX_TEXT`).
 */
export function useRemoteKeyboard({
  send,
  heldKeys,
  onAddress,
  onPasteCut,
}: RemoteKeyboardOptions) {
  const releaseKeys = useCallback(() => {
    for (const key of heldKeys.releaseAll()) {
      send({ t: 'key', a: 'up', k: key });
    }
  }, [heldKeys, send]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) releaseKeys();
    };
    window.addEventListener('pagehide', releaseKeys);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', releaseKeys);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [releaseKeys]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const decision = decideKeydown({
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      isComposing: event.nativeEvent.isComposing,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });
    switch (decision.kind) {
      case 'composing':
      case 'local':
      // The paste event brings the text.
      case 'paste':
        return;
      case 'address':
        event.preventDefault();
        onAddress();
        return;
      case 'copy':
        event.preventDefault();
        send({ t: 'copy', cut: decision.cut });
        return;
      case 'key':
        event.preventDefault();
        heldKeys.press(event.code, decision.key);
        send({ t: 'key', a: 'down', k: decision.key });
    }
  };

  const onKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const key = heldKeys.release(event.code);
    if (key === undefined) return;
    event.preventDefault();
    send({ t: 'key', a: 'up', k: key });
  };

  const onCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    if (event.data) send({ t: 'text', text: event.data });
    event.currentTarget.value = '';
  };

  const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const { composing, data } = inputDetails(event.nativeEvent);
    // The composition goes on; its end brings the text.
    if (composing) return;
    // An emoji picker, dictation: text that no key made.
    if (data) send({ t: 'text', text: data });
    event.currentTarget.value = '';
  };

  // A paste is one message, and the socket closes on one that is too big (a
  // megabyte): the page sends what the protocol takes, as the server would
  // keep it, and says that the rest was left out.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    const kept = clampText(text);
    send({ t: 'text', text: kept });
    if (kept.length < text.length) onPasteCut?.();
  };

  return {
    onKeyDown,
    onKeyUp,
    onCompositionEnd,
    onInput,
    onPaste,
    onBlur: releaseKeys,
  };
}
