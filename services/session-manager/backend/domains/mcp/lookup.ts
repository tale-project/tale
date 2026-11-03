// Which session a tool means, and its browser.

import { casefold } from '../../lib/casefold.ts';
import { webUrl } from '../../lib/web-url.ts';
import type { Remote } from '../browser/remote.ts';
import type { Manager } from '../sessions/manager.ts';
import { ToolError } from './tool.ts';

/** A session whose browser the assistant used lately keeps its dialogs waiting for it (ms). */
export const ATTENDED_FOR = 300_000;

/**
 * The id of the session a name ("0001", any case) or an id names. A JSON number
 * is an id, always: a session that is named "1" is not the one it means. A text
 * is a name first, and an id (when it is all digits) only if no session has
 * it for a name.
 */
export function sessionIdOf(manager: Manager, ref: string | number): number {
  const sessions = manager.listSessions();
  if (typeof ref === 'number') {
    if (sessions.some((session) => session.id === ref)) return ref;
  } else {
    const text = ref.trim();
    const wanted = casefold(text);
    const named = sessions.find((session) => casefold(session.name) === wanted);
    if (named !== undefined) return named.id;
    if (/^[0-9]+$/.test(text)) {
      const id = Number(text);
      if (sessions.some((session) => session.id === id)) return id;
    }
  }
  const names =
    sessions.map((session) => session.name).join(', ') || 'none yet';
  throw new ToolError(
    `There is no session “${ref}”. The sessions are: ${names}.`,
  );
}

/** The browser of a running session. Working in it keeps dialogs waiting for an answer. */
export function remoteOf(manager: Manager, ref: string | number): Remote {
  const remote = manager.remote(sessionIdOf(manager, ref));
  remote.attend(ATTENDED_FOR);
  return remote;
}

/** A web address a tool was given, or a refusal that says what an address looks like. */
export function webAddress(url: string): string {
  const address = webUrl(url);
  if (address === null) {
    throw new ToolError(
      `“${url}” is not a web address. Use one like https://example.com.`,
    );
  }
  return address;
}
