/**
 * Mode-dispatching assertion + finding formatter.
 *
 * Every check's findings flow through `assertFindings(findings, mode, ctx)`:
 *
 *   - `mode === 'off'`     → no-op.
 *   - `mode === 'enforce'` → vitest `expect(findings).toEqual([])` with a
 *                            formatted failure message.
 *   - `mode === 'report'`  → push to the report sink; the test passes.
 *
 * The formatted message groups findings by file and appends a doctrine
 * pointer when one is supplied.
 */

import { expect } from 'vitest';

import type { Finding } from '../checks/types';
import type { CheckId, CheckMode } from '../config';
import { pushToReportSink } from './report-sink';

interface AssertContext {
  readonly checkId: CheckId;
  readonly label: string;
  readonly doctrine?: string;
}

export function assertFindings(
  findings: ReadonlyArray<Finding>,
  mode: CheckMode,
  context: AssertContext,
): void {
  if (mode === 'off') return;
  if (findings.length === 0) {
    expect(findings).toEqual([]);
    return;
  }
  if (mode === 'enforce') {
    const message = formatBlock(
      context.checkId,
      context.label,
      findings,
      context.doctrine,
    );
    expect(findings, message).toEqual([]);
    return;
  }
  // report
  pushToReportSink(context.checkId, context.label, findings, context.doctrine);
  expect(true).toBe(true);
}

function formatBlock(
  checkId: CheckId,
  label: string,
  findings: ReadonlyArray<Finding>,
  doctrine?: string,
): string {
  const n = findings.length;
  const lines: string[] = [];
  lines.push(`[${checkId}] ${label} — ${n} violation${n === 1 ? '' : 's'}:`);

  const byFile = new Map<string, Finding[]>();
  for (const f of findings) {
    let list = byFile.get(f.file);
    if (!list) {
      list = [];
      byFile.set(f.file, list);
    }
    list.push(f);
  }
  for (const [file, list] of byFile) {
    lines.push(`  ${file}`);
    for (const f of list) {
      const lineOrKey = f.line > 0 ? String(f.line) : (f.key ?? '');
      const suggest = f.suggest ? ` — ${f.suggest}` : '';
      lines.push(`    ${lineOrKey}: [${f.rule}] ${f.detail}${suggest}`);
    }
  }
  if (doctrine) {
    lines.push('');
    lines.push(`doctrine: ${doctrine}`);
  }
  return lines.join('\n');
}
