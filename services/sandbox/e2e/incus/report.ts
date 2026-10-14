// What a suite measured: kept as JSON next to the logs, and written to the job
// summary as a table, so a run says how long the things an operator waits for
// took (a cold create, a claim from the warm pool, a resume) and not only
// whether they worked.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Timing {
  name: string;
  ms: number;
  note: string;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 120_000) return `${(ms / 1_000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes} min ${Math.round((ms - minutes * 60_000) / 1_000)} s`;
}

function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export class Report {
  private readonly timings: Timing[] = [];
  private readonly facts: [string, string][] = [];

  constructor(
    readonly suite: string,
    private readonly dir: string,
    private readonly summaryFile: string | undefined = process.env
      .GITHUB_STEP_SUMMARY,
  ) {}

  add(name: string, ms: number, note = ''): void {
    this.timings.push({ name, ms, note });
  }

  /** A fact the run learned (a version, a kernel feature, a count). */
  fact(name: string, value: string): void {
    this.facts.push([name, value]);
  }

  /** Run `fn`, record how long it took; the note may read its result. */
  async time<T>(
    name: string,
    fn: () => Promise<T>,
    note?: (result: T) => string,
  ): Promise<T> {
    const started = performance.now();
    const result = await fn();
    this.add(name, performance.now() - started, note?.(result) ?? '');
    return result;
  }

  get entries(): readonly Timing[] {
    return this.timings;
  }

  markdown(): string {
    const lines = [`### ${this.suite}`, ''];
    if (this.facts.length > 0) {
      for (const [name, value] of this.facts) {
        lines.push(`- ${cell(name)}: ${cell(value)}`);
      }
      lines.push('');
    }
    if (this.timings.length > 0) {
      lines.push('| Step | Time | Note |', '| --- | ---: | --- |');
      for (const timing of this.timings) {
        lines.push(
          `| ${cell(timing.name)} | ${formatDuration(timing.ms)} | ${cell(timing.note)} |`,
        );
      }
      lines.push('');
    }
    return `${lines.join('\n')}\n`;
  }

  /** Write the JSON file and append the table to the job summary. */
  flush(): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, `${this.suite}.json`),
      `${JSON.stringify({ suite: this.suite, facts: this.facts, timings: this.timings }, null, 2)}\n`,
    );
    // Into the log as well as the job summary: the log is what a failed run
    // leaves to read.
    console.log(this.markdown());
    if (this.summaryFile !== undefined && this.summaryFile !== '') {
      appendFileSync(this.summaryFile, this.markdown());
    }
  }
}
