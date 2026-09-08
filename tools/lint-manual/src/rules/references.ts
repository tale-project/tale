/**
 * The registers: every box a register cites must exist, and every `BL-n` a
 * suite or a register cites must be on the debt list. A pin keyed to a deleted
 * box, or a quirk that names debt nobody recorded, is how a round ends up
 * hunting for something that was never there.
 *
 * `runs/` is deliberately exempt — a record is history and is never rewritten,
 * so it may cite a box a later change deleted.
 */
import type { Doc, Finding, Repo } from '../model';
import { backtickedTokens } from '../parse';

/** Registers whose citations must resolve, beside the guide itself. */
const CITING = new Set(['automation.md', 'pins.md']);

/**
 * What a box ID looks like, independent of any prefix: uppercase and dashes,
 * then at least one digit, then dotted groups, then the optional trailing
 * letter an appended box carries. It is the digit that keeps `POST` and
 * `PATCH` out when a suite declares the prefix `P`.
 */
const BOX_SHAPE = /^[A-Z][A-Z0-9-]*[0-9][0-9.]*[a-z]?$/;

/** `BL-3` — a known-debt entry, not a box. */
const DEBT = /^BL-\d+$/;

/** The lines that DEFINE debt: a table row whose first cell is the ID. */
function definedDebt(doc: Doc | undefined): Set<string> {
  const defined = new Set<string>();
  for (const line of doc?.text.split('\n') ?? []) {
    const row = /^\|\s*`(BL-\d+)`\s*\|/.exec(line);
    if (row) defined.add(row[1]);
  }
  return defined;
}

/**
 * A citation resolves to a box, or to the GROUP a box belongs to: a guide says
 * "run `P4`" or "`AI-C`" to mean a whole tour, and the boxes inside it are
 * `P4.1`, `AI-C1`. A group is therefore any prefix of a real ID whose next
 * character continues the numbering.
 */
function resolves(token: string, ids: Set<string>): boolean {
  if (ids.has(token)) return true;
  for (const id of ids) {
    if (!id.startsWith(token) || id.length === token.length) continue;
    const next = id[token.length];
    if (next === '.' || (next >= '0' && next <= '9')) return true;
  }
  return false;
}

export function references(repo: Repo): Finding[] {
  const findings: Finding[] = [];

  for (const root of repo.roots) {
    const ids = new Set(
      root.suites.flatMap((suite) => suite.boxes.map((box) => box.id)),
    );
    const prefixes = root.suites.flatMap((suite) => suite.prefixes);
    const isBox = (token: string): boolean =>
      BOX_SHAPE.test(token) &&
      !DEBT.test(token) &&
      prefixes.some((prefix) => token.startsWith(prefix) && token !== prefix);

    const citing = [
      ...(root.readme ? [root.readme] : []),
      ...root.reference.filter((doc) => CITING.has(doc.name)),
    ];
    for (const doc of citing) {
      for (const token of backtickedTokens(doc.text)) {
        if (!isBox(token) || resolves(token, ids)) continue;
        findings.push({
          file: doc.path,
          message: `cites \`${token}\`, which no suite defines`,
        });
      }
    }

    const register = root.reference.find(
      (doc) => doc.name === 'not-a-finding.md',
    );
    const debt = definedDebt(register);
    const everywhere: Doc[] = [
      ...citing,
      ...root.reference,
      ...root.suites.map((suite) => ({
        name: suite.name,
        path: suite.path,
        text: suite.boxes.map((box) => box.body).join('\n'),
      })),
    ];
    for (const doc of everywhere) {
      for (const token of backtickedTokens(doc.text)) {
        if (!DEBT.test(token) || debt.has(token)) continue;
        findings.push({
          file: doc.path,
          message: `cites \`${token}\`, which the debt register does not define`,
        });
      }
    }
  }

  return findings;
}
