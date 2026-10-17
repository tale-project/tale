import { cn } from '@tale/ui/cn';

/**
 * GlitchTip's bug mark, in the purple the GlitchTip connector's own icon
 * draws it with, without that icon's white tile — and, on a dark surface, a
 * lighter purple of the same hue: on the dark muted tile the brand's own
 * reads at about 1.5:1, this one at about 6.6:1 (light: 9:1).
 */
export const GlitchTipIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="3 3 18 18"
    fill="none"
    className={cn('size-full', className)}
    aria-hidden
  >
    <g
      className="stroke-[#681C89] dark:stroke-[#C79BE0]"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m8 4 2 2m6-2-2 2M12 6a3 3 0 0 1 3 3H9a3 3 0 0 1 3-3Z" />
      <rect x="7" y="9" width="10" height="11" rx="5" />
      <path d="M12 10v9M7 11l-3-2m3 6H4m3 3-3 2m13-9 3-2m-3 6h3m-3 3 3 2" />
    </g>
  </svg>
);
