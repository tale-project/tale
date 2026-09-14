/**
 * The refusal kinds `safeFetch` reports, as a runtime list — so a surface
 * that records or documents them (the crawler's page failures, the OpenAPI
 * enum behind `WebsitePage.lastErrorKind`) enumerates the same set the
 * client throws, and a kind added there reaches them without a second
 * copy. Dependency-free on purpose: the browser bundle imports types from
 * modules that name this list, and the client itself pulls in undici.
 */
export const SAFE_FETCH_ERROR_KINDS = [
  'invalid_url',
  'unsupported_protocol',
  'insecure_public_http',
  'private_ip',
  'dns_failed',
  'redirect_missing_location',
  'redirect_limit_exceeded',
  'response_too_large',
  'response_too_small',
  'network_error',
  // The TLS handshake failed — an expired, self-signed, untrusted or
  // wrong-host certificate: permanent until the operator renews it, and
  // named as such rather than folded into `network_error` (2026-09-14
  // evaluation, g4-4).
  'tls_error',
  'timeout',
  'aborted',
] as const;

export type SafeFetchErrorKind = (typeof SAFE_FETCH_ERROR_KINDS)[number];
