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
import type { ToolArtifact } from '../../../lib/chat/tools.ts';
import {
  drainSessionExecResilient,
  sessionListFiles,
  sessionReadFile,
  SessionFileTooLargeError,
  sessionStageFiles,
  type SessionExecResult,
  type SessionStageFile,
} from '../../core/node_only/sandbox/helpers/session_client.ts';
import { stageUrlForBlobRef } from '../../core/node_only/sandbox/helpers/stage_url.ts';
import { readSkillBundleForViewer } from '../../core/skills/file_actions.ts';
import { CHAT_ARTIFACT_MAX_BYTES } from '../chat/artifacts.ts';
import {
  acquireLightSession,
  LightSandboxBusyError,
  touchLightSession,
} from '../sandbox/light-sessions.ts';
import {
  failure,
  isArgsRecord,
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

export async function runRunCode(
  scope: WorkToolScope,
  input: unknown,
): Promise<unknown> {
  const args = readArgs(input);
  if ('error' in args) return failure('invalid_args', args.error);

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
    (file) => file.sizeBytes > CHAT_ARTIFACT_MAX_BYTES * 2,
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
    const bundle = await readSkillBundleForViewer({
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

  let lease: { sessionId: string; created: boolean };
  try {
    lease = await acquireLightSession(scope.sql, {
      organizationId: scope.organizationId,
      ownerKey: scope.sandboxOwnerKey,
      createdBy: scope.userId,
    });
  } catch (error) {
    if (error instanceof LightSandboxBusyError) {
      return failure(
        'busy',
        `${error.message} Try again in a minute, or answer without running code.`,
      );
    }
    throw error;
  }

  return serialized(lease.sessionId, async () => {
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
    const result: SessionExecResult = await drainSessionExecResilient(
      lease.sessionId,
      {
        execId,
        command: [INTERPRETERS[args.language], `/agent/${codePath}`],
        cwd: LIGHT_SANDBOX_PATHS.workspace,
        collectOutput: true,
        timeoutMs: args.timeoutSeconds * 1000,
      },
      AbortSignal.timeout((args.timeoutSeconds + 60) * 1000),
    );
    const elapsedMs = Date.now() - startedAt;

    const { artifacts, skipped } = await harvestOutputs(scope, lease.sessionId);
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
      ...(artifacts.length === 0 && ok
        ? {
            note: `No file was attached: only files in ${LIGHT_SANDBOX_PATHS.output}/ that are new or changed are.`,
          }
        : {}),
    };
  });
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
  z.object({ size: z.number(), mtimeMs: z.number(), sha256: z.string() }),
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
): Promise<{ artifacts: ToolArtifact[]; skipped: SkippedOutput[] }> {
  const artifacts: ToolArtifact[] = [];
  const skipped: SkippedOutput[] = [];
  const entries =
    (await sessionListFiles(sessionId, LIGHT_SANDBOX_PATHS.output)) ?? [];
  const before = await readDelivered(sessionId);
  // Rebuilt from the listing: a file that left the output box is forgotten,
  // and comes back as new if it is written again.
  const after = new Map<string, Delivered>();
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== 'file') {
      skipped.push({
        name: entry.name,
        reason:
          entry.type === 'dir'
            ? 'a folder — only files directly in the output box are attached'
            : 'not a regular file',
      });
      continue;
    }
    const previous = before.get(entry.name);
    if (
      previous !== undefined &&
      previous.size === entry.size &&
      previous.mtimeMs === entry.mtimeMs
    ) {
      after.set(entry.name, previous);
      continue;
    }
    const path = `${LIGHT_SANDBOX_PATHS.output}/${entry.name}`;
    if (artifacts.length >= RUN_CODE_MAX_OUTPUT_FILES) {
      skipped.push({
        name: entry.name,
        reason: `over the ${RUN_CODE_MAX_OUTPUT_FILES} files one call attaches`,
      });
      continue;
    }
    if (entry.size > CHAT_ARTIFACT_MAX_BYTES) {
      skipped.push({
        name: entry.name,
        reason: `${Math.ceil(entry.size / (1024 * 1024))} MB is over the ${CHAT_ARTIFACT_MAX_BYTES / (1024 * 1024)} MB a file may have`,
      });
      continue;
    }
    let read: Awaited<ReturnType<typeof sessionReadFile>>;
    try {
      read = await sessionReadFile(sessionId, path, {
        maxBytes: CHAT_ARTIFACT_MAX_BYTES,
      });
    } catch (error) {
      if (!(error instanceof SessionFileTooLargeError)) throw error;
      skipped.push({ name: entry.name, reason: 'grew too large to attach' });
      continue;
    }
    if (read === null) {
      skipped.push({ name: entry.name, reason: 'could not be read' });
      continue;
    }
    const bytes = new Uint8Array(read.bytes);
    const version: Delivered = {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    if (previous?.sha256 === version.sha256) {
      // Rewritten with the same bytes: nothing new to deliver.
      after.set(entry.name, version);
      continue;
    }
    const name = uniqueArtifactName(
      safeArtifactName(entry.name) ?? 'output',
      names,
    );
    names.add(name);
    try {
      artifacts.push(
        await scope.artifacts.store({
          name,
          mediaType: artifactMediaType(name),
          bytes,
        }),
      );
      after.set(entry.name, version);
    } catch (error) {
      console.warn(`[run_code] storing ${entry.name} failed:`, error);
      skipped.push({
        name: entry.name,
        reason: error instanceof Error ? error.message : 'could not be stored',
      });
    }
  }
  const changed =
    before.size !== after.size ||
    [...after].some(([name, entry]) => before.get(name) !== entry);
  if (changed) {
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
  return { artifacts, skipped };
}
