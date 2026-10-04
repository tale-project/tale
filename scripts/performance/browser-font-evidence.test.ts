import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

import type { Page } from '../../packages/e2e/src/index.ts';
import {
  createFontEvidence,
  fontEvidenceLimits,
  snapshotFonts,
  type FontPageEvidence,
  type FontRequest,
  type FontResponse,
} from './browser/font-evidence.ts';

const timing = {
  startTime: 1700000000000,
  domainLookupStart: -1,
  domainLookupEnd: -1,
  connectStart: -1,
  secureConnectionStart: -1,
  connectEnd: -1,
  requestStart: 1,
  responseStart: 2,
  responseEnd: 3,
};
function request(resourceType = 'font'): FontRequest {
  return {
    url: () =>
      'https://user:password@fixture.test/assets/font.woff2?token=hidden#fragment',
    resourceType: () => resourceType,
    timing: () => ({ ...timing }),
    failure: () => ({ errorText: 'net::ERR_FAILED' }),
  };
}
function response(
  bytes = Buffer.from('received font bytes'),
  headers: Record<string, string> = {},
): FontResponse & { bodyCalls: number } {
  const value = {
    bodyCalls: 0,
    request: () => request(),
    url: request().url,
    status: () => 200,
    headers: () => ({ 'content-type': 'font/woff2', ...headers }),
    body: async () => {
      value.bodyCalls += 1;
      return bytes;
    },
  };
  return value;
}
function snapshot(): FontPageEvidence {
  return {
    capturedAt: 1700000000100,
    timeOrigin: 1700000000000,
    performanceNow: 100,
    ready: true,
    faces: [
      {
        family: 'Inter Fallback',
        style: 'normal',
        weight: '400',
        stretch: 'normal',
        unicodeRange: 'U+0-10FFFF',
        display: 'auto',
        status: 'error',
      },
    ],
    rules: [],
    errors: [],
    overflow: false,
  };
}
function page(
  value: FontPageEvidence | Error | Promise<FontPageEvidence> = snapshot(),
): Pick<Page, 'evaluate'> {
  return {
    evaluate: async () => {
      if (value instanceof Error) throw value;
      return await value;
    },
  } as Pick<Page, 'evaluate'>;
}
function serializedSnapshot(
  options: {
    ready?: Promise<unknown>;
    faces?: unknown[];
    sheets?: unknown[];
  } = {},
) {
  const faces = options.faces ?? snapshot().faces;
  const fonts = Object.assign(new Set(faces), {
    ready: options.ready ?? Promise.resolve(),
  });
  return runInNewContext(`(${snapshotFonts.toString()})(5)`, {
    document: { fonts, styleSheets: options.sheets ?? [] },
    location: {
      href: 'https://fixture.test/project/board',
      origin: 'https://fixture.test',
    },
    CSSRule: { FONT_FACE_RULE: 5, IMPORT_RULE: 3 },
    URL,
    performance,
    setTimeout,
    clearTimeout,
  }) as Promise<FontPageEvidence>;
}
function rule(src: string) {
  return {
    type: 5,
    style: {
      getPropertyValue: (name: string) =>
        ({
          src,
          'font-family': 'Inter',
          'font-style': 'normal',
          'font-weight': '400',
          'unicode-range': 'U+0-FF',
        })[name] ?? '',
    },
  };
}

describe('passive font evidence', () => {
  test('callbacks never read bodies and ignore non-font traffic', async () => {
    const collector = createFontEvidence();
    const font = response();
    const script = response();
    script.request = () => request('script');
    collector.response(font);
    collector.response(script);
    collector.requestFailed(request('image'));
    expect(font.bodyCalls).toBe(0);
    expect(script.bodyCalls).toBe(0);
    const result = await collector.collect(page());
    expect(font.bodyCalls).toBe(1);
    expect(script.bodyCalls).toBe(0);
    expect(result.responses).toHaveLength(1);
    expect(result.failedRequests).toHaveLength(0);
    // Complete evidence does not waive an errored face; assertion policy is caller-owned.
    expect(result.complete).toBe(true);
    expect(result.faces[0]?.status).toBe('error');
  });

  test('strips URL credentials/query/fragment and preserves actual status/hash/timing', async () => {
    const collector = createFontEvidence();
    const font = response();
    font.status = () => 404;
    collector.response(font);
    const result = await collector.collect(page());
    expect(result.responses[0]).toMatchObject({
      url: 'https://fixture.test/assets/font.woff2',
      status: 404,
      contentType: 'font/woff2',
      timing,
      bytes: 19,
      sha256: createHash('sha256').update('received font bytes').digest('hex'),
    });
    expect(result.responses[0]?.observedAt).toBeGreaterThan(0);
    expect(result.responses[0]?.observedMonotonic).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(
      /password|token|hidden|fragment/,
    );
  });

  test('refreshes completion timing after observation and caches body hashes', async () => {
    const collector = createFontEvidence();
    const font = response();
    let responseEnd = -1;
    font.request = () => ({
      ...request(),
      timing: () => ({ ...timing, responseEnd }),
    });
    collector.response(font);
    collector.response(font);
    responseEnd = 42;
    const first = await collector.collect(page());
    expect(first.responses[0]?.timing.responseEnd).toBe(42);
    responseEnd = 43;
    const second = await collector.collect(page());
    expect(second.responses[0]?.timing.responseEnd).toBe(43);
    expect(first.responses[0]?.timing.responseEnd).toBe(42);
    expect(first.responses).toHaveLength(1);
    expect(font.bodyCalls).toBe(1);
  });

  test('retains failures and returns partial evidence on body/DOM errors', async () => {
    const collector = createFontEvidence();
    const font = response();
    font.body = async () => {
      throw new Error(
        'Body missing https://u:secret@fixture.test/font?key=private',
      );
    };
    collector.response(font);
    collector.requestFailed(request());
    const result = await collector.collect(page(new Error('Page closed')));
    expect(result.complete).toBe(false);
    expect(result.responses[0]?.status).toBe(200);
    expect(result.responses[0]?.error).toBe(
      'Body missing https://fixture.test/font',
    );
    expect(result.failedRequests[0]).toMatchObject({
      url: 'https://fixture.test/assets/font.woff2',
      timing,
      error: 'net::ERR_FAILED',
    });
    expect(result.errors.some((error) => error.includes('Page closed'))).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toMatch(/secret|private/);
  });

  test('refuses announced oversized bodies without calling body()', async () => {
    const collector = createFontEvidence();
    const font = response(Buffer.alloc(0), {
      'content-length': String(fontEvidenceLimits.bodyBytes + 1),
    });
    collector.response(font);
    const result = await collector.collect(page());
    expect(font.bodyCalls).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.responses[0]?.error).toContain('Announced');
  });

  test('rejects unannounced oversized bodies before hashing', async () => {
    const collector = createFontEvidence();
    const font = response(Buffer.alloc(fontEvidenceLimits.bodyBytes + 1));
    collector.response(font);
    const result = await collector.collect(page());
    expect(font.bodyCalls).toBe(1);
    expect(result.responses[0]?.sha256).toBeUndefined();
    expect(result.responses[0]?.error).toContain('Received');
    expect(result.complete).toBe(false);
  });

  test('enforces aggregate byte cap without recharging cached bodies', async () => {
    const collector = createFontEvidence();
    const fonts = Array.from({ length: 5 }, () =>
      response(Buffer.alloc(fontEvidenceLimits.bodyBytes)),
    );
    for (const font of fonts) collector.response(font);
    const first = await collector.collect(page());
    const second = await collector.collect(page());
    expect(fonts.map((font) => font.bodyCalls)).toEqual([1, 1, 1, 1, 0]);
    expect(first.responses.filter((row) => row.sha256)).toHaveLength(4);
    expect(second.responses.filter((row) => row.sha256)).toHaveLength(4);
    expect(second.complete).toBe(false);
  });

  test('caps combined response/failure refs and retains overflow', async () => {
    const collector = createFontEvidence();
    for (let index = 0; index < fontEvidenceLimits.entries; index += 1)
      collector.requestFailed(request());
    const font = response();
    collector.response(font);
    const result = await collector.collect(page());
    expect(result.failedRequests).toHaveLength(fontEvidenceLimits.entries);
    expect(result.responses).toHaveLength(0);
    expect(font.bodyCalls).toBe(0);
    expect(result.overflow).toBe(true);
    expect(result.complete).toBe(false);
  });

  test('uses one total deadline and shares concurrent collection', async () => {
    const collector = createFontEvidence({ timeoutMs: 15 });
    const never = new Promise<FontPageEvidence>(() => {});
    const font = response();
    collector.response(font);
    const first = collector.collect(page(never));
    expect(collector.collect(page())).toBe(first);
    const result = await first;
    expect(result.complete).toBe(false);
    expect(result.responses).toHaveLength(1);
    expect(result.errors.some((error) => error.includes('timed out'))).toBe(
      true,
    );
    expect(font.bodyCalls).toBe(0);
  });

  test('retains face identities if a body stalls and rejects invalid budgets', async () => {
    for (const timeoutMs of [0, -1, Infinity, NaN, 5001])
      expect(() => createFontEvidence({ timeoutMs })).toThrow();
    const collector = createFontEvidence({ timeoutMs: 10 });
    const font = response();
    font.body = () => new Promise(() => {});
    collector.response(font);
    const result = await collector.collect(page());
    expect(result.faces[0]?.family).toBe('Inter Fallback');
    expect(result.complete).toBe(false);
    expect(result.responses[0]?.error).toContain('timed out');
  });

  test('oversized metadata is bounded and marks evidence incomplete', async () => {
    const collector = createFontEvidence();
    const font = response();
    font.url = () => `https://fixture.test/${'a'.repeat(3000)}?secret=hidden`;
    font.headers = () => ({ 'content-type': 'a'.repeat(300) });
    collector.response(font);
    const result = await collector.collect(page());
    expect(result.responses[0]?.url).toHaveLength(2048);
    expect(result.responses[0]?.contentType).toHaveLength(256);
    expect(result.overflow).toBe(true);
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  test('callback exceptions are retained and never escape event handlers', async () => {
    const collector = createFontEvidence();
    const font = response();
    font.headers = () => {
      throw new Error('Protocol closed');
    };
    expect(() => collector.response(font)).not.toThrow();
    const result = await collector.collect(page());
    expect(result.errors).toContain('Protocol closed');
    expect(result.complete).toBe(false);
  });
});

describe('serialized FontFace and CSSOM snapshot', () => {
  test('has no module closure and preserves failed face identity after readiness', async () => {
    const result = await serializedSnapshot();
    expect(result.ready).toBe(true);
    expect(result.faces).toEqual(snapshot().faces);
    expect(result.errors).toEqual([]);
    expect(result.capturedAt).toBeGreaterThan(0);
    expect(result.performanceNow).toBeGreaterThan(0);
  });

  test('retains identities when fonts.ready never settles', async () => {
    const result = await serializedSnapshot({ ready: new Promise(() => {}) });
    expect(result.ready).toBe(false);
    expect(result.faces[0]?.family).toBe('Inter Fallback');
    expect(result.errors[0]).toContain('Font readiness timed out');
  });

  test('resolves relative sources against sheet URL and strips sensitive URL parts', async () => {
    const result = await serializedSnapshot({
      sheets: [
        {
          href: 'https://user:password@fixture.test/assets/fonts.css?private=yes#hash',
          cssRules: [
            rule(
              'local("Arial"), url("./font.woff2?token=secret#fragment"),url(data:font/woff2;base64,SECRET)',
            ),
          ],
        },
      ],
    });
    expect(result.rules[0]?.href).toBe('https://fixture.test/assets/fonts.css');
    expect(result.rules[0]?.src).toBe(
      'local("Arial"), url("https://fixture.test/assets/font.woff2"),url("[data: URL omitted]")',
    );
    expect(JSON.stringify(result)).not.toMatch(
      /password|private|token|secret|fragment|SECRET/,
    );
  });

  test('walks grouped/imported rules while rejecting inaccessible CSSOM', async () => {
    const imported = {
      href: 'https://fixture.test/assets/import.css',
      cssRules: [rule('local(Arial)')],
    };
    const forbidden = {
      href: 'https://other.test/fonts.css?private=1',
      get cssRules() {
        throw new Error('Must not inspect cross-origin rules');
      },
    };
    const result = await serializedSnapshot({
      sheets: [
        {
          href: null,
          cssRules: [
            { type: 4, cssRules: [rule('local(Arial)')] },
            { type: 3, styleSheet: imported },
          ],
        },
        forbidden,
      ],
    });
    expect(result.rules).toHaveLength(2);
    expect(result.errors).toEqual([
      'Cross-origin CSSOM not inspected: https://other.test/fonts.css',
    ]);
  });

  test('bounds face/rule inventory and reports partial overflow', async () => {
    const result = await serializedSnapshot({
      faces: Array.from({ length: 513 }, () => snapshot().faces[0]),
      sheets: [
        {
          href: null,
          cssRules: Array.from({ length: 513 }, () => rule('local(Arial)')),
        },
      ],
    });
    expect(result.faces).toHaveLength(512);
    expect(result.rules).toHaveLength(512);
    expect(result.overflow).toBe(true);
  });
});
