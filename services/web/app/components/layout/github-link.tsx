import { cn } from '@tale/ui/cn';
import { GithubIcon } from '@tale/ui/icons/github';

import { EXTERNAL_LINKS } from '@/lib/external-links';

type GithubLinkVariant = 'icon' | 'labeled';

interface GithubLinkProps {
  /** Accessible name — also shown as visible text when `variant="labeled"`. */
  label: string;
  variant?: GithubLinkVariant;
  className?: string;
}

const focusRing =
  'focus-visible:ring-fg-base/60 focus-visible:ring-offset-bg-base focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none';

/**
 * Marketing chrome link to the public GitHub repo — header icon, mobile
 * labeled row, and footer bottom bar (after the theme picker) all share this.
 */
export function GithubLink({
  label,
  variant = 'icon',
  className,
}: GithubLinkProps) {
  const labeled = variant === 'labeled';

  return (
    <a
      href={EXTERNAL_LINKS.github}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className={cn(
        'text-fg-muted hover:text-fg-base transition-colors',
        focusRing,
        labeled
          ? 'inline-flex items-center gap-2 text-lg'
          : 'hover:bg-surface-site-inset inline-flex size-9 shrink-0 items-center justify-center rounded-full',
        className,
      )}
    >
      <GithubIcon className={labeled ? 'size-5' : 'size-4'} />
      {labeled ? <span>{label}</span> : null}
    </a>
  );
}
