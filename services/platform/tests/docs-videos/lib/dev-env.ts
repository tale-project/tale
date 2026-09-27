/**
 * Loader for the repo-root `.env.dev` — the gitignored home of
 * development-TOOLING secrets (ElevenLabs key, …), kept separate so the
 * platform's own `.env`/`.env.local` never accumulate dev-pipeline keys.
 *
 * Bun only auto-loads `.env*` from the invocation directory, and `.env.dev`
 * is deliberately not one of them — every dev tool that needs these vars
 * loads them explicitly through here. A missing file is fine (CI, machines
 * without the keys).
 *
 * A NON-EMPTY environment variable wins over the file value; an empty one
 * counts as unset, the same reading `doctor.ts` and `tts.ts` give it. Bun
 * loads the repo-root `.env` first, and a copy of an older root
 * `.env.example` carries `ELEVENLABS_API_KEY=` — an empty value that would
 * otherwise hide the `.env.dev` key.
 */

import { existsSync, readFileSync } from 'node:fs';

import { DEV_ENV_FILE } from './paths';

export function loadDevEnv(
  file: string = DEV_ENV_FILE,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !env[key]) env[key] = value;
  }
}
