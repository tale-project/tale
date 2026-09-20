/**
 * Flush field focus: the control's own edge becomes `--color-accent-base`
 * and a 30% glow hugs it. `ring-offset-*` is the wrong recipe — it paints a
 * second outline around a gutter (the "picture frame").
 */
export const FIELD_FOCUS =
  'focus-visible:border-[color:var(--color-accent-base)] focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-base)]/30 focus-visible:outline-none';

export const FIELD_FOCUS_WITHIN =
  'focus-within:border-[color:var(--color-accent-base)] focus-within:ring-2 focus-within:ring-[color:var(--color-accent-base)]/30';

export const FIELD_INVALID =
  'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/30';

export const FIELD_INVALID_WITHIN =
  'border-destructive focus-within:border-destructive focus-within:ring-destructive/30';
