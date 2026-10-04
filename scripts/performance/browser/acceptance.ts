// Unprofiled paired acceptance: every declared row survives, including slow
// valid rows. Protocol controls and final functional work are separate modes.
import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { loadavg } from 'node:os';

import { z } from 'zod';

import {
  checkAcceptanceAnimation,
  observeAcceptanceClose,
} from './acceptance-animation.ts';
import {
  assertAcceptanceFrame,
  assertResourceCheckpoint,
  waitForQuietHost,
} from './acceptance-control.ts';
import { acceptanceDialogTargets } from './acceptance-dialog-target.ts';
import { acceptanceFixture } from './acceptance-fixture.ts';
import { proveAcceptanceFunctionality } from './acceptance-functional.ts';
import { acceptanceInitScript } from './acceptance-init.ts';
import { stopResourceMonitor } from './acceptance-monitor.ts';
import {
  acceptancePlan,
  inputToFrameMs,
  summarizeAcceptance,
  type AcceptanceObservation,
  type AcceptancePlannedRow,
} from './acceptance-plan.ts';
import { recordAcceptanceAction } from './acceptance-record.ts';
import { verifyBoot } from './boot.ts';
import {
  browserIdentity,
  browserSession,
  cards,
  fontsReady,
  launchBrowser,
  observations,
  pageBoot,
  ready,
  type BrowserSession,
} from './browser-session.ts';
import { json, outputPath, phaseTimeout, sources } from './common.ts';
import { inspectRenderedFont } from './font-glyphs.ts';
import { latinFontContract } from './font-policy.ts';
import { browserOrigins } from './origins.mjs';

const source = await sources();
assert.equal(source.mode, 'acceptance');
const end = Date.now() + phaseTimeout(60 * 60_000);
const remaining = (cap = 120_000) => phaseTimeout(cap, String(end));
const read = async (name: string) =>
  JSON.parse(await readFile(outputPath(name), 'utf8')) as unknown;
const ids = z
  .object({
    orgId: z.string(),
    ownerEmail: z.string(),
    userIds: z.array(z.string()).length(5),
    names: z.array(z.string()).length(5),
    projects: z.object({ small: z.string(), large: z.string() }),
  })
  .parse(await read('seed-ids.json'));
const task = z.object({
  taskId: z.string(),
  title: z.string(),
  parent: z.string().optional(),
  assigneeName: z.string().nullable(),
});
const fixtureSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  count: z.number(),
  tasks: z.array(task),
});
const fixtures = z
  .object({ small: fixtureSchema, large: fixtureSchema })
  .parse(await read('seed-summary.json'));
const boardSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      parentTaskId: z.string().nullable(),
      assigneeId: z.string().nullable(),
    }),
  ),
  truncated: z.boolean(),
});
const build = z.object({
  assets: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
});
const builds = z
  .object({ baseline: build, candidate: build })
  .parse(await read('builds.json'));
const fontContracts = {
  baseline: latinFontContract(browserOrigins[0]!, builds.baseline.assets),
  candidate: latinFontContract(browserOrigins[1]!, builds.candidate.assets),
};
const identity = await browserIdentity();
const rows: (AcceptanceObservation & Record<string, unknown>)[] = [];
const verified = new Map<number, ReturnType<typeof acceptanceFixture>>();
const receipt: Record<string, unknown> = {
  mode: 'acceptance',
  complete: false,
  verdict: 'inconclusive',
  source,
  identity,
  end,
  plan: acceptancePlan,
  rows,
  instrumentation:
    'Unprofiled; same input/MutationObserver/rAF/MessageChannel/content-oracle and longtask/event/Performance metrics in both arms. localStorage.tale_perf enables production bootstrap marks only, not React or CPU profiling. Content oracle includes exact titles and assigned-human labels. No first-visible-pixel claim.',
  preparation:
    'No task-detail HTTP prewarm. Identical out-of-window collectGarbage plus1s before nav/leave/search/clear/open/close;3s tail and heap before next GC. Natural action GC retained.',
  heapUnits:
    'JSHeapUsedSize divided by1048576 (MiB); historical budget named MB retained numerically at600.',
  sharedBackendWarming:
    'Full-board/narrow API fixture validation precedes sampling; cold refers to a fresh browser context, not an uninitialized backend or cleared OS cache.',
  functional: 'pending separate post-campaign context',
  queryObservers: {
    available: false,
    count: null,
    reason: 'No supported production inspection API',
  },
};
const save = () => json('acceptance-receipt.json', receipt);
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
  assert(remaining(ms) === ms);
  await session.page.waitForTimeout(ms);
  remaining(1);
};
const heap = async (session: BrowserSession) => {
  const metrics = await session.cdp.send('Performance.getMetrics');
  const used = metrics.metrics.find(
    (metric) => metric.name === 'JSHeapUsedSize',
  )?.value;
  assert(
    typeof used === 'number' && Number.isFinite(used) && used > 0,
    'Heap metric unavailable',
  );
  return { heapMiB: used / 1048576, metrics };
};
const boardPath = (projectId: string) =>
  `/dashboard/${ids.orgId}/projects/${projectId}/tasks/board`;
const generalPath = (projectId: string) =>
  `/dashboard/${ids.orgId}/projects/${projectId}/overview`;
const expectedBoard = (
  fixture: ReturnType<typeof acceptanceFixture>,
  narrow = false,
) => ({
  path: boardPath(fixture.projectId),
  tasks: narrow ? fixture.zebra : fixture.tasks,
  searchValue: narrow ? 'zebra' : '',
});
const expectedGeneral = (fixture: ReturnType<typeof acceptanceFixture>) => ({
  path: generalPath(fixture.projectId),
  projectName: fixture.projectName,
});

async function sessionFor(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  origin: string,
  fixture: ReturnType<typeof acceptanceFixture>,
  initial: 'board' | 'general',
) {
  const session = await browserSession(browser, origin, ids.ownerEmail);
  await session.page.addInitScript({
    content: acceptanceInitScript(
      expectedBoard(fixture),
      expectedGeneral(fixture),
      initial,
    ),
  });
  return session;
}
async function prepare(session: BrowserSession) {
  const before = {
    resource: await resource(),
    host: await host(),
    heap: await heap(session),
  };
  await session.cdp.send('HeapProfiler.collectGarbage');
  await delay(session, 1000);
  return before;
}
async function state(
  session: BrowserSession,
  fixture: ReturnType<typeof acceptanceFixture>,
  kind: 'board' | 'narrow' | 'general',
) {
  const okay =
    kind === 'general'
      ? await session.page.evaluate(
          (value) => window.__acceptance.generalState(value),
          expectedGeneral(fixture),
        )
      : await session.page.evaluate(
          (value) => window.__acceptance.boardState(value),
          expectedBoard(fixture, kind === 'narrow'),
        );
  assert(okay, `Wrong ${kind} action precondition`);
}
async function arm(
  session: BrowserSession,
  fixture: ReturnType<typeof acceptanceFixture>,
  kind: 'board' | 'narrow' | 'general',
) {
  await session.page.evaluate(
    ({ board, general, destination }) => {
      window.__perf.inputs = [];
      window.__benchmarkReady =
        destination === 'general'
          ? window.__acceptance.watchGeneral(general, { requireFalse: true })
          : window.__acceptance.watchBoard(board, { requireFalse: true });
    },
    {
      board: expectedBoard(fixture, kind === 'narrow'),
      general: expectedGeneral(fixture),
      destination: kind,
    },
  );
}
async function perform(
  planned: AcceptancePlannedRow,
  session: BrowserSession,
  fixture: ReturnType<typeof acceptanceFixture>,
  origin: string,
) {
  const { page } = session;
  delete session.fontState.current;
  const target = fixture.targets[planned.sample + 1]!;
  const { card, dialog, assertPrecondition } = acceptanceDialogTargets(
    page,
    target.title,
  );
  let actionFrame: { tDom: number; tFrame: number } | undefined;
  let tailMetrics: Awaited<ReturnType<typeof heap>> | undefined;
  const expectedFonts = {
    ...fontContracts[planned.arm],
    requiredWeights:
      planned.operation === 'leave'
        ? ([400] as const)
        : planned.operation === 'open'
          ? ([500, 600] as const)
          : ([500] as const),
  };
  await recordAcceptanceAction(planned, {
    now: Date.now,
    checkpoint: (row) => json('acceptance-current.json', row),
    append: async (row) => {
      await appendFile(
        outputPath('acceptance-rows.jsonl'),
        JSON.stringify(row) + '\n',
      );
      rows.push(row);
      await save();
    },
    failureEvidence: async () => {
      if (!session.fontState.current) {
        try {
          await fontsReady(session, expectedFonts, (evidence) =>
            json('acceptance-fonts-current.json', {
              id: planned.id,
              phase: 'action-failure',
              ...evidence,
            }),
          );
        } catch {
          // The row already owns its original failure. The retained checkpoint
          // includes partial collection errors even when its write also failed.
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const partial = await Promise.race([
          page.evaluate(() => {
            const animation = window.__acceptanceClose?.();
            delete window.__acceptanceClose;
            delete window.__acceptanceCloseReady;
            return {
              animation,
              inputs: window.__perf?.inputs,
              longtasks: window.__perf?.longtasks,
              at: performance.now(),
            };
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Partial page evidence exceeded2s')),
              2000,
            );
          }),
        ]);
        return {
          ...tailMetrics,
          ...partial,
          ...session.fontState.current,
          errors: [...session.errors],
        };
      } catch (error) {
        return {
          ...tailMetrics,
          pageEvidenceError: String(error),
          ...session.fontState.current,
          errors: [...session.errors],
        };
      } finally {
        clearTimeout(timer);
      }
    },
    prepare: async () => {
      if (planned.operation === 'cold')
        return { before: { resource: await resource(), host: await host() } };
      if (planned.operation !== 'close')
        await state(
          session,
          fixture,
          planned.operation === 'nav'
            ? 'general'
            : planned.operation === 'clear'
              ? 'narrow'
              : 'board',
        );
      return { before: await prepare(session) };
    },
    action: async () => {
      let key: string | undefined;
      let type = 'click';
      const operation = planned.operation;
      if (operation === 'cold')
        await page.goto(`${origin}${boardPath(fixture.projectId)}`, {
          waitUntil: 'domcontentloaded',
          timeout: remaining(),
        });
      else if (operation === 'nav' || operation === 'leave') {
        await arm(session, fixture, operation === 'nav' ? 'board' : 'general');
        const href =
          operation === 'nav'
            ? boardPath(fixture.projectId).replace(/\/board$/, '')
            : generalPath(fixture.projectId);
        const link = page.locator(`a[href="${href}"]`).and(
          page.getByRole('link', {
            name: operation === 'nav' ? 'Tasks' : 'General',
            exact: true,
          }),
        );
        assert.equal(await link.count(), 1, 'Navigation link is ambiguous');
        await link.click({ timeout: remaining() });
      } else if (operation === 'search' || operation === 'clear') {
        const search = page.locator(
          'input[type="text"][placeholder="Search tasks"][aria-label="Search tasks"]',
        );
        assert.equal(await search.count(), 1);
        await search.focus();
        await arm(
          session,
          fixture,
          operation === 'search' ? 'narrow' : 'board',
        );
        type = 'keydown';
        if (operation === 'search') {
          key = 'a';
          await search.pressSequentially('zebra', {
            delay: 120,
            timeout: remaining(),
          });
        } else {
          key = 'Backspace';
          await search.press('ControlOrMeta+A', { timeout: remaining() });
          await search.press('Backspace', { timeout: remaining() });
        }
      } else {
        await assertPrecondition(operation === 'open');
        if (operation === 'close')
          await dialog.evaluate(observeAcceptanceClose);
        await page.evaluate(
          ({ title, opening }) => {
            window.__perf.inputs = [];
            const content = window.__perf.watchDialog(title, opening);
            if (opening) window.__benchmarkReady = content;
            else {
              if (!window.__acceptanceCloseReady)
                throw new Error('Full-exit watcher was not armed');
              window.__benchmarkReady = Promise.all([
                content,
                window.__acceptanceCloseReady,
              ]).then(([contentFrame, fullFrame]) => ({
                ...fullFrame,
                contentFrame,
              }));
            }
          },
          { title: target.title, opening: operation === 'open' },
        );
        if (operation === 'open') await card.click({ timeout: remaining() });
        else {
          type = 'keydown';
          key = 'Escape';
          await page.keyboard.press('Escape');
        }
      }
      const frame = await ready(page, remaining());
      actionFrame = frame;
      const observed = await observations(page);
      assertAcceptanceFrame(frame, observed);
      const durationMs =
        operation === 'cold'
          ? frame.tFrame
          : inputToFrameMs(observed.inputs, type, frame.tFrame, key);
      assert(Number.isFinite(durationMs) && durationMs >= 0);
      return {
        durationMs,
        frame,
        observations: observed,
        clock:
          operation === 'cold'
            ? 'navigation performance.timeOrigin'
            : { type, key },
        target:
          operation === 'open' || operation === 'close' ? target : undefined,
      };
    },
    after: async () => {
      await delay(session, 3000);
      const metrics = await heap(session);
      tailMetrics = metrics;
      const fontEvidence = await fontsReady(
        session,
        expectedFonts,
        (evidence) =>
          json('acceptance-fonts-current.json', {
            id: planned.id,
            phase: 'post-action-tail-and-heap',
            ...metrics,
            ...evidence,
          }),
      );
      const boot = await pageBoot(session);
      const animation =
        planned.operation === 'close'
          ? await page.evaluate(() => {
              const value = window.__acceptanceClose?.();
              delete window.__acceptanceClose;
              delete window.__acceptanceCloseReady;
              return value;
            })
          : undefined;
      const evidence = {
        ...metrics,
        tail: await observations(page),
        host: await host(),
        resource: await resource(),
        boot,
        animation,
        ...fontEvidence,
        errors: [...session.errors],
      };
      await json('acceptance-after-current.json', {
        id: planned.id,
        ...evidence,
      });
      verifyBoot(boot, origin, builds[planned.arm].assets);
      assert.deepEqual(
        session.errors,
        [],
        'Browser error invalidates the campaign',
      );
      if (planned.operation === 'close') {
        assert(
          await card.evaluate((element) => element === document.activeElement),
          'Close did not restore the opener',
        );
        checkAcceptanceAnimation(animation, actionFrame!.tDom);
      }
      return evidence;
    },
  });
}

let campaignError: unknown;
try {
  await save();
  // Real full-board/narrow API readback only, outside all samples. Never read a
  // task-detail endpoint; fresh dialog contexts keep first-open behavior.
  const setup = await launchBrowser(identity);
  try {
    const session = await browserSession(
      setup,
      browserOrigins[0]!,
      ids.ownerEmail,
    );
    const names = Object.fromEntries(
      ids.userIds.map((id, index) => [id, ids.names[index]!]),
    );
    for (const fixture of Object.values(fixtures)) {
      const url = `${browserOrigins[0]}/api/app/tasks/by-project/${encodeURIComponent(fixture.projectId)}?orgId=${encodeURIComponent(ids.orgId)}&includeArchived=false`;
      const all = await session.context.request.get(url, {
        timeout: remaining(),
      });
      const narrow = await session.context.request.get(`${url}&q=zebra`, {
        timeout: remaining(),
      });
      assert(all.ok() && narrow.ok(), 'Fixture API readback failed');
      const value = acceptanceFixture(
        fixture,
        boardSchema.parse(await all.json()),
        boardSchema.parse(await narrow.json()),
        names,
      );
      verified.set(fixture.count, value);
    }
    await json('acceptance-fixtures.json', Object.fromEntries(verified));
  } finally {
    await setup.close();
  }
  for (const block of acceptancePlan) {
    remaining(1);
    await waitForQuietHost(
      {
        now: Date.now,
        sample: host,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        save: (samples) =>
          json(
            `host-${block.size}-${block.group}-${block.block}.json`,
            samples,
          ),
      },
      end,
    );
    await resource();
    const fixture = verified.get(block.size)!;
    assert(fixture);
    const origin = browserOrigins[block.arm === 'baseline' ? 0 : 1]!;
    const browser = await launchBrowser(identity);
    try {
      let session: BrowserSession | undefined;
      if (block.group !== 'cold') {
        const start = block.group === 'navLeave' ? 'general' : 'board';
        session = await sessionFor(browser, origin, fixture, start);
        await session.page.goto(
          `${origin}${start === 'general' ? generalPath(fixture.projectId) : boardPath(fixture.projectId)}`,
          { waitUntil: 'domcontentloaded', timeout: remaining() },
        );
        await ready(session.page, remaining());
        await fontsReady(
          session,
          {
            ...fontContracts[block.arm],
            requiredWeights: start === 'general' ? [400] : [500],
          },
          (evidence) => {
            // Keep the same object: a failed dedicated write adds persistenceError
            // before the outer campaign catch saves this recoverable receipt.
            receipt.startupFonts = {
              size: block.size,
              group: block.group,
              block: block.block,
              arm: block.arm,
              evidence,
            };
            return json(
              `fonts-start-${block.size}-${block.group}-${block.block}.json`,
              evidence,
            );
          },
        );
        assert.deepEqual(session.errors, []);
      }
      for (const sample of block.samples) {
        const current =
          session ?? (await sessionFor(browser, origin, fixture, 'board'));
        try {
          for (const planned of sample.operations)
            await perform(planned, current, fixture, origin);
        } finally {
          if (!session) await current.context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  // All timing rows are immutable before any detail read or functional action.
  receipt.timingComplete = true;
  receipt.summary = summarizeAcceptance(rows);
  const functional: Record<string, unknown>[] = [];
  receipt.functional = functional;
  await save();
  for (const size of [50, 2000]) {
    const fixture = verified.get(size)!;
    for (const [index, armName] of (
      ['baseline', 'candidate'] as const
    ).entries()) {
      const origin = browserOrigins[index]!;
      const functionalRow: Record<string, unknown> = {
        arm: armName,
        size,
        complete: false,
        phase: 'startup',
      };
      functional.push(functionalRow);
      const saveFunctional = async () => {
        await json(`functional-${armName}-${size}.json`, functionalRow);
        await save();
      };
      await saveFunctional();
      const browser = await launchBrowser(identity);
      try {
        const session = await sessionFor(browser, origin, fixture, 'board');
        await session.page.goto(`${origin}${boardPath(fixture.projectId)}`, {
          waitUntil: 'domcontentloaded',
          timeout: remaining(),
        });
        await ready(session.page, remaining());
        await fontsReady(
          session,
          { ...fontContracts[armName], requiredWeights: [500] },
          (evidence) => {
            functionalRow.fonts = evidence;
            return saveFunctional();
          },
        );
        const result = await proveAcceptanceFunctionality(session, {
          orgId: ids.orgId,
          fixture,
          names: ids.names,
          timeoutMs: remaining(),
          capture: async (phase) => {
            const name = `functional-${armName}-${size}-${phase}.png`;
            await session.page.screenshot({
              path: outputPath(name),
              timeout: remaining(),
            });
            return name;
          },
        });
        Object.assign(functionalRow, result);
        // The helper's own result remains separate from the additional glyph
        // obligation. No intermediate artifact may claim the whole row passed.
        functionalRow.behaviorComplete = result.complete;
        functionalRow.complete = false;
        await saveFunctional();
        assert.equal(result.complete, true, 'Separate functional proof failed');
        functionalRow.complete = false;
        functionalRow.phase = 'font-glyphs';
        const glyphs: Record<string, unknown> = {};
        functionalRow.glyphs = glyphs;
        await saveFunctional();
        const target = fixture.targets[0]!;
        const card = session.page.locator(cards).and(
          session.page.getByRole('button', {
            name: target.title,
            exact: true,
          }),
        );
        const checkGlyphs = async (
          name: string,
          locator: ReturnType<BrowserSession['page']['locator']>,
          text: string,
          weight: 400 | 500 | 600,
        ) => {
          const proof = await inspectRenderedFont(
            session.page,
            locator,
            { text, weight },
            remaining(),
          );
          glyphs[name] = proof;
          await saveFunctional();
          assert(proof.complete, `Required ${name} glyph proof failed`);
        };
        await checkGlyphs('board', card, target.title, 500);
        await card.click({ timeout: remaining() });
        const dialog = session.page.getByRole('dialog', {
          name: target.title,
          exact: true,
        });
        const title = dialog.locator('input[aria-label="Title"]');
        await title.waitFor({ state: 'visible', timeout: remaining() });
        await fontsReady(
          session,
          { ...fontContracts[armName], requiredWeights: [500, 600] },
          async (evidence) => {
            glyphs.dialogFonts = evidence;
            await saveFunctional();
          },
        );
        await checkGlyphs('dialog', title, target.title, 600);
        await session.page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden', timeout: remaining() });
        await arm(session, fixture, 'general');
        await session.page
          .locator(`a[href="${generalPath(fixture.projectId)}"]`)
          .and(session.page.getByRole('link', { name: 'General', exact: true }))
          .click({ timeout: remaining() });
        await ready(session.page, remaining());
        await fontsReady(
          session,
          { ...fontContracts[armName], requiredWeights: [400] },
          async (evidence) => {
            glyphs.generalFonts = evidence;
            await saveFunctional();
          },
        );
        await checkGlyphs(
          'general',
          session.page.locator('#project-overview-name'),
          fixture.projectName,
          400,
        );
        assert.deepEqual(
          session.errors,
          [],
          'Functional glyph browser errors invalidate the campaign',
        );
        functionalRow.complete = true;
        functionalRow.phase = 'complete';
        await saveFunctional();
        await resource();
      } catch (error) {
        functionalRow.complete = false;
        functionalRow.error = String(error);
        try {
          await saveFunctional();
        } catch (writeError) {
          functionalRow.persistenceError = String(writeError);
          throw new AggregateError(
            [error, writeError],
            `${String(error)}; ${String(writeError)}`,
            { cause: writeError },
          );
        }
        throw error;
      } finally {
        await browser.close();
      }
    }
  }
  const summary = summarizeAcceptance(rows);
  Object.assign(receipt, { complete: true, summary, verdict: summary.verdict });
} catch (error) {
  campaignError = error;
  Object.assign(receipt, {
    error: String(error),
    summary: summarizeAcceptance(rows),
  });
} finally {
  try {
    await stopResourceMonitor(process.env.BENCH_OUTPUT!);
  } catch (error) {
    receipt.monitorStopError = String(error);
    receipt.complete = false;
    campaignError = campaignError
      ? new AggregateError(
          [campaignError, error],
          'Campaign and monitor shutdown failed',
        )
      : error;
  }
  try {
    await save();
  } catch (error) {
    campaignError = campaignError
      ? new AggregateError(
          [campaignError, error],
          'Campaign and receipt persistence failed',
        )
      : error;
  }
}
if (campaignError) throw campaignError;
