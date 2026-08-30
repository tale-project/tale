/**
 * Post-build assertion: greps the compiled binary for distinctive markers
 * that MUST be embedded for runtime correctness. Catches the regression
 * class where a `fs.readFile(...)`-from-`import.meta.url` pattern slips
 * past local-source testing but ENOENTs from the shipped binary.
 *
 * History: a CLI command shipped broken in the binary because its bash
 * script was loaded at runtime via `readFile` instead of inlined as a TS
 * template literal. `bun --compile` does not bundle runtime fs reads. This
 * check makes a recurrence loud.
 *
 * Run: bun run scripts/check-bundle.ts dist/tale[.exe]
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Strings the compiled binary MUST carry: the in-container command the CLI's
// machine channel runs. They exist only inside `control-call.ts`'s command
// template, so their absence means the channel stopped being compiled in —
// the regression this check exists to catch (a shell command assembled from
// a file at runtime is not bundled by `bun --compile`, and the failure only
// shows up on an operator's machine). Control-door PATHS are deliberately
// NOT used as markers: they also appear in error-message strings that survive
// bundling, so a broken channel would still pass (false negative).
const REQUIRED_MARKERS: ReadonlyArray<readonly [string, string]> = [
  [
    'Bearer $TALE_CONTROL_TOKEN',
    'control-call.ts (the token is expanded inside the container)',
  ],
  [
    '--data-binary @-',
    'control-call.ts (request bodies ride stdin, never argv)',
  ],
];

function main(): void {
  const binaryArg = process.argv[2];
  if (!binaryArg) {
    console.error('usage: bun run scripts/check-bundle.ts <path/to/dist/tale>');
    process.exit(2);
  }

  const binaryPath = resolve(process.cwd(), binaryArg);
  if (!existsSync(binaryPath)) {
    console.error(`check-bundle: binary not found at ${binaryPath}`);
    process.exit(2);
  }

  // Read as raw bytes and decode latin1: every byte maps 1:1 to a code
  // point so substring search works regardless of the binary's true
  // encoding. Strings embedded as UTF-8 (the default) survive this view.
  const bytes = readFileSync(binaryPath);
  const text = bytes.toString('latin1');

  const missing: Array<[string, string]> = [];
  for (const [marker, owner] of REQUIRED_MARKERS) {
    if (!text.includes(marker)) {
      missing.push([marker, owner]);
    }
  }

  if (missing.length === 0) {
    console.log(
      `check-bundle: OK (${REQUIRED_MARKERS.length} markers present in ${binaryPath})`,
    );
    return;
  }

  console.error('check-bundle: FAILED — missing required markers:');
  for (const [marker, owner] of missing) {
    console.error(`  - ${JSON.stringify(marker)}  (owner: ${owner})`);
  }
  console.error(
    '\nThe likely cause is a runtime `fs.readFile(import.meta.url + ...)` ' +
      'or similar — Bun --compile does not bundle runtime asset reads. ' +
      'Inline the asset as a TS template literal (see reseed-all-orgs.ts ' +
      'RESEED_SCRIPT and run-migrations.ts MIGRATE_SCRIPT).',
  );
  process.exit(1);
}

main();
