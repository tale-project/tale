import { cn } from '@tale/ui/cn';
import type { SVGProps } from 'react';

export const AtlassianIcon = ({
  className,
  ...props
}: SVGProps<SVGSVGElement>) => (
  <svg
    className={cn('size-full', className)}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <defs>
      <linearGradient
        id="atlassian-grad-1"
        x1="11.49"
        y1="11.34"
        x2="6.5"
        y2="20.0"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0.18" stopColor="#0052cc" />
        <stop offset="1" stopColor="#2684ff" />
      </linearGradient>
    </defs>
    <path
      fill="url(#atlassian-grad-1)"
      d="M7.12 11.41a.59.59 0 0 0-1 .12L1.06 21.66a.61.61 0 0 0 .54.88h7.04a.58.58 0 0 0 .54-.34c1.51-3.13.59-7.89-1.5-9.79z"
    />
    <path
      fill="#2684FF"
      d="M11.53 1.51a13.45 13.45 0 0 0-.78 13.27l3.4 6.78a.61.61 0 0 0 .54.34h7.04a.61.61 0 0 0 .54-.88S12.81 1.74 12.58 1.28a.55.55 0 0 0-1.05.23z"
    />
  </svg>
);
