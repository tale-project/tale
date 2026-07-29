/**
 * Live-stack e2e for large files across the sandbox boundary:
 * the 100 MB workspace caps (per-file = upload cap), the token-gated
 * `/api/sandbox-blob` streaming lane for BYO-S3 orgs, and the per-file
 * staging/harvest skip surfacing.
 *
 * Prerequisites: platform dev stack (`bun dev`) + sandbox spawner running on
 * loopback; docker available for the optional MinIO (BYO-S3) phase.
 *
 *   bun services/platform/tests/manual/scripts/e2e-sandbox-large-files.ts
 *   SKIP_S3=1 bun …  # skip the MinIO phase
 *
 * Phases:
 *  A. Browser (fresh user + org): chat with a 30 MB text attachment →
 *     the workspace filing that used to silently skip anything over 10 MB.
 *  B. Backend: the threadFiles row exists with the full 30 MB size.
 *  C. Sandbox: executeCodeInSession reads the staged upload (`wc`) — the
 *     staging lane that used to be impossible over the 1.5 MB stage budget.
 *  D. Harvest: a 15 MB output is harvested (old cap: hard failure), a 25 MB
 *     output is reported in `harvestSkipped` (old cap: silent loss).
 *  E. Route security: missing/garbage/expired/foreign tokens are refused.
 *  F. BYO-S3 (MinIO): the org's blobs route to its own bucket and a >1 MB
 *     upload still reaches the sandbox — through the streaming route, since
 *     the container has no path to the bucket.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type Page } from '@playwright/test';

import { createOrgViaWizard, uniqueCredentials } from '../../e2e/helpers/auth';
import {
  composer,
  fillComposer,
  sendButton,
  stopButton,
} from '../../e2e/helpers/chat';
import { BASE_URL, TIMEOUT } from '../../e2e/helpers/env';

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const REPO_ROOT = path.resolve(PLATFORM_ROOT, '../..');
const HTTP_API = process.env.VITE_CONVEX_SITE_URL ?? 'http://127.0.0.1:3211';
const MINIO_NAME = 'tale-e2e-minio';
const MINIO_PORT = 19100;

// Repo-root `.env.local` pins CONVEX_DEPLOYMENT to a DIFFERENT anonymous
// deployment (`anonymous-agent`); when this script is launched from the repo
// root, bun auto-loads it into process.env and every convex CLI child would
// target the wrong backend. Drop it — the CLI then resolves the platform
// deployment from `services/platform/.env.local` via its cwd.
const CLI_ENV: NodeJS.ProcessEnv = { ...process.env };
delete CLI_ENV.CONVEX_DEPLOYMENT;

const results: Array<{ id: string; ok: boolean; detail: string }> = [];
function record(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} — ${detail}`);
}

function convexRun(fn: string, args: unknown, timeoutMs = 240_000): unknown {
  const proc = spawnSync('bunx', ['convex', 'run', fn, JSON.stringify(args)], {
    cwd: PLATFORM_ROOT,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: CLI_ENV,
  });
  if (proc.status !== 0) {
    throw new Error(
      `convex run ${fn} failed (${proc.status}): ${proc.stderr.slice(0, 800)}`,
    );
  }
  const out = proc.stdout.trim();
  if (out.length === 0) return null;
  const jsonStart = out.search(/[[{"]/);
  return JSON.parse(jsonStart >= 0 ? out.slice(jsonStart) : out);
}

/** Deployment env var via the CLI (`convex env get`). */
function convexEnvGet(name: string): string | null {
  const proc = spawnSync('bunx', ['convex', 'env', 'get', name], {
    cwd: PLATFORM_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
    env: CLI_ENV,
  });
  if (proc.status !== 0) return null;
  const value = proc.stdout.trim();
  return value.length > 0 ? value : null;
}

/**
 * Org slug + creator user id from the Better Auth component's `organization`
 * table (`metadata.creatorId`); there is no root-app query for either, and the
 * one-off query API cannot cross into components — the CLI's component data
 * dump is the sanctioned admin read.
 */
function orgMetaFromComponent(orgId: string): {
  slug: string;
  ownerUserId: string;
} {
  const proc = spawnSync(
    'bunx',
    [
      'convex',
      'data',
      '--component',
      'betterAuth',
      'organization',
      '--order',
      'desc',
      '--limit',
      '100',
    ],
    { cwd: PLATFORM_ROOT, encoding: 'utf8', timeout: 60_000, env: CLI_ENV },
  );
  if (proc.status !== 0) {
    throw new Error(`convex data failed: ${proc.stderr.slice(0, 300)}`);
  }
  const line = proc.stdout.split('\n').find((l) => l.includes(orgId));
  if (!line)
    throw new Error(`org ${orgId} not in component organization table`);
  const cols = line.split('|').map((c) => c.trim().replace(/^"|"$/g, ''));
  const slug = cols[cols.length - 1];
  const creator = /creatorId\\":\\"([A-Za-z0-9]+)/.exec(line)?.[1];
  if (!slug || !creator) {
    throw new Error(`could not parse slug/creator from: ${line}`);
  }
  return { slug, ownerUserId: creator };
}

/** Deterministic text file of exactly `lines` newline-terminated 114-byte
 * lines (275,592 lines ≈ 30 MB — comfortably over both the old 10 MB
 * workspace cap and the 1.5 MB stage-request budget). */
function writeLogFile(filePath: string, lines: number): number {
  const chunk: string[] = [];
  for (let i = 0; i < lines; i++) {
    chunk.push(
      `2026-07-20T00:00:00Z [INFO] svc-${i % 7} request_id=${String(i).padStart(8, '0')} handled path=/api/v1/resource status=200`.padEnd(
        113,
        '.',
      ),
    );
  }
  const body = `${chunk.join('\n')}\n`;
  writeFileSync(filePath, body);
  return Buffer.byteLength(body);
}

async function attachAndSend(
  page: Page,
  orgId: string,
  filePath: string,
  fileName: string,
  message: string,
): Promise<string> {
  await page.goto(`${BASE_URL}/dashboard/${orgId}/chat`);
  await composer(page).waitFor({
    state: 'visible',
    timeout: TIMEOUT.FIRST_PAINT,
  });
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  // The chip (with the full name in `title`) renders once the upload lands —
  // a 30 MB body takes a moment on loopback.
  await page
    .locator(`[title="${fileName}"]`)
    .first()
    .waitFor({ state: 'visible', timeout: 120_000 });
  await fillComposer(page, message);
  await sendButton(page).click();
  await page.waitForURL(/\/chat\/([A-Za-z0-9]{16,})(?:[/?#]|$)/, {
    timeout: TIMEOUT.NAV,
  });
  const threadId = /\/chat\/([A-Za-z0-9]{16,})/.exec(page.url())?.[1];
  if (!threadId) throw new Error(`no thread id in ${page.url()}`);
  // Wait for the turn to settle (Stop → gone). Generation may legitimately
  // take a while on a live model; the filing we assert on happens BEFORE the
  // model call, so a model hiccup must not fail the script here.
  try {
    await stopButton(page).waitFor({ state: 'hidden', timeout: 240_000 });
  } catch {
    console.warn(
      'turn still running after 240s — continuing (filing is pre-generation)',
    );
  }
  return threadId;
}

interface ThreadFileRow {
  path: string;
  size: number;
  contentType: string;
  source: string;
  storageId: string;
}

function listThreadFiles(threadId: string): ThreadFileRow[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- admin CLI JSON
  return convexRun('thread_files/internal_queries:listThreadFiles', {
    threadId,
  }) as ThreadFileRow[];
}

/**
 * Poll for a workspace row: attachment filing runs inside the generation
 * action, which starts a routing/fallback dance AFTER the send — the Send⇄Stop
 * toggle can flap through model retries long before the filing lands, so a
 * single-shot read right after the UI settles races it.
 */
async function waitForThreadFile(
  threadId: string,
  filePath: string,
  timeoutMs = 180_000,
): Promise<ThreadFileRow | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = listThreadFiles(threadId).find((r) => r.path === filePath);
    if (row !== undefined) return row;
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

interface ExecResult {
  status: string;
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  files: Array<{ path: string; size: number }>;
  stagingSkipped?: Array<{ path: string; reason: string }>;
  harvestSkipped?: Array<{ path: string; reason: string }>;
}

function execInSession(
  organizationId: string,
  threadId: string,
  userId: string,
  code: string,
  language: 'bash' | 'python' = 'bash',
  timeoutMs = 120_000,
): ExecResult {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- admin CLI JSON
  return convexRun(
    'node_only/sandbox/session_exec:executeCodeInSession',
    {
      organizationId,
      threadId,
      uploadedBy: userId,
      stepPaths: [],
      inlineCode: { content: code, language },
      timeoutMs,
    },
    360_000,
  ) as ExecResult;
}

async function main(): Promise<void> {
  const thirtyMb = path.join('/tmp', 'e2e-30mb-app.log');
  const LINES_30MB = 275_592;
  const bytes30 = writeLogFile(thirtyMb, LINES_30MB);
  console.log(`30MB fixture: ${bytes30} bytes, ${LINES_30MB} lines`);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: 'en-US',
  });
  const page = await context.newPage();

  // ---- Phase A: fresh org, 30 MB chat attachment -------------------------
  // Sign up from the PAGE context (browser fetch): under bun, playwright's
  // APIRequestContext crashes parsing Set-Cookie (its node:http shim reports
  // the request path as the response URL), and the browser jar is where the
  // session cookie must land anyway for the wizard that follows.
  const creds = uniqueCredentials('sandbox-large');
  await page.goto(`${BASE_URL}/`);
  const signUp = await page.evaluate(
    async (args: { email: string; password: string }) => {
      const res = await fetch('/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: args.email,
          email: args.email,
          password: args.password,
        }),
        credentials: 'include',
      });
      return { status: res.status, body: (await res.text()).slice(0, 300) };
    },
    { email: creds.email, password: creds.password },
  );
  if (signUp.status >= 400) {
    throw new Error(`sign-up failed: ${signUp.status} ${signUp.body}`);
  }
  const orgId = await createOrgViaWizard(page);
  console.log(`org: ${orgId}  user: ${creds.email}`);
  // The org slug (MinIO config dir) + creator user id (executeCodeInSession's
  // uploadedBy provenance).
  const orgMeta = orgMetaFromComponent(orgId);
  console.log(`slug: ${orgMeta.slug}  owner: ${orgMeta.ownerUserId}`);

  const threadId = await attachAndSend(
    page,
    orgId,
    thirtyMb,
    'e2e-30mb-app.log',
    'Use run_code to count the exact number of lines in the attached log file.',
  );
  console.log(`thread: ${threadId}`);

  // ---- Phase B: workspace filing at the new cap --------------------------
  const upload = await waitForThreadFile(
    threadId,
    '/user/uploads/e2e-30mb-app.log',
  );
  record(
    'B1 filing-30mb',
    upload !== undefined &&
      upload.size === bytes30 &&
      upload.source === 'user_upload',
    upload
      ? `filed ${upload.size} bytes as ${upload.path} (${upload.storageId.startsWith('s3:') ? 's3' : '_storage'})`
      : 'row did not appear within 180s',
  );

  // ---- Phase C: staging + read inside the sandbox ------------------------
  const wc = execInSession(
    orgId,
    threadId,
    orgMeta.ownerUserId,
    'wc -l -c /user/uploads/e2e-30mb-app.log',
  );
  const wcOk =
    wc.status === 'completed' &&
    wc.stdoutPreview.includes(String(LINES_30MB)) &&
    wc.stdoutPreview.includes(String(bytes30)) &&
    (wc.stagingSkipped === undefined || wc.stagingSkipped.length === 0);
  record(
    'C1 sandbox-reads-30mb',
    wcOk,
    `status=${wc.status} stdout="${wc.stdoutPreview.trim()}" stagingSkipped=${JSON.stringify(wc.stagingSkipped ?? [])}`,
  );

  // ---- Phase D: harvest — 15 MB in, 25 MB skipped with a reason ----------
  const harvest = execInSession(
    orgId,
    threadId,
    orgMeta.ownerUserId,
    [
      'import os',
      "open('/user/output/mid-15mb.bin','wb').write(os.urandom(15*1024*1024))",
      "open('/user/output/huge-25mb.bin','wb').write(os.urandom(25*1024*1024))",
      "print('outputs written')",
    ].join('\n'),
    'python',
  );
  const midHarvested = harvest.files.some(
    (f) =>
      f.path === '/user/output/mid-15mb.bin' && f.size === 15 * 1024 * 1024,
  );
  const hugeSkip = (harvest.harvestSkipped ?? []).find(
    (s) => s.path === '/user/output/huge-25mb.bin',
  );
  record(
    'D1 harvest-15mb',
    harvest.status === 'completed' && midHarvested,
    `status=${harvest.status} files=${JSON.stringify(harvest.files.map((f) => `${f.path}:${f.size}`))}`,
  );
  record(
    'D2 harvest-skip-25mb',
    hugeSkip !== undefined && hugeSkip.reason.includes('20.0 MB'),
    `harvestSkipped=${JSON.stringify(harvest.harvestSkipped ?? [])}`,
  );

  // ---- Phase E: stream-route token gate ----------------------------------
  const noToken = await fetch(`${HTTP_API}/api/sandbox-blob`);
  record('E1 route-no-token', noToken.status === 400, `HTTP ${noToken.status}`);
  const garbage = await fetch(
    `${HTTP_API}/api/sandbox-blob?token=v1.aaaa.bbbb`,
  );
  record(
    'E2 route-garbage-token',
    garbage.status === 403,
    `HTTP ${garbage.status}`,
  );
  {
    // Real signatures: mint with the deployment's own HMAC root.
    const hmacKey = convexEnvGet('WEBDAV_APP_PASSWORD_HMAC_KEY');
    if (hmacKey) {
      process.env.WEBDAV_APP_PASSWORD_HMAC_KEY = hmacKey;
      const { signStageToken } =
        await import('../../../convex/lib/storage/sandbox_stage_token');
      const expired = await signStageToken(
        { ref: 's3:whatever/x', org: orgId },
        Date.now() - 11 * 60 * 1000,
      );
      const expiredRes = await fetch(
        `${HTTP_API}/api/sandbox-blob?token=${encodeURIComponent(expired ?? '')}`,
      );
      record(
        'E3 route-expired-token',
        expiredRes.status === 403,
        `HTTP ${expiredRes.status}`,
      );
      const foreign = await signStageToken({
        ref: 's3:not-this-org/nothing',
        org: orgId,
      });
      const foreignRes = await fetch(
        `${HTTP_API}/api/sandbox-blob?token=${encodeURIComponent(foreign ?? '')}`,
      );
      // Valid signature, but the org has no bucket / the key is outside its
      // namespace → fail-closed 404, never a stream.
      record(
        'E4 route-foreign-ref',
        foreignRes.status === 404,
        `HTTP ${foreignRes.status}`,
      );
    } else {
      record(
        'E3 route-expired-token',
        false,
        'could not read HMAC root from deployment env',
      );
    }
  }

  // ---- Phase F: BYO-S3 org via MinIO -------------------------------------
  if (process.env.SKIP_S3 === '1') {
    console.log('SKIP_S3=1 — skipping the MinIO phase');
  } else {
    spawnSync('docker', ['rm', '-f', MINIO_NAME], { encoding: 'utf8' });
    const boot = spawnSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        MINIO_NAME,
        '-p',
        `${MINIO_PORT}:9000`,
        '-e',
        'MINIO_ROOT_USER=minioadmin',
        '-e',
        'MINIO_ROOT_PASSWORD=minioadmin',
        'minio/minio',
        'server',
        '/data',
      ],
      { encoding: 'utf8' },
    );
    if (boot.status !== 0) {
      record('F0 minio-boot', false, boot.stderr.slice(0, 300));
    } else {
      // Bucket = top-level dir on the FS backend; wait for readiness first.
      for (let i = 0; i < 30; i++) {
        const ping = spawnSync(
          'curl',
          [
            '-s',
            '-o',
            '/dev/null',
            '-w',
            '%{http_code}',
            `http://127.0.0.1:${MINIO_PORT}/minio/health/ready`,
          ],
          { encoding: 'utf8' },
        );
        if (ping.stdout.trim() === '200') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      spawnSync(
        'docker',
        ['exec', MINIO_NAME, 'mkdir', '-p', '/data/tale-e2e'],
        { encoding: 'utf8' },
      );

      // Point the fresh org's blob routing at its own bucket (file-based org
      // config — written directly, as an operator would). The root that
      // matters is the BACKEND's TALE_CONFIG_DIR (deployment env), not this
      // script's — the two diverge on dev machines.
      const configRoot =
        convexEnvGet('TALE_CONFIG_DIR') ??
        process.env.TALE_CONFIG_DIR ??
        path.join(REPO_ROOT, '.tale', 'config');
      const cfgDir = path.join(configRoot, orgMeta.slug, 'object-storage');
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        path.join(cfgDir, 'connection.json'),
        JSON.stringify(
          {
            region: 'us-east-1',
            endpoint: `http://127.0.0.1:${MINIO_PORT}`,
            forcePathStyle: true,
            bucket: 'tale-e2e',
          },
          null,
          2,
        ),
      );
      writeFileSync(
        path.join(cfgDir, 'connection.secrets.json'),
        JSON.stringify(
          { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
          null,
          2,
        ),
      );
      console.log(`org object-storage config written: ${cfgDir}`);
      // The blob-routing resolver caches per-org store decisions for 15s
      // (ORG_STORE_TTL_MS) and this org was already resolved to `_storage`
      // during phase A — outlive that entry before uploading.
      await new Promise((r) => setTimeout(r, 16_000));

      // A fresh 5 MB upload in a NEW thread now routes: upload → MinIO,
      // filing copy → MinIO (s3 ref), staging → /api/sandbox-blob stream.
      const fiveMb = path.join('/tmp', 'e2e-5mb-s3.log');
      const LINES_5MB = 51_200;
      const bytes5 = writeLogFile(fiveMb, LINES_5MB);
      const s3ThreadId = await attachAndSend(
        page,
        orgId,
        fiveMb,
        'e2e-5mb-s3.log',
        'Use run_code to count the exact number of lines in the attached log file.',
      );
      console.log(`s3 thread: ${s3ThreadId}`);

      const s3upload = await waitForThreadFile(
        s3ThreadId,
        '/user/uploads/e2e-5mb-s3.log',
      );
      record(
        'F1 s3-filing-5mb',
        s3upload !== undefined &&
          s3upload.size === bytes5 &&
          s3upload.storageId.startsWith('s3:'),
        s3upload
          ? `filed as ${s3upload.storageId.slice(0, 24)}… size=${s3upload.size}`
          : 'row did not appear within 180s',
      );

      const s3wc = execInSession(
        orgId,
        s3ThreadId,
        orgMeta.ownerUserId,
        'wc -l -c /user/uploads/e2e-5mb-s3.log',
      );
      const s3ok =
        s3wc.status === 'completed' &&
        s3wc.stdoutPreview.includes(String(LINES_5MB)) &&
        s3wc.stdoutPreview.includes(String(bytes5)) &&
        (s3wc.stagingSkipped === undefined || s3wc.stagingSkipped.length === 0);
      record(
        'F2 s3-sandbox-reads-5mb',
        s3ok,
        `status=${s3wc.status} stdout="${s3wc.stdoutPreview.trim()}" stagingSkipped=${JSON.stringify(s3wc.stagingSkipped ?? [])}`,
      );

      // Physical evidence the org's blobs really live in ITS bucket: the
      // MinIO FS backend materializes each object under /data/<bucket>/.
      const bucketLs = spawnSync(
        'docker',
        [
          'exec',
          MINIO_NAME,
          'sh',
          '-c',
          'find /data/tale-e2e -type d -name "*.log" -o -type d -name "xl.meta" | head; ls /data/tale-e2e/ | head -20',
        ],
        { encoding: 'utf8' },
      );
      const bucketEntries = bucketLs.stdout.trim();
      record(
        'F3 s3-bucket-has-objects',
        bucketLs.status === 0 && bucketEntries.length > 0,
        `bucket contents: ${bucketEntries.split('\n').slice(0, 5).join(' | ') || '(empty)'}`,
      );

      // Teardown: the MinIO container is per-run scratch.
      spawnSync('docker', ['rm', '-f', MINIO_NAME], { encoding: 'utf8' });
    }
  }

  await browser.close();

  console.log('\n===== SUMMARY =====');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id} — ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err: unknown) => {
  console.error('e2e script crashed:', err);
  process.exit(1);
});
