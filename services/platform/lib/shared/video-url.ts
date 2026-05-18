/**
 * Video URL detection + safety helpers — pure functions, browser-safe.
 *
 * Used by:
 *   - chat-input.tsx paste handler  → extractVideoUrls
 *   - use-chat-video-links hook     → normalizeUrlForHash (dedup key arg)
 *   - ingestVideoUrl mutation       → isPlaylistUrl (synchronous reject)
 *   - url_safety.ts (Convex action) → isSafeVideoUrl + isPlaylistUrl
 *
 * Safety posture: this module's `isSafeVideoUrl` is the ADVISORY frontend
 * check that closes the obvious holes (http://, IP literals, localhost
 * substring fakeouts). The LOAD-BEARING server-side check is
 * `convex/video_links/url_safety.ts:assertSafeUrl`, which pre-resolves
 * DNS and walks every returned IP through the shared `isPrivateIp`
 * predicate from `convex/lib/http/safe_fetch.ts`. The two layers are
 * intentionally redundant: the frontend gives instant UX feedback on a
 * mistyped URL; the server gates the actual spawn.
 *
 * Open: any https URL → yt-dlp. We do NOT allowlist hosts — yt-dlp's own
 * extractor list is canonical. `detectPlatform` returns a coarse string
 * for telemetry/chip-icon only, never gates processing.
 */

export interface ExtractedVideoUrl {
  /** The cleaned URL handed to the backend (trailing punctuation stripped,
   * surrounding markdown emphasis stripped, fragment dropped for dedup). */
  url: string;
  /** The exact original substring as it appeared in the pasted text.
   * Used by use-send-message.ts for literal String.replace stripping. */
  pastedToken: string;
  /** Coarse platform classification. */
  platform: string;
}

const KNOWN_PLATFORMS: ReadonlyArray<{
  pattern: RegExp;
  platform: string;
}> = [
  {
    pattern:
      /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$|(^|\.)m\.youtube\.com$|(^|\.)music\.youtube\.com$/,
    platform: 'youtube',
  },
  { pattern: /(^|\.)bilibili\.com$|(^|\.)b23\.tv$/, platform: 'bilibili' },
  { pattern: /(^|\.)vimeo\.com$|(^|\.)player\.vimeo\.com$/, platform: 'vimeo' },
  { pattern: /(^|\.)dailymotion\.com$/, platform: 'dailymotion' },
  { pattern: /(^|\.)twitch\.tv$/, platform: 'twitch' },
];

export function detectPlatform(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'generic';
  }
  for (const { pattern, platform } of KNOWN_PLATFORMS) {
    if (pattern.test(host)) return platform;
  }
  return 'generic';
}

/** Tracking / referral params stripped before hashing for dedup. `t=` (timestamp
 * anchor) is preserved — same video at different timestamps could be intentional. */
const TRACKING_PARAMS = new Set([
  'si',
  'feature',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'msclkid',
  'ref',
  'ref_src',
]);

/**
 * Normalize a URL for the dedup hash key (orgId, sourceUrlHash). Drops
 * fragment + tracking params; lowercases host; preserves path and meaningful
 * query (`v=`, `list=`, `t=`, etc.). NOT a canonicalizer — only meant to
 * make minor variations of the same video collapse to one key.
 */
export function normalizeUrlForHash(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  // Sort + filter query params for stable hashing
  const params = Array.from(u.searchParams.entries())
    .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  return u.toString();
}

/** Match decimal/hex/octal IPv4 literals. */
function isBareIpLiteral(host: string): boolean {
  // Standard dotted form
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  // IPv6 in brackets (URL host form)
  if (host.startsWith('[') && host.endsWith(']')) return true;
  // Hex (0x...) or decimal/octal integer hostnames
  if (/^(0x[0-9a-fA-F]+|\d+)$/.test(host)) return true;
  return false;
}

/**
 * Frontend-side safety screen. Rejects clearly-invalid URLs (non-https,
 * bare IP literals, credentialed URLs, localhost substring fakeouts).
 *
 * THIS IS ADVISORY ONLY. The Node-side `assertSafeUrl` in
 * `convex/video_links/url_safety.ts` is the load-bearing check —
 * it pre-resolves DNS and refuses any hostname whose A/AAAA records
 * land in private space, closing the rebinding gap.
 */
// Cap on the URL string itself. A 2 KB cap is well past any legitimate
// video link (longest YouTube watch URL with playlist + tracking <300
// chars) but stops a hostile paste of a multi-MB URL from being shipped
// through the mutation, the dedup hash, and the per-org rate-limit
// bookkeeping.
const MAX_VIDEO_URL_LENGTH = 2048;

export function isSafeVideoUrl(url: string): boolean {
  if (url.length > MAX_VIDEO_URL_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  // `localhost.` (trailing dot) still resolves to 127.0.0.1 on every
  // libc resolver — the strict `host === 'localhost'` check missed this
  // form. The server-side DNS pre-resolve catches it too, but failing
  // the advisory check up front gives the user instant feedback and
  // shrinks the attack surface for any future caller that consumes
  // `isSafeVideoUrl` without the server check (e.g. a future native
  // share extension).
  if (host === 'localhost' || host === 'localhost.') return false;
  // Reject IDN punycode-encoded hostnames outright. The chip would
  // otherwise render as `youtubе.com` (Cyrillic `е`) — visually
  // indistinguishable from `youtube.com`, and the user has no way to
  // notice the impersonation. Real YouTube / Bilibili / etc. hosts are
  // ASCII; punycode survives `new URL()` as `xn--…`.
  if (host.includes('xn--')) return false;
  // `localhost.evil.com` substring fakeout is fine — it's a real public
  // host. The browser will resolve it normally; server DNS check is the
  // real guard.
  if (isBareIpLiteral(host)) return false;
  return true;
}

/**
 * Reject standalone playlist URLs. yt-dlp watch?v=X&list=Y is fine because
 * we pass `--no-playlist`; pure /playlist?list=Y has no video to fall back
 * on and should be refused at submit time with a clear error.
 */
export function isPlaylistUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  // YouTube standalone playlist
  if (
    /(^|\.)youtube\.com$|(^|\.)m\.youtube\.com$/.test(host) &&
    path === '/playlist' &&
    u.searchParams.has('list')
  ) {
    return true;
  }
  // Bilibili medialist
  if (
    /(^|\.)bilibili\.com$/.test(host) &&
    path.startsWith('/medialist/play/')
  ) {
    return true;
  }
  return false;
}

/**
 * Strip fenced + inline code blocks before URL matching. Users in chat
 * frequently quote URLs in backticks ("see `https://…`") and we should
 * NOT auto-ingest those — the intent is to discuss the URL, not analyze
 * the video.
 */
function stripCodeBlocks(text: string): string {
  return (
    text
      // Fenced (```...```)
      .replace(/```[\s\S]*?```/g, ' ')
      // Inline (`...`)
      .replace(/`[^`]*`/g, ' ')
  );
}

/** Trailing punctuation, closing brackets, and markdown emphasis to strip
 * from a matched URL token. Keep `(` matching only when balanced — yt-dlp
 * routing through `(` URLs is rare and the strip is conservative. */
function stripTrailingNoise(token: string): string {
  let s = token;
  // Strip up to 4 trailing punctuation/markdown chars (handles `*url*.`)
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(/[.,;:!?)\]>*_~]$/, '');
    if (s === before) break;
  }
  // Strip a closing paren only when the URL itself contains no `(`
  if (s.endsWith(')') && !s.slice(0, -1).includes('(')) {
    s = s.slice(0, -1);
  }
  return s;
}

const URL_RE = /\bhttps:\/\/[^\s<>"'`]+/gi;

/**
 * Extract up to `maxUrls` deduped, sanitized video URLs from free text.
 *
 * Algorithm:
 *  1. Strip fenced/inline code blocks (preserves blockquotes — those are
 *     legitimate forwarding, not quotation).
 *  2. Regex-match `\bhttps:\/\/[^\s<>"'`]+`.
 *  3. Per match, strip trailing punctuation + markdown emphasis (captures
 *     the cleaned URL but ALSO records the ORIGINAL substring as
 *     `pastedToken` for later literal-replace stripping at send time).
 *  4. Drop entries that fail `isSafeVideoUrl` or `isPlaylistUrl`.
 *  5. Dedup post-normalize (`normalizeUrlForHash`); first occurrence wins.
 *  6. Cap to `maxUrls` (default 3) — pastes of 100 URLs are an abuse vector.
 */
export function extractVideoUrls(
  text: string,
  opts: { maxUrls?: number } = {},
): ExtractedVideoUrl[] {
  const maxUrls = opts.maxUrls ?? 3;
  const cleaned = stripCodeBlocks(text);
  const out: ExtractedVideoUrl[] = [];
  const seen = new Set<string>();

  for (const match of cleaned.matchAll(URL_RE)) {
    if (out.length >= maxUrls) break;
    const original = match[0];
    const cleanedUrl = stripTrailingNoise(original);
    if (cleanedUrl.length === 0) continue;
    if (!isSafeVideoUrl(cleanedUrl)) continue;
    if (isPlaylistUrl(cleanedUrl)) continue;
    const dedupKey = normalizeUrlForHash(cleanedUrl);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({
      url: cleanedUrl,
      // pastedToken preserves the original text-as-pasted (including any
      // stripped trailing punctuation) so use-send-message.ts can do a
      // literal String.replace on the textarea content.
      pastedToken: original,
      platform: detectPlatform(cleanedUrl),
    });
  }

  return out;
}
