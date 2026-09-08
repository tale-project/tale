/**
 * Markdown parsing shared by `collect.ts` and the rules — the box grammar, the
 * prefix declaration and the link scan. Pure string work, so a rule's test can
 * build a suite from a template literal.
 */
import type { Box, Suite } from './model';

/**
 * A box, exactly as `template.md` documents it:
 *
 *   - [ ] `SMOKE-4` · **the action** → what must be true.
 *
 * The ID and the tick are captured; the rest is judged by the suites rule,
 * which is where the "bold action, then a `→`" half of the grammar lives.
 */
const BOX = /^- \[( |x)\] `([^`]+)` · (.*)$/;

/** Anything that opens with a checkbox is meant to be a box. */
const BOX_LIKE = /^\s*[-*+] \[[ xX]\]/;

/** `> **Prefix** `A-` `B-` · …` — one or more backticked tokens. */
const PREFIX_LINE = /^>\s*\*\*Prefix\*\*((?:\s*`[^`]+`)+)/;

const BACKTICKED = /`([^`]+)`/g;

const FENCE = /^\s*(?:```|~~~)/;

/** Split a document into lines, flagging the ones inside a code fence. */
function scan(text: string): { text: string; line: number; fenced: boolean }[] {
  let fenced = false;
  return text.split('\n').map((line, index) => {
    if (FENCE.test(line)) {
      fenced = !fenced;
      return { text: line, line: index + 1, fenced: true };
    }
    return { text: line, line: index + 1, fenced };
  });
}

/**
 * Drop fenced blocks and inline code spans. A link inside backticks is an
 * example of a link, not one — the journal's own column rules show
 * `[R7](r0007.md)` to explain the format, and a round must not be invented for
 * it.
 */
function withoutCode(text: string): string {
  return text
    .replace(/^\s*(?:```|~~~)[\s\S]*?^\s*(?:```|~~~)\s*$/gm, '')
    .replace(/`[^`]*`/g, '');
}

/** Every markdown link target in a document, in order. */
export function linkTargets(text: string): string[] {
  return [...withoutCode(text).matchAll(/\]\(([^)\s]+)\)/g)].map(
    (match) => match[1],
  );
}

/** Every backticked token in a document, deduplicated, in order. */
export function backtickedTokens(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(BACKTICKED)) seen.add(match[1]);
  return [...seen];
}

/** A box's continuation lines are indented; anything else ends it. */
const CONTINUATION = /^\s{2,}\S/;

/** Parse one suite file into the model. */
export function parseSuite(name: string, path: string, text: string): Suite {
  const lines = scan(text);
  const boxes: Box[] = [];
  const malformed: { line: number; text: string }[] = [];
  const headings: string[] = [];
  let prefixes: string[] = [];
  let prefixLine = 0;
  let open: Box | undefined;

  for (const { text: line, line: number_, fenced } of lines) {
    if (open && !fenced && CONTINUATION.test(line) && !BOX_LIKE.test(line)) {
      open.body = `${open.body} ${line.trim()}`;
      continue;
    }
    open = undefined;
    if (fenced) continue;
    if (line.startsWith('#')) {
      headings.push(line.replace(/^#+\s*/, '').trim());
      continue;
    }
    if (prefixLine === 0) {
      const declared = PREFIX_LINE.exec(line);
      if (declared) {
        prefixLine = number_;
        prefixes = [...declared[1].matchAll(BACKTICKED)].map((m) => m[1]);
        continue;
      }
    }
    if (!BOX_LIKE.test(line)) continue;
    const box = BOX.exec(line);
    if (!box) {
      malformed.push({ line: number_, text: line });
      continue;
    }
    const [, tick, id, rest] = box;
    open = { id, line: number_, ticked: tick !== ' ', body: rest };
    boxes.push(open);
  }

  return { name, path, prefixes, prefixLine, boxes, headings, malformed };
}
