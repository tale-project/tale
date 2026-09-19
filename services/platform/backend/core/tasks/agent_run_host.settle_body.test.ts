import { describe, expect, it } from 'vitest';

import { buildSettleComments } from './agent_run_host.ts';
import { TASK_COMMENT_MAX } from './helpers.ts';

/** Reports stay in the ticket's language; runtime notices follow the reader. */
describe('buildSettleComments', () => {
  const fileNames = ['report.md', 'chart.png'];
  const skipped = [
    {
      path: '/agent/output/huge.bin',
      reason: 'read from sandbox failed',
      reasonByLocale: {
        en: 'read from sandbox failed',
        de: 'Die Datei konnte nicht aus der Sandbox gelesen werden.',
        fr: 'Impossible de lire le fichier depuis la sandbox.',
      },
    },
  ];

  it('keeps a German report unchanged and translates the separate runtime notice', () => {
    const comments = buildSettleComments({
      resultText: 'Die Prüfung ist abgeschlossen.',
      fileNames,
      skipped,
    });
    expect(comments.body).toBe('Die Prüfung ist abgeschlossen.');
    expect(comments.noticeByLocale?.en).toContain(
      'Deliverables:\n- report.md\n- chart.png',
    );
    expect(comments.noticeByLocale?.de).toContain(
      'Ergebnisse:\n- report.md\n- chart.png',
    );
    expect(comments.noticeByLocale?.de).toContain(
      'Nicht bereitgestellt:\n- huge.bin — Die Datei konnte nicht aus der Sandbox gelesen werden.',
    );
    expect(comments.noticeByLocale?.fr).toContain(
      'Impossible de lire le fichier depuis la sandbox.',
    );
    expect(comments.noticeByLocale?.de).not.toContain('Deliverables');
    expect(comments.noticeByLocale?.fr).not.toContain(
      'read from sandbox failed',
    );
  });

  it('cuts an overlong canonical report with a neutral ellipsis and explains it in every locale', () => {
    const comments = buildSettleComments({
      resultText: 'x'.repeat(TASK_COMMENT_MAX + 5000),
      fileNames,
      skipped,
    });
    expect(comments.body).toHaveLength(TASK_COMMENT_MAX);
    expect(comments.body).toMatch(/x…$/);
    expect(comments.noticeByLocale?.en).toContain('The report was shortened.');
    expect(comments.noticeByLocale?.de).toContain('Der Bericht wurde gekürzt.');
    expect(comments.noticeByLocale?.fr).toContain(
      'Le compte rendu a été abrégé.',
    );
    expect(comments.noticeByLocale?.de).toContain('huge.bin');
  });

  it('leaves an exactly fitting report alone without adding a notice', () => {
    const resultText = 'y'.repeat(TASK_COMMENT_MAX);
    expect(
      buildSettleComments({ resultText, fileNames: [], skipped: [] }),
    ).toEqual({ body: resultText });
  });

  it('bounds every translated file list independently', () => {
    const comments = buildSettleComments({
      resultText: 'Erledigt.',
      fileNames: Array.from(
        { length: 2000 },
        (_, index) => `file-${index}.txt`,
      ),
      skipped: [],
    });
    expect(comments.body).toBe('Erledigt.');
    for (const text of Object.values(comments.noticeByLocale ?? {}))
      expect(text.length).toBeLessThanOrEqual(TASK_COMMENT_MAX);
    expect(comments.noticeByLocale?.de).toContain(
      'Die Dateiliste wurde gekürzt.',
    );
  });

  it('uses a translated notice when there is no agent report', () => {
    const comments = buildSettleComments({
      resultText: '  ',
      fileNames: [],
      skipped: [],
    });
    expect(comments).not.toHaveProperty('body');
    expect(comments.noticeByLocale?.de).toBe(
      'Der Agent hat den Lauf ohne Bericht beendet.',
    );
    expect(comments.noticeByLocale?.fr).toBe(
      'L’agent a terminé sans compte rendu.',
    );
  });
});
