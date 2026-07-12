/**
 * Portability guards for shipped skill code. They enforce the "call the
 * underlying code the same way regardless of where the skill runs" contract on
 * the SOURCE tree (`builtin-configs/skills/<name>/`), before anything is synced.
 */

import { parseDocument } from 'yaml';

import { isShipExcluded } from './exclude';
import type { FileTree } from './tree';

// ---------------------------------------------------------------------------
// Guard 1 — self-contained imports.
//
// A deployed skill has no node_modules next to it (it runs from
// `${TALE_CONFIG_DIR}/<org>/skills/<slug>/` in the sandbox), so a shipped TS
// script may import only things guaranteed to resolve there: node builtins, bun
// builtins, and relative paths inside its own bundle.
// ---------------------------------------------------------------------------

/** A disallowed import found in a shipped TypeScript skill script. */
export interface ImportViolation {
  readonly skill: string;
  /** Skill-relative path of the offending script. */
  readonly file: string;
  /** The disallowed module specifier. */
  readonly specifier: string;
}

/**
 * Classify an import specifier against the self-contained contract. Allowed:
 * relative paths (resolve inside the skill), `node:*` builtins, and `bun` /
 * `bun:*` builtins. Anything else — a bare npm specifier or an absolute path —
 * is disallowed.
 */
export function classifyImport(specifier: string): 'ok' | 'bad' {
  if (specifier.startsWith('./') || specifier.startsWith('../')) return 'ok';
  if (specifier.startsWith('node:')) return 'ok';
  if (specifier === 'bun' || specifier.startsWith('bun:')) return 'ok';
  return 'bad';
}

const importScanner = new Bun.Transpiler({ loader: 'ts' });

/**
 * Drop a leading `#!/usr/bin/env bun` shebang — skill scripts ship with one (so
 * they are directly executable), but Bun's import lexer rejects it.
 */
function stripShebang(code: string): string {
  if (!code.startsWith('#!')) return code;
  const newline = code.indexOf('\n');
  return newline === -1 ? '' : code.slice(newline + 1);
}

/**
 * Scan every shipped `scripts/**` / `*.ts` in a skill's source tree for
 * disallowed imports. Uses Bun's real import lexer (catches static `import`,
 * dynamic `import()`, and `require()`), not a regex, so strings/comments never
 * false-positive. Test files are excluded — they never ship and may use dev-only
 * imports.
 */
export function checkImports(
  skill: string,
  source: FileTree,
): ImportViolation[] {
  const violations: ImportViolation[] = [];
  for (const [rel, bytes] of source) {
    if (!rel.startsWith('scripts/') || !rel.endsWith('.ts')) continue;
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (isShipExcluded(base)) continue;
    const code = stripShebang(new TextDecoder().decode(bytes));
    for (const imported of importScanner.scanImports(code)) {
      if (classifyImport(imported.path) === 'bad') {
        violations.push({ skill, file: rel, specifier: imported.path });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Guard 2 — live command references.
//
// Every `bun scripts/…` / `python scripts/…` an agent is told to run in a
// SKILL.md must point at a script that actually exists, or the instructions ship
// broken.
// ---------------------------------------------------------------------------

/** A SKILL.md command that points at a script which does not exist. */
export interface CommandRefViolation {
  readonly skill: string;
  /** The referenced skill-relative script path, or a sentinel for a missing SKILL.md. */
  readonly referenced: string;
}

/**
 * Matches `bun scripts/x.ts`, `bun run scripts/x.ts`, `python scripts/office/y.py`,
 * etc. Anchored on the runner keyword and restricted to same-line whitespace
 * (`[ \t]`) so a prose mention (`see scripts/x.py`) and a flagged non-script
 * invocation (`python -m markitdown`, no `scripts/` token) do not match.
 */
const COMMAND_RE =
  /\b(?:bun|python3?)[ \t]+(?:run[ \t]+)?(?:-\w+[ \t]+)*?(scripts\/[A-Za-z0-9._/-]+\.(?:ts|js|mjs|py))\b/g;

/**
 * Assert every script a skill's SKILL.md tells an agent to run actually exists
 * in the skill's tree — catching doc↔code drift (a renamed/deleted script the
 * instructions still reference). De-duplicates repeated references.
 */
export function checkCommandRefs(
  skill: string,
  source: FileTree,
): CommandRefViolation[] {
  const skillMd = source.get('SKILL.md');
  if (skillMd === undefined) {
    return [{ skill, referenced: '<SKILL.md missing>' }];
  }
  const text = new TextDecoder().decode(skillMd);
  const violations: CommandRefViolation[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(COMMAND_RE)) {
    const ref = match[1];
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (!source.has(ref)) violations.push({ skill, referenced: ref });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Guard 3 — strict-YAML frontmatter.
//
// Every harness that reads a SKILL.md parses its `---` frontmatter block as
// YAML. Our sync is byte-level and never parsed it, so frontmatter that trips a
// strict parser (the classic being a `: ` colon-space inside an unquoted
// `description:`, read as a nested mapping) shipped green here and choked
// downstream. This guard parses the block with a strict YAML parser and asserts
// the shape every harness relies on: a mapping with a non-empty string `name`
// (matching the skill directory) and a non-empty string `description`. Extra
// keys (e.g. `license` on the document skills) are allowed.
// ---------------------------------------------------------------------------

/** A SKILL.md whose YAML frontmatter is malformed or fails the required shape. */
export interface FrontmatterViolation {
  readonly skill: string;
  /** Human-readable problem, with a `SKILL.md` line reference where available. */
  readonly problem: string;
}

/**
 * Capture the YAML body of a leading `---` fenced frontmatter block. Anchored at
 * the start of the file; the closing fence is a `---` line (end-of-file allowed
 * for a block with no trailing body).
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Validate a skill's SKILL.md frontmatter as strict YAML. Reports: a missing
 * frontmatter block, a YAML parse error (with line), a non-mapping document, a
 * missing/empty/non-string `name` or one that does not match the skill
 * directory, and a missing/empty/non-string `description`. A missing SKILL.md is
 * left to {@link checkCommandRefs} to report.
 */
export function checkFrontmatter(
  skill: string,
  expectedName: string,
  source: FileTree,
): FrontmatterViolation[] {
  const skillMd = source.get('SKILL.md');
  if (skillMd === undefined) return [];
  const text = new TextDecoder().decode(skillMd);
  const match = FRONTMATTER_RE.exec(text);
  if (match === null) {
    return [
      {
        skill,
        problem:
          'SKILL.md has no YAML frontmatter block (it must open with a `---` fenced block)',
      },
    ];
  }

  const doc = parseDocument(match[1]);
  if (doc.errors.length > 0) {
    const err = doc.errors[0];
    // The frontmatter body starts on file line 2 (line 1 is the opening `---`).
    const line = (err.linePos?.[0]?.line ?? 1) + 1;
    const detail = err.message.replace(/ at line \d+, column \d+:[\s\S]*$/, '');
    return [
      {
        skill,
        problem: `SKILL.md frontmatter is not valid YAML at line ${line}: ${detail}`,
      },
    ];
  }

  const value = doc.toJS() as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [
      {
        skill,
        problem:
          'SKILL.md frontmatter must be a YAML mapping of `key: value` pairs',
      },
    ];
  }

  const record = value as Record<string, unknown>;
  const violations: FrontmatterViolation[] = [];
  const { name, description } = record;
  if (typeof name !== 'string' || name.trim() === '') {
    violations.push({
      skill,
      problem:
        'SKILL.md frontmatter `name` is missing or not a non-empty string',
    });
  } else if (name !== expectedName) {
    violations.push({
      skill,
      problem: `SKILL.md frontmatter \`name\` is "${name}" but must match the skill directory "${expectedName}"`,
    });
  }
  if (typeof description !== 'string' || description.trim() === '') {
    violations.push({
      skill,
      problem:
        'SKILL.md frontmatter `description` is missing or not a non-empty string',
    });
  }
  return violations;
}
