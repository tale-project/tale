import type { SVGProps } from 'react';

type FlagProps = SVGProps<SVGSVGElement>;

/**
 * Locale flag glyphs — built from primitive shapes so we ship no
 * external SVG assets. Each renders into a 60×40 viewBox; size by
 * setting `width`/`height` or a Tailwind `size-*` class.
 */
export function FlagEN(props: FlagProps) {
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

export function FlagDE(props: FlagProps) {
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

export function FlagFR(props: FlagProps) {
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

const FLAGS = { en: FlagEN, de: FlagDE, fr: FlagFR } as const;
export type FlagLocale = keyof typeof FLAGS;

export function LocaleFlag({
  locale,
  ...props
}: { locale: FlagLocale } & FlagProps) {
  const Flag = FLAGS[locale];
  return <Flag {...props} />;
}
