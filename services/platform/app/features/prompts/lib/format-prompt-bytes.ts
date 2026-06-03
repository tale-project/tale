/**
 * Compact byte size for prompt-content limits: raw bytes under 1 KiB, otherwise
 * one-decimal KB. Intentionally distinct from the Intl/MB-based
 * `lib/utils/format-bytes.ts`, which formats differently.
 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}
