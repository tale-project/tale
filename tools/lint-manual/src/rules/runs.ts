/**
 * The journal: one record per round, named so the directory sorts in round
 * order for good, and listed so the index and the files cannot disagree.
 */
import type { Finding, Repo } from '../model';
import { linkTargets } from '../parse';

/** `r0001.md` — zero-padded to four digits, so `r0010` follows `r0009`. */
const RECORD = /^r\d{4}\.md$/;

/** Everything `runs/` may hold besides the records. */
const FIXTURES = new Set([
  'readme.md',
  'template.md',
  'template-session-log.md',
]);

export function runs(repo: Repo): Finding[] {
  const findings: Finding[] = [];

  for (const root of repo.roots) {
    const records = new Set<string>();
    for (const name of root.runEntries) {
      if (FIXTURES.has(name)) continue;
      if (RECORD.test(name)) {
        records.add(name);
        continue;
      }
      findings.push({
        file: `${root.path}/runs/${name}`,
        message:
          'not a round record — a record is `r<nnnn>.md`, the round number ' +
          'zero-padded to four digits',
      });
    }

    const linked = new Set(
      linkTargets(root.journal?.text ?? '').filter((target) =>
        RECORD.test(target),
      ),
    );
    const journalPath = `${root.path}/runs/readme.md`;
    for (const record of records) {
      if (!linked.has(record)) {
        findings.push({
          file: journalPath,
          message: `\`${record}\` has no row in the rounds table — a round is closed by adding one`,
        });
      }
    }
    for (const target of linked) {
      if (!records.has(target)) {
        findings.push({
          file: journalPath,
          message: `the rounds table links \`${target}\`, which does not exist`,
        });
      }
    }
  }

  return findings;
}
