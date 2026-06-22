/**
 * Advisory layout-composition report (NON-blocking — never a CI gate).
 *
 * Scans the platform feature/route surface for raw layout HTML that the
 * "compose only" rule (see AGENTS.md → "Design system & UI composition" and the
 * `ui-components` skill) says should be a design-system component or a layout
 * primitive instead. It mirrors the source-walk mechanics of
 * `skeleton-conventions.test.ts`, but only PRINTS a report — it asserts nothing
 * — so the sweep's progress is measurable per area without blocking unmigrated
 * code.
 *
 * Run: `bun run report:layout`  (or `bun tools/ui-sweep/report-layout.ts`)
 * Optional arg: a path prefix to scope the scan, e.g.
 *   `bun tools/ui-sweep/report-layout.ts services/platform/app/features/customers`
 *
 * Categories:
 *   layout-div (auto)     raw <div className="…flex/grid…"> — codemod → Stack/Row/Grid
 *   layout-div (manual)   raw <div className={…flex/grid…}> — dynamic class, hand-migrate
 *   <section>             raw landmark — PageSection / SettingsSection / Stack as="section"
 *   <hN>                  raw heading — Heading
 *   <button>              raw button — Button / IconButton
 *   space-y-*             margin-based vertical spacing — Stack (gap)
 *   off-scale gap         gap-7 / gap-[…] / space-[xy]-[…] — use the named gap scale
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const DEFAULT_ROOTS = [
  'services/platform/app/features',
  'services/platform/app/routes',
];

interface Rule {
  key: string;
  label: string;
  manual: boolean;
  regex: RegExp;
}

// Advisory regexes — approximate by design (a report, not a transform).
const RULES: Rule[] = [
  {
    key: 'layoutDivStatic',
    label: 'layout-div (auto)',
    manual: false,
    regex: /<div\b[^>]*\bclassName="[^"]*\b(?:flex|grid)\b/g,
  },
  {
    key: 'layoutDivDynamic',
    label: 'layout-div (manual)',
    manual: true,
    regex: /<div\b[^>]*\bclassName=\{[^>]*\b(?:flex|grid)\b/g,
  },
  { key: 'section', label: '<section>', manual: true, regex: /<section\b/g },
  { key: 'heading', label: '<hN>', manual: true, regex: /<h[1-6]\b/g },
  { key: 'button', label: '<button>', manual: true, regex: /<button\b/g },
  { key: 'spaceY', label: 'space-y-*', manual: false, regex: /\bspace-y-\d/g },
  {
    key: 'offScale',
    label: 'off-scale gap',
    manual: true,
    regex: /\bgap-7\b|\bgap-\[|\bspace-[xy]-\[/g,
  },
];

function listTsxFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      out = out.concat(listTsxFiles(full));
    } else if (
      entry.endsWith('.tsx') &&
      !entry.endsWith('.test.tsx') &&
      !entry.endsWith('.stories.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

function countMatches(source: string, regex: RegExp): number {
  // Exclude `<Button`/`<Section` etc. false hits: our regexes already use
  // lowercase tag names + word boundaries, so `<Button` won't match `<button\b`.
  const matches = source.match(regex);
  return matches ? matches.length : 0;
}

function areaOf(relPath: string): string {
  const parts = relPath.split(sep);
  const fi = parts.indexOf('features');
  if (fi >= 0 && parts[fi + 1]) return `features/${parts[fi + 1]}`;
  if (parts.includes('routes')) return 'routes';
  return 'other';
}

const argRoot = process.argv[2];
const roots = argRoot ? [argRoot] : DEFAULT_ROOTS;

const perFile = new Map<string, Record<string, number>>();
const perArea = new Map<string, Record<string, number>>();
const totals: Record<string, number> = {};
let filesWithViolations = 0;

for (const root of roots) {
  const abs = join(REPO_ROOT, root);
  for (const file of listTsxFiles(abs)) {
    const source = readFileSync(file, 'utf8');
    const counts: Record<string, number> = {};
    let fileTotal = 0;
    for (const rule of RULES) {
      const n = countMatches(source, rule.regex);
      if (n > 0) {
        counts[rule.key] = n;
        totals[rule.key] = (totals[rule.key] ?? 0) + n;
        fileTotal += n;
      }
    }
    if (fileTotal > 0) {
      filesWithViolations += 1;
      const rel = relative(REPO_ROOT, file);
      perFile.set(rel, { ...counts, _total: fileTotal });
      const area = areaOf(rel);
      const a = perArea.get(area) ?? {};
      for (const k of Object.keys(counts)) a[k] = (a[k] ?? 0) + counts[k];
      a._total = (a._total ?? 0) + fileTotal;
      perArea.set(area, a);
    }
  }
}

const grand = Object.values(totals).reduce((s, n) => s + n, 0);
const autoTotal = RULES.filter((r) => !r.manual).reduce(
  (s, r) => s + (totals[r.key] ?? 0),
  0,
);

const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number) => String(n).padStart(6);

console.log('\nUI layout-composition report (advisory — not a gate)\n');
console.log(pad('category', 22), num(0).replace('0', 'count'), ' kind');
console.log('-'.repeat(46));
for (const rule of RULES) {
  console.log(
    pad(rule.label, 22),
    num(totals[rule.key] ?? 0),
    ` ${rule.manual ? 'manual' : 'auto'}`,
  );
}
console.log('-'.repeat(46));
console.log(pad('TOTAL', 22), num(grand));
console.log(
  `\n${grand} raw-layout hits across ${filesWithViolations} files ` +
    `(${autoTotal} codemod-able, ${grand - autoTotal} hand-migrate).\n`,
);

console.log('By area (worst first):');
const areas = [...perArea.entries()].sort(
  (a, b) => (b[1]._total ?? 0) - (a[1]._total ?? 0),
);
for (const [area, c] of areas) {
  console.log(`  ${pad(area, 28)} ${num(c._total ?? 0)}`);
}

console.log('\nTop 20 files:');
const files = [...perFile.entries()].sort(
  (a, b) => (b[1]._total ?? 0) - (a[1]._total ?? 0),
);
for (const [rel, c] of files.slice(0, 20)) {
  console.log(`  ${num(c._total ?? 0)}  ${rel}`);
}
console.log('');
