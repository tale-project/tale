// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSpeechToText } from './use-speech-to-text';

/** A Web Speech stand-in: records `start`, never speaks on its own. */
class FakeRecognition extends EventTarget {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    super();
    FakeRecognition.instances.push(this);
  }
}

function installSpeech(permission: PermissionState | 'throws' | 'absent') {
  FakeRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  if (permission === 'absent') {
    Object.defineProperty(navigator, 'permissions', {
      value: undefined,
      configurable: true,
    });
    return;
  }
  Object.defineProperty(navigator, 'permissions', {
    value: {
      query: vi.fn(() =>
        permission === 'throws'
          ? Promise.reject(new TypeError('microphone is not a valid name'))
          : Promise.resolve({ state: permission }),
      ),
    },
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSpeechToText — starting with the microphone denied', () => {
  // 2026-09-26 evaluation, A-07: with the permission denied, Start dictation
  // did nothing visible — Web Speech reported no error and the click left
  // no trace. The denial is found by a permission query that runs BESIDE
  // the session: the session still starts inside the click (iOS Safari
  // refuses a start outside the user gesture) and is aborted on a denial.
  it('reports not-allowed and aborts the session it started in the click', async () => {
    installSpeech('denied');
    const { result } = renderHook(() =>
      useSpeechToText({ onTranscript: vi.fn() }),
    );

    act(() => result.current.startListening());
    // Synchronously, inside the gesture — before the query has answered.
    expect(FakeRecognition.instances[0]?.start).toHaveBeenCalledOnce();

    await waitFor(() => expect(result.current.error).toBe('not-allowed'));
    expect(result.current.errorNonce).toBe(1);
    expect(result.current.isListening).toBe(false);
    expect(FakeRecognition.instances[0]?.abort).toHaveBeenCalledOnce();
  });

  it('announces the same denial again on a second click', async () => {
    installSpeech('denied');
    const { result } = renderHook(() =>
      useSpeechToText({ onTranscript: vi.fn() }),
    );

    act(() => result.current.startListening());
    await waitFor(() => expect(result.current.errorNonce).toBe(1));
    act(() => result.current.startListening());
    await waitFor(() => expect(result.current.errorNonce).toBe(2));
    expect(result.current.error).toBe('not-allowed');
  });

  it('starts the session inside the click when the permission is granted or still a prompt', async () => {
    installSpeech('prompt');
    const { result } = renderHook(() =>
      useSpeechToText({ onTranscript: vi.fn() }),
    );

    act(() => result.current.startListening());

    expect(FakeRecognition.instances[0]?.start).toHaveBeenCalledOnce();
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeRecognition.instances[0]?.abort).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('starts the session where the browser cannot answer the query', async () => {
    // Safari throws on the `microphone` descriptor; Web Speech still works
    // there and reports a denial through its own error event.
    installSpeech('throws');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useSpeechToText({ onTranscript: vi.fn() }),
    );

    act(() => result.current.startListening());

    await waitFor(() =>
      expect(FakeRecognition.instances[0]?.start).toHaveBeenCalledOnce(),
    );
    expect(warn).toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it('surfaces a recognition error with a fresh nonce', async () => {
    installSpeech('absent');
    const { result } = renderHook(() =>
      useSpeechToText({ onTranscript: vi.fn() }),
    );

    act(() => result.current.startListening());
    await waitFor(() =>
      expect(FakeRecognition.instances[0]?.start).toHaveBeenCalledOnce(),
    );
    act(() => {
      const event = new Event('error');
      Object.assign(event, { error: 'network' });
      FakeRecognition.instances[0]?.dispatchEvent(event);
    });

    expect(result.current.error).toBe('network');
    expect(result.current.errorNonce).toBe(1);
  });
});

describe('useSpeechToText — finishing for a send', () => {
  /** A `result` event carrying one final transcript. */
  function finalResult(transcript: string): Event {
    const event = new Event('result');
    const result = Object.assign([{ transcript, confidence: 1 }], {
      isFinal: true,
    });
    return Object.assign(event, { resultIndex: 0, results: [result] });
  }

  function errorEvent(error: string): Event {
    return Object.assign(new Event('error'), { error });
  }

  /** Track a promise's state without awaiting it. */
  function watch(promise: Promise<void>) {
    const state = { settled: 'pending' as 'pending' | 'resolved' | 'rejected' };
    promise.then(
      () => {
        state.settled = 'resolved';
      },
      () => {
        state.settled = 'rejected';
      },
    );
    return state;
  }

  function listening(onTranscript = vi.fn()) {
    installSpeech('absent');
    const hook = renderHook(() => useSpeechToText({ onTranscript }));
    act(() => hook.result.current.startListening());
    const recognition = FakeRecognition.instances[0];
    if (recognition === undefined) throw new Error('no session');
    act(() => {
      recognition.dispatchEvent(new Event('start'));
    });
    return { ...hook, recognition, onTranscript };
  }

  it('has nothing to wait for while no session runs', () => {
    installSpeech('absent');
    const { result } = renderHook(() =>
      useSpeechToText({ onTranscript: vi.fn() }),
    );
    expect(result.current.finishListening()).toBeNull();
  });

  it('stops the session and settles at its end, after the results it finalizes', async () => {
    const { result, recognition, onTranscript } = listening();

    const finished = result.current.finishListening();
    if (finished === null) throw new Error('nothing to wait for');
    const state = watch(finished);
    expect(recognition.stop).toHaveBeenCalledOnce();
    expect(recognition.abort).not.toHaveBeenCalled();

    act(() => {
      recognition.dispatchEvent(finalResult('the last words'));
    });
    await Promise.resolve();
    expect(onTranscript).toHaveBeenCalledWith('the last words');
    expect(state.settled).toBe('pending');

    await act(async () => {
      recognition.dispatchEvent(new Event('end'));
    });
    expect(state.settled).toBe('resolved');
    expect(result.current.isListening).toBe(false);
    expect(result.current.finishListening()).toBeNull();
  });

  it('settles a wait on silence as finished', async () => {
    const { result, recognition } = listening();
    const finished = result.current.finishListening();
    if (finished === null) throw new Error('nothing to wait for');

    await act(async () => {
      recognition.dispatchEvent(errorEvent('no-speech'));
      recognition.dispatchEvent(new Event('end'));
    });

    await expect(finished).resolves.toBeUndefined();
  });

  it('fails the wait when an error cut the session short, and any wait after it', async () => {
    const { result, recognition } = listening();
    const finished = result.current.finishListening();
    if (finished === null) throw new Error('nothing to wait for');

    act(() => {
      recognition.dispatchEvent(errorEvent('network'));
    });

    await expect(finished).rejects.toThrow(/network/);
    // Between the error and its `end`, a new wait learns the same.
    const later = result.current.finishListening();
    await expect(later).rejects.toThrow(/network/);
    expect(result.current.error).toBe('network');
  });

  it('fails the wait when the session is aborted on unmount', async () => {
    const { result, recognition, unmount } = listening();
    const finished = result.current.finishListening();
    if (finished === null) throw new Error('nothing to wait for');

    unmount();

    await expect(finished).rejects.toThrow(/aborted/);
    expect(recognition.abort).toHaveBeenCalledOnce();
  });

  it('lets only the current session end the listening state', async () => {
    const { result, recognition: first, unmount } = listening();

    act(() => result.current.startListening());
    const second = FakeRecognition.instances[1];
    if (second === undefined) throw new Error('no second session');
    act(() => {
      second.dispatchEvent(new Event('start'));
    });
    // The replaced session's late `end` must not end the new one.
    act(() => {
      first.dispatchEvent(new Event('end'));
    });

    expect(result.current.isListening).toBe(true);
    const finished = result.current.finishListening();
    expect(second.stop).toHaveBeenCalledOnce();
    expect(first.stop).not.toHaveBeenCalled();
    unmount();
    await expect(finished).rejects.toThrow(/aborted/);
  });
});
