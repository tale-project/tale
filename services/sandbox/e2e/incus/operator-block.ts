// The commands services/sandbox/docs/incus.md tells an operator to run on the
// node, read out of the document itself. The end-to-end lab runs this very text
// (lab.sh `operator`), so the example an operator copies is the one the backend
// was tested against, and it cannot drift: a change to the example is a change
// to the test.
//
// The block is the first fenced block after OPERATOR_MARKER.
//
//   bun e2e/incus/operator-block.ts      prints it to stdout

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Sits on its own line right above the fenced block. */
export const OPERATOR_MARKER = '<!-- e2e:operator-setup -->';

const DOCUMENT = resolve(import.meta.dir, '../../docs/incus.md');
const FENCE = /^```/;

export function operatorBlock(markdown: string): string {
  const lines = markdown.split('\n');
  const marker = lines.findIndex((line) => line.trim() === OPERATOR_MARKER);
  if (marker === -1) {
    throw new Error(`docs/incus.md has no ${OPERATOR_MARKER} line`);
  }
  const open = lines.findIndex(
    (line, index) => index > marker && FENCE.test(line),
  );
  if (open === -1) {
    throw new Error(`no fenced block follows ${OPERATOR_MARKER}`);
  }
  const close = lines.findIndex(
    (line, index) => index > open && FENCE.test(line),
  );
  if (close === -1) {
    throw new Error(`the block that follows ${OPERATOR_MARKER} never closes`);
  }
  // Nothing but blank lines may sit between the marker and the fence: a
  // paragraph there would mean the marker belongs to something else.
  if (lines.slice(marker + 1, open).some((line) => line.trim() !== '')) {
    throw new Error(`${OPERATOR_MARKER} is not directly above its block`);
  }
  const block = lines.slice(open + 1, close).join('\n');
  if (block.trim() === '') throw new Error('the operator block is empty');
  return `${block}\n`;
}

export function readOperatorBlock(path: string = DOCUMENT): string {
  return operatorBlock(readFileSync(path, 'utf8'));
}

if (import.meta.main) {
  process.stdout.write(readOperatorBlock());
}
