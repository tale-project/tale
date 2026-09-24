/**
 * The tint a spent share of a plan window takes.
 *
 * Five steps, read the way a fuel gauge is: green while most of the window is
 * left, yellow from half, orange from three quarters, and from 95 % an
 * orange bar running into red at its tip — nearly empty, not yet empty — until
 * the ceiling, which is red. The design tokens name one warning and one
 * failure, not a scale, so the steps are the palette hues the platform already
 * paints status fills with; each is mid-tone enough to read on the light and
 * the dark track alike.
 *
 * A quota is never green because it is full: the shared `ProgressBar` paints a
 * complete bar green ("done"), and a spent plan is the opposite of done.
 */
export function usageTint(percent: number): string {
  if (percent >= 100) return 'bg-red-500';
  if (percent >= 95) return 'bg-gradient-to-r from-orange-500 to-red-500';
  if (percent >= 75) return 'bg-orange-500';
  if (percent >= 50) return 'bg-yellow-500';
  return 'bg-green-500';
}

/**
 * The share of a window a reading says is spent, as the bar draws it.
 *
 * Rounded down, the way Claude Code's own `/usage` prints it: a window at
 * 99.6 % still has something left, and rounding it up would paint it red and
 * call it spent.
 */
export function spentPercent(utilization: number | null): number {
  return Math.floor(utilization ?? 0);
}
