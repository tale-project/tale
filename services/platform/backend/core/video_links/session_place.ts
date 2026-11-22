'use node';

/**
 * A sandbox session as the place a video's yt-dlp runs in
 * (tale-project/tale#4942).
 *
 * yt-dlp fetches pages and streams from whatever a member pastes, runs a
 * platform's JavaScript to get at them, and used to do so as a child of the
 * application, in its container and against its memory. Now a deployment
 * runs it in a session of the sandbox: under the host's admission instead
 * of the application's budget, as nobody, with a read-only root, and with
 * the sandbox's egress proxy as its only way out. The session's image
 * carries yt-dlp, the JavaScript runtime it looks for and the PO-token
 * plugin (`services/sandbox-runtime/Dockerfile`), and no ffmpeg: a run
 * downloads and converts nothing.
 *
 * What a run needs that a session cannot reach, it reaches through the
 * platform's relays (`relay.ts`): a proxy of video ingestion, and the
 * PO-token provider. What it leaves is read back through the spawner: its
 * metadata from stdout, a caption file whole, and the sound as a stream
 * that is passed on to the object store and held by nothing.
 *
 * {@link inYtdlpPlace} opens the place a video's work is done in: this
 * one, or a directory of this machine where a developer's own machine and
 * the tests run yt-dlp themselves (`VIDEO_INGEST_LANE=local`).
 */

import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';

import type { ActionCtx } from '../lib/ctx';
import {
  drainSessionExecResilient,
  SessionFileTooLargeError,
  sessionListFiles,
  sessionOpenFile,
  sessionReadFile,
  sessionStageFiles,
} from '../node_only/sandbox/helpers/session_client';
import { withThrowawaySession } from '../node_only/sandbox/throwaway_session';
import { sessionIdForVideo } from '../sandbox/session_naming';
import { relayPotBaseUrl, relayProxyUrl } from './relay';
import {
  BAKED_YTDLP_PLUGIN_DIR,
  BASE_FLAGS,
  createLocalYtdlpPlace,
  isPlainOutputName,
  MEDIA_MAX_BYTES,
  potProviderUrl,
  videoIngestLane,
  YtDlpError,
  ytdlpRunOutcome,
  type YtdlpPlace,
} from './ytdlp';

/** The directory of a session a run works in: one every session has, and
 * its user may write to. */
const SESSION_DIR = '/agent/output';

/**
 * How long a video's session may sit with nothing running before the
 * spawner reaps it. A job keeps it busy but for the seconds between its
 * runs; the window only matters for a session whose job died before its
 * destroy, which holds one of the organization's render slots until then.
 */
const VIDEO_SESSION_IDLE_MS = 3 * 60_000;

/** What a run may say on stdout, and on stderr: what the spawner keeps of
 * each (`SANDBOX_STDOUT_MAX_BYTES`, 5 MiB unless a deployment set another),
 * and what is taken of each here from the stream. A run that wrote more
 * comes back cut, or is listened to no further, and is judged as one
 * stopped at its output cap. */
const SESSION_OUTPUT_CAP_BYTES = 5 * 1024 * 1024;

/** A file of the session's directory by its name. */
function inSession(name: string): string {
  if (!isPlainOutputName(name)) {
    throw new YtDlpError(
      'outputValidationFailed',
      `yt-dlp left a file under a name it was not told to write: ${name.slice(0, 80)}`,
      '',
    );
  }
  return `${SESSION_DIR}/${name}`;
}

/** The most the deployment's cookie jar may weigh to be given to a
 * session: well past a browser's whole jar, and a file of this machine is
 * never read further than that. */
const DEPLOYMENT_COOKIES_MAX_BYTES = 1024 * 1024;

/** The name the deployment's cookie jar has in a session: another than the
 * jar of a pooled browser session (`cookies.txt`), which a video may be
 * given too and then prefers. */
const DEPLOYMENT_COOKIES_NAME = 'deployment-cookies.txt';

/**
 * Give the session a copy of the deployment's own cookie jar
 * (`VIDEO_INGEST_COOKIES_FILE`), and answer where a run finds it. The jar
 * lies on this machine's disk, where a session reads nothing; yt-dlp reads
 * the copy, and writes back to the copy what it writes back to a jar.
 *
 * Answers `null` where the deployment names no jar, and where the jar could
 * not be given: the video is then fetched without it, as it is with a jar
 * whose cookies have expired, and the log says why.
 */
async function stageDeploymentCookies(
  place: YtdlpPlace,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const path = env.VIDEO_INGEST_COOKIES_FILE?.trim();
  if (!path) return null;
  try {
    const file = await open(path, 'r');
    let jar: Buffer;
    try {
      const { size } = await file.stat();
      if (size > DEPLOYMENT_COOKIES_MAX_BYTES) {
        throw new Error(
          `it weighs ${size} bytes, more than the ${DEPLOYMENT_COOKIES_MAX_BYTES} a cookie jar may`,
        );
      }
      jar = Buffer.alloc(size);
      const { bytesRead } = await file.read(jar, 0, size, 0);
      jar = jar.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
    return await place.writeFile(DEPLOYMENT_COOKIES_NAME, jar.toString('utf8'));
  } catch (error) {
    console.warn(
      "[video_link] VIDEO_INGEST_COOKIES_FILE could not be given to the video's sandbox session; the video is fetched without it:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * A fault of the sandbox, or of the way to it, as the failure of the video
 * it happened to: a temporary problem, which the video is tried again for.
 * A spawner that restarts, and a session lost with it, are back within the
 * waits a temporary problem gets.
 *
 * What the spawner's client said goes to the log and stays there. It names
 * addresses of the deployment's own network, and a video's failure is read
 * by the member who pasted the link.
 */
function sessionFault(doing: string, error: unknown): YtDlpError {
  if (error instanceof YtDlpError) return error;
  console.warn(
    `[video_link] the sandbox session failed while ${doing}:`,
    error instanceof Error ? error.message : error,
  );
  return new YtDlpError(
    'transient',
    `the sandbox session failed while ${doing}`,
    '',
  );
}

/**
 * The session `sessionId` as a place for the video of job `jobId`. Whoever
 * opened the session closes it: disposing of this place does nothing.
 * `deploymentCookies` is where the session holds its copy of the
 * deployment's cookie jar, if it was given one.
 */
export function sessionYtdlpPlace(
  sessionId: string,
  jobId: string,
  env: NodeJS.ProcessEnv = process.env,
  deploymentCookies: string | null = null,
): YtdlpPlace {
  // Whether a provider is asked is the deployment's settings alone: the
  // session's image always carries the plugin.
  const provider = potProviderUrl(env, true);
  return {
    dir: SESSION_DIR,
    reach: {
      // A session has no route to a proxy and holds none of its
      // credentials: the platform's relay stands in for it. Where the
      // deployment has no key to sign the relay's token with, there is no
      // proxy to give: never the proxy's own address, which would put its
      // credentials on a command line in the session. A video that must go
      // out through a proxy then does not go out.
      proxyUrl: (proxy) => {
        const relayed = relayProxyUrl(proxy.url, jobId, env);
        if (relayed === null) {
          throw new YtDlpError(
            'jsRuntimeMissing',
            "the video goes out through a proxy, and the backend has no key to sign a sandbox session's token for its relay with (WEBDAV_APP_PASSWORD_HMAC_KEY, which a deployment derives from INSTANCE_SECRET)",
            '',
          );
        }
        return relayed;
      },
      potProviderUrl:
        provider === undefined ? null : relayPotBaseUrl(jobId, env),
      pluginDir: provider === undefined ? null : BAKED_YTDLP_PLUGIN_DIR,
      cookiesFile: deploymentCookies,
    },
    // The image pins its yt-dlp, which accepts every flag of this lane.
    commonFlags: () => Promise.resolve([...BASE_FLAGS]),
    run: async (argv, timeoutMs) => {
      // The run's output as the stream carries it. The run's last word
      // holds it too, but only where the stream was never lost: one that
      // was attached to again ends with none, and a run judged without its
      // stderr is a temporary problem whatever it was.
      const said = { stdout: '', stderr: '' };
      const bytes = { stdout: 0, stderr: 0 };
      let overCap = false;
      const stop = new AbortController();
      const take =
        (stream: 'stdout' | 'stderr') =>
        (text: string): void => {
          if (overCap) return;
          bytes[stream] += Buffer.byteLength(text);
          if (bytes[stream] > SESSION_OUTPUT_CAP_BYTES) {
            // More than a run may say: it is listened to no further. The
            // session goes with the video's failure, and the run with it.
            overCap = true;
            stop.abort();
            return;
          }
          said[stream] += text;
        };
      let result: Awaited<ReturnType<typeof drainSessionExecResilient>>;
      try {
        result = await drainSessionExecResilient(
          sessionId,
          {
            execId: randomUUID(),
            command: ['yt-dlp', ...argv],
            cwd: SESSION_DIR,
            collectOutput: true,
            timeoutMs,
          },
          stop.signal,
          { onStdout: take('stdout'), onStderr: take('stderr') },
        );
      } catch (error) {
        if (overCap) {
          return ytdlpRunOutcome({
            code: null,
            ...said,
            timedOut: false,
            outputCapped: true,
            timeoutMs,
            outputCapBytes: SESSION_OUTPUT_CAP_BYTES,
          });
        }
        throw sessionFault('running yt-dlp', error);
      }
      // A spawner that sends a run's output in its last word alone.
      const streamed = said.stdout !== '' || said.stderr !== '';
      const stdout = streamed
        ? said.stdout
        : Buffer.from(result.stdoutBase64, 'base64').toString('utf8');
      const stderr = streamed
        ? said.stderr
        : Buffer.from(result.stderrBase64, 'base64').toString('utf8');
      // A command the session could not start: its image carries no yt-dlp,
      // which is one from before this lane.
      if (result.exitCode === null && result.errorCode === 'RUNTIME_ERROR') {
        throw new YtDlpError(
          /ENOENT/.test(result.errorMessage ?? '')
            ? 'binaryNotInstalled'
            : 'transient',
          `yt-dlp could not be started in the sandbox session: ${result.errorMessage ?? 'no reason given'}. A sandbox runtime image of this release carries it.`,
          '',
        );
      }
      // A session that was lost under the run, ran out of memory, or was
      // cancelled says nothing about the video.
      if (
        result.errorCode !== undefined &&
        result.errorCode !== 'TIMEOUT' &&
        result.exitCode === null
      ) {
        throw new YtDlpError(
          'transient',
          `the sandbox session ended yt-dlp: ${result.errorCode}${result.errorMessage === undefined ? '' : ` (${result.errorMessage})`}`,
          '',
        );
      }
      return ytdlpRunOutcome({
        code: result.exitCode,
        stdout,
        stderr,
        timedOut: result.errorCode === 'TIMEOUT',
        outputCapped: result.truncated.stdout || result.truncated.stderr,
        timeoutMs,
        outputCapBytes: SESSION_OUTPUT_CAP_BYTES,
      });
    },
    list: async () => {
      let entries: Awaited<ReturnType<typeof sessionListFiles>>;
      try {
        entries = await sessionListFiles(sessionId, SESSION_DIR);
      } catch (error) {
        throw sessionFault('listing what yt-dlp left', error);
      }
      // Every session has the directory: one that answers for none is gone,
      // which says nothing of what yt-dlp left in it.
      if (entries === null) {
        throw new YtDlpError(
          'transient',
          'the sandbox session no longer answers for its directory',
          '',
        );
      }
      return entries
        .filter((entry) => entry.type === 'file')
        .map((entry) => ({ name: entry.name, size: entry.size }));
    },
    readFile: async (name, maxBytes) => {
      const path = inSession(name);
      let file: Awaited<ReturnType<typeof sessionReadFile>>;
      try {
        file = await sessionReadFile(sessionId, path, { maxBytes });
      } catch (error) {
        throw sessionFault(`reading ${name}`, error);
      }
      if (file === null) {
        throw new YtDlpError(
          'outputValidationFailed',
          `the sandbox session no longer holds ${name}, or holds more of it than a caller may`,
          '',
        );
      }
      return new Uint8Array(file.bytes);
    },
    openFile: async (name, maxBytes) => {
      const path = inSession(name);
      let file: Awaited<ReturnType<typeof sessionOpenFile>>;
      try {
        file = await sessionOpenFile(sessionId, path, { maxBytes });
      } catch (error) {
        // A session from before it refused a larger file itself declares
        // the length, and the reader turns it away: the file is more than
        // was measured, which is yt-dlp's own doing.
        if (error instanceof SessionFileTooLargeError) {
          throw new YtDlpError(
            'outputValidationFailed',
            `the sandbox session holds more of ${name} than the ${maxBytes} bytes it may be`,
            '',
          );
        }
        throw sessionFault(`opening ${name}`, error);
      }
      // The file was listed a moment ago: a session that no longer hands it
      // out is one that was lost since, and the video is tried again.
      if (file === null) {
        throw new YtDlpError(
          'transient',
          `the sandbox session no longer hands out ${name}`,
          '',
        );
      }
      return file;
    },
    writeFile: async (name, content) => {
      const path = inSession(name);
      // Staged paths are named from the session's root.
      const staged = path.replace(/^\/agent\//, '');
      let answer: Awaited<ReturnType<typeof sessionStageFiles>>;
      try {
        answer = await sessionStageFiles(sessionId, [
          {
            path: staged,
            contentBase64: Buffer.from(content, 'utf8').toString('base64'),
          },
        ]);
      } catch (error) {
        throw sessionFault(`writing ${name}`, error);
      }
      // A file the session skipped is not there, whatever the call said: a
      // run that is told to read it would go on without it and say nothing.
      if (!answer.staged.some((file) => file.path === staged)) {
        const why = answer.skipped.find((file) => file.path === staged);
        throw new YtDlpError(
          'transient',
          `the sandbox session did not take ${name}${why === undefined ? '' : ` (${why.reason})`}`,
          '',
        );
      }
      return path;
    },
    dispose: () => Promise.resolve(),
  };
}

/**
 * Do `work` in the place a video's yt-dlp runs, opened for it and closed
 * after it: a sandbox session, or a directory of this machine
 * ({@link videoIngestLane}).
 *
 * `runKey` names this run among the job's. A run asks for a session under
 * an id made of both, so a retry, and a job delivered twice, never meet
 * what another run left. A run that comes back from a wait for a session
 * brings the key it waited under: the sandbox host keeps a first-come line
 * of the ids it refused, and a video that asked under a new id each time
 * would stand behind its own earlier asks for as long as it waited.
 *
 * Throws `SandboxLaneCapacityError` when there is no session to be had for
 * now (`throwaway_session.ts`): the organization's render sessions are all
 * in use, or the sandbox host has no room. That is a wait, and no failure
 * of the video.
 */
export async function inYtdlpPlace<T>(
  ctx: ActionCtx,
  video: { organizationId: string; jobId: string; runKey: string },
  work: (place: YtdlpPlace) => Promise<T>,
): Promise<T> {
  if (videoIngestLane() === 'local') {
    const place = await createLocalYtdlpPlace();
    try {
      return await work(place);
    } finally {
      await place.dispose();
    }
  }
  const sessionId = sessionIdForVideo(video.jobId, video.runKey);
  return await withThrowawaySession(
    ctx,
    {
      organizationId: video.organizationId,
      sessionId,
      ownerType: 'video',
      createdBy: 'system:video-links',
      idleTimeoutMs: VIDEO_SESSION_IDLE_MS,
      // A video's sound may weigh more than the 100 MiB one file of a
      // session may be, and a platform that serves it in fragments says no
      // length a download could be refused for.
      maxFileBytes: MEDIA_MAX_BYTES,
      lane: 'video',
      unit: 'job',
    },
    async () =>
      await work(
        sessionYtdlpPlace(
          sessionId,
          video.jobId,
          process.env,
          await stageDeploymentCookies(
            sessionYtdlpPlace(sessionId, video.jobId),
            process.env,
          ),
        ),
      ),
  );
}
