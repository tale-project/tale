import type { TaskCommentBodies } from './schemas/task-comment';

/**
 * Runaway-output backstop for one agent run, NOT a working budget: the most
 * files a run delivers to its task, whichever engine ran it. It sat at 16 and
 * a real run's legitimate delivery reached 18 files — the cap silently dropped
 * the two that listed last and every run then read as "produced nothing". Over
 * the cap the files are reported as not delivered; consumers surface them,
 * never drop them silently.
 */
export const MAX_RUN_OUTPUT_FILES = 64;

/** Why a file past the cap was not delivered, in every locale a task comment
 * is written in. */
export function overFileCapReasons(): TaskCommentBodies {
  return {
    en: `over the ${MAX_RUN_OUTPUT_FILES}-file per-run harvest cap`,
    de: `Die Grenze von ${MAX_RUN_OUTPUT_FILES} Dateien pro Lauf ist erreicht.`,
    fr: `La limite de ${MAX_RUN_OUTPUT_FILES} fichiers par exécution est atteinte.`,
  };
}
