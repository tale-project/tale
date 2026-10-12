import type { TaskCommentBodies } from '../../../lib/shared/schemas/task-comment';
import type { HarvestSkippedOutput } from '../node_only/sandbox/session_exec';
import { TASK_COMMENT_MAX } from './helpers';

/**
 * The comments a settled task run posts back to its task: the agent's report
 * in its own language, and the runtime's delivery facts — which files it
 * delivered, which it could not — as a separate system notice in every
 * locale. One builder for both engines: a harness run's files are harvested
 * from its delivery box, a native run's are the ones its tools made, and a
 * native run skips none.
 */

/** Keep the agent report in its own language. Runtime delivery facts are a
 * separate, translated system comment, never English appended to that report. */
export function buildSettleComments(args: {
  resultText: string;
  fileNames: readonly string[];
  skipped: readonly HarvestSkippedOutput[];
}): { body?: string; noticeByLocale?: TaskCommentBodies } {
  const report = args.resultText.trim();
  const reportTruncated = report.length > TASK_COMMENT_MAX;
  const body = reportTruncated
    ? `${report.slice(0, TASK_COMMENT_MAX - 1)}…`
    : report;
  const labels = {
    en: {
      delivered: 'Deliverables:',
      skipped: 'Not delivered:',
      noReport: 'The agent finished without a report.',
      truncated: 'The report was shortened. The full text is on the run.',
      listTruncated:
        'The file list was shortened. The task keeps the full list of delivered files.',
    },
    de: {
      delivered: 'Ergebnisse:',
      skipped: 'Nicht bereitgestellt:',
      noReport: 'Der Agent hat den Lauf ohne Bericht beendet.',
      truncated:
        'Der Bericht wurde gekürzt. Der vollständige Text ist beim Lauf verfügbar.',
      listTruncated:
        'Die Dateiliste wurde gekürzt. Die vollständige Liste der bereitgestellten Dateien bleibt an der Aufgabe erhalten.',
    },
    fr: {
      delivered: 'Livrables :',
      skipped: 'Fichiers non remis :',
      noReport: 'L’agent a terminé sans compte rendu.',
      truncated:
        'Le compte rendu a été abrégé. Le texte intégral reste disponible dans l’exécution.',
      listTruncated:
        'La liste des fichiers a été abrégée. La tâche conserve la liste complète des fichiers remis.',
    },
  };
  const render = (locale: keyof typeof labels): string => {
    const text = labels[locale];
    const parts = [
      ...(report === '' ? [text.noReport] : []),
      ...(reportTruncated ? [text.truncated] : []),
      ...(args.fileNames.length > 0
        ? [
            [text.delivered, ...args.fileNames.map((name) => `- ${name}`)].join(
              '\n',
            ),
          ]
        : []),
      ...(args.skipped.length > 0
        ? [
            [
              text.skipped,
              ...args.skipped.map(
                (skip) =>
                  `- ${skip.path.split('/').at(-1) ?? skip.path} — ${skip.reasonByLocale?.[locale] ?? skip.reason}`,
              ),
            ].join('\n'),
          ]
        : []),
    ];
    const full = parts.join('\n\n');
    if (full.length <= TASK_COMMENT_MAX) return full;
    const tail = `\n\n… ${text.listTruncated}`;
    return `${full.slice(0, TASK_COMMENT_MAX - tail.length)}${tail}`;
  };
  const noticeByLocale = {
    en: render('en'),
    de: render('de'),
    fr: render('fr'),
  };
  return {
    ...(body !== '' ? { body } : {}),
    ...(noticeByLocale.en !== '' ? { noticeByLocale } : {}),
  };
}
