#!/usr/bin/env bun
/*
  Warn when the running Bun is not the version the repository pins.

  The root `package.json` pins Bun in `packageManager` (`bun@<version>`); CI,
  the setup actions and every image run that version, held to it by
  `tools/cli/scripts/bun-toolchain.test.ts`. Nothing held a contributor's own
  Bun to it: a machine on 1.3.10 produced about twenty failures and hangs
  that pass on the pin, and each read like a regression (#4734). Nor does
  `bun install`: it checks neither `packageManager` nor `engines.bun`
  (2026-10). So `bun run check` and the root test scripts run this first
  (`bun run bun:check`).

  It only warns and always exits 0: a newer patch release is often fine, a
  sandbox may have no way to install another Bun, and the dev pre-flight
  (`services/platform/scripts/setup-check.ts`) already refuses Bun below the
  floor the workspace needs. The version is read from `package.json`, never
  copied here, and the script imports no package, so it still runs when
  `node_modules` was installed by another Bun or not at all.
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MANIFEST = fileURLToPath(new URL('../package.json', import.meta.url));

/** `bun@<version>` (a release or a prerelease), with or without corepack's
 *  `+<algorithm>.<hash>` suffix. */
const PIN = /^bun@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+\S+)?$/;

/** The Bun version a manifest pins in `packageManager`, or null when it pins
 *  none (no field, another package manager, no exact version). */
export function pinnedBunVersion(manifest: unknown): string | null {
  if (typeof manifest !== 'object' || manifest === null) return null;
  if (!('packageManager' in manifest)) return null;
  const pin = manifest.packageManager;
  if (typeof pin !== 'string') return null;
  return PIN.exec(pin)?.[1] ?? null;
}

/** The command bun.com/docs/installation gives for installing one version. */
function installCommand(version: string, platform: NodeJS.Platform): string {
  return platform === 'win32'
    ? `iex "& {$(irm https://bun.com/install.ps1)} -Version ${version}"`
    : `curl -fsSL https://bun.com/install | bash -s "bun-v${version}"`;
}

/** What to print before the command runs: nothing when the running Bun is the
 *  pinned one, a framed warning when it differs, a one-line note when the
 *  manifest pins no Bun at all. */
export function bunVersionWarning(
  running: string,
  manifest: unknown,
  platform: NodeJS.Platform,
): string | null {
  const pinned = pinnedBunVersion(manifest);
  if (pinned === null)
    return 'Bun version not checked: package.json pins no Bun ("packageManager": "bun@<version>").';
  if (running === pinned) return null;
  const rule = '─'.repeat(72);
  return [
    rule,
    `WARNING: Bun ${running} is running, but package.json pins Bun ${pinned}.`,
    `CI runs ${pinned}. On another version, tests can fail or hang in ways that`,
    'look like regressions. Install the pinned version and run this again:',
    '',
    `  ${installCommand(pinned, platform)}`,
    rule,
  ].join('\n');
}

if (import.meta.main) {
  try {
    const manifest: unknown = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const warning = bunVersionWarning(Bun.version, manifest, process.platform);
    if (warning !== null) console.error(warning);
  } catch (error) {
    // Only a warning: an unreadable manifest must not block the command.
    console.error(
      `Bun version not checked: cannot read package.json (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}
