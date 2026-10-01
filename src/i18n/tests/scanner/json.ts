/**
 * JSON walker — emits one `Fragment` per string leaf in the parsed JSON
 * tree, with dotted key path and mask-applied text.
 *
 * Line numbers for JSON fragments are computed by re-walking the raw source
 * text and finding each string literal's offset; this gives the reviewer a
 * line to navigate to instead of a key path that requires further lookup.
 * The walker is tolerant of formatting differences (whitespace, trailing
 * commas in JSONC variants) and falls back to `0` when a line can't be
 * resolved.
 */

import fs from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { applyJsonMasks } from './mask';
import type { Fragment, JsonSource } from './types';

interface FlatEntry {
  readonly key: string;
  readonly value: string;
}

function flatten(
  node: unknown,
  prefix = '',
  out: FlatEntry[] = [],
): FlatEntry[] {
  if (typeof node === 'string') {
    out.push({ key: prefix, value: node });
    return out;
  }
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

/** Read + parse + flatten a JSON source; emit one Fragment per leaf. */
export function scanJson(source: JsonSource, repoRoot: string): Fragment[] {
  const raw = fs.readFileSync(source.path, 'utf8');
  // The parser returns `unknown`-ish data; `flatten` runtime-guards every value
  // (string vs object vs other) so the unknown annotation is the safe default.
  const parsed: unknown = parseYaml(raw);
  const entries = flatten(parsed);
  const lineLookup = buildLineLookup(raw);
  const relFile = path.relative(repoRoot, source.path);

  const out: Fragment[] = [];
  for (const entry of entries) {
    out.push({
      pos: {
        file: relFile,
        line: lineLookup(entry.key) ?? 0,
        column: 1,
      },
      text: applyJsonMasks(entry.value),
      key: entry.key,
      surface: 'json',
      locale: source.locale,
    });
  }
  return out;
}

/**
 * Build a key-path → line-number lookup by scanning the raw JSON source.
 * Tracks nesting via a stack of last-seen keys; the line of a leaf is the
 * line where its value-string literal opens.
 */
function buildLineLookup(raw: string): (key: string) => number | undefined {
  const linesByKey = new Map<string, number>();
  const lines = raw.split('\n');
  const stack: string[] = [];
  let lastKey = '';
  let depthChange = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detect a key:value pair on this line.
    const keyMatch = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/.exec(line);
    if (keyMatch) {
      lastKey = keyMatch[1];
      const dotted = stack.concat(lastKey).join('.');
      const valuePart = line.slice(keyMatch.index + keyMatch[0].length);
      const isLeaf = /^\s*"/.test(valuePart);
      if (isLeaf) {
        linesByKey.set(dotted, i + 1);
      } else if (/^\s*\{/.test(valuePart)) {
        stack.push(lastKey);
        depthChange = 1;
      }
    }
    // Track closing braces, ignoring any that appear inside string literals.
    if (depthChange === 0) {
      let inString = false;
      let escapeNext = false;
      for (const ch of line) {
        if (escapeNext) {
          escapeNext = false;
          continue;
        }
        if (ch === '\\') {
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (!inString && ch === '}' && stack.length > 0) {
          stack.pop();
        }
      }
    }
    depthChange = 0;
  }
  return (key) => linesByKey.get(key);
}
