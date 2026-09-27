'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognition(): SpeechRecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Browser API detection requires accessing non-standard vendor-prefixed properties
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

interface UseSpeechToTextOptions {
  lang?: string;
  onTranscript: (transcript: string) => void;
}

interface UseSpeechToTextReturn {
  isListening: boolean;
  isSupported: boolean;
  error: string | null;
  /**
   * Bumps on EVERY error, including a repeat of the same code — a second
   * click on a denied microphone must announce the denial again, and a
   * string that never changes cannot re-fire an effect.
   */
  errorNonce: number;
  startListening: () => void;
  stopListening: () => void;
}

/**
 * The microphone permission state beside a starting session, or `undefined`
 * where the browser cannot say (no Permissions API, or one that does not know
 * the `microphone` descriptor — Safari throws). Web Speech only reports a
 * denied microphone through a later `not-allowed` error and some builds
 * never do, so a denial found here is surfaced at once instead of leaving
 * the click without any visible effect.
 */
async function queryMicrophonePermission(): Promise<
  PermissionState | undefined
> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) {
    return undefined;
  }
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `microphone` is not in every lib.dom PermissionName union
    const descriptor = { name: 'microphone' } as PermissionDescriptor;
    const status = await navigator.permissions.query(descriptor);
    return status.state;
  } catch (error) {
    console.warn('[dictation] microphone permission query unsupported', error);
    return undefined;
  }
}

export function useSpeechToText({
  lang = 'en-US',
  onTranscript,
}: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [error, setErrorCode] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const setError = useCallback((code: string) => {
    setErrorCode(code);
    setErrorNonce((nonce) => nonce + 1);
  }, []);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const isSupported = typeof window !== 'undefined' && !!getSpeechRecognition();

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const startListening = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;

    // Stop any existing session
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    setErrorCode(null);

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognitionRef.current = recognition;

    recognition.addEventListener('start', () => {
      setIsListening(true);
    });

    recognition.addEventListener('result', (event: Event) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SpeechRecognition 'result' event is typed as SpeechRecognitionEvent
      const e = event as unknown as SpeechRecognitionEvent;
      let finalTranscript = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        onTranscriptRef.current(finalTranscript);
      }
    });

    recognition.addEventListener('error', (event: Event) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SpeechRecognition 'error' event is typed as SpeechRecognitionErrorEvent
      const e = event as unknown as SpeechRecognitionErrorEvent;
      // "aborted" is expected when we call stop/abort. "no-speech" is the
      // recognition timing out on silence — surfacing it would lead the
      // button to show a misleading "not supported" toast, when the API
      // is working fine and simply heard nothing. The follow-up "end"
      // event still flips isListening back to false, so the button
      // returns to its idle state on its own.
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        setError(e.error);
      }
      setIsListening(false);
    });

    recognition.addEventListener('end', () => {
      setIsListening(false);
      recognitionRef.current = null;
    });

    // Start INSIDE the click: iOS Safari starts recognition only from a
    // user gesture, and an await before `start()` would leave it. The
    // permission query runs beside the session — a denial found there is
    // surfaced at once (Web Speech reports it late, or in some builds
    // never) and the session it would have stalled is aborted.
    try {
      recognition.start();
    } catch (startError) {
      console.warn(
        '[dictation] speech recognition failed to start',
        startError,
      );
      recognitionRef.current = null;
      setError('not-allowed');
      setIsListening(false);
      return;
    }
    void queryMicrophonePermission().then((state) => {
      // A newer click replaced this session while the query was pending.
      if (recognitionRef.current !== recognition) return;
      if (state !== 'denied') return;
      recognitionRef.current = null;
      recognition.abort();
      setError('not-allowed');
      setIsListening(false);
    });
  }, [lang, setError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    error,
    errorNonce,
    startListening,
    stopListening,
  };
}
