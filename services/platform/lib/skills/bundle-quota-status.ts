export type BundleQuotaStatus = 'ok' | 'near' | 'full';

/**
 * Default 75% — gives the user one warning before the Add-file button
 * disables itself at 100%. Below the threshold the UI hides the quota
 * line entirely since the limit is rarely the user's concern.
 */
export const BUNDLE_QUOTA_WARN_THRESHOLD = 0.75;

export function getBundleQuotaStatus(
  used: number,
  max: number,
  bytes: number,
  byteMax: number,
): BundleQuotaStatus {
  if (used >= max || bytes >= byteMax) return 'full';
  const warn = BUNDLE_QUOTA_WARN_THRESHOLD;
  if (used >= max * warn || bytes >= byteMax * warn) return 'near';
  return 'ok';
}
