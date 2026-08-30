'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeDictationRequest } from '@/app/lib/backend/chat';

interface UseMediaRecorderDictationOptions {
  organizationId: string;
  onTranscript: (transcript: string) => void;
}

interface UseMediaRecorderDictationReturn {
  isListening: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  /** True when the last transcription failed and the recording is being
   * held in memory for retry. Drives the failed-dictation pill. */
  hasFailedRecording: boolean;
  /** Re-send the retained recording to the transcription action. No
   * re-recording — reuses the exact bytes captured before the failure. */
  retryTranscription: () => void;
  /** Drop the retained recording and clear the failed state. */
  discardFailedRecording: () => void;
}

/**
 * MediaRecorder + server-transcription fallback for browsers without the Web
 * Speech API (notably Firefox). Records audio locally on `startListening`,
 * passes the raw bytes inline to the `transcribeDictation` action on
 * `stopListening`, then forwards the resulting text via `onTranscript`.
 *
 * Shape mirrors `useSpeechToText` so the caller can swap the two
 * transparently — the only extra is `isTranscribing`, which exposes the
 * post-stop network round-trip that the Web Speech path doesn't have.
 */
export function useMediaRecorderDictation({
  organizationId,
  onTranscript,
}: UseMediaRecorderDictationOptions): UseMediaRecorderDictationReturn {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFailedRecording, setHasFailedRecording] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Holds the recording when transcription fails so the user can retry
  // without re-recording. In-browser only — never persisted server-side
  // (the transcribeDictation action stays ephemeral by design). A ref, not
  // state, so it survives re-renders and StrictMode's dev double-invoke; a
  // separate `hasFailedRecording` flag drives the UI.
  const failedRecordingRef = useRef<{ blob: Blob; mimeType: string } | null>(
    null,
  );
  const isMountedRef = useRef(true);
  // Guards against rapid double-clicks: getUserMedia is async and the
  // button stays clickable until isListening flips to true, so without
  // this we can race ourselves and end up with two live streams.
  const startingRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  // The live client, not the query-client wrapper: chat components render
  // outside the provider tree in tests and degraded surfaces, where
  // `useConvex()` returns undefined instead of throwing (the chat seam
  // convention). A missing client surfaces as a failed transcription.
  const transcribeDictation = useCallback(
    async (args: {
      audio: ArrayBuffer;
      mimeType: string;
      organizationId: string;
    }): Promise<{ text: string }> => transcribeDictationRequest(args),
    [],
  );

  const isSupported =
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Shared transcribe round-trip used by both the initial stop and retry.
  // On success forwards the text and clears any retained recording; on
  // failure retains the blob so the user can fix the provider and retry.
  const runTranscription = useCallback(
    async (blob: Blob, mimeType: string) => {
      setIsTranscribing(true);
      setError(null);
      try {
        const audio = await blob.arrayBuffer();
        const { text } = await transcribeDictation({
          audio,
          mimeType,
          organizationId,
        });

        if (text.trim().length > 0) {
          onTranscriptRef.current(text);
        }
        failedRecordingRef.current = null;
        if (isMountedRef.current) setHasFailedRecording(false);
      } catch (err) {
        console.warn('[dictation] transcription failed:', err);
        failedRecordingRef.current = { blob, mimeType };
        if (isMountedRef.current) {
          setHasFailedRecording(true);
          setError('transcription-failed');
        }
      } finally {
        if (isMountedRef.current) setIsTranscribing(false);
      }
    },
    [transcribeDictation, organizationId],
  );

  const startListening = useCallback(async () => {
    if (
      !isSupported ||
      startingRef.current ||
      recorderRef.current ||
      streamRef.current
    ) {
      return;
    }
    startingRef.current = true;
    setError(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.warn('[dictation] getUserMedia failed:', err);
      startingRef.current = false;
      setError('not-allowed');
      setIsListening(false);
      return;
    }

    streamRef.current = stream;

    // Let the browser pick its preferred codec — Firefox defaults to
    // audio/ogg;codecs=opus, Chromium to audio/webm;codecs=opus, both of
    // which the transcription endpoint accepts. Passing an unsupported
    // mimeType throws.
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream);
    } catch (err) {
      console.warn('[dictation] MediaRecorder construction failed:', err);
      startingRef.current = false;
      setError('not-supported');
      cleanup();
      setIsListening(false);
      return;
    }

    recorderRef.current = recorder;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    });

    recorder.addEventListener('error', (event) => {
      console.warn('[dictation] MediaRecorder error:', event);
      setError('recorder-error');
      cleanup();
      setIsListening(false);
    });

    recorder.addEventListener('stop', () => {
      // Cache + clear refs immediately so a re-entrant start can't see
      // stale data while the transcribe round-trip is in flight.
      const recordedChunks = chunksRef.current;
      const mimeType = recorder.mimeType || 'audio/webm';
      cleanup();
      setIsListening(false);

      if (recordedChunks.length === 0) {
        return;
      }

      const audioBlob = new Blob(recordedChunks, { type: mimeType });
      if (audioBlob.size === 0) {
        return;
      }

      // Component unmounted between start and stop — drop the recording
      // rather than transcribing audio the user can no longer see results for.
      if (!isMountedRef.current) {
        return;
      }

      void runTranscription(audioBlob, mimeType);
    });

    try {
      recorder.start();
      setIsListening(true);
    } catch (err) {
      console.warn('[dictation] recorder.start failed:', err);
      setError('recorder-error');
      cleanup();
      setIsListening(false);
    } finally {
      startingRef.current = false;
    }
  }, [isSupported, cleanup, runTranscription]);

  const stopListening = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  const retryTranscription = useCallback(() => {
    const retained = failedRecordingRef.current;
    if (retained) {
      void runTranscription(retained.blob, retained.mimeType);
    }
  }, [runTranscription]);

  const discardFailedRecording = useCallback(() => {
    failedRecordingRef.current = null;
    setHasFailedRecording(false);
    setError(null);
  }, []);

  useEffect(() => {
    // Re-arm on (re)mount. The ref persists across React StrictMode's
    // dev-mode unmount/remount, and the cleanup below sets it false — so
    // without this line it stays false after the remount, and the stop
    // handler silently drops every recording via the isMountedRef guard.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch (err) {
          console.warn('[dictation] cleanup stop failed:', err);
        }
      }
      cleanup();
    };
  }, [cleanup]);

  return {
    isListening,
    isTranscribing,
    isSupported,
    error,
    startListening: () => {
      void startListening();
    },
    stopListening,
    hasFailedRecording,
    retryTranscription,
    discardFailedRecording,
  };
}
