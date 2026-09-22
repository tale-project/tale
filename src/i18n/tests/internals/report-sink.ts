/**
 * Process-scoped sink for `report`-mode findings.
 *
 * Checks running in `report` mode push their findings here instead of
 * failing the test. The setup file (`report-sink-setup.ts`) drains the
 * sink in an `afterAll` hook and prints a grouped summary to stdout.
 *
 * The sink lives on `globalThis` so multiple vitest projects in the same
 * process share it; the setup file registers `afterAll` per project and
 * prints once at the end of each project's run.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { Finding } from '../checks/types';
import type { CheckId } from '../config';

interface SinkEntry {
  readonly checkId: CheckId;
  readonly label: string;
  readonly findings: ReadonlyArray<Finding>;
  readonly doctrine?: string;
}

interface Sink {
  entries: SinkEntry[];
}

declare global {
  // eslint-disable-next-line no-var
  var __TALE_I18N_REPORT_SINK__: Sink | undefined;
}

function getSink(): Sink {
  let s = globalThis.__TALE_I18N_REPORT_SINK__;
  if (!s) {
    s = { entries: [] };
    globalThis.__TALE_I18N_REPORT_SINK__ = s;
  }
  return s;
}

export function pushToReportSink(
  checkId: CheckId,
  label: string,
  findings: ReadonlyArray<Finding>,
  doctrine?: string,
): void {
  getSink().entries.push({ checkId, label, findings, doctrine });
}

/**
 * Drain the sink and print the grouped summary. Called once at end-of-suite
 * by `report-sink-setup.ts`'s `afterAll` hook. Idempotent — drains and
 * resets so subsequent runs in the same process start clean.
 */
export function drainAndPrintReport(cacheDir?: string): void {
  const sink = getSink();
  if (sink.entries.length === 0) return;

  const lines: string[] = [];
  lines.push('');
  lines.push('i18n report-mode summary');
  lines.push('========================');

  // Group by checkId so multiple sources for one check appear together.
  const byCheck = new Map<CheckId, SinkEntry[]>();
  for (const entry of sink.entries) {
    let list = byCheck.get(entry.checkId);
    if (!list) {
      list = [];
      byCheck.set(entry.checkId, list);
    }
    list.push(entry);
  }

  for (const [checkId, entries] of byCheck) {
    const merged: Finding[] = [];
    for (const e of entries) for (const f of e.findings) merged.push(f);
    const doctrine = entries[0].doctrine;
    const doctrineSuffix = doctrine ? ` [doctrine: ${doctrine}]` : '';
    lines.push(
      `  ${checkId} (${merged.length} finding${merged.length === 1 ? '' : 's'})${doctrineSuffix}`,
    );

    const byFile = groupByFile(merged);
    let shown = 0;
    const LIMIT = 25;
    let truncated = false;
    for (const [file, list] of byFile) {
      if (shown >= LIMIT) {
        truncated = true;
        break;
      }
      lines.push(`    ${file}`);
      for (const f of list) {
        if (shown >= LIMIT) {
          truncated = true;
          break;
        }
        const lineOrKey = f.line > 0 ? String(f.line) : (f.key ?? '');
        const suggest = f.suggest ? ` — ${f.suggest}` : '';
        lines.push(`      ${lineOrKey}: [${f.rule}] ${f.detail}${suggest}`);
        shown++;
      }
    }
    if (truncated) {
      const fullDump = cacheDir
        ? path.join(cacheDir, `${checkId}.txt`)
        : `node_modules/.cache/tale-i18n-report/${checkId}.txt`;
      lines.push(
        `      ... ${merged.length - LIMIT} more — full dump at ${fullDump}`,
      );
      writeFullDump(checkId, merged, cacheDir);
    }
  }

  lines.push('');
  lines.push(
    `(report-mode checks do not fail the build; flip to enforce in modes: { '${[...byCheck.keys()][0]}': 'enforce' })`,
  );
  lines.push('');

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));

  // Reset so a subsequent run in the same process starts clean.
  sink.entries = [];
}

function groupByFile(findings: ReadonlyArray<Finding>): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) {
    let list = out.get(f.file);
    if (!list) {
      list = [];
      out.set(f.file, list);
    }
    list.push(f);
  }
  return out;
}

function writeFullDump(
  checkId: CheckId,
  findings: ReadonlyArray<Finding>,
  cacheDir?: string,
): void {
  const dir =
    cacheDir ??
    path.join(process.cwd(), 'node_modules', '.cache', 'tale-i18n-report');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (const f of findings) {
      const lineOrKey = f.line > 0 ? String(f.line) : (f.key ?? '');
      lines.push(
        `${f.file}:${lineOrKey} [${f.rule}] ${f.detail}${f.suggest ? ' — ' + f.suggest : ''}`,
      );
    }
    fs.writeFileSync(path.join(dir, `${checkId}.txt`), lines.join('\n') + '\n');
  } catch (err) {
    console.warn(
      `tale-i18n: failed to write full report dump for ${checkId}: ${String(err)}`,
    );
  }
}
