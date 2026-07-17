/**
 * Loader for the repo-root `.env.dev` — the gitignored home of
 * development-TOOLING secrets (ElevenLabs key, …), kept separate so the
 * platform's own `.env`/`.env.local` never accumulate dev-pipeline keys.
 *
 * Bun only auto-loads `.env*` from the invocation directory, and `.env.dev`
 * is deliberately not one of them — every dev tool that needs these vars
 * loads them explicitly through here. Real environment variables win over
 * file values, and a missing file is fine (CI, machines without the keys).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, '../../../../..');

export function loadDevEnv(): void {
  const file = path.join(REPO_ROOT, '.env.dev');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
