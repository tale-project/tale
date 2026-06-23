/**
 * Best-effort, human-readable device label derived from a browser User-Agent
 * string — used to pre-fill the "Passkey name" field (#1948) with something
 * recognizable like "Chrome on macOS" or "Safari on iPhone". The result is
 * always editable and callers fall back to a placeholder when it is empty
 * (e.g. an unrecognized or missing User-Agent).
 */

/** Maps a User-Agent to a coarse browser name, or '' when unrecognized. */
function detectBrowser(userAgent: string): string {
  // Order matters: Edge/Opera/Brave masquerade as Chrome, and iOS Chrome
  // (CriOS) / Firefox (FxiOS) wrap WebKit, so the specific tokens win first.
  if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return 'Edge';
  if (/\b(?:OPR|Opera)\//.test(userAgent)) return 'Opera';
  if (/\b(?:Firefox|FxiOS)\//.test(userAgent)) return 'Firefox';
  if (/\b(?:Chrome|CriOS|Chromium)\//.test(userAgent)) return 'Chrome';
  if (/\bSafari\//.test(userAgent) && /\bVersion\//.test(userAgent)) {
    return 'Safari';
  }
  return '';
}

/** Maps a User-Agent to a coarse OS / device name, or '' when unrecognized. */
function detectOS(userAgent: string): string {
  // Check the mobile/tablet tokens before the desktop ones: iPadOS reports
  // "Macintosh" in some configurations, and Android contains "Linux".
  if (/\biPhone\b/.test(userAgent)) return 'iPhone';
  if (/\biPad\b/.test(userAgent)) return 'iPad';
  if (/\bAndroid\b/.test(userAgent)) return 'Android';
  if (/\b(?:Macintosh|Mac OS X)\b/.test(userAgent)) return 'macOS';
  if (/\bWindows\b/.test(userAgent)) return 'Windows';
  if (/\bCrOS\b/.test(userAgent)) return 'ChromeOS';
  if (/\bLinux\b/.test(userAgent)) return 'Linux';
  return '';
}

/**
 * Returns a best-effort label such as "Chrome on macOS". Falls back to just
 * the browser or just the OS when only one is recognized, and to '' when
 * neither is — letting the caller use its placeholder instead.
 */
export function deriveDeviceLabel(
  userAgent: string | undefined | null,
): string {
  if (!userAgent) return '';
  const browser = detectBrowser(userAgent);
  const os = detectOS(userAgent);
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || '';
}
