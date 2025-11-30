'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseTypewriterOptions {
  text: string;
  isStreaming?: boolean;
  baseSpeed?: number; // Base milliseconds per character
  minSpeed?: number; // Minimum speed (fastest)
  maxSpeed?: number; // Maximum speed (slowest)
}

export function useTypewriter({
  text,
  isStreaming = false,
  baseSpeed = 20,
  minSpeed = 10,
  maxSpeed = 50,
}: UseTypewriterOptions) {
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastTextRef = useRef('');
  const lastIndexRef = useRef(0);

  const clearTypewriter = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsTyping(false);
  }, []);

  const startTypewriter = useCallback(
    (startIndex: number = 0) => {
      clearTypewriter();

      if (!isStreaming || text.length === 0) {
        setDisplayText(text);
        setCurrentIndex(text.length);
        return;
      }

      setIsTyping(true);
      setCurrentIndex(startIndex);

      // Adaptive typing speed based on content length and streaming rate
      const contentLength = text.length;
      const speedMultiplier = Math.max(0.3, Math.min(1, 100 / contentLength));
      const adaptiveSpeed = Math.max(
        minSpeed,
        Math.min(maxSpeed, baseSpeed * speedMultiplier),
      );

      intervalRef.current = setInterval(() => {
        setCurrentIndex((prevIndex) => {
          if (prevIndex >= text.length) {
            clearTypewriter();
            return prevIndex;
          }
          return prevIndex + 1;
        });
      }, adaptiveSpeed);
    },
    [text, isStreaming, baseSpeed, minSpeed, maxSpeed, clearTypewriter],
  );

  // Handle text changes during streaming
  useEffect(() => {
    if (text !== lastTextRef.current) {
      lastTextRef.current = text;

      if (isStreaming) {
        // If text was extended, continue from current position
        const startIndex = Math.min(lastIndexRef.current, text.length);
        startTypewriter(startIndex);
      } else {
        // If not streaming, show full text immediately
        clearTypewriter();
        setDisplayText(text);
        setCurrentIndex(text.length);
      }
    }
  }, [text, isStreaming, startTypewriter, clearTypewriter]);

  // Update display text based on current index
  useEffect(() => {
    const newDisplayText = text.slice(0, currentIndex);
    setDisplayText(newDisplayText);
    lastIndexRef.current = currentIndex;
  }, [currentIndex, text]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTypewriter();
    };
  }, [clearTypewriter]);

  return {
    displayText,
    isTyping,
    progress: text.length > 0 ? currentIndex / text.length : 1,
  };
}
