/**
 * A byte cap the way the docs write it — whole MiB at or above a mebibyte,
 * KiB below — so every refusal that names a cap (the REST door's 413, the
 * bounded body intake's `FILE_SIZE_INVALID`) speaks the unit the reference
 * documents, never a "30 MB" beside a documented "30 MiB".
 */
export function describeByteCap(maxBytes: number): string {
  return maxBytes >= 1024 * 1024 && maxBytes % (1024 * 1024) === 0
    ? `${maxBytes / (1024 * 1024)} MiB`
    : `${Math.round(maxBytes / 1024)} KiB`;
}
