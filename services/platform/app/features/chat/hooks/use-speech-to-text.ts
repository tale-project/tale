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
  startListening: () => void;
  stopListening: () => void;
}

export function useSpeechToText({
  lang = 'en-US',
  onTranscript,
}: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

    setError(null);

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognitionRef.current = recognition;

    recognition.addEventListener('start', () => {
      setIsListening(true);
    });

    recognition.addEventListener('result', ((event: Event) => {
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
    }) as EventListener);

    recognition.addEventListener('error', ((event: Event) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SpeechRecognition 'error' event is typed as SpeechRecognitionErrorEvent
      const e = event as unknown as SpeechRecognitionErrorEvent;
      // "aborted" is expected when we call stop/abort
      if (e.error !== 'aborted') {
        setError(e.error);
      }
      setIsListening(false);
    }) as EventListener);

    recognition.addEventListener('end', () => {
      setIsListening(false);
      recognitionRef.current = null;
    });

    try {
      recognition.start();
    } catch {
      setError('not-allowed');
      setIsListening(false);
    }
  }, [lang]);

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
    startListening,
    stopListening,
  };
}
