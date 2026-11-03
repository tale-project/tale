import type { Page } from '@playwright/test';

/** The questions the browser itself put to the person ("Discard unsaved changes?"). */
export interface NativeQuestions {
  /** The text of each question asked so far, in order. */
  asked: string[];
  /** The answer to the questions that follow: `true` is "OK", `false` "Cancel". */
  answer(yes: boolean): void;
}

/**
 * Answers the native `confirm` of the page, which a dialog puts to the person
 * before it throws their work away. Left alone, Playwright answers "Cancel" to
 * every one, so a spec that expects the dialog to close must say "yes", and
 * one that wants to know whether it was asked reads `asked`. Call it before
 * the page can ask.
 */
export function answerNativeQuestions(
  page: Page,
  yes = false,
): NativeQuestions {
  const asked: string[] = [];
  let accept = yes;
  page.on('dialog', (question) => {
    asked.push(question.message());
    void (accept ? question.accept() : question.dismiss());
  });
  return {
    asked,
    answer: (next) => {
      accept = next;
    },
  };
}
