// Camoufox, as camoufox-js installs it, can stop taking the mouse for good, in
// every tab of a browser: its Juggler (the protocol Playwright drives Firefox
// with, JavaScript in the build's `omni.ja`) waits without end for answers that
// do not always come. Before a browser starts, the app changes those waits in
// the installed build so that they end.
//
// Juggler does the mouse events, turns of the wheel and tab switches of a
// browser one after the other, for all its tabs, and a mouse event's turn ends
// when the page's renderer says that it has the event. Some events are never
// answered: one at the very edge of the page (`pointerPlace` keeps the pointer
// off those rows), and one sent while the tab moves to another process, which
// Firefox does when a tab opens or leaves a site it keeps in a process of its
// own (a new tab whose start page is Google, a link from Google to another
// site). Camoufox 152.0.4-beta.30 waits for that answer until the page closes,
// and every later event of the browser waits behind it. Later builds give up
// after a few seconds, but camoufox-js runs none of them yet.
//
// What changes, in `PageHandler.js` and `TargetRegistry.js`:
// - The renderer's answer to a mouse event, and the compositor's before a mouse
//   event or a turn of the wheel, are waited for ANSWER_WAIT_MS at most. An
//   event that is not answered in time is given up on: if it reached the page
//   it still arrives there, late, else the page never sees it; either way the
//   next one goes. Every answer that never comes is a moment in which the
//   mouse does nothing, so the wait is short (the later builds wait 5 s). A page
//   whose scripts keep it busy for longer as a drag starts says that it started
//   one only after the event was given up on: the next mouse event learns it,
//   but a release that comes right after does not drop what is dragged.
// - A switch of tabs, and a whole turn (an event with everything it waits for,
//   the steps of a drag included), are each waited for TURN_WAIT_MS at most.
//
// Firefox keeps compiled copies of these scripts in each profile
// (`startupCache/`) and runs those instead of the files: before a browser
// starts, its profile's copies are deleted unless they were made from the
// `omni.ja` it starts with (`clearStaleScripts`). A build whose files are not
// the ones these changes were written for is left as it is, with a warning: its
// mouse can still stop, and the live view then says so (`input_stuck`, see
// `playwright-remote.ts`).

import { randomUUID } from 'node:crypto';
import {
  copyFile,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import AdmZip from 'adm-zip';

/** How long the renderer's answer to a mouse event (and a compositor flush) is waited for. */
export const ANSWER_WAIT_MS = 1000;
/** How long a switch of tabs, and a whole turn of input, are waited for. */
export const TURN_WAIT_MS = 30_000;

/** The first line of what the change adds to a file: a file that has it is changed already. */
export const MARKER = '// session-manager: bounded input waits';

/** Waits for a promise, or for `ms`, whichever comes first (JavaScript of the build). */
export const WITHIN = `${MARKER} (services/session-manager/backend/domains/browser/juggler.ts)
const {setTimeout: smSetTimeout, clearTimeout: smClearTimeout} = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
function smWithin(promise, ms, what) {
  let timer;
  const late = new Promise(resolve => {
    timer = smSetTimeout(() => {
      dump('[juggler] gave up waiting for ' + what + ' after ' + ms + ' ms\\n');
      resolve(undefined);
    }, ms);
  });
  return Promise.race([promise, late]).finally(() => smClearTimeout(timer));
}
`;

/** One change to a file: `find` must be in it `times` times (once if not said), each one is changed. */
export interface Edit {
  readonly find: string;
  readonly replace: string;
  readonly times?: number;
}

const PAGE_HANDLER = 'chrome/juggler/content/protocol/PageHandler.js';
const TARGET_REGISTRY = 'chrome/juggler/content/TargetRegistry.js';
const HELPER = 'const helper = new Helper();\n';

/** The changes, by file in `omni.ja`. */
export const EDITS: Readonly<Record<string, readonly Edit[]>> = {
  [PAGE_HANDLER]: [
    { find: HELPER, replace: HELPER + WITHIN },
    {
      // The renderer's answer to a mouse event (juggler-mouse-event-hit-renderer).
      find: '        return watcher.ensureEvent(eventType, eventObject => eventObject.jugglerEventId === jugglerEventId);',
      replace: `        return smWithin(watcher.ensureEvent(eventType, eventObject => eventObject.jugglerEventId === jugglerEventId), ${ANSWER_WAIT_MS}, 'the answer to a ' + eventType);`,
    },
    {
      // The compositor, before a mouse event and before a turn of the wheel.
      find: "        await helper.awaitTopic('apz-repaints-flushed');",
      replace: `        await smWithin(helper.awaitTopic('apz-repaints-flushed'), ${ANSWER_WAIT_MS}, 'apz-repaints-flushed');`,
      times: 2,
    },
  ],
  [TARGET_REGISTRY]: [
    { find: HELPER, replace: HELPER + WITHIN },
    {
      // The switch to the tab whose turn it is, in `activateAndRun`.
      find: '        tabBrowser.selectedTab = this._tab;\n        await promise;',
      replace: `        tabBrowser.selectedTab = this._tab;\n        await smWithin(promise, ${TURN_WAIT_MS}, 'the switch to a tab');`,
    },
    {
      // A whole turn of input, in `activateAndRun`.
      find: '        await callback();',
      replace: `        await smWithin(callback(), ${TURN_WAIT_MS}, 'a turn of input');`,
    },
  ],
};

/**
 * What a later build has in `PageHandler.js` once it bounds these waits itself
 * (its deadline for an answer): such a build needs no change.
 */
const BOUNDED_UPSTREAM = 'kAckDeadlineMs';

/** What `boundInputWaits` did. */
export type InputWaits =
  /** The build was changed now. */
  | 'changed'
  /** The build was changed before, or bounds the waits itself. */
  | 'bounded'
  /** The files are not the ones the changes were written for: left as they are. */
  | 'unknown'
  /** There is no `omni.ja` there (the browser is not installed). */
  | 'missing';

/**
 * The text of a file with the changes made, or null when `find` of one is not
 * in it the number of times it must be.
 */
export function applyEdits(
  text: string,
  edits: readonly Edit[],
): string | null {
  let result = text;
  for (const edit of edits) {
    const parts = result.split(edit.find);
    if (parts.length - 1 !== (edit.times ?? 1)) return null;
    result = parts.join(edit.replace);
  }
  return result;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

/**
 * Writes a file as a new one put in its place: a browser that read the old
 * one goes on reading it, and a crash leaves one or the other, never half of
 * each. The new one has a name of its own every time (two apps that share the
 * install may change it at once).
 */
async function replaceFile(
  target: string,
  write: (temporary: string) => Promise<void>,
): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await write(temporary);
    await rename(temporary, target);
  } catch (error) {
    // A full disk, say: no half-written copy is left to fill it further.
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Makes the waits of the build's Juggler end (see the top of this file), in
 * the `omni.ja` at that path. The file as it came is kept next to it as
 * `omni.ja.orig`. Run it while no browser of the build is open.
 */
export async function boundInputWaits(omniJa: string): Promise<InputWaits> {
  let data: Buffer;
  try {
    data = await readFile(omniJa);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return 'missing';
    throw error;
  }
  // `noSort`: the entries stay in the order Mozilla packed them in.
  const zip = new AdmZip(data, { noSort: true });
  const files: {
    entry: AdmZip.IZipEntry;
    text: string;
    edits: readonly Edit[];
  }[] = [];
  for (const [name, edits] of Object.entries(EDITS)) {
    const entry = zip.getEntry(name);
    if (entry === null) return 'unknown';
    files.push({ entry, text: entry.getData().toString('utf8'), edits });
  }
  if (files.some(({ text }) => text.includes(BOUNDED_UPSTREAM))) {
    return 'bounded';
  }
  const marked = files.filter(({ text }) => text.includes(MARKER)).length;
  if (marked === files.length) return 'bounded';
  // One file changed and the other not: no build the changes know.
  if (marked > 0) return 'unknown';

  for (const { entry, text, edits } of files) {
    const edited = applyEdits(text, edits);
    if (edited === null) return 'unknown';
    const method = entry.header.method;
    zip.updateFile(entry, Buffer.from(edited, 'utf8'));
    // Stored as it was (Firefox reads both; Mozilla stores these uncompressed).
    entry.header.method = method;
  }
  const { mode } = await stat(omniJa);
  const original = `${omniJa}.orig`;
  if (!(await exists(original))) {
    await replaceFile(original, (temporary) => copyFile(omniJa, temporary));
  }
  await replaceFile(omniJa, (temporary) =>
    writeFile(temporary, zip.toBuffer(), { mode }),
  );
  return 'changed';
}

/** In each profile: the `omni.ja` its compiled copies of the scripts were made from. */
export const SCRIPTS_NOTE = 'session-manager-scripts.json';

/**
 * Before a browser starts: deletes the compiled copies of the build's scripts
 * that its profile keeps (`startupCache/`, which Firefox makes again) unless
 * they were made from the `omni.ja` it starts with, and notes that one in the
 * profile. Without it a profile made before the build was changed (one that
 * comes back from a backup, say) would run the old scripts for good.
 */
export async function clearStaleScripts(options: {
  omniJa: string;
  profileDir: string;
}): Promise<void> {
  const { size, mtimeMs } = await stat(options.omniJa);
  const note = JSON.stringify({
    omniJa: options.omniJa,
    size,
    modified: mtimeMs,
  });
  const file = join(options.profileDir, SCRIPTS_NOTE);
  let noted: string | null = null;
  try {
    noted = await readFile(file, 'utf8');
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  if (noted === note) return;
  await rm(join(options.profileDir, 'startupCache'), {
    recursive: true,
    force: true,
  });
  await writeFile(file, note);
}
