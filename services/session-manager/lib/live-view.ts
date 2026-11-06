// The live view of a running session: its pictures go to the web client over a
// WebSocket at `/api/sessions/:id/stream`, its input comes back.
//
// Server to client: text messages are JSON (`ServerMessage`); a binary message
// is a JPEG of the active tab. A `view` message always comes before the
// pictures it describes.
//
// Client to server: JSON text messages (`ClientMessage`). Mouse coordinates
// are in the viewport space of the last `view` message (CSS pixels of the
// page, not of the picture).
//
// The keys are short on purpose: mouse moves and wheel ticks are the busiest
// traffic of the app.

import { z } from 'zod';

import './zod-config.ts';

/** The longest text a client may insert into the page at once. */
export const MAX_TEXT = 100_000;
/** The longest key name a client may press. */
const MAX_KEY_LENGTH = 40;
/**
 * The largest click count that means anything: pages tell a single, a double
 * and a triple click apart (a word, a paragraph), and a larger count is still
 * a triple click. Both ends clamp to it (the page before it sends, the server
 * before it clicks).
 */
export const MAX_CLICKS = 3;

/**
 * The text without what is past `MAX_TEXT`, and without half a character: a
 * paste of more than the protocol allows still gets its beginning in. Both
 * ends use it, the page before it sends and the server before it types.
 */
export function clampText(text: string): string {
  if (text.length <= MAX_TEXT) return text;
  const lastKept = text.charCodeAt(MAX_TEXT - 1);
  const splitsPair = lastKept >= 0xd800 && lastKept <= 0xdbff;
  return text.slice(0, splitsPair ? MAX_TEXT - 1 : MAX_TEXT);
}

/**
 * The most characters of a tab's address and title a `tabs` message carries
 * (more is cut): a page decides both, and one that changes its address every
 * few milliseconds to one of megabytes would otherwise fill the memory of
 * the server with what a viewer that does not read has not been sent.
 * An address bar shows no more than the first part of an address anyway.
 */
export const MAX_TAB_URL = 2048;
export const MAX_TAB_TITLE = 512;

export const MOUSE_BUTTONS = ['left', 'middle', 'right'] as const;

const finite = z.number().refine(Number.isFinite, 'must be a finite number');

// -- client to server ---------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('mouse'),
    a: z.enum(['move', 'down', 'up']),
    x: finite,
    y: finite,
    b: z.enum(MOUSE_BUTTONS).default('left'),
    /** Click count: 1 for a click, 2 for a double click. */
    n: z.number().int().default(1),
  }),
  z.object({
    t: z.literal('wheel'),
    x: finite,
    y: finite,
    dx: finite,
    dy: finite,
  }),
  z.object({
    t: z.literal('key'),
    a: z.enum(['down', 'up']),
    k: z.string().max(MAX_KEY_LENGTH),
  }),
  z.object({ t: z.literal('text'), text: z.string().max(MAX_TEXT) }),
  /** Copy (or cut) the page's selection to the client's clipboard. */
  z.object({ t: z.literal('copy'), cut: z.boolean().default(false) }),
  z.object({
    t: z.literal('tab'),
    a: z.enum(['open', 'close', 'activate']),
    id: z.number().int().optional(),
    url: z.string().optional(),
  }),
  z.object({
    t: z.literal('go'),
    a: z.enum(['goto', 'back', 'forward', 'reload']),
    url: z.string().optional(),
  }),
  /** The answer to a `select` message: the option chosen, null: dismissed. */
  z.object({
    t: z.literal('pick'),
    token: z.number().int(),
    index: z.number().int().nullable(),
  }),
  /** The answer to a `dialog` message. */
  z.object({
    t: z.literal('answer'),
    id: z.number().int(),
    accept: z.boolean(),
    text: z.string().nullish(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** The messages that answer what the browser asked: they never wait in line. */
export const URGENT_MESSAGES: ReadonlySet<ClientMessage['t']> = new Set([
  'pick',
  'answer',
]);

// -- server to client ---------------------------------------------------------

export const tabInfoSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  active: z.boolean(),
});
export type TabInfo = z.infer<typeof tabInfoSchema>;

export const selectOptionSchema = z.object({
  label: z.string(),
  selected: z.boolean(),
  disabled: z.boolean(),
  group: z.string().nullable(),
});
export type SelectOptionInfo = z.infer<typeof selectOptionSchema>;

/**
 * What a notice is about: one thing the viewer asked for that the browser
 * could not do. The page words each one in the language of the person; the
 * `message` of the error is the browser layer's own sentence (English) and is
 * only ever shown as a quoted detail.
 */
export const NOTICE_CODES = [
  /** The address bar was given something the browser does not open (not http or https, or too long). */
  'address_refused',
  /** The tab is not there any more. */
  'tab_gone',
  /** A new tab could not be opened. */
  'tab_not_opened',
  /** The page did not take a key. */
  'key_failed',
  /** The browser has stopped taking the mouse, in every tab, until the session restarts. */
  'input_stuck',
  /** Anything else the browser could not do. */
  'action_failed',
] as const;
const noticeCodeSchema = z.enum(NOTICE_CODES);
export type NoticeCode = z.infer<typeof noticeCodeSchema>;

export const serverMessageSchema = z.discriminatedUnion('t', [
  /** The tabs, whenever they change. */
  z.object({ t: z.literal('tabs'), tabs: z.array(tabInfoSchema) }),
  /** The next pictures are of this tab; w x h is its viewport in CSS pixels. */
  z.object({
    t: z.literal('view'),
    tab: z.number().int(),
    w: z.number(),
    h: z.number(),
  }),
  /** A drop-down list the browser would draw outside the page. */
  z.object({
    t: z.literal('select'),
    token: z.number().int(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    options: z.array(selectOptionSchema),
  }),
  /** alert(), confirm(), prompt() or beforeunload: the page waits. */
  z.object({
    t: z.literal('dialog'),
    id: z.number().int(),
    tab: z.number().int(),
    kind: z.string(),
    message: z.string(),
    default: z.string(),
  }),
  z.object({ t: z.literal('dialog_closed'), id: z.number().int() }),
  /** The answer to `copy`. */
  z.object({
    t: z.literal('selection'),
    text: z.string(),
    cut: z.boolean(),
  }),
  /** The browser is gone. */
  z.object({ t: z.literal('closed') }),
  /**
   * Something went wrong. With a `code` the connection is refused (the session
   * is not running, there is no such session): the page stops trying. With a
   * `notice` one action failed and the connection goes on. With neither it is
   * a notice too, of the generic kind.
   */
  z.object({
    t: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
    notice: noticeCodeSchema.optional(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
