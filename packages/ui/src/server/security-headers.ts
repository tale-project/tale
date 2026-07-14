/**
 * HTTP security headers for the static React servers (marketing site + docs).
 *
 * Extracted from `index.ts` so the pure header logic can be unit-tested under
 * vitest — `index.ts` imports `bun`, which the node test runtime can't load.
 *
 * The platform app has its own stricter, nonce-based policy in
 * `services/platform/server.ts`; this is the content-site counterpart. Keep the
 * two in sync in spirit (both graded by the same securityheaders.com / MDN
 * Observatory "quick test"), but they are deliberately separate surfaces.
 */

import { createHash } from 'node:crypto';

export interface SecurityHeadersConfig {
  /**
   * CSP directives in camelCase (`defaultSrc`, `scriptSrc`, …); values are
   * source lists joined with spaces. Set to `false` to omit the header.
   */
  contentSecurityPolicy?: Record<string, readonly string[]> | false;
  /**
   * `Strict-Transport-Security` value (e.g. `'max-age=15552000'`). Only
   * emitted on HTTPS requests. Set to `false` to omit.
   */
  strictTransportSecurity?: string | false;
  xContentTypeOptions?: 'nosniff' | false;
  xFrameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  referrerPolicy?: string | false;
  /**
   * `Permissions-Policy` value (a full policy string). Set to `false` to omit.
   * Content sites deny the hardware/payment features they never use; note that
   * an omitted feature falls back to the browser default allowlist (`self`),
   * which is why clipboard is intentionally NOT denied — the docs code-copy
   * buttons rely on it.
   */
  permissionsPolicy?: string | false;
  /** `Cross-Origin-Opener-Policy`. Set to `false` to omit. */
  crossOriginOpenerPolicy?: string | false;
  /** `Cross-Origin-Resource-Policy`. Set to `false` to omit. */
  crossOriginResourcePolicy?: string | false;
  /** `X-Permitted-Cross-Domain-Policies`. Set to `false` to omit. */
  xPermittedCrossDomainPolicies?: 'none' | 'master-only' | false;
}

/**
 * Sensible default for a public marketing/docs site served from a Vite
 * `dist/`. Allows inline `<script>` because docs ships a synchronous
 * theme-detection script in `index.html`; allows inline `<style>` because
 * Tailwind v4 emits a few. Override per-service if a stricter policy fits.
 *
 * No external origins are allowed by default — runtime assets must be
 * served same-origin. Same GDPR / air-gap rationale as the platform CSP.
 */
export const defaultReactServerSecurityHeaders: SecurityHeadersConfig = {
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    mediaSrc: ["'none'"],
  },
  // 180 days, no `includeSubDomains` / `preload` — self-deployed operators
  // run on varied domains and don't own preload submission.
  strictTransportSecurity: 'max-age=15552000',
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  // Deny the hardware/payment features these content sites never use. Clipboard
  // is deliberately omitted so it keeps its default `self` allowlist (the docs
  // copy-to-clipboard buttons need it).
  permissionsPolicy:
    'camera=(), microphone=(), geolocation=(), usb=(), payment=(), bluetooth=(), midi=(), hid=(), serial=()',
  // Content sites open no cross-origin popups and load every subresource
  // same-origin, so the strict cross-origin isolation headers are safe here
  // (unlike the platform app, which needs OAuth popups + cross-host branding
  // assets and therefore leaves COOP/CORP off).
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  xPermittedCrossDomainPolicies: 'none',
};

/**
 * Compute the CSP `sha256-…` source tokens for every executable inline
 * `<script>` in `html`. Matches ONLY bare `<script>…</script>` blocks — the
 * synchronous theme-flash IIFE the sites ship. External scripts (`src=`) and
 * non-executable data blocks (`type="application/ld+json"`) carry attributes
 * and are skipped, so they don't need hashing. The hash is over the exact
 * inner bytes, which is what the browser hashes, so a token computed from the
 * served `index.html` always matches the script the browser runs.
 */
export function extractInlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const digest = createHash('sha256')
      .update(match[1], 'utf8')
      .digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

/**
 * Return `config` with its CSP `script-src` pinned to `'self'` + the given
 * hashes (dropping `'unsafe-inline'`, which a browser ignores once a hash is
 * present anyway). No-op when there are no hashes or no CSP — the caller keeps
 * its `'unsafe-inline'` fallback so a hashing miss never breaks the page.
 */
export function withScriptHashes(
  config: SecurityHeadersConfig,
  hashes: string[],
): SecurityHeadersConfig {
  if (hashes.length === 0 || !config.contentSecurityPolicy) return config;
  return {
    ...config,
    contentSecurityPolicy: {
      ...config.contentSecurityPolicy,
      scriptSrc: ["'self'", ...hashes],
    },
  };
}

export function cspDirectiveName(camel: string): string {
  return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
}

export function buildCspHeader(
  directives: Record<string, readonly string[]>,
): string {
  return Object.entries(directives)
    .map(([key, sources]) => `${cspDirectiveName(key)} ${sources.join(' ')}`)
    .join('; ');
}

/**
 * Mutates `response.headers` in place, adding any configured security
 * headers. HSTS is skipped on plaintext HTTP so dev environments don't
 * pin themselves to https.
 */
export function applySecurityHeaders(
  response: Response,
  config: SecurityHeadersConfig,
  isSecure: boolean,
): Response {
  if (config.contentSecurityPolicy) {
    response.headers.set(
      'Content-Security-Policy',
      buildCspHeader(config.contentSecurityPolicy),
    );
  }
  if (config.strictTransportSecurity && isSecure) {
    response.headers.set(
      'Strict-Transport-Security',
      config.strictTransportSecurity,
    );
  }
  if (config.xContentTypeOptions) {
    response.headers.set('X-Content-Type-Options', config.xContentTypeOptions);
  }
  if (config.xFrameOptions) {
    // nosemgrep: javascript.express.security.x-frame-options-misconfiguration.x-frame-options-misconfiguration -- generic config-driven header setter; the value is operator-controlled
    response.headers.set('X-Frame-Options', config.xFrameOptions);
  }
  if (config.referrerPolicy) {
    response.headers.set('Referrer-Policy', config.referrerPolicy);
  }
  if (config.permissionsPolicy) {
    response.headers.set('Permissions-Policy', config.permissionsPolicy);
  }
  if (config.crossOriginOpenerPolicy) {
    response.headers.set(
      'Cross-Origin-Opener-Policy',
      config.crossOriginOpenerPolicy,
    );
  }
  if (config.crossOriginResourcePolicy) {
    response.headers.set(
      'Cross-Origin-Resource-Policy',
      config.crossOriginResourcePolicy,
    );
  }
  if (config.xPermittedCrossDomainPolicies) {
    response.headers.set(
      'X-Permitted-Cross-Domain-Policies',
      config.xPermittedCrossDomainPolicies,
    );
  }
  return response;
}
