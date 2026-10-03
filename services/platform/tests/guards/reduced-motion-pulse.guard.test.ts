// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A pulse opts out of motion where it is written. Tailwind's `animate-pulse`
 * loops for as long as its element is mounted: the board's "Agent is
 * working…" glyph does so for a whole agent run. Under `prefers-reduced-motion:
 * reduce` the stylesheet's global rule (`packages/ui/src/globals.css`) cuts
 * every animation to one 0.01 ms iteration, yet the element still names its
 * animation and plays it once. The design system's own pulses
 * (`StatusIndicator`, `SKELETON_PULSE` in `@tale/ui/skeleton`) stop outright,
 * so their animation computes to `none`, and so does every other pulse
 * (#4128), in one of three ways:
 *
 * - `motion-safe:animate-pulse`, which animates only without the preference;
 * - `animate-pulse motion-reduce:animate-none` in the same class expression;
 * - a class applied only behind a reduced-motion check
 *   (`!prefersReducedMotion && 'animate-pulse'`).
 *
 * This walks every non-test `.ts` and `.tsx` under `services/platform/app`
 * and `packages/ui/src`, reads each string literal as a class list, and fails
 * on an `animate-pulse` class with none of the three. A class list that
 * reaches the element through a variable is beyond the walk, which is what
 * `SKELETON_PULSE` and `StatusIndicator`'s `pulse` are for. The platform's
 * `test` task hashes `packages/ui/src` for this read
 * (`services/platform/turbo.json`).
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

const ROOTS = ['services/platform/app', 'packages/ui/src'];

/** A condition that reads the reduced-motion preference. */
const REDUCED_MOTION_CHECK = /reduced?motion/i;

interface Violation {
  file: string;
  line: number;
  /** The class list that pulses, its whitespace collapsed. */
  text: string;
}

interface ClassToken {
  variants: string[];
  utility: string;
}

/** Split a class list into variants and utility: `motion-safe:animate-pulse`
 * is `{ variants: ['motion-safe'], utility: 'animate-pulse' }`. */
function classTokens(text: string): ClassToken[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const parts = raw.replaceAll('!', '').split(':');
      return { variants: parts.slice(0, -1), utility: parts.at(-1) ?? '' };
    });
}

/** A pulse that still animates under `prefers-reduced-motion: reduce`. */
function pulsesUnderReducedMotion(text: string): boolean {
  return classTokens(text).some(
    ({ variants, utility }) =>
      utility === 'animate-pulse' && !variants.includes('motion-safe'),
  );
}

function stopsMotion(text: string): boolean {
  return classTokens(text).some(
    ({ variants, utility }) =>
      utility === 'animate-none' && variants.includes('motion-reduce'),
  );
}

function literalText(node: ts.Node): string | undefined {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }
  return undefined;
}

/** Where a class expression ends: the attribute, binding or property that
 * holds it, or the statement around it. */
function endsClassExpression(node: ts.Node): boolean {
  return (
    ts.isJsxAttribute(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isReturnStatement(node) ||
    ts.isExpressionStatement(node) ||
    ts.isFunctionLike(node) ||
    ts.isSourceFile(node)
  );
}

/** True when the class list at `literal` is applied only behind a
 * reduced-motion check, or its class expression also stops the motion. */
function optsOut(literal: ts.Node, sourceFile: ts.SourceFile): boolean {
  let expression: ts.Node = literal;
  for (
    let node = literal.parent;
    !endsClassExpression(node);
    node = node.parent
  ) {
    if (
      (ts.isConditionalExpression(node) &&
        REDUCED_MOTION_CHECK.test(node.condition.getText(sourceFile))) ||
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        REDUCED_MOTION_CHECK.test(node.left.getText(sourceFile)))
    ) {
      return true;
    }
    expression = node;
  }
  let stops = false;
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== undefined && stopsMotion(text)) stops = true;
    if (!stops) ts.forEachChild(node, visit);
  };
  visit(expression);
  return stops;
}

/** Every pulse in `src`, and those of them that keep moving. */
function inspect(
  file: string,
  src: string,
): { pulses: number; violations: Violation[] } {
  const sourceFile = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let pulses = 0;
  const found: Violation[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== undefined && /\banimate-pulse\b/.test(text)) {
      pulses += 1;
      if (pulsesUnderReducedMotion(text) && !optsOut(node, sourceFile)) {
        found.push({
          file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          text: text.replaceAll(/\s+/g, ' ').trim(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { pulses, violations: found };
}

function violations(file: string, src: string): Violation[] {
  return inspect(file, src).violations;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.includes('.test.')
    ) {
      out.push(full);
    }
  }
  return out;
}

function scan(): { pulses: number; violations: Violation[] } {
  let pulses = 0;
  const found: Violation[] = [];
  for (const root of ROOTS) {
    for (const full of sourceFiles(path.join(REPO_ROOT, root))) {
      const file = path.relative(REPO_ROOT, full).split(path.sep).join('/');
      const result = inspect(file, readFileSync(full, 'utf8'));
      pulses += result.pulses;
      found.push(...result.violations);
    }
  }
  return { pulses, violations: found };
}

describe('reduced-motion pulse guard', () => {
  const result = scan();

  it('stops every animate-pulse under prefers-reduced-motion', () => {
    expect(
      result.violations.map(
        ({ file, line, text }) => `${file}:${line}: "${text}"`,
      ),
      'write motion-safe:animate-pulse, or add motion-reduce:animate-none (SKELETON_PULSE, StatusIndicator pulse)',
    ).toEqual([]);
  });

  // A walk that reads nothing passes forever: hold it to the pulses the two
  // trees are known to write (StatusIndicator, SKELETON_PULSE, …).
  it('reads the pulses it guards', () => {
    expect(result.pulses).toBeGreaterThan(0);
  });

  // The rule reads source text: hold it to a sample of what it must catch,
  // and to what must stay allowed.
  it.each([
    '<Bot className="size-3.5 shrink-0 animate-pulse" aria-hidden="true" />',
    '<div className="bg-muted h-12 animate-pulse rounded-md" />',
    "<div className={cn('size-2', live && 'animate-pulse')} />",
    "const fill = 'bg-muted animate-pulse';",
    "cva('dot', { variants: { pulse: { true: 'animate-pulse' } } });",
    // Only motion-safe stops it: any other variant still moves.
    '<span className="hover:animate-pulse" />',
    'const dot = <span className={`size-2 ${tone} animate-pulse`} />;',
    // The opt-out of a sibling property does not cover this one.
    "cva('dot', { variants: { a: 'animate-pulse', b: 'motion-reduce:animate-none' } });",
  ])('catches %j', (sample) => {
    expect(violations('sample.tsx', sample)).not.toEqual([]);
  });

  it.each([
    '<Bot className="size-3.5 animate-pulse motion-reduce:animate-none" />',
    '<div className="rounded-full motion-safe:animate-pulse" />',
    "<div className={cn('size-5', !prefersReducedMotion && 'animate-pulse')} />",
    "<div className={reducedMotion ? 'opacity-70' : 'animate-pulse'} />",
    "<div className={cn('size-2', live && 'animate-pulse', 'motion-reduce:animate-none')} />",
    "pulse && 'animate-pulse motion-reduce:animate-none';",
    "<div className={cn('block h-1.5 rounded-full', SKELETON_PULSE)} />",
    // A selector names the class; it does not apply it.
    "root.querySelectorAll('[data-skeleton-mask], .animate-pulse');",
  ])('allows %j', (sample) => {
    expect(violations('sample.tsx', sample)).toEqual([]);
  });
});
