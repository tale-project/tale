/**
 * In-memory automation store — the StoreAdapter for tests and the selftest.
 * Versions are immutable and monotonically numbered per name; `deploy` marks
 * the one version triggers would run. Async interface over sync internals so
 * consumers exercise the exact contract a database-backed store serves.
 *
 * It is also the reference HOST for the management half of the dispatch table:
 * `startRun` executes the deployed version inline and records the run, so
 * `get_run`/`list_runs`/`cancel_run` have something real to read and the
 * selftest proves the round trip without a database. Run ids are deterministic
 * (`run_1`, `run_2`, …) so a test can assert on them.
 */

import type {
  RunDetail,
  RunSummary,
  TriggerSpec,
  TriggerView,
  VersionSummary,
} from '../api/dispatch';
import { execute } from '../core/execute';
import { cloneData } from '../core/execute/scope';
import type { StoreAdapter } from '../core/slots';
import type { Automation, RunResult } from '../core/types';

/** The trigger kinds a host accepts. `api-key` is deliberately absent: a
 * programmatic call is what the API itself is for, so the kind carried no
 * behavior and is refused at the write path. */
const TRIGGER_KINDS = ['schedule', 'webhook', 'event'] as const;

interface StoredVersion {
  automation: Automation;
  message?: string;
  createdAt: number;
}

export interface MemoryStore extends StoreAdapter {
  save(
    name: string,
    automation: Automation,
    message?: string,
  ): { version: number };
  deploy(name: string, version: number): void;
  listVersions(name: string): Promise<VersionSummary[]>;
  setTrigger(name: string, trigger: TriggerSpec): Promise<void>;
  listTriggers(name?: string): Promise<TriggerView[]>;
  deleteTrigger(name: string): Promise<void>;
  startRun(
    name: string,
    input: unknown,
    mode: 'mock' | 'live',
    version?: number,
  ): Promise<{ runId: string; version: number } | null>;
  listRuns(options: { name?: string; limit?: number }): Promise<RunSummary[]>;
  getRun(runId: string): Promise<RunDetail | null>;
  cancelRun(runId: string): Promise<{ cancelled: boolean }>;
  recordRun(
    name: string,
    version: number,
    result: RunResult,
    mode: 'mock' | 'live',
  ): Promise<void>;
}

/** Who a run started as, when nothing more specific is known. */
const MEMORY_ACTOR = 'memory-store';

export function memoryStore(): MemoryStore {
  const versions = new Map<string, StoredVersion[]>();
  const deployed = new Map<string, number>();
  const triggers = new Map<string, TriggerView>();
  const runs: RunDetail[] = [];
  let runSeq = 0;

  const record = (run: RunDetail): void => {
    runs.push(run);
  };

  return {
    save(name, automation, message) {
      const list = versions.get(name) ?? [];
      list.push({
        automation: cloneData(automation),
        ...(message !== undefined && message !== '' && { message }),
        createdAt: Date.now(),
      });
      versions.set(name, list);
      return { version: list.length };
    },
    deploy(name, version) {
      const list = versions.get(name);
      if (!list || version < 1 || version > list.length) {
        throw new Error(`cannot deploy unknown version ${name}@${version}`);
      }
      deployed.set(name, version);
    },
    async list() {
      return [...versions.entries()].map(([name, list]) => ({
        name,
        latest: list.length,
      }));
    },
    async get(name, version) {
      const list = versions.get(name);
      if (!list || list.length === 0) return null;
      const v = version ?? list.length;
      const entry = list[v - 1];
      if (!entry) return null;
      return { meta: { version: v }, automation: cloneData(entry.automation) };
    },
    async deployedVersion(name) {
      return deployed.get(name) ?? null;
    },

    async listVersions(name) {
      const summaries: VersionSummary[] = [];
      let version = 0;
      for (const entry of versions.get(name) ?? []) {
        version += 1;
        const summary: VersionSummary = {
          version,
          createdBy: MEMORY_ACTOR,
          createdAt: entry.createdAt,
        };
        if (entry.message !== undefined) summary.message = entry.message;
        summaries.push(summary);
      }
      return summaries;
    },

    /** Mirrors the Convex host's rule so the selftest proves the same refusal:
     * one trigger per automation, and the kind must be one this host acts on. */
    async setTrigger(name, trigger) {
      const kind = typeof trigger.kind === 'string' ? trigger.kind : '';
      if (!(TRIGGER_KINDS as readonly string[]).includes(kind)) {
        throw new Error(
          `unknown trigger kind "${kind}" — one of ${TRIGGER_KINDS.join(', ')}`,
        );
      }
      const cron = typeof trigger.cron === 'string' ? trigger.cron : undefined;
      const event =
        typeof trigger.event === 'string' ? trigger.event : undefined;
      if (kind === 'schedule' && cron === undefined) {
        throw new Error('a schedule trigger needs a cron expression');
      }
      if (kind === 'event' && event === undefined) {
        throw new Error('an event trigger needs an event name');
      }
      triggers.set(name, {
        name,
        kind,
        ...(cron !== undefined && { cron }),
        ...(typeof trigger.timezone === 'string' && {
          timezone: trigger.timezone,
        }),
        ...(event !== undefined && { event }),
        hasToken: typeof trigger.tokenHash === 'string',
        enabled: trigger.enabled !== false,
      });
    },
    async listTriggers(name) {
      if (name !== undefined) {
        const one = triggers.get(name);
        return one ? [one] : [];
      }
      return [...triggers.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    },
    async deleteTrigger(name) {
      triggers.delete(name);
    },

    /**
     * The durable-run stand-in: execute the version inline, record the outcome,
     * and hand back the same `{runId, version}` handle a real host returns. It
     * finishes before it answers — the poll is then trivially satisfiable,
     * which is what a test needs, while the wire contract stays identical.
     */
    async startRun(name, input, mode, version) {
      const chosen = version ?? deployed.get(name);
      if (chosen === undefined) return null;
      const list = versions.get(name);
      const entry = list?.[chosen - 1];
      if (!entry) return null;
      runSeq += 1;
      const runId = `run_${runSeq}`;
      const startedAt = Date.now();
      const result = await execute(entry.automation, { input, mode });
      record({
        runId,
        name,
        version: chosen,
        status: result.status === 'success' ? 'success' : 'failed',
        mode,
        startedBy: MEMORY_ACTOR,
        input,
        ...(result.output !== undefined && { output: result.output }),
        trace: result.trace,
        effects: result.effects,
        ...(result.error?.message !== undefined && {
          detail: result.error.message,
        }),
        startedAt,
        finishedAt: Date.now(),
      });
      return { runId, version: chosen };
    },
    async listRuns(options) {
      // Newest first, like every host's run log, and summaries only — the
      // trace and the output belong to `getRun`.
      const summaries: RunSummary[] = [];
      for (const run of runs.toReversed()) {
        if (options.name !== undefined && run.name !== options.name) continue;
        if (options.limit !== undefined && summaries.length >= options.limit) {
          break;
        }
        summaries.push({
          runId: run.runId,
          name: run.name,
          version: run.version,
          status: run.status,
          mode: run.mode,
          startedBy: run.startedBy,
          ...(run.detail !== undefined && { detail: run.detail }),
          startedAt: run.startedAt,
          ...(run.finishedAt !== undefined && { finishedAt: run.finishedAt }),
        });
      }
      return summaries;
    },
    async getRun(runId) {
      return runs.find((run) => run.runId === runId) ?? null;
    },
    async cancelRun(runId) {
      const run = runs.find((entry) => entry.runId === runId);
      if (!run) throw new Error(`no run "${runId}"`);
      if (
        run.status === 'success' ||
        run.status === 'failed' ||
        run.status === 'cancelled'
      ) {
        return { cancelled: false };
      }
      run.status = 'cancelled';
      run.detail = 'cancelled by an operator';
      run.finishedAt = Date.now();
      return { cancelled: true };
    },

    /** Record a run the caller executed in one piece (`run_deployed`). */
    async recordRun(name, version, result, mode) {
      runSeq += 1;
      const now = Date.now();
      record({
        runId: `run_${runSeq}`,
        name,
        version,
        status: result.status === 'success' ? 'success' : 'failed',
        mode,
        startedBy: MEMORY_ACTOR,
        ...(result.output !== undefined && { output: result.output }),
        trace: result.trace,
        effects: result.effects,
        startedAt: now,
        finishedAt: now,
      });
    },
  };
}
