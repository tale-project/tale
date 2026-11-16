import { cn } from '@tale/ui/cn';

/**
 * The branch mark the Forgejo connector's own icon draws, in its orange,
 * without that icon's white tile — and, on a dark surface, a lighter orange
 * of the same hue, which keeps it readable on the dark muted tile.
 */
export const ForgejoIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="3 3 18 18"
    fill="none"
    className={cn('size-full', className)}
    aria-hidden
  >
    <g
      className="stroke-[#C2410C] dark:stroke-[#FDBA74]"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="6" r="2" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="9" r="2" />
      <path d="M7 8v8M17 11a5 5 0 0 1-5 5H9" />
    </g>
  </svg>
);
