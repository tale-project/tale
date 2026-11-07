import { useEffect, useState } from 'react';

interface DemoTypingTextProps {
  text: string;
  /** Type characters out while true. */
  play: boolean;
  /** Render the finished line immediately (SSR, reduced motion, later beats). */
  done: boolean;
  /** Milliseconds per character. */
  charMs?: number;
}

/** Character-by-character prompt typing with the shared blinking cursor. */
export function DemoTypingText({
  text,
  play,
  done,
  charMs = 28,
}: DemoTypingTextProps) {
  const [count, setCount] = useState(() =>
    typeof window === 'undefined' || done ? text.length : 0,
  );

  useEffect(() => {
    if (done) {
      setCount(text.length);
      return undefined;
    }
    if (!play) return undefined;

    let raf = 0;
    const origin = performance.now();
    const tick = (now: number) => {
      const next = Math.min(text.length, Math.floor((now - origin) / charMs));
      setCount(next);
      if (next < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [charMs, done, play, text]);

  return (
    <span>
      {text.slice(0, count)}
      {count < text.length ? (
        <span className="animate-cursor-blink -mb-0.5 inline-block h-[1.05em] w-px bg-current align-text-bottom" />
      ) : null}
    </span>
  );
}
