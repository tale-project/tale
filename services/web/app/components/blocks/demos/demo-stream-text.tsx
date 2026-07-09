import { cn } from '@tale/ui/cn';

export interface DemoStreamTextProps {
  /** Pre-split localized clauses, revealed one per beat. */
  segments: readonly string[];
  /** Number of segments currently revealed. */
  visible: number;
  /** Show the streaming cursor after the last revealed segment. */
  streaming: boolean;
  className?: string;
}

/**
 * Reveals pre-split clauses with the shared `.stream-reveal`/`.stream-seg`
 * fade from globals.css (Gemini-style clause-by-clause reveal, with its own
 * reduced-motion kill). Deliberately NOT the markdown streaming engine —
 * demos script a handful of clauses and must not pull remark/rehype in.
 */
export function DemoStreamText({
  segments,
  visible,
  streaming,
  className,
}: DemoStreamTextProps) {
  return (
    <p className={cn('stream-reveal', className)}>
      {segments.slice(0, visible).map((segment) => (
        <span key={segment} className="stream-seg">
          {segment}{' '}
        </span>
      ))}
      {streaming ? (
        <span className="animate-cursor-blink -mb-0.5 inline-block h-[1.05em] w-px bg-current align-text-bottom" />
      ) : null}
    </p>
  );
}
