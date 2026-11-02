// Everything the manager refuses, as the `AppError` the API answers with: the
// status, the stable code the app words its own message from, the English
// sentence (for API clients and for codes the app does not
// know) and the extra fields a client acts on. A few codes name in their extra
// fields what the app words them with, so that the person is told the cause and
// not only that something is wrong (see `ApiErrorBody`): the cause of a proxy
// that does not answer (`reason`), how many proxies failed (`failed`), what a
// busy session is doing (`doing`). The same fields go with a start that fails
// in the background, as the session's `errorExtra`.

import type { MessageParams, SessionRef } from '../../../lib/api/schemas.ts';
import { SESSION_NAME_MAX_LENGTH } from '../../../lib/session-name.ts';
import { AppError } from '../../errors.ts';
import type { ProxyParseError } from '../proxies/parsing.ts';
import { StartError } from './runtime.ts';
import type { SessionState, Status } from './runtime.ts';

// -- not found -------------------------------------------------------------------

export const sessionNotFound = (sessionId: number): AppError =>
  new AppError(
    404,
    'session_not_found',
    `Session ${sessionId} does not exist.`,
  );

export const proxyNotFound = (proxyId: number): AppError =>
  new AppError(404, 'proxy_not_found', `Proxy ${proxyId} does not exist.`);

export const secretNotFound = (secretId: number): AppError =>
  new AppError(404, 'secret_not_found', `Secret ${secretId} does not exist.`);

// -- invalid input -----------------------------------------------------------------

export const invalidKind = (kinds: readonly string[]): AppError =>
  new AppError(
    422,
    'invalid_kind',
    `The kind of secret must be one of: ${kinds.join(', ')}.`,
  );

export const invalidSecret = (message: string): AppError =>
  new AppError(422, 'invalid_secret', message);

export const invalidStartPage = (): AppError =>
  new AppError(
    422,
    'invalid_start_page',
    'The start page must be a web address, for example https://www.google.com.',
  );

export const invalidName = (): AppError =>
  new AppError(
    422,
    'invalid_name',
    `The session name must be 1-${SESSION_NAME_MAX_LENGTH} characters long, without control characters.`,
  );

export const invalidOs = (choices: readonly string[]): AppError =>
  new AppError(
    422,
    'validation_error',
    `os: must be one of ${choices.join(', ')}.`,
  );

/** `reason` is the parse code and `params` its parameters: the app words the reason from them. */
export const invalidProxy = (error: ProxyParseError): AppError =>
  new AppError(422, 'invalid_proxy', `Invalid proxy: ${error.message}.`, {
    reason: error.code,
    params: { ...error.params },
  });

// -- proxies -----------------------------------------------------------------------

export const duplicateProxy = (display: string, existingId: number): AppError =>
  new AppError(409, 'duplicate', `This proxy already exists (${display}).`, {
    existingId,
  });

export const proxyBusy = (holder: SessionRef, proxyDisplay: string): AppError =>
  new AppError(
    409,
    'proxy_busy',
    `Session ${holder.name} is using proxy ${proxyDisplay} right now. Stop the session first.`,
    { session: holder },
  );

export const proxyInUse = (
  holder: SessionRef,
  proxyDisplay: string,
): AppError =>
  new AppError(
    409,
    'proxy_in_use',
    `Session ${holder.name} uses proxy ${proxyDisplay}. ` +
      'If you delete it, the session gets another proxy on its next start.',
    { session: holder },
  );

export const noFreeProxy = (): AppError =>
  new AppError(
    409,
    'no_free_proxy',
    'No free proxy available: every session needs its own proxy. Add proxies to continue.',
  );

/**
 * The start error when no proxy can be assigned; `action` is "start" or
 * "rotate". `failed` is how many proxies failed their check meanwhile: the
 * count is named only when it is more than none (they may all have been taken).
 */
export function noWorkingProxy(failed: number, action: string): StartError {
  if (failed > 0) {
    return new StartError(
      'no_working_proxy',
      `No working proxy available (${failed} failed their check). ` +
        `Add proxies or re-check them, then ${action} again.`,
      { failed },
    );
  }
  return new StartError(
    'no_working_proxy',
    `No free proxy available: every session needs its own proxy. Add proxies, then ${action} again.`,
  );
}

/** The start error when the place of the proxy's exit IP is not known; `reason` is the lookup's own words. */
export const unknownIpLocation = (reason: string): StartError =>
  new StartError(
    'unknown_ip_location',
    `Cannot match timezone and location to the proxy: ${reason}.`,
    { reason },
  );

const ROTATE_ADVICE = 'Use “Rotate IP” to give the session another proxy.';

/**
 * A proxy that does not answer. `cause` is the proxy check's own words (e.g.
 * "the proxy rejected the credentials (HTTP 407)"): the extra `reason` has it
 * alone, with no sentence around it, for the app to word the error in the
 * person's language. The check keeps the proxy's credentials out of its words
 * (`exit-ip.ts`), and the proxy is named by its id, not by its address.
 */
const proxyUnreachableExtra = (
  cause: string,
  proxyId: number,
): MessageParams => ({
  proxyId,
  reason: cause,
});

export const proxyUnreachableAtStart = (
  sessionName: string,
  proxyDisplay: string,
  cause: string,
  proxyId: number,
): AppError =>
  new AppError(
    502,
    'proxy_unreachable',
    `The proxy of session ${sessionName} (${proxyDisplay}) is not working: ${cause}. ${ROTATE_ADVICE}`,
    proxyUnreachableExtra(cause, proxyId),
  );

export const proxyUnreachable = (
  sessionName: string,
  cause: string,
  proxyId: number,
): AppError =>
  new AppError(
    502,
    'proxy_unreachable',
    `The proxy of session ${sessionName} is not working: ${cause}.`,
    proxyUnreachableExtra(cause, proxyId),
  );

/**
 * What the session itself shows (its error, its code and the details) after a
 * start was refused for `proxyUnreachableAtStart`: the same cause, the same
 * details.
 */
export const proxyUnreachableSessionError = (
  cause: string,
  proxyId: number,
): { code: string; message: string; extra: MessageParams } => ({
  code: 'proxy_unreachable',
  message: `Its proxy is not working: ${cause}. ${ROTATE_ADVICE}`,
  extra: proxyUnreachableExtra(cause, proxyId),
});

export const ipInUse = (
  exitIp: string,
  sessions: readonly SessionRef[],
): AppError =>
  new AppError(
    409,
    'ip_in_use',
    `Exit IP ${exitIp} is already used by running session(s) ${sessions
      .map((session) => session.name)
      .join(', ')}.`,
    { exitIp, sessions },
  );

export const nothingToExport = (): AppError =>
  new AppError(
    409,
    'nothing_to_export',
    'No session has a proxy yet, so there is nothing to export.',
  );

// -- sessions ----------------------------------------------------------------------

export const nameTaken = (name: string): AppError =>
  new AppError(409, 'name_taken', `A session named “${name}” already exists.`);

export const sessionRunning = (name: string, status: Status): AppError =>
  new AppError(409, 'session_running', `Session ${name} is already ${status}.`);

export const sessionNotRunning = (
  name: string,
  options: { startFirst: boolean },
): AppError =>
  new AppError(
    409,
    'session_not_running',
    `Session ${name} is not running.${options.startFirst ? ' Start it first.' : ''}`,
  );

export const noProxy = (name: string): AppError =>
  new AppError(409, 'no_proxy', `Session ${name} has no proxy.`);

/** What a busy session can be doing that the app knows of, and how the English sentence says it. */
const DOING = {
  assigning_proxy: 'getting a proxy',
  starting: 'starting',
  stopping: 'stopping',
} as const;

function doingOf(state: SessionState): keyof typeof DOING | null {
  if (state.activity === 'assigning_proxy') return 'assigning_proxy';
  if (state.status === 'starting') return 'starting';
  if (state.status === 'stopping') return 'stopping';
  return null;
}

/**
 * The session is working, so it cannot be asked for more. The extra `doing`
 * is the short code of what it is doing, for the app to say; it is missing
 * when the session is busy with anything else.
 */
export const sessionBusy = (name: string, state: SessionState): AppError => {
  const doing = doingOf(state);
  return new AppError(
    409,
    'session_busy',
    `Session ${name} is ${doing === null ? 'busy' : DOING[doing]}. Try again in a moment.`,
    doing === null ? {} : { doing },
  );
};

// -- the browser -------------------------------------------------------------------

export const browserInstalling = (): AppError =>
  new AppError(
    503,
    'browser_installing',
    'The Camoufox browser is still being installed. Try again in a moment.',
  );

export const browserNotInstalled = (): AppError =>
  new AppError(
    503,
    'browser_not_installed',
    'The Camoufox browser is not installed. Restart Session Manager to try again, or install it by hand with `camoufox-js fetch` (about 1.3 GB).',
  );

export const fingerprintExhausted = (message: string): AppError =>
  new AppError(409, 'fingerprint_exhausted', message);
