import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  artifactMediaType,
  safeArtifactName,
  uniqueArtifactName,
} from '../../../lib/agent/artifacts.ts';
import {
  LIGHT_SANDBOX_PATHS,
  RUN_CODE_DEFAULT_TIMEOUT_SECONDS,
  RUN_CODE_LANGUAGES,
  RUN_CODE_MAX_CODE_CHARS,
  RUN_CODE_MAX_INPUT_FILES,
  RUN_CODE_MAX_OUTPUT_FILES,
  RUN_CODE_MAX_SKILLS,
  RUN_CODE_MAX_TIMEOUT_SECONDS,
  RUN_CODE_OUTPUT_TAIL_CHARS,
  type RunCodeLanguage,
} from '../../../lib/agent/work-tools.ts';
import type { ToolArtifact, ToolCallOptions } from '../../../lib/chat/tools.ts';
import {
  drainSessionExecResilient,
  sessionCancelExec,
  sessionListFiles,
  sessionReadFile,
  SessionFileTooLargeError,
  SessionNotFoundError,
  sessionStageFiles,
  SpawnerUnreachableError,
  type SessionExecResult,
  type SessionStageFile,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { stageUrlForBlobRef } from '../../core/node_only/sandbox/helpers/stage_url.ts';
import { readSkillBundleForViewer } from '../../core/skills/file_actions.ts';
import {
  acquireLightSession,
  LightSandboxBusyError,
  LightSandboxUnavailableError,
  type LightSessionLease,
  touchLightSession,
} from '../sandbox/light-sessions.ts';
import { ARTIFACT_MAX_BYTES } from './artifacts.ts';
import {
  failure,
  isArgsRecord,
  skillReachable,
  stringList,
  type InputFile,
  type WorkToolScope,
} from './scope.ts';

/**
 * `run_code` — run a program in the turn's light sandbox and attach what it
 * writes to the output box.
 *
 * One call, in order:
 *  1. The arguments are read and bounded, the input files resolved against
 *     what the turn may read, and the skills against what its person sees —
 *     all before any sandbox starts, so a bad call costs nothing.
 *  2. The owner's light sandbox is acquired: the running one, or a new one
 *     in well under a second.
 *  3. The program, the input files and the skill bundles are staged.
 *  4. The program runs in the workspace under its deadline.
 *  5. Every file of the output box that is new or changed since the last
 *     call is stored as an artifact. Files stay, so a later call can check
 *     or convert what an earlier one wrote; the sandbox remembers what it
 *     delivered (`code/.delivered.json`), so each version arrives once.
 *
 * Calls of one sandbox run one at a time — the output box is shared, and a
 * second program harvesting the first one's files would attach them to the
 * wrong call.
 */

/** Calls of one sandbox in flight in this process, chained. */
const sandboxQueues = new Map<string, Promise<unknown>>();

function serialized<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
  const previous = sandboxQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.then(work, work);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  sandboxQueues.set(sessionId, settled);
  void settled.then(() => {
    if (sandboxQueues.get(sessionId) === settled) {
      sandboxQueues.delete(sessionId);
    }
  });
  return next;
}

const EXTENSIONS: Record<RunCodeLanguage, string> = {
  python: 'py',
  node: 'js',
  bash: 'sh',
};

const INTERPRETERS: Record<RunCodeLanguage, string> = {
  python: 'python3',
  node: 'node',
  bash: 'bash',
};

/**
 * What a program runs with beyond the sandbox's own environment. Matplotlib
 * keeps its configuration and font cache in the workspace, so the cache
 * lives as long as the sandbox does and only the first chart pays for it. A
 * chart is drawn to a file, never to a screen.
 */
const PROGRAM_ENV = {
  MPLCONFIGDIR: `${LIGHT_SANDBOX_PATHS.workspace}/.cache/matplotlib`,
  MPLBACKEND: 'Agg',
};

/** How often a call that waits for a light sandbox asks again, when the host
 * named no time of its own. */
const BUSY_POLL_MS = 3_000;

/** The reply was stopped, or the round's tools ran out of time, while this
 * call waited. */
class StoppedWhileWaiting extends Error {}

/** What the model reads when its call was cut off. */
function stopped(): ReturnType<typeof failure> {
  return failure(
    'cancelled',
    `The program was stopped before it finished: the reply was stopped or the step ran out of time. Files it had already written stay in ${LIGHT_SANDBOX_PATHS.output}/ and are attached by the next run.`,
  );
}

/**
 * What the model reads when no light sandbox could run its program for a
 * reason that is not room — the host has no runtime image yet, the sandbox
 * service does not answer, the sandbox failed to start or stopped under the
 * program. Each says whether a second try can help, and what to tell the
 * person, so a reply never ends on a bare "it did not work"; the step shows
 * the reason. The spawner's own words stay in the server log.
 */
const SANDBOX_UNAVAILABLE: Record<
  LightSandboxUnavailableError['kind'] | 'lost',
  ReturnType<typeof failure>
> = {
  not_ready: failure(
    'unavailable',
    'The sandbox host has no runtime image ready yet, so no sandbox can start. Tell the user that code cannot run here at the moment and to try again in a few minutes; answer without running code meanwhile.',
    'sandbox_not_ready',
  ),
  unreachable: failure(
    'unavailable',
    'The sandbox service cannot be reached right now, so no code can run. Tell the user that code cannot run at the moment and answer without running code; do not call run_code again in this reply.',
    'sandbox_unreachable',
  ),
  failed: failure(
    'unavailable',
    'The light sandbox could not start. You may call run_code once more; if it fails again, tell the user that code cannot run right now and answer without running code.',
    'sandbox_failed',
  ),
  lost: failure(
    'unavailable',
    'The light sandbox stopped while the program ran (its host may have restarted), and the files it held are gone. Run the program again: a fresh sandbox starts.',
    'sandbox_failed',
  ),
};

function sandboxUnavailable(
  kind: LightSandboxUnavailableError['kind'] | 'lost',
): ReturnType<typeof failure> {
  return { ...SANDBOX_UNAVAILABLE[kind] };
}

/** How often the sandbox is asked to cancel a program it does not know yet,
 * and how long between the asks. */
const CANCEL_ATTEMPTS = 4;
const CANCEL_RETRY_MS = 300;

/**
 * Cut a program off in its sandbox. The cancel can overtake the request that
 * starts the program, and the sandbox then answers it knows no such program —
 * the same answer it gives for one that already ended. So the ask is repeated
 * a few times: a program left running holds a sandbox nobody waits for.
 */
async function cancelProgram(sessionId: string, execId: string): Promise<void> {
  for (let attempt = 1; attempt <= CANCEL_ATTEMPTS; attempt += 1) {
    try {
      if (await sessionCancelExec(sessionId, execId)) return;
    } catch (error) {
      console.warn(
        `[run_code] stopping the program of ${sessionId} failed:`,
        error,
      );
    }
    if (attempt < CANCEL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, CANCEL_RETRY_MS));
    }
  }
}

/** Wait `ms`, or less when `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The owner's light sandbox, waiting up to the scope's patience when none can
 * be had now. Every sandbox of the organization running code frees within
 * the three minutes one call may take, and a host preparing its image is
 * ready soon after, so a lane with nobody to ask again (a task run) waits
 * rather than giving up on its first refusal.
 */
async function acquireLeased(
  scope: WorkToolScope,
  signal?: AbortSignal,
): Promise<LightSessionLease> {
  const deadline = Date.now() + (scope.lightSandboxWaitMs ?? 0);
  for (;;) {
    if (signal?.aborted === true) throw new StoppedWhileWaiting();
    try {
      return await acquireLightSession(scope.sql, {
        organizationId: scope.organizationId,
        ownerKey: scope.sandboxOwnerKey,
        createdBy: scope.userId,
      });
    } catch (error) {
      if (
        !(error instanceof LightSandboxBusyError) &&
        !(
          error instanceof LightSandboxUnavailableError &&
          error.kind === 'not_ready'
        )
      ) {
        throw error;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw error;
      await pause(Math.min(error.retryAfterMs ?? BUSY_POLL_MS, left), signal);
    }
  }
}

interface RunCodeArgs {
  language: RunCodeLanguage;
  code: string;
  files: string[];
  skills: string[];
  timeoutSeconds: number;
}

function readArgs(input: unknown): RunCodeArgs | { error: string } {
  if (!isArgsRecord(input)) {
    return {
      error:
        'run_code takes {"language": "python"|"node"|"bash", "code": "<program>"}.',
    };
  }
  const language = RUN_CODE_LANGUAGES.find((value) => value === input.language);
  if (language === undefined) {
    return { error: '"language" must be "python", "node" or "bash".' };
  }
  if (typeof input.code !== 'string' || input.code.trim() === '') {
    return { error: '"code" must be the complete program.' };
  }
  if (input.code.length > RUN_CODE_MAX_CODE_CHARS) {
    return {
      error: `"code" is ${input.code.length} characters; keep a program under ${RUN_CODE_MAX_CODE_CHARS} — read large data from a file instead.`,
    };
  }
  const files = stringList(input.files);
  if (files === null) {
    return { error: '"files" must be a list of file refs.' };
  }
  if (files.length > RUN_CODE_MAX_INPUT_FILES) {
    return {
      error: `Pass at most ${RUN_CODE_MAX_INPUT_FILES} "files" per call.`,
    };
  }
  const skills = stringList(input.skills);
  if (skills === null) {
    return { error: '"skills" must be a list of skill names.' };
  }
  if (skills.length > RUN_CODE_MAX_SKILLS) {
    return { error: `Pass at most ${RUN_CODE_MAX_SKILLS} "skills" per call.` };
  }
  let timeoutSeconds = RUN_CODE_DEFAULT_TIMEOUT_SECONDS;
  if (input.timeoutSeconds !== undefined) {
    if (
      typeof input.timeoutSeconds !== 'number' ||
      !Number.isInteger(input.timeoutSeconds) ||
      input.timeoutSeconds < 5 ||
      input.timeoutSeconds > RUN_CODE_MAX_TIMEOUT_SECONDS
    ) {
      return {
        error: `"timeoutSeconds" must be a whole number from 5 to ${RUN_CODE_MAX_TIMEOUT_SECONDS}.`,
      };
    }
    timeoutSeconds = input.timeoutSeconds;
  }
  return {
    language,
    code: input.code,
    files: [...new Set(files)],
    skills: [...new Set(skills)],
    timeoutSeconds,
  };
}

/** The end of a stream as the model reads it: the last
 * {@link RUN_CODE_OUTPUT_TAIL_CHARS} characters, marked when cut. */
function tail(text: string): string {
  if (text.length <= RUN_CODE_OUTPUT_TAIL_CHARS) return text;
  return `…(${text.length - RUN_CODE_OUTPUT_TAIL_CHARS} earlier characters cut)\n${text.slice(-RUN_CODE_OUTPUT_TAIL_CHARS)}`;
}

function decode(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8');
}

/** The staged path of each input file under `inputs/`, by ref: its own
 * name, numbered when two share one. */
function inputPaths(files: readonly InputFile[]): Map<string, string> {
  const taken = new Set<string>();
  const paths = new Map<string, string>();
  for (const file of files) {
    const name = uniqueArtifactName(
      safeArtifactName(file.name) ?? 'file',
      taken,
    );
    taken.add(name);
    paths.set(file.ref, name);
  }
  return paths;
}

interface SkippedOutput {
  name: string;
  reason: string;
}

/** The most files of the output box one call looks at, and the most skipped
 * ones it names; the rest are counted. */
const HARVEST_MAX_ENTRIES = 200;
const HARVEST_MAX_SKIPPED_LISTED = 20;

export async function runRunCode(
  scope: WorkToolScope,
  input: unknown,
  options: ToolCallOptions = {},
): Promise<unknown> {
  const { signal } = options;
  // Read through a function: the signal's state changes under the awaits below,
  // which a narrowing of `signal.aborted` would not know.
  const toldToStop = (): boolean => signal?.aborted === true;
  const args = readArgs(input);
  if ('error' in args) return failure('invalid_args', args.error);
  if (toldToStop()) return stopped();

  const resolved = await scope.inputs.resolve(args.files);
  const missing = args.files.filter((ref) => !resolved.has(ref));
  if (missing.length > 0) {
    return failure(
      'not_found',
      `These refs name no file of this conversation: ${missing.join(', ')}. Use the refs of files the person uploaded or that you created.`,
    );
  }
  const inputFiles = args.files.flatMap((ref) => {
    const file = resolved.get(ref);
    return file === undefined ? [] : [file];
  });
  const oversized = inputFiles.find(
    (file) => file.sizeBytes > ARTIFACT_MAX_BYTES * 2,
  );
  if (oversized !== undefined) {
    return failure(
      'invalid_args',
      `"${oversized.name}" is too large to copy into the light sandbox.`,
    );
  }

  const skillFiles: SessionStageFile[] = [];
  const skillRoots: string[] = [];
  for (const slug of args.skills) {
    const bundle = !skillReachable(scope, slug)
      ? null
      : await readSkillBundleForViewer({
          orgSlug: scope.orgSlug,
          slug,
          viewer: scope.skillViewer,
        }).catch((error: unknown) => {
          console.warn(`[run_code] skill "${slug}" could not be read:`, error);
          return null;
        });
    if (bundle === null || bundle.files.length === 0) {
      return failure(
        'not_found',
        `There is no skill "${slug}" in this person's library.`,
      );
    }
    const root = `skills/${slug}`;
    skillRoots.push(root);
    for (const file of bundle.files) {
      skillFiles.push({
        path: `${root}/${file.path}`,
        contentBase64: file.contentBase64,
      });
    }
  }

  let lease: LightSessionLease;
  try {
    lease = await acquireLeased(scope, signal);
  } catch (error) {
    if (error instanceof StoppedWhileWaiting) return stopped();
    if (error instanceof LightSandboxBusyError) {
      return failure(
        'busy',
        `${error.message} Try again in a minute, or answer without running code.`,
        error.kind === 'host' ? 'sandbox_host_busy' : 'sandboxes_busy',
      );
    }
    if (error instanceof LightSandboxUnavailableError) {
      console.warn(
        `[run_code] no light sandbox for ${scope.organizationId} (${error.kind}):`,
        error.cause ?? error,
      );
      return sandboxUnavailable(error.kind);
    }
    throw error;
  }

  return serialized(lease.sessionId, () =>
    runInSandbox(
      scope,
      args,
      lease,
      { inputFiles, skillFiles, skillRoots },
      options,
    ).catch((error: unknown) => {
      // The sandbox went away under the call: its service stopped
      // answering, or the sandbox itself was gone. Anything else is a
      // fault the executor reports.
      if (error instanceof SpawnerUnreachableError) {
        console.warn(`[run_code] the sandbox service did not answer:`, error);
        return sandboxUnavailable('unreachable');
      }
      if (error instanceof SessionNotFoundError) {
        console.warn(
          `[run_code] the light sandbox ${lease.sessionId} is gone:`,
          error,
        );
        return sandboxUnavailable('lost');
      }
      throw error;
    }),
  );
}

/** What a call stages beside its program: the input files it reads and the
 * skill bundles it uses. */
interface CallStaging {
  inputFiles: InputFile[];
  skillFiles: SessionStageFile[];
  skillRoots: string[];
}

/** Steps 3 to 5 of a call, in its leased sandbox: stage, run, harvest. */
async function runInSandbox(
  scope: WorkToolScope,
  args: RunCodeArgs,
  lease: LightSessionLease,
  { inputFiles, skillFiles, skillRoots }: CallStaging,
  { signal, shownFiles }: ToolCallOptions,
): Promise<unknown> {
  const toldToStop = (): boolean => signal?.aborted === true;
  // The batch may have given up on this call while it waited its turn behind
  // another program of the sandbox: it starts nothing then.
  if (toldToStop()) return stopped();
  const execId = randomUUID().replace(/-/g, '');
  const codePath = `code/run-${execId.slice(0, 12)}.${EXTENSIONS[args.language]}`;
  const paths = inputPaths(inputFiles);
  const staged: SessionStageFile[] = [
    {
      path: codePath,
      contentBase64: Buffer.from(args.code, 'utf8').toString('base64'),
    },
  ];
  for (const file of inputFiles) {
    const url = await stageUrlForBlobRef(
      file.ref,
      scope.organizationId,
      file.sizeBytes,
      file.sizeBytes,
    );
    if (url === null) {
      return failure(
        'unavailable',
        `"${file.name}" cannot be copied into the sandbox on this deployment.`,
      );
    }
    staged.push({ path: `inputs/${paths.get(file.ref) ?? 'file'}`, url });
  }
  const stage = await sessionStageFiles(
    lease.sessionId,
    [...staged, ...skillFiles],
    skillRoots.length > 0 ? { reuse: true, replaceRoots: skillRoots } : {},
  );
  if (stage.skipped.length > 0) {
    return failure(
      'error',
      `The sandbox could not take every file: ${stage.skipped.map((entry) => `${entry.path} (${entry.reason})`).join(', ')}.`,
    );
  }
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout((args.timeoutSeconds + 60) * 1000);
  let result: SessionExecResult;
  try {
    result = await drainSessionExecResilient(
      lease.sessionId,
      {
        execId,
        command: [INTERPRETERS[args.language], `/agent/${codePath}`],
        cwd: LIGHT_SANDBOX_PATHS.workspace,
        env: PROGRAM_ENV,
        collectOutput: true,
        timeoutMs: args.timeoutSeconds * 1000,
      },
      signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    );
  } catch (error) {
    // The platform's own deadline is the sandbox's plus a minute: it ends a
    // drain whose sandbox stopped answering about the program.
    const outOfTime = deadline.aborted && !toldToStop();
    if (!toldToStop() && !outOfTime) throw error;
    // Stopped, or out of time: the program must not run on in a sandbox
    // nobody is waiting for.
    await cancelProgram(lease.sessionId, execId);
    if (outOfTime) {
      return failure(
        'error',
        `The program ran past its ${args.timeoutSeconds}-second deadline and was stopped. Files it had already written stay in ${LIGHT_SANDBOX_PATHS.output}/ and are attached by the next run.`,
        'timed_out',
      );
    }
    return stopped();
  }
  const elapsedMs = Date.now() - startedAt;

  const { artifacts, skipped } = await harvestOutputs(
    scope,
    lease.sessionId,
    signal,
    shownFiles,
  );
  await touchLightSession(
    scope.sql,
    scope.organizationId,
    lease.sessionId,
  ).catch((error: unknown) => {
    console.warn('[run_code] marking the sandbox used failed:', error);
  });

  const timedOut = result.errorCode === 'TIMEOUT';
  const ok =
    result.status === 'completed' && result.exitCode === 0 && !timedOut;
  const failedRun = !ok && !timedOut && result.status !== 'cancelled';
  return {
    status: ok ? 'ok' : 'error',
    ...(ok
      ? {}
      : {
          message: timedOut
            ? `The program ran past its ${args.timeoutSeconds}-second deadline and was stopped.`
            : result.status === 'cancelled'
              ? 'The program was stopped before it finished.'
              : `The program ended with exit code ${result.exitCode ?? 'unknown'}${result.errorMessage !== undefined ? ` (${result.errorMessage})` : ''}.`,
          ...(timedOut
            ? { reason: 'timed_out' }
            : failedRun
              ? { reason: 'program_failed' }
              : {}),
        }),
    exitCode: result.exitCode,
    stdout: tail(decode(result.stdoutBase64)),
    stderr: tail(decode(result.stderrBase64)),
    durationMs: result.durationMs > 0 ? result.durationMs : elapsedMs,
    sandbox: lease.created ? 'started' : 'reused',
    ...(inputFiles.length > 0
      ? {
          inputs: inputFiles.map(
            (file) =>
              `${LIGHT_SANDBOX_PATHS.inputs}/${paths.get(file.ref) ?? 'file'}`,
          ),
        }
      : {}),
    artifacts,
    ...(skipped.length > 0 ? { skippedOutputs: skipped } : {}),
    // A run that wrote nothing to deliver says where files go — and, since a
    // skill's own examples save to the working directory, which files sit
    // there instead. A run whose outputs were skipped says why already.
    ...(artifacts.length === 0 && skipped.length === 0 && ok
      ? { note: await noOutputNote(lease.sessionId) }
      : {}),
  };
}

/**
 * Start the turn's light sandbox ahead of its first `run_code` — fire and
 * forget. A turn that loads a skill with scripts is about to run code, and
 * the model spends seconds writing the program; starting the sandbox now
 * hides its start inside that time. The later call joins the same start
 * (`acquireLightSession` shares one in flight) or finds it running. A
 * failure here is only logged: the call itself tries again and reports.
 */
export function prewarmLightSandbox(scope: WorkToolScope): void {
  if (!scope.loadout.runCode) return;
  void acquireLightSession(scope.sql, {
    organizationId: scope.organizationId,
    ownerKey: scope.sandboxOwnerKey,
    createdBy: scope.userId,
  }).catch((error: unknown) => {
    console.warn('[run_code] starting the light sandbox early failed:', error);
  });
}

/**
 * Where the platform remembers what it already delivered from a sandbox's
 * output box: each file's size, modification time and content digest, by
 * name. It lives in the sandbox itself, beside the staged programs, so the
 * memory dies with the sandbox and any process serving the next call reads
 * it. Losing it costs at most a file attached twice, never a lost one.
 */
const DELIVERED_MANIFEST = 'code/.delivered.json';
const DELIVERED_MANIFEST_MAX_BYTES = 256 * 1024;

const deliveredSchema = z.record(
  z.string(),
  z.object({
    size: z.number(),
    mtimeMs: z.number(),
    sha256: z.string(),
    /** The file it was delivered as. Absent on a record written before
     * deliveries kept it. */
    ref: z.string().optional(),
  }),
);

type Delivered = z.infer<typeof deliveredSchema>[string];

/** What the sandbox says was delivered. The program can reach the record,
 * so one that does not parse counts as empty: at worst a file is attached
 * again. */
async function readDelivered(
  sessionId: string,
): Promise<Map<string, Delivered>> {
  try {
    const read = await sessionReadFile(
      sessionId,
      `/agent/${DELIVERED_MANIFEST}`,
      { maxBytes: DELIVERED_MANIFEST_MAX_BYTES },
    );
    if (read === null) return new Map();
    const parsed = deliveredSchema.safeParse(
      JSON.parse(Buffer.from(read.bytes).toString('utf8')),
    );
    if (parsed.success) return new Map(Object.entries(parsed.data));
    console.warn(
      '[run_code] the delivered-files record is malformed:',
      parsed.error.message,
    );
    return new Map();
  } catch (error) {
    console.warn('[run_code] the delivered-files record is unreadable:', error);
    return new Map();
  }
}

/**
 * Store every top-level file of the output box that is new or changed since
 * the last call as an artifact; a file whose bytes are what was delivered
 * before is not attached again. Files stay in the sandbox, so a later call
 * can open, check or convert what an earlier one wrote. A file that cannot
 * be taken is reported, never fatal to the others.
 */
async function harvestOutputs(
  scope: WorkToolScope,
  sessionId: string,
  signal?: AbortSignal,
  shownFiles?: ReadonlySet<string>,
): Promise<{ artifacts: ToolArtifact[]; skipped: SkippedOutput[] }> {
  /** Whether a version the sandbox delivered is one the conversation still
   * shows. A delivery left on a reply that was tried again, or behind a
   * message that was edited, is not: when the program writes the same bytes
   * again, they come again, so the reply that is shown has its file. */
  const shown = (delivered: Delivered): boolean =>
    shownFiles === undefined ||
    delivered.ref === undefined ||
    shownFiles.has(delivered.ref);
  const artifacts: ToolArtifact[] = [];
  // Set when a Stop (or the step's time) ended the harvest between two files:
  // what it stored stays stored and is returned, but it is not recorded as
  // delivered — the batch may already have given up on this call, and a file
  // recorded for a reply that never got it would be lost. Unrecorded, a later
  // call attaches it: a duplicate at worst.
  let interrupted = false;
  const skipped: SkippedOutput[] = [];
  /** Files left out of the answer's list, not out of the sandbox. */
  let unlisted = 0;
  // What the model reads back is bounded however many files a program wrote:
  // a program can fill the box with thousands, and every name would ride the
  // tool result, the reply's record and the next round's prompt.
  const skip = (name: string, reason: string) => {
    if (skipped.length < HARVEST_MAX_SKIPPED_LISTED) {
      skipped.push({ name, reason });
    } else {
      unlisted += 1;
    }
  };
  const listing =
    (await sessionListFiles(sessionId, LIGHT_SANDBOX_PATHS.output)) ?? [];
  // Newest first, whatever order the sandbox listed them in: what the program
  // just wrote has the latest modification times, so the entries this call
  // looks at are the ones it is for.
  const ordered = [...listing].sort(
    (a, b) =>
      b.mtimeMs - a.mtimeMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const entries = ordered.slice(0, HARVEST_MAX_ENTRIES);
  const beyond = ordered.slice(HARVEST_MAX_ENTRIES);
  unlisted += beyond.length;
  const before = await readDelivered(sessionId);
  // Rebuilt from the listing: a file that left the output box is forgotten,
  // and comes back as new if it is written again. A delivered file the window
  // did not reach is still there, unchanged, and stays delivered — else it
  // would be attached again the day it comes back into view.
  const after = new Map<string, Delivered>();
  for (const entry of beyond) {
    const previous = before.get(entry.name);
    if (
      previous !== undefined &&
      entry.type === 'file' &&
      previous.size === entry.size &&
      previous.mtimeMs === entry.mtimeMs
    ) {
      after.set(entry.name, previous);
    }
  }
  const names = new Set<string>();
  for (const entry of entries) {
    if (signal?.aborted === true) {
      interrupted = true;
      break;
    }
    if (entry.type !== 'file') {
      skip(
        entry.name,
        entry.type === 'dir'
          ? 'a folder — only files directly in the output box are attached'
          : 'not a regular file',
      );
      continue;
    }
    const previous = before.get(entry.name);
    if (
      previous !== undefined &&
      previous.size === entry.size &&
      previous.mtimeMs === entry.mtimeMs
    ) {
      // Untouched since it was delivered: this program did not write it,
      // whichever reply it came on.
      after.set(entry.name, previous);
      continue;
    }
    const path = `${LIGHT_SANDBOX_PATHS.output}/${entry.name}`;
    if (artifacts.length >= RUN_CODE_MAX_OUTPUT_FILES) {
      skip(
        entry.name,
        `over the ${RUN_CODE_MAX_OUTPUT_FILES} files one call attaches`,
      );
      continue;
    }
    if (entry.size > ARTIFACT_MAX_BYTES) {
      skip(
        entry.name,
        `${Math.ceil(entry.size / (1024 * 1024))} MB is over the ${ARTIFACT_MAX_BYTES / (1024 * 1024)} MB a file may have`,
      );
      continue;
    }
    let read: Awaited<ReturnType<typeof sessionReadFile>>;
    try {
      read = await sessionReadFile(sessionId, path, {
        maxBytes: ARTIFACT_MAX_BYTES,
      });
    } catch (error) {
      if (!(error instanceof SessionFileTooLargeError)) throw error;
      skip(entry.name, 'grew too large to attach');
      continue;
    }
    if (read === null) {
      skip(entry.name, 'could not be read');
      continue;
    }
    const bytes = new Uint8Array(read.bytes);
    const version: Delivered = {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    if (
      previous !== undefined &&
      previous.sha256 === version.sha256 &&
      shown(previous)
    ) {
      // Rewritten with the same bytes: nothing new to deliver.
      after.set(
        entry.name,
        previous.ref === undefined
          ? version
          : { ...version, ref: previous.ref },
      );
      continue;
    }
    const name = uniqueArtifactName(
      safeArtifactName(entry.name) ?? 'output',
      names,
    );
    names.add(name);
    try {
      const artifact = await scope.artifacts.store({
        name,
        mediaType: artifactMediaType(name),
        bytes,
      });
      artifacts.push(artifact);
      after.set(entry.name, { ...version, ref: artifact.ref });
    } catch (error) {
      console.warn(`[run_code] storing ${entry.name} failed:`, error);
      skip(
        entry.name,
        error instanceof Error ? error.message : 'could not be stored',
      );
    }
  }
  const changed =
    before.size !== after.size ||
    [...after].some(([name, entry]) => before.get(name) !== entry);
  if (changed && !interrupted) {
    await sessionStageFiles(sessionId, [
      {
        path: DELIVERED_MANIFEST,
        contentBase64: Buffer.from(
          JSON.stringify(Object.fromEntries(after)),
          'utf8',
        ).toString('base64'),
      },
    ]).catch((error: unknown) => {
      // The files are stored; without the record a later call attaches an
      // unchanged one again — a duplicate, never a loss.
      console.warn('[run_code] recording the delivered files failed:', error);
    });
  }
  if (unlisted > 0) {
    skipped.push({
      name: `${unlisted} more`,
      reason: 'files of the output box left out of this list',
    });
  }
  return { artifacts, skipped };
}

/** The most files of the working directory a no-output note names. */
const WORKSPACE_FILES_NAMED = 5;

/**
 * What the model reads when a run attached nothing: only new or changed
 * files directly in the output box are attached, and — when the working
 * directory holds files at its top — their names, newest first, so a
 * program that saved its document beside itself (as a skill's examples do)
 * is told where it went instead of guessing.
 */
async function noOutputNote(sessionId: string): Promise<string> {
  const base = `No file was attached: only files in ${LIGHT_SANDBOX_PATHS.output}/ that are new or changed are.`;
  let listing: Awaited<ReturnType<typeof sessionListFiles>>;
  try {
    listing = await sessionListFiles(sessionId, LIGHT_SANDBOX_PATHS.workspace);
  } catch (error) {
    console.warn('[run_code] listing the working directory failed:', error);
    return base;
  }
  const files = (listing ?? [])
    .filter((entry) => entry.type === 'file' && !entry.name.startsWith('.'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, WORKSPACE_FILES_NAMED)
    .map((entry) => entry.name);
  if (files.length === 0) return base;
  return `${base} ${LIGHT_SANDBOX_PATHS.workspace}/ holds ${files.join(', ')}: write or copy the files the user should get to ${LIGHT_SANDBOX_PATHS.output}/.`;
}
