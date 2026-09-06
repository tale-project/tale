import { describe, expect, test } from 'vitest';

import { createApp } from './server';

// ---------------------------------------------------------------------------
// Mozilla / MDN HTTP Observatory grade — recorded result + regression guard
// for issue #1925 ("Verify the web client passes the Mozilla Observatory
// check").
//
// The required security headers were implemented and unit-tested in
// `server.ts` / `server.test.ts`, but the Observatory GRADE itself was never
// computed or recorded — so "passes Observatory" was an assumption, and
// nothing stopped a future header change from silently dropping the grade.
//
// This file closes that gap WITHOUT depending on the public Observatory
// service or a live HTTPS deployment: it re-implements the header-derived
// portion of the MDN HTTP Observatory v2 scoring algorithm and runs it against
// the exact headers `createApp()` emits. The scoring constants and per-test
// classification logic are ported verbatim from the canonical source
// (github.com/mdn/mdn-http-observatory) so they cannot quietly drift:
//   - SIX_MONTHS / MINIMUM_SCORE_FOR_EXTRA_CREDIT / GRADE_CHART  (grader/charts.js)
//   - the score summation + bonus-gating rule                    (scanner/index.js)
//   - the per-test classifiers                                   (analyzer/tests/*.js)
//
// Recorded result: the headers grade **A+** (score 110 → capped to 100 → A+).
// See the headline test below for the per-test breakdown.
//
// Two Observatory tests are NOT derivable from a single in-process response and
// are therefore out of scope of the computed score (both score 0 / pass for
// this app, so they do not change the grade):
//   - Subresource Integrity: every script in the SPA shell is loaded
//     same-origin (relative `/assets/*`), which Observatory scores as
//     `sri-not-implemented-but-all-scripts-loaded-from-secure-origin` (0).
//   - Redirection: http→https is enforced at the Caddy edge
//     (services/proxy/Caddyfile), scored `redirection-to-https` (0).
// Because both are 0, the header-derived score computed here equals the full
// Observatory score.
// ---------------------------------------------------------------------------

// EnvConfig fixture mirroring server.test.ts — an HTTPS deployment so HSTS is
// emitted (Observatory only scans HTTPS origins).
const baseEnv = {
  SITE_URL: 'https://tale.example.com',
  SITE_ORIGINS: ['https://tale.example.com'] as readonly string[],
  BASE_PATH: '',
  TRUSTED_HEADERS_ENABLED: false,
  FILE_EVENTS_ENABLED: true,
  SENTRY_DSN: undefined,
  SENTRY_TRACES_SAMPLE_RATE: 1,
  TALE_VERSION: undefined,
  CANVAS_PREVIEW_CSP_EXTRA_ORIGINS: [] as readonly string[],
};

// --- Scoring constants (grader/charts.js) ---------------------------------

// "15768000 is six months, but a lot of sites use 15552000, so a white lie is
// in order" — strict-transport-security.js. The comparison is `maxAge <
// SIX_MONTHS`, so exactly 15552000 (== Tale's `max-age`) passes.
const SIX_MONTHS = 15552000;
// Bonus (positive) modifiers are only awarded if the uncurved score (100 + sum
// of negative modifiers) reaches this floor.
const MINIMUM_SCORE_FOR_EXTRA_CREDIT = 90;

const GRADE_CHART = new Map<number, string>([
  [100, 'A+'],
  [95, 'A'],
  [90, 'A'],
  [85, 'A-'],
  [80, 'B+'],
  [75, 'B'],
  [70, 'B'],
  [65, 'B-'],
  [60, 'C+'],
  [55, 'C'],
  [50, 'C'],
  [45, 'C-'],
  [40, 'D+'],
  [35, 'D'],
  [30, 'D'],
  [25, 'D-'],
  [20, 'F'],
  [15, 'F'],
  [10, 'F'],
  [5, 'F'],
  [0, 'F'],
]);

// result-code → score modifier (grader/charts.js SCORE_TABLE). Only the codes
// the classifiers below can produce are listed.
const MODIFIERS: Record<string, number> = {
  // Content Security Policy
  'csp-implemented-with-no-unsafe-default-src-none': 10,
  'csp-implemented-with-no-unsafe': 5,
  'csp-implemented-with-unsafe-inline-in-style-src-only': 0,
  'csp-implemented-with-insecure-scheme-in-passive-content-only': -10,
  'csp-implemented-with-unsafe-eval': -10,
  'csp-implemented-with-unsafe-inline': -20,
  'csp-implemented-with-insecure-scheme': -20,
  'csp-not-implemented': -25,
  // Cookies
  'cookies-secure-with-httponly-sessions-and-samesite': 5,
  'cookies-secure-with-httponly-sessions': 0,
  'cookies-not-found': 0,
  'cookies-without-secure-flag-but-protected-by-hsts': -5,
  'cookies-session-without-secure-flag-but-protected-by-hsts': -10,
  'cookies-without-secure-flag': -20,
  'cookies-samesite-flag-invalid': -20,
  'cookies-anticsrf-without-samesite-flag': -20,
  'cookies-session-without-httponly-flag': -30,
  'cookies-session-without-secure-flag': -40,
  // CORS (Access-Control-Allow-Origin)
  'cross-origin-resource-sharing-not-implemented': 0,
  'cross-origin-resource-sharing-implemented-with-public-access': 0,
  'cross-origin-resource-sharing-implemented-with-restricted-access': 0,
  'cross-origin-resource-sharing-implemented-with-universal-access': -50,
  // Referrer-Policy
  'referrer-policy-private': 5,
  'referrer-policy-not-implemented': 0,
  'referrer-policy-unsafe': -5,
  'referrer-policy-header-invalid': -5,
  // Strict-Transport-Security
  'hsts-preloaded': 5,
  'hsts-implemented-max-age-at-least-six-months': 0,
  'hsts-implemented-max-age-less-than-six-months': -10,
  'hsts-not-implemented': -20,
  'hsts-header-invalid': -20,
  'hsts-not-implemented-no-https': -20,
  // X-Content-Type-Options
  'x-content-type-options-nosniff': 0,
  'x-content-type-options-not-implemented': -5,
  'x-content-type-options-header-invalid': -5,
  // X-Frame-Options
  'x-frame-options-implemented-via-csp': 5,
  'x-frame-options-sameorigin-or-deny': 5,
  'x-frame-options-allow-from-origin': 0,
  'x-frame-options-not-implemented': -20,
  'x-frame-options-header-invalid': -20,
  // Cross-Origin-Resource-Policy
  'cross-origin-resource-policy-header-invalid': -5,
  'cross-origin-resource-policy-implemented-with-cross-origin': 0,
  'cross-origin-resource-policy-implemented-with-same-origin': 10,
  'cross-origin-resource-policy-implemented-with-same-site': 10,
  'cross-origin-resource-policy-not-implemented': 0,
};

// --- grader/grader.js: getGradeForScore ------------------------------------

function getGradeForScore(score: number): { score: number; grade: string } {
  score = Math.max(score, 0);
  // score>100 → use the grade for 100, else round down to the nearest 5.
  const key = Math.min(score - (score % 5), 100);
  const grade = GRADE_CHART.get(key);
  if (!grade) throw new Error(`Score of ${key} did not map to a grade`);
  return { score, grade };
}

// --- CSP classifier (analyzer/tests/csp.js) --------------------------------

const DANGEROUSLY_BROAD = new Set([
  'ftp:',
  'http:',
  'https:',
  '*',
  'http://*',
  'http://*.*',
  'https://*',
  'https://*.*',
]);
const UNSAFE_INLINE = new Set(["'unsafe-inline'", 'data:']);
const BROAD_AND_UNSAFE = new Set([...DANGEROUSLY_BROAD, ...UNSAFE_INLINE]);
const PASSIVE_DIRECTIVES = new Set(['img-src', 'media-src']);
const NONCES_HASHES = ["'sha256-", "'sha384-", "'sha512-", "'nonce-"];

type Csp = Map<string, Set<string>>;

function parseCsp(header: string): Csp {
  const csp: Csp = new Map();
  for (const directive of header.split(';')) {
    const parts = directive.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const name = parts[0].toLowerCase();
    csp.set(name, new Set(parts.slice(1)));
  }
  return csp;
}

function startsWithNonceHash(sources: Iterable<string>): boolean {
  return [...sources].some((s) => NONCES_HASHES.some((n) => s.startsWith(n)));
}

function classifyCsp(csp: Csp, https: boolean): string {
  // `new Set(...)` clones, so mutating these never touches the parsed map.
  const objectSrc = new Set(
    csp.get('object-src') ?? csp.get('default-src') ?? ['*'],
  );
  const scriptSrc = new Set(
    csp.get('script-src') ?? csp.get('default-src') ?? ['*'],
  );
  const styleSrc = new Set(
    csp.get('style-src') ?? csp.get('default-src') ?? ['*'],
  );

  // 'unsafe-inline' is ignored by browsers when a nonce/hash is present.
  for (const list of [scriptSrc, styleSrc]) {
    if (startsWithNonceHash(list) && list.has("'unsafe-inline'")) {
      list.delete("'unsafe-inline'");
    }
  }

  const activeSources: string[] = [];
  for (const [directive, sources] of csp) {
    if (!PASSIVE_DIRECTIVES.has(directive) && directive !== 'script-src') {
      activeSources.push(...sources);
    }
  }
  activeSources.push(...scriptSrc);

  const passiveSources: string[] = [];
  for (const directive of PASSIVE_DIRECTIVES) {
    passiveSources.push(
      ...(csp.get(directive) ?? csp.get('default-src') ?? new Set<string>()),
    );
  }

  // First matching check wins (each only fires while result is still null).
  let result: string | null = null;
  if (
    [...scriptSrc].some((s) => BROAD_AND_UNSAFE.has(s)) ||
    [...objectSrc].some((s) => DANGEROUSLY_BROAD.has(s))
  ) {
    result = 'csp-implemented-with-unsafe-inline';
  }
  if (
    result === null &&
    https &&
    activeSources.some((s) => s.startsWith('http:') || s.startsWith('ftp:'))
  ) {
    result = 'csp-implemented-with-insecure-scheme';
  }
  if (
    result === null &&
    new Set([...scriptSrc, ...styleSrc]).has("'unsafe-eval'")
  ) {
    result = 'csp-implemented-with-unsafe-eval';
  }
  if (
    result === null &&
    https &&
    passiveSources.some((s) => s.startsWith('http:') || s.startsWith('ftp:'))
  ) {
    result = 'csp-implemented-with-insecure-scheme-in-passive-content-only';
  }
  if (result === null && [...styleSrc].some((s) => BROAD_AND_UNSAFE.has(s))) {
    result = 'csp-implemented-with-unsafe-inline-in-style-src-only';
  }
  const defaultSrc = csp.get('default-src');
  if (result === null && defaultSrc?.has("'none'") && defaultSrc.size === 1) {
    result = 'csp-implemented-with-no-unsafe-default-src-none';
  } else if (result === null) {
    result = 'csp-implemented-with-no-unsafe';
  }
  return result;
}

// --- Referrer-Policy (analyzer/tests/referrer-policy.js) -------------------

function classifyReferrer(value: string | null): string {
  const goodness = new Set([
    'no-referrer',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
  ]);
  const badness = new Set([
    'origin',
    'origin-when-cross-origin',
    'unsafe-url',
    'no-referrer-when-downgrade',
  ]);
  const valid = new Set([...goodness, ...badness]);
  if (!value) return 'referrer-policy-not-implemented';
  // Last valid token wins.
  const policy =
    value
      .split(',')
      .map((e) => e.toLowerCase().trim())
      .filter((e) => valid.has(e))
      .toReversed()[0] ?? '';
  if (goodness.has(policy)) return 'referrer-policy-private';
  if (badness.has(policy)) return 'referrer-policy-unsafe';
  return 'referrer-policy-header-invalid';
}

// --- HSTS (analyzer/tests/strict-transport-security.js) --------------------

function classifyHsts(value: string | null, https: boolean): string {
  if (!https) return 'hsts-not-implemented-no-https';
  if (!value) return 'hsts-not-implemented';
  let maxAge: number | null = null;
  let preload = false;
  let includeSubDomains = false;
  for (const part of value.split(';').map((p) => p.trim().toLowerCase())) {
    if (part.startsWith('max-age=')) maxAge = parseInt(part.slice(8, 128), 10);
    else if (part === 'preload') preload = true;
    else if (part === 'includesubdomains') includeSubDomains = true;
  }
  if (maxAge === null || Number.isNaN(maxAge)) return 'hsts-header-invalid';
  if (maxAge < SIX_MONTHS)
    return 'hsts-implemented-max-age-less-than-six-months';
  if (preload && includeSubDomains) return 'hsts-preloaded';
  return 'hsts-implemented-max-age-at-least-six-months';
}

// --- X-Content-Type-Options (analyzer/tests/x-content-type-options.js) -----

function classifyXcto(value: string | null): string {
  if (!value) return 'x-content-type-options-not-implemented';
  return value.trim().toLowerCase() === 'nosniff'
    ? 'x-content-type-options-nosniff'
    : 'x-content-type-options-header-invalid';
}

// --- X-Frame-Options (analyzer/tests/x-frame-options.js) -------------------
// `frame-ancestors` in the CSP supersedes the header (and earns the bonus).

function classifyXfo(value: string | null, csp: Csp | null): string {
  let result: string;
  if (value) {
    const xfo = value.trim().toLowerCase();
    if (['deny', 'sameorigin'].includes(xfo)) {
      result = 'x-frame-options-sameorigin-or-deny';
    } else if (xfo.startsWith('allow-from')) {
      result = 'x-frame-options-allow-from-origin';
    } else {
      result = 'x-frame-options-header-invalid';
    }
  } else {
    result = 'x-frame-options-not-implemented';
  }
  if (csp?.has('frame-ancestors'))
    result = 'x-frame-options-implemented-via-csp';
  return result;
}

// --- Cross-Origin-Resource-Policy (analyzer/tests/cross-origin-resource-policy.js)

function classifyCorp(value: string | null): string {
  if (!value) return 'cross-origin-resource-policy-not-implemented';
  const v = value.trim().toLowerCase();
  if (v === 'same-site')
    return 'cross-origin-resource-policy-implemented-with-same-site';
  if (v === 'same-origin')
    return 'cross-origin-resource-policy-implemented-with-same-origin';
  if (v === 'cross-origin')
    return 'cross-origin-resource-policy-implemented-with-cross-origin';
  return 'cross-origin-resource-policy-header-invalid';
}

// --- CORS (Access-Control-Allow-Origin) ------------------------------------
// Only the wildcard / specific-origin cases an in-process response can show.

function classifyCors(acao: string | null): string {
  if (!acao) return 'cross-origin-resource-sharing-not-implemented';
  if (acao.trim() === '*') {
    return 'cross-origin-resource-sharing-implemented-with-public-access';
  }
  return 'cross-origin-resource-sharing-implemented-with-restricted-access';
}

// --- Cookies (analyzer/tests/cookies.js) -----------------------------------

function onlyIfWorse(
  next: string,
  current: string | null,
  order: string[],
): string {
  if (!current) return next;
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

interface ParsedCookie {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
}

function parseSetCookie(raw: string): ParsedCookie {
  const parts = raw.split(';').map((p) => p.trim());
  const name = parts[0]?.split('=')[0]?.trim() ?? '';
  let secure = false;
  let httpOnly = false;
  let sameSite: string | null = null;
  for (const attr of parts.slice(1)) {
    const [k, v] = attr.split('=');
    const key = k?.trim().toLowerCase();
    if (key === 'secure') secure = true;
    else if (key === 'httponly') httpOnly = true;
    else if (key === 'samesite') sameSite = v?.trim() ?? '';
  }
  return { name, secure, httpOnly, sameSite };
}

function containsInvalidSameSite(raw: string): boolean {
  for (const p of raw.split(';')) {
    const [k, v] = p.trim().split('=');
    if (k && k.trim().toLowerCase() === 'samesite') {
      if (!v) return true;
      if (!['lax', 'strict', 'none'].includes(v.trim().toLowerCase()))
        return true;
    }
  }
  return false;
}

function classifyCookies(setCookies: string[], hstsPass: boolean): string {
  const order = [
    'cookies-without-secure-flag-but-protected-by-hsts',
    'cookies-without-secure-flag',
    'cookies-session-without-secure-flag-but-protected-by-hsts',
    'cookies-samesite-flag-invalid',
    'cookies-anticsrf-without-samesite-flag',
    'cookies-session-without-httponly-flag',
    'cookies-session-without-secure-flag',
  ];
  let result: string | null = null;
  const worse = (candidate: string) => {
    result = onlyIfWorse(candidate, result, order);
  };

  for (const raw of setCookies) {
    if (containsInvalidSameSite(raw)) worse('cookies-samesite-flag-invalid');
  }

  if (setCookies.length === 0) return 'cookies-not-found';

  let hasMissingSameSite = false;
  for (const cookie of setCookies.map(parseSetCookie)) {
    const name = cookie.name.toLowerCase();
    const sessionId = ['login', 'sess'].some((i) => name.includes(i));
    const anticsrf = name.includes('csrf');

    if (!cookie.secure && cookie.sameSite?.toLowerCase() === 'none') {
      worse('cookies-samesite-flag-invalid');
    }
    if (!cookie.secure && hstsPass) {
      worse('cookies-without-secure-flag-but-protected-by-hsts');
    } else if (!cookie.secure) {
      worse('cookies-without-secure-flag');
    }
    if (anticsrf && !cookie.sameSite) {
      worse('cookies-anticsrf-without-samesite-flag');
    }
    if (sessionId && !cookie.secure && hstsPass) {
      worse('cookies-session-without-secure-flag-but-protected-by-hsts');
    } else if (sessionId && !cookie.secure) {
      worse('cookies-session-without-secure-flag');
    }
    if (sessionId && !cookie.httpOnly) {
      worse('cookies-session-without-httponly-flag');
    }
    if (!cookie.sameSite && !hasMissingSameSite) hasMissingSameSite = true;
  }

  if (!result) {
    return hasMissingSameSite
      ? 'cookies-secure-with-httponly-sessions'
      : 'cookies-secure-with-httponly-sessions-and-samesite';
  }
  return result;
}

// --- Aggregate scorer (scanner/index.js summation + bonus gating) ----------

interface ObservatoryResult {
  score: number;
  grade: string;
  results: Record<string, { result: string; modifier: number }>;
}

function modifierFor(result: string): { result: string; modifier: number } {
  return { result, modifier: MODIFIERS[result] ?? 0 };
}

function getSetCookies(headers: Headers): string[] {
  const getter = (headers as { getSetCookie?: () => string[] }).getSetCookie;
  return typeof getter === 'function' ? getter.call(headers) : [];
}

/**
 * Compute the MDN HTTP Observatory grade from the response headers, for the
 * header-derived tests. SRI and redirection are out of band (see file header)
 * and score 0, so they do not affect the result.
 */
function computeObservatoryGrade(
  headers: Headers,
  opts: { https: boolean },
): ObservatoryResult {
  const cspHeader = headers.get('content-security-policy');
  const csp = cspHeader ? parseCsp(cspHeader) : null;
  const hsts = classifyHsts(
    headers.get('strict-transport-security'),
    opts.https,
  );
  const hstsPass =
    hsts === 'hsts-implemented-max-age-at-least-six-months' ||
    hsts === 'hsts-preloaded';

  const results: Record<string, { result: string; modifier: number }> = {
    csp: modifierFor(
      csp ? classifyCsp(csp, opts.https) : 'csp-not-implemented',
    ),
    'strict-transport-security': modifierFor(hsts),
    'referrer-policy': modifierFor(
      classifyReferrer(headers.get('referrer-policy')),
    ),
    'x-content-type-options': modifierFor(
      classifyXcto(headers.get('x-content-type-options')),
    ),
    'x-frame-options': modifierFor(
      classifyXfo(headers.get('x-frame-options'), csp),
    ),
    'cross-origin-resource-policy': modifierFor(
      classifyCorp(headers.get('cross-origin-resource-policy')),
    ),
    cookies: modifierFor(classifyCookies(getSetCookies(headers), hstsPass)),
    cors: modifierFor(classifyCors(headers.get('access-control-allow-origin'))),
  };

  let withBonus = 100;
  let uncurved = 100;
  for (const { modifier } of Object.values(results)) {
    withBonus += modifier;
    if (modifier < 0) uncurved += modifier;
  }
  // Bonuses only count if the uncurved score already earns an A.
  const rawScore =
    uncurved >= MINIMUM_SCORE_FOR_EXTRA_CREDIT ? withBonus : uncurved;
  return { ...getGradeForScore(rawScore), results };
}

describe('Mozilla Observatory grade (issue #1925)', () => {
  test('createApp() security headers grade A+ with no penalties', async () => {
    // Grade the headers this code composes, not whatever object storage the
    // machine running the suite happens to have configured: `createApp`'s
    // default origins provider SCANS the ambient config tree, so a developer
    // (or a seeded dev stack, now that the stack ships one) with a store on
    // `http://…` adds an insecure-scheme source to the CSP and fails the
    // grade on their disk alone. The per-org origin lanes are covered by
    // org-storage-origins.test.ts.
    const app = createApp(baseEnv, { orgStorageOrigins: () => [] });
    // Every route carries the same `secureHeaders` set via `app.use('*')`;
    // `/api/health` is used because it needs no dist/index.html.
    const res = await app.fetch(new Request('http://localhost/api/health'));

    const { score, grade, results } = computeObservatoryGrade(res.headers, {
      https: true,
    });

    // Recorded Observatory result for #1925.
    expect(grade).toBe('A+');
    expect(score).toBeGreaterThanOrEqual(100);

    // The strongest regression guard: weakening ANY header surfaces a negative
    // modifier, which drops the grade below A+ (bonuses are then withheld).
    const penalties = Object.entries(results)
      .filter(([, r]) => r.modifier < 0)
      .map(([name]) => name);
    expect(penalties).toEqual([]);

    // Pin the exact result codes that produce the grade.
    expect(results.csp.result).toBe(
      'csp-implemented-with-unsafe-inline-in-style-src-only',
    );
    expect(results['strict-transport-security'].result).toBe(
      'hsts-implemented-max-age-at-least-six-months',
    );
    expect(results['referrer-policy'].result).toBe('referrer-policy-private');
    expect(results['x-frame-options'].result).toBe(
      'x-frame-options-implemented-via-csp',
    );
    expect(results['x-content-type-options'].result).toBe(
      'x-content-type-options-nosniff',
    );
    expect(results.cookies.result).toBe('cookies-not-found');
  });

  test('a deliberately weakened header set drops below A+', () => {
    // Short HSTS (-10) + no X-Frame-Options and no CSP frame-ancestors (-20)
    // → uncurved 70 (< 90) → bonuses withheld → grade B.
    const headers = new Headers({
      'content-security-policy':
        "default-src 'self'; script-src 'nonce-x' 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'",
      'strict-transport-security': 'max-age=100',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    });
    const { grade, score } = computeObservatoryGrade(headers, { https: true });
    expect(grade).not.toBe('A+');
    expect(score).toBeLessThan(100);
  });
});

describe('Observatory scorer — classifier self-tests', () => {
  test('grade boundaries (grader/grader.js)', () => {
    expect(getGradeForScore(110).grade).toBe('A+');
    expect(getGradeForScore(100).grade).toBe('A+');
    expect(getGradeForScore(95).grade).toBe('A');
    expect(getGradeForScore(90).grade).toBe('A');
    expect(getGradeForScore(70).grade).toBe('B');
    expect(getGradeForScore(0).grade).toBe('F');
  });

  test('CSP classification', () => {
    expect(
      classifyCsp(
        parseCsp("default-src 'self'; script-src 'self' 'unsafe-inline'"),
        true,
      ),
    ).toBe('csp-implemented-with-unsafe-inline');
    expect(
      classifyCsp(
        parseCsp("default-src 'self'; script-src 'self' 'unsafe-eval'"),
        true,
      ),
    ).toBe('csp-implemented-with-unsafe-eval');
    // Tale's shape: nonce'd script-src, 'unsafe-inline' only in style-src.
    expect(
      classifyCsp(
        parseCsp(
          "default-src 'self'; script-src 'nonce-abc' 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'",
        ),
        true,
      ),
    ).toBe('csp-implemented-with-unsafe-inline-in-style-src-only');
    expect(
      classifyCsp(parseCsp("default-src 'none'; script-src 'self'"), true),
    ).toBe('csp-implemented-with-no-unsafe-default-src-none');
    expect(
      classifyCsp(
        parseCsp("default-src 'self'; script-src 'self'; style-src 'self'"),
        true,
      ),
    ).toBe('csp-implemented-with-no-unsafe');
    // 'unsafe-inline' neutralized by a nonce in the same directive.
    expect(
      classifyCsp(
        parseCsp(
          "default-src 'self'; script-src 'nonce-abc' 'unsafe-inline'; style-src 'self'",
        ),
        true,
      ),
    ).toBe('csp-implemented-with-no-unsafe');
    // https origin must reject an http: source in active content.
    expect(
      classifyCsp(
        parseCsp("default-src 'self'; script-src 'self' http://evil.example"),
        true,
      ),
    ).toBe('csp-implemented-with-insecure-scheme');
  });

  test('HSTS six-month threshold (== 15552000 passes)', () => {
    expect(classifyHsts('max-age=15552000', true)).toBe(
      'hsts-implemented-max-age-at-least-six-months',
    );
    expect(classifyHsts('max-age=15551999', true)).toBe(
      'hsts-implemented-max-age-less-than-six-months',
    );
    expect(classifyHsts(null, true)).toBe('hsts-not-implemented');
    expect(classifyHsts('max-age=15552000', false)).toBe(
      'hsts-not-implemented-no-https',
    );
  });

  test('Referrer-Policy private vs unsafe', () => {
    expect(classifyReferrer('strict-origin-when-cross-origin')).toBe(
      'referrer-policy-private',
    );
    expect(classifyReferrer('unsafe-url')).toBe('referrer-policy-unsafe');
    expect(classifyReferrer(null)).toBe('referrer-policy-not-implemented');
  });

  test('X-Content-Type-Options', () => {
    expect(classifyXcto('nosniff')).toBe('x-content-type-options-nosniff');
    expect(classifyXcto(null)).toBe('x-content-type-options-not-implemented');
    expect(classifyXcto('sniff')).toBe('x-content-type-options-header-invalid');
  });

  test('X-Frame-Options (CSP frame-ancestors supersedes)', () => {
    expect(classifyXfo('DENY', null)).toBe(
      'x-frame-options-sameorigin-or-deny',
    );
    expect(classifyXfo(null, null)).toBe('x-frame-options-not-implemented');
    expect(classifyXfo('DENY', parseCsp("frame-ancestors 'none'"))).toBe(
      'x-frame-options-implemented-via-csp',
    );
  });

  test('Cross-Origin-Resource-Policy', () => {
    expect(classifyCorp(null)).toBe(
      'cross-origin-resource-policy-not-implemented',
    );
    expect(classifyCorp('same-origin')).toBe(
      'cross-origin-resource-policy-implemented-with-same-origin',
    );
  });

  test('Cookies — session-cookie flag requirements', () => {
    expect(classifyCookies([], true)).toBe('cookies-not-found');
    // Fully-flagged session cookie (the SSO/trusted-header path's shape).
    expect(
      classifyCookies(
        [
          '__Secure-better-auth.session_token=x; Path=/; HttpOnly; SameSite=Lax; Secure',
        ],
        true,
      ),
    ).toBe('cookies-secure-with-httponly-sessions-and-samesite');
    // Missing HttpOnly on a session cookie is the harshest cookie penalty.
    expect(
      classifyCookies(
        ['better-auth.session_token=x; Path=/; SameSite=Lax; Secure'],
        true,
      ),
    ).toBe('cookies-session-without-httponly-flag');
  });
});
