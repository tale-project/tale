'use client';

/**
 * Three bouncing dots that signal live, in-progress activity next to a header
 * label or timer. Decorative only (`aria-hidden`) — the surrounding "Thinking…"
 * label already carries the meaning for screen readers.
 */
export function ThinkingDots() {
  return (
    <span className="ml-0.5 inline-flex space-x-1" aria-hidden="true">
      <span className="bg-muted-foreground animate-thinking-dot h-1 w-1 rounded-full" />
      <span
        className="bg-muted-foreground animate-thinking-dot h-1 w-1 rounded-full"
        style={{ animationDelay: '0.15s' }}
      />
      <span
        className="bg-muted-foreground animate-thinking-dot h-1 w-1 rounded-full"
        style={{ animationDelay: '0.3s' }}
      />
    </span>
  );
}
