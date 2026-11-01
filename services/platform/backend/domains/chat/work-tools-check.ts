import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { LIGHT_SANDBOX_PATHS } from '../../../lib/agent/work-tools.ts';
import {
  CHAT_SANDBOX_CHECK_DEADLINE_MS,
  CHAT_SANDBOX_CHECK_MISSING_NAMED,
  type ChatSandboxCheck,
  type ChatSandboxCheckFailure,
} from '../../../lib/chat/work-tools-check.ts';
import {
  drainSessionExecResilient,
  type SessionExecBody,
  type SessionExecResult,
  SessionNotFoundError,
  sessionReadFile,
  SpawnerUnreachableError,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import {
  acquireLightSession,
  destroyLightSession,
  LIGHT_SANDBOX_FAILURES,
  LightSandboxBusyError,
  LightSandboxUnavailableError,
  type LightSessionLease,
  type LightSessionOwner,
} from '../sandbox/light-sessions.ts';
import { sandboxConfigured } from './work-tools-status.ts';

/**
 * The Run check of the Chat tool status panel: start a light sandbox the way
 * a reply's `run_code` does — in the organization's light budget, answering
 * busy as `run_code` does when every light sandbox is in use — look in it
 * for the document libraries its runtime image lists, and have it write a
 * Word file that the platform reads back the way a reply's files are
 * collected. Its answer names the first piece that failed, in codes; the
 * sandbox service's and the program's own words stay in the server log.
 *
 * Each check has a sandbox of its own, so two checks never meet, and it
 * destroys that sandbox when it ends. It waits for the destroy only until its
 * deadline, so the answer never waits on a sandbox service that hangs; a
 * destroy that fails leaves the sandbox to the watchdog
 * (`destroyLightSession`).
 */

/** Where the runtime image keeps the lists it installed its document
 * libraries from (`services/sandbox-runtime/Dockerfile`): the hash-locked
 * Python requirements, and the Node packages a program finds on its
 * `NODE_PATH`. The check reads these lists, so it never keeps its own. */
const PYTHON_MANIFEST = '/opt/tale/document-python-requirements.txt';
const NODE_MANIFEST = '/opt/tale/document-node/package.json';

/** The Word file the check writes, where a reply's files are collected. */
const CHECK_FILE = `${LIGHT_SANDBOX_PATHS.output}/tale-run-check.docx`;
const CHECK_FILE_MAX_BYTES = 1024 * 1024;

/** How long the check's program may run in the sandbox. */
const CHECK_PROGRAM_TIMEOUT_MS = 30_000;

/**
 * The program the check runs: it reads the image's lists, names each listed
 * library that is not installed — a manifest it cannot read, or one that
 * lists nothing, is named in its place, so a pass always counts libraries —
 * and writes {@link CHECK_FILE} with `python-docx`, the library `run_code`
 * offers for Word files. It prints one line of JSON.
 */
const CHECK_PROGRAM = `
import importlib.metadata, json, os, re, sys
missing = []
listed = 0
try:
    with open(${JSON.stringify(PYTHON_MANIFEST)}, encoding="utf-8") as manifest:
        names = [m.group(0) for m in (re.match(r"[A-Za-z0-9][A-Za-z0-9._-]*", line) for line in manifest) if m]
except OSError:
    names = []
if not names:
    missing.append(${JSON.stringify(PYTHON_MANIFEST.split('/').pop())})
for name in names:
    listed += 1
    try:
        importlib.metadata.distribution(name)
    except importlib.metadata.PackageNotFoundError:
        missing.append(name)
roots = [root for root in os.environ.get("NODE_PATH", "").split(os.pathsep) if root]
try:
    with open(${JSON.stringify(NODE_MANIFEST)}, encoding="utf-8") as manifest:
        packages = list(json.load(manifest).get("dependencies", {}))
except (OSError, ValueError, AttributeError):
    packages = []
if not packages:
    missing.append("document-node/package.json")
for name in packages:
    listed += 1
    if not any(os.path.isfile(os.path.join(root, name, "package.json")) for root in roots):
        missing.append(name)
written = False
try:
    import docx
    os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
    document = docx.Document()
    document.add_paragraph("Tale run check")
    document.save(sys.argv[1])
    written = True
except Exception as error:
    print(f"writing the Word file failed: {error!r}", file=sys.stderr)
print(json.dumps({"listed": listed, "missing": missing, "written": written}))
`;

const reportSchema = z.object({
  listed: z.number().int().nonnegative(),
  missing: z.array(z.string()),
  written: z.boolean(),
});

/** A name the answer may carry: a Python distribution, a Node package
 * (scoped or not) or a manifest — never free text from the sandbox. */
const LIBRARY_NAME =
  /^@?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
const LIBRARY_NAME_MAX_CHARS = 100;

/** The sandbox verbs the check uses — injectable for tests. */
export interface ChatSandboxCheckDeps {
  readonly configured: () => boolean;
  readonly acquire: (owner: LightSessionOwner) => Promise<LightSessionLease>;
  readonly destroy: (
    owner: Pick<LightSessionOwner, 'organizationId' | 'ownerKey'>,
  ) => Promise<boolean>;
  readonly exec: (
    sessionId: string,
    body: SessionExecBody,
    signal: AbortSignal,
  ) => Promise<SessionExecResult>;
  readonly readFile: (
    sessionId: string,
    path: string,
    options: { maxBytes?: number },
  ) => Promise<{ bytes: ArrayBuffer } | null>;
  /** The check's deadline; {@link CHAT_SANDBOX_CHECK_DEADLINE_MS} unless a
   * test shortens it. */
  readonly deadlineMs?: number;
}

function sandboxDeps(sql: Sql): ChatSandboxCheckDeps {
  return {
    configured: sandboxConfigured,
    acquire: (owner) => acquireLightSession(sql, owner),
    destroy: (owner) => destroyLightSession(sql, owner),
    exec: (sessionId, body, signal) =>
      drainSessionExecResilient(sessionId, body, signal),
    readFile: (sessionId, path, options) =>
      sessionReadFile(sessionId, path, options),
  };
}

/** The check ran out of its time while it waited for the sandbox. */
class PastDeadline extends Error {}

/** `work`, unless `deadline` passes first. The work goes on then; its
 * outcome is no longer waited for, and a failure it ends in later is not
 * left unhandled. */
function beforeDeadline<T>(
  work: Promise<T>,
  deadline: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new PastDeadline());
    };
    if (deadline.aborted) onAbort();
    else deadline.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        deadline.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        deadline.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function failed(failure: ChatSandboxCheckFailure): ChatSandboxCheck {
  return { outcome: 'failed', checkedAt: Date.now(), failure };
}

function decode(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8');
}

/** The last line of the program's output, as the report it prints. */
function readReport(
  result: SessionExecResult,
): z.infer<typeof reportSchema> | null {
  if (result.status !== 'completed' || result.exitCode !== 0) return null;
  const line = decode(result.stdoutBase64).trim().split('\n').pop() ?? '';
  try {
    const parsed = reportSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    console.warn('[chat-tools-check] the check printed no report:', error);
    return null;
  }
}

/** The missing libraries the answer names: well-formed names only, and no
 * more than {@link CHAT_SANDBOX_CHECK_MISSING_NAMED}. */
function missingLibraries(names: readonly string[]): ChatSandboxCheckFailure {
  const named = names
    .filter(
      (name) =>
        name.length <= LIBRARY_NAME_MAX_CHARS && LIBRARY_NAME.test(name),
    )
    .slice(0, CHAT_SANDBOX_CHECK_MISSING_NAMED);
  return { piece: 'libraries_missing', missing: named, count: names.length };
}

/** A `.docx` is a ZIP archive: it starts with a local file header. */
function isZip(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  return (
    head.length === 4 &&
    head[0] === 0x50 &&
    head[1] === 0x4b &&
    head[2] === 0x03 &&
    head[3] === 0x04
  );
}

/** Run the check for the organization, as `userId`. */
export async function runChatSandboxCheck(
  sql: Sql,
  caller: { readonly organizationId: string; readonly userId: string },
  deps: ChatSandboxCheckDeps = sandboxDeps(sql),
): Promise<ChatSandboxCheck> {
  const startedAt = Date.now();
  if (!deps.configured()) return failed({ piece: 'sandbox_not_configured' });
  const deadline = AbortSignal.timeout(
    deps.deadlineMs ?? CHAT_SANDBOX_CHECK_DEADLINE_MS,
  );
  const owner: LightSessionOwner = {
    organizationId: caller.organizationId,
    ownerKey: `chat-tools-check:${randomUUID()}`,
    createdBy: caller.userId,
  };
  const starting = deps.acquire(owner);
  let lease: LightSessionLease;
  try {
    lease = await beforeDeadline(starting, deadline);
  } catch (error) {
    if (error instanceof PastDeadline) {
      // The start goes on: its sandbox is given back once it is up.
      void starting.then(
        () => deps.destroy(owner),
        (late: unknown) => {
          console.warn(
            `[chat-tools-check] a start past the deadline of ${caller.organizationId} failed:`,
            late,
          );
        },
      );
      return failed({ piece: 'timed_out' });
    }
    if (error instanceof LightSandboxBusyError) {
      return failed({ piece: LIGHT_SANDBOX_FAILURES[error.kind] });
    }
    if (error instanceof LightSandboxUnavailableError) {
      console.warn(
        `[chat-tools-check] no light sandbox for ${caller.organizationId} (${error.kind}):`,
        error.cause ?? error,
      );
      return failed({ piece: LIGHT_SANDBOX_FAILURES[error.kind] });
    }
    throw error;
  }

  try {
    return await checkInSandbox(lease.sessionId, deadline, deps, startedAt);
  } catch (error) {
    if (error instanceof PastDeadline) return failed({ piece: 'timed_out' });
    // The sandbox service stopped answering under the check, as a reply's
    // `run_code` says it. Anything else it answered — the sandbox was gone,
    // or it refused or broke off the program — is a sandbox that did not
    // work; what it said stays in the log.
    if (error instanceof SpawnerUnreachableError) {
      console.warn(
        '[chat-tools-check] the sandbox service did not answer:',
        error,
      );
      return failed({ piece: LIGHT_SANDBOX_FAILURES.unreachable });
    }
    console.warn(
      `[chat-tools-check] the light sandbox ${lease.sessionId} failed the check:`,
      error,
    );
    return failed({ piece: LIGHT_SANDBOX_FAILURES.failed });
  } finally {
    await destroyBeforeDeadline(owner, deadline, deps);
  }
}

/** Destroy the check's sandbox, waiting no longer than the deadline: past
 * it, the answer goes out and the destroy goes on by itself. */
async function destroyBeforeDeadline(
  owner: LightSessionOwner,
  deadline: AbortSignal,
  deps: ChatSandboxCheckDeps,
): Promise<void> {
  try {
    await beforeDeadline(deps.destroy(owner), deadline);
  } catch (error) {
    if (error instanceof PastDeadline) {
      console.warn(
        `[chat-tools-check] the sandbox of ${owner.ownerKey} was not destroyed by the deadline; the destroy goes on`,
      );
      return;
    }
    // The answer stands: the watchdog takes a sandbox left behind.
    console.warn(
      `[chat-tools-check] destroying the sandbox of ${owner.ownerKey} failed:`,
      error,
    );
  }
}

/** The check's program, in its running sandbox, and the file read back. */
async function checkInSandbox(
  sessionId: string,
  deadline: AbortSignal,
  deps: ChatSandboxCheckDeps,
  startedAt: number,
): Promise<ChatSandboxCheck> {
  let result: SessionExecResult;
  try {
    result = await deps.exec(
      sessionId,
      {
        execId: randomUUID().replace(/-/g, ''),
        command: ['python3', '-c', CHECK_PROGRAM, CHECK_FILE],
        cwd: LIGHT_SANDBOX_PATHS.workspace,
        collectOutput: true,
        timeoutMs: CHECK_PROGRAM_TIMEOUT_MS,
      },
      deadline,
    );
  } catch (error) {
    // The sandbox is destroyed next, which ends the program with it.
    if (deadline.aborted) throw new PastDeadline();
    throw error;
  }
  if (result.errorCode === 'TIMEOUT') return failed({ piece: 'timed_out' });
  const stderr = decode(result.stderrBase64).slice(-2_000);
  const report = readReport(result);
  if (report === null) {
    console.warn(
      `[chat-tools-check] the check in ${sessionId} ended ${result.status} (exit ${result.exitCode ?? 'none'}):`,
      stderr,
    );
    return failed({ piece: LIGHT_SANDBOX_FAILURES.failed });
  }
  if (report.missing.length > 0)
    return failed(missingLibraries(report.missing));
  if (!report.written) {
    console.warn(
      `[chat-tools-check] the check in ${sessionId} wrote no Word file:`,
      stderr,
    );
    return failed({ piece: 'file_not_written' });
  }
  let file: { bytes: ArrayBuffer } | null;
  try {
    file = await beforeDeadline(
      deps.readFile(sessionId, CHECK_FILE, { maxBytes: CHECK_FILE_MAX_BYTES }),
      deadline,
    );
  } catch (error) {
    if (
      error instanceof PastDeadline ||
      error instanceof SpawnerUnreachableError ||
      error instanceof SessionNotFoundError
    ) {
      throw error;
    }
    console.warn(
      `[chat-tools-check] reading the Word file of ${sessionId} back failed:`,
      error,
    );
    file = null;
  }
  if (file === null || !isZip(file.bytes)) {
    return failed({ piece: 'file_not_written' });
  }
  const checkedAt = Date.now();
  return {
    outcome: 'passed',
    checkedAt,
    libraries: report.listed,
    durationMs: checkedAt - startedAt,
  };
}
