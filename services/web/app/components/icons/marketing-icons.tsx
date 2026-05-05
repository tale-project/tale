import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const baseStrokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const thinStrokeProps = {
  ...baseStrokeProps,
  strokeWidth: 1.5,
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

export function HospitalityIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 12 14" aria-hidden {...thinStrokeProps} {...props}>
      <path d="M3.5 11.6667V7.83417M4.66667 5.25H4.6725M4.66667 2.91667H4.6725M5.83333 7.83417V11.6667M6.41667 8.16667C5.9118 7.78802 5.29775 7.58333 4.66667 7.58333C4.03559 7.58333 3.42153 7.78802 2.91667 8.16667M7 5.25H7.00583M7 2.91667H7.00583M2.33333 5.25H2.33917M2.33333 2.91667H2.33917M1.16667 0H8.16667C8.811 0 9.33333 0.522334 9.33333 1.16667V10.5C9.33333 11.1443 8.811 11.6667 8.16667 11.6667H1.16667C0.522334 11.6667 0 11.1443 0 10.5V1.16667C0 0.522334 0.522334 0 1.16667 0Z" />
    </svg>
  );
}

export function LegalIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 14 13" aria-hidden {...thinStrokeProps} {...props}>
      <path d="M2.91667 10.5H8.75M5.83333 0V10.5M0.583333 2.33333H1.75C2.91667 2.33333 4.66667 1.75 5.83333 1.16667C7 1.75 8.75 2.33333 9.91667 2.33333H11.0833M8.16667 7.58333L9.91667 2.91667L11.6667 7.58333C11.1592 7.9625 10.5467 8.16667 9.91667 8.16667C9.28667 8.16667 8.67417 7.9625 8.16667 7.58333ZM0 7.58333L1.75 2.91667L3.5 7.58333C2.9925 7.9625 2.38 8.16667 1.75 8.16667C1.12 8.16667 0.5075 7.9625 0 7.58333Z" />
    </svg>
  );
}

export function FinanceIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 14 14" aria-hidden {...thinStrokeProps} {...props}>
      <path d="M8.16667 3.5H4.66667C4.35725 3.5 4.0605 3.62292 3.84171 3.84171C3.62292 4.0605 3.5 4.35725 3.5 4.66667C3.5 4.97609 3.62292 5.27283 3.84171 5.49162C4.0605 5.71042 4.35725 5.83333 4.66667 5.83333H7C7.30942 5.83333 7.60617 5.95625 7.82496 6.17504C8.04375 6.39384 8.16667 6.69058 8.16667 7C8.16667 7.30942 8.04375 7.60617 7.82496 7.82496C7.60617 8.04375 7.30942 8.16667 7 8.16667H3.5M5.83333 9.33333V2.33333M11.6667 5.83333C11.6667 9.055 9.055 11.6667 5.83333 11.6667C2.61167 11.6667 0 9.055 0 5.83333C0 2.61167 2.61167 0 5.83333 0C9.055 0 11.6667 2.61167 11.6667 5.83333Z" />
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

export function TransparentIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 23 22" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M20 15.6504L10.83 19.8104C10.5694 19.9292 10.2864 19.9907 10 19.9907C9.71361 19.9907 9.43056 19.9292 9.17 19.8104L0 15.6504M20 10.6504L10.83 14.8104C10.5694 14.9292 10.2864 14.9907 10 14.9907C9.71361 14.9907 9.43056 14.9292 9.17 14.8104L0 10.6504M10.83 0.180357C10.5694 0.0615059 10.2864 0 10 0C9.71361 0 9.43056 0.0615059 9.17 0.180357L0.6 4.08036C0.422549 4.1586 0.271679 4.28676 0.165762 4.44921C0.0598459 4.61167 0.00345373 4.80142 0.00345373 4.99536C0.00345373 5.18929 0.0598459 5.37904 0.165762 5.5415C0.271679 5.70396 0.422549 5.83211 0.6 5.91036L9.18 9.82036C9.44056 9.93921 9.72361 10.0007 10.01 10.0007C10.2964 10.0007 10.5794 9.93921 10.84 9.82036L19.42 5.92036C19.5975 5.84211 19.7483 5.71396 19.8542 5.5515C19.9602 5.38904 20.0165 5.19929 20.0165 5.00536C20.0165 4.81142 19.9602 4.62167 19.8542 4.45921C19.7483 4.29676 19.5975 4.1686 19.42 4.09036L10.83 0.180357Z" />
    </svg>
  );
}

export function CertifiedIcon(props: IconProps) {
  return (
    <svg viewBox="-1 -1 18 22" aria-hidden {...baseStrokeProps} {...props}>
      <path d="M16 11.0004C16 16.0004 12.5 18.5005 8.34 19.9505C8.12216 20.0243 7.88554 20.0207 7.67 19.9405C3.5 18.5005 0 16.0004 0 11.0004V4.00045C0 3.73523 0.105357 3.48088 0.292893 3.29334C0.48043 3.10581 0.734784 3.00045 1 3.00045C3 3.00045 5.5 1.80045 7.24 0.28045C7.45185 0.0994483 7.72135 0 8 0C8.27865 0 8.54815 0.0994483 8.76 0.28045C10.51 1.81045 13 3.00045 15 3.00045C15.2652 3.00045 15.5196 3.10581 15.7071 3.29334C15.8946 3.48088 16 3.73523 16 4.00045V11.0004Z" />
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

export function LanguageIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...props}>
      <path d="M8 14.6668C11.614 14.6668 14.6667 11.6142 14.6667 8.00016C14.6667 4.38616 11.614 1.3335 8 1.3335C4.386 1.3335 1.33334 4.38616 1.33334 8.00016C1.33334 11.6142 4.386 14.6668 8 14.6668ZM8 2.66683C10.8913 2.66683 13.3333 5.10883 13.3333 8.00016C13.3333 10.8915 10.8913 13.3335 8 13.3335C5.10867 13.3335 2.66667 10.8915 2.66667 8.00016C2.66667 5.10883 5.10867 2.66683 8 2.66683Z" />
      <path d="M8 11.3332C8.60066 11.3332 9.72066 11.2212 10.4713 10.4718L9.52866 9.52784C9.23333 9.82317 8.66133 9.99984 8 9.99984C6.916 9.99984 6 9.08384 6 7.99984C6 6.91584 6.916 5.99984 8 5.99984C8.662 5.99984 9.234 6.1765 9.52866 6.47117L10.4713 5.5285C9.72133 4.7785 8.60066 4.6665 8 4.6665C6.162 4.6665 4.66666 6.16184 4.66666 7.99984C4.66666 9.83784 6.162 11.3332 8 11.3332Z" />
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
