/**
 * Dev-orchestrator output: the classifiers + child-capture, layered on the
 * shared `@tale/shared/tux` (the SAME reporter `tale dev` uses, so both
 * commands render identically).
 *
 * `pipeChild` swaps child `stdio:'inherit'` for capture, with two modes:
 *   - `silent` (discrete steps: docker up, migrations, gates) —
 *     capture into a ring and surface NOTHING; a failing step dumps its tail.
 *     This is the robust default: success is clean by construction, so benign
 *     noise (e.g. docker's orphan-container warning) can never leak.
 *   - `stream` (the persistent servers: backend, vite) — surface the
 *     meaningful lines (`info`/`warn`/`error`) as tagged reporter lines and drop
 *     the rest (layer pulls, HMR churn, "Watching for file changes...").
 *
 * Children stay node `ChildProcess`es with piped stdio, so the orchestrator's
 * `tree-kill` shutdown + the backend restart state machine are untouched.
 */

import type { ChildProcess } from 'node:child_process';

import {
  type Classifier,
  chain,
  classifyBuildKit,
  classifyBackend,
  classifyDockerCompose,
  classifyVite,
  createStreamClassifier,
} from '@tale/shared/classify';
import { pipeNodeStream } from '@tale/shared/process';
import { stripAnsi } from '@tale/shared/terminal';
import { sourceLine } from '@tale/shared/tux';

// Re-export the shared reporter UI so the orchestrator pulls its output from one
// place (and `tale dev` imports the identical functions).
export {
  detailLines,
  doneLine,
  errorLine,
  infoLine,
  questionLine,
  rule,
  runStep,
  StepWarning,
  warnLine,
} from '@tale/shared/tux';

/** Discrete steps (docker + the backend) mix compose, BuildKit and backend
 * shapes. */
export const devStepClassifier: Classifier = chain(
  classifyBuildKit,
  classifyDockerCompose,
  classifyBackend,
);

export const dockerClassifier: Classifier = chain(
  classifyBuildKit,
  classifyDockerCompose,
);
export const backendClassifier: Classifier = classifyBackend;
export const viteClassifier: Classifier = classifyVite;

export type PipeMode = 'silent' | 'errors';

export interface PipeChildHandle {
  /** Recent raw lines (the failure dump fallback). */
  tail(n?: number): string[];
  /** Cleaned text of the warn/error lines seen (the real signal for a dump). */
  signal(): string[];
}

export interface PipeChildOptions {
  /** Source tag on surfaced lines, e.g. `docker` / `backend` / `vite`. */
  label: string;
  classifier?: Classifier;
  /**
   * `silent` (default): ring only. `errors`: also surface warn/error live (for
   * the persistent servers) — info milestones stay collapsed, since they
   * duplicate the step completion + the READY view.
   */
  mode?: PipeMode;
  /**
   * Treat anything the child writes to STDERR as at least a warning, even when
   * the classifier could not name it.
   *
   * For a plain Node server the stream IS the severity: `console.warn` and
   * `console.error` go to stderr, `console.log`/`console.info` to stdout. The
   * regexes cannot see that, so `classifyBackend` surfaced a backend warning
   * only if its prose happened to carry `ERROR` or `WARN` — which none of the
   * backend's ~430 `console.warn` calls do. They were dropped as noise: a
   * stale-toolchain notice, a burned-session report, a re-queued job, all
   * invisible in `bun dev`.
   *
   * OPT-IN, because it is only true of children that separate the streams that
   * way. Docker and BuildKit write their entire progress feed to stderr; this
   * flag on those would surface every layer pull.
   */
  stderrIsSignal?: boolean;
  ringSize?: number;
}

/**
 * Attach classifiers to a child's piped stdout/stderr. The child MUST have been
 * spawned with `stdio: ['ignore'|'inherit', 'pipe', 'pipe']`.
 */
export function pipeChild(
  // Only the two streams are read — narrower than `ChildProcess` so a test can
  // hand it a pair of `PassThrough`s without an unsafe assertion.
  child: Pick<ChildProcess, 'stdout' | 'stderr'>,
  opts: PipeChildOptions,
): PipeChildHandle {
  const classify = createStreamClassifier(opts.classifier ?? devStepClassifier);
  const mode = opts.mode ?? 'silent';
  const cap = opts.ringSize ?? 200;
  const ring: string[] = [];
  const signalLines: string[] = [];

  const handle = (raw: string, stream: 'stdout' | 'stderr'): void => {
    let line = classify(raw);
    ring.push(line.raw);
    if (ring.length > cap) ring.shift();

    // The classifier reads prose; the stream carries severity the prose does
    // not. A line the classifier could not name, on a stderr the caller has
    // vouched for, is a warning — shown as the child printed it.
    if (
      opts.stderrIsSignal === true &&
      stream === 'stderr' &&
      (line.kind === 'noise' || line.kind === 'progress')
    ) {
      const text = stripAnsi(line.raw).trimEnd();
      if (text.trim() !== '') line = { ...line, kind: 'warn', text };
    }

    if ((line.kind === 'error' || line.kind === 'warn') && line.text) {
      signalLines.push(line.text);
      if (signalLines.length > cap) signalLines.shift();
    }

    if (mode === 'silent' || !line.text) return;
    if (line.kind === 'error') sourceLine(opts.label, 'error', line.text);
    else if (line.kind === 'warn') sourceLine(opts.label, 'warn', line.text);
    // info/progress/noise: collapsed — milestones duplicate the READY view.
  };

  if (child.stdout) {
    void pipeNodeStream(child.stdout, (raw) => handle(raw, 'stdout'));
  }
  if (child.stderr) {
    void pipeNodeStream(child.stderr, (raw) => handle(raw, 'stderr'));
  }

  return {
    tail: (n = cap) => ring.slice(-n),
    signal: () => signalLines.slice(),
  };
}
