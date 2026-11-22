/**
 * The budget's verdict and the report people read.
 *
 * Four expectations, each held against the figure that decides it:
 *
 * 1. the reading is whole: every service of the deployment was read, every
 *    container that ran was read, from a cgroup of its own, the container
 *    list kept being read, and no gap between two instants was long enough
 *    for a peak to pass unseen;
 * 2. the reference workload ran to its end: a deployment that did not do the
 *    work holds less memory than one that did, so a part that failed or
 *    never finished fails the run;
 * 3. the deployment's peak stays within the budget;
 * 4. a blue/green overlap stays within one app-tier share.
 *
 * Each expectation is held, missed, inconclusive or not tested, and the run
 * is judged on all four: it fails (exit 1) when one missed, and is
 * inconclusive (exit 2) when none missed but one could not be judged, and
 * passes (exit 0) otherwise. A reading that is not whole is a lower bound:
 * a container it missed can only add to an instant's sum, and to the
 * smaller colour of an overlap. So a peak above the budget, or an overlap
 * above its bound, fails the run even when the reading is not whole, and a
 * peak within them on such a reading proves nothing. An overlap is tested
 * only when two colours of the app tier were read at one instant: a run
 * without one says "not tested", never that the bound held, and a run that
 * was asked to flip (`--flip-command`) and saw no overlap, or saw its flip
 * fail within the bound, is inconclusive.
 *
 * The shares are informative: each part's peak is read against its share
 * and reported, and decides nothing.
 */

import {
  COUNTED_FIELDS,
  MEMORY_BUDGET_BYTES,
  MIB,
  OVERLAP_BOUND_BYTES,
  PAGE_CACHE_FIELD,
  SHARES,
  shareBytes,
} from './limits.ts';
import type { Instant, SamplingFigures } from './sampler.ts';
import type { WorkloadFigures, WorkloadPart } from './workload.ts';

/** A gap between two instants longer than this may hide a peak. */
const MAX_SAMPLING_GAP_MS = 1_000;

/**
 * The container list read no more often than this leaves a container that
 * started meanwhile unread for longer than a reading may miss: five listing
 * intervals of the default second.
 */
const MAX_LISTING_GAP_MS = 5_000;

/** What the run was asked to do, and on what. */
export interface BudgetSettings {
  target: string;
  /** The deployment's Compose project (its `tale.json` id). */
  project: string;
  /** The services the deployment must show for the reading to be whole. */
  services: readonly string[];
  organizationId: string;
  settleSeconds: number;
  tailSeconds: number;
  deadlineSeconds: number;
  host: {
    arch: string;
    cpus: number;
    totalMemoryBytes: number;
    kernel: string;
  };
}

/** The deployment before the workload began. */
export interface RestFigures {
  instants: number;
  peakCountedBytes: number;
  meanCountedBytes: number;
}

/** The blue/green flip the run provoked after the workload, while it read. */
export interface FlipFigures {
  /** The command, as given. */
  command: string;
  /** On the sampler's clock. */
  startedAtMs: number;
  endedAtMs: number;
  /** Its exit code; null when a signal ended it. */
  exitCode: number | null;
  signal: string | null;
  /** It ran past its deadline and was stopped. */
  timedOut: boolean;
  /** Its last lines of output. */
  tail: string[];
}

export interface BudgetObservation {
  settings: BudgetSettings;
  /** The sampler's figures, without its series (written as CSV beside). */
  sampling: Omit<SamplingFigures, 'series'>;
  /** The instants before the workload began; null when there were none. */
  rest: RestFigures | null;
  workload: WorkloadFigures;
  /** The flip, when the run was asked for one; null otherwise. */
  flip: FlipFigures | null;
}

/** The deployment's reading at rest: every instant before `untilMs`. */
export function restFigures(
  series: SamplingFigures['series'],
  untilMs: number,
): RestFigures | null {
  const before = series.filter((point) => point.atMs < untilMs);
  if (before.length === 0) return null;
  let peak = 0;
  let sum = 0;
  for (const point of before) {
    peak = Math.max(peak, point.counted);
    sum += point.counted;
  }
  return {
    instants: before.length,
    peakCountedBytes: peak,
    meanCountedBytes: Math.round(sum / before.length),
  };
}

/**
 * - `held`: the figure meets the expectation;
 * - `missed`: it does not, and nothing the reading missed could change that;
 * - `inconclusive`: the figure cannot say either way;
 * - `not tested`: nothing in the run exercised it, and nothing asked to.
 */
export type CheckOutcome = 'held' | 'missed' | 'inconclusive' | 'not tested';

export interface Check {
  key: 'reading' | 'workload' | 'budget' | 'overlap';
  expectation: string;
  figure: string;
  outcome: CheckOutcome;
  /** Whether the run may pass on it: held, or not tested. */
  pass: boolean;
  details: string[];
}

export interface ShareVerdict {
  key: string;
  label: string;
  shareBytes: number;
  peakCountedBytes: number;
  peakAtMs: number | null;
  /** Whether the part stayed within its share. */
  within: boolean;
}

export type BudgetVerdict = 'pass' | 'fail' | 'inconclusive';

export interface BudgetReport extends BudgetObservation {
  version: 1;
  limitBytes: number;
  overlapBoundBytes: number;
  counted: readonly string[];
  pageCache: string;
  shares: ShareVerdict[];
  /** The parts of the workload running at the deployment's peak. */
  runningAtPeak: string[];
  checks: Check[];
  verdict: BudgetVerdict;
  /** The verdict is `pass`. */
  pass: boolean;
  /** The verdict is not `inconclusive`. */
  conclusive: boolean;
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function mib(bytes: number): string {
  return `${(bytes / MIB).toFixed(1)} MiB`;
}

function bytesText(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} byte${bytes === 1 ? '' : 's'}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function check(
  key: Check['key'],
  expectation: string,
  figure: string,
  outcome: CheckOutcome,
  details: string[],
): Check {
  return {
    key,
    expectation,
    figure,
    outcome,
    pass: outcome === 'held' || outcome === 'not tested',
    details,
  };
}

function readingCheck(observation: BudgetObservation): Check {
  const { sampling, settings } = observation;
  const details: string[] = [];
  const read = sampling.containers.filter((c) => c.samples > 0);
  for (const service of settings.services) {
    if (!read.some((c) => c.service === service)) {
      details.push(
        `no container of ${service} was read: the deployment is not the one the budget covers, or it was down`,
      );
    }
  }
  for (const container of sampling.containers) {
    if (container.samples > 0) continue;
    details.push(
      `${container.name} ran and was never read: ${container.unresolved ?? container.firstReadError ?? 'gone before the first instant'}`,
    );
  }
  for (const container of sampling.containers) {
    if (container.readErrors === 0 || container.samples === 0) continue;
    details.push(
      `${container.name}: ${container.readErrors} reads failed (${container.firstReadError ?? 'no reason'})`,
    );
  }
  for (const conflict of sampling.cgroupConflicts) {
    details.push(`one cgroup for two containers: ${conflict}`);
  }
  if (sampling.maxGapMs > MAX_SAMPLING_GAP_MS) {
    details.push(
      `${sampling.lateInstants} instants came late; the longest gap was ${Math.round(sampling.maxGapMs)} ms, longer than ${MAX_SAMPLING_GAP_MS} ms: a peak may have passed unseen`,
    );
  }
  if (sampling.maxListingGapMs === null) {
    details.push('the container list was never read');
  } else if (sampling.maxListingGapMs > MAX_LISTING_GAP_MS) {
    details.push(
      `the container list went ${seconds(sampling.maxListingGapMs)} without a listing (${sampling.listingErrors} of ${sampling.listings + sampling.listingErrors} failed${sampling.firstListingError === null ? '' : `, the first: ${sampling.firstListingError}`}), longer than ${seconds(MAX_LISTING_GAP_MS)}: a container that started meanwhile went unread`,
    );
  }
  if (sampling.peak === null) {
    details.push('no instant read any container');
  }
  return check(
    'reading',
    `Every container of the deployment is read every ${sampling.intervalMs} ms`,
    `${read.length} containers over ${sampling.instants} instants in ${seconds(sampling.durationMs)}; longest gap ${Math.round(sampling.maxGapMs)} ms`,
    details.length === 0 ? 'held' : 'inconclusive',
    details,
  );
}

function partFigure(part: WorkloadPart): string {
  return `${part.label}: ${part.completed}/${part.expected}`;
}

function workloadCheck(workload: WorkloadFigures): Check {
  const details: string[] = [];
  for (const part of workload.parts) {
    if (part.outcome === 'completed') continue;
    details.push(
      `${part.label}: ${part.outcome}, ${part.completed} of ${part.expected}`,
    );
    details.push(...part.details.map((line) => `  ${line}`));
  }
  if (workload.timedOut) {
    details.push(
      `the workload's deadline passed after ${seconds(workload.durationMs)}`,
    );
  }
  return check(
    'workload',
    'The reference workload runs to its end',
    workload.parts.map(partFigure).join('; '),
    details.length === 0 ? 'held' : 'missed',
    details,
  );
}

function budgetCheck(
  sampling: BudgetObservation['sampling'],
  whole: boolean,
): Check {
  const expectation = `The deployment stays within ${bytesText(MEMORY_BUDGET_BYTES)} (${mb(MEMORY_BUDGET_BYTES)}, ${mib(MEMORY_BUDGET_BYTES)})`;
  const peak = sampling.peak;
  if (peak === null) {
    return check('budget', expectation, 'never read', 'inconclusive', [
      'no reading to hold against the budget',
    ]);
  }
  const over = peak.counted - MEMORY_BUDGET_BYTES;
  const figure = `peak ${bytesText(peak.counted)} (${mb(peak.counted)}, ${mib(peak.counted)}) at +${seconds(peak.atMs)}`;
  if (over > 0) {
    return check('budget', expectation, figure, 'missed', [
      `${bytesText(over)} over the budget at +${seconds(peak.atMs)}${whole ? '' : ', on a reading that is not whole: what it missed can only add to it'}:`,
      ...peak.parts
        .toSorted((a, b) => b.counted - a.counted)
        .map((part) => `  ${part.name}: ${bytesText(part.counted)}`),
    ]);
  }
  return whole
    ? check('budget', expectation, figure, 'held', [])
    : check('budget', expectation, figure, 'inconclusive', [
        'within the budget on a reading that is not whole: what it missed may have taken it over',
      ]);
}

function flipLine(flip: FlipFigures): string {
  const ended = flip.timedOut
    ? 'was stopped at its deadline'
    : flip.exitCode === null
      ? `was ended by ${flip.signal ?? 'a signal'}`
      : `exited ${flip.exitCode}`;
  return `the flip (\`${flip.command}\`) ran from +${seconds(flip.startedAtMs)} to +${seconds(flip.endedAtMs)} and ${ended}`;
}

function flipFailed(flip: FlipFigures): boolean {
  return flip.timedOut || flip.exitCode !== 0;
}

function overlapCheck(
  sampling: BudgetObservation['sampling'],
  flip: FlipFigures | null,
  whole: boolean,
): Check {
  const { overlap } = sampling;
  const expectation = `A blue/green overlap adds at most one app-tier share (${mib(OVERLAP_BOUND_BYTES)})`;
  const flipDetails =
    flip === null
      ? []
      : [flipLine(flip), ...flip.tail.map((line) => `  ${line}`)];
  if (overlap.instants === 0) {
    if (flip === null) {
      return check('overlap', expectation, 'no overlap', 'not tested', [
        'no blue/green flip ran while the deployment was read (`--flip-command` runs one): the bound was not exercised',
      ]);
    }
    return check('overlap', expectation, 'no overlap', 'inconclusive', [
      `no instant read two colours of the app tier at once: the flip asked for never overlapped, so the bound was not exercised`,
      ...flipDetails,
    ]);
  }
  const figure = `peak ${bytesText(overlap.peak)} (${mib(overlap.peak)}) over ${overlap.instants} instants`;
  if (overlap.peak > OVERLAP_BOUND_BYTES) {
    return check('overlap', expectation, figure, 'missed', [
      `the second colour held ${bytesText(overlap.peak)} at +${seconds(overlap.peakAtMs ?? 0)}, ${bytesText(overlap.peak - OVERLAP_BOUND_BYTES)} over one app-tier share`,
      ...flipDetails,
    ]);
  }
  if (!whole) {
    return check('overlap', expectation, figure, 'inconclusive', [
      'within the bound on a reading that is not whole: what it missed may have taken it over',
      ...flipDetails,
    ]);
  }
  if (flip !== null && flipFailed(flip)) {
    return check('overlap', expectation, figure, 'inconclusive', [
      'within the bound, but the flip did not finish: a completed flip may overlap further',
      ...flipDetails,
    ]);
  }
  return check('overlap', expectation, figure, 'held', flipDetails);
}

function shareVerdicts(
  sampling: BudgetObservation['sampling'],
): ShareVerdict[] {
  return SHARES.map((share) => {
    const figures = sampling.shares.find((s) => s.key === share.key);
    const peak = figures?.peakCounted ?? 0;
    return {
      key: share.key,
      label: share.label,
      shareBytes: shareBytes(share),
      peakCountedBytes: peak,
      peakAtMs: figures?.peakAtMs ?? null,
      within: peak <= shareBytes(share),
    };
  });
}

function runningAt(
  workload: WorkloadFigures,
  flip: FlipFigures | null,
  instant: Instant | null,
): string[] {
  if (instant === null) return [];
  const running = workload.parts
    .filter(
      (part) =>
        part.startedAtMs !== null &&
        part.startedAtMs <= instant.atMs &&
        (part.endedAtMs === null || part.endedAtMs >= instant.atMs),
    )
    .map((part) => part.label);
  if (
    flip !== null &&
    flip.startedAtMs <= instant.atMs &&
    flip.endedAtMs >= instant.atMs
  ) {
    running.push('the blue/green flip');
  }
  return running;
}

/** The run's verdict from its checks: a miss fails it, else an
 * inconclusive check leaves it inconclusive. */
function verdictOf(checks: readonly Check[]): BudgetVerdict {
  if (checks.some((c) => c.outcome === 'missed')) return 'fail';
  if (checks.some((c) => c.outcome === 'inconclusive')) return 'inconclusive';
  return 'pass';
}

/** Hold every expectation against its figure. */
export function judgeBudget(observation: BudgetObservation): BudgetReport {
  const reading = readingCheck(observation);
  const whole = reading.outcome === 'held';
  const checks = [
    reading,
    workloadCheck(observation.workload),
    budgetCheck(observation.sampling, whole),
    overlapCheck(observation.sampling, observation.flip, whole),
  ];
  const verdict = verdictOf(checks);
  return {
    version: 1,
    ...observation,
    limitBytes: MEMORY_BUDGET_BYTES,
    overlapBoundBytes: OVERLAP_BOUND_BYTES,
    counted: COUNTED_FIELDS,
    pageCache: PAGE_CACHE_FIELD,
    shares: shareVerdicts(observation.sampling),
    runningAtPeak: runningAt(
      observation.workload,
      observation.flip,
      observation.sampling.peak,
    ),
    checks,
    verdict,
    pass: verdict === 'pass',
    conclusive: verdict !== 'inconclusive',
  };
}

/** 0 within the budget, 1 when an expectation missed, 2 when inconclusive. */
export function budgetExitCode(report: BudgetReport): 0 | 1 | 2 {
  if (report.verdict === 'fail') return 1;
  return report.verdict === 'inconclusive' ? 2 : 0;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function at(ms: number | null): string {
  return ms === null ? '–' : `+${seconds(ms)}`;
}

const VERDICT_WORDS: Record<BudgetVerdict, string> = {
  pass: 'WITHIN THE BUDGET',
  fail: 'FAILED',
  inconclusive: 'INCONCLUSIVE',
};

const OUTCOME_WORDS: Record<CheckOutcome, string> = {
  held: 'held',
  missed: '**missed**',
  inconclusive: '**inconclusive**',
  'not tested': 'not tested',
};

/** The report for people: the verdict, the peak, each part and each container. */
export function renderBudgetMarkdown(report: BudgetReport): string {
  const lines: string[] = [];
  const peak = report.sampling.peak;
  lines.push(
    `# Memory budget (${report.settings.host.arch}): ${peak === null ? 'no reading' : `peak ${peak.counted.toLocaleString('en-US')}`} of ${bytesText(report.limitBytes)} — ${VERDICT_WORDS[report.verdict]}`,
  );
  lines.push('');
  lines.push('| expectation | figure | result |');
  lines.push('| --- | --- | --- |');
  for (const c of report.checks) {
    lines.push(
      `| ${cell(c.expectation)} | ${cell(c.figure)} | ${OUTCOME_WORDS[c.outcome]} |`,
    );
  }
  for (const c of report.checks) {
    if (c.details.length === 0) continue;
    lines.push('');
    lines.push(`## ${c.expectation}`);
    lines.push('');
    lines.push('```');
    lines.push(...c.details);
    lines.push('```');
  }

  lines.push('');
  lines.push('## The reading');
  lines.push('');
  lines.push(
    `Each container's cgroup v2 \`memory.stat\`, every ${report.sampling.intervalMs} ms: ${report.counted.map((f) => `\`${f}\``).join(' + ')} counted; the page cache (\`${report.pageCache}\`, which includes \`shmem\`) reported. The deployment's reading at an instant is the sum over its containers then; the result is the peak of that sum.`,
  );
  if (peak !== null) {
    lines.push('');
    lines.push(
      `The deployment peaked at **${bytesText(peak.counted)}** (${mb(peak.counted)}, ${mib(peak.counted)}) at +${seconds(peak.atMs)}, with ${mib(peak.file)} of page cache beside it${peak.overlap > 0 ? ` and a blue/green overlap of ${mib(peak.overlap)} left out` : ''}. Running then: ${report.runningAtPeak.length === 0 ? 'nothing of the workload' : report.runningAtPeak.join(', ')}.`,
    );
    lines.push('');
    lines.push('| container at the peak | counted | page cache |');
    lines.push('| --- | ---: | ---: |');
    for (const part of peak.parts.toSorted((a, b) => b.counted - a.counted)) {
      lines.push(
        `| ${cell(part.name)} | ${mib(part.counted)} | ${mib(part.file)} |`,
      );
    }
  }

  if (report.rest !== null) {
    lines.push('');
    lines.push(
      `At rest before the workload: ${mib(report.rest.meanCountedBytes)} on average, ${mib(report.rest.peakCountedBytes)} at most, over ${report.rest.instants} instants.`,
    );
  }

  lines.push('');
  lines.push('## Shares (informative)');
  lines.push('');
  lines.push('| part | share | peak | at | used |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const share of report.shares) {
    const used = share.peakCountedBytes / share.shareBytes;
    lines.push(
      `| ${share.label} | ${mib(share.shareBytes)} | ${mib(share.peakCountedBytes)} | ${at(share.peakAtMs)} | ${(used * 100).toFixed(0)} %${share.within ? '' : ' (over)'} |`,
    );
  }
  if (report.sampling.unshared.peakAtMs !== null) {
    lines.push(
      `| outside every share | – | ${mib(report.sampling.unshared.peakCounted)} | ${at(report.sampling.unshared.peakAtMs)} | – |`,
    );
  }

  lines.push('');
  lines.push('## Containers');
  lines.push('');
  lines.push(
    '| container | service | share | peak counted | at | page cache then | peak page cache | read | seen |',
  );
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const c of report.sampling.containers) {
    lines.push(
      `| ${cell(c.name)} | ${c.service}${c.colour === null ? '' : ` (${c.colour})`} | ${c.share ?? '–'} | ${mib(c.peakCounted)} | ${at(c.peakCountedAtMs)} | ${mib(c.fileAtPeak)} | ${mib(c.peakFile)} | ${c.samples} | ${at(c.firstSeenMs)}–${c.goneMs === null ? 'end' : at(c.goneMs)} |`,
    );
  }

  lines.push('');
  lines.push('## Workload');
  lines.push('');
  lines.push('| part | done | outcome | started | ended |');
  lines.push('| --- | ---: | --- | ---: | ---: |');
  for (const part of report.workload.parts) {
    lines.push(
      `| ${cell(part.label)} | ${part.completed}/${part.expected} | ${part.outcome} | ${at(part.startedAtMs)} | ${at(part.endedAtMs)} |`,
    );
  }
  if (report.flip !== null) {
    lines.push(
      `| the blue/green flip | – | ${flipFailed(report.flip) ? 'failed' : 'completed'} | ${at(report.flip.startedAtMs)} | ${at(report.flip.endedAtMs)} |`,
    );
  }
  const facts = report.workload.facts;
  if (facts.length > 0) {
    lines.push('');
    for (const fact of facts) lines.push(`- ${fact}`);
  }

  lines.push('');
  lines.push('## HTTP errors during the workload');
  lines.push('');
  if (report.workload.httpErrors.length === 0) {
    lines.push('None: every request and stream was answered as expected.');
  } else {
    lines.push('| request or stream | kind | count | the latest |');
    lines.push('| --- | --- | ---: | --- |');
    for (const row of report.workload.httpErrors) {
      lines.push(
        `| ${cell(row.name)} | ${cell(row.kind)} | ${row.count} | ${cell(row.sample ?? '–')} |`,
      );
    }
  }

  lines.push('');
  lines.push('## Run');
  lines.push('');
  const { settings, sampling } = report;
  lines.push(
    `- Host: ${settings.host.arch}, ${settings.host.cpus} CPUs, ${(settings.host.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB, kernel ${settings.host.kernel}; Docker ${sampling.engine?.serverVersion ?? 'unknown'}, cgroup v${sampling.engine?.cgroupVersion ?? '?'} (${sampling.engine?.cgroupDriver ?? 'unknown'} driver)`,
  );
  lines.push(
    `- Deployment \`${settings.project}\` at ${settings.target}; organization \`${settings.organizationId}\``,
  );
  lines.push(
    `- ${sampling.startedAt}: ${seconds(settings.settleSeconds * 1000)} at rest, the workload, ${report.flip === null ? '' : 'the flip, '}${seconds(settings.tailSeconds * 1000)} after it; ${sampling.instants} instants, ${sampling.lateInstants} late, ${sampling.listings} listings${sampling.listingErrors === 0 ? '' : `, ${sampling.listingErrors} failed (${sampling.firstListingError ?? ''})`}${sampling.maxListingGapMs === null ? '' : `, the longest without one ${seconds(sampling.maxListingGapMs)}`}`,
  );
  lines.push('');
  return lines.join('\n');
}

/** The series as CSV: the deployment, then each container, in bytes. */
export function renderSeriesCsv(figures: SamplingFigures): string {
  const names = figures.containers.map((c) => c.name);
  const rows = [
    ['at_ms', 'counted', 'page_cache', 'overlap', ...names].join(','),
  ];
  for (const point of figures.series) {
    rows.push(
      [
        Math.round(point.atMs),
        point.counted,
        point.file,
        point.overlap,
        ...names.map((_, index) => point.byContainer.get(index) ?? ''),
      ].join(','),
    );
  }
  return `${rows.join('\n')}\n`;
}
