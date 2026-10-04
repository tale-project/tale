import { afterEach, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { MessageChannel } from 'node:worker_threads';

import { JSDOM } from 'jsdom';

const source = await readFile(
  new URL('./browser/acceptance-oracle.js', import.meta.url),
  'utf8',
);
interface Board {
  path: string;
  tasks: { title: string; assigneeName: string | null }[];
  searchValue: string;
}
interface General {
  path: string;
  projectName: string;
}
interface Frame {
  source: string;
  tDom: number;
  tRaf: number;
  tFrame: number;
  label: string;
  countFrame?: Frame;
}
interface Oracle {
  boardState: (expected: Board) => boolean;
  generalState: (expected: General) => boolean;
  watchBoard: (
    expected: Board,
    options: { requireFalse: boolean },
  ) => Promise<Frame>;
  watchGeneral: (
    expected: General,
    options: { requireFalse: boolean },
  ) => Promise<Frame>;
}
const owned: JSDOM[] = [];
afterEach(() => {
  for (const dom of owned.splice(0)) dom.window.close();
});
const boardPath = '/org/projects/fixture/tasks/board';
const general: General = {
  path: '/org/projects/fixture/overview',
  projectName: 'Fixture project',
};
const expected: Board = {
  path: boardPath,
  tasks: [
    { title: 'First zebra', assigneeName: 'Alice Example' },
    { title: 'Second zebra', assigneeName: null },
  ],
  searchValue: 'zebra',
};
function fixture() {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: `http://127.0.0.1${boardPath}`,
    runScripts: 'outside-only',
  });
  owned.push(dom);
  let nextId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const timers = new Map<number, () => void>();
  Object.assign(dom.window, {
    MessageChannel,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      frames.delete(id);
    },
    setTimeout: (callback: () => void, delay: number) => {
      expect(delay).toBe(120000);
      const id = ++nextId;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  });
  // Execute only the serialized function, exactly the page-init boundary:
  // no imported module closure or test helper is visible in the DOM realm.
  dom.window.eval(`(${source.replace('export function', 'function')})()`);
  const oracle = (dom.window as unknown as { __acceptance: Oracle })
    .__acceptance;
  const frame = async () => {
    await Promise.resolve();
    const current = [...frames.values()];
    frames.clear();
    for (const callback of current) callback(dom.window.performance.now());
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  return { dom, document: dom.window.document, oracle, frame, frames, timers };
}
function board(f: ReturnType<typeof fixture>, tasks = expected.tasks) {
  const search = f.document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search tasks';
  search.setAttribute('aria-label', 'Search tasks');
  search.value = expected.searchValue;
  const region = f.document.createElement('div');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Board');
  const section = f.document.createElement('section');
  region.append(section);
  const rows = tasks.map((task) => {
    const root = f.document.createElement('div');
    const title = f.document.createElement('button');
    title.className = 'line-clamp-2';
    title.textContent = task.title;
    const avatar = f.document.createElement('span');
    avatar.setAttribute('role', 'img');
    avatar.setAttribute('aria-label', task.assigneeName ?? 'Unassigned');
    avatar.title = task.assigneeName ?? 'Unassigned';
    root.append(title, avatar);
    section.append(root);
    return { root, title, avatar };
  });
  f.document.body.append(search, region);
  return { search, region, rows };
}
function overview(f: ReturnType<typeof fixture>) {
  const form = f.document.createElement('form');
  form.id = 'project-overview-identity-form';
  const fieldset = f.document.createElement('fieldset');
  const input = f.document.createElement('input');
  input.id = 'project-overview-name';
  form.append(fieldset);
  fieldset.append(input);
  f.document.body.append(form);
  return { form, fieldset, input };
}

test('board state requires the exact title/assignee multiset and native text input', () => {
  const f = fixture();
  const b = board(f, expected.tasks.toReversed());
  expect(f.oracle.boardState(expected)).toBe(true);
  b.rows[0]!.title.textContent = expected.tasks[0]!.title;
  expect(f.oracle.boardState(expected)).toBe(false);
  b.rows[0]!.title.textContent = expected.tasks[1]!.title;
  b.search.type = 'search';
  expect(f.oracle.boardState(expected)).toBe(false);
  b.search.type = 'text';
  b.search.value = '';
  expect(f.oracle.boardState(expected)).toBe(false);
  b.search.value = 'zebra';
  b.search.disabled = true;
  expect(f.oracle.boardState(expected)).toBe(false);
});

test('same-count retained busy and stale rows cannot finish; count milestone remains separate', async () => {
  const f = fixture();
  const b = board(f);
  b.region.setAttribute('aria-busy', 'true');
  const pending = f.oracle.watchBoard(expected, { requireFalse: true });
  let done = false;
  void pending.then(() => {
    done = true;
    return done;
  });
  await f.frame();
  expect(done).toBe(false);
  b.rows[0]!.title.textContent = 'Old task';
  b.region.removeAttribute('aria-busy');
  await f.frame();
  expect(done).toBe(false);
  b.rows[0]!.title.firstChild!.textContent = 'First zebra';
  await f.frame();
  const result = await pending;
  expect(result.countFrame?.source).toBe('initial');
  expect(result.tDom).toBeGreaterThan(result.countFrame!.tDom);
  expect(result.tFrame).toBeGreaterThanOrEqual(result.tRaf);
  expect(result.tRaf).toBeGreaterThanOrEqual(result.tDom);
  expect(f.frames.size).toBe(0);
  expect(f.timers.size).toBe(0);
});

test('actor resolution and readiness attribute-only updates complete the actual board', async () => {
  const f = fixture();
  const b = board(f);
  const avatar = b.rows[0]!.avatar;
  avatar.setAttribute('aria-label', 'user-123');
  avatar.title = 'user-123';
  const pending = f.oracle.watchBoard(expected, { requireFalse: true });
  let done = false;
  void pending.then(() => {
    done = true;
    return done;
  });
  await f.frame();
  expect(done).toBe(false);
  avatar.setAttribute('aria-label', 'Alice Example');
  await f.frame();
  expect(done).toBe(false);
  avatar.title = 'Alice Example';
  await f.frame();
  await pending;
  expect(f.oracle.boardState(expected)).toBe(true);
});

test('an unassigned slot, duplicated avatar or extra board cannot masquerade as the fixture', () => {
  const f = fixture();
  const b = board(f);
  const avatar = b.rows[1]!.avatar;
  avatar.title = 'Someone';
  avatar.setAttribute('aria-label', 'Someone');
  expect(f.oracle.boardState(expected)).toBe(false);
  avatar.title = 'Unassigned';
  avatar.setAttribute('aria-label', 'Unassigned');
  expect(f.oracle.boardState(expected)).toBe(true);
  const duplicate = avatar.cloneNode(true);
  b.rows[1]!.root.append(duplicate);
  expect(f.oracle.boardState(expected)).toBe(false);
  duplicate.parentNode!.removeChild(duplicate);
  const extra = b.region.cloneNode(false);
  f.document.body.append(extra);
  expect(f.oracle.boardState(expected)).toBe(false);
});

test('watch rejects an already-complete initial state and a missing false-state contract', async () => {
  const f = fixture();
  board(f);
  await expect(
    f.oracle.watchBoard(expected, { requireFalse: true }),
  ).rejects.toThrow('already true');
  await expect(
    f.oracle.watchBoard(expected, { requireFalse: false }),
  ).rejects.toThrow('initially false');
  expect(f.frames.size).toBe(0);
  expect(f.timers.size).toBe(0);
});

test('input-only final value can trigger readiness without a DOM attribute mutation', async () => {
  const f = fixture();
  const b = board(f);
  b.search.value = 'zebr';
  const pending = f.oracle.watchBoard(expected, { requireFalse: true });
  b.search.value = 'zebra';
  b.search.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  await f.frame();
  expect((await pending).source).toBe('input');
});

test('a fleeting complete board before the rendering opportunity cannot finish', async () => {
  const f = fixture();
  const b = board(f);
  b.region.setAttribute('aria-busy', 'true');
  const pending = f.oracle.watchBoard(expected, { requireFalse: true });
  let done = false;
  void pending.then(() => {
    done = true;
    return done;
  });
  b.region.removeAttribute('aria-busy');
  await Promise.resolve();
  b.region.setAttribute('aria-busy', 'true');
  await f.frame();
  expect(done).toBe(false);
  b.region.removeAttribute('aria-busy');
  await f.frame();
  await pending;
});

test('General requires the real destination, loaded form value and usable fieldset', () => {
  const f = fixture();
  const g = overview(f);
  g.input.value = general.projectName;
  expect(f.oracle.generalState(general)).toBe(false);
  f.dom.window.history.replaceState(null, '', general.path);
  expect(f.oracle.generalState(general)).toBe(true);
  g.fieldset.disabled = true;
  expect(f.oracle.generalState(general)).toBe(false);
  g.fieldset.disabled = false;
  g.input.readOnly = true;
  expect(f.oracle.generalState(general)).toBe(false);
  g.input.readOnly = false;
  g.input.value = 'Other project';
  expect(f.oracle.generalState(general)).toBe(false);
  g.input.value = general.projectName;
  g.form.setAttribute('aria-busy', 'true');
  expect(f.oracle.generalState(general)).toBe(false);
  g.form.removeAttribute('aria-busy');
  board(f);
  expect(f.oracle.generalState(general)).toBe(false);
});

test('General property-only data reset is observed with bounded animation-frame polling', async () => {
  const f = fixture();
  f.dom.window.history.replaceState(null, '', general.path);
  const g = overview(f);
  const pending = f.oracle.watchGeneral(general, { requireFalse: true });
  await f.frame();
  g.input.value = general.projectName;
  await f.frame();
  await f.frame();
  const result = await pending;
  expect(result.source).toBe('animation-frame');
  expect(result.countFrame).toBeUndefined();
  expect(f.frames.size).toBe(0);
  expect(f.timers.size).toBe(0);
});

test('a wrong-route zero-card skeleton cannot finish leave', async () => {
  const f = fixture();
  const pending = f.oracle.watchGeneral(general, { requireFalse: true });
  let done = false;
  void pending.then(() => {
    done = true;
    return done;
  });
  await f.frame();
  expect(done).toBe(false);
  const g = overview(f);
  g.input.value = general.projectName;
  await f.frame();
  expect(done).toBe(false);
  f.dom.window.history.replaceState(null, '', general.path);
  await f.frame();
  await f.frame();
  await pending;
});

test('deadline and document replacement reject and remove every owned timer/frame', async () => {
  const f = fixture();
  const pending = f.oracle.watchGeneral(general, { requireFalse: true });
  const rejection = pending.then(
    () => 'unexpected resolution',
    (error: Error) => error.message,
  );
  const timeout = [...f.timers.values()][0]!;
  timeout();
  expect(await rejection).toContain('120 seconds');
  expect(f.timers.size).toBe(0);
  expect(f.frames.size).toBe(0);
  const next = f.oracle.watchGeneral(general, { requireFalse: true });
  const replaced = next.then(
    () => 'unexpected resolution',
    (error: Error) => error.message,
  );
  f.dom.window.dispatchEvent(new f.dom.window.Event('pagehide'));
  expect(await replaced).toContain('document was replaced');
  expect(f.timers.size).toBe(0);
  expect(f.frames.size).toBe(0);
});

test('targets are copied at watch creation and the oracle adds no tracing or local-storage marks', async () => {
  const f = fixture();
  const mutable = structuredClone(expected);
  const pending = f.oracle.watchBoard(mutable, { requireFalse: true });
  mutable.tasks[0]!.title = 'Changed by caller';
  board(f);
  await f.frame();
  await pending;
  expect(f.dom.window.localStorage.getItem('tale_perf')).toBeNull();
  expect('__perf' in f.dom.window).toBe(false);
});
