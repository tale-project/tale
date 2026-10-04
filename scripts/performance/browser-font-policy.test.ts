import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import {
  fontCheckpoint,
  type FontCheckpoint,
} from './browser/font-checkpoint.ts';
import type { FontEvidence } from './browser/font-evidence.ts';
import {
  canonicalFontRange,
  classifyFontEvidence,
  latinFontContract,
  latinUnicodeRange,
  type InterWeight,
} from './browser/font-policy.ts';

const origin = 'https://127.0.0.2:3100';
const hash = 'a'.repeat(64);
const weights = [400, 500, 600, 700] as const;
const normal = {
  ascentOverride: 'normal',
  descentOverride: 'normal',
  lineGapOverride: 'normal',
  sizeAdjust: '100%',
  featureSettings: 'normal',
  variationSettings: 'normal',
  variant: 'normal',
};
const fallbackMetrics = {
  ...normal,
  ascentOverride: '90.49%',
  descentOverride: '22.56%',
  lineGapOverride: '0%',
  sizeAdjust: '107.06%',
};
function assets() {
  return Object.fromEntries(
    weights.flatMap((weight) =>
      ['woff2', 'woff'].map((format) => [
        `assets/inter-latin-${weight}-normal-pinned.${format}`,
        hash,
      ]),
    ),
  );
}
function fixture(requiredWeights: readonly InterWeight[] = [500]) {
  const contract = latinFontContract(origin, assets());
  // Deliberately synthetic complete descriptors; the retained browser probe
  // omitted these properties and must not be promoted into this fixture.
  const evidence = {
    capturedAt: 1700000000100,
    timeOrigin: 1700000000000,
    performanceNow: 100,
    ready: true,
    complete: true,
    overflow: false,
    errors: [],
    failedRequests: [],
    faces: [
      {
        family: 'Inter Fallback',
        style: 'normal',
        weight: 'normal',
        stretch: 'normal',
        unicodeRange: 'U+0-10FFFF',
        display: 'auto',
        status: 'error',
        ...fallbackMetrics,
      },
      ...weights.map((weight) => ({
        family: 'Inter',
        style: 'normal',
        weight: String(weight),
        stretch: 'normal',
        unicodeRange: latinUnicodeRange,
        display: 'swap',
        status: requiredWeights.includes(weight) ? 'loaded' : 'unloaded',
        ...normal,
      })),
    ],
    rules: [
      {
        href: `${origin}/assets/index.css`,
        family: 'Inter Fallback',
        style: '',
        weight: '',
        stretch: '',
        unicodeRange: '',
        display: '',
        src: 'local("Arial")',
        ...fallbackMetrics,
      },
      ...contract.latinFaces.map((face) => ({
        href: `${origin}/assets/index.css`,
        family: 'Inter',
        style: 'normal',
        weight: String(face.weight),
        stretch: '',
        unicodeRange: latinUnicodeRange,
        display: 'swap',
        src: face.sources
          .map((source) => `url("${source.url}") format("${source.format}")`)
          .join(', '),
        ...normal,
      })),
    ],
    responses: requiredWeights.map((weight) => ({
      url: `${origin}/assets/inter-latin-${weight}-normal-pinned.woff2`,
      status: 200,
      contentType: 'font/woff2',
      observedAt: 1700000000020,
      observedMonotonic: 20,
      timing: {
        startTime: 1700000000000,
        domainLookupStart: -1,
        domainLookupEnd: -1,
        connectStart: -1,
        secureConnectionStart: -1,
        connectEnd: -1,
        requestStart: 1,
        responseStart: 2,
        responseEnd: 3,
      },
      bytes: 20000,
      sha256: hash,
    })),
  };
  return { evidence, expected: { ...contract, requiredWeights } };
}

test('production classification is persisted with the raw optional error before checkpoint success', async () => {
  const { evidence, expected } = fixture();
  let saved: FontCheckpoint | undefined;
  const result = await fontCheckpoint({
    collect: async () => evidence,
    classify: (value) => classifyFontEvidence(value, expected),
    errors: () => [],
    retain: () => {},
    persist: async (value) => {
      saved = structuredClone(value);
    },
  });
  expect(result.classification?.valid).toBe(true);
  expect(saved?.fonts?.faces[0]?.status).toBe('error');
  expect(saved?.classification?.optionalFaces[0]).toMatchObject({
    errored: true,
    classification: 'source-exact-local-Arial',
  });
});

test('required-font policy failure and original evidence survive a secondary write failure', async () => {
  const { evidence, expected } = fixture();
  evidence.responses[0]!.sha256 = 'b'.repeat(64);
  let retained: FontCheckpoint | undefined;
  let caught: unknown;
  try {
    await fontCheckpoint({
      collect: async () => evidence,
      classify: (value) => classifyFontEvidence(value, expected),
      errors: () => [],
      retain: (value) => {
        retained = value;
      },
      persist: async () => {
        throw new Error('disk full');
      },
    });
  } catch (error) {
    caught = error;
  }
  expect(String(caught)).toContain('Unverified font response');
  expect(String(caught)).toContain('disk full');
  expect(retained?.classification?.valid).toBe(false);
  expect(retained?.fonts?.responses[0]?.sha256).toBe('b'.repeat(64));
});

describe('source-derived Latin contract', () => {
  test('accepts the existing relative build manifest and freezes expectations', () => {
    const input = assets();
    const contract = latinFontContract(origin, input);
    expect(contract.latinFaces).toHaveLength(4);
    expect(contract.latinFaces.flatMap((face) => face.sources)).toHaveLength(8);
    expect(contract.latinFaces[0]?.sources[0]?.url).toBe(
      `${origin}/assets/inter-latin-400-normal-pinned.woff2`,
    );
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.latinFaces[0]?.sources)).toBe(true);
    input['assets/inter-latin-400-normal-pinned.woff2'] = 'b'.repeat(64);
    expect(contract.assets['assets/inter-latin-400-normal-pinned.woff2']).toBe(
      hash,
    );
  });

  test('refuses missing/ambiguous assets, malformed hashes and noncanonical origins', () => {
    const missing = assets();
    delete missing['assets/inter-latin-400-normal-pinned.woff'];
    expect(() => latinFontContract(origin, missing)).toThrow();
    expect(() =>
      latinFontContract(origin, {
        ...assets(),
        'assets/inter-latin-400-normal-other.woff': hash,
      }),
    ).toThrow();
    expect(() =>
      latinFontContract(origin, {
        ...assets(),
        'assets/inter-latin-400-normal-pinned.woff2': 'not-a-hash',
      }),
    ).toThrow();
    for (const value of [
      `${origin}/`,
      `${origin}/assets`,
      'file:///tmp',
      'https://user:password@fixture.test',
    ])
      expect(() => latinFontContract(value, assets())).toThrow();
  });

  test('pins policy to actual shared CSS and imported Inter source', () => {
    const globals = readFileSync(
      new URL('../../packages/ui/src/globals.css', import.meta.url),
      'utf8',
    );
    const fallback = globals.match(
      /@font-face\s*\{[^}]*font-family:\s*'Inter Fallback';[^}]*\}/,
    )?.[0];
    expect(fallback).toBeDefined();
    expect(
      [...fallback!.matchAll(/([a-z-]+)\s*:\s*[^;]+;/g)]
        .map((match) => match[1])
        .sort(),
    ).toEqual([
      'ascent-override',
      'descent-override',
      'font-family',
      'line-gap-override',
      'size-adjust',
      'src',
    ]);
    for (const [name, value] of [
      ['src', "local('Arial')"],
      ['ascent-override', '90.49%'],
      ['descent-override', '22.56%'],
      ['line-gap-override', '0%'],
      ['size-adjust', '107.06%'],
    ])
      expect(fallback).toContain(`${name}: ${value};`);
    expect(globals.match(/font-family:\s*'Inter Fallback';/g)).toHaveLength(1);
    const imports = readFileSync(
      new URL('../../packages/ui/src/fonts.ts', import.meta.url),
      'utf8',
    );
    const require = createRequire(
      new URL('../../packages/ui/package.json', import.meta.url),
    );
    for (const weight of weights) {
      expect(imports).toContain(`import '@fontsource/inter/${weight}.css';`);
      const css = readFileSync(
        require.resolve(`@fontsource/inter/${weight}.css`),
        'utf8',
      );
      const latin = css.split(`/* inter-latin-${weight}-normal */`)[1];
      expect(latin).toBeDefined();
      expect(latin).toContain('font-style: normal;');
      expect(latin).toContain('font-display: swap;');
      expect(latin).toContain(`font-weight: ${weight};`);
      const range = latin?.match(/unicode-range:\s*([^;]+);/)?.[1] ?? '';
      expect(canonicalFontRange(range)).toBe(
        canonicalFontRange(latinUnicodeRange),
      );
      for (const format of ['woff2', 'woff'])
        expect(latin).toContain(
          `./files/inter-latin-${weight}-normal.${format}`,
        );
    }
  });
});

describe('strict required-font classification', () => {
  test('preserves the sole exact optional error and leaves raw evidence unchanged', () => {
    const { evidence, expected } = fixture();
    const before = structuredClone(evidence);
    const result = classifyFontEvidence(evidence, expected);
    expect(result.valid).toBe(true);
    expect(result.optionalFaces).toHaveLength(1);
    expect(result.optionalFaces[0]).toMatchObject({
      classification: 'source-exact-local-Arial',
      errored: true,
      face: { status: 'error' },
    });
    expect(result.required).toEqual([
      { weight: 500, loaded: true, declared: true, verifiedResponse: true },
    ]);
    expect(evidence).toEqual(before);
    result.optionalFaces[0]!.face.status = 'changed';
    expect(evidence.faces[0]?.status).toBe('error');
  });

  test('requires caller-selected weights, without forcing unused weights to load', () => {
    for (const required of [[400], [500], [500, 600], [...weights]] as const) {
      const { evidence, expected } = fixture(required);
      expect(classifyFontEvidence(evidence, expected).valid).toBe(true);
    }
    const { evidence, expected } = fixture();
    expect(
      classifyFontEvidence(evidence, { ...expected, requiredWeights: [] })
        .valid,
    ).toBe(false);
    expect(
      classifyFontEvidence(evidence, {
        ...expected,
        requiredWeights: [500, 500],
      }).valid,
    ).toBe(false);
  });

  test('rejects empty inventories or absent/unloaded/errored required Latin faces', () => {
    for (const mode of ['empty', 'absent', 'unloaded', 'error', 'loading']) {
      const { evidence, expected } = fixture();
      if (mode === 'empty') evidence.faces = [];
      else if (mode === 'absent')
        evidence.faces = evidence.faces.filter((face) => face.weight !== '500');
      else evidence.faces.find((face) => face.weight === '500')!.status = mode;
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('rejects optional family/source/metrics/variant changes and duplicates', () => {
    for (const mode of [
      'family',
      'url',
      'extra-local',
      'metric',
      'variant',
      'features',
      'duplicate-face',
      'duplicate-rule',
      'missing-rule',
      'unsupported',
    ]) {
      const { evidence, expected } = fixture();
      if (mode === 'family') evidence.faces[0]!.family = 'Other Fallback';
      else if (mode === 'url')
        evidence.rules[0]!.src = `url("${origin}/assets/font.woff2")`;
      else if (mode === 'extra-local')
        evidence.rules[0]!.src += ',local("Helvetica")';
      else if (mode === 'metric') evidence.rules[0]!.sizeAdjust = '107.07%';
      else if (mode === 'variant') evidence.faces[0]!.variant = 'small-caps';
      else if (mode === 'features')
        evidence.faces[0]!.featureSettings = '"liga" off';
      else if (mode === 'duplicate-face')
        evidence.faces.push({ ...evidence.faces[0]! });
      else if (mode === 'duplicate-rule')
        evidence.rules.push({ ...evidence.rules[0]! });
      else if (mode === 'missing-rule') evidence.rules.shift();
      else Reflect.deleteProperty(evidence.faces[0]!, 'sizeAdjust');
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('never allows an unknown errored or still-loading face', () => {
    for (const status of ['error', 'loading', 'other']) {
      const { evidence, expected } = fixture();
      evidence.faces.push({
        ...evidence.faces[0]!,
        family: 'KaTeX_Main',
        status,
      });
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('rejects required declaration drift, ambiguous sources and descriptor changes', () => {
    for (const mode of [
      'duplicate',
      'missing',
      'range',
      'src',
      'display',
      'style',
      'face-metric',
    ]) {
      const { evidence, expected } = fixture();
      const declaration = evidence.rules.find((rule) => rule.weight === '500')!;
      if (mode === 'duplicate') evidence.rules.push({ ...declaration });
      else if (mode === 'missing')
        evidence.rules = evidence.rules.filter((rule) => rule !== declaration);
      else if (mode === 'range') declaration.unicodeRange = 'U+0-FFFF';
      else if (mode === 'src') declaration.src += ',local("Inter")';
      else if (mode === 'display') declaration.display = '';
      else if (mode === 'style') declaration.style = 'italic';
      else
        evidence.faces.find((face) => face.weight === '500')!.ascentOverride =
          '90%';
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('rejects extra normal Inter faces or declarations covering any ASCII code point', () => {
    for (const range of ['U+0-10FFFF', 'U+0041', 'U+00??']) {
      for (const mode of ['face', 'rule', 'both']) {
        const { evidence, expected } = fixture();
        const face = evidence.faces.find((value) => value.weight === '500')!;
        const rule = evidence.rules.find((value) => value.weight === '500')!;
        if (mode !== 'rule')
          evidence.faces.push({ ...face, unicodeRange: range });
        if (mode !== 'face')
          evidence.rules.push({ ...rule, unicodeRange: range, style: '' });
        expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
      }
    }
    for (const range of ['', 'unreadable']) {
      const { evidence, expected } = fixture();
      const rule = evidence.rules.find((value) => value.weight === '500')!;
      evidence.rules.push({ ...rule, unicodeRange: range });
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('rejects overlapping weight ranges, bold aliases and unsupported weight descriptors', () => {
    for (const descriptor of [
      '100 900',
      '500 700',
      'bold',
      'unreadable',
      '1001',
    ]) {
      for (const mode of ['face', 'rule']) {
        const { evidence, expected } = fixture([700]);
        const face = evidence.faces.find((value) => value.weight === '700')!;
        const rule = evidence.rules.find((value) => value.weight === '700')!;
        if (mode === 'face')
          evidence.faces.push({ ...face, weight: descriptor });
        else evidence.rules.push({ ...rule, weight: descriptor });
        expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
      }
    }
  });

  test('detects duplicate known CSS families regardless of ASCII case', () => {
    for (const name of ['inter', 'INTER', 'INTER FALLBACK', 'inter fallback']) {
      for (const mode of ['face', 'rule']) {
        const { evidence, expected } = fixture();
        const index = name.toLowerCase() === 'inter' ? 2 : 0;
        if (mode === 'face')
          evidence.faces.push({
            ...evidence.faces[index]!,
            family: name,
            status: 'unloaded',
          });
        else evidence.rules.push({ ...evidence.rules[index]!, family: name });
        expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
      }
    }
  });

  test('never accepts a required fixed-weight source relabeled as a weight range', () => {
    for (const mode of ['face', 'rule']) {
      const { evidence, expected } = fixture();
      if (mode === 'face')
        evidence.faces.find((value) => value.weight === '500')!.weight =
          '100 900';
      else
        evidence.rules.find((value) => value.weight === '500')!.weight =
          '100 900';
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('keeps non-ASCII subsets valid even when they share Latin combining marks', () => {
    const { evidence, expected } = fixture();
    const range = 'U+0100-02BA,U+0304,U+0308';
    const face = evidence.faces.find((value) => value.weight === '500')!;
    const rule = evidence.rules.find((value) => value.weight === '500')!;
    evidence.faces.push({ ...face, unicodeRange: range, status: 'unloaded' });
    evidence.rules.push({ ...rule, unicodeRange: range });
    expect(classifyFontEvidence(evidence, expected).valid).toBe(true);
  });

  test('rejects missing, HTTP-failed, corrupt200 and incomplete response evidence', () => {
    for (const mode of [
      'missing',
      '404',
      'redirect',
      'corrupt',
      'hash-missing',
      'body-failed',
      'zero',
      'unfinished',
      'nonfinite',
      'foreign',
      'unknown',
    ]) {
      const { evidence, expected } = fixture();
      const response = evidence.responses[0]!;
      if (mode === 'missing') evidence.responses = [];
      else if (mode === '404') response.status = 404;
      else if (mode === 'redirect') response.status = 302;
      else if (mode === 'corrupt') response.sha256 = 'b'.repeat(64);
      else if (mode === 'hash-missing')
        Reflect.deleteProperty(response, 'sha256');
      else if (mode === 'body-failed')
        Object.assign(response, { error: 'Decode failure' });
      else if (mode === 'zero') response.bytes = 0;
      else if (mode === 'unfinished') response.timing.responseEnd = -1;
      else if (mode === 'nonfinite') response.timing.startTime = NaN;
      else if (mode === 'foreign')
        response.url = response.url.replace(origin, 'https://other.test');
      else response.url = `${origin}/assets/unknown.woff2`;
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('rejects failures even if an alternate source rendered successfully', () => {
    const { evidence, expected } = fixture();
    evidence.responses.push({
      ...evidence.responses[0]!,
      url: `${origin}/assets/inter-latin-500-normal-pinned.woff`,
      status: 404,
    });
    const result = classifyFontEvidence(evidence, expected);
    expect(result.required[0]?.verifiedResponse).toBe(true);
    expect(result.valid).toBe(false);
  });

  test('keeps collector errors, failed requests, readiness and overflow invalid', () => {
    for (const mode of ['complete', 'ready', 'overflow', 'error', 'request']) {
      const { evidence, expected } = fixture();
      if (mode === 'complete') evidence.complete = false;
      else if (mode === 'ready') evidence.ready = false;
      else if (mode === 'overflow') evidence.overflow = true;
      else if (mode === 'error')
        (evidence.errors as string[]).push('Collection incomplete');
      else
        (evidence as FontEvidence).failedRequests.push({
          url: `${origin}/font.woff`,
          error: 'net::ERR_FAILED',
          observedAt: 1,
          observedMonotonic: 1,
          timing: evidence.responses[0]!.timing,
        });
      expect(classifyFontEvidence(evidence, expected).valid).toBe(false);
    }
  });

  test('the retained probe descriptor shape is explicitly insufficient', () => {
    const { evidence, expected } = fixture(weights);
    for (const face of evidence.faces)
      for (const key of Object.keys(normal)) Reflect.deleteProperty(face, key);
    const result = classifyFontEvidence(evidence, expected);
    expect(result.valid).toBe(false);
    expect(result.failures).toContain(
      'Optional Inter Fallback descriptors/declaration are missing, unsupported, duplicated or changed',
    );
    expect(result.optionalFaces).toHaveLength(0);
  });
});
