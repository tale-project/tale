// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A `backend:integration` run with ITEST_REQUIRE_ALL_LANES=1, the mode a
 * gating run uses, has to mean that every lane ran when it passes. Two
 * conventions make it so:
 *
 * - The harness's own variables (`ITEST_S3_*`, `ITEST_LANES`,
 *   `ITEST_REQUIRE_ALL_LANES`) are read through
 *   `backend/integration-lane-helpers.ts` alone, whose
 *   `fullCoverageBlockers` refuses to start a required run without them. A
 *   lane that read one itself could gate on it where no preflight looks. The
 *   rule is judged on the syntax tree, so a destructuring or an optional
 *   chain off `process.env` counts as a read, while a check's own words
 *   ("no ITEST_S3_ENDPOINT") do not.
 * - Every skip goes through `recordSkip`, which turns it into a failure in a
 *   required run. A lane that recorded its own `(SKIPPED)` pass, or only told
 *   the console it skipped something, would stay green there while part of
 *   it never ran.
 */

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend',
);
const HELPERS = 'integration-lane-helpers.ts';

/**
 * A lane module's name. The harness itself is `integration-check.ts`; the
 * modules it mounts are `*.integration.ts`, `*-integration.ts` or, for the
 * REST proofs it imports lazily, `*-check.ts`.
 */
function isLaneModule(name: string): boolean {
  return (
    name.endsWith('.integration.ts') ||
    name.endsWith('-integration.ts') ||
    name.endsWith('-check.ts')
  );
}

/** The harness and every lane module it mounts, relative to `backend/`. */
function laneFiles(dir = BACKEND_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return laneFiles(full);
    return isLaneModule(entry.name) ? [path.relative(BACKEND_ROOT, full)] : [];
  });
}

const LANE_FILES = laneFiles();

/** Line-by-line offenders of a text rule, as `file:line: text`. */
function lineOffenders(pattern: RegExp): string[] {
  return LANE_FILES.flatMap((file) =>
    readFileSync(path.join(BACKEND_ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
      ),
  );
}

/** Any variable of the harness's own namespace. */
const ITEST_NAME = /^ITEST_/;

/** The variables the helpers read for the harness, whatever holds them. */
const HARNESS_VARIABLE = /^ITEST_(S3_[A-Z0-9_]+|LANES|REQUIRE_ALL_LANES)$/;

/** The name a key position spells: `a.KEY`, `a['KEY']`, `{ [`KEY`]: b }`. */
function keyText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }
  return ts.isComputedPropertyName(node) ? keyText(node.expression) : null;
}

function isProcessEnv(node: ts.Node | undefined): boolean {
  return (
    node !== undefined &&
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'env' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process'
  );
}

/** The key an `ITEST_` read off `process.env` names, or null. */
function envReadKey(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
    return keyText(node.argumentExpression);
  }
  if (
    ts.isBindingElement(node) &&
    ts.isObjectBindingPattern(node.parent) &&
    ts.isVariableDeclaration(node.parent.parent) &&
    isProcessEnv(node.parent.parent.initializer)
  ) {
    return keyText(node.propertyName ?? node.name);
  }
  return null;
}

/**
 * Every place a lane reads an `ITEST_` variable in code rather than naming it
 * in words: any `ITEST_` key read off `process.env` (`.X`, `?.X`, `['X']`,
 * `?.[`X`]`, `const { X } = …`, `const { 'X': y } = …`), and any identifier
 * or bare string that is one of the harness's own variables, which catches
 * `const env = process.env; env.ITEST_LANES` and `process.env[name]` with
 * `name = 'ITEST_LANES'`.
 */
function itestReads(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const envKey = envReadKey(node);
    const hit =
      (envKey !== null && ITEST_NAME.test(envKey)) ||
      ((ts.isIdentifier(node) ||
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
        HARNESS_VARIABLE.test(node.text));
    if (hit) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      found.push(`${file}:${line + 1}: ${node.getText(sourceFile)}`);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe('backend:integration lanes', () => {
  it('include the harness and the lane modules it mounts', () => {
    expect(LANE_FILES).toContain('integration-check.ts');
    expect(LANE_FILES).toContain('auth/oidc-integration.ts');
    expect(LANE_FILES).toContain('rest/project-agents-check.ts');
    expect(LANE_FILES).toContain('rest/project-scope-check.ts');
    expect(LANE_FILES.length).toBeGreaterThan(40);
    expect(LANE_FILES).not.toContain(HELPERS);
  });

  it(`read the harness's variables only through ${HELPERS}`, () => {
    expect(
      LANE_FILES.flatMap((file) =>
        itestReads(file, readFileSync(path.join(BACKEND_ROOT, file), 'utf8')),
      ),
    ).toEqual([]);
  });

  it('read an ITEST_ variable in any spelling as a read', () => {
    const reads = (source: string) => itestReads('probe.ts', source).length;
    expect(reads('const a = process.env.ITEST_FOO;')).toBe(1);
    expect(reads('const a = process.env?.ITEST_BAR;')).toBe(1);
    expect(reads("const a = process.env['ITEST_BAR'];")).toBe(1);
    expect(reads('const a = process.env?.[`ITEST_BAR`];')).toBe(1);
    expect(reads('const { ITEST_FOO } = process.env;')).toBe(1);
    expect(reads("const { 'ITEST_FOO': foo } = process.env;")).toBe(1);
    expect(reads("const { ['ITEST_FOO']: foo } = process.env;")).toBe(1);
    expect(reads('const env = process.env; env.ITEST_S3_ENDPOINT;')).toBe(1);
    expect(reads("const key = 'ITEST_LANES'; process.env[key];")).toBe(1);
    // Words, and a lane's own ITEST_-named data, are no read.
    expect(reads("record('x', false, 'no ITEST_S3_ENDPOINT here');")).toBe(0);
    expect(reads("const secrets = ['ITEST_LIVE_SECRET'];")).toBe(0);
    expect(reads('const ok = resolved.data.env.ITEST_TOKEN === "t";')).toBe(0);
    expect(reads('await signIn({ password: ITEST_PASSWORD });')).toBe(0);
  });

  it('record every skip through recordSkip', () => {
    expect([
      ...lineOffenders(/SKIPPED/),
      ...lineOffenders(/\(\s*skipped\s*\)/i),
    ]).toEqual([]);
  });

  it('never tell only the console that a lane skipped something', () => {
    expect(lineOffenders(/console\.\w+\([^)]*\bskip/i)).toEqual([]);
  });
});
