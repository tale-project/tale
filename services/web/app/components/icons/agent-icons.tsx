import { cn } from '@tale/ui/cn';
import { useId, type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

const base = (extra?: string) => cn('block size-full', extra);

/**
 * OpenCode mark — Simple Icons `opencode` (Iconify `simple-icons:opencode`).
 * Framed window with inset pane from opencode.ai/brand.
 */
export function OpenCodeIcon({ className, ...props }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <path d="M22 24H2V0h20zM17 4.8H7v14.4h10z" />
    </svg>
  );
}

/**
 * Pi coding agent — official pixel "pi" wordmark from pi.dev/logo.svg
 * on the brand dark tile.
 */
export function PiAgentIcon({ className, ...props }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <rect width="800" height="800" rx="150" fill="#09090b" />
      <path
        fill="#fff"
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path fill="#fff" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

/**
 * Hermes Agent — caduceus (Iconify `hugeicons:caduceus`). No Simple Icons /
 * Iconify brand mark for Hermes Agent yet; the caduceus is the mythological
 * Hermes symbol and reads cleanly at logo-cloud size.
 */
export function HermesIcon({ className, ...props }: IconProps) {
  return (
    <svg
      className={base(className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.5 3.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0Z" />
        <path d="M16 17.5c0-.828-1.79-1.5-4-1.5s-4 .672-4 1.5S9.79 19 12 19c1.657 0 3 .672 3 1.5S13.657 22 12 22c-1.285 0-2.381-.404-2.809-.972M12 5v11" />
        <path d="M6.796 11.949C4.781 13.654 2.834 10.742 2 8.726c.883 0 2.72-.554 4.429-2.5c.746-.849 1.119-1.274 1.33-1.222c.21.052.498.688 1.075 1.96c.893 1.965 2.233 2.998 3.166 3.374c-2.4 3.867-4.47 2.685-5.204 1.611m0 0c.295-.25.592-.598.886-1.063m9.522 1.063c2.015 1.705 3.962-1.207 4.796-3.223c-.883 0-2.72-.554-4.429-2.5c-.746-.849-1.119-1.274-1.33-1.222c-.21.052-.498.688-1.075 1.96c-.893 1.965-2.233 2.998-3.166 3.374c2.4 3.867 4.47 2.685 5.204 1.611m0 0c-.295-.25-.592-.598-.886-1.063" />
      </g>
    </svg>
  );
}

/**
 * OpenClaw — official lobster mark from openclaw.ai/favicon.svg
 * (also Iconify `selfhst:openclaw`). Gradient id is per-instance.
 */
export function OpenClawIcon({ className, ...props }: IconProps) {
  const gradientId = `openclaw-lobster-${useId().replace(/:/g, '')}`;

  return (
    <svg
      className={base(className)}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff4d4d" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>
      </defs>
      <path
        d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M45 15 Q35 5 30 8"
        stroke="#ff4d4d"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M75 15 Q85 5 90 8"
        stroke="#ff4d4d"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="45" cy="35" r="6" fill="#050810" />
      <circle cx="75" cy="35" r="6" fill="#050810" />
      <circle cx="46" cy="34" r="2.5" fill="#00e5cc" />
      <circle cx="76" cy="34" r="2.5" fill="#00e5cc" />
    </svg>
  );
}
