/**
 * Environment preflight for the video pipeline — every prerequisite a stage
 * needs, probed in seconds, each failure carrying the EXACT fix command.
 * Exists because the expensive failures all look the same: a take dies ten
 * minutes in on something `--doctor` would have named up front (expired
 * auth → the recorder sees the login page; a restarted gateway → streams
 * race past the camera; a missing locale org → the de take throws mid-way).
 *
 * Two entry points: `--doctor` prints the full report; the record stage runs
 * the record-relevant subset automatically and aborts on hard failures
 * before a single frame is captured.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { BASE_URL } from '../../e2e/helpers/env';
import type { EpisodeSpec, Locale } from './episode';
import { ffmpegBin } from './ffmpeg';
import { REPO_ROOT, SCREENSHOTS_STATE_DIR, STATE_DIR } from './paths';

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
  /** The exact command that fixes a warn/fail, when one exists. */
  readonly fix?: string;
}

export interface DoctorScope {
  /** Selected episodes — decides org/locale/knowledge-DB applicability. */
  readonly episodes: readonly EpisodeSpec[];
  readonly locales: readonly Locale[];
  readonly needsTts: boolean;
  readonly needsRecord: boolean;
  readonly needsCompose: boolean;
  /** Mock narration needs no ElevenLabs key. */
  readonly mockTts: boolean;
}

const GATEWAY_URL = 'http://localhost:4141';
/** The RAG backend the Indexed badges need on camera (docs demo container). */
const KNOWLEDGE_DB = { host: 'localhost', port: 5544 } as const;
const MOCK_STREAM_PACE_HINT =
  'TALE_MOCK_STREAM_PACE_MS=35 must be set ON THE GATEWAY PROCESS (a restart drops it) — not verifiable from here, check its env';

function run(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      output += d.toString();
    });
    const killer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ ok: false, output: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    proc.on('error', (error) => {
      clearTimeout(killer);
      resolve({ ok: false, output: String(error) });
    });
    proc.on('close', (code) => {
      clearTimeout(killer);
      resolve({ ok: code === 0, output });
    });
  });
}

/** Any HTTP status is a live listener; only transport errors mean "down". */
async function probeHttp(url: string): Promise<'listening' | 'down'> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000) });
    return 'listening';
  } catch {
    // Transport failure IS the diagnostic result — reported as 'down'.
    return 'down';
  }
}

/** Cookie header from a Playwright storageState file, localhost-scoped. */
function cookieHeaderFromStorageState(authPath: string): string | null {
  try {
    const state = JSON.parse(readFileSync(authPath, 'utf8')) as {
      cookies?: { name: string; value: string; domain: string }[];
    };
    const cookies = (state.cookies ?? []).filter((cookie) =>
      cookie.domain.includes('localhost'),
    );
    if (cookies.length === 0) return null;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  } catch (error) {
    console.warn(`unreadable storage state at ${authPath}:`, error);
    return null;
  }
}

async function checkBinaries(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const ffmpeg = ffmpegBin();
  const ffprobe =
    process.env.VIDEO_INGEST_FFMPEG_LOCATION !== undefined
      ? path.join(path.dirname(ffmpeg), 'ffprobe')
      : 'ffprobe';
  for (const bin of [ffmpeg, ffprobe]) {
    const result = await run(bin, ['-version'], 10_000);
    checks.push(
      result.ok
        ? {
            name: bin,
            status: 'ok',
            detail: result.output.split('\n')[0] ?? 'runnable',
          }
        : {
            name: bin,
            status: 'fail',
            detail: 'not runnable',
            fix: 'brew install ffmpeg   # or set VIDEO_INGEST_FFMPEG_LOCATION',
          },
    );
  }
  return checks;
}

async function checkChromium(): Promise<DoctorCheck> {
  try {
    const { chromium } = await import('@playwright/test');
    const executable = chromium.executablePath();
    if (executable && existsSync(executable)) {
      return { name: 'chromium', status: 'ok', detail: executable };
    }
    return {
      name: 'chromium',
      status: 'fail',
      detail: 'Playwright Chromium is not installed',
      fix: 'bunx playwright install chromium',
    };
  } catch (error) {
    return {
      name: 'chromium',
      status: 'fail',
      detail: String(error),
      fix: 'bunx playwright install chromium',
    };
  }
}

function checkElevenLabsKey(mockTts: boolean): DoctorCheck {
  if (process.env.ELEVENLABS_API_KEY) {
    return {
      name: 'ELEVENLABS_API_KEY',
      status: 'ok',
      detail: 'set (via env or the repo-root .env.dev)',
    };
  }
  return {
    name: 'ELEVENLABS_API_KEY',
    status: mockTts ? 'warn' : 'fail',
    detail: mockTts
      ? 'not set — fine for --mock-tts, required for real narration'
      : 'not set — the tts stage bills through this key',
    fix: `echo 'ELEVENLABS_API_KEY=…' >> ${path.join(REPO_ROOT, '.env.dev')}   # gitignored dev-tooling secrets`,
  };
}

async function checkAppAndGateway(): Promise<DoctorCheck[]> {
  const [app, gateway] = await Promise.all([
    probeHttp(BASE_URL),
    probeHttp(`${GATEWAY_URL}/v1/models`),
  ]);
  return [
    app === 'listening'
      ? { name: `app ${BASE_URL}`, status: 'ok', detail: 'listening' }
      : {
          name: `app ${BASE_URL}`,
          status: 'fail',
          detail: 'not reachable — the Mode-A stack is down',
          fix: 'bring up the docs-demo stack: services/platform/tests/docs-screenshots/README.md',
        },
    gateway === 'listening'
      ? {
          name: `mock gateway ${GATEWAY_URL}`,
          status: 'ok',
          detail: `listening — ${MOCK_STREAM_PACE_HINT}`,
        }
      : {
          name: `mock gateway ${GATEWAY_URL}`,
          status: 'fail',
          detail: 'not reachable — recording streams need the mock gateway',
          fix: 'bring up the docs-demo stack: services/platform/tests/docs-screenshots/README.md',
        },
  ];
}

/**
 * The expired-auth trap: a stale storageState records the LOGIN PAGE, not
 * the workspace. Probe the session endpoint with the saved cookies — a null
 * session means re-bootstrap, never hand-edit `.state/`.
 */
async function checkAuthFreshness(): Promise<DoctorCheck> {
  const authPath = path.join(SCREENSHOTS_STATE_DIR, 'auth.json');
  if (!existsSync(authPath)) {
    return {
      name: 'demo auth',
      status: 'fail',
      detail: `no storage state at ${authPath}`,
      fix: 'bun run docs:screenshots   # bootstraps + signs in the demo owner',
    };
  }
  const cookieHeader = cookieHeaderFromStorageState(authPath);
  if (!cookieHeader) {
    return {
      name: 'demo auth',
      status: 'fail',
      detail: 'storage state carries no localhost cookies',
      fix: 'bun run docs:screenshots',
    };
  }
  try {
    const response = await fetch(`${BASE_URL}/api/auth/get-session`, {
      headers: { cookie: cookieHeader },
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 401) {
      return {
        name: 'demo auth',
        status: 'fail',
        detail:
          'session rejected (401) — the recorder would film the login page',
        fix: 'bun run docs:screenshots',
      };
    }
    if (!response.ok) {
      return {
        name: 'demo auth',
        status: 'warn',
        detail: `session endpoint answered ${response.status} — could not verify freshness`,
      };
    }
    const session = (await response.json()) as unknown;
    const alive =
      session !== null &&
      typeof session === 'object' &&
      ('user' in session || 'session' in session) &&
      Boolean(
        (session as { user?: unknown; session?: unknown }).user ??
        (session as { user?: unknown; session?: unknown }).session,
      );
    return alive
      ? { name: 'demo auth', status: 'ok', detail: 'session is live' }
      : {
          name: 'demo auth',
          status: 'fail',
          detail: 'session expired — the recorder would film the login page',
          fix: 'bun run docs:screenshots',
        };
  } catch (error) {
    return {
      name: 'demo auth',
      status: 'warn',
      detail: `could not probe the session endpoint (${String(error)})`,
    };
  }
}

function checkOrgs(
  episodes: readonly EpisodeSpec[],
  locales: readonly Locale[],
): DoctorCheck[] {
  if (episodes.every((episode) => episode.diagnostic)) return [];
  const checks: DoctorCheck[] = [];
  if (locales.includes('en')) {
    const orgPath = path.join(SCREENSHOTS_STATE_DIR, 'org.json');
    checks.push(
      existsSync(orgPath)
        ? { name: 'en demo org', status: 'ok', detail: orgPath }
        : {
            name: 'en demo org',
            status: 'fail',
            detail: `no org state at ${orgPath}`,
            fix: 'bun run docs:screenshots',
          },
    );
  }
  const localeLocales = locales.filter((locale) => locale !== 'en');
  if (localeLocales.length > 0) {
    const localeOrgsPath = path.join(STATE_DIR, 'locale-orgs.json');
    const present = existsSync(localeOrgsPath)
      ? (JSON.parse(readFileSync(localeOrgsPath, 'utf8')) as Partial<
          Record<Locale, unknown>
        >)
      : {};
    for (const locale of localeLocales) {
      checks.push(
        present[locale]
          ? { name: `${locale} demo org`, status: 'ok', detail: 'seeded' }
          : {
              name: `${locale} demo org`,
              status: 'fail',
              detail: `no ${locale} org in ${localeOrgsPath}`,
              fix: `bun services/platform/tests/docs-videos/seed-locale-orgs.ts --locale ${locale}`,
            },
      );
    }
  }
  return checks;
}

async function checkKnowledgeDb(
  episodes: readonly EpisodeSpec[],
): Promise<DoctorCheck | null> {
  if (!episodes.some((episode) => episode.needsKnowledgeDb)) return null;
  const { createConnection } = await import('node:net');
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = createConnection({
      host: KNOWLEDGE_DB.host,
      port: KNOWLEDGE_DB.port,
      timeout: 1500,
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
  return reachable
    ? {
        name: `knowledge db :${KNOWLEDGE_DB.port}`,
        status: 'ok',
        detail: 'reachable — Indexed badges will render',
      }
    : {
        name: `knowledge db :${KNOWLEDGE_DB.port}`,
        status: 'fail',
        detail:
          'unreachable — a selected episode shows Indexed badges on camera',
        fix: 'docker start tale-docs-knowledge-db',
      };
}

/** Frames are heavy (a 3-minute take ≈ 3–5 GB of JPEG) — warn early. */
async function checkDiskSpace(): Promise<DoctorCheck | null> {
  // `.state/` may not exist yet on a fresh clone — fall back to its parent.
  const probe = existsSync(STATE_DIR) ? STATE_DIR : path.dirname(STATE_DIR);
  const result = await run('df', ['-Pk', probe], 5000);
  if (!result.ok) return null;
  const dataLine = result.output.trim().split('\n').at(-1) ?? '';
  const availableKb = Number(dataLine.split(/\s+/)[3]);
  if (!Number.isFinite(availableKb)) return null;
  const availableGb = availableKb / 1024 / 1024;
  return availableGb >= 8
    ? {
        name: 'disk space',
        status: 'ok',
        detail: `${availableGb.toFixed(0)} GB free for frames`,
      }
    : {
        name: 'disk space',
        status: 'warn',
        detail: `${availableGb.toFixed(1)} GB free — a take writes 3–5 GB of frames`,
        fix: `rm -rf ${path.join(STATE_DIR, 'frames')}   # disposable`,
      };
}

export async function runDoctor(scope: DoctorScope): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push(...(await checkBinaries()));
  if (scope.needsTts) checks.push(checkElevenLabsKey(scope.mockTts));
  if (scope.needsRecord) {
    checks.push(await checkChromium());
    const recordsRealOrg = !scope.episodes.every(
      (episode) => episode.diagnostic,
    );
    if (recordsRealOrg) {
      checks.push(...(await checkAppAndGateway()));
      checks.push(await checkAuthFreshness());
      checks.push(...checkOrgs(scope.episodes, scope.locales));
      const knowledgeDb = await checkKnowledgeDb(scope.episodes);
      if (knowledgeDb) checks.push(knowledgeDb);
    }
    const disk = await checkDiskSpace();
    if (disk) checks.push(disk);
  }
  return checks;
}

export function doctorHasFailures(checks: readonly DoctorCheck[]): boolean {
  return checks.some((check) => check.status === 'fail');
}

export function formatDoctorReport(checks: readonly DoctorCheck[]): string {
  const icon: Record<DoctorStatus, string> = {
    ok: '✓',
    warn: '⚠',
    fail: '✗',
  };
  return checks
    .map((check) => {
      const line = `  ${icon[check.status]} ${check.name} — ${check.detail}`;
      return check.fix && check.status !== 'ok'
        ? `${line}\n      fix: ${check.fix}`
        : line;
    })
    .join('\n');
}
