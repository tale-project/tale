/**
 * The helpers `backend/integration-check.ts` shares with the lanes that live
 * in modules of their own (`*.integration.ts`), so a lane never carries a
 * second copy of the suite's cookie handling or its throwaway sign-up.
 */
import { z } from 'zod';

/** The password every throwaway `itest-` user signs up with. */
export const ITEST_PASSWORD = 'itest-password-1';

/** How a lane records one check: the harness's `record`. */
export type RecordCheck = (name: string, ok: boolean, detail: string) => void;

/**
 * `ITEST_REQUIRE_ALL_LANES=1` asks for full coverage, the mode CI runs the
 * suite in: the harness refuses to start without what every lane needs
 * ({@link fullCoverageBlockers}), and a check that cannot run fails instead
 * of reporting a skip ({@link recordSkip}).
 */
export function everyLaneRequired(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ITEST_REQUIRE_ALL_LANES === '1';
}

/** The lane names `ITEST_LANES` asks for, or null for the full run. */
export function requestedLanes(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> | null {
  const raw = env.ITEST_LANES?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
  );
}

/** The S3-compatible store the blob lanes write to. */
export interface ItestObjectStore {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * The run's object store (`ITEST_S3_ENDPOINT`), or null when it has none.
 * The credentials default to MinIO's own (`minioadmin`), so the endpoint
 * alone is the documented minimum.
 */
export function itestObjectStore(
  env: NodeJS.ProcessEnv = process.env,
): ItestObjectStore | null {
  const endpoint = env.ITEST_S3_ENDPOINT?.trim();
  if (!endpoint) return null;
  return {
    endpoint,
    accessKeyId: env.ITEST_S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: env.ITEST_S3_SECRET_KEY ?? 'minioadmin',
  };
}

/**
 * Why this run cannot cover every lane when it must, or nothing: a lane
 * filter, or an object-store variable left to its default. Only a run with
 * {@link everyLaneRequired} is judged; the harness refuses to start with any
 * blocker, before a single lane has run.
 */
export function fullCoverageBlockers(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!everyLaneRequired(env)) return [];
  const blockers: string[] = [];
  const lanes = requestedLanes(env);
  if (lanes !== null) {
    blockers.push(
      `ITEST_LANES runs only ${[...lanes].join(', ')}, not every lane`,
    );
  }
  if (!env.ITEST_S3_ENDPOINT?.trim()) {
    blockers.push('ITEST_S3_ENDPOINT is unset, so no blob lane can run');
  }
  for (const name of ['ITEST_S3_ACCESS_KEY', 'ITEST_S3_SECRET_KEY']) {
    if (!env[name]?.trim()) {
      blockers.push(
        `${name} is unset, so the blob lanes would sign with MinIO's default credentials`,
      );
    }
  }
  return blockers;
}

/**
 * Records a check that cannot run here, and why. Every skip in the suite
 * goes through this. A local run reports it as a skip: a pass whose name
 * says `(SKIPPED)`, counted apart in the tally. A run with
 * {@link everyLaneRequired} records a failure instead, so a lane can never
 * drop out of CI unnoticed.
 */
export function recordSkip(
  record: RecordCheck,
  name: string,
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (everyLaneRequired(env)) {
    record(
      name,
      false,
      `DID NOT RUN: ${reason} (ITEST_REQUIRE_ALL_LANES=1 needs every lane to run)`,
    );
    return;
  }
  record(`${name} (SKIPPED)`, true, reason);
}

/** Does this check name mark a skip {@link recordSkip} reported? */
export function isSkippedCheck(name: string): boolean {
  return name.endsWith(' (SKIPPED)');
}

/** The `Cookie` header a browser would send after `response`. */
export function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
}

/**
 * A fresh user signed up through Better Auth (with {@link ITEST_PASSWORD})
 * and a member of NO organization yet — what a lane needs when the
 * membership itself is what it exercises (the members API, an org the user
 * goes on to create and own) or when the probe is about the account alone.
 * `signUpOrgMember` builds on it; a lane that only needs another pair of
 * hands in the suite's org wants that one. `userId` is empty when the
 * sign-up was refused.
 */
export async function signUpUser(
  base: string,
  label: string,
): Promise<{ cookie: string; userId: string; email: string }> {
  const email = `itest-${label}-${Date.now()}@example.com`;
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({
      email,
      password: ITEST_PASSWORD,
      name: `Itest ${label}`,
    }),
  });
  const parsed = z
    .object({ user: z.object({ id: z.string() }) })
    .safeParse(await res.json());
  return {
    cookie: cookieHeaderFrom(res),
    userId: parsed.success ? parsed.data.user.id : '',
    email,
  };
}
