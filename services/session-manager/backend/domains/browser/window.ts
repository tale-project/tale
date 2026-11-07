// The windows of the session browsers on the screen of this computer: bringing
// one to the front, and how much room the screen has for them.
//
// On macOS both go through AppKit, from a JavaScript for Automation script that
// `osascript` runs (no Apple Event, so no permission prompt): activating the
// browser by its process id raises its windows above the app in front, which
// Playwright's `bringToFront` does not (it only selects the tab). Elsewhere the
// tab is selected and the window manager decides.

import { execFile, execFileSync } from 'node:child_process';

/** How long `osascript` may take before the answer is given up on. */
const OSASCRIPT_TIMEOUT_MS = 5000;

/** `NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps`. */
const ACTIVATE_ALL_WINDOWS = 3;

/** The script that brings the app of a process to the front. */
export function activateScript(pid: number): string {
  return `ObjC.import('AppKit'); const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); app.isNil() ? false : app.activateWithOptions(${ACTIVATE_ALL_WINDOWS})`;
}

/**
 * The script that tells the room for windows on the largest screen (its frame
 * without the menu bar and the Dock), as `WIDTHxHEIGHT` in points.
 */
export const SCREEN_SCRIPT = `ObjC.import('AppKit'); const screens = $.NSScreen.screens; let best = [0, 0]; for (let i = 0; i < screens.count; i++) { const size = screens.objectAtIndex(i).visibleFrame.size; if (size.width * size.height > best[0] * best[1]) best = [Math.floor(size.width), Math.floor(size.height)]; } best[0] + 'x' + best[1]`;

/**
 * Brings the windows of the browser with this process id to the front of the
 * screen. True when the system took the request; false where it cannot be
 * asked (not macOS) or did not answer.
 */
export function activateWindow(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (platform !== 'darwin' || !Number.isInteger(pid) || pid <= 0) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', activateScript(pid)],
      { timeout: OSASCRIPT_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          console.warn(
            `could not bring the browser ${pid} to the front: ${error.message}`,
          );
          resolve(false);
          return;
        }
        resolve(stdout.trim() === 'true');
      },
    );
  });
}

/**
 * The room for windows on the largest screen attached, in points (`[width,
 * height]`: a window that size fits under the menu bar and above the Dock), or
 * null where it cannot be asked (not macOS) or the answer is not a size.
 */
export function largestDisplay(
  platform: NodeJS.Platform = process.platform,
  run: (script: string) => string = runScript,
): [number, number] | null {
  if (platform !== 'darwin') return null;
  let answer: string;
  try {
    answer = run(SCREEN_SCRIPT);
  } catch (error) {
    console.warn('could not tell the size of the screen', error);
    return null;
  }
  const match = /^(\d{1,5})x(\d{1,5})$/u.exec(answer.trim());
  const width = Math.floor(Number(match?.[1]));
  const height = Math.floor(Number(match?.[2]));
  return match && width > 0 && height > 0 ? [width, height] : null;
}

function runScript(script: string): string {
  return execFileSync('osascript', ['-l', 'JavaScript', '-e', script], {
    timeout: OSASCRIPT_TIMEOUT_MS,
    encoding: 'utf8',
  });
}
