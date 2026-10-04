import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type { Page } from '../../../packages/e2e/src/index.ts';
import { phaseTimeout } from './common.ts';

type Response = Awaited<ReturnType<Page['waitForResponse']>>;
type Request = ReturnType<Response['request']>;
export type FontRequest = Pick<
  Request,
  'url' | 'resourceType' | 'timing' | 'failure'
>;
export type FontResponse = Pick<
  Response,
  'url' | 'status' | 'headers' | 'body'
> & {
  request(): FontRequest;
};
export const fontEvidenceLimits = Object.freeze({
  entries: 256,
  bodyBytes: 2 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  timeoutMs: 5000,
});

export interface FontFaceEvidence {
  family: string;
  style: string;
  weight: string;
  stretch: string;
  unicodeRange: string;
  display: string;
  status: string;
  ascentOverride: string | null;
  descentOverride: string | null;
  lineGapOverride: string | null;
  sizeAdjust: string | null;
  featureSettings: string | null;
  variationSettings: string | null;
  variant: string | null;
}
export interface FontPageEvidence {
  capturedAt: number;
  timeOrigin: number;
  performanceNow: number;
  ready: boolean;
  faces: FontFaceEvidence[];
  rules: {
    href: string | null;
    family: string;
    style: string;
    weight: string;
    unicodeRange: string;
    src: string;
    stretch: string;
    display: string;
    ascentOverride: string;
    descentOverride: string;
    lineGapOverride: string;
    sizeAdjust: string;
    featureSettings: string;
    variationSettings: string;
    variant: string;
  }[];
  errors: string[];
  overflow: boolean;
}
interface ResponseEvidence {
  url: string;
  status: number;
  contentType: string;
  observedAt: number;
  observedMonotonic: number;
  timing: ReturnType<Request['timing']>;
  bytes?: number;
  sha256?: string;
  error?: string;
}
interface FailedRequestEvidence {
  url: string;
  observedAt: number;
  observedMonotonic: number;
  timing: ReturnType<Request['timing']>;
  error: string;
}
export interface FontEvidence extends FontPageEvidence {
  complete: boolean;
  responses: ResponseEvidence[];
  failedRequests: FailedRequestEvidence[];
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      ? `${url.origin}${url.pathname}`
      : `[${url.protocol} URL omitted]`;
  } catch {
    return '[invalid URL]';
  }
}
function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/[^\s"'<>]+/g, safeUrl)
    .slice(0, 1024);
}

/** Standalone: Playwright serializes this function, so dependencies stay inside. */
export async function snapshotFonts(
  timeoutMs: number,
): Promise<FontPageEvidence> {
  const result: FontPageEvidence = {
    capturedAt: Date.now(),
    timeOrigin: performance.timeOrigin,
    performanceNow: performance.now(),
    ready: false,
    faces: [],
    rules: [],
    errors: [],
    overflow: false,
  };
  const error = (message: string) => {
    if (result.errors.length < 32) result.errors.push(message.slice(0, 1024));
    else result.overflow = true;
  };
  const bounded = (value: string) => {
    if (value.length > 2048) result.overflow = true;
    return value.slice(0, 2048);
  };
  const url = (value: string, base = location.href) => {
    try {
      const parsed = new URL(value, base);
      return ['http:', 'https:'].includes(parsed.protocol)
        ? bounded(`${parsed.origin}${parsed.pathname}`)
        : `[${parsed.protocol} URL omitted]`;
    } catch {
      return '[invalid URL]';
    }
  };
  const safe = (value: unknown) =>
    bounded(
      String(value).replace(/https?:\/\/[^\s"'<>]+/g, (match) => url(match)),
    );
  const faces = () => {
    result.faces = [];
    for (const face of document.fonts) {
      if (result.faces.length >= 512) {
        result.overflow = true;
        break;
      }
      const descriptor = (name: string) => {
        const value = (face as unknown as Record<string, unknown>)[name];
        return typeof value === 'string' ? bounded(value) : null;
      };
      result.faces.push({
        family: bounded(face.family),
        style: bounded(face.style),
        weight: bounded(face.weight),
        stretch: bounded(face.stretch),
        unicodeRange: bounded(face.unicodeRange),
        display: bounded(face.display),
        status: face.status,
        ascentOverride: descriptor('ascentOverride'),
        descentOverride: descriptor('descentOverride'),
        lineGapOverride: descriptor('lineGapOverride'),
        sizeAdjust: descriptor('sizeAdjust'),
        featureSettings: descriptor('featureSettings'),
        variationSettings: descriptor('variationSettings'),
        variant: descriptor('variant'),
      });
    }
  };
  // Capture identities first, even when readiness later times out.
  try {
    faces();
  } catch (cause) {
    error(`FontFace inventory: ${safe(cause)}`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Font readiness timed out')),
          Math.max(1, timeoutMs),
        );
      }),
    ]);
    result.ready = true;
    faces();
  } catch (cause) {
    error(`Font readiness: ${safe(cause)}`);
  } finally {
    clearTimeout(timer);
  }
  let visitedRules = 0;
  const visited = new Set<CSSStyleSheet>();
  const sheet = (value: CSSStyleSheet, depth: number) => {
    if (visited.has(value)) return;
    if (visited.size >= 64 || depth > 16) {
      result.overflow = true;
      return;
    }
    visited.add(value);
    const href = value.href ? url(value.href) : null;
    try {
      if (
        value.href &&
        new URL(value.href, location.href).origin !== location.origin
      ) {
        error(`Cross-origin CSSOM not inspected: ${href}`);
        return;
      }
      rules(value.cssRules, href, depth);
    } catch (cause) {
      error(`CSSOM ${href ?? 'inline'}: ${safe(cause)}`);
    }
  };
  const rules = (values: CSSRuleList, href: string | null, depth: number) => {
    if (depth > 16) {
      result.overflow = true;
      return;
    }
    for (const rule of values) {
      visitedRules += 1;
      if (visitedRules > 8192 || result.rules.length >= 512) {
        result.overflow = true;
        return;
      }
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const style = (rule as CSSFontFaceRule).style;
        // Normalize URL tokens only; local() names remain the original declaration.
        const src = style
          .getPropertyValue('src')
          .replace(
            /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
            (
              _match,
              double: string | undefined,
              single: string | undefined,
              bare: string | undefined,
            ) =>
              `url("${url(double ?? single ?? bare?.trim() ?? '', href ?? location.href)}")`,
          );
        result.rules.push({
          href,
          family: bounded(style.getPropertyValue('font-family')),
          style: bounded(style.getPropertyValue('font-style')),
          weight: bounded(style.getPropertyValue('font-weight')),
          unicodeRange: bounded(style.getPropertyValue('unicode-range')),
          src: bounded(src),
          stretch: bounded(style.getPropertyValue('font-stretch')),
          display: bounded(style.getPropertyValue('font-display')),
          ascentOverride: bounded(style.getPropertyValue('ascent-override')),
          descentOverride: bounded(style.getPropertyValue('descent-override')),
          lineGapOverride: bounded(style.getPropertyValue('line-gap-override')),
          sizeAdjust: bounded(style.getPropertyValue('size-adjust')),
          featureSettings: bounded(
            style.getPropertyValue('font-feature-settings'),
          ),
          variationSettings: bounded(
            style.getPropertyValue('font-variation-settings'),
          ),
          variant: bounded(style.getPropertyValue('font-variant')),
        });
      } else if (rule.type === CSSRule.IMPORT_RULE) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) sheet(imported, depth + 1);
      } else if ('cssRules' in rule)
        rules((rule as CSSGroupingRule).cssRules, href, depth + 1);
    }
  };
  try {
    let count = 0;
    for (const value of document.styleSheets) {
      count += 1;
      if (count > 64) {
        result.overflow = true;
        break;
      }
      sheet(value, 0);
    }
  } catch (cause) {
    error(`Stylesheet inventory: ${safe(cause)}`);
  }
  result.capturedAt = Date.now();
  result.performanceNow = performance.now();
  return result;
}

/** Event callbacks retain metadata/references only. Call collect after action+heap. */
export function createFontEvidence(options: { timeoutMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? fontEvidenceLimits.timeoutMs;
  assert(
    Number.isFinite(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= fontEvidenceLimits.timeoutMs,
    'Font evidence timeout may only tighten',
  );
  const entries: {
    response: FontResponse;
    metadata: ResponseEvidence;
    body?: Promise<Pick<ResponseEvidence, 'bytes' | 'sha256' | 'error'>>;
  }[] = [];
  const failures: FailedRequestEvidence[] = [];
  const seen = new WeakSet<object>();
  const errors: string[] = [];
  let overflow = false;
  let bodyBytes = 0;
  let active: Promise<FontEvidence> | undefined;
  const boundedText = (value: string, limit: number) => {
    if (value.length > limit) overflow = true;
    return value.slice(0, limit);
  };
  const addError = (cause: unknown) => {
    if (errors.length < 32) errors.push(safeError(cause));
    else overflow = true;
  };
  const reserve = (value: object) => {
    if (seen.has(value)) return false;
    if (entries.length + failures.length >= fontEvidenceLimits.entries) {
      overflow = true;
      return false;
    }
    seen.add(value);
    return true;
  };
  async function collect(page: Pick<Page, 'evaluate'>): Promise<FontEvidence> {
    const started = performance.now();
    let budget = timeoutMs;
    let expired = false;
    const result: FontEvidence = {
      capturedAt: Date.now(),
      timeOrigin: 0,
      performanceNow: 0,
      ready: false,
      faces: [],
      rules: [],
      errors: [],
      overflow,
      complete: false,
      responses: [],
      failedRequests: [],
    };
    const bounded = async <T>(operation: () => Promise<T>) => {
      const remaining = budget - (performance.now() - started);
      if (expired || remaining <= 0)
        throw new Error('Font evidence collection deadline expired');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              reject(new Error('Font evidence collection timed out'));
            }, remaining);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      budget = phaseTimeout(timeoutMs);
    } catch (cause) {
      result.errors.push(safeError(cause));
      budget = 0;
    }
    try {
      const snapshot = await bounded(() =>
        page.evaluate(
          snapshotFonts,
          Math.max(1, budget - (performance.now() - started) - 100),
        ),
      );
      Object.assign(result, snapshot);
    } catch (cause) {
      result.errors.push(`Font snapshot: ${safeError(cause)}`);
    }
    // Snapshot the entry list: later responses belong to the next checkpoint.
    for (const entry of entries.slice()) {
      const metadata = { ...entry.metadata };
      try {
        metadata.timing = entry.response.request().timing();
        const body = await bounded(() => {
          entry.body ??= (async () => {
            const length = entry.response.headers()['content-length'];
            if (
              length !== undefined &&
              /^\d+$/.test(length) &&
              (Number(length) > fontEvidenceLimits.bodyBytes ||
                bodyBytes + Number(length) > fontEvidenceLimits.totalBytes)
            )
              throw new Error('Announced font body exceeds evidence byte cap');
            if (bodyBytes >= fontEvidenceLimits.totalBytes)
              throw new Error('Total font body evidence byte cap reached');
            const bytes = await entry.response.body();
            // Playwright returns an entire response; an unannounced overrun is
            // detected here before hashing/retention, not stream-limited.
            if (
              bytes.length > fontEvidenceLimits.bodyBytes ||
              bodyBytes + bytes.length > fontEvidenceLimits.totalBytes
            )
              throw new Error('Received font body exceeds evidence byte cap');
            bodyBytes += bytes.length;
            return {
              bytes: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            };
          })().catch((cause: unknown) => ({ error: safeError(cause) }));
          return entry.body;
        });
        Object.assign(metadata, body);
        metadata.timing = entry.response.request().timing();
      } catch (cause) {
        metadata.error = safeError(cause);
      }
      if (metadata.error)
        result.errors.push(`Font response ${metadata.url}: ${metadata.error}`);
      result.responses.push(metadata);
    }
    result.failedRequests = structuredClone(failures);
    result.errors.push(...errors);
    result.overflow ||= overflow;
    result.complete =
      result.ready && !result.overflow && result.errors.length === 0;
    return result;
  }
  return {
    response(response: FontResponse) {
      try {
        const request = response.request();
        if (request.resourceType() !== 'font' || !reserve(response)) return;
        entries.push({
          response,
          metadata: {
            url: boundedText(safeUrl(response.url()), 2048),
            status: response.status(),
            contentType: boundedText(
              response.headers()['content-type'] ?? '',
              256,
            ),
            observedAt: Date.now(),
            observedMonotonic: performance.now(),
            timing: request.timing(),
          },
        });
      } catch (cause) {
        addError(cause);
      }
    },
    requestFailed(request: FontRequest) {
      try {
        if (request.resourceType() !== 'font' || !reserve(request)) return;
        failures.push({
          url: boundedText(safeUrl(request.url()), 2048),
          observedAt: Date.now(),
          observedMonotonic: performance.now(),
          timing: request.timing(),
          error: safeError(
            request.failure()?.errorText ?? 'Unknown font request failure',
          ),
        });
      } catch (cause) {
        addError(cause);
      }
    },
    collect(page: Pick<Page, 'evaluate'>) {
      active ??= collect(page).finally(() => {
        active = undefined;
      });
      return active;
    },
  };
}
