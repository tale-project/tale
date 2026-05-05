import { cn } from '@tale/ui/cn';

export const MicrosoftIcon = ({ className }: { className?: string }) => (
  <svg
    className={cn('size-full', className)}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Microsoft"
    role="img"
  >
    <path d="M11.4 2H2v9.4h9.4V2z" fill="#F25022" />
    <path d="M22 2h-9.4v9.4H22V2z" fill="#7FBA00" />
    <path d="M11.4 12.6H2V22h9.4v-9.4z" fill="#00A4EF" />
    <path d="M22 12.6h-9.4V22H22v-9.4z" fill="#FFB900" />
  </svg>
);
