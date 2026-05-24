'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

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
}

/**
 * MediaRecorder + server-Whisper fallback for browsers without the Web
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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const isMountedRef = useRef(true);
  // Guards against rapid double-clicks: getUserMedia is async and the
  // button stays clickable until isListening flips to true, so without
  // this we can race ourselves and end up with two live streams.
  const startingRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const { mutateAsync: transcribeDictation } = useConvexAction(
    api.file_metadata.transcribe_dictation.transcribeDictation,
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
    // which Whisper accepts. Passing an unsupported mimeType throws.
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

      setIsTranscribing(true);
      void (async () => {
        try {
          const audio = await audioBlob.arrayBuffer();
          const { text } = await transcribeDictation({
            audio,
            mimeType,
            organizationId,
          });

          if (text.trim().length > 0) {
            onTranscriptRef.current(text);
          }
        } catch (err) {
          console.warn('[dictation] transcription failed:', err);
          setError('transcription-failed');
        } finally {
          setIsTranscribing(false);
        }
      })();
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
  }, [isSupported, cleanup, transcribeDictation, organizationId]);

  const stopListening = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  useEffect(() => {
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
  };
}
