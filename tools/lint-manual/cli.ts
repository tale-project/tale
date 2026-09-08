#!/usr/bin/env bun
/**
 * `bun run lint:manual` — the manual-test layer's own gate.
 *
 * Two lines on purpose: everything worth testing is in src/, and this entry
 * point is exercised end to end as a subprocess by tests/cli.test.ts. The
 * optional argument is the checkout to lint; it defaults to this one.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lint } from './src/lint';

const here = path.dirname(fileURLToPath(import.meta.url));

process.exit(
  lint({
    root: path.resolve(process.argv[2] ?? path.join(here, '../..')),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  }),
);
