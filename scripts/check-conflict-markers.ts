#!/usr/bin/env bun
/*
  Refuse git merge-conflict markers in tracked text files.

  A merge or rebase that stops on a conflict writes `<<<<<<<`, `|||||||` (the
  base section of a diff3 conflict) and `>>>>>>>` lines into the file, and a
  resolution that stopped halfway can be committed that way. Nothing else in
  the gate reads every file: the formatter leaves some markdown alone, and a
  markdown or shell file with markers still parses. So this refuses them in
  every file git tracks (`bun run lint:conflicts`, run by CI and by
  `bun run check`), or only in the files it is given (the pre-commit hook
  passes the staged ones). The lone `=======` between the sides is left
  alone: it is also a markdown heading underline, and a real conflict always
  carries its start and end lines.
*/
import { spawnSync } from 'node:child_process';

const MARKER = '^(<{7}|[|]{7}|>{7})( |$)';

const files = process.argv.slice(2);
const grep = spawnSync(
  'git',
  ['grep', '--line-number', '-I', '-E', MARKER, '--', ...files],
  { encoding: 'utf8' },
);

// git grep answers 1 when nothing matched, 0 with matches, 2+ on an error.
if (grep.status === 1) process.exit(0);
if (grep.status !== 0) {
  console.error(`git grep failed (${grep.status}): ${grep.stderr.trim()}`);
  process.exit(2);
}
console.error(
  'Merge-conflict markers left in the files below; resolve the conflict, then stage the result:',
);
console.error(grep.stdout.trimEnd());
process.exit(1);
