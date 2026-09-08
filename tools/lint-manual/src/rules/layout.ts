/**
 * The tree itself: every manual root carries the same files in the same
 * places, so a reader who knows one repo knows all of them and a round never
 * has to ask where the registers are.
 */
import type { Finding, Repo } from '../model';

/** Directly under the manual root. */
const ROOT_FILES = ['readme.md', 'setup.md', 'template.md'];
const ROOT_DIRS = ['reference', 'runs', 'suites'];
/** An authoring aid or chauffeur script is welcome; nothing else is. */
const ROOT_OPTIONAL = ['scripts'];

/** The registers a round consults — each one has a distinct job. */
const REFERENCE_FILES = [
  'automation.md',
  'error-codes.md',
  'not-a-finding.md',
  'pins.md',
];

/** The journal, and the two things a round copies. */
const RUN_FILES = ['readme.md', 'template.md', 'template-session-log.md'];

export function layout(repo: Repo): Finding[] {
  const findings: Finding[] = [];
  for (const root of repo.roots) {
    const expected = new Set([...ROOT_FILES, ...ROOT_DIRS, ...ROOT_OPTIONAL]);

    for (const name of [...ROOT_FILES, ...ROOT_DIRS]) {
      if (!root.entries.includes(name)) {
        findings.push({
          file: root.path,
          message: `missing \`${name}\` — every manual root carries it`,
        });
      }
    }
    for (const name of root.entries) {
      if (!expected.has(name)) {
        findings.push({
          file: `${root.path}/${name}`,
          message:
            'unexpected entry at the manual root — a suite belongs in ' +
            '`suites/`, a register in `reference/`, a round in `runs/`, and an ' +
            'authoring aid in `scripts/`',
        });
      }
    }
    if (root.entries.includes('suites') && root.suites.length === 0) {
      findings.push({
        file: `${root.path}/suites`,
        message: 'no suite — a manual layer with no test is a directory',
      });
    }
    for (const name of REFERENCE_FILES) {
      if (!root.referenceEntries.includes(name)) {
        findings.push({
          file: `${root.path}/reference/${name}`,
          message: 'missing register — a round consults all four',
        });
      }
    }
    for (const name of RUN_FILES) {
      if (!root.runEntries.includes(name)) {
        findings.push({
          file: `${root.path}/runs/${name}`,
          message: 'missing — the journal and the two templates a round copies',
        });
      }
    }
  }
  return findings;
}
