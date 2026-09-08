import { describe, expect, test } from 'bun:test';

import { runs } from '../../src/rules/runs';
import { doc, repo, root } from '../factories';

const ROOT = 'services/app/tests/manual';
const journal = (...records: string[]) =>
  doc(
    'readme.md',
    `# The round journal\n\n${records
      .map(
        (r, i) =>
          `| [R${i + 1}](${r}) | 2026-01-0${i + 1} | scope | 0 | clean exit |`,
      )
      .join('\n')}\n`,
    `${ROOT}/runs`,
  );

describe('runs', () => {
  test('a journal with no rounds yet is clean', () => {
    expect(runs(repo())).toEqual([]);
  });

  test('a record and its row agree', () => {
    expect(
      runs(
        repo(
          root({
            runEntries: [
              'readme.md',
              'template-session-log.md',
              'template.md',
              'r0001.md',
            ],
            journal: journal('r0001.md'),
          }),
        ),
      ),
    ).toEqual([]);
  });

  test('rejects an unpadded record name', () => {
    const findings = runs(
      repo(
        root({
          runEntries: [
            'readme.md',
            'template-session-log.md',
            'template.md',
            'r1.md',
          ],
        }),
      ),
    );
    expect(findings[0].message).toContain('zero-padded to four digits');
  });

  test('a record with no row is an unclosed round', () => {
    const findings = runs(
      repo(
        root({
          runEntries: [
            'readme.md',
            'template-session-log.md',
            'template.md',
            'r0002.md',
          ],
          journal: journal(),
        }),
      ),
    );
    expect(findings[0].message).toBe(
      '`r0002.md` has no row in the rounds table — a round is closed by adding one',
    );
  });

  test('a row with no record is a dead link', () => {
    const findings = runs(
      repo(
        root({
          runEntries: ['readme.md', 'template-session-log.md', 'template.md'],
          journal: journal('r0003.md'),
        }),
      ),
    );
    expect(findings[0].message).toBe(
      'the rounds table links `r0003.md`, which does not exist',
    );
  });
});
