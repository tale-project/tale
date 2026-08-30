// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockTranscribeDictation = vi.fn();

// Stub the live Convex client (the chat-seam pattern: `useConvex()` degrades
// to undefined outside the provider tree; here it answers with an action
// runner so the transcription round-trip is observable).
vi.mock('@/app/lib/backend/chat', () => ({
  transcribeDictationRequest: (args: unknown) => mockTranscribeDictation(args),
}));

import { useMediaRecorderDictation } from './use-media-recorder-dictation';

interface MockMediaRecorder {
  state: 'inactive' | 'recording' | 'paused';
  mimeType: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  removeEventListener: ReturnType<typeof vi.fn>;
  _fireEvent: (type: string, event?: unknown) => void;
}

const recorders: MockMediaRecorder[] = [];

function latestRecorder(): MockMediaRecorder {
  const r = recorders.at(-1);
  if (!r) throw new Error('No MediaRecorder instance');
  return r;
}

function buildMockRecorder(
  options: { mimeType?: string; constructorThrows?: boolean } = {},
) {
  if (options.constructorThrows) {
    throw new Error('mimeType not supported');
  }
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  const recorder: MockMediaRecorder = {
    state: 'inactive',
    mimeType: options.mimeType ?? 'audio/webm',
    start: vi.fn(() => {
      recorder.state = 'recording';
    }),
    stop: vi.fn(() => {
      recorder.state = 'inactive';
    }),
    addEventListener: (type, handler) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    removeEventListener: vi.fn(),
    _fireEvent(type, event) {
      for (const handler of listeners[type] ?? []) {
        handler(event ?? {});
      }
    },
  };
  return recorder;
}

let mockRecorderShouldThrow = false;
let mockRecorderMimeType = 'audio/webm';

function MockMediaRecorderCtor(this: unknown, _stream: MediaStream) {
  const r = buildMockRecorder({
    mimeType: mockRecorderMimeType,
    constructorThrows: mockRecorderShouldThrow,
  });
  recorders.push(r);
  return r;
}

const mockTracks = { stop: vi.fn() };
const mockStream = {
  getTracks: () => [mockTracks],
} as unknown as MediaStream;

const mockGetUserMedia = vi.fn(async () => mockStream);

beforeEach(() => {
  recorders.length = 0;
  mockTranscribeDictation.mockReset();
  mockTracks.stop.mockReset();
  mockGetUserMedia.mockReset();
  mockGetUserMedia.mockResolvedValue(mockStream);
  mockRecorderShouldThrow = false;
  mockRecorderMimeType = 'audio/webm';

  Object.defineProperty(window, 'MediaRecorder', {
    value: MockMediaRecorderCtor,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: mockGetUserMedia },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'MediaRecorder', {
    value: undefined,
    writable: true,
    configurable: true,
  });
  vi.restoreAllMocks();
});

const ORG_ID = 'org_test';

describe('useMediaRecorderDictation', () => {
  describe('isSupported', () => {
    it('returns true when MediaRecorder and getUserMedia are available', () => {
      const { result } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );
      expect(result.current.isSupported).toBe(true);
    });

    it('returns false when MediaRecorder is missing (Safari iOS, old browsers)', () => {
      Object.defineProperty(window, 'MediaRecorder', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const { result } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );
      expect(result.current.isSupported).toBe(false);
    });

    it('returns false when navigator.mediaDevices.getUserMedia is missing', () => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      const { result } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );
      expect(result.current.isSupported).toBe(false);
    });
  });

  describe('startListening', () => {
    it('requests microphone access and starts recording', async () => {
      const { result } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );

      await act(async () => {
        result.current.startListening();
      });

      expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(result.current.isListening).toBe(true);
      expect(latestRecorder().start).toHaveBeenCalledOnce();
    });

    it('sets error="not-allowed" when getUserMedia rejects', async () => {
      mockGetUserMedia.mockRejectedValueOnce(new Error('Permission denied'));

      const { result } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );

      await act(async () => {
        result.current.startListening();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('not-allowed');
      });
      expect(result.current.isListening).toBe(false);
    });

    it('sets error="not-supported" and releases the stream when MediaRecorder construction throws', async () => {
      mockRecorderShouldThrow = true;

      const { result } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );

      await act(async () => {
        result.current.startListening();
      });

      await waitFor(() => {
        expect(result.current.error).toBe('not-supported');
      });
      expect(result.current.isListening).toBe(false);
      // Stream tracks must be released so the browser drops the mic permission indicator.
      expect(mockTracks.stop).toHaveBeenCalled();
    });

    it('is idempotent against rapid double-start (re-entrancy guard)', async () => {
      // Stall getUserMedia so the second call lands while the first is still
      // resolving — the realistic double-click race.
      let resolveStream: ((s: MediaStream) => void) | null = null;
      mockGetUserMedia.mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            resolveStream = resolve;
          }),
      );

      const { result } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );

      act(() => {
        result.current.startListening();
        result.current.startListening();
        result.current.startListening();
      });

      // Only the first invocation should reach getUserMedia.
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveStream?.(mockStream);
      });

      expect(recorders.length).toBe(1);
    });
  });

  describe('stopListening + transcription', () => {
    async function startAndCaptureChunks(onTranscript: (t: string) => void) {
      const hook = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript,
        }),
      );

      await act(async () => {
        hook.result.current.startListening();
      });

      return hook;
    }

    it('uploads the recorded audio and forwards the transcript', async () => {
      mockTranscribeDictation.mockResolvedValue({ text: 'hello world' });
      const onTranscript = vi.fn();
      const { result } = await startAndCaptureChunks(onTranscript);

      // Simulate the browser delivering a chunk and then the stop event.
      const recorder = latestRecorder();
      const audioChunk = new Blob([new Uint8Array([1, 2, 3, 4])], {
        type: 'audio/webm',
      });
      await act(async () => {
        recorder._fireEvent('dataavailable', { data: audioChunk });
        recorder._fireEvent('stop');
      });

      await waitFor(() => {
        expect(mockTranscribeDictation).toHaveBeenCalledOnce();
      });

      const call = mockTranscribeDictation.mock.calls[0]?.[0];
      expect(call?.organizationId).toBe(ORG_ID);
      expect(call?.mimeType).toBe('audio/webm');
      // audio is serialized as ArrayBuffer with the recorded bytes.
      expect(call?.audio).toBeInstanceOf(ArrayBuffer);
      expect(new Uint8Array(call.audio as ArrayBuffer)).toEqual(
        new Uint8Array([1, 2, 3, 4]),
      );

      await waitFor(() => {
        expect(onTranscript).toHaveBeenCalledWith('hello world');
      });
      await waitFor(() => {
        expect(result.current.isTranscribing).toBe(false);
      });
    });

    it('does not call onTranscript when the API returns empty/whitespace text', async () => {
      mockTranscribeDictation.mockResolvedValue({ text: '   ' });
      const onTranscript = vi.fn();
      const { result } = await startAndCaptureChunks(onTranscript);

      const recorder = latestRecorder();
      const audioChunk = new Blob([new Uint8Array([1, 2, 3])], {
        type: 'audio/webm',
      });
      await act(async () => {
        recorder._fireEvent('dataavailable', { data: audioChunk });
        recorder._fireEvent('stop');
      });

      await waitFor(() => {
        expect(mockTranscribeDictation).toHaveBeenCalledOnce();
      });
      await waitFor(() => {
        expect(result.current.isTranscribing).toBe(false);
      });
      expect(onTranscript).not.toHaveBeenCalled();
    });

    it('sets error="transcription-failed" when the action rejects', async () => {
      mockTranscribeDictation.mockRejectedValue(new Error('provider 500'));
      const onTranscript = vi.fn();
      const { result } = await startAndCaptureChunks(onTranscript);

      const recorder = latestRecorder();
      const audioChunk = new Blob([new Uint8Array([1, 2, 3])], {
        type: 'audio/webm',
      });
      await act(async () => {
        recorder._fireEvent('dataavailable', { data: audioChunk });
        recorder._fireEvent('stop');
      });

      await waitFor(() => {
        expect(result.current.error).toBe('transcription-failed');
      });
      expect(result.current.isTranscribing).toBe(false);
      expect(onTranscript).not.toHaveBeenCalled();
    });

    it('does not call transcribe when stop fires with no chunks (user clicked then immediately stopped)', async () => {
      const onTranscript = vi.fn();
      await startAndCaptureChunks(onTranscript);

      const recorder = latestRecorder();
      await act(async () => {
        recorder._fireEvent('stop');
      });

      // No microtask flush will make the assertion change — still verify the
      // call never happens by checking after waiting for any pending work.
      await new Promise((r) => setTimeout(r, 0));
      expect(mockTranscribeDictation).not.toHaveBeenCalled();
    });

    it('releases stream tracks after stop', async () => {
      const onTranscript = vi.fn();
      await startAndCaptureChunks(onTranscript);

      const recorder = latestRecorder();
      await act(async () => {
        recorder._fireEvent('stop');
      });

      expect(mockTracks.stop).toHaveBeenCalled();
    });

    it('drops the recording when the component unmounts mid-stop (mount guard)', async () => {
      mockTranscribeDictation.mockResolvedValue({ text: 'should not reach' });
      const onTranscript = vi.fn();
      const { result, unmount } = await startAndCaptureChunks(onTranscript);

      // Capture the recorder before unmount stops it.
      const recorder = latestRecorder();
      const audioChunk = new Blob([new Uint8Array([1, 2, 3])], {
        type: 'audio/webm',
      });
      // Buffer a chunk before unmount.
      await act(async () => {
        recorder._fireEvent('dataavailable', { data: audioChunk });
      });

      // Unmount before stop fires. The cleanup will trigger stop(); we
      // simulate the resulting stop event afterwards.
      unmount();
      await act(async () => {
        recorder._fireEvent('stop');
      });

      await new Promise((r) => setTimeout(r, 0));
      expect(mockTranscribeDictation).not.toHaveBeenCalled();
      expect(onTranscript).not.toHaveBeenCalled();
      // Guard against the never-true "isTranscribing went true on unmounted hook" footgun.
      expect(result.current.isTranscribing).toBe(false);
    });
  });

  describe('failed-recording retry (in-browser, no re-record)', () => {
    async function failOnce(onTranscript: (t: string) => void) {
      mockTranscribeDictation.mockRejectedValueOnce(
        new Error('NO_TRANSCRIPTION_MODEL'),
      );
      const hook = renderHook(() =>
        useMediaRecorderDictation({ organizationId: ORG_ID, onTranscript }),
      );
      await act(async () => {
        hook.result.current.startListening();
      });
      const recorder = latestRecorder();
      const audioChunk = new Blob([new Uint8Array([9, 8, 7, 6])], {
        type: 'audio/webm',
      });
      await act(async () => {
        recorder._fireEvent('dataavailable', { data: audioChunk });
        recorder._fireEvent('stop');
      });
      await waitFor(() => {
        expect(hook.result.current.hasFailedRecording).toBe(true);
      });
      return hook;
    }

    it('retains the recording when transcription fails', async () => {
      const { result } = await failOnce(vi.fn());
      expect(result.current.hasFailedRecording).toBe(true);
      expect(result.current.error).toBe('transcription-failed');
    });

    it('retry re-sends the same bytes without re-recording, and clears on success', async () => {
      const onTranscript = vi.fn();
      const { result } = await failOnce(onTranscript);

      const recordersBefore = recorders.length;
      mockTranscribeDictation.mockResolvedValueOnce({ text: 'recovered' });

      await act(async () => {
        result.current.retryTranscription();
      });

      await waitFor(() => {
        expect(onTranscript).toHaveBeenCalledWith('recovered');
      });
      // No new MediaRecorder / getUserMedia — retry reuses the retained blob.
      expect(recorders.length).toBe(recordersBefore);
      expect(mockTranscribeDictation).toHaveBeenCalledTimes(2);
      // Same bytes re-sent.
      const retryCall = mockTranscribeDictation.mock.calls[1]?.[0];
      expect(new Uint8Array(retryCall.audio as ArrayBuffer)).toEqual(
        new Uint8Array([9, 8, 7, 6]),
      );
      await waitFor(() => {
        expect(result.current.hasFailedRecording).toBe(false);
      });
    });

    it('discardFailedRecording clears the retained recording and error', async () => {
      const { result } = await failOnce(vi.fn());

      act(() => {
        result.current.discardFailedRecording();
      });

      expect(result.current.hasFailedRecording).toBe(false);
      expect(result.current.error).toBeNull();
      // Retry after discard is a no-op (nothing retained).
      act(() => {
        result.current.retryTranscription();
      });
      expect(mockTranscribeDictation).toHaveBeenCalledTimes(1);
    });

    it('retained recording survives a re-render', async () => {
      const { result, rerender } = await failOnce(vi.fn());
      rerender();
      expect(result.current.hasFailedRecording).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('releases stream tracks on unmount during active recording', async () => {
      const { result, unmount } = renderHook(() =>
        useMediaRecorderDictation({
          organizationId: ORG_ID,
          onTranscript: vi.fn(),
        }),
      );

      await act(async () => {
        result.current.startListening();
      });

      const recorder = latestRecorder();
      expect(recorder.state).toBe('recording');

      unmount();

      expect(recorder.stop).toHaveBeenCalled();
      expect(mockTracks.stop).toHaveBeenCalled();
    });
  });
});
