// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A `backend:integration` check that judges elapsed wall-clock time states
 * the tolerance it judges against (#5433). The suite runs on shared CI
 * runners whose speed varies run to run; a bare `elapsedMs < 2_000` reads as
 * a property of the code while it is a guess about the machine, and when the
 * guess is wrong the red lands on an unrelated change. So the bound an
 * elapsed time is compared with is a named `…TOLERANCE_MS` constant (or a
 * `toleranceMs` parameter), and the constant carries a doc comment that says
 * what it tolerates and why that is enough.
 *
 * An elapsed time is what this guard can see on the syntax tree: a clock
 * read (`Date.now()`, `performance.now()`) minus a variable that was itself
 * set from a clock read, directly or through the variable that holds it. A
 * deadline (`Date.now() < deadline`) judges nothing and is not one.
 */

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend',
);

/** The harness (`integration-check.ts`) and every lane module it mounts:
 * `*.integration.ts`, `*-integration.ts` and the `*-check.ts` REST proofs. */
function isLaneModule(name: string): boolean {
  return (
    name.endsWith('.integration.ts') ||
    name.endsWith('-integration.ts') ||
    name.endsWith('-check.ts')
  );
}

/** Lane modules, and the helpers they share, relative to `backend/`. */
function laneFiles(dir = BACKEND_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return laneFiles(full);
    return isLaneModule(entry.name) ||
      entry.name === 'integration-lane-helpers.ts'
      ? [path.relative(BACKEND_ROOT, full)]
      : [];
  });
}

/** The name a tolerance goes by. */
const TOLERANCE_NAME = /(^|_)TOLERANCE_MS$|^toleranceMs$|ToleranceMs$/;

const COMPARISONS = new Set([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    // `Math.round(elapsed)` and the like are still the elapsed time.
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === 'Math' &&
      current.arguments.length === 1 &&
      current.arguments[0] !== undefined
    ) {
      current = current.arguments[0];
      continue;
    }
    return current;
  }
}

/** `Date.now()` or `performance.now()`. */
function isClockRead(node: ts.Expression): boolean {
  const call = unwrap(node);
  return (
    ts.isCallExpression(call) &&
    call.arguments.length === 0 &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'now' &&
    ts.isIdentifier(call.expression.expression) &&
    ['Date', 'performance'].includes(call.expression.expression.text)
  );
}

/** The name a declaration or an assignment gives its value, and the value. */
function bindings(source: ts.SourceFile): [string, ts.Expression][] {
  const found: [string, ts.Expression][] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      found.push([node.name.text, node.initializer]);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      found.push([node.left.text, node.right]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

interface FileFacts {
  file: string;
  source: ts.SourceFile;
  /** Every elapsed-time comparison whose bound is not a named tolerance, as
   * `file:line: text`. */
  bare: string[];
  /** The tolerance names its elapsed-time comparisons use. */
  used: Set<string>;
}

function inspect(file: string, text: string): FileFacts {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const all = bindings(source);
  const marks = new Set(
    all.filter(([, value]) => isClockRead(value)).map(([name]) => name),
  );
  const isElapsed = (node: ts.Expression): boolean => {
    const inner = unwrap(node);
    return (
      ts.isBinaryExpression(inner) &&
      inner.operatorToken.kind === ts.SyntaxKind.MinusToken &&
      isClockRead(inner.left) &&
      ts.isIdentifier(unwrap(inner.right)) &&
      marks.has((unwrap(inner.right) as ts.Identifier).text)
    );
  };
  const elapsed = new Set(
    all.filter(([, value]) => isElapsed(value)).map(([name]) => name),
  );
  const measures = (node: ts.Expression): boolean => {
    const inner = unwrap(node);
    return (
      isElapsed(inner) || (ts.isIdentifier(inner) && elapsed.has(inner.text))
    );
  };
  const boundName = (node: ts.Expression): string | null => {
    const inner = unwrap(node);
    if (ts.isIdentifier(inner)) return inner.text;
    if (ts.isPropertyAccessExpression(inner)) return inner.name.text;
    return null;
  };

  const bare: string[] = [];
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      COMPARISONS.has(node.operatorToken.kind)
    ) {
      const bound = measures(node.left)
        ? node.right
        : measures(node.right)
          ? node.left
          : null;
      if (bound !== null) {
        const name = boundName(bound);
        if (name !== null && TOLERANCE_NAME.test(name)) {
          used.add(name);
        } else {
          const { line } = source.getLineAndCharacterOfPosition(
            node.getStart(source),
          );
          bare.push(`${file}:${line + 1}: ${node.getText(source)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { file, source, bare, used };
}

/** Every `const NAME = …` the files declare at any depth, with whether a doc
 * comment (`/** … *\/`) leads its statement. */
function constantDocs(facts: FileFacts[]): Map<string, boolean> {
  const docs = new Map<string, boolean>();
  for (const { source } of facts) {
    const visit = (node: ts.Node): void => {
      if (ts.isVariableStatement(node)) {
        const comments =
          ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
        const documented = comments.some((range) =>
          source.text.slice(range.pos, range.end).startsWith('/**'),
        );
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            docs.set(
              declaration.name.text,
              (docs.get(declaration.name.text) ?? false) || documented,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return docs;
}

const FACTS = laneFiles().map((file) =>
  inspect(file, readFileSync(path.join(BACKEND_ROOT, file), 'utf8')),
);

describe('integration checks that judge elapsed time state their tolerance', () => {
  it('compares an elapsed time only with a named tolerance', () => {
    expect(
      FACTS.flatMap((facts) => facts.bare),
      'an elapsed time is compared with a bare number or an unnamed bound — name the bound …TOLERANCE_MS (or a toleranceMs parameter) and document what it tolerates (#5433)',
    ).toEqual([]);
  });

  it('documents every tolerance constant the comparisons use', () => {
    const docs = constantDocs(FACTS);
    const undocumented = [...new Set(FACTS.flatMap((f) => [...f.used]))]
      .filter((name) => /^[A-Z]/.test(name))
      .filter((name) => docs.get(name) !== true)
      .sort();
    expect(
      undocumented,
      'a tolerance constant is declared without a doc comment saying what it tolerates, or is declared outside the lane modules and their helpers',
    ).toEqual([]);
  });

  it('sees the elapsed-time comparisons the lanes make', () => {
    // The rules above pass vacuously if the scan finds nothing: the lanes
    // judge elapsed time in several places today.
    expect(
      FACTS.reduce((count, facts) => count + facts.used.size, 0),
    ).toBeGreaterThan(0);
  });

  it('tells an elapsed-time judgement from a deadline and a timestamp', () => {
    const facts = inspect(
      'example.integration.ts',
      [
        'const started = Date.now();',
        'const elapsedMs = Date.now() - started;',
        'const deadline = Date.now() + 1_000;',
        'const cutoff = Date.now() - DAY_MS;',
        'ok(elapsedMs < 2_000);',
        'ok(Math.round(performance.now() - started) <= LIMIT);',
        'ok(elapsedMs < SETTLE_TOLERANCE_MS);',
        'ok(Date.now() < deadline);',
        'ok(cutoff > 0);',
      ].join('\n'),
    );
    expect(facts.bare).toEqual([
      'example.integration.ts:5: elapsedMs < 2_000',
      'example.integration.ts:6: Math.round(performance.now() - started) <= LIMIT',
    ]);
    expect([...facts.used]).toEqual(['SETTLE_TOLERANCE_MS']);
  });
});
