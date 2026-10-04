import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';

const source = JSON.parse(
  await readFile(`${process.env.BENCH_OUTPUT}/sources.json`, 'utf8'),
);
assert.equal(source.status, 'ready', 'Source verification did not complete');
assert.match(source.node, /^[0-9]+\.[0-9]+\.[0-9]+$/);
assert(process.env.GITHUB_OUTPUT, 'Expected Actions output path');
await appendFile(process.env.GITHUB_OUTPUT, `version=${source.node}\n`);
