import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const baseStrokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function ChatIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 20 20" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M5 7H5.01M9 7H9.01M13 7H13.01M18 12C18 12.5304 17.7893 13.0391 17.4142 13.4142C17.0391 13.7893 16.5304 14 16 14H4L0 18V2C0 1.46957 0.210714 0.960859 0.585786 0.585786C0.960859 0.210714 1.46957 0 2 0H16C16.5304 0 17.0391 0.210714 17.4142 0.585786C17.7893 0.960859 18 1.46957 18 2V12Z" />
    </svg>
  );
}

export function ConversationsIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 22 18" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M20 8H14L12 11H8L6 8H0M20 8V14C20 14.5304 19.7893 15.0391 19.4142 15.4142C19.0391 15.7893 18.5304 16 18 16H2C1.46957 16 0.960859 15.7893 0.585786 15.4142C0.210714 15.0391 0 14.5304 0 14V8M20 8L16.55 1.11C16.3844 0.776787 16.1292 0.496371 15.813 0.30028C15.4967 0.104188 15.1321 0.000197442 14.76 0H5.24C4.86792 0.000197442 4.50326 0.104188 4.18704 0.30028C3.87083 0.496371 3.61558 0.776787 3.45 1.11L0 8" />
    </svg>
  );
}

export function WorkflowsIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 22 22" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M3 14V11C3 10.7348 3.10536 10.4804 3.29289 10.2929C3.48043 10.1054 3.73478 10 4 10H16C16.2652 10 16.5196 10.1054 16.7071 10.2929C16.8946 10.4804 17 10.7348 17 11V14M10 10V6M15 14H19C19.5523 14 20 14.4477 20 15V19C20 19.5523 19.5523 20 19 20H15C14.4477 20 14 19.5523 14 19V15C14 14.4477 14.4477 14 15 14ZM1 14H5C5.55228 14 6 14.4477 6 15V19C6 19.5523 5.55228 20 5 20H1C0.447715 20 0 19.5523 0 19V15C0 14.4477 0.447715 14 1 14ZM8 0H12C12.5523 0 13 0.447715 13 1V5C13 5.55228 12.5523 6 12 6H8C7.44772 6 7 5.55228 7 5V1C7 0.447715 7.44772 0 8 0Z" />
    </svg>
  );
}

export function ApprovalsIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 22 22" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M7 10L9 12L13 8M20 10C20 15.5228 15.5228 20 10 20C4.47715 20 0 15.5228 0 10C0 4.47715 4.47715 0 10 0C15.5228 0 20 4.47715 20 10Z" />
    </svg>
  );
}

export function IndependentIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 20 14" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M8 6H0M13 0H0M13 12H0M18 6H12" />
    </svg>
  );
}

export function StackIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 22 18" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M10 4V0H6M0 10H2M18 10H20M13 9V11M7 9V11M4 4H16C17.1046 4 18 4.89543 18 6V14C18 15.1046 17.1046 16 16 16H4C2.89543 16 2 15.1046 2 14V6C2 4.89543 2.89543 4 4 4Z" />
    </svg>
  );
}

export function SecureIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 20 22" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M4 9V5C4 3.67392 4.52678 2.40215 5.46447 1.46447C6.40215 0.526784 7.67392 0 9 0C10.3261 0 11.5979 0.526784 12.5355 1.46447C13.4732 2.40215 14 3.67392 14 5V9M2 9H16C17.1046 9 18 9.89543 18 11V18C18 19.1046 17.1046 20 16 20H2C0.89543 20 0 19.1046 0 18V11C0 9.89543 0.89543 9 2 9Z" />
    </svg>
  );
}

export function BuiltForYouIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 22 18" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M0 16H20M3 0H17C18.1046 0 19 0.89543 19 2V10C19 11.1046 18.1046 12 17 12H3C1.89543 12 1 11.1046 1 10V2C1 0.89543 1.89543 0 3 0Z" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 14 8" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M0 0L6 6L12 0" />
    </svg>
  );
}

// Locale flag glyphs — built from primitive shapes (no external assets).
// Each is rendered into a 24×16 viewBox so they line up next to text labels.

export function FlagEN(props: IconProps) {
  return (
    <svg
      viewBox="0 0 60 40"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      {...props}
    >
      <rect width="60" height="40" fill="#012169" />
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#FFFFFF" strokeWidth="8" />
      <path
        d="M0,0 L60,40 M60,0 L0,40"
        stroke="#C8102E"
        strokeWidth="3"
        strokeDasharray="0 30 30 60"
      />
      <path d="M30,0 V40 M0,20 H60" stroke="#FFFFFF" strokeWidth="13" />
      <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="7" />
      <rect
        width="60"
        height="40"
        fill="none"
        stroke="rgba(0,0,0,0.12)"
        strokeWidth="1"
      />
    </svg>
  );
}

export function FlagDE(props: IconProps) {
  return (
    <svg
      viewBox="0 0 60 40"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      {...props}
    >
      <rect width="60" height="13.333" fill="#000000" />
      <rect y="13.333" width="60" height="13.333" fill="#DD0000" />
      <rect y="26.666" width="60" height="13.334" fill="#FFCE00" />
      <rect
        width="60"
        height="40"
        fill="none"
        stroke="rgba(0,0,0,0.12)"
        strokeWidth="1"
      />
    </svg>
  );
}

export function FlagFR(props: IconProps) {
  return (
    <svg
      viewBox="0 0 60 40"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      {...props}
    >
      <rect width="20" height="40" fill="#0055A4" />
      <rect x="20" width="20" height="40" fill="#FFFFFF" />
      <rect x="40" width="20" height="40" fill="#EF4135" />
      <rect
        width="60"
        height="40"
        fill="none"
        stroke="rgba(0,0,0,0.12)"
        strokeWidth="1"
      />
    </svg>
  );
}
