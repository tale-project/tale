// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSpeechToText } from '../use-speech-to-text';

interface MockSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _fireEvent: (type: string, event?: unknown) => void;
}

const instances: MockSpeechRecognition[] = [];

function getLatest(): MockSpeechRecognition {
  const instance = instances.at(-1);
  if (!instance) throw new Error('No SpeechRecognition instance created');
  return instance;
}

function createMockRecognition(): MockSpeechRecognition {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};

  return {
    continuous: false,
    interimResults: false,
    lang: '',
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    addEventListener: vi.fn(
      (type: string, handler: (event: unknown) => void) => {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
      },
    ),
    removeEventListener: vi.fn(),
    _fireEvent(type: string, event?: unknown) {
      for (const handler of listeners[type] ?? []) {
        handler(event ?? {});
      }
    },
  };
}

function createRecognitionProxy() {
  return new Proxy(
    function SpeechRecognition() {
      /* noop */
    },
    {
      construct() {
        const instance = createMockRecognition();
        instances.push(instance);
        return instance;
      },
    },
  );
}

function createThrowingRecognitionProxy() {
  return new Proxy(
    function SpeechRecognition() {
      /* noop */
    },
    {
      construct() {
        const instance = createMockRecognition();
        instance.start = vi.fn(() => {
          throw new Error('Permission denied');
        });
        instances.push(instance);
        return instance;
      },
    },
  );
}

beforeEach(() => {
  instances.length = 0;
  Object.defineProperty(window, 'SpeechRecognition', {
    value: createRecognitionProxy(),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    value: undefined,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'SpeechRecognition', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'webkitSpeechRecognition', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
});

describe('useSpeechToText', () => {
  describe('isSupported', () => {
    it('returns true when SpeechRecognition is available', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );
      expect(result.current.isSupported).toBe(true);
    });

    it('returns true when only webkitSpeechRecognition is available', () => {
      Object.defineProperty(window, 'SpeechRecognition', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'webkitSpeechRecognition', {
        value: createRecognitionProxy(),
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );
      expect(result.current.isSupported).toBe(true);
    });

    it('returns false when neither API is available', () => {
      Object.defineProperty(window, 'SpeechRecognition', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );
      expect(result.current.isSupported).toBe(false);
    });
  });

  describe('startListening / stopListening', () => {
    it('initializes with isListening false', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );
      expect(result.current.isListening).toBe(false);
    });

    it('sets isListening to true when recognition starts', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      act(() => {
        getLatest()._fireEvent('start');
      });

      expect(result.current.isListening).toBe(true);
    });

    it('sets isListening to false when recognition ends', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      act(() => {
        getLatest()._fireEvent('start');
      });

      act(() => {
        getLatest()._fireEvent('end');
      });

      expect(result.current.isListening).toBe(false);
    });

    it('calls stop on the recognition instance when stopListening is called', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      act(() => {
        result.current.stopListening();
      });

      expect(getLatest().stop).toHaveBeenCalled();
    });

    it('configures recognition with default lang en-US', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      expect(getLatest().lang).toBe('en-US');
      expect(getLatest().continuous).toBe(true);
      expect(getLatest().interimResults).toBe(true);
    });

    it('uses provided lang option', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn(), lang: 'de-DE' }),
      );

      act(() => {
        result.current.startListening();
      });

      expect(getLatest().lang).toBe('de-DE');
    });

    it('aborts previous session before starting a new one', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      const firstInstance = getLatest();

      act(() => {
        result.current.startListening();
      });

      expect(firstInstance.abort).toHaveBeenCalled();
    });
  });

  describe('transcript', () => {
    it('calls onTranscript with final transcript', () => {
      const onTranscript = vi.fn();
      const { result } = renderHook(() => useSpeechToText({ onTranscript }));

      act(() => {
        result.current.startListening();
      });

      act(() => {
        getLatest()._fireEvent('result', {
          resultIndex: 0,
          results: {
            length: 1,
            0: {
              isFinal: true,
              0: { transcript: 'hello world', confidence: 0.95 },
              length: 1,
            },
          },
        });
      });

      expect(onTranscript).toHaveBeenCalledWith('hello world');
    });

    it('ignores interim results', () => {
      const onTranscript = vi.fn();
      const { result } = renderHook(() => useSpeechToText({ onTranscript }));

      act(() => {
        result.current.startListening();
      });

      act(() => {
        getLatest()._fireEvent('result', {
          resultIndex: 0,
          results: {
            length: 1,
            0: {
              isFinal: false,
              0: { transcript: 'hel', confidence: 0.5 },
              length: 1,
            },
          },
        });
      });

      expect(onTranscript).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('sets error on recognition error', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      act(() => {
        getLatest()._fireEvent('error', { error: 'not-allowed' });
      });

      expect(result.current.error).toBe('not-allowed');
      expect(result.current.isListening).toBe(false);
    });

    it('ignores aborted errors', () => {
      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      act(() => {
        getLatest()._fireEvent('start');
      });

      act(() => {
        getLatest()._fireEvent('error', { error: 'aborted' });
      });

      expect(result.current.error).toBeNull();
    });

    it('sets error to not-allowed when start() throws', () => {
      Object.defineProperty(window, 'SpeechRecognition', {
        value: createThrowingRecognitionProxy(),
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      expect(result.current.error).toBe('not-allowed');
    });
  });

  describe('cleanup', () => {
    it('aborts recognition on unmount', () => {
      const { result, unmount } = renderHook(() =>
        useSpeechToText({ onTranscript: vi.fn() }),
      );

      act(() => {
        result.current.startListening();
      });

      const instance = getLatest();
      unmount();

      expect(instance.abort).toHaveBeenCalled();
    });
  });
});
