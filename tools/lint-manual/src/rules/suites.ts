/**
 * The suites: the box grammar, the prefix that makes an ID unique, and the two
 * things a suite must never be — ticked, or a place findings live.
 */
import type { Finding, Repo } from '../model';
import { linkTargets } from '../parse';

const PREFIX = /^[A-Z][A-Z0-9]*-?$/;

/** Headings that mean a round's output has leaked into a test. */
const FINDINGS_HEADING = /^(issues found|findings|defects|bugs found)\b/i;

export function suites(repo: Repo): Finding[] {
  const findings: Finding[] = [];

  for (const root of repo.roots) {
    const declared = new Map<string, string>();
    const ids = new Map<string, string>();
    const listed = new Set(
      linkTargets(root.readme?.text ?? '')
        .filter((target) => target.startsWith('suites/'))
        .map((target) => target.slice('suites/'.length)),
    );

    for (const suite of root.suites) {
      if (suite.prefixes.length === 0) {
        findings.push({
          file: suite.path,
          line: 1,
          message:
            'no prefix declared — a suite opens with ' +
            '`> **Prefix** `X-` · **Reset** … · **Cost** …`',
        });
      }
      for (const prefix of suite.prefixes) {
        if (!PREFIX.test(prefix)) {
          findings.push({
            file: suite.path,
            line: suite.prefixLine,
            message: `prefix \`${prefix}\` is not uppercase letters, digits and one optional trailing dash`,
          });
          continue;
        }
        // Two suites MAY share a prefix — one numbering split across files is
        // a real shape (a chain and the standalone tours that continue it), and
        // uniqueness is checked on the IDs themselves. What is never allowed is
        // one prefix being a strict prefix of another, because then a single ID
        // reads as belonging to both.
        for (const [other, ownerName] of declared) {
          if (other === prefix) continue;
          if (other.startsWith(prefix) || prefix.startsWith(other)) {
            findings.push({
              file: suite.path,
              line: suite.prefixLine,
              message: `prefix \`${prefix}\` shadows \`${other}\` (\`${ownerName}\`) — one ID would read as both`,
            });
          }
        }
        declared.set(prefix, suite.name);
      }

      if (!listed.has(suite.name)) {
        findings.push({
          file: root.readme?.path ?? `${root.path}/readme.md`,
          message: `\`suites/${suite.name}\` is not listed in the guide's suites table`,
        });
      }

      for (const heading of suite.headings) {
        if (FINDINGS_HEADING.test(heading)) {
          findings.push({
            file: suite.path,
            message: `\`## ${heading}\` — findings belong in \`runs/\`, never in a suite`,
          });
        }
      }

      for (const bad of suite.malformed) {
        findings.push({
          file: suite.path,
          line: bad.line,
          message:
            'not a box — the grammar is ``- [ ] `ID` · **action** → judgment.``',
        });
      }

      for (const box of suite.boxes) {
        if (box.ticked) {
          findings.push({
            file: suite.path,
            line: box.line,
            message: `\`${box.id}\` is ticked — a suite is never ticked in place; tick the session log`,
          });
        }
        if (!box.body.includes('→')) {
          findings.push({
            file: suite.path,
            line: box.line,
            message: `\`${box.id}\` states no judgment — a box reads **action** → what must be true`,
          });
        }
        if (!box.body.startsWith('**')) {
          findings.push({
            file: suite.path,
            line: box.line,
            message: `\`${box.id}\` states no action — the thing to do is bold, and comes first`,
          });
        }
        if (suite.prefixes.length > 0) {
          const owned = suite.prefixes.some((p) => box.id.startsWith(p));
          if (!owned) {
            findings.push({
              file: suite.path,
              line: box.line,
              message: `\`${box.id}\` does not start with this suite's prefix (${suite.prefixes.map((p) => `\`${p}\``).join(', ')})`,
            });
          }
        }
        const seen = ids.get(box.id);
        if (seen) {
          findings.push({
            file: suite.path,
            line: box.line,
            message: `\`${box.id}\` is already defined in \`${seen}\` — an ID is a stable, unique contract`,
          });
        } else {
          ids.set(box.id, suite.name);
        }
      }
    }

    for (const target of listed) {
      if (!root.suites.some((suite) => suite.name === target)) {
        findings.push({
          file: root.readme?.path ?? `${root.path}/readme.md`,
          message: `the suites table links \`suites/${target}\`, which does not exist`,
        });
      }
    }
  }

  return findings;
}
