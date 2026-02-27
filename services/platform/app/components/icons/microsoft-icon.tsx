import { cn } from '@/lib/utils/cn';

export const MicrosoftIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden
    className={cn('size-full', className)}
  >
    <rect x="0" y="0" width="7.604" height="7.604" fill="#F1511B" />
    <rect x="8.396" y="0" width="7.604" height="7.604" fill="#80CC28" />
    <rect x="0" y="8.396" width="7.604" height="7.604" fill="#00ADEF" />
    <rect x="8.396" y="8.396" width="7.604" height="7.604" fill="#FBBC09" />
  </svg>
);
