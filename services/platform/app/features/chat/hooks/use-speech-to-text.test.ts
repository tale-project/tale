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
