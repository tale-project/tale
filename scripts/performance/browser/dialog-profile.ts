// Four causal collections, never an acceptance verdict. Product inputs are
// pinned separately from this new harness commit by prepare-sources.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadavg } from 'node:os';

import { z } from 'zod';

import { observeAcceptanceClose } from './acceptance-animation.ts';
import {
  assertAcceptanceFrame,
  assertResourceCheckpoint,
  waitForQuietHost,
} from './acceptance-control.ts';
import { acceptanceDialogTargets } from './acceptance-dialog-target.ts';
import { acceptanceFixture } from './acceptance-fixture.ts';
import { acceptanceInitScript } from './acceptance-init.ts';
import { stopResourceMonitor } from './acceptance-monitor.ts';
import { inputToFrameMs } from './acceptance-plan.ts';
import { verifyBoot } from './boot.ts';
import {
  browserIdentity,
  browserSession,
  fontsReady,
  launchBrowser,
  observations,
  pageBoot,
  ready,
  type BrowserSession,
} from './browser-session.ts';
import { json, outputPath, phaseTimeout, sources } from './common.ts';
import {
  collectDialogAttempt,
  dialogPlan,
  runDialogPlan,
} from './dialog-plan.ts';
import { dialogProductPair } from './dialog-sources.mjs';
import { snapshotDialogStyle } from './dialog-style.ts';
import {
  boardSchema,
  buildsSchema,
  fixturesSchema,
  seedIdsSchema,
} from './fixture-inputs.ts';
import { latinFontContract } from './font-policy.ts';
import { browserOrigins } from './origins.mjs';
import { capturePhase, dialogTraceCategories } from './phase.ts';

const source = await sources();
assert.equal(source.mode, 'dialog');
assert.equal(source.baseline, dialogProductPair.baseline);
assert.equal(source.dialogAdmission?.baseline, dialogProductPair.baseline);
assert.equal(
  source.dialogAdmission?.productCandidate,
  dialogProductPair.candidate,
);
const end = Date.now() + phaseTimeout(5 * 60_000);
const remaining = (cap = 120_000) => phaseTimeout(cap, String(end));
const read = async (name: string) =>
  JSON.parse(await readFile(outputPath(name), 'utf8')) as unknown;
const ids = seedIdsSchema.parse(await read('seed-ids.json'));
const seeded = fixturesSchema.parse(await read('seed-summary.json')).large;
assert.equal(seeded.count, 2000);
const builds = buildsSchema.parse(await read('builds.json'));
const identity = await browserIdentity();
const rows: Record<string, unknown>[] = [];
const receipt: Record<string, unknown> = {
  mode: 'dialog',
  complete: false,
  accepted: false,
  source,
  productPair: dialogProductPair,
  identity,
  end,
  plan: dialogPlan,
  rows,
  instrumentation: {
    categories: dialogTraceCategories,
    cpu: 'periodic CDP Profiler; no timeline.stack forced samples',
    timing:
      'Instrumented causal evidence only; never compared with unprofiled acceptance timings for pass/fail',
    style:
      'Invalidation events retain initiator/reason evidence with instrumentation overhead; event counts/causes are distinct from periodic CPU weights. Allowlisted inventories only after primary collection; no CSS.enable',
  },
  preparation:
    'Fresh browser/context for each attempt; exact loaded board; no detail HTTP prewarm; GC plus1s outside primary collection; real click through named-dialog content plus3s tail',
  sharedBackendWarming:
    'Full-board/narrow fixture validation before attempts; no cleared backend/OS cache claim',
  queryObservers: {
    available: false,
    count: null,
    reason: 'No supported production inspection API',
  },
};
const save = () => json('dialog-receipt.json', receipt);
const host = async () => ({
  at: Date.now(),
  load: loadavg(),
  cpuPressure: await readFile('/proc/pressure/cpu', 'utf8'),
});
const resource = async () =>
  assertResourceCheckpoint(
    z
      .object({
        at: z.number(),
        valid: z.boolean(),
        error: z.string().optional(),
        counters: z.record(z.string(), z.string()).optional(),
        membership: z.unknown().optional(),
      })
      .parse(await read('resource-live.json')),
    Date.now(),
  );
const delay = async (session: BrowserSession, ms: number) => {
  assert.equal(remaining(ms), ms, 'A fixed observation window must fit');
  await session.page.waitForTimeout(ms);
  remaining(1);
};
const metrics = async (session: BrowserSession) => {
  const requestedAt = Date.now();
  const value = await session.cdp.send('Performance.getMetrics');
  for (const name of [
    'Timestamp',
    'JSHeapUsedSize',
    'ScriptDuration',
    'RecalcStyleDuration',
  ]) {
    const metric = value.metrics.find((entry) => entry.name === name)?.value;
    assert(
      typeof metric === 'number' && Number.isFinite(metric) && metric >= 0,
      `Missing metric ${name}`,
    );
  }
  return { requestedAt, receivedAt: Date.now(), value };
};
const errorEvidence = (error: unknown): unknown =>
  error instanceof AggregateError
    ? { message: String(error), causes: error.errors.map(errorEvidence) }
    : String(error);
let campaignError: unknown;
try {
  await save();
  const setup = await launchBrowser(identity);
  let fixture: ReturnType<typeof acceptanceFixture>;
  try {
    const session = await browserSession(
      setup,
      browserOrigins[0]!,
      ids.ownerEmail,
    );
    const url = `${browserOrigins[0]}/api/app/tasks/by-project/${encodeURIComponent(seeded.projectId)}?orgId=${encodeURIComponent(ids.orgId)}&includeArchived=false`;
    const all = await session.context.request.get(url, {
      timeout: remaining(),
    });
    const narrow = await session.context.request.get(`${url}&q=zebra`, {
      timeout: remaining(),
    });
    assert(all.ok() && narrow.ok(), 'Fixture API readback failed');
    fixture = acceptanceFixture(
      seeded,
      boardSchema.parse(await all.json()),
      boardSchema.parse(await narrow.json()),
      Object.fromEntries(
        ids.userIds.map((id, index) => [id, ids.names[index]!]),
      ),
    );
    await json('dialog-fixture.json', fixture);
  } finally {
    await setup.close();
  }
  const board = {
    path: `/dashboard/${ids.orgId}/projects/${fixture.projectId}/tasks/board`,
    tasks: fixture.tasks,
    searchValue: '',
  };
  const general = {
    path: `/dashboard/${ids.orgId}/projects/${fixture.projectId}/overview`,
    projectName: fixture.projectName,
  };
  await runDialogPlan({
    before: async (attempt) => {
      const row: Record<string, unknown> = {
        ...attempt,
        complete: false,
        phase: 'host-gate',
      };
      rows.push(row);
      await save();
      await waitForQuietHost(
        {
          now: Date.now,
          sample: host,
          wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          save: (samples) => json(`dialog-${attempt.index}-host.json`, samples),
        },
        end,
      );
      row.resourceBefore = await resource();
    },
    run: async (attempt) => {
      const row = rows[attempt.index]!;
      const prefix = `dialog-${attempt.index}-${attempt.arm}`;
      const saveRow = async () => {
        await json(`${prefix}.json`, row);
        await save();
      };
      const target = fixture.targets[attempt.targetIndex]!;
      assert(target, 'Missing distinct dialog target');
      row.target = target;
      const origin = browserOrigins[attempt.arm === 'baseline' ? 0 : 1]!;
      const fonts = latinFontContract(origin, builds[attempt.arm].assets);
      const browser = await launchBrowser(identity);
      let session: BrowserSession | undefined;
      let attemptError: unknown;
      try {
        session = await browserSession(browser, origin, ids.ownerEmail);
        const current = session;
        const { page, cdp } = current;
        const detailPaths = new Set(
          fixture.tasks.map(
            (task) => `/api/app/tasks/${encodeURIComponent(task.taskId)}`,
          ),
        );
        let detailReads = 0;
        page.on('request', (request) => {
          if (detailPaths.has(new URL(request.url()).pathname)) detailReads++;
        });
        const { card, dialog, assertPrecondition } = acceptanceDialogTargets(
          page,
          target.title,
        );
        const outcome = await collectDialogAttempt({
          load: async () => {
            row.phase = 'board-load';
            await saveRow();
            await page.addInitScript({
              content: acceptanceInitScript(board, general, 'board'),
            });
            await page.goto(`${origin}${board.path}`, {
              waitUntil: 'domcontentloaded',
              timeout: remaining(),
            });
            row.boardFrame = await ready(page, remaining());
            assert(
              await page.evaluate(
                (expected) => window.__acceptance.boardState(expected),
                board,
              ),
            );
            row.boot = await pageBoot(current);
            verifyBoot(
              row.boot as Awaited<ReturnType<typeof pageBoot>>,
              origin,
              builds[attempt.arm].assets,
            );
            await fontsReady(
              current,
              { ...fonts, requiredWeights: [500] },
              async (value) => {
                row.startupFonts = value;
                await saveRow();
              },
            );
            assert.deepEqual(current.errors, [], 'Browser startup errors');
            await assertPrecondition(true);
            row.loaded = { boardReady: true, taskDetailReads: detailReads };
            return { boardReady: true, taskDetailReads: detailReads };
          },
          prepare: async () => {
            row.phase = 'preconditioning';
            await saveRow();
            await cdp.send('HeapProfiler.collectGarbage');
            await delay(current, 1000);
            assert.equal(
              detailReads,
              0,
              'Task detail was read during preparation',
            );
            row.preparationDetailReads = detailReads;
            delete current.fontState.current;
          },
          collect: async () => {
            row.phase = 'primary';
            await saveRow();
            return capturePhase(
              cdp,
              outputPath(prefix),
              async () => {
                await page.evaluate((title) => {
                  window.__perf.inputs = [];
                  window.__benchmarkReady = window.__perf.watchDialog(
                    title,
                    true,
                  );
                  performance.mark('dialog-causal-before-input');
                }, target.title);
                const before = await metrics(current);
                row.beforeInput = before;
                await card.click({ timeout: remaining() });
                const frame = await ready(page, remaining());
                const atReady = await metrics(current);
                await page.evaluate(() =>
                  performance.mark('dialog-causal-content-ready'),
                );
                const observed = await observations(page);
                assertAcceptanceFrame(frame, observed);
                row.ready = { frame, metrics: atReady, observations: observed };
                await delay(current, 3000);
                const tail = {
                  metrics: await metrics(current),
                  observations: await observations(page),
                };
                await page.evaluate(() =>
                  performance.mark('dialog-causal-tail-complete'),
                );
                return {
                  frame,
                  durationMs: inputToFrameMs(
                    observed.inputs,
                    'click',
                    frame.tFrame,
                  ),
                  before,
                  atReady,
                  observed,
                  tail,
                  clock:
                    'Actual captured click→named-dialog content frame; instrumented, not acceptance',
                  detailReads,
                };
              },
              async (value) => {
                row.primary = value;
                row.primaryCaptureComplete = false;
                await saveRow();
              },
              'dialog',
            );
          },
          checkpoint: async (primary) => {
            row.primary = primary;
            row.primaryCaptureComplete = true;
            row.phase = 'post-collection';
            await saveRow();
          },
          inspect: async (state) => {
            remaining(1);
            const value = await page.evaluate(snapshotDialogStyle, {
              nodes: 100_000,
              patterns: 2000,
            });
            remaining(1);
            row[`style${state === 'open' ? 'Open' : 'Closed'}`] = value;
            await json(`${prefix}.style-${state}.json`, value);
            await saveRow();
            assert(value.complete, 'Style inventory incomplete');
            assert(
              value.counts.Assign > 0 && value.counts.Priority > 0,
              'Expected board picker controls missing',
            );
            assert.equal(
              value.counts.dialog,
              state === 'open' ? 1 : 0,
              'Wrong post-collection dialog state',
            );
            return value;
          },
          close: async () => {
            await assertPrecondition(false);
            await dialog.evaluate(observeAcceptanceClose);
            await page.evaluate(() => {
              if (!window.__acceptanceCloseReady)
                throw new Error('Missing full exit watcher');
              window.__benchmarkReady = window.__acceptanceCloseReady;
            });
            await page.keyboard.press('Escape');
            row.closeFrame = await ready(page, remaining());
            row.closeAnimation = await page.evaluate(() => {
              const value = window.__acceptanceClose?.();
              delete window.__acceptanceClose;
              delete window.__acceptanceCloseReady;
              return value;
            });
            assert.equal(
              await card.count(),
              1,
              'Accessible opener missing after close',
            );
            assert(
              await card.evaluate(
                (element) => element === document.activeElement,
              ),
              'Close did not restore opener focus',
            );
          },
        });
        // Descriptor/body collection remains outside primary collection.
        row.postCollection = outcome.postCollection;
        await fontsReady(
          current,
          { ...fonts, requiredWeights: [500, 600] },
          async (value) => {
            row.fonts = value;
            await saveRow();
          },
        );
        row.resourceAfter = await resource();
        row.hostAfter = await host();
        row.errors = [...current.errors];
        await saveRow();
        assert.deepEqual(
          current.errors,
          [],
          'Browser errors invalidate the diagnostic',
        );
        row.complete = true;
        row.phase = 'complete';
      } catch (error) {
        attemptError = error;
        row.error = errorEvidence(error);
        if (session) {
          if (!session.fontState.current) {
            try {
              await fontsReady(
                session,
                { ...fonts, requiredWeights: [500, 600] },
                async (value) => {
                  row.failureFonts = value;
                  await saveRow();
                },
              );
            } catch (evidenceError) {
              row.fontEvidenceError = errorEvidence(evidenceError);
            }
          }
          row.errors = [...session.errors];
          row.fonts = session.fontState.current;
          try {
            row.failureObservations = await observations(session.page);
          } catch (failure) {
            row.observationError = String(failure);
          }
        }
      } finally {
        try {
          await browser.close();
        } catch (error) {
          row.closeError = String(error);
          attemptError = attemptError
            ? new AggregateError(
                [attemptError, error],
                'Attempt and browser cleanup failed',
              )
            : error;
        }
        if (attemptError) row.complete = false;
        try {
          await saveRow();
        } catch (error) {
          row.complete = false;
          attemptError = attemptError
            ? new AggregateError(
                [attemptError, error],
                'Attempt and receipt write failed',
              )
            : error;
        }
      }
      if (attemptError) throw attemptError;
    },
    failure: async (attempt, error) => {
      receipt.failedAttempt = attempt;
      receipt.error = errorEvidence(error);
      await save();
    },
  });
  receipt.complete = true;
} catch (error) {
  campaignError = error;
  receipt.error = errorEvidence(error);
} finally {
  try {
    await stopResourceMonitor(process.env.BENCH_OUTPUT!);
  } catch (error) {
    receipt.monitorStopError = String(error);
    receipt.complete = false;
    campaignError = campaignError
      ? new AggregateError(
          [campaignError, error],
          'Diagnostic and monitor stop failed',
        )
      : error;
  }
  try {
    await save();
  } catch (error) {
    campaignError = campaignError
      ? new AggregateError(
          [campaignError, error],
          'Diagnostic and evidence write failed',
        )
      : error;
  }
}
if (campaignError) throw campaignError;
