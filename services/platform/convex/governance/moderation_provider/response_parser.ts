import type { ModerationResponseShape } from '../../../lib/shared/schemas/governance';

export interface NormalizedModerationResult {
  flagged: boolean;
  categories: Record<string, { flagged: boolean; score?: number }>;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPath(root: unknown, jsonPath: string): unknown {
  // Minimal JSONPath: supports `$.a.b[0].c` syntax only. Anything more
  // exotic should use the `custom_jsonpath` shape with `jsonpath-plus` —
  // but we inline a tiny evaluator here for the built-in shapes which
  // only need simple traversal.
  if (!jsonPath.startsWith('$')) {
    throw new ParseError(`JSONPath must start with $: ${jsonPath}`);
  }
  const tokens = jsonPath
    .slice(1)
    .split(/\.|\[(\d+)\]/)
    .filter((t) => t !== undefined && t !== '');

  let current: unknown = root;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    const maybeIndex = Number(token);
    if (!Number.isNaN(maybeIndex) && Array.isArray(current)) {
      current = current[maybeIndex];
      continue;
    }
    if (isRecord(current)) {
      current = current[token];
      continue;
    }
    return undefined;
  }
  return current;
}

/**
 * OpenAI Moderation: `results[0].flagged` (bool) + `results[0].categories`
 * (Record of category -> bool) + `results[0].category_scores`
 * (Record of category -> number).
 */
function parseOpenAi(raw: unknown): NormalizedModerationResult {
  if (!isRecord(raw)) throw new ParseError('Non-object response');
  const results = raw['results'];
  if (!Array.isArray(results) || results.length === 0) {
    throw new ParseError('Missing results[]');
  }
  const first = results[0];
  if (!isRecord(first)) throw new ParseError('results[0] not object');

  const flagged =
    typeof first['flagged'] === 'boolean' ? first['flagged'] : false;
  const categoriesRaw = first['categories'];
  const scoresRaw = first['category_scores'];

  const categories: Record<string, { flagged: boolean; score?: number }> = {};
  if (isRecord(categoriesRaw)) {
    for (const [key, value] of Object.entries(categoriesRaw)) {
      if (typeof value !== 'boolean') continue;
      const entry: { flagged: boolean; score?: number } = { flagged: value };
      if (isRecord(scoresRaw) && typeof scoresRaw[key] === 'number') {
        entry.score = scoresRaw[key];
      }
      categories[key] = entry;
    }
  }
  return { flagged, categories };
}

/**
 * Azure AI Content Safety (text:analyze). Response has
 * `categoriesAnalysis: [{category, severity}]` where severity is a
 * small integer on a 0..6 scale. We normalize to 0..1.
 */
function parseAzureContentSafety(raw: unknown): NormalizedModerationResult {
  if (!isRecord(raw)) throw new ParseError('Non-object response');
  const analysis = raw['categoriesAnalysis'];
  if (!Array.isArray(analysis)) {
    throw new ParseError('Missing categoriesAnalysis[]');
  }
  const categories: Record<string, { flagged: boolean; score?: number }> = {};
  let anyFlagged = false;
  for (const entry of analysis) {
    if (!isRecord(entry)) continue;
    const category = entry['category'];
    const severity = entry['severity'];
    if (typeof category !== 'string' || typeof severity !== 'number') continue;
    const normalized = Math.min(1, Math.max(0, severity / 6));
    const flagged = severity > 0;
    if (flagged) anyFlagged = true;
    categories[category] = { flagged, score: normalized };
  }
  return { flagged: anyFlagged, categories };
}

/**
 * Perspective API: `attributeScores.<ATTR>.summaryScore.value` (0..1).
 * No explicit "flagged" field — a category is flagged when score > 0.
 * The caller applies the threshold from `categoryMappings[].scoreThreshold`
 * to decide enforcement.
 */
function parsePerspective(raw: unknown): NormalizedModerationResult {
  if (!isRecord(raw)) throw new ParseError('Non-object response');
  const attrs = raw['attributeScores'];
  if (!isRecord(attrs)) throw new ParseError('Missing attributeScores');
  const categories: Record<string, { flagged: boolean; score?: number }> = {};
  let anyFlagged = false;
  for (const [attr, detail] of Object.entries(attrs)) {
    if (!isRecord(detail)) continue;
    const summary = detail['summaryScore'];
    if (!isRecord(summary)) continue;
    const score = summary['value'];
    if (typeof score !== 'number') continue;
    const flagged = score > 0;
    if (flagged) anyFlagged = true;
    categories[attr] = { flagged, score };
  }
  return { flagged: anyFlagged, categories };
}

function parseCustomJsonPath(
  raw: unknown,
  shape: Extract<ModerationResponseShape, { type: 'custom_jsonpath' }>,
): NormalizedModerationResult {
  const flaggedValue =
    shape.flaggedPath !== undefined ? readPath(raw, shape.flaggedPath) : null;
  const categoriesValue = readPath(raw, shape.categoriesPath);
  const scoresValue =
    shape.scoresPath !== undefined ? readPath(raw, shape.scoresPath) : null;

  const categories: Record<string, { flagged: boolean; score?: number }> = {};

  if (shape.categoryShape === 'array') {
    if (!Array.isArray(categoriesValue)) {
      throw new ParseError('categoriesPath did not resolve to an array');
    }
    for (const item of categoriesValue) {
      if (typeof item !== 'string') continue;
      categories[item] = { flagged: true };
    }
  } else if (shape.categoryShape === 'record_of_bool') {
    if (!isRecord(categoriesValue)) {
      throw new ParseError(
        'categoriesPath did not resolve to an object (record_of_bool)',
      );
    }
    for (const [key, value] of Object.entries(categoriesValue)) {
      if (typeof value === 'boolean') categories[key] = { flagged: value };
    }
  } else {
    // record_of_score
    if (!isRecord(categoriesValue)) {
      throw new ParseError(
        'categoriesPath did not resolve to an object (record_of_score)',
      );
    }
    for (const [key, value] of Object.entries(categoriesValue)) {
      if (typeof value !== 'number') continue;
      categories[key] = { flagged: value > 0, score: value };
    }
  }

  if (isRecord(scoresValue)) {
    for (const [key, value] of Object.entries(scoresValue)) {
      if (typeof value !== 'number') continue;
      const existing = categories[key];
      if (existing) existing.score = value;
      else categories[key] = { flagged: value > 0, score: value };
    }
  }

  const flagged =
    typeof flaggedValue === 'boolean'
      ? flaggedValue
      : Object.values(categories).some((c) => c.flagged);

  return { flagged, categories };
}

export function parseResponse(
  raw: unknown,
  shape: ModerationResponseShape,
): NormalizedModerationResult {
  switch (shape.type) {
    case 'openai_moderation':
      return parseOpenAi(raw);
    case 'azure_content_safety':
      return parseAzureContentSafety(raw);
    case 'perspective':
      return parsePerspective(raw);
    case 'custom_jsonpath':
      return parseCustomJsonPath(raw, shape);
    default:
      return { flagged: false, categories: {} };
  }
}
