// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A stream ends. One that has a chunk ready every time it is asked, and no
 * end, is safe only for as long as its reader stops by itself, and a reader
 * that stops by itself (a size limit, a declared length, backpressure) is
 * what the test that builds such a stream is there to prove. The day the
 * reader regresses it reads on, into memory, and nothing stops it: a `pull`
 * that enqueues at once keeps its reader in microtasks, so no timer runs,
 * the test's own timeout among them, and the process grows until the kernel
 * kills it. A mutation run of the app door's body limit did exactly that
 * (tale-project/tale#4942): one worker held 95 GB before the kernel stepped
 * in, and took the rest of the machine's work with it.
 *
 * So a stream is long, never endless. Its `pull` ends it (`close`, `error`,
 * a `throw`), stands still (a promise it creates), waits (`await`), or
 * decides (any branch): then a reader that reads on reaches an end, or a
 * timer gets its turn, and the test fails as a test.
 *
 * This parses every source file of the platform that builds a
 * `ReadableStream` and fails on a `pull` that enqueues and does none of
 * those: straight-line code that hands out a chunk each time it is asked.
 * It reads a `pull` written where the stream is built; one handed in by
 * name is not followed.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** Build output and what is not source. */
const SKIPPED = new Set([
  'node_modules',
  'dist',
  'dist-seo',
  'backend-dist',
  'backend-dist-ascii',
  'public',
  'messages',
]);

function sourceFiles(dir = PLATFORM_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED.has(entry.name) || entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|mts|mjs)$/.test(entry.name) ? [full] : [];
  });
}

type Pull = ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** The `pull` written in the object a `new ReadableStream(…)` is given. */
function pullOf(stream: ts.NewExpression): Pull | undefined {
  const source = stream.arguments?.[0];
  if (source === undefined || !ts.isObjectLiteralExpression(source)) {
    return undefined;
  }
  for (const member of source.properties) {
    const name = member.name;
    if (name === undefined) continue;
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) continue;
    if (name.text !== 'pull') continue;
    if (ts.isMethodDeclaration(member)) return member;
    if (
      ts.isPropertyAssignment(member) &&
      (ts.isArrowFunction(member.initializer) ||
        ts.isFunctionExpression(member.initializer))
    ) {
      return member.initializer;
    }
  }
  return undefined;
}

const DECIDES = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

function isFunction(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Whether a `pull` hands out a chunk each time it is asked, with nothing
 * in it that could end the stream, hold it still, wait, or decide. */
function handsOutWithoutEnd(pull: Pull): boolean {
  let enqueues = false;
  let mayStop = false;
  const visit = (node: ts.Node, nested: boolean): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const called = node.expression.name.text;
      // A chunk enqueued from a callback comes when the callback runs, at
      // some other time than the asking: that is no chunk per ask.
      if (called === 'enqueue' && !nested) enqueues = true;
      if (called === 'close' || called === 'error') mayStop = true;
    }
    if (
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isSwitchStatement(node) ||
      ts.isThrowStatement(node) ||
      ts.isAwaitExpression(node) ||
      (ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Promise') ||
      (ts.isBinaryExpression(node) && DECIDES.has(node.operatorToken.kind))
    ) {
      mayStop = true;
    }
    ts.forEachChild(node, (child) => visit(child, nested || isFunction(node)));
  };
  // The body is a block, or the one expression of an arrow.
  if (pull.body !== undefined) visit(pull.body, false);
  return enqueues && !mayStop;
}

/** The lines of a source text where an endless stream is built. */
function endlessStreams(fileName: string, text: string): number[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'ReadableStream'
    ) {
      const pull = pullOf(node);
      if (pull !== undefined && handsOutWithoutEnd(pull)) {
        lines.push(
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

const stream = (pull: string): string =>
  `const body = new ReadableStream<Uint8Array>({ ${pull} });`;

describe('a stream ends', () => {
  it.each([
    [
      'a chunk each time it is asked',
      'pull(controller) { pulled += 1; controller.enqueue(piece); }',
    ],
    [
      'the same, as an arrow',
      'pull: (controller) => { controller.enqueue(new Uint8Array(33)); }',
    ],
    ['the same, in one expression', 'pull: (c) => c.enqueue(piece)'],
    [
      'the same, declared async',
      'async pull(controller) { controller.enqueue(piece); }',
    ],
  ])('sees an endless stream: %s', (_name, pull) => {
    expect(endlessStreams('sample.test.ts', stream(pull))).toEqual([1]);
  });

  it.each([
    [
      'one that closes',
      'pull(c) { if (left === 0) { c.close(); return; } left -= 1; c.enqueue(piece); }',
    ],
    [
      'one that closes after its last piece',
      'pull(c) { left -= 1; c.enqueue(piece); if (left === 0) c.close(); }',
    ],
    [
      'one that fails',
      'pull(c) { c.enqueue(piece); c.error(new Error("x")); }',
    ],
    [
      'one that stands still',
      'pull(c) { c.enqueue(piece); return new Promise<void>(() => {}); }',
    ],
    [
      'one that waits for something',
      'async pull(c) { await tick(); c.enqueue(piece); }',
    ],
    [
      'one whose chunks come from a callback',
      'pull(c) { setTimeout(() => c.enqueue(piece), 10); }',
    ],
    [
      'one that hands out what it is given',
      'pull(c) { next() && c.enqueue(piece); }',
    ],
    ['one with no pull', 'start(c) { c.enqueue(piece); c.close(); }'],
    ['one that enqueues nothing', 'pull() { pulled += 1; }'],
  ])('leaves alone %s', (_name, pull) => {
    expect(endlessStreams('sample.test.ts', stream(pull))).toEqual([]);
  });

  it('builds no endless stream anywhere in the platform', () => {
    const found = sourceFiles().flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('ReadableStream')) return [];
      return endlessStreams(file, text).map(
        (line) => `${path.relative(PLATFORM_ROOT, file)}:${line}`,
      );
    });

    expect(
      found,
      'each of these streams has a chunk ready every time it is asked and ' +
        'no end: give it one (close it after its last piece), so that a ' +
        'reader that reads on fails its test and not the machine',
    ).toEqual([]);
  });
});
