// Doing something to a page, and saying whether it now waits for a dialog.

import { debugLog } from '../../lib/debug.ts';
import type { Remote } from '../browser/remote.ts';
import { dialogNotice } from './format.ts';

/** How long the page is watched for a dialog while an action is under way (ms). */
const ACTION_TIMEOUT = 60_000;

/** What is ignored on purpose, for whoever asks (`DEBUG=session-manager`). */
const debug = debugLog('mcp');

/**
 * Waits for `work` (something done to the page, already under way), gives the
 * page `settleMs` to react, and says whether it now waits for a dialog to be
 * answered ('' if it does not). A page with a dialog open responds to nothing,
 * so the work itself can hang until the dialog is answered: then it is left to
 * finish on its own, and the dialog is reported at once.
 */
export async function act(
  browser: Remote,
  work: Promise<unknown>,
  settleMs: number,
): Promise<string> {
  const outcome: { done: boolean; failure?: { error: unknown } } = {
    done: false,
  };
  const finished = (async () => {
    try {
      await work;
    } catch (error) {
      outcome.failure = { error };
    }
    outcome.done = true;
  })();
  await Promise.race([finished, browser.waitForDialog(ACTION_TIMEOUT)]);
  if (!outcome.done) {
    void (async () => {
      await finished;
      // Nobody waits for it any more. An error then was the dialog's doing, or
      // the page's.
      if (outcome.failure !== undefined) {
        debug(
          `an action that ended after its tool answered failed: ${String(outcome.failure.error)}`,
        );
      }
    })();
    return dialogNotice(browser.dialogs());
  }
  if (outcome.failure !== undefined) throw outcome.failure.error;
  // The page's reaction; a dialog that it opens ends the wait.
  await browser.waitForDialog(settleMs);
  return dialogNotice(browser.dialogs());
}

/** Types into the field with this element number (its content is replaced), else where the focus is. */
export async function typeInto(
  browser: Remote,
  text: string,
  element: number | null | undefined,
  submit: boolean,
): Promise<void> {
  if (element !== null && element !== undefined) {
    await browser.fillElement(element, text, { submit });
    return;
  }
  await browser.insertText(text);
  if (submit) await browser.key('press', 'Enter');
}
