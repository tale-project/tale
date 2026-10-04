import { afterEach, expect, test } from 'bun:test';

import { JSDOM } from 'jsdom';

import {
  assertPickerEvidence,
  assertTitleUnchanged,
  functionalBudget,
  readBackgroundIsolation,
  readPickerEvidence,
  waitFunctionalWindow,
} from './browser/acceptance-functional.ts';

const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});
function fixture() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
  });
  owned.push(dom);
  return dom;
}
const expected = {
  label: 'Assignee',
  names: ['Alice Example', 'Bob Example'],
  selected: 'Alice Example',
};
function picker() {
  const dom = fixture();
  const doc = dom.window.document;
  doc.body.innerHTML = `<input role="combobox" aria-controls="people" aria-activedescendant="person-0"><div role="listbox" id="people" aria-label="Assignee"></div>`;
  const list = doc.querySelector('[role="listbox"]');
  const input = doc.querySelector('input');
  if (!list || !input) throw new Error('Missing fixture');
  const rows = expected.names.map((name, index) => {
    const row = doc.createElement('div');
    row.setAttribute('role', 'option');
    row.id = `person-${index}`;
    row.setAttribute('aria-selected', String(index === 0));
    row.innerHTML = `<span aria-hidden="true"></span><div><div><span>${name}</span><span>You</span></div><div>description@example.invalid</div></div>`;
    list.append(row);
    return row;
  });
  input.focus();
  // Exact serialized browser boundary: imported closures are unavailable.
  const read = dom.window.eval(
    `(${readPickerEvidence.toString()})`,
  ) as typeof readPickerEvidence;
  return {
    dom,
    doc,
    list,
    input,
    rows,
    read: () =>
      JSON.parse(JSON.stringify(read(list))) as ReturnType<
        typeof readPickerEvidence
      >,
  };
}

test('functional allowance is shared, decreasing and finite', () => {
  let now = 10;
  const remaining = functionalBudget(100, () => now);
  expect(remaining()).toBe(100);
  now = 35.5;
  expect(remaining()).toBe(74);
  now = 90;
  expect(remaining()).toBe(20);
  now = 110;
  expect(remaining).toThrow('deadline');
});
test('functional allowance refuses invalid and backwards clocks', () => {
  for (const ms of [0, -1, NaN, Infinity])
    expect(() => functionalBudget(ms)).toThrow();
  expect(() => functionalBudget(10, () => NaN)).toThrow();
  let now = 10;
  const remaining = functionalBudget(100, () => now);
  now = 50;
  expect(remaining()).toBe(60);
  now = 20;
  expect(remaining).toThrow('clock');
  now = Infinity;
  expect(remaining).toThrow('clock');
});
test('picker reads primary names without badges or descriptions and owns its active option', () => {
  const f = picker();
  const evidence = f.read();
  expect(evidence.options.map((row) => row.label)).toEqual(expected.names);
  expect(evidence.focusOwnsList).toBe(true);
  expect(evidence.activeOptionValid).toBe(true);
  expect(() => assertPickerEvidence(evidence, expected)).not.toThrow();
});
test('description and avatar identity cannot substitute for a raw or missing primary name', () => {
  for (const replacement of ['user-123', '']) {
    const f = picker();
    const primary = f.rows[0]?.querySelector(':scope > div > div > span');
    if (!primary) throw new Error('Missing primary label');
    primary.textContent = replacement;
    const description = f.doc.createElement('div');
    description.textContent = expected.names[0] ?? '';
    f.rows[0]?.append(description);
    expect(() => assertPickerEvidence(f.read(), expected)).toThrow();
  }
});
test('same-count wrong actors, duplicates, disabled and extra identities fail', () => {
  const f = picker();
  const base = f.read();
  for (const options of [
    base.options.map((row, index) =>
      index ? { ...row, label: 'Other Example' } : row,
    ),
    base.options.map((row) => ({ ...row, label: 'Alice Example' })),
    base.options.map((row, index) =>
      index ? { ...row, disabled: true } : row,
    ),
    [
      ...base.options,
      {
        label: 'Foreign actor',
        disabled: false,
        selected: false,
        id: 'foreign',
      },
    ],
  ])
    expect(() =>
      assertPickerEvidence({ ...base, options }, expected),
    ).toThrow();
});
test('only explicitly allowed extra action names are admitted', () => {
  const f = picker();
  const base = f.read();
  const evidence = {
    ...base,
    options: [
      ...base.options,
      {
        label: 'Create an agent…',
        disabled: false,
        selected: false,
        id: 'create',
      },
    ],
  };
  expect(() => assertPickerEvidence(evidence, expected)).toThrow('Unexpected');
  expect(() =>
    assertPickerEvidence(evidence, {
      ...expected,
      allowedExtra: ['Create an agent…'],
    }),
  ).not.toThrow();
});
test('wrong picker, empty expected roster and stale selection fail', () => {
  const base = picker().read();
  expect(() =>
    assertPickerEvidence({ ...base, label: 'Priority' }, expected),
  ).toThrow('Wrong picker');
  expect(() => assertPickerEvidence(base, { ...expected, names: [] })).toThrow(
    'expected',
  );
  expect(() =>
    assertPickerEvidence(base, {
      ...expected,
      names: ['Alice Example', 'Alice Example'],
    }),
  ).toThrow('expected');
  expect(() =>
    assertPickerEvidence(base, { ...expected, selected: null }),
  ).toThrow('selected');
  const options = base.options.map((row) => ({ ...row, selected: false }));
  expect(() =>
    assertPickerEvidence({ ...base, options }, { ...expected, selected: null }),
  ).not.toThrow();
});
test('focus outside the owning list and dangling active descendant fail', () => {
  const f = picker();
  f.input.setAttribute('aria-controls', 'other-list');
  expect(() => assertPickerEvidence(f.read(), expected)).toThrow('focus');
  f.input.setAttribute('aria-controls', 'people');
  f.input.setAttribute('aria-activedescendant', 'stale-option');
  expect(() => assertPickerEvidence(f.read(), expected)).toThrow('focus');
  f.input.setAttribute('aria-activedescendant', 'person-1');
  f.rows[1]?.setAttribute('aria-disabled', 'true');
  expect(() => assertPickerEvidence(f.read(), expected)).toThrow('focus');
  f.rows[1]?.removeAttribute('aria-disabled');
  f.input.blur();
  expect(() => assertPickerEvidence(f.read(), expected)).toThrow('focus');
});
test('attribute-only readiness and actor changes are observed freshly on reopen', () => {
  const f = picker();
  f.rows[1]?.setAttribute('aria-disabled', 'true');
  expect(() => assertPickerEvidence(f.read(), expected)).toThrow();
  f.rows[1]?.removeAttribute('aria-disabled');
  expect(() => assertPickerEvidence(f.read(), expected)).not.toThrow();
  f.rows[0]?.setAttribute('aria-selected', 'false');
  f.rows[1]?.setAttribute('aria-selected', 'true');
  expect(() =>
    assertPickerEvidence(f.read(), { ...expected, selected: 'Bob Example' }),
  ).not.toThrow();
});

function background() {
  const dom = fixture();
  const doc = dom.window.document;
  const modal = doc.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('data-state', 'open');
  const overlay = doc.createElement('div');
  const opener = doc.createElement('button');
  opener.textContent = 'Opened task';
  const other = doc.createElement('button');
  other.textContent = 'Different task';
  const rect = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    bottom: y + height,
    right: x + width,
    toJSON: () => ({}),
  });
  modal.getBoundingClientRect = () => rect(300, 100, 400, 500);
  opener.getBoundingClientRect = () => rect(10, 10, 100, 50);
  other.getBoundingClientRect = () => rect(10, 100, 100, 50);
  const board = doc.createElement('div');
  board.style.overflowY = 'auto';
  board.getBoundingClientRect = () => rect(0, 0, 200, 200);
  Object.defineProperties(board, {
    scrollHeight: { value: 500 },
    clientHeight: { value: 200 },
  });
  board.append(opener, other);
  doc.body.append(board, overlay, modal);
  doc.elementFromPoint = () => overlay;
  const read = dom.window.eval(
    `(${readBackgroundIsolation.toString()})`,
  ) as typeof readBackgroundIsolation;
  return {
    dom,
    doc,
    modal,
    other,
    overlay,
    board,
    read: () => read({ selector: 'button', title: 'Opened task' }),
    rect,
  };
}
test('background hit test selects another task, rejects a direct hit and never accepts absent hit', () => {
  const f = background();
  expect(f.read()).toEqual({
    x: 60,
    y: 125,
    backgroundTitle: 'Different task',
    blocked: true,
    hit: 'DIV',
    scroll: { axis: 'y', delta: 400, position: 0, maximum: 300 },
  });
  f.doc.elementFromPoint = () => f.other;
  expect(f.read().blocked).toBe(false);
  const span = f.doc.createElement('span');
  f.other.append(span);
  f.doc.elementFromPoint = () => span;
  expect(f.read().blocked).toBe(false);
  f.doc.elementFromPoint = () => null;
  expect(f.read().blocked).toBe(false);
});
test('background reader refuses missing modal, clipped, zero-sized or modal-covered cards', () => {
  const f = background();
  for (const box of [
    f.rect(0, 0, 0, 0),
    f.rect(-300, 0, 20, 20),
    f.rect(400, 200, 100, 50),
  ]) {
    f.other.getBoundingClientRect = () => box;
    expect(f.read).toThrow('No different visible');
  }
  f.modal.remove();
  expect(f.read).toThrow('modal missing');
});

// Layout metrics are synthetic here; hosted Chromium owns real wheel delivery.
test('wheel probe always has a movable direction and refuses non-scrollable background', () => {
  const f = background();
  f.board.scrollTop = 300;
  expect(f.read().scroll).toEqual({
    axis: 'y',
    delta: -400,
    position: 300,
    maximum: 300,
  });
  f.board.style.overflowY = 'hidden';
  expect(f.read).toThrow('scrollable');
});

test('background reader rejects a card clipped by any scroll ancestor', () => {
  const f = background();
  f.board.getBoundingClientRect = () => f.rect(0, 0, 200, 50);
  expect(f.read).toThrow('No different visible');
});

test('functional absence windows never shrink to the remaining deadline', async () => {
  const waits: number[] = [];
  await expect(
    waitFunctionalWindow(
      1000,
      () => 999,
      async (ms) => {
        waits.push(ms);
      },
    ),
  ).rejects.toThrow('full functional observation');
  expect(waits).toEqual([]);
  let budget = 1200;
  await waitFunctionalWindow(
    1000,
    () => budget,
    async (ms) => {
      waits.push(ms);
      budget -= ms;
    },
  );
  expect(waits).toEqual([1000]);
  let reads = 0;
  await expect(
    waitFunctionalWindow(
      300,
      () => {
        if (++reads === 2) throw new Error('deadline expired');
        return 300;
      },
      async (ms) => {
        waits.push(ms);
      },
    ),
  ).rejects.toThrow('deadline expired');
  expect(waits.at(-1)).toBe(300);
});

test('late title writes remain cancellation failures even if original text is restored', () => {
  expect(() => assertTitleUnchanged('Original', 'Original', 0)).not.toThrow();
  expect(() => assertTitleUnchanged('Original', 'Draft', 0)).toThrow(
    'committed',
  );
  expect(() => assertTitleUnchanged('Original', 'Original', 1)).toThrow(
    'mutation',
  );
  for (const invalid of [-1, 0.5, NaN, Infinity])
    expect(() => assertTitleUnchanged('Original', 'Original', invalid)).toThrow(
      'evidence',
    );
});
