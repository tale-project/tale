/**
 * Generate `public/openapi.json` — the spec behind the Swagger UI at `/docs`.
 *
 * The document itself is built in `scripts/openapi/spec.ts` — side-effect
 * free, so `scripts/openapi/spec.test.ts` can hold it against the `/api/v1`
 * router (every path+method is a registered route and vice versa) and
 * against the handlers' real response shapes; this entry point only writes
 * it out. When you add, move, or remove a `/api/v1` route, or change what
 * one answers, `spec.ts` changes in the same commit and this script is
 * re-run.
 *
 * Run with `bun run generate:openapi` (then let the repo formatter settle
 * the JSON). Output is deterministic: no network, no deployment, no
 * timestamps.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSpec } from './openapi/spec.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const platformDir = join(__dirname, '..');

function main() {
  const outputPath = join(platformDir, 'public', 'openapi.json');
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(buildSpec(), null, 2), 'utf-8');
  console.log(`OpenAPI spec written to ${outputPath}`);
}

main();
