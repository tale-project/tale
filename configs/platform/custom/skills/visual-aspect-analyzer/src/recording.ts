// Boundary validation. A recording arrives as untyped JSON (from a file or the
// driver's dump); this module narrows it to a typed `Recording` with guards
// — no `as`, no `any` — failing fast with a path-qualified error so a malformed
// log never reaches the analysis engine.

import type {
  AuditMeta,
  ElementTrack,
  GeometrySample,
  LayoutProbe,
  LayoutShiftEntry,
  LayoutShiftSource,
  Rect,
  Recording,
  Segment,
} from './types';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function fail(path: string, expected: string): never {
  throw new Error(`Invalid recording at ${path}: expected ${expected}`);
}

function asObject(
  value: JsonValue,
  path: string,
): { [key: string]: JsonValue } {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    fail(path, 'object');
  return value;
}

function asArray(value: JsonValue, path: string): JsonValue[] {
  if (!Array.isArray(value)) fail(path, 'array');
  return value;
}

function asNumber(value: JsonValue, path: string): number {
  // Reject NaN AND ±Infinity — a non-finite number poisons the downstream
  // motion/score math (e.g. an Infinity rect makes every delta Infinity).
  if (typeof value !== 'number' || !Number.isFinite(value))
    fail(path, 'finite number');
  return value;
}

/** A non-negative integer: frame/segment counters and array indices. */
function asIndex(value: JsonValue, path: string): number {
  const n = asNumber(value, path);
  if (!Number.isInteger(n) || n < 0) fail(path, 'non-negative integer');
  return n;
}

function asString(value: JsonValue, path: string): string {
  if (typeof value !== 'string') fail(path, 'string');
  return value;
}

function asBoolean(value: JsonValue, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'boolean');
  return value;
}

function asNullableString(value: JsonValue, path: string): string | null {
  return value === null ? null : asString(value, path);
}

function asNullableNumber(value: JsonValue, path: string): number | null {
  return value === null ? null : asNumber(value, path);
}

function field(obj: { [key: string]: JsonValue }, key: string): JsonValue {
  return Object.prototype.hasOwnProperty.call(obj, key)
    ? (obj[key] ?? null)
    : null;
}

function parseRect(value: JsonValue, path: string): Rect {
  const obj = asObject(value, path);
  return {
    top: asNumber(field(obj, 'top'), `${path}.top`),
    right: asNumber(field(obj, 'right'), `${path}.right`),
    bottom: asNumber(field(obj, 'bottom'), `${path}.bottom`),
    left: asNumber(field(obj, 'left'), `${path}.left`),
  };
}

function parseSample(value: JsonValue, path: string): GeometrySample {
  const obj = asObject(value, path);
  const base: GeometrySample = {
    t: asNumber(field(obj, 't'), `${path}.t`),
    frame: asIndex(field(obj, 'frame'), `${path}.frame`),
    segment: asIndex(field(obj, 'segment'), `${path}.segment`),
    rectScreen: parseRect(field(obj, 'rectScreen'), `${path}.rectScreen`),
    rectPage: parseRect(field(obj, 'rectPage'), `${path}.rectPage`),
    opacity: asNumber(field(obj, 'opacity'), `${path}.opacity`),
    visible: asBoolean(field(obj, 'visible'), `${path}.visible`),
    inViewport: asBoolean(field(obj, 'inViewport'), `${path}.inViewport`),
    occluded: asBoolean(field(obj, 'occluded'), `${path}.occluded`),
    paints: asBoolean(field(obj, 'paints'), `${path}.paints`),
    pixelNoise: asNullableNumber(
      field(obj, 'pixelNoise'),
      `${path}.pixelNoise`,
    ),
  };
  // colorKey, outOfFlow and canPin are optional — attach each only when present.
  let sample = base;
  const colorRaw = field(obj, 'colorKey');
  if (colorRaw !== null)
    sample = { ...sample, colorKey: asNumber(colorRaw, `${path}.colorKey`) };
  const outRaw = field(obj, 'outOfFlow');
  if (outRaw !== null)
    sample = { ...sample, outOfFlow: asBoolean(outRaw, `${path}.outOfFlow`) };
  const pinRaw = field(obj, 'canPin');
  if (pinRaw !== null)
    sample = { ...sample, canPin: asBoolean(pinRaw, `${path}.canPin`) };
  return sample;
}

function parseLayoutProbe(value: JsonValue, path: string): LayoutProbe {
  const obj = asObject(value, path);
  return {
    affects: asBoolean(field(obj, 'affects'), `${path}.affects`),
    movedKeys: asArray(field(obj, 'movedKeys'), `${path}.movedKeys`).map(
      (v, i) => asString(v, `${path}.movedKeys[${i}]`),
    ),
  };
}

function parseKind(value: JsonValue, path: string): ElementTrack['kind'] {
  const kind = asString(value, path);
  if (kind === 'tracked' || kind === 'candidate') return kind;
  return fail(path, '"tracked" | "candidate"');
}

function parseTrack(value: JsonValue, path: string): ElementTrack {
  const obj = asObject(value, path);
  const probeRaw = field(obj, 'layoutProbe');
  const tagRaw = field(obj, 'tag');
  const roleRaw = field(obj, 'role');
  const nameRaw = field(obj, 'name');
  const track: ElementTrack = {
    key: asString(field(obj, 'key'), `${path}.key`),
    testid: asNullableString(field(obj, 'testid'), `${path}.testid`),
    selector: asString(field(obj, 'selector'), `${path}.selector`),
    ...(roleRaw === null ? {} : { role: asString(roleRaw, `${path}.role`) }),
    ...(nameRaw === null ? {} : { name: asString(nameRaw, `${path}.name`) }),
    ...(tagRaw === null ? {} : { tag: asString(tagRaw, `${path}.tag`) }),
    kind: parseKind(field(obj, 'kind'), `${path}.kind`),
    ancestorKeys: asArray(
      field(obj, 'ancestorKeys'),
      `${path}.ancestorKeys`,
    ).map((v, i) => asString(v, `${path}.ancestorKeys[${i}]`)),
    samples: asArray(field(obj, 'samples'), `${path}.samples`).map((v, i) =>
      parseSample(v, `${path}.samples[${i}]`),
    ),
  };
  if (probeRaw === null) return track;
  return {
    ...track,
    layoutProbe: parseLayoutProbe(probeRaw, `${path}.layoutProbe`),
  };
}

function parseSegment(value: JsonValue, path: string): Segment {
  const obj = asObject(value, path);
  return {
    index: asIndex(field(obj, 'index'), `${path}.index`),
    url: asString(field(obj, 'url'), `${path}.url`),
    from: asNumber(field(obj, 'from'), `${path}.from`),
    to: asNumber(field(obj, 'to'), `${path}.to`),
  };
}

function parseLayoutShiftSource(
  value: JsonValue,
  path: string,
): LayoutShiftSource {
  const obj = asObject(value, path);
  return {
    key: asNullableString(field(obj, 'key'), `${path}.key`),
    previousRect: parseRect(field(obj, 'previousRect'), `${path}.previousRect`),
    currentRect: parseRect(field(obj, 'currentRect'), `${path}.currentRect`),
  };
}

function parseLayoutShift(value: JsonValue, path: string): LayoutShiftEntry {
  const obj = asObject(value, path);
  return {
    t: asNumber(field(obj, 't'), `${path}.t`),
    segment: asIndex(field(obj, 'segment'), `${path}.segment`),
    value: asNumber(field(obj, 'value'), `${path}.value`),
    hadRecentInput: asBoolean(
      field(obj, 'hadRecentInput'),
      `${path}.hadRecentInput`,
    ),
    sources: asArray(field(obj, 'sources'), `${path}.sources`).map((v, i) =>
      parseLayoutShiftSource(v, `${path}.sources[${i}]`),
    ),
  };
}

// `audit` is optional (only whole-page audits carry it); attach when present.
function parseAudit(value: JsonValue, path: string): AuditMeta {
  const obj = asObject(value, path);
  return {
    wholePage: true,
    discovered: asIndex(field(obj, 'discovered'), `${path}.discovered`),
    capped: asBoolean(field(obj, 'capped'), `${path}.capped`),
  };
}

/**
 * Narrow already-parsed JSON to a `Recording`, throwing on the first malformed
 * field with the path that failed.
 */
export function validateRecording(value: JsonValue): Recording {
  const obj = asObject(value, '$');
  const base: Recording = {
    pixelThreshold: asNumber(field(obj, 'pixelThreshold'), '$.pixelThreshold'),
    frameBudgetMs: asNumber(field(obj, 'frameBudgetMs'), '$.frameBudgetMs'),
    segments: asArray(field(obj, 'segments'), '$.segments').map((v, i) =>
      parseSegment(v, `$.segments[${i}]`),
    ),
    elements: asArray(field(obj, 'elements'), '$.elements').map((v, i) =>
      parseTrack(v, `$.elements[${i}]`),
    ),
    layoutShifts: asArray(field(obj, 'layoutShifts'), '$.layoutShifts').map(
      (v, i) => parseLayoutShift(v, `$.layoutShifts[${i}]`),
    ),
  };
  const auditRaw = field(obj, 'audit');
  if (auditRaw === null) return base;
  return { ...base, audit: parseAudit(auditRaw, '$.audit') };
}

/** Parse recording JSON text from disk or the driver dump. */
export function loadRecording(text: string): Recording {
  const parsed: JsonValue = JSON.parse(text);
  return validateRecording(parsed);
}
