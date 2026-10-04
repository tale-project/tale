import assert from 'node:assert/strict';

import type { FontEvidence, FontFaceEvidence } from './font-evidence.ts';

export type InterWeight = 400 | 500 | 600 | 700;
const weights: readonly InterWeight[] = [400, 500, 600, 700];
export const latinUnicodeRange =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const metrics = [
  'ascentOverride',
  'descentOverride',
  'lineGapOverride',
  'sizeAdjust',
  'featureSettings',
  'variationSettings',
  'variant',
] as const;
type Metrics = Partial<Record<(typeof metrics)[number], string | null>>;
type Face = FontFaceEvidence & Metrics;
type Rule = FontEvidence['rules'][number] &
  Metrics & { stretch?: string; display?: string };
export interface LatinFontContract {
  origin: string;
  assets: Readonly<Record<string, string>>;
  latinFaces: readonly {
    weight: InterWeight;
    unicodeRange: string;
    sources: readonly {
      url: string;
      sha256: string;
      format: 'woff2' | 'woff';
    }[];
  }[];
}

function family(value: string) {
  return value.replace(/^(['"])(.*)\1$/, '$2').trim();
}
export function canonicalFontRange(value: string): string | undefined {
  const ranges: [number, number][] = [];
  for (const part of value.toUpperCase().split(',')) {
    const match = /^\s*U\+([0-9A-F?]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/.exec(part);
    if (!match?.[1] || (match[2] && match[1].includes('?'))) return undefined;
    const low = Number.parseInt(match[1].replaceAll('?', '0'), 16);
    const high = Number.parseInt(match[2] ?? match[1].replaceAll('?', 'F'), 16);
    if (low > high || high > 0x10ffff) return undefined;
    ranges.push([low, high]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges
    .map(([low, high]) => `${low.toString(16)}-${high.toString(16)}`)
    .join(',');
}

function asciiCandidate(
  value: Face | Rule,
  weight: InterWeight,
  rule: boolean,
) {
  if (
    family(value.family) !== 'Inter' ||
    !(value.style === 'normal' || (rule && value.style === '')) ||
    !(
      value.weight === String(weight) ||
      (weight === 400 &&
        (value.weight === 'normal' || (rule && value.weight === '')))
    )
  )
    return false;
  const ranges = canonicalFontRange(value.unicodeRange);
  // An omitted CSS range covers all Unicode. Unreadable ranges cannot prove
  // that another normal face is disjoint, so retain them as ambiguous too.
  return (
    ranges === undefined ||
    ranges
      .split(',')
      .some((range) => Number.parseInt(range.split('-')[0]!, 16) <= 0x7f)
  );
}

/** Build expectations from the retained build manifest, never browser evidence. */
export function latinFontContract(
  origin: string,
  assets: Record<string, string>,
): LatinFontContract {
  const parsed = new URL(origin);
  assert(
    ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin,
    'A canonical browser origin is required',
  );
  const latinFaces = weights.map((weight) => ({
    weight,
    unicodeRange: latinUnicodeRange,
    sources: (['woff2', 'woff'] as const).map((format) => {
      const names = Object.keys(assets).filter((name) =>
        new RegExp(
          `^assets/inter-latin-${weight}-normal-[A-Za-z0-9_-]+\\.${format}$`,
        ).test(name),
      );
      assert.equal(
        names.length,
        1,
        `Expected one emitted Latin Inter${weight} ${format} asset`,
      );
      const name = names[0]!;
      const sha256 = assets[name]!;
      assert(/^[a-f0-9]{64}$/.test(sha256), 'Invalid emitted font SHA256');
      return Object.freeze({
        url: new URL(`/${name}`, origin).href,
        sha256,
        format,
      });
    }),
  }));
  return Object.freeze({
    origin,
    assets: Object.freeze({ ...assets }),
    latinFaces: Object.freeze(
      latinFaces.map((face) =>
        Object.freeze({ ...face, sources: Object.freeze(face.sources) }),
      ),
    ),
  });
}

function normalDescriptors(
  value: Face | Rule,
  rule: boolean,
  fallback: boolean,
) {
  const defaults = (actual: string | null | undefined, expected: string) =>
    actual === expected || (rule && actual === '');
  if (!defaults(value.style, 'normal') || !defaults(value.stretch, 'normal'))
    return false;
  if (fallback ? !defaults(value.display, 'auto') : value.display !== 'swap')
    return false;
  for (const key of [
    'featureSettings',
    'variationSettings',
    'variant',
  ] as const)
    if (!defaults(value[key], 'normal')) return false;
  const expected = fallback
    ? {
        ascentOverride: '90.49%',
        descentOverride: '22.56%',
        lineGapOverride: '0%',
        sizeAdjust: '107.06%',
      }
    : {
        ascentOverride: 'normal',
        descentOverride: 'normal',
        lineGapOverride: 'normal',
        sizeAdjust: '100%',
      };
  for (const key of [
    'ascentOverride',
    'descentOverride',
    'lineGapOverride',
    'sizeAdjust',
  ] as const) {
    // Required metrics must be explicit for the optional exception. Empty
    // CSS descriptors on ordinary Inter mean the platform defaults only.
    if (
      value[key] !== expected[key] &&
      !(rule && !fallback && value[key] === '')
    )
      return false;
  }
  return true;
}
function optionalFallback(face: Face, rule: Rule) {
  return (
    family(face.family) === 'Inter Fallback' &&
    family(rule.family) === 'Inter Fallback' &&
    face.weight === 'normal' &&
    (rule.weight === '' || rule.weight === 'normal') &&
    canonicalFontRange(face.unicodeRange) === '0-10ffff' &&
    (rule.unicodeRange === '' ||
      canonicalFontRange(rule.unicodeRange) === '0-10ffff') &&
    normalDescriptors(face, false, true) &&
    normalDescriptors(rule, true, true) &&
    /^local\(\s*(?:"Arial"|'Arial'|Arial)\s*\)$/.test(rule.src.trim())
  );
}
function sourcesMatch(
  rule: Rule,
  expected: LatinFontContract['latinFaces'][number],
) {
  const expression = /url\("([^"\n]+)"\)\s*format\("(woff2|woff)"\)/g;
  const sources = [...rule.src.matchAll(expression)];
  const remainder = rule.src.replace(expression, '').replace(/[\s,]/g, '');
  return (
    remainder === '' &&
    sources.length === expected.sources.length &&
    sources.every(
      (match, index) =>
        match[1] === expected.sources[index]?.url &&
        match[2] === expected.sources[index]?.format,
    )
  );
}

/** Evidence completeness is separate from optional-local classification. Glyph
 * proof remains a later functional check, never inferred from this verdict. */
export function classifyFontEvidence(
  evidence: FontEvidence,
  expected: LatinFontContract & { requiredWeights: readonly InterWeight[] },
) {
  const failures: string[] = [];
  const fail = (message: string) => {
    failures.push(message);
  };
  if (
    !evidence.complete ||
    !evidence.ready ||
    evidence.overflow ||
    evidence.errors.length > 0
  )
    fail('Font evidence is incomplete');
  if (evidence.failedRequests.length > 0) fail('A font request failed');
  if (
    expected.requiredWeights.length === 0 ||
    new Set(expected.requiredWeights).size !==
      expected.requiredWeights.length ||
    expected.requiredWeights.some((weight) => !weights.includes(weight))
  )
    fail('Required Latin weights must be explicit, valid and unique');
  const faces: Face[] = evidence.faces;
  const rules: Rule[] = evidence.rules;
  const optionalFaces: {
    face: FontFaceEvidence;
    classification: 'source-exact-local-Arial';
    errored: boolean;
  }[] = [];
  const fallbacks = faces.filter(
    (face) => family(face.family) === 'Inter Fallback',
  );
  const fallbackRules = rules.filter(
    (rule) => family(rule.family) === 'Inter Fallback',
  );
  const fallbackValid =
    fallbacks.length === 1 &&
    fallbackRules.length === 1 &&
    optionalFallback(fallbacks[0]!, fallbackRules[0]!);
  if (!fallbackValid)
    fail(
      'Optional Inter Fallback descriptors/declaration are missing, unsupported, duplicated or changed',
    );
  else
    optionalFaces.push({
      face: structuredClone(fallbacks[0]!),
      classification: 'source-exact-local-Arial',
      errored: fallbacks[0]!.status === 'error',
    });
  for (const face of faces) {
    if (!['loaded', 'unloaded', 'loading', 'error'].includes(face.status))
      fail(`Unknown font status: ${family(face.family)}`);
    if (face.status === 'loading')
      fail(`Font still loading: ${family(face.family)} ${face.weight}`);
    if (face.status === 'error' && !(fallbackValid && face === fallbacks[0]))
      fail(`Font failed: ${family(face.family)} ${face.weight}`);
  }
  const validResponses = new Set<string>();
  for (const response of evidence.responses) {
    let known = false;
    try {
      const url = new URL(response.url);
      const hash = expected.assets[url.pathname.slice(1)];
      known =
        url.origin === expected.origin &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        typeof hash === 'string' &&
        /^[a-f0-9]{64}$/.test(hash) &&
        response.sha256 === hash;
    } catch {
      /* Unparseable captured URL fails closed below. */
    }
    if (
      !known ||
      response.error ||
      !Number.isInteger(response.status) ||
      response.status < 200 ||
      response.status >= 300 ||
      !Number.isSafeInteger(response.bytes) ||
      (response.bytes ?? 0) <= 0 ||
      !Number.isFinite(response.timing.startTime) ||
      response.timing.startTime <= 0 ||
      !Number.isFinite(response.timing.responseEnd) ||
      response.timing.responseEnd < 0
    )
      fail(`Unverified font response: ${response.url}`);
    else validResponses.add(response.url);
  }
  const required = expected.requiredWeights.map((weight) => {
    const contract = expected.latinFaces.find((face) => face.weight === weight);
    const matching = faces.filter((face) =>
      asciiCandidate(face, weight, false),
    );
    const declarations = rules.filter((rule) =>
      asciiCandidate(rule, weight, true),
    );
    const loaded =
      matching.length === 1 &&
      canonicalFontRange(matching[0]!.unicodeRange) ===
        canonicalFontRange(latinUnicodeRange) &&
      matching[0]!.status === 'loaded' &&
      normalDescriptors(matching[0]!, false, false);
    const declared =
      contract !== undefined &&
      declarations.length === 1 &&
      canonicalFontRange(declarations[0]!.unicodeRange) ===
        canonicalFontRange(latinUnicodeRange) &&
      normalDescriptors(declarations[0]!, true, false) &&
      sourcesMatch(declarations[0]!, contract);
    const verifiedResponse =
      contract?.sources.some((source) => validResponses.has(source.url)) ??
      false;
    if (!loaded)
      fail(
        `Required Latin Inter${weight} face is absent, duplicated, unloaded, errored or has changed descriptors`,
      );
    if (!declared)
      fail(
        `Required Latin Inter${weight} source declaration is absent, duplicated or changed`,
      );
    if (!verifiedResponse)
      fail(
        `Required Latin Inter${weight} has no verified emitted-font response`,
      );
    return { weight, loaded, declared, verifiedResponse };
  });
  return { valid: failures.length === 0, failures, optionalFaces, required };
}
