/** Console/HTML display helpers shared by the plan view and review sheet. */

/** `m:ss.d` — video-position clock, tenth-of-a-second precision. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
