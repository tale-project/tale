import type { Finding } from './findings';
import { iterProseLines } from './markdown';
import {
  escapeRegex,
  wordBoundary,
  wordBoundaryDe,
  wordBoundaryFr,
} from './regex';
import type { Locale } from './walk';

/**
 * Rule abstraction shared by the voice tests (`50-voice-en`, `51-voice-de`,
 * `52-voice-fr`) and the half-compound test (`43-terminology-compounds`).
 *
 * Two shapes:
 *
 *   - `StrikeEntry` — a flat term denylist. Matches a literal term with a
 *     word boundary; produces a "strike" finding with an optional `replace`
 *     hint. Used for marketing softeners (`simply`, `Découvrez`, `einfach`).
 *
 *   - `DriftRule` — a regex pattern with a target form. Used for drift→target
 *     anti-patterns (`Wird gespeichert…` → `Speichert…`, `Pull Anfrage` →
 *     `Pull Request`). The pattern carries its own match logic so the rule
 *     can describe positional or contextual drift that a simple term match
 *     can't catch.
 *
 * Both shapes share `id` (used as the finding's `rule` field) and an optional
 * `allowIn` list of regexes that suppress matches in legitimate contexts.
 * The classic `allowIn` use case is `just`: usually a softener, but legal
 * inside a quoted UI string (`"Just now"` as a relative timestamp).
 */

export interface StrikeEntry {
  /** Stable rule id; appears as `[strike-simply]` in failure output. */
  id: string;
  /** The literal word/phrase to denylist. */
  term: string;
  /** Optional fix hint shown in the finding's detail. */
  replace?: string;
  /** Locale-aware word boundary to use. Defaults to `en`. */
  boundary?: 'en' | 'de' | 'fr';
  /** Case-insensitive match. Defaults to `true` because most softeners are
   *  hit regardless of capitalisation (`Simply` vs `simply`). */
  caseInsensitive?: boolean;
  /** If any of these regexes matches the line, the strike is suppressed. */
  allowIn?: RegExp[];
}

export interface DriftRule {
  /** Stable rule id; appears as `[drift-passive-present]` in failure output. */
  id: string;
  /** The pattern that flags drift. Use `g` flag if you want every match per
   *  line; otherwise the rule fires at most once per line. */
  pattern: RegExp;
  /** What the drift should become. Shown in the finding's detail. */
  target: string;
  /** Locales the rule applies to. */
  locales: Locale[];
  /** Optional context for the failure message — why the drift is wrong. */
  rationale?: string;
  /** Lines matching any of these regexes are exempt. */
  allowIn?: RegExp[];
}

/** Compile a `StrikeEntry` to a `RegExp`. Caches not used — the regex is
 *  built once per rule per test run and the runtime is negligible. */
function compileStrike(entry: StrikeEntry): RegExp {
  const boundary = entry.boundary ?? 'en';
  const wrap =
    boundary === 'de'
      ? wordBoundaryDe
      : boundary === 'fr'
        ? wordBoundaryFr
        : wordBoundary;
  const flags = entry.caseInsensitive === false ? '' : 'i';
  return new RegExp(wrap(escapeRegex(entry.term)), flags);
}

/**
 * Run a list of strike entries against a page body. Returns one finding per
 * (line, entry) hit. Honours `allowIn` per entry.
 */
export function runStrikes(
  entries: readonly StrikeEntry[],
  body: string,
  file: string,
): Finding[] {
  const findings: Finding[] = [];
  const compiled = entries.map((e) => [e, compileStrike(e)] as const);
  for (const { line, text } of iterProseLines(body)) {
    for (const [entry, re] of compiled) {
      if (entry.allowIn?.some((p) => p.test(text))) continue;
      if (re.test(text)) {
        const replace = entry.replace ? ` — replace with ${entry.replace}` : '';
        findings.push({
          file,
          line,
          rule: entry.id,
          detail: `"${entry.term}" — strike on sight${replace}`,
        });
      }
    }
  }
  return findings;
}

/**
 * Run a list of drift rules against a page body. Returns one finding per
 * (line, rule) hit. Honours `allowIn` per rule and `locales` filtering.
 */
export function runDriftRules(
  rules: readonly DriftRule[],
  body: string,
  file: string,
  locale: Locale,
): Finding[] {
  const findings: Finding[] = [];
  const applicable = rules.filter((r) => r.locales.includes(locale));
  for (const { line, text } of iterProseLines(body)) {
    for (const rule of applicable) {
      if (rule.allowIn?.some((p) => p.test(text))) continue;
      // Reset stateful regexes so global flags don't carry across lines.
      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(text);
      if (match) {
        const rationale = rule.rationale ? ` — ${rule.rationale}` : '';
        findings.push({
          file,
          line,
          rule: rule.id,
          detail: `"${match[0].trim()}" should be "${rule.target}"${rationale}`,
        });
      }
    }
  }
  return findings;
}
