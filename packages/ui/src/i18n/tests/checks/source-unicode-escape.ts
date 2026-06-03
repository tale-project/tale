/**
 * `source-unicode-escape` — message JSON must use literal UTF-8 characters,
 * not `\uXXXX` escapes, for visible (graphic) characters.
 *
 * Some tools re-serialize JSON with ASCII-only output (Python's `json.dumps`
 * defaults to `ensure_ascii=True`; an LLM editing a file may emit escaped
 * strings), turning natural umlauts like "ä" into "ä". That round-trips
 * losslessly through any JSON parser, so the regression is functionally
 * invisible — which is exactly why it slips in. It hurts readability,
 * translator workflow, and diff hygiene, and leaves one locale file
 * inconsistent with the rest.
 *
 * This is a SOURCE-level check: it reads raw file bytes via the scanner's
 * source list (`matchingSources`) rather than the parsed fragments, because
 * the JSON parser has already decoded "ä" → "ä" by the time fragments
 * exist. It allows escapes that are mandatory or whose literal form would be
 * invisible/hazardous — control characters (Cc), format characters (Cf),
 * surrogates (Cs, i.e. escaped astral characters such as emoji), and
 * line/paragraph/space separators (Zl/Zp/Zs, including NBSP) — and flags every
 * visible character that should simply be written as itself.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resolveRepoRoot } from '../internals/paths';
import type { Finding } from './types';
import { createCheck } from './types';

const ESCAPE = /\\u([0-9a-fA-F]{4})/g;

/**
 * Escapes that may legitimately stay escaped: their literal form is either
 * mandatory to escape (controls) or invisible/ambiguous in source (format
 * chars, surrogates, every flavour of whitespace separator).
 */
const KEEP_ESCAPED = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Zs}]/u;

export const sourceUnicodeEscape = createCheck({
  id: 'source-unicode-escape',
  scope: 'json',
  defaultMode: 'enforce',
  run(ctx) {
    const findings: Finding[] = [];
    const repoRoot = ctx.serviceRoot ? resolveRepoRoot(ctx.serviceRoot) : null;
    for (const source of ctx.scanner.matchingSources({ surface: 'json' })) {
      const raw = fs.readFileSync(source.path, 'utf8');
      const file = repoRoot
        ? path.relative(repoRoot, source.path)
        : source.path;
      ESCAPE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = ESCAPE.exec(raw)) !== null) {
        const ch = String.fromCodePoint(parseInt(m[1], 16));
        if (KEEP_ESCAPED.test(ch)) continue;
        const before = raw.slice(0, m.index);
        findings.push({
          file,
          line: before.split('\n').length,
          column: m.index - before.lastIndexOf('\n'),
          locale: source.locale,
          rule: 'unicode-escape',
          detail: `\\u${m[1]} escape for visible character "${ch}"`,
          suggest: `use the literal character "${ch}"`,
        });
      }
    }
    return findings;
  },
});
