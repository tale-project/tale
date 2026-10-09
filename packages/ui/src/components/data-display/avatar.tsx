'use client';

/**
 * The picture of who said or did something: a person's initials, an agent's
 * bot, an automation's workflow glyph, the system, or an empty slot.
 *
 * Named (`label`), the avatar is an image (`role="img"` + `aria-label` +
 * `title`) — a bare `<span aria-label>` names nothing. Without a label it is
 * decorative and hidden from assistive technology, for the common case where
 * the name is already written beside it.
 *
 * A person's tint is hashed from the name over a fixed set of token-paired
 * tints, so the same person reads in the same colour in every list.
 */

import { cva } from 'class-variance-authority';
import { Bot, Sparkles, User, Workflow, type LucideIcon } from 'lucide-react';
import { useCallback, useState, type HTMLAttributes, type Ref } from 'react';

import { cn } from '../../lib/cn';

export type AvatarKind =
  | 'person'
  | 'agent'
  | 'automation'
  | 'system'
  | 'unassigned';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

/**
 * `auto` hashes a person's name to a tint; `neutral` is the muted chip;
 * `primary` the soft accent tint agents use; `strong` the filled accent
 * that marks "you".
 */
export type AvatarTone = 'auto' | 'neutral' | 'primary' | 'strong';

/** Theme-safe tints, each with its dark-mode pair. */
const PERSON_TONES = [
  'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
] as const;

const TONES: Record<Exclude<AvatarTone, 'auto'>, string> = {
  neutral: 'bg-muted text-foreground',
  primary: 'bg-primary/10 text-primary',
  strong: 'bg-primary text-primary-foreground',
};

const DEFAULT_TONE: Record<AvatarKind, AvatarTone> = {
  person: 'auto',
  agent: 'primary',
  automation: 'neutral',
  system: 'neutral',
  unassigned: 'neutral',
};

const KIND_ICONS: Record<AvatarKind, LucideIcon> = {
  person: User,
  agent: Bot,
  automation: Workflow,
  system: Sparkles,
  unassigned: User,
};

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full leading-none font-semibold select-none',
  {
    variants: {
      size: {
        // Initials never drop below 10px.
        xs: 'size-5 text-[10px]',
        sm: 'size-6 text-[10px]',
        md: 'size-7 text-[11px]',
        lg: 'size-8 text-xs',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

const ICON_SIZES: Record<AvatarSize, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-4',
};

/**
 * One or two letters for a name: the first letters of its first and last
 * words, or the first letter of a single word. An email reads by its local
 * part ("anna.meier@…" → "AM").
 */
export function getInitials(name: string): string {
  const words = name
    .trim()
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return '';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const letter = (word: string) => Array.from(word)[0] ?? '';
  return `${letter(first)}${last === undefined ? '' : letter(last)}`.toUpperCase();
}

function hashTone(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PERSON_TONES[Math.abs(hash) % PERSON_TONES.length] ?? PERSON_TONES[0];
}

export interface AvatarProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children' | 'role'
> {
  /** What the avatar stands for. @default 'person' */
  kind?: AvatarKind;
  /** A person's name: the source of the initials and of the hashed tint. */
  name?: string;
  /**
   * The accessible name. Given, the avatar is a named image with the label
   * as its tooltip; absent, it is decorative.
   */
  label?: string;
  /** 20, 24, 28 or 32px. @default 'sm' */
  size?: AvatarSize;
  /** Override the kind's colour. */
  tone?: AvatarTone;
  /** A picture to show instead of initials; initials remain the fallback. */
  src?: string;
  /** Override the kind's glyph. */
  icon?: LucideIcon;
  ref?: Ref<HTMLSpanElement>;
}

export function Avatar({
  kind = 'person',
  name,
  label,
  size = 'sm',
  tone,
  src,
  icon,
  title,
  className,
  ref,
  ...props
}: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const onImageError = useCallback(() => setFailedSrc(src ?? null), [src]);
  const initials =
    kind === 'person' && name !== undefined ? getInitials(name) : '';
  const resolvedTone = tone ?? DEFAULT_TONE[kind];
  const surface =
    kind === 'unassigned'
      ? 'border-border text-muted-foreground border border-dashed'
      : resolvedTone === 'auto'
        ? initials.length > 0 && name !== undefined
          ? hashTone(name)
          : TONES.neutral
        : TONES[resolvedTone];
  const Icon = icon ?? KIND_ICONS[kind];
  const showImage = src !== undefined && failedSrc !== src;

  return (
    <span
      ref={ref}
      {...props}
      {...(label !== undefined
        ? { role: 'img', 'aria-label': label, title: title ?? label }
        : { 'aria-hidden': true, title })}
      data-kind={kind}
      className={cn(avatarVariants({ size }), surface, className)}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          onError={onImageError}
          className="size-full object-cover"
        />
      ) : initials.length > 0 ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <Icon aria-hidden="true" className={ICON_SIZES[size]} />
      )}
    </span>
  );
}
