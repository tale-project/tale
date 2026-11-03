// The browser of a running session: tabs, reading a page, mouse and keyboard.
// Every tool that works in the browser says it is at work there, so that the
// page's dialogs wait for an answer (`remoteOf`). A page that opens a dialog
// (alert, confirm, prompt) does not respond until it is answered: the tool that
// caused one returns at once and says so, and `handle_dialog` answers it.

import { z } from 'zod';

import { act, typeInto } from './acting.ts';
import { elementNumber, pixel, pressEnter, sessionRef, tabId } from './args.ts';
import {
  dialogNotice,
  framedJson,
  pageSummary,
  pageText,
  tabText,
  tabsText,
} from './format.ts';
import { remoteOf, webAddress } from './lookup.ts';
import {
  LIVE_VIEW,
  READ_ONLY,
  ToolError,
  defineTool,
  jpegImage,
} from './tool.ts';
import { UNTRUSTED_SENTENCE, untrusted } from './untrusted.ts';
import { paced, sleep, sleepWhileOn } from './waiting.ts';

/** The most `wait` waits (seconds). */
const LONGEST_WAIT = 30;

/** How far the page moves, as the mouse wheel says it: `[dx, dy]`. */
const DIRECTIONS: Record<
  'down' | 'up' | 'right' | 'left',
  (pixels: number) => readonly [number, number]
> = {
  down: (pixels) => [0, pixels],
  up: (pixels) => [0, -pixels],
  right: (pixels) => [pixels, 0],
  left: (pixels) => [-pixels, 0],
};

// -- tabs ---------------------------------------------------------------------------

const listTabs = defineTool({
  name: 'list_tabs',
  group: 'browser',
  title: 'List the tabs',
  description: `The open tabs of a running session (id, address, title, which one is active). ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({ session: sessionRef }),
  annotations: READ_ONLY,
  routes: [LIVE_VIEW],
  async run({ session }, { manager }) {
    return tabsText(await remoteOf(manager, session).listTabs());
  },
});

const openTab = defineTool({
  name: 'open_tab',
  group: 'browser',
  title: 'Open a tab',
  description: `Open a new tab (it becomes the active one) at the address, or at the start page without one. ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({
    session: sessionRef,
    url: z.string().nullish().describe('The address (https://...).'),
  }),
  routes: [LIVE_VIEW],
  async run({ session, url }, { manager }) {
    const browser = remoteOf(manager, session);
    const address = url == null ? null : webAddress(url);
    return framedJson(tabText(await browser.openTab(address)));
  },
});

const switchTab = defineTool({
  name: 'switch_tab',
  group: 'browser',
  title: 'Switch to a tab',
  description: `Make a tab the active one; the other tools act on the active tab unless given a tab. ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({
    session: sessionRef,
    tab: z.int().describe('The id of the tab (see list_tabs).'),
  }),
  routes: [LIVE_VIEW],
  async run({ session, tab }, { manager }) {
    const browser = remoteOf(manager, session);
    await browser.activateTab(tab);
    return tabsText(await browser.listTabs());
  },
});

const closeTab = defineTool({
  name: 'close_tab',
  group: 'browser',
  title: 'Close a tab',
  description: `Close a tab. Closing the last one ends the session (the next start opens the start page). ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({
    session: sessionRef,
    tab: z.int().describe('The id of the tab (see list_tabs).'),
  }),
  routes: [LIVE_VIEW],
  async run({ session, tab }, { manager }) {
    const browser = remoteOf(manager, session);
    await browser.closeTab(tab);
    return tabsText(await browser.listTabs());
  },
});

// -- going places and reading ---------------------------------------------------------

const navigate = defineTool({
  name: 'navigate',
  group: 'browser',
  title: 'Open an address',
  description: `Open an address (https://...) in a tab and wait until the page has loaded. ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({
    session: sessionRef,
    url: z.string().describe('The address (https://...).'),
    tab: tabId,
  }),
  routes: [LIVE_VIEW],
  async run({ session, url, tab }, { manager }) {
    const browser = remoteOf(manager, session);
    const notice = await act(
      browser,
      browser.goto(webAddress(url), tab ?? null, 'domcontentloaded'),
      0,
    );
    if (browser.dialogs().length > 0) return `Opening the page.${notice}`;
    const reading = await browser.readPage(tab ?? null);
    return `Opened the page:\n${pageSummary(reading)}`;
  },
});

const history = defineTool({
  name: 'history',
  group: 'browser',
  title: 'Go back, forward or reload',
  description: `Go back or forward in a tab's history, or reload it. ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({
    session: sessionRef,
    action: z.enum(['back', 'forward', 'reload']),
    tab: tabId,
  }),
  routes: [LIVE_VIEW],
  async run({ session, action, tab }, context) {
    const browser = remoteOf(context.manager, session);
    const notice = await act(
      browser,
      browser.history(action, tab ?? null),
      paced(context, 1000),
    );
    if (browser.dialogs().length > 0) return `Went ${action}.${notice}`;
    const reading = await browser.readPage(tab ?? null);
    return `Now at:\n${pageSummary(reading)}`;
  },
});

const readPage = defineTool({
  name: 'read_page',
  group: 'browser',
  title: 'Read the page',
  description: `What a tab shows: its address, title, visible text, and the buttons, links and fields in view, each with a number to use in click and type_text and its position. Read the page again after it changed. To see more of a long page, scroll and read again. ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({ session: sessionRef, tab: tabId }),
  annotations: READ_ONLY,
  routes: [LIVE_VIEW],
  async run({ session, tab }, { manager }) {
    const browser = remoteOf(manager, session);
    if (browser.dialogs().length > 0) {
      return `The page is blocked.${dialogNotice(browser.dialogs())}`;
    }
    return pageText(await browser.readPage(tab ?? null));
  },
});

const screenshot = defineTool({
  name: 'screenshot',
  group: 'browser',
  title: 'Take a screenshot',
  description: `A picture of what the tab shows (x and y of click are positions in it). ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({ session: sessionRef, tab: tabId }),
  annotations: READ_ONLY,
  routes: [LIVE_VIEW],
  async run({ session, tab }, { manager }) {
    const browser = remoteOf(manager, session);
    if (browser.dialogs().length > 0) {
      throw new ToolError(
        `The page is blocked.${dialogNotice(browser.dialogs())}`,
      );
    }
    return jpegImage(await browser.screenshot(tab ?? null));
  },
});

// -- mouse and keyboard ---------------------------------------------------------------

const click = defineTool({
  name: 'click',
  group: 'browser',
  title: 'Click',
  description:
    'Click an element by the number read_page gave, or at a position (x, y) in the viewport as a screenshot shows it. `button` and `double` (a double click) work with a position only. A drop-down list cannot be clicked open: choose its option with type_text.',
  input: z.strictObject({
    session: sessionRef,
    element: elementNumber,
    x: pixel.nullish().describe('Pixels from the left of the viewport.'),
    y: pixel.nullish().describe('Pixels from the top of the viewport.'),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    double: z.boolean().default(false).describe('A double click.'),
  }),
  routes: [LIVE_VIEW],
  async run(args, context) {
    const browser = remoteOf(context.manager, args.session);
    let work: Promise<void>;
    if (args.element != null) {
      if (args.button !== 'left' || args.double) {
        throw new ToolError(
          'Other clicks than a single left one need a position: give x and y.',
        );
      }
      work = browser.clickElement(args.element);
    } else if (args.x != null && args.y != null) {
      work = browser.clickAt(args.x, args.y, {
        button: args.button,
        count: args.double ? 2 : 1,
      });
    } else {
      throw new ToolError('Give an element number, or both x and y.');
    }
    return `Clicked.${await act(browser, work, paced(context, 500))}`;
  },
});

const hover = defineTool({
  name: 'hover',
  group: 'browser',
  title: 'Hover',
  description:
    'Move the mouse to a position in the viewport (to open a menu that shows on hover, for example).',
  input: z.strictObject({ session: sessionRef, x: pixel, y: pixel }),
  routes: [LIVE_VIEW],
  async run({ session, x, y }, context) {
    const browser = remoteOf(context.manager, session);
    const notice = await act(browser, browser.hover(x, y), paced(context, 500));
    return `Moved the mouse.${notice}`;
  },
});

const drag = defineTool({
  name: 'drag',
  group: 'browser',
  title: 'Drag',
  description:
    'Press the mouse button at one position, move to another and release it (sliders, drag and drop).',
  input: z.strictObject({
    session: sessionRef,
    from_x: pixel,
    from_y: pixel,
    to_x: pixel,
    to_y: pixel,
  }),
  routes: [LIVE_VIEW],
  async run({ session, from_x, from_y, to_x, to_y }, context) {
    const browser = remoteOf(context.manager, session);
    const notice = await act(
      browser,
      browser.drag(from_x, from_y, to_x, to_y),
      paced(context, 500),
    );
    return `Dragged.${notice}`;
  },
});

const typeText = defineTool({
  name: 'type_text',
  group: 'browser',
  title: 'Type text',
  description:
    'Type into a field: the one with this element number (its content is replaced; for a drop-down list, the option to choose), or else whatever has the focus (click a field first). `submit` presses Enter afterwards.',
  input: z.strictObject({
    session: sessionRef,
    text: z.string().describe('What to type.'),
    element: elementNumber,
    submit: pressEnter,
  }),
  routes: [LIVE_VIEW],
  async run({ session, text, element, submit }, context) {
    const browser = remoteOf(context.manager, session);
    const notice = await act(
      browser,
      typeInto(browser, text, element, submit),
      paced(context, 300),
    );
    return `Typed.${notice}`;
  },
});

const pressKey = defineTool({
  name: 'press_key',
  group: 'browser',
  title: 'Press a key',
  description:
    'Press a key or a combination, for example Enter, Tab, Escape, ArrowDown, Control+a or Shift+Tab. `down` and `up` hold a key and release it.',
  input: z.strictObject({
    session: sessionRef,
    key: z.string().describe('The key or combination.'),
    action: z.enum(['press', 'down', 'up']).default('press'),
  }),
  routes: [LIVE_VIEW],
  async run({ session, key, action }, context) {
    const browser = remoteOf(context.manager, session);
    const notice = await act(
      browser,
      browser.key(action, key),
      paced(context, 300),
    );
    return `Key ${key}: ${action}.${notice}`;
  },
});

const scroll = defineTool({
  name: 'scroll',
  group: 'browser',
  title: 'Scroll',
  description: `Scroll the active tab with the mouse wheel at a position in it (x and y; the middle of the page without) and say which part of the page is in view now. ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({
    session: sessionRef,
    direction: z.enum(['down', 'up', 'right', 'left']).default('down'),
    pixels: z.int().default(600).describe('How far to scroll.'),
    x: pixel.nullish().describe('Pixels from the left of the viewport.'),
    y: pixel.nullish().describe('Pixels from the top of the viewport.'),
  }),
  routes: [LIVE_VIEW],
  async run({ session, direction, pixels, x, y }, context) {
    const browser = remoteOf(context.manager, session);
    const [dx, dy] = DIRECTIONS[direction](pixels);
    const notice = await act(
      browser,
      browser.scroll(dx, dy, x ?? null, y ?? null),
      paced(context, 400),
    );
    if (browser.dialogs().length > 0) return `Scrolled ${direction}.${notice}`;
    const reading = await browser.readPage();
    return `Scrolled ${direction}. In view now:\n${untrusted(reading.scroll)}`;
  },
});

const getSelectedText = defineTool({
  name: 'get_selected_text',
  group: 'browser',
  title: 'Get the selected text',
  description: `The text that is selected on the page (or in the field that has the focus). ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({ session: sessionRef }),
  annotations: READ_ONLY,
  routes: [LIVE_VIEW],
  async run({ session }, { manager }) {
    const selected = await remoteOf(manager, session).selectedText();
    return selected === '' ? '(nothing is selected)' : untrusted(selected);
  },
});

// -- dialogs and waiting ----------------------------------------------------------------

const handleDialog = defineTool({
  name: 'handle_dialog',
  group: 'browser',
  title: 'Answer a dialog',
  description: `Answer the dialog the page shows (alert, confirm, prompt, or a “leave this page?” question): \`accept\` presses OK, otherwise Cancel. \`text\` is what a prompt gets. The page does not respond until then. ${UNTRUSTED_SENTENCE}`,
  input: z.strictObject({
    session: sessionRef,
    accept: z.boolean().default(true).describe('OK (true) or Cancel (false).'),
    text: z.string().nullish().describe('What a prompt gets.'),
  }),
  routes: [LIVE_VIEW],
  async run({ session, accept, text }, context) {
    const browser = remoteOf(context.manager, session);
    const [dialog] = browser.dialogs();
    if (dialog === undefined) throw new ToolError('No dialog is open.');
    await browser.answerDialog(dialog.id, { accept, text: text ?? null });
    await sleep(paced(context, 300));
    return `${accept ? 'Accepted' : 'Dismissed'} the ${dialog.kind} dialog. It said:\n${untrusted(dialog.message)}${dialogNotice(browser.dialogs())}`;
  },
});

const wait = defineTool({
  name: 'wait',
  group: 'browser',
  title: 'Wait',
  description:
    'Wait (at most 30 seconds), for example for a page to finish loading.',
  input: z.strictObject({
    seconds: z.number().default(2).describe('How long to wait.'),
  }),
  routes: [],
  async run({ seconds }, context) {
    await sleepWhileOn(
      context,
      Math.min(Math.max(seconds, 0), LONGEST_WAIT) * 1000,
    );
    return 'Done waiting.';
  },
});

export const browserTools = [
  listTabs,
  openTab,
  switchTab,
  closeTab,
  navigate,
  history,
  readPage,
  screenshot,
  click,
  hover,
  drag,
  typeText,
  pressKey,
  scroll,
  getSelectedText,
  handleDialog,
  wait,
];
