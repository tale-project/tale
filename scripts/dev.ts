#!/usr/bin/env bun
/*
  Root dev bootstrap for `bun run dev`.

  Runs BEFORE turbo so the whole dev fleet (platform + sandbox + …) starts from a
  production-shaped secret set instead of insecure hardcoded fallbacks:

    1) Ensure INSTANCE_SECRET, BETTER_AUTH_SECRET and SANDBOX_TOKEN exist.
       Any that are genuinely missing get a cryptographically-random value
       (same shapes the CLI's `ensureEnv` mints for the container path) and are
       PERSISTED to a gitignored repo-root `.env` so they're STABLE across
       restarts. Values already supplied by any .env / .env.local (e.g. a real
       `tale init` deploy) are respected and never overwritten — we only fill
       gaps, so host dev and the container path converge on one secret set.
       Repo-root `.env` (not `.env.local`) is deliberate: `docker compose`
       auto-loads `.env` as its env_file, so the dockerized sandbox spawner
       picks up the SAME SANDBOX_TOKEN as the host process and Convex — keeping
       the HMAC handshake consistent whichever spawner serves :8003.
    2) Load the merged secrets into this process's env and run the platform dev
       orchestrator (services/platform/scripts/dev.ts) directly as a child —
       NOT through turbo. The orchestrator owns the docker backing services
       (incl. the sandbox container), Convex and Vite, and emits clean output
       itself; turbo only added prefix noise, a redundant host sandbox spawner
       and a per-boot CLI embed regen. The orchestrator re-reads the .env files
       directly and syncs SANDBOX_TOKEN into the local Convex deployment, and
       the repo-root .env (written above) is docker compose's auto-loaded
       env_file, so Convex and the spawner share one HMAC key with zero setup.

  Why here and not inside each service: the secrets must MATCH across processes
  (the Convex → sandbox spawner HMAC handshake), and the services start
  concurrently under turbo. Minting once, up front, removes the first-run race.
*/

import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { errorLine, infoLine } from '@tale/shared/tux';

const repoRoot = join(import.meta.dir, '..');
const platformRoot = join(repoRoot, 'services', 'platform');

function parseDotEnv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

// Same generators (and value shapes) the CLI uses in
// tools/cli/src/lib/config/ensure-env.ts, so a host `bun dev` secret is
// indistinguishable in strength from a `tale init` one.
const SECRET_GENERATORS: Record<string, () => string> = {
  INSTANCE_SECRET: () => randomBytes(32).toString('hex'),
  BETTER_AUTH_SECRET: () => randomBytes(32).toString('base64'),
  // Shared HMAC key for Convex → sandbox spawner request signing. Hex, 32 bytes
  // (mirrors services/sandbox/src/auth.ts and the CLI's SANDBOX_TOKEN).
  SANDBOX_TOKEN: () => randomBytes(32).toString('hex'),
  // Postgres/ParadeDB superuser password (db + knowledge-db). Postgres reads it
  // only on the container's first init (initdb), and the platform orchestrator
  // derives KNOWLEDGE_DATABASE_URL from it — so an unset value silently breaks
  // knowledge-base / RAG search. base64url keeps it URL-safe for the derived
  // connection string. Once persisted it stays stable across restarts; changing
  // it after the volume is initialized needs a volume wipe (dev volumes are
  // disposable). Mirrors the CLI's DB_PASSWORD generator in ensure-env.ts.
  DB_PASSWORD: () => randomBytes(16).toString('base64url'),
};

/** Merge the same dotenv files the platform orchestrator reads, lowest →
 *  highest precedence (process.env wins last — an explicit shell override
 *  should never be regenerated). */
function mergedEnv(): Record<string, string> {
  const files = [
    join(repoRoot, '.env'),
    join(repoRoot, '.env.local'),
    join(platformRoot, '.env'),
    join(platformRoot, '.env.local'),
  ];
  const merged: Record<string, string> = {};
  for (const file of files) Object.assign(merged, parseDotEnv(file));
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && v.length > 0) merged[k] = v;
  }
  return merged;
}

/** Generate + persist any of the shared dev secrets that no .env / shell value
 *  supplies. Writes only the missing ones to a gitignored repo-root .env
 *  (created on demand — also docker compose's auto-loaded env_file) and loads
 *  every resolved secret into process.env so the spawned turbo fleet inherits
 *  them. */
function ensureDevSecrets(): void {
  const env = mergedEnv();
  const generated: Record<string, string> = {};

  for (const [key, generate] of Object.entries(SECRET_GENERATORS)) {
    const existing = env[key]?.trim();
    if (existing && existing.length > 0) {
      process.env[key] = existing;
      continue;
    }
    const value = generate();
    generated[key] = value;
    process.env[key] = value;
  }

  // Nothing to mint — stay silent (routine success isn't worth a line; only the
  // first-run/missing case below, which actually writes new secrets, is noted).
  if (Object.keys(generated).length === 0) return;

  const envPath = join(repoRoot, '.env');
  const block = [
    '',
    '# ----------------------------------------------------------------------------',
    '# Auto-generated dev secrets (bun run dev). Random + machine-local + gitignored.',
    '# Delete a line to have it regenerated; set your own to override. The container',
    '# path (`tale init`/`tale dev`) reuses these same keys from this .env.',
    '# ----------------------------------------------------------------------------',
    ...Object.entries(generated).map(([k, v]) => `${k}=${v}`),
    '',
  ].join('\n');

  if (existsSync(envPath)) {
    appendFileSync(envPath, `${block}\n`, 'utf8');
  } else {
    writeFileSync(envPath, `${block.replace(/^\n/, '')}\n`, 'utf8');
  }

  infoLine(
    `Generated ${Object.keys(generated).length} dev secret(s) in .env: ${Object.keys(generated).join(', ')}`,
  );
}

function main(): void {
  ensureDevSecrets();

  // Turbo bypass. The platform orchestrator already owns the docker backing
  // services (including the sandbox container — the single :8003 owner), the
  // backend and Vite, and now emits clean, classified output itself. Running it
  // directly drops everything turbo added that polluted `bun run dev`: the
  // `<pkg>:<task>:` line prefixes, the per-boot @tale/cli embed regeneration
  // (2000+ files), and the redundant HOST @tale/sandbox spawner that
  // double-bound :8003. CI never calls `turbo run dev` (test:e2e is a separate
  // task), and `turbo run dev` still works as an escape hatch via the platform
  // script's own `import.meta.main` entry.
  const platform: ChildProcess = spawn(
    'bun',
    ['services/platform/scripts/dev.ts', ...process.argv.slice(2)],
    { stdio: 'inherit', cwd: repoRoot, env: process.env },
  );

  let shuttingDown = false;
  const forward = (signal: 'SIGINT' | 'SIGTERM') => () => {
    if (shuttingDown) {
      // Second Ctrl-C — quit immediately rather than wait for the child.
      process.exit(1);
    }
    shuttingDown = true;
    if (platform.pid) platform.kill(signal);
    // Safety net: if the child refuses to exit, quit anyway so one Ctrl-C suffices.
    setTimeout(() => process.exit(1), 4000).unref();
  };
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));

  // Platform is the primary process: mirror its status when it exits.
  platform.on('exit', (code: number | null, signal: string | null) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });
  platform.on('error', (err: Error) => {
    errorLine(`Failed to start platform dev server: ${err.message}`);
    process.exit(1);
  });
}

main();
