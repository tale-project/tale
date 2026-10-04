// Functional checks only: the caller runs these after every timed row.
import assert from 'node:assert/strict';

import { z } from 'zod';

import type { Page } from '../../../packages/e2e/src/index.ts';
import type { acceptanceFixture } from './acceptance-fixture.ts';
import { cards, type BrowserSession } from './browser-session.ts';

/** Monotonic shared budget: no action gets a fresh copy of the full allowance. */
export function functionalBudget(
  timeoutMs: number,
  now = () => performance.now(),
) {
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0);
  const started = now();
  assert(Number.isFinite(started));
  let previous = started;
  return () => {
    const current = now();
    assert(
      Number.isFinite(current) && current >= previous,
      'Invalid functional clock',
    );
    previous = current;
    const remaining = Math.floor(timeoutMs - (current - started));
    assert(remaining > 0, 'Functional proof deadline expired');
    return remaining;
  };
}

/** Absence/isolation evidence needs its entire declared observation window.
 * Exhausting the shared budget fails; it never shortens the proof. */
export async function waitFunctionalWindow(
  durationMs: number,
  remaining: () => number,
  wait: (ms: number) => Promise<unknown>,
) {
  assert(Number.isFinite(durationMs) && durationMs > 0);
  assert(
    remaining() >= durationMs,
    'Insufficient budget for full functional observation window',
  );
  await wait(durationMs);
  remaining();
}

/** Standalone page-evaluation boundary; reads the actual shared select markup. */
export function readPickerEvidence(list: Element) {
  const doc = list.ownerDocument;
  const active = doc.activeElement;
  const options = [...list.querySelectorAll('[role="option"]')].map(
    (option) => ({
      // Shared SearchableSelect owns this primary-label wrapper; descriptions,
      // badges and avatars must never substitute for a missing actor name.
      label:
        option
          .querySelector(':scope > div > div > span')
          ?.textContent?.trim() ?? '',
      selected: option.getAttribute('aria-selected') === 'true',
      disabled: option.getAttribute('aria-disabled') === 'true',
      id: option.id,
    }),
  );
  const descendant = active?.getAttribute('aria-activedescendant') ?? null;
  return {
    label: list.getAttribute('aria-label'),
    options,
    focusOwnsList:
      list.contains(active) ||
      (active?.getAttribute('role') === 'combobox' &&
        active.getAttribute('aria-controls') === list.id &&
        list.id !== ''),
    activeOptionValid:
      !descendant ||
      options.some((option) => option.id === descendant && !option.disabled),
  };
}
export function assertPickerEvidence(
  evidence: ReturnType<typeof readPickerEvidence>,
  expected: {
    label: string;
    names: string[];
    allowedExtra?: string[];
    selected: string | null;
  },
) {
  assert.equal(evidence.label, expected.label, 'Wrong picker owns the popup');
  assert(
    evidence.focusOwnsList && evidence.activeOptionValid,
    'Picker focus is outside its own options',
  );
  assert(
    expected.names.length > 0 &&
      new Set(expected.names).size === expected.names.length,
    'Invalid expected picker names',
  );
  const labels = evidence.options.map((option) => option.label);
  assert.equal(
    new Set(labels).size,
    labels.length,
    'Duplicate or stale picker options',
  );
  assert(
    labels.every((label) => label.length > 0),
    'Picker option has no primary name',
  );
  for (const name of expected.names) {
    const option = evidence.options.find((value) => value.label === name);
    assert(
      option && !option.disabled,
      `Missing or disabled picker option: ${name}`,
    );
  }
  assert(
    labels.every(
      (label) =>
        expected.names.includes(label) ||
        expected.allowedExtra?.includes(label),
    ),
    'Unexpected picker identity',
  );
  assert.deepEqual(
    evidence.options
      .filter((option) => option.selected)
      .map((option) => option.label),
    expected.selected === null ? [] : [expected.selected],
    'Wrong selected option',
  );
}

/** A restored title is still a failed cancellation if a write was observed. */
export function assertTitleUnchanged(
  original: string,
  current: string,
  writes: number,
) {
  assert(
    Number.isSafeInteger(writes) && writes >= 0,
    'Invalid title-write evidence',
  );
  assert.equal(current, original, 'Escape committed the title draft');
  assert.equal(writes, 0, 'Escape dispatched a task mutation');
}

/** Walk actual browser focus, preserving the diagnostic's 128-control bound. */
export async function proveModalFocusTrap(
  page: Page,
  title: string,
  timeoutMs: number,
  onProgress?: (value: {
    forwardSteps: number;
    forwardWrapped: boolean;
    backwardWrapped: boolean;
  }) => void,
) {
  const remaining = functionalBudget(timeoutMs);
  const receipt = {
    forwardSteps: 0,
    forwardWrapped: false,
    backwardWrapped: false,
  };
  onProgress?.(receipt);
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await dialog.waitFor({ state: 'visible', timeout: remaining() });
  const containsFocus = () =>
    dialog.evaluate((element) => element.contains(document.activeElement));
  assert(await containsFocus(), 'Dialog did not own initial focus');
  await page.keyboard.press('Tab');
  assert(await containsFocus(), 'Initial Tab escaped the modal');
  const first = await page.evaluateHandle(() => document.activeElement);
  let last = first;
  try {
    for (let step = 0; step < 128; step += 1) {
      remaining();
      await page.keyboard.press('Tab');
      receipt.forwardSteps += 1;
      assert(await containsFocus(), 'Forward Tab escaped the modal');
      if (
        await first.evaluate((element) => element === document.activeElement)
      ) {
        receipt.forwardWrapped = true;
        break;
      }
      if (last !== first) await last.dispose();
      last = await page.evaluateHandle(() => document.activeElement);
    }
    assert(
      receipt.forwardWrapped && receipt.forwardSteps > 1,
      'Modal did not wrap across multiple controls within 128 steps',
    );
    remaining();
    await page.keyboard.press('Shift+Tab');
    receipt.backwardWrapped = await last.evaluate(
      (element) => element === document.activeElement,
    );
    assert(
      receipt.backwardWrapped && (await containsFocus()),
      'Backward Tab did not wrap to the last control',
    );
    return receipt;
  } finally {
    if (last !== first) await last.dispose();
    await first.dispose();
  }
}

/** Read real hit testing at a different card, never at the dialog's own opener. */
export function readBackgroundIsolation(options: {
  selector: string;
  title: string;
}) {
  const modal = document.querySelector('[role="dialog"][data-state="open"]');
  if (!modal) throw new Error('Open modal missing');
  const modalBox = modal.getBoundingClientRect();
  cardsLoop: for (const button of document.querySelectorAll(options.selector)) {
    if (button.textContent?.trim() === options.title) continue;
    const box = button.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    if (
      x <= 0 ||
      y <= 0 ||
      x >= innerWidth ||
      y >= innerHeight ||
      (x >= modalBox.left &&
        x <= modalBox.right &&
        y >= modalBox.top &&
        y <= modalBox.bottom)
    )
      continue;
    // Choose a point whose underlying board can actually move; observing an
    // already-clamped/non-scrollable background would prove nothing.
    let scroll: {
      axis: 'x' | 'y';
      delta: number;
      position: number;
      maximum: number;
    } | null = null;
    for (
      let parent = button.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent);
      const parentBox = parent.getBoundingClientRect();
      if (
        (/^(auto|scroll|hidden|clip)$/.test(style.overflowX) &&
          (x < parentBox.left || x > parentBox.right)) ||
        (/^(auto|scroll|hidden|clip)$/.test(style.overflowY) &&
          (y < parentBox.top || y > parentBox.bottom))
      )
        continue cardsLoop;
      for (const axis of ['y', 'x'] as const) {
        const overflow = axis === 'y' ? style.overflowY : style.overflowX;
        const maximum =
          axis === 'y'
            ? parent.scrollHeight - parent.clientHeight
            : parent.scrollWidth - parent.clientWidth;
        const position = axis === 'y' ? parent.scrollTop : parent.scrollLeft;
        if (
          scroll === null &&
          /^(auto|scroll)$/.test(overflow) &&
          maximum > 1
        ) {
          scroll = {
            axis,
            delta: position > 0 ? -400 : 400,
            position,
            maximum,
          };
          break;
        }
      }
      // Continue checking outer clip ancestors after finding the first scroller.
    }
    if (!scroll) continue;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      backgroundTitle: button.textContent?.trim(),
      blocked: hit !== null && !button.contains(hit),
      hit: hit?.tagName ?? null,
      scroll,
    };
  }
  throw new Error(
    'No different visible scrollable background-card point outside modal',
  );
}

const taskSchema = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    rank: z.string(),
    priority: z.string().nullable(),
    assigneeId: z.string().nullable(),
  }),
});
const priorityLabels: Record<string, string> = {
  p0: 'Urgent',
  p1: 'High',
  p2: 'Medium',
  p3: 'Low',
};

export async function proveAcceptanceFunctionality(
  session: BrowserSession,
  options: {
    orgId: string;
    fixture: ReturnType<typeof acceptanceFixture>;
    names: string[];
    timeoutMs: number;
    capture?: (phase: 'modal' | 'priority' | 'assignee') => Promise<string>;
  },
): Promise<Record<string, unknown>> {
  const { page, context } = session;
  const totalRemaining = functionalBudget(options.timeoutMs);
  const cleanupReserveMs = Math.min(10_000, Math.floor(options.timeoutMs / 4));
  const remaining = () => {
    const value = totalRemaining() - cleanupReserveMs;
    assert(value > 0, 'Functional proof deadline reached cleanup reserve');
    return value;
  };
  const target = options.fixture.targets[0];
  assert(target, 'Functional fixture has no root target');
  const origin = new URL(page.url()).origin;
  const path = `/dashboard/${options.orgId}/projects/${options.fixture.projectId}/tasks/board`;
  const url = `${origin}/api/app/tasks/${encodeURIComponent(target.taskId)}?orgId=${encodeURIComponent(options.orgId)}`;
  const receipt: Record<string, unknown> = {
    complete: false,
    phase: 'initial',
    target,
    afterAllTimedRows: true,
    cleanupReserveMs,
    limits: [
      'DOM/live-region observations are not spoken screen-reader proof.',
      'Fixture has no reviewer assignments; no runtime reviewer-name proof is claimed.',
      'Pointer hit testing and wheel checks are functional evidence, not compositor timing.',
    ],
  };
  const readTask = async (budget = remaining) => {
    const response = await context.request.get(url, { timeout: budget() });
    assert(response.ok(), 'Functional task read failed');
    const task = taskSchema.parse(await response.json()).task;
    assert.equal(task.id, target.taskId);
    return task;
  };
  let original: Awaited<ReturnType<typeof readTask>> | undefined;
  let titleMayNeedRestore = false;
  type Request = Awaited<ReturnType<Page['waitForRequest']>>;
  const titleRequests: Request[] = [];
  const pendingTitleRequests = new Set<Request>();
  const taskPath = new URL(url).pathname;
  const onRequest = (request: Request) => {
    if (
      titleMayNeedRestore &&
      new URL(request.url()).pathname === taskPath &&
      ['POST', 'PATCH'].includes(request.method())
    ) {
      titleRequests.push(request);
      pendingTitleRequests.add(request);
    }
  };
  const settled = (request: Request) => {
    pendingTitleRequests.delete(request);
  };
  page.on('request', onRequest);
  page.on('requestfinished', settled);
  page.on('requestfailed', settled);
  const settleTitleRequests = async (budget: () => number) => {
    while (pendingTitleRequests.size)
      await page.waitForTimeout(Math.min(25, budget()));
  };
  try {
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(await page.locator(cards).count(), options.fixture.count);
    original = await readTask();
    assert.equal(original.title, target.title);
    const card = page
      .locator(cards)
      .and(page.getByRole('button', { name: target.title, exact: true }));
    assert.equal(await card.count(), 1);
    await card.scrollIntoViewIfNeeded({ timeout: remaining() });
    const actor = await card.evaluate((element) => {
      const avatar = element.parentElement?.querySelector('[role="img"]');
      return avatar?.getAttribute('aria-label') ?? null;
    });
    assert.equal(
      actor,
      target.assigneeName ?? 'Unassigned',
      'Card actor label is stale or raw',
    );
    receipt.actor = actor;

    receipt.phase = 'card-keyboard';
    await card.focus({ timeout: remaining() });
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="status"][aria-live]')].some(
          (node) => node.textContent?.startsWith('Picked up '),
        ),
      {},
      { timeout: remaining() },
    );
    const picked = await page
      .locator('[role="status"][aria-live]')
      .allTextContents();
    assert.equal(
      await page.getByRole('dialog').count(),
      0,
      'Space opened a modal instead of picking up the root card',
    );
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="status"][aria-live]')].some(
          (node) =>
            node.textContent?.startsWith('Dropped ') &&
            node.textContent.includes('where it started'),
        ),
      {},
      { timeout: remaining() },
    );
    receipt.drag = {
      picked,
      dropped: await page
        .locator('[role="status"][aria-live]')
        .allTextContents(),
      moved: false,
    };
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(
      await readTask(),
      original,
      'In-place keyboard drop changed the task',
    );
    await card.focus({ timeout: remaining() });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: target.title,
      exact: true,
    });
    await dialog.waitFor({ state: 'visible', timeout: remaining() });
    await dialog
      .locator('input[aria-label="Title"]')
      .waitFor({ state: 'visible', timeout: remaining() });
    receipt.enterOpened = true;
    receipt.phase = 'focus-trap';
    receipt.focusTrap = await proveModalFocusTrap(
      page,
      target.title,
      remaining(),
      (value) => {
        receipt.focusTrap = value;
      },
    );
    if (options.capture) receipt.modalImage = await options.capture('modal');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: remaining() });
    assert(
      await card.evaluate((element) => element === document.activeElement),
      'Escape did not restore the opener',
    );
    receipt.escapeRestoredOpener = true;

    receipt.phase = 'pickers';
    const pickerReceipts = [];
    // Card controls prove first-use deferred mounting without a detail warmup.
    const root = card.locator('..');
    for (const definition of [
      {
        trigger: 'Priority',
        label: 'Priority',
        names: ['No priority', 'Urgent', 'High', 'Medium', 'Low'],
        selected:
          original.priority === null
            ? 'No priority'
            : (priorityLabels[original.priority] ?? ''),
        allowedExtra: [],
      },
      {
        trigger: 'Assign',
        label: 'Assignee',
        names: options.names,
        selected: target.assigneeName,
        allowedExtra: ['Standard agent', 'Create an agent…'],
      },
    ]) {
      const snapshots: {
        use: string;
        evidence: ReturnType<typeof readPickerEvidence>;
      }[] = [];
      for (const use of ['first-use', 'reopen']) {
        const trigger = root.getByRole('button', {
          name: definition.trigger,
          exact: true,
        });
        await trigger.click({ timeout: remaining() });
        const list = page.getByRole('listbox', {
          name: definition.label,
          exact: true,
        });
        await list.waitFor({ state: 'visible', timeout: remaining() });
        for (const name of definition.names)
          await list
            .getByText(name, { exact: true })
            .waitFor({ state: 'visible', timeout: remaining() });
        const evidence = await list.evaluate(readPickerEvidence);
        assertPickerEvidence(evidence, definition);
        if (use === 'first-use' && options.capture)
          receipt[`${definition.label.toLowerCase()}Image`] =
            await options.capture(
              definition.label === 'Priority' ? 'priority' : 'assignee',
            );
        assert.equal(
          await page
            .getByRole('dialog', { name: target.title, exact: true })
            .count(),
          0,
          'Picker event opened its parent task',
        );
        await page.keyboard.press('Escape');
        await list.waitFor({ state: 'detached', timeout: remaining() });
        assert(
          await trigger.evaluate(
            (element) => element === document.activeElement,
          ),
          'Picker did not restore its trigger',
        );
        snapshots.push({ use, evidence });
      }
      const [first, reopened] = snapshots;
      assert(first && reopened, 'Missing picker lifecycle evidence');
      assert.deepEqual(
        first.evidence.options,
        reopened.evidence.options,
        'Reopened options differ',
      );
      pickerReceipts.push({ picker: definition.label, snapshots });
    }
    receipt.pickers = pickerReceipts;

    receipt.phase = 'title-cancel';
    await card.click({ timeout: remaining() });
    const title = dialog.locator('input[aria-label="Title"]');
    await title.waitFor({ state: 'visible', timeout: remaining() });
    await title.focus({ timeout: remaining() });
    await page.keyboard.press('ControlOrMeta+A');
    assert(
      await title.evaluate(
        (element) =>
          element instanceof HTMLInputElement &&
          element.selectionStart === 0 &&
          element.selectionEnd === element.value.length,
      ),
      'Title text was not selectable',
    );
    titleMayNeedRestore = true;
    await title.fill(`${target.title} functional draft`, {
      timeout: remaining(),
    });
    await page.keyboard.press('Escape');
    // Escape may close the surrounding dialog; the persisted title must stay.
    await waitFunctionalWindow(1000, remaining, (ms) =>
      page.waitForTimeout(ms),
    );
    await settleTitleRequests(remaining);
    assertTitleUnchanged(
      target.title,
      (await readTask()).title,
      titleRequests.length,
    );
    receipt.title = {
      selected: true,
      edited: true,
      cancelled: true,
      mutationRequests: titleRequests.length,
      observationMs: 1000,
    };
    if (await dialog.count()) {
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: remaining() });
    }

    receipt.phase = 'background-isolation';
    await card.click({ timeout: remaining() });
    await dialog.waitFor({ state: 'visible', timeout: remaining() });
    const isolation = await page.evaluate(readBackgroundIsolation, {
      selector: cards,
      title: target.title,
    });
    assert(
      isolation.blocked,
      'Background card accepts pointer while modal is open',
    );
    const scrollPositions = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('*')]
          .filter(
            (node) =>
              !node.closest('[role="dialog"]') &&
              (node.scrollHeight > node.clientHeight ||
                node.scrollWidth > node.clientWidth),
          )
          .map((node) => [node.scrollTop, node.scrollLeft])
          .concat([[scrollY, scrollX]]),
      );
    const beforeScroll = await scrollPositions();
    await page.mouse.move(isolation.x, isolation.y);
    await page.mouse.wheel(
      isolation.scroll.axis === 'x' ? isolation.scroll.delta : 0,
      isolation.scroll.axis === 'y' ? isolation.scroll.delta : 0,
    );
    await waitFunctionalWindow(300, remaining, (ms) => page.waitForTimeout(ms));
    assert.deepEqual(
      await scrollPositions(),
      beforeScroll,
      'Modal wheel scrolled the background',
    );
    await page.mouse.click(isolation.x, isolation.y);
    await waitFunctionalWindow(300, remaining, (ms) => page.waitForTimeout(ms));
    assert.equal(
      new URL(page.url()).pathname,
      path,
      'Background pointer navigated',
    );
    const dialogs = page.getByRole('dialog');
    if (await dialogs.count()) {
      assert.equal(
        await dialog.count(),
        1,
        'Background click opened another task',
      );
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached', timeout: remaining() });
    }
    receipt.isolation = {
      ...isolation,
      wheelUnchanged: true,
      backgroundDidNotOpen: true,
    };
    assert.deepEqual(
      await readTask(),
      original,
      'Functional proof left task mutations',
    );
    assert.deepEqual(
      session.errors,
      [],
      'Browser errors during functional proof',
    );
    receipt.phase = 'complete';
    receipt.complete = true;
  } catch (error) {
    receipt.error = String(error);
  } finally {
    if (titleMayNeedRestore && original) {
      try {
        await settleTitleRequests(totalRemaining);
        const current = await readTask(totalRemaining);
        if (current.title !== original.title) {
          const response = await context.request.post(url, {
            headers: { origin },
            data: { title: original.title },
            timeout: totalRemaining(),
          });
          assert(response.ok(), 'Synthetic title restoration failed');
          assert.equal((await readTask(totalRemaining)).title, original.title);
        }
        receipt.syntheticTitleRestored = true;
        try {
          assertTitleUnchanged(
            original.title,
            current.title,
            titleRequests.length,
          );
        } catch (error) {
          // Restoration is cleanup, never a waiver of late failure evidence.
          receipt.complete = false;
          receipt.error ??= String(error);
          receipt.finalTitleEvidence = {
            writes: titleRequests.length,
            changed: current.title !== original.title,
          };
        }
      } catch (error) {
        receipt.restorationError = String(error);
        receipt.complete = false;
      }
    }
  }
  page.off('request', onRequest);
  page.off('requestfinished', settled);
  page.off('requestfailed', settled);
  return receipt;
}
