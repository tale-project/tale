import { cn } from '@tale/ui/cn';

/**
 * A mail server's glyph for mail reached over IMAP and SMTP rather than
 * through a named provider: a white envelope on a blue tile, as the IMAP/SMTP
 * connector's own icon draws it.
 */
export const MailServerIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={cn('size-full', className)}
    aria-hidden
  >
    <rect width="24" height="24" rx="6" fill="#2563EB" />
    <path
      d="M5 7.5h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"
      fill="#FFFFFF"
    />
    <path
      d="M4.6 8.2 12 13l7.4-4.8"
      stroke="#2563EB"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);
