import { cn } from '@tale/ui/cn';

/** Deterministic, theme-safe tints for a contact's initials — the same
 * person reads in the same colour in the Home list and in the conversation
 * header. */
const AVATAR_TONES = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
] as const;

function initialsOf(label: string): string {
  const words = label
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0);
  const first = words[0]?.[0] ?? '?';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

function toneOf(label: string): string {
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length] ?? AVATAR_TONES[0];
}

const SIZES = {
  sm: 'size-5 text-[9px]',
  lg: 'size-8 text-xs',
} as const;

/** A contact's initials in a tinted circle — decorative; the name travels
 * as text beside it. */
export function ContactInitials({
  label,
  size = 'sm',
}: {
  label: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full leading-none font-semibold',
        SIZES[size],
        toneOf(label),
      )}
    >
      {initialsOf(label)}
    </span>
  );
}
